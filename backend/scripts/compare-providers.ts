/**
 * Side-by-side Hebrew quality + cost comparison across AI providers.
 *
 * Purpose: the bot's Hebrew quality is a model-capability question that cannot be settled by
 * reading code — it has to be observed. This runs the SAME realistic Hebrew booking conversation
 * through each configured provider and prints the replies together, so the difference is a
 * judgement you make on real output rather than on vendor claims.
 *
 * Usage (from backend/):
 *   DEEPSEEK_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/compare-providers.ts
 *
 * Only providers whose API key is present are run; the rest are skipped with a note. No database
 * and no real business are involved — the system prompt below is a self-contained stand-in shaped
 * like a real B&B prompt, so this is safe to run against production keys.
 */

import { getAiProvider, AI_PROVIDER_KEYS, type GenericTool, type GenericTurn } from "../src/bot/providers/index.js";

const API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

// Shaped like the real inquiry-mode (B&B) prompt: Hebrew rules + a unit list with prices. Kept
// self-contained so the script needs no DB, but long enough to be a fair test of Hebrew fluency.
const SYSTEM = {
  stable: `אתה עוזר ההזמנות של "צימר הרי הגליל" בוואטסאפ.
ענה תמיד בשפה שבה הלקוח כותב. היה ידידותי, קצר וממוקד — משפט-שניים לכל תגובה.
כשאתה מתייחס לעצמך, כתוב תמיד בלשון זכר יחיד ("אני מצטער", לא "מצטערים").
אל תשתמש בצורות עם לוכסן ("בעל/ת"). כתוב עברית פשוטה וטבעית כמו שבן אדם כותב בוואטסאפ.
כלל חשוב: השתמש רק במילים עבריות אמיתיות וקיימות. אל תמציא הטיות. אם אתה לא בטוח איך נוטה מילה — בחר ניסוח פשוט יותר.

יחידות ומחירים:
• תמר — עד 10 אורחים, 4 חדרי שינה, מרפסת נוף גדולה: ₪1700 ללילה
• גפן — עד 8 אורחים, 3 חדרי שינה, מרפסת נוף, חצר ירוקה: ₪1700 ללילה
• תאנה — עד 3 אורחים (צימר זוגי + ילד): ₪900 ללילה

אופן הפעולה: עסק זה אינו קובע הזמנות בזמן אמת. מסור מידע, וכשלקוח רוצה להזמין — אסוף פרטים וקרא ל-request_booking_callback.`,
  volatile: `היום: 2026-07-29 (יום רביעי), השעה כעת: 16:48 (שעון ישראל).`,
};

const TOOLS: GenericTool[] = [
  {
    name: "request_booking_callback",
    description:
      "Use when the customer wants to book and this business handles bookings by callback. Collect the details you have; the owner is alerted to call back. Do NOT claim the booking is confirmed.",
    input_schema: {
      type: "object",
      properties: {
        details: { type: "string", description: "Dates/nights, unit, number of guests, preferences." },
        customerName: { type: "string", description: "Customer's name if known" },
      },
      required: ["details"],
    },
  },
];

// A real conversation shape, including the exact turn that previously produced invented Hebrew
// ("משתניים" instead of "מהשתיים") — a family too large for the small unit, forcing the model to
// compare two options in fluent Hebrew.
const CONVERSATION = [
  "היי, יש מקום פנוי לסוף השבוע הקרוב?",
  "אנחנו 2 מבוגרים ו-5 ילדים. חשבתי על תאנה",
  "כמה זה יוצא לשני לילות? ואפשר לראות תמונות?",
];

async function runProvider(key: string) {
  const envVar = API_KEY_ENV[key];
  if (!process.env[envVar]) {
    console.log(`\n${"=".repeat(70)}\n${key.toUpperCase()} — skipped (${envVar} not set)\n${"=".repeat(70)}`);
    return;
  }

  const provider = getAiProvider(key);
  const model = provider.resolveModel("smart", null);
  console.log(`\n${"=".repeat(70)}\n${key.toUpperCase()}  (model: ${model})\n${"=".repeat(70)}`);

  const turns: GenericTurn[] = [];
  let totalIn = 0;
  let totalOut = 0;
  const started = Date.now();

  for (const userMessage of CONVERSATION) {
    turns.push({ role: "user", text: userMessage });
    console.log(`\n  לקוח:  ${userMessage}`);

    try {
      let res = await provider.send({ model, system: SYSTEM, tools: TOOLS, turns });
      totalIn += res.usage.inputTokens;
      totalOut += res.usage.outputTokens;

      // Resolve one round of tool calls with a canned result, so we see how the model phrases the
      // follow-up in Hebrew — that reply is where the invented-word failures showed up.
      if (res.stopReason === "tool_use") {
        console.log(`  [tool] ${res.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(", ")}`);
        turns.push({ role: "assistant", text: res.text || undefined, toolCalls: res.toolCalls });
        turns.push({
          role: "user",
          toolResults: res.toolCalls.map((t) => ({
            toolCallId: t.id,
            content: JSON.stringify({ notified: true, tellCustomer: "בעל העסק יחזור אליך בהקדם לאישור סופי." }),
          })),
        });
        res = await provider.send({ model, system: SYSTEM, tools: TOOLS, turns });
        totalIn += res.usage.inputTokens;
        totalOut += res.usage.outputTokens;
      }

      console.log(`  בוט:   ${res.text.replace(/\n/g, "\n         ")}`);
      turns.push({ role: "assistant", text: res.text });
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  --- ${totalIn} input tok, ${totalOut} output tok, ${secs}s total ---`);
}

async function main() {
  console.log("Hebrew quality comparison — identical conversation through each provider.");
  console.log("Read the replies for: invented words, wrong gender agreement, stilted/translated phrasing.");
  for (const key of AI_PROVIDER_KEYS) await runProvider(key);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
