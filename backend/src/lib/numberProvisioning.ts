import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";
import { assignNumberToAgent } from "./cartesiaAdmin.js";
import { listAvailableNumbers, orderNumber, pointNumberAtCartesia, getBalance } from "./zadarmaAdmin.js";
import { captureError } from "./errorMonitoring.js";

/**
 * Getting a business its own phone number, without a person in the middle when there needn't be one.
 *
 * The rule, and the whole reason this module exists:
 *
 *   - A PAYING business orders a number itself. The decision to spend was made when they
 *     subscribed; asking them to wait on someone to click something is the manual step that does
 *     not survive ten customers.
 *   - A TRIAL business cannot. A trial that never converts would leave a number billing every month
 *     forever, and nothing about a signup form says anyone intends to pay for it. That path records
 *     the request and asks the operator.
 *
 * Everything downstream of the order is identical either way — the difference is who is allowed to
 * start it, not what happens next.
 */

/** Israeli mobile destination on Zadarma. Overridable without a deploy if the catalogue shifts. */
const DEFAULT_DIRECTION_ID = process.env.ZADARMA_DIRECTION_ID || "3061";

export class NotEntitledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotEntitledError";
  }
}

export class AlreadyHasNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyHasNumberError";
  }
}

/**
 * Whether a business may order a number on its own account.
 *
 * Deliberately narrow: only an active subscription qualifies. past_due is a business whose payment
 *已 failed — adding a recurring charge to an account that is already not paying is the wrong
 * direction — and canceled/none/trial have never paid at all.
 */
export function mayOrderNumber(business: { subscriptionStatus: string; blockedAt: Date | null }): boolean {
  return business.subscriptionStatus === "active" && !business.blockedAt;
}

export interface ProvisionResult {
  status: "ordered" | "approval_requested";
  number?: string;
}

/**
 * The numbers an owner may choose from.
 *
 * Capped, because the carrier returns hundreds and a picker with hundreds of near-identical digit
 * strings is a worse experience than no picker at all — the point is "pick one you like the sound
 * of", not "search a catalogue".
 */
const CHOICE_COUNT = 12;

export async function listNumberChoices(): Promise<{ number: string }[]> {
  const available = await listAvailableNumbers(DEFAULT_DIRECTION_ID);
  return available.slice(0, CHOICE_COUNT).map((n) => ({ number: n.number }));
}

/**
 * Orders a number for a paying business and wires it end to end; asks the operator for a trial.
 *
 * The claim on voiceNumberOrderedAt happens before the carrier is called and is never rolled back
 * on success. Two clicks half a second apart would otherwise both pass a "does this business have a
 * number" check — voicePhoneNumber is only set after the order returns — and the business would be
 * billed monthly for two numbers, one of which nothing points at.
 */
export async function provisionVoiceNumber(
  businessId: string,
  /** A number the owner picked from listNumberChoices. Omitted means "any" — see orderAndWire. */
  preferredNumber?: string
): Promise<ProvisionResult> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      email: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      blockedAt: true,
      voicePhoneNumber: true,
      voiceNumberOrderedAt: true,
    },
  });

  // Ordered, not merely populated. Connecting WhatsApp copies the WhatsApp number into
  // voicePhoneNumber (businessRoutes.ts), so refusing on a non-empty field refused every business
  // that finished onboarding — including the paying ones this whole path exists for. What must
  // never happen twice is an ORDER, and voiceNumberOrderedAt is the column that records one.
  if (business.voiceNumberOrderedAt) {
    throw new AlreadyHasNumberError(`${business.name} has already been issued ${business.voicePhoneNumber ?? "a number"}.`);
  }

  if (!mayOrderNumber(business)) {
    await requestOperatorApproval(business, preferredNumber);
    return { status: "approval_requested" };
  }

  // Claim, then order. The conditional update is the lock: whichever request updates a row wins,
  // and the other sees count 0 without ever reaching the carrier.
  const claim = await prisma.business.updateMany({
    where: { id: business.id, voiceNumberOrderedAt: null },
    data: { voiceNumberOrderedAt: new Date() },
  });
  if (claim.count === 0) {
    throw new AlreadyHasNumberError(
      `A number order for ${business.name} is already in progress or has already completed.`
    );
  }

  try {
    const number = await orderAndWire(business.id, business.name, preferredNumber);
    return { status: "ordered", number };
  } catch (err) {
    // Released only on failure. On success it stays set forever — it is the record that this
    // business has had a number bought for it, which outlives the number itself.
    //
    // Guarded on the number being *unchanged* rather than null: the field may legitimately hold the
    // WhatsApp number before any order, so "is it null" can no longer tell a failed order from a
    // completed one. If a number was allocated and saved, the failure came after the charge and the
    // claim must stand.
    await prisma.business.updateMany({
      where: { id: business.id, voicePhoneNumber: business.voicePhoneNumber },
      data: { voiceNumberOrderedAt: null },
    });
    throw err;
  }
}

async function orderAndWire(businessId: string, businessName: string, preferredNumber?: string): Promise<string> {
  // Checked first because a zero balance turns the order into a reservation that can never ring,
  // and the failure that follows says nothing about money.
  const { balance, currency } = await getBalance();
  if (balance <= 0) {
    throw new Error(`The Zadarma account balance is ${balance} ${currency} — no number can be activated.`);
  }

  const available = await listAvailableNumbers(DEFAULT_DIRECTION_ID);
  if (available.length === 0) {
    throw new Error(`No numbers are available to order on destination ${DEFAULT_DIRECTION_ID}.`);
  }

  // The owner's pick, if it is still on the carrier's list — availability changes between the
  // moment the list was drawn and the moment they click, and ordering a number that is gone fails
  // with a carrier error that says nothing about why. Falling back to a random one is the same
  // outcome they would have got by choosing "any", rather than a dead end.
  const chosen =
    (preferredNumber && available.find((n) => n.number === preferredNumber)?.number) ??
    // Random rather than available[0]: the first entry is the same number for every business that
    // asks at the same moment, so concurrent orders would all contend for it.
    available[Math.floor(Math.random() * available.length)].number;

  // Zadarma can allocate a different number from the one requested, so everything downstream uses
  // what came back.
  const allocated = await orderNumber(DEFAULT_DIRECTION_ID, chosen);
  const e164 = allocated.startsWith("+") ? allocated : `+${allocated}`;

  await prisma.business.update({ where: { id: businessId }, data: { voicePhoneNumber: allocated } });

  // Both halves, in this order. Either alone is a number that does not ring while looking configured:
  // Cartesia must hold the number before the carrier sends a call to it, or the call arrives matching
  // no imported number and is dropped before any record of it exists.
  await assignNumberToAgent(e164, { label: businessName });
  await pointNumberAtCartesia(e164);

  return allocated;
}

/**
 * A trial asked for a number. Recorded and sent to the operator rather than refused outright —
 * "no" with no path forward is not an answer, and this is exactly the moment a trial is worth
 * converting.
 */
async function requestOperatorApproval(
  business: {
    id: string;
    name: string;
    email: string;
    subscriptionStatus: string;
    subscriptionPlan: string | null;
  },
  preferredNumber?: string
): Promise<void> {
  try {
    await sendAdminAlertEmail(
      `Number request — ${business.name} (${business.subscriptionStatus})`,
      `
        <h2>${business.name} asked for a phone number</h2>
        <ul>
          <li>Business id: <code>${business.id}</code></li>
          <li>Email: ${business.email}</li>
          <li>Subscription: <strong>${business.subscriptionStatus}</strong>${business.subscriptionPlan ? ` (${business.subscriptionPlan})` : ""}</li>
          ${preferredNumber ? `<li>They picked: <strong>${preferredNumber}</strong></li>` : "<li>No preference — any number.</li>"}
        </ul>
        <p>They are not on a paying plan, so nothing was ordered. To order one for them, run the
        <code>resubmit</code>-style number workflow, or ask them to subscribe first.</p>
      `
    );
  } catch (err) {
    // The caller is told an approval was requested. If the email is the thing that failed, that
    // sentence becomes untrue silently — so it is reported even though it does not change the flow.
    console.error(`[provisioning] Could not email the number request for ${business.id}:`, err);
    captureError(err, { businessId: business.id, phase: "number_request_email" });
  }
}
