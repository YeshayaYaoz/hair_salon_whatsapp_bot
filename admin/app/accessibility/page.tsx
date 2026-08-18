import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

/**
 * הצהרת נגישות — a legal requirement, not a nicety.
 *
 * Regulation 35 of the Equal Rights for Persons with Disabilities (Service Accessibility)
 * Regulations, 2013 requires every business website in Israel to publish an accessibility
 * statement, and requires the site itself to conform to IS 5568 (the Israeli standard, which
 * tracks WCAG 2.0 level AA). The statement obligation applies even to businesses that are exempt
 * from the conformance obligation on turnover grounds. A person who finds a site inaccessible can
 * sue for statutory damages without proving loss.
 *
 * Tori sells to Israeli businesses and had no such page at all. Two exposures, not one: our own,
 * and the impression it leaves on an owner evaluating whether we understand their regulatory
 * world.
 *
 * The known-limitations section is deliberately specific. A statement that claims flawless
 * conformance is both implausible and worse legally than one that names what is outstanding and
 * commits to a remedy — courts and the Commission both read candour favourably.
 */

const COORDINATOR_EMAIL = "y28112000@gmail.com";
const LAST_UPDATED_HE = "18 באוגוסט 2026";
const LAST_UPDATED_EN = "August 18, 2026";

const SECTIONS = [
  { id: "commitment", title: "המחויבות שלנו" },
  { id: "standard", title: "התקן שאנחנו עומדים בו" },
  { id: "measures", title: "מה הונגש באתר" },
  { id: "limitations", title: "מגבלות ידועות" },
  { id: "booking-pages", title: "דפי הזמנת התורים של העסקים" },
  { id: "coordinator", title: "רכז הנגישות" },
  { id: "feedback", title: "נתקלתם בבעיה?" },
  { id: "english", title: "English summary" },
];

export const metadata: Metadata = {
  title: "הצהרת נגישות",
  description:
    "הצהרת הנגישות של תורי — עמידה בתקן הישראלי ת\"י 5568 ברמה AA, פירוט ההנגשות שבוצעו, מגבלות ידועות ודרכי פנייה לרכז הנגישות.",
  alternates: { canonical: "https://torionline.com/accessibility" },
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-10">
      <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h2>
      <div className="text-[15px] text-gray-600 leading-relaxed flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen bg-[#F4F6F8]" dir="rtl">
      <header className="bg-[#0D2A38] px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/tori_logo_transparent.png" alt="תורי" width={30} height={30} className="rounded-lg" />
            <span className="font-bold text-white text-base">תורי · Tori</span>
          </Link>
          <Link href="/" className="text-xs text-white/60 hover:text-white transition">חזרה לדף הבית →</Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[220px_1fr] gap-10">
        <nav className="hidden md:block sticky top-10 self-start">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-3">בעמוד הזה</p>
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block text-xs text-gray-600 hover:text-[#145F78] py-1.5 transition leading-snug">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/privacy" className="block text-xs text-[#145F78] hover:underline mt-4 pt-4 border-t border-gray-100">
            מדיניות פרטיות →
          </Link>
        </nav>

        <main className="bg-white border border-gray-200 rounded-2xl px-6 py-8 sm:px-10 sm:py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">הצהרת נגישות</h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#1B7FA0]/10 text-[#145F78] border border-[#1B7FA0]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1B7FA0]" />
                עודכן לאחרונה: {LAST_UPDATED_HE}
              </span>
            </div>
          </div>

          <Section id="commitment" title="המחויבות שלנו">
            <p>
              תורי (torionline.com) היא מערכת לקביעת תורים דרך וואטסאפ ובשיחות טלפון. אנחנו רואים בנגישות
              חלק מהמוצר עצמו ולא תוספת: אם בעל עסק או לקוח שלו לא מצליחים להשתמש במערכת, המערכת לא עשתה
              את העבודה שלה.
            </p>
            <p>
              אנחנו פועלים להנגיש את האתר והמערכת בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ״ח–1998,
              ולתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג–2013.
            </p>
          </Section>

          <Section id="standard" title="התקן שאנחנו עומדים בו">
            <p>
              האתר מונגש בהתאם ל<strong>תקן הישראלי ת״י 5568</strong> ברמת התאמה <strong>AA</strong>,
              המבוסס על הנחיות <span dir="ltr">WCAG 2.0</span> של ארגון <span dir="ltr">W3C</span>.
            </p>
            <p>
              ההנגשה נבדקת מול הקריטריונים של התקן בכל שינוי משמעותי בממשק, לרבות בדיקות ניגודיות
              צבעים אוטומטיות ובדיקות ניווט במקלדת.
            </p>
          </Section>

          <Section id="measures" title="מה הונגש באתר">
            <ul className="list-disc ps-5 flex flex-col gap-2">
              <li><strong>ניווט מלא במקלדת</strong> — כל הקישורים, הכפתורים והטפסים ניתנים להפעלה בעזרת מקלדת בלבד, עם סימון מיקוד (focus) ברור ונראה בכל רכיב.</li>
              <li><strong>ניגודיות צבעים</strong> — הטקסטים באתר עומדים ביחס ניגודיות של 4.5:1 לפחות מול הרקע, כנדרש ברמה AA.</li>
              <li><strong>מבנה כותרות סמנטי</strong> — הדפים בנויים בהיררכיית כותרות תקינה, כדי שקורא מסך יוכל לנווט ביניהן.</li>
              <li><strong>טקסט חלופי</strong> — לתמונות בעלות משמעות יש טקסט חלופי; אלמנטים דקורטיביים מסומנים כך שקורא מסך ידלג עליהם.</li>
              <li><strong>תוויות בטפסים</strong> — לכל שדה קלט יש תווית מקושרת, והודעות שגיאה מוצגות בטקסט ולא בצבע בלבד.</li>
              <li><strong>הפחתת אנימציות</strong> — האתר מכבד את הגדרת מערכת ההפעלה <span dir="ltr">prefers-reduced-motion</span> ומבטל אנימציות עבור משתמשים שביקשו זאת.</li>
              <li><strong>אזורי מגע מוגדלים</strong> — במכשירי מגע, לחצני פעולה מוגדלים לגודל המאפשר הפעלה נוחה באצבע.</li>
              <li><strong>תמיכה בהגדלת טקסט</strong> — ניתן להגדיל את הטקסט בדפדפן עד 200% בלי אובדן תוכן או תפקוד.</li>
            </ul>
          </Section>

          <Section id="limitations" title="מגבלות ידועות">
            <p>
              למרות מאמצינו, ייתכנו באתר חלקים שטרם הונגשו במלואם. אנחנו פועלים לתקן אותם באופן שוטף.
              נכון לתאריך העדכון של הצהרה זו, אלה החלקים שאנחנו מודעים אליהם:
            </p>
            <ul className="list-disc ps-5 flex flex-col gap-2">
              <li>
                תוכן שמקורו בצד שלישי — למשל דפי הסליקה של ספקי התשלומים ומסכי ההתחברות של Google —
                אינו בשליטתנו, ורמת הנגישות בו נקבעת על ידי אותם ספקים.
              </li>
              <li>
                חלק ממסכי הניתוח והדוחות בלוח הבקרה מציגים נתונים בגרפים. לכל גרף קיים גם מידע מספרי
                בטקסט, אך ייתכן שהגרף עצמו לא ייקרא במלואו על ידי קורא מסך.
              </li>
              <li>
                שינויי מצב מסוימים בלוח הבקרה (למשל אישור שמירה) מוצגים חזותית, ואנחנו בתהליך הוספת
                הכרזה קולית עבורם לקוראי מסך.
              </li>
            </ul>
            <p>
              אם נתקלתם ברכיב שאינו נגיש — גם כזה שאינו מופיע ברשימה — נשמח מאוד לשמוע. פנייה כזו היא
              הדרך המהירה ביותר שלנו לתקן.
            </p>
          </Section>

          <Section id="booking-pages" title="דפי הזמנת התורים של העסקים">
            <p>
              לכל עסק שמשתמש בתורי יש דף הזמנת תורים ציבורי משלו בכתובת{" "}
              <span dir="ltr" className="font-mono text-[13px]">torionline.com/book/…</span>. הדפים האלה
              נבנים על ידי המערכת שלנו ומקבלים את אותן התאמות נגישות המפורטות למעלה.
            </p>
            <p>
              חשוב לדעת: האחריות החוקית לנגישות שירות מקוון חלה על העסק שנותן את השירות. אנחנו מספקים
              את התשתית הנגישה, אך על כל עסק לפרסם הצהרת נגישות משלו ולמנות רכז נגישות בהתאם לתקנות.
            </p>
          </Section>

          <Section id="coordinator" title="רכז הנגישות">
            <p>לפניות בנושא נגישות באתר או בשירות ניתן ליצור קשר עם רכז הנגישות שלנו:</p>
            <div className="bg-[#F4F6F8] border border-gray-200 rounded-xl px-5 py-4 flex flex-col gap-1.5">
              <p className="text-sm">
                <span className="text-gray-600">דוא״ל: </span>
                <a href={`mailto:${COORDINATOR_EMAIL}`} dir="ltr" className="text-[#197492] underline underline-offset-2 font-medium">
                  {COORDINATOR_EMAIL}
                </a>
              </p>
              <p className="text-sm text-gray-600">
                נשתדל להשיב לכל פנייה בנושא נגישות בתוך <strong className="text-gray-900">5 ימי עסקים</strong>.
              </p>
            </div>
          </Section>

          <Section id="feedback" title="נתקלתם בבעיה?">
            <p>
              אם נתקלתם בקושי כלשהו בשימוש באתר, נודה לכם אם תכתבו לנו ותכללו את הפרטים הבאים — הם עוזרים
              לנו לשחזר את הבעיה ולתקן אותה מהר:
            </p>
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li>כתובת העמוד שבו נתקלתם בבעיה</li>
              <li>תיאור קצר של מה שניסיתם לעשות ומה קרה בפועל</li>
              <li>הדפדפן ומערכת ההפעלה שבהם השתמשתם</li>
              <li>אם השתמשתם בטכנולוגיה מסייעת (קורא מסך, הגדלה וכד׳) — איזו</li>
            </ul>
          </Section>

          <Section id="english" title="English summary">
            <div dir="ltr" className="text-start flex flex-col gap-3">
              <p>
                Tori (torionline.com) is committed to making its website and product usable by everyone.
                We aim to conform to <strong>Israeli Standard IS 5568 at level AA</strong>, which is based
                on the W3C&apos;s WCAG 2.0 guidelines, as required by Israel&apos;s Equal Rights for Persons
                with Disabilities Regulations (2013).
              </p>
              <p>
                Implemented measures include full keyboard navigation with visible focus indicators, a
                minimum 4.5:1 text contrast ratio, semantic heading structure, alternative text for
                meaningful images, labelled form fields with non-colour error messaging, respect for the
                <span className="font-mono text-[13px]"> prefers-reduced-motion </span> setting, and enlarged
                touch targets on coarse pointers.
              </p>
              <p>
                Known limitations: third-party content (payment provider checkout pages, Google sign-in) is
                outside our control; some dashboard charts are not yet fully described to screen readers,
                though the same figures are available as text; and announcements for certain asynchronous
                state changes are still being added.
              </p>
              <p>
                Accessibility coordinator:{" "}
                <a href={`mailto:${COORDINATOR_EMAIL}`} className="text-[#197492] underline underline-offset-2 font-medium">
                  {COORDINATOR_EMAIL}
                </a>
                . We aim to respond to accessibility enquiries within 5 business days. Last updated{" "}
                {LAST_UPDATED_EN}.
              </p>
            </div>
          </Section>

          <div className="pt-6 border-t border-gray-100 flex flex-wrap gap-4 text-xs">
            <Link href="/" className="text-[#145F78] hover:underline">דף הבית</Link>
            <Link href="/privacy" className="text-[#145F78] hover:underline">מדיניות פרטיות</Link>
            <Link href="/terms" className="text-[#145F78] hover:underline">תנאי שימוש</Link>
          </div>
        </main>
      </div>
    </div>
  );
}
