import Link from "next/link";
import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * A salon's own accessibility statement, generated for its booking page.
 *
 * Why this exists as a product feature rather than a legal chore: under regulation 35 of the Equal
 * Rights for Persons with Disabilities (Service Accessibility) Regulations, 2013, the duty to
 * publish an accessibility statement falls on whoever provides the service — the salon — not on
 * the platform hosting the page. Practically every salon using Tori therefore has an obligation it
 * almost certainly does not know about, carrying statutory damages of up to NIS 50,000 that a
 * claimant does not have to prove any loss to collect.
 *
 * We are the ones who know which accessibility measures this page actually implements, so we are
 * the only party who can write this statement accurately. Generating it costs one template and
 * gives every salon something no competing Israeli booking product ships.
 *
 * The statement is scoped honestly. It covers the booking page and says so: it does not claim
 * anything about the salon's physical premises, its other website, or its social channels, because
 * we know nothing about those and a statement that overreaches is worse than a narrow one.
 */

interface BusinessInfo {
  name: string;
  address?: string;
  accessibilityContact?: string | null;
}

async function fetchBusiness(businessId: string): Promise<BusinessInfo | null> {
  try {
    const res = await fetch(`${API}/api/public/${businessId}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = (await res.json()) as BusinessInfo;
    return data?.name ? data : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;
  const business = await fetchBusiness(businessId);
  const title = business ? `הצהרת נגישות — ${business.name}` : "הצהרת נגישות";
  return {
    title,
    description: "הצהרת נגישות לדף קביעת התורים, לפי תקן ישראלי ת\"י 5568 ברמה AA.",
    robots: { index: false, follow: false },
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-bold text-gray-900 mb-2.5 pb-2 border-b border-gray-100">{title}</h2>
      <div className="text-sm text-gray-600 leading-relaxed flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export default async function BusinessAccessibilityStatement({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const business = await fetchBusiness(businessId);

  if (!business) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4" dir="rtl">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-sm w-full">
          <p className="text-gray-600 text-sm">הקישור הזה כבר לא פעיל.</p>
        </div>
      </main>
    );
  }

  const contact = business.accessibilityContact?.trim();

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl px-6 py-8 sm:px-9 sm:py-9">
          <div className="mb-7">
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight mb-1.5">
              הצהרת נגישות
            </h1>
            <p className="text-sm text-gray-600">
              {business.name}
              {business.address ? ` · ${business.address}` : ""}
            </p>
          </div>

          <Section title="על מה ההצהרה הזאת חלה">
            <p>
              ההצהרה מתייחסת ל<strong>דף קביעת התורים המקוון</strong> של {business.name}, המופעל
              באמצעות מערכת תורי. היא אינה מתייחסת לנגישות המקום הפיזי של העסק, לאתרים אחרים שלו או
              לעמודי הרשתות החברתיות שלו.
            </p>
          </Section>

          <Section title="רמת הנגישות">
            <p>
              דף קביעת התורים מונגש בהתאם ל<strong>תקן הישראלי ת״י 5568</strong> ברמת התאמה{" "}
              <strong>AA</strong>, המבוסס על הנחיות <span dir="ltr">WCAG 2.0</span>.
            </p>
          </Section>

          <Section title="ההתאמות שבוצעו בדף">
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li>ניתן להשלים את כל תהליך קביעת התור באמצעות מקלדת בלבד, עם סימון מיקוד נראה בכל שלב.</li>
              <li>הטקסטים בדף עומדים ביחס ניגודיות של 4.5:1 לפחות מול הרקע.</li>
              <li>לכל שדה בטופס יש תווית מקושרת, והודעות שגיאה מוצגות בטקסט ולא בצבע בלבד.</li>
              <li>מחוון ההתקדמות מסמן את השלב הנוכחי גם בטקסט ולא רק בצבע.</li>
              <li>הדף מכבד בקשת מערכת ההפעלה להפחתת אנימציות.</li>
              <li>אזורי הלחיצה מותאמים לשימוש באצבע במכשירי מגע.</li>
              <li>ניתן להגדיל את הטקסט בדפדפן עד 200% בלי אובדן תוכן או תפקוד.</li>
              <li>הדף נתמך בקוראי מסך נפוצים ומוצג בעברית בכיוון מימין לשמאל.</li>
            </ul>
          </Section>

          <Section title="מגבלות ידועות">
            <p>
              אם העסק גובה מקדמה על תור, התשלום עצמו מתבצע בדף של חברת הסליקה. הדף הזה אינו בשליטת
              העסק או של תורי, ורמת הנגישות בו נקבעת על ידי אותה חברה.
            </p>
          </Section>

          <Section title="יצירת קשר בנושא נגישות">
            {contact ? (
              <>
                <p>אם נתקלתם בקושי בשימוש בדף, אפשר לפנות אלינו:</p>
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-sm text-gray-900 font-medium break-words">{contact}</p>
                </div>
                <p className="text-xs text-gray-500">
                  כדי שנוכל לעזור מהר, כדאי לציין באיזה שלב נתקלתם בקושי ובאיזה דפדפן או טכנולוגיה
                  מסייעת השתמשתם.
                </p>
              </>
            ) : (
              /* No invented contact. An accessibility statement whose contact goes nowhere is
                 worse than one that says plainly where to turn — and the owner is prompted in
                 their dashboard to publish a real one here. */
              <p>
                אם נתקלתם בקושי בשימוש בדף, אפשר לפנות ישירות ל{business.name} בכל אחת מדרכי
                ההתקשרות הרגילות של העסק, ולציין שמדובר בפנייה בנושא נגישות.
              </p>
            )}
          </Section>

          <div className="pt-5 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
            <Link href={`/book/${businessId}`} className="text-[#197492] text-sm hover:underline">
              → חזרה לקביעת תור
            </Link>
            <span className="text-[11px] text-gray-500">
              הדף מופעל על ידי{" "}
              <a href="https://torionline.com/accessibility" className="text-gray-600 hover:underline">
                תורי
              </a>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
