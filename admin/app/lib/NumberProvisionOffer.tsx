"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

/**
 * "Get the business a phone number" — offered wherever the lack of one is blocking something.
 *
 * It appears in two places because a missing number blocks two different things, and an owner
 * hits whichever wall comes first:
 *
 *   - WhatsApp (context "whatsapp"): the WhatsApp Business API registers *a phone number*. A
 *     business that has no line at all cannot start the connection — the flow that everything else
 *     on this dashboard depends on. Offering the number only on the voice-bot screen meant the one
 *     customer who is truly stuck had to find a Premium-flavoured setting to get unstuck.
 *   - Voice (context "voice"): a business that already has WhatsApp but wants a separate line the
 *     bot answers by phone.
 *
 * One component, one endpoint, one set of rules — a second implementation would drift, and the
 * half that drifts is always the copy about money.
 *
 * The server decides who may order (paying = immediately, trial = operator approval). `paying`
 * here shapes the wording only; duplicating the entitlement rule in the client would give it two
 * homes and one of them would go stale.
 */
export function NumberProvisionOffer({
  context,
  onProvisioned,
}: {
  context: "whatsapp" | "voice";
  /** The page's own state may need to update — e.g. the voice screen shows the number in a field. */
  onProvisioned?: (number: string) => void;
}) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [loaded, setLoaded] = useState(false);
  const [paying, setPaying] = useState(false);
  // Whether Tori has ever ordered a number for this business — NOT whether a number field holds a
  // value. Connecting WhatsApp copies the WhatsApp number into voicePhoneNumber automatically, so
  // gating on "is the field empty" hid this from every business that finished onboarding. This
  // column is written only by an actual order.
  const [hasOrdered, setHasOrdered] = useState(true); // assume yes until loaded: never offer on a guess
  const [ordering, setOrdering] = useState(false);
  const [requested, setRequested] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picker opens closed. Most owners do not care which digits they get, and a list of a dozen
  // near-identical numbers presented up front is a decision where none was needed.
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null); // null = not fetched yet
  const [chosen, setChosen] = useState<string | null>(null); // null = any / choose for me

  useEffect(() => {
    apiFetch<{ subscriptionStatus?: string; voiceNumberOrderedAt?: string | null }>("/api/business/me")
      .then((me) => {
        setPaying(me.subscriptionStatus === "active");
        setHasOrdered(Boolean(me.voiceNumberOrderedAt));
        setLoaded(true);
      })
      // Silent: this is an offer, not information the page owes anyone. A failed load simply means
      // it is not shown, which is the safe direction for something that spends money.
      .catch(() => {});
  }, []);

  async function openPicker() {
    setPicking(true);
    if (choices !== null) return;
    try {
      const r = await apiFetch<{ numbers: { number: string }[] }>("/api/business/me/voice-phone/available");
      setChoices(r.numbers.map((n) => n.number));
    } catch {
      // An empty list is not a failure of the feature: ordering without a preference still works,
      // and the button below says so.
      setChoices([]);
    }
  }

  async function provision() {
    // A number is a recurring monthly charge, so the click that starts one is confirmed. The
    // confirm text names the cost rather than asking "are you sure", which tells nobody anything.
    const confirmText = he
      ? chosen
        ? `להנפיק את המספר +${chosen} לעסק? המספר כרוך בתשלום חודשי.`
        : "להנפיק מספר טלפון חדש לעסק? המספר כרוך בתשלום חודשי."
      : chosen
        ? `Get +${chosen} for the business? It carries a monthly charge.`
        : "Get a new phone number for the business? It carries a monthly charge.";
    if (paying && !window.confirm(confirmText)) return;

    setOrdering(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ status: string; number?: string; message?: string }>(
        "/api/business/me/voice-phone/provision",
        { method: "POST", body: JSON.stringify(chosen ? { number: chosen } : {}) }
      );
      if (result.status === "ordered" && result.number) {
        const shown = result.number.startsWith("+") ? result.number : `+${result.number}`;
        setHasOrdered(true);
        onProvisioned?.(result.number);
        setNotice(
          he
            ? `המספר ${shown} שלכם. אנחנו מחברים אותו לוואטסאפ בשבילכם — זה לוקח כמה דקות, אין צורך לעשות כלום. עמוד הוואטסאפ יראה את ההתקדמות.`
            : `${shown} is yours. We're connecting it to WhatsApp for you — it takes a few minutes and needs nothing from you. The WhatsApp page shows the progress.`
        );
        return;
      }
      setNotice(result.message ?? (he ? "הבקשה נשלחה." : "Request sent."));
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "ההנפקה נכשלה" : "Could not get a number");
    } finally {
      setOrdering(false);
    }
  }

  // Nothing to offer a business that already had a number bought for it — and nothing at all until
  // we know, so the offer never flashes on screen and then disappears.
  if (!loaded || hasOrdered) {
    return notice ? <p className="text-green-700 text-xs mt-2">{notice}</p> : null;
  }

  const explanation =
    context === "whatsapp"
      ? he
        ? "כדי לחבר וואטסאפ עסקי צריך מספר טלפון שרשום על העסק — וואטסאפ שולחת אליו קוד אימות. אין לכם מספר פנוי? נוכל להנפיק לכם אחד, והוא ישמש גם לוואטסאפ וגם למענה לשיחות."
        : "Connecting WhatsApp Business needs a phone number in the business's name — WhatsApp sends a verification code to it. No spare line? We can issue one, and it serves both WhatsApp and incoming calls."
      : he
        ? "רוצים קו טלפון ייעודי שעונה רק לשיחות? אפשר להנפיק אחד — הוא יחובר לבוט אוטומטית."
        : "Want a dedicated line that only takes calls? We can issue one and connect it to the bot automatically.";

  const approvalNote = he
    ? "עם מנוי פעיל המספר מונפק מיד. בתקופת ניסיון הבקשה עוברת לאישור שלנו וניצור איתכם קשר."
    : "With an active subscription the number is issued immediately. On a trial the request goes to us for approval and we'll be in touch.";

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-xs text-gray-600 mb-1.5 leading-relaxed max-w-md">{explanation}</p>
      {!paying && <p className="text-xs text-gray-600 mb-2 leading-relaxed max-w-md">{approvalNote}</p>}
      {picking && (
        <div className="mb-3">
          {choices === null ? (
            <p className="text-xs text-gray-600">{he ? "טוען מספרים פנויים…" : "Loading available numbers…"}</p>
          ) : choices.length === 0 ? (
            <p className="text-xs text-gray-600">
              {he
                ? "אין כרגע רשימה להצגה — נבחר עבורכם מספר פנוי."
                : "No list to show right now — we'll pick an available number for you."}
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-gray-700 mb-1.5">{he ? "בחרו מספר:" : "Pick a number:"}</p>
              <div className="flex flex-wrap gap-1.5">
                {/* "Any" is a real option and stays selectable, so choosing to look at the list is
                    not a commitment to picking from it. */}
                <button
                  type="button"
                  onClick={() => setChosen(null)}
                  aria-pressed={chosen === null}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                    chosen === null
                      ? "bg-[#1B7FA0] text-white border-[#1B7FA0]"
                      : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {he ? "שיבחרו בשבילי" : "Choose for me"}
                </button>
                {choices.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setChosen(n)}
                    aria-pressed={chosen === n}
                    dir="ltr"
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border tabular-nums transition ${
                      chosen === n
                        ? "bg-[#1B7FA0] text-white border-[#1B7FA0]"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={provision}
          disabled={ordering || requested}
          className="bg-white border border-[#1B7FA0] text-[#1B7FA0] hover:bg-[#1B7FA0] hover:text-white disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          {ordering
            ? he ? "מנפיק…" : "Getting a number…"
            : chosen
              ? he ? `קחו את +${chosen}` : `Take +${chosen}`
              : paying
                ? he ? "הנפיקו לי מספר" : "Get me a number"
                : he ? "בקשו מספר" : "Request a number"}
        </button>
        {!picking && (
          <button
            type="button"
            onClick={openPicker}
            disabled={ordering || requested}
            className="text-xs text-[#197492] hover:underline disabled:opacity-50 font-medium"
          >
            {he ? "לבחור מספר מרשימה" : "Pick from a list"}
          </button>
        )}
      </div>
      {notice && <p className="text-green-700 text-xs mt-2">{notice}</p>}
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  );
}
