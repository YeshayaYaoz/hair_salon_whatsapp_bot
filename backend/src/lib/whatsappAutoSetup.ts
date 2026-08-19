import { prisma } from "./prisma.js";
import { encryptSecret } from "./crypto.js";
import { sendAdminAlertEmail } from "./email.js";
import { captureError } from "./errorMonitoring.js";
import { submitWhatsAppTemplates } from "./submitTemplates.js";
import {
  addPhoneNumberToWaba,
  requestVerificationCode,
  verifyCode,
  registerOnCloudApi,
  subscribeWabaToApp,
  getPhoneNumber,
  MetaApiError,
} from "./metaPhoneNumbers.js";
import { readVerificationCodeFromCall } from "./verificationCode.js";
import crypto from "node:crypto";

/**
 * Connects a number Tori just issued to WhatsApp, with nobody in the loop.
 *
 * A business that needed us to issue its phone number has no Facebook Business account and no way
 * through Embedded Signup — that flow starts with a Facebook login they don't have. For them the
 * number goes onto TORI'S OWN WABA (the same arrangement the first such customer runs on today),
 * and this module drives Meta's sequence for it end to end:
 *
 *   add to WABA → request a code by VOICE → read the code out of the call Cartesia answered →
 *   verify → register on Cloud API → subscribe the webhook → wire our DB → submit templates
 *
 * VOICE is the only method that can work unattended: the number is a VoIP line, SMS delivery to it
 * is not guaranteed, and nobody is holding a handset. The verification call is answered by the
 * voice agent (the number was pointed at Cartesia when it was ordered), Cartesia records it, and
 * the code is transcribed out of the recording.
 *
 * Every step writes its state to the business row, because the whole run takes minutes and spans a
 * phone call — the dashboard needs to say "we're on it", and a crash mid-way must leave a record of
 * how far it got rather than a business half-configured in silence.
 */

const STATE = {
  adding: "adding",
  awaitingCode: "awaiting_code",
  verifying: "verifying",
  registering: "registering",
  done: "done",
  failed: "failed",
} as const;

/** How long to wait for Meta's call to happen, end, and its recording to appear. */
const CODE_POLL_INTERVAL_MS = 30_000;
const CODE_POLL_ATTEMPTS = 20; // ~10 minutes
/** Code requests per run. Meta locks the number after a handful, and the lockout outlasts any retry. */
const MAX_CODE_REQUESTS = 2;

function credentials(): { wabaId: string; token: string } | null {
  const wabaId = process.env.TORI_WABA_ID?.trim();
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  return wabaId && token ? { wabaId, token } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setState(businessId: string, state: string, error?: string): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { whatsappAutoSetupState: state, whatsappAutoSetupError: error ?? null, whatsappAutoSetupAt: new Date() },
  });
}

/**
 * Fire-and-forget entry point: never throws, reports failure via state + operator email.
 *
 * Callers must not await the outcome — the run spans a real phone call and belongs to nobody's
 * HTTP request. It is safe to call again after a failure: every step checks before it acts.
 */
export function startWhatsAppAutoSetup(businessId: string): void {
  runAutoSetup(businessId).catch(async (err) => {
    console.error(`[auto-setup] WhatsApp setup failed for ${businessId}:`, err);
    captureError(err, { businessId, phase: "whatsapp_auto_setup" });
    const message = err instanceof Error ? err.message : String(err);
    await setState(businessId, STATE.failed, message).catch(() => {});
    // The operator can finish by hand with the meta-number workflow — the email says where it
    // stopped, which is the part that takes the time to reconstruct.
    await sendAdminAlertEmail(
      `WhatsApp auto-setup failed — business ${businessId}`,
      `<p>Automatic WhatsApp setup stopped: <b>${message}</b></p>
       <p>Finish by hand with the "Tori number on Tori's WABA" workflow (status → request-code →
       verify-from-call → register). The business's dashboard shows the failure and offers the
       manual path.</p>`
    ).catch(() => {});
  });
}

async function runAutoSetup(businessId: string): Promise<void> {
  const creds = credentials();
  if (!creds) {
    throw new Error("TORI_WABA_ID / META_SYSTEM_USER_TOKEN are not set — cannot run WhatsApp setup on Tori's WABA.");
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      voicePhoneNumber: true,
      whatsappPhoneNumberId: true,
      whatsappRegistrationPin: true,
      whatsappRegisteredAt: true,
      whatsappAutoSetupAttempts: true,
    },
  });

  // A business that already has a connected WhatsApp line has nothing to set up — this guards the
  // retry path, and the (unexpected) case of an owner racing through Embedded Signup meanwhile.
  if (business.whatsappRegisteredAt) {
    await setState(businessId, STATE.done);
    return;
  }
  if (!business.voicePhoneNumber) {
    throw new Error("No number on the business to set up.");
  }

  const e164 = business.voicePhoneNumber.startsWith("+")
    ? business.voicePhoneNumber
    : `+${business.voicePhoneNumber}`;

  // 1. Onto the WABA. Display name = business name; Meta reviews it separately and a pending name
  //    does not block verification, so nothing waits on that review here.
  await setState(businessId, STATE.adding);
  const phoneNumberId = await addPhoneNumberToWaba(creds.wabaId, e164, business.name, creds.token);

  // Already verified? (A retry after a crash between verify and register lands here.)
  const current = await getPhoneNumber(phoneNumberId, creds.token);
  const alreadyVerified = current.codeVerificationStatus === "VERIFIED";

  if (!alreadyVerified) {
    // 2. Ask for the code by VOICE and read it off the recorded call.
    if (business.whatsappAutoSetupAttempts >= MAX_CODE_REQUESTS) {
      throw new Error(
        `Already requested ${business.whatsappAutoSetupAttempts} verification codes — stopping before Meta locks the number.`
      );
    }
    await prisma.business.update({
      where: { id: businessId },
      data: { whatsappAutoSetupAttempts: { increment: 1 } },
    });
    await setState(businessId, STATE.awaitingCode);
    await requestVerificationCode(phoneNumberId, creds.token, "VOICE");

    let code: string | null = null;
    for (let i = 0; i < CODE_POLL_ATTEMPTS && !code; i++) {
      await sleep(CODE_POLL_INTERVAL_MS);
      code = await readVerificationCodeFromCall(e164).catch(() => null);
    }
    if (!code) {
      throw new Error("Meta's verification call was not readable within 10 minutes.");
    }

    // 3. Verify. A wrong code throws a MetaApiError that names it, which the failure email carries.
    await setState(businessId, STATE.verifying);
    await verifyCode(phoneNumberId, code, creds.token);
  }

  // 4. Register on Cloud API. The PIN must be reused forever once set, so it is stored before the
  //    call — a stored PIN with a failed registration beats a successful registration whose PIN
  //    was lost.
  await setState(businessId, STATE.registering);
  const pin = business.whatsappRegistrationPin ?? crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.business.update({
    where: { id: businessId },
    data: { whatsappRegistrationPin: pin, whatsappRegisterAttemptedAt: new Date() },
  });
  try {
    await registerOnCloudApi(phoneNumberId, pin, creds.token);
  } catch (err) {
    // 133016 = too many attempts; the number may in fact already be registered from a prior run.
    if (!(err instanceof MetaApiError && err.code === 133016)) throw err;
  }

  // 5. Webhook + our own wiring. The stored token is what the webhook and every send path use;
  //    for a business on Tori's WABA that is Tori's own system token, same as the first such
  //    customer already runs on.
  await subscribeWabaToApp(creds.wabaId, creds.token);
  await prisma.business.update({
    where: { id: businessId },
    data: {
      whatsappPhoneNumberId: phoneNumberId,
      whatsappWabaId: creds.wabaId,
      whatsappAccessToken: encryptSecret(creds.token),
      whatsappTokenValid: true,
      whatsappRegisteredAt: new Date(),
    },
  });

  // 6. Templates, so reminders and confirmations work from day one. Failure here is logged inside
  //    submitWhatsAppTemplates and must not fail the setup that just succeeded.
  await submitWhatsAppTemplates(businessId, phoneNumberId, creds.token, creds.wabaId).catch(() => null);

  await setState(businessId, STATE.done);
}
