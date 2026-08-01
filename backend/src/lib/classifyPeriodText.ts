import { getAiProvider } from "../bot/providers/index.js";
import { PERIOD_KINDS, PERIOD_KIND_LABELS, isPeriodKind, type PeriodKind } from "./hebrewPeriods.js";

/**
 * Fallback for when keyword matching doesn't recognise how the owner phrased a period.
 *
 * The model's only job is to pick names out of a fixed list — it never produces a date. Whatever it
 * returns is filtered against the catalogue, so a hallucinated name is dropped rather than becoming
 * a period with invented dates. Worst case the owner sees "couldn't work that out" and enters the
 * dates by hand, which is strictly better than a confidently wrong calendar.
 *
 * Always runs on Anthropic regardless of the business's chosen bot provider: this is an internal
 * dashboard helper, not a customer-facing reply, and it shouldn't break because a business switched
 * its bot to a provider whose key isn't configured.
 */
export async function classifyPeriodText(text: string): Promise<PeriodKind[]> {
  const provider = getAiProvider("anthropic");
  const catalogue = PERIOD_KINDS.map((k) => `${k} = ${PERIOD_KIND_LABELS[k]}`).join("\n");

  const system = {
    stable: `אתה מסווג טקסט לתקופות בלוח השנה העברי.

בעל עסק כותב מתי הוא רוצה שתנאי השירות שלו ישתנו. תפקידך: לבחור מהרשימה הסגורה שלמטה אילו תקופות הוא מתכוון אליהן.

הרשימה הסגורה:
${catalogue}

כללים:
• החזר אך ורק JSON במבנה {"kinds": ["..."]} — בלי טקסט נוסף, בלי הסברים.
• מותר להחזיר רק מזהים מהרשימה למעלה, בדיוק כפי שהם כתובים.
• אם אתה לא בטוח, או שהטקסט לא מתאר אף תקופה מהרשימה — החזר {"kinds": []}. עדיף ריק מאשר ניחוש.
• אל תמציא תאריכים. אתה בוחר שמות בלבד.`,
    volatile: "",
  };

  const res = await provider.send({
    model: provider.resolveModel("cheap", undefined),
    system,
    tools: [],
    turns: [{ role: "user", text }],
  });

  // The model was told to answer with bare JSON, but a stray sentence around it is a classic
  // failure — pull the object out rather than throwing away an otherwise-good answer.
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { kinds?: unknown };
    if (!Array.isArray(parsed.kinds)) return [];
    return parsed.kinds.filter(isPeriodKind).slice(0, 6);
  } catch {
    return [];
  }
}
