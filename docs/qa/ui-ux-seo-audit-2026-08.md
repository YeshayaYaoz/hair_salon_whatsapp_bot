# UI / UX / SEO audit — August 2026

A design and growth review of the whole product surface, grounded in current research on
conversion, engagement, accessibility law and search. Companion to
[`ui-qa-sweep-2026-07.md`](./ui-qa-sweep-2026-07.md), which covered layout and contrast defects;
this one covers *persuasion, credibility, structure and discoverability*.

Scope: `admin/app` — the marketing pages (`/`, `/en`), the auth surface (`/login`), the salon's
public booking page (`/book/[businessId]`), and the 17 dashboard pages. Roughly 16,000 lines of UI.

---

## The headline finding

**The product tells the truth in the place that is hardest to check, and invents numbers in the
place where trust is actually being decided.**

The Hebrew landing page had already, deliberately, removed its invented testimonials. The code
comment is unambiguous:

> *invented testimonials are both a legal exposure and the fastest way for a visitor to write the
> whole page off*

Its live social-proof line only renders once the real business count reaches 10, with a comment
explaining that padding it with an invented baseline "made every visible number a claim we couldn't
stand behind." The hero notification toast is labelled **הדגמה**, not "live," for the same reason.

That standard was applied to exactly one file. Meanwhile:

| Where | Claim | Reality |
| --- | --- | --- |
| `/login` left panel | **+2,400** עסקים פעילים | Invented |
| `/login` left panel | **98%** שיעור מענה | Invented |
| `/login` left panel | **4.9★** דירוג לקוחות | Invented |
| `/login` testimonial | "שרה לוי, מספרת שרה, תל אביב" — 5 stars, **verification tick** | Invented person |
| `/login` signup subhead | "מצטרפים ל**אלפי עסקים** שכבר עובדים עם תורי" | Invented |
| `jsonLd.ts` | `aggregateRating: 4.9 from 47 reviews` | Invented, served to every crawler |

The login page is the single highest-stakes page in the funnel — it is where someone hands over an
email address. Putting a fabricated five-star review with a verification badge there is the worst
available placement for one. And the JSON-LD rating is worse than merely untrue: Google's
structured-data policy requires a self-serving `AggregateRating` to correspond to reviews **visible
on the same page**. There are none. That makes the rich result ineligible and exposes the domain to
a manual action. The file's own header comment shows Search Console had already flagged the "Review
snippet" — the fix at the time narrowed its *scope* to the marketing pages, but left the
fabrication itself in place.

**Status: fixed.** All six replaced with claims that are checkable against the product itself.

---

## Legal exposure: no accessibility statement

Israel requires this, and it was missing entirely.

- **IS 5568** (ת"י 5568) is the Israeli web accessibility standard, in force since October 2017,
  tracking **WCAG 2.0 level AA**. Anchored in regulation 35 of the Equal Rights for Persons with
  Disabilities (Service Accessibility) Regulations, 2013.
- Businesses above ~₪300,000 annual turnover must **conform**. But **every** business website —
  including ones exempt from conformance on turnover grounds — must **publish an accessibility
  statement** naming the measures taken and an accessibility coordinator's contact details.
- A person who finds a site inaccessible can sue for statutory damages of up to **₪50,000** without
  proving loss.

This cut two ways for Tori. There was our own exposure, and there was the impression left on the
buyer: we sell software *to Israeli businesses*, and shipped no sign of understanding the
regulatory world they operate in.

**Status: fixed.** `/accessibility` now publishes a full statement — standard and conformance
level, eight specific measures implemented, three candidly-named known limitations, coordinator
contact, and an English summary. It is linked from both landing-page footers and listed in the
sitemap (alongside `/privacy` and `/terms`, which were also missing from it).

**Still open, and worth money:** the statement's "דפי הזמנת התורים" section notes that the legal
duty falls on *each salon*, not on us. Every salon using Tori has the same obligation and almost
certainly does not know it. Auto-generating a per-business accessibility statement on their booking
page would be a genuine differentiator — no Israeli booking competitor does this — and it costs us
one template.

---

## Stale pricing on the English page

`/en` was still advertising **$39 / $79** with no Ultra plan at all. The pricing move to
₪189 / ₪449 / ₪849 updated the Hebrew page, the billing page, the admin panel, the JSON-LD offers
and the plan tables — and missed this one file. An English-speaking visitor was being quoted a
price the system would never charge them (₪189 ≈ $50, not $39).

**Status: fixed.** Three plans, quoted in shekels to match `PLAN_PRICES_ILS`, since billing runs
through an Israeli provider and has no USD path at all.

---

## Search and AI visibility

### Section headings were `<div>`s

Both landing pages carried **one `<h1>` and one `<h2>` across roughly ten sections**. Every section
title — "3 צעדים, ואחרי זה הכל קורה לבד", "פשוט. שקוף. ללא הפתעות", the pricing and FAQ headings —
was `<div className="lp-title">`. All the styling lives in the class, so the elements were purely
presentational.

This costs more in 2026 than it used to. A page with no heading outline is harder for a crawler to
segment, harder for a screen reader to navigate, and materially harder for retrieval-based AI
search to quote: research on generative-engine optimisation finds pages with clear structure appear
**30–40% more often** in AI answers, and structured content lifts small-brand appearance rates by
about 36%. With conversational search taking share from ranked lists, being quotable is becoming as
valuable as ranking.

**Status: fixed.** 11 real `<h2>`s per landing page. Zero visual change — the page's own CSS reset
already zeroes heading margins, and the class sets weight and size.

### Booking links previewed as our marketing copy

`/book/[businessId]` is a client component with no metadata, so it inherited the root layout's
title. Every salon that put its booking link in an Instagram bio, a WhatsApp status or a Google
Business Profile was sharing a link that previewed as *"תורי | בוט WhatsApp AI לקביעת תורים
אוטומטית"* — our ad copy, on their link, to a customer who has never heard of us.

**Status: fixed.** A route layout resolves the salon's real name server-side and emits
`קביעת תור — {salon name}` with the address in the description and matching Open Graph tags.
`noindex` is retained deliberately (matching `robots.txt`), because thousands of thin name-and-
service-list pages read to a crawler as doorway pages — but `noindex` does not suppress link
previews, which is exactly the case this serves.

---

## Engagement and conversion

### The savings calculator did not calculate

The nav item says **מחשבון חיסכון**. The heading asks **"כמה תורי חוסך *לך*?"**. The input was
`const AVG_WEEKLY_APPTS = 40` — a constant, with a comment reading "no slider input." It answered
for an average salon and never for the person reading it.

The giveaway: **all the slider CSS was still in the stylesheet, unused** — `.roi-slider`,
`.roi-slider-val`, `.lp-roi-slider-wrap`, `.lp-roi-divider`, thumb styles for both WebKit and
Gecko, and a focus-visible ring. The interaction had been built and then removed.

This is the cheapest engagement win on the page and the one most directly supported by the
research: interactive elements convert at roughly **2× static equivalents**, and a visitor who has
dragged a slider has committed a number about their own business — a much stronger position from
which to read a price than a claim handed to them.

**Status: fixed.** One piece of state, restored slider (5–150 appointments/week, step 5), and every
downstream figure — monthly revenue recovered, hours saved, the ROI multiple — now derives from it
through the existing single-source-of-truth calculation.

### The Ultra button said one thing and did another

`דברו איתנו` → `href="/login"`. The mismatch landed on precisely the buyer least willing to
self-serve: Ultra is the ₪849 plan sold on *personal onboarding*. **Fixed** on both languages — it
now opens a real mail composer with a subject line.

---

## Product surface

### Charges reported via `window.alert()`

Two of them on the billing page, both reporting **money that had already left the customer's card**:

```js
alert(`חויבת ₪${result.proratedChargeIls} עבור יתרת התקופה`);
alert(`הועברת למנוי שנתי. חויבת ₪${result.chargedIls} — בקיזוז ₪${result.creditedIls}…`);
```

An OS dialog is the wrong shape for this. It is unbranded, it vanishes on dismissal with no record,
and a charge notice is exactly the thing an owner wants to re-read, screenshot, or check against a
statement. The code comment conceded the point — *"no dedicated toast system on this page."*

**Status: fixed.** A dismissible in-page banner with `role="status"`, so it also gets announced to
screen readers rather than being a silent visual change.

A third `alert()` on the appointments page reported a failed Google Calendar connection in
**hardcoded English**, on a page a Hebrew owner arrives at by being redirected back from Google.
**Fixed** — bilingual inline error, placed next to the Connect button they need to press again.

### Booking page could not book today

`Array.from({ length: 14 }, (_, i) => i + 1)` — offsets 1 through 14. **Today was not offered.**
The single most common request a salon hears — *"יש מקום היום?"* — was the one thing its booking
page could not do, while the WhatsApp bot answered it fine.

Safe to fix: `findAvailableSlots` already drops any slot starting before `now`, so a day that is
over comes back empty rather than bookable in the past. **Fixed** — offsets 0–13, with today
labelled היום / Today.

### Placeholder contrast regression

The booking form set `placeholder-gray-400` (#9CA3AF, ~2.5:1 — below the 4.5:1 AA needs). A base-
layer rule in `globals.css` had specifically fixed placeholder contrast product-wide, but Tailwind
utilities outrank `@layer base`, so this one page silently opted back out — on the only page a
salon's customers ever see. **Fixed.**

---

## Recommended, not yet done

Ordered by value. None of these are defects; they are the next round.

1. **Per-salon accessibility statements on booking pages.** Described above. Real differentiator,
   real legal value to the customer, one template.
2. **A real testimonial, obtained properly.** Testimonials placed next to a CTA are reported to
   lift B2B SaaS conversion by up to 68%, and pricing pages carrying them convert ~34% better. The
   product now has *no* social proof rather than fake proof, which is the right trade — but the
   honest version is worth actively going and getting. One named salon owner, with written
   permission, beats every invented number that was just removed. Restore the JSON-LD
   `aggregateRating` only once reviews are visible on the page.
3. **INP risk from unthrottled scroll and mousemove handlers.** The landing page writes
   `style.transform` directly on every `mousemove` over a feature card, and calls
   `getBoundingClientRect()` on every scroll tick for the 3D product tilt — both outside
   `requestAnimationFrame`. INP is the most-failed Core Web Vital in 2026 (43% of sites miss the
   200ms threshold), it is a confirmed ranking signal, and it feeds Google Ads Quality Score
   through landing-page experience. Wrapping both in rAF is a contained change.
4. **`aria-live` regions.** There are none anywhere in the app. Every async outcome — saved, error,
   loading — is a silent visual change to a screen-reader user. The billing banner added here is
   the first `role="status"` in the codebase; the `SavedBadge` component used across six pages is
   the natural next one.
5. **Multiple `<h1>`s** on `/dashboard/analytics` (3), `/bot` (2) and `/settings` (2);
   `/dashboard/blocked` has no heading at all.
6. **Trust bar is aimed at the wrong reader.** It lists Railway Cloud and OpenAI. A salon owner
   deciding whether to trust us with their appointment book does not know or care what we deploy
   on; WhatsApp Business API and Google Calendar are the only two entries doing persuasive work.
   Infrastructure vendors belong in the footer, if anywhere.
7. **Booking page shows no availability until a date is picked.** The customer chooses a day, waits,
   and may be told there is nothing — then has to go back. Fetching the range up front and dimming
   closed days would remove a dead end from the flow with the highest abandonment sensitivity in
   the product.

---

## Sources

Research consulted for this audit:

- [Israel Standard IS 5568 accessibility compliance](https://blog.equally.ai/web-accessibility/is-5568-everything-on-israels-accessibility-law/) ·
  [Deque: Israel's accessibility laws](https://www.deque.com/mena-digital-accessibility-laws/israel/) ·
  [איגוד האינטרנט הישראלי — תקנות הנגישות](https://www.isoc.org.il/freedom-of-internet/accessibility/all-about-accessibility)
- [Generative Engine Optimization: the 2026 guide](https://llmrefs.com/generative-engine-optimization) ·
  [GEO statistics 2026](https://www.omnibound.ai/blog/generative-engine-optimization-statistics)
- [Core Web Vitals 2026: INP, LCP, CLS](https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide) ·
  [Most important Core Web Vitals metrics](https://nitropack.io/blog/most-important-core-web-vitals-metrics/)
- [SaaS landing page CRO best practices 2026](https://genesysgrowth.com/blog/designing-b2b-saas-landing-pages) ·
  [Landing page conversion statistics](https://genesysgrowth.com/blog/landing-page-conversion-stats-for-marketing-leaders)
- [Social proof for SaaS landing pages](https://launchwall.online/blog/social-proof-for-saas-landing-pages) ·
  [Trust UX: proof, guarantees and signals](https://www.userintuition.ai/reference-guides/trust-ux-proof-guarantees-and-signals-that-reduce-risk)
- [Google Ads landing page best practices 2026](https://foundrycro.com/blog/google-ads-landing-page-best-practices-2026/)
- [Online booking statistics for service businesses](https://schedulingkit.com/statistics/online-booking-statistics)
- [Micro-interactions and motion design in 2026](https://primotech.com/ui-ux-evolution-2026-why-micro-interactions-and-motion-matter-more-than-ever/)
- [Designing for RTL: a UX guide](https://www.numberanalytics.com/blog/designing-for-rtl-ux-guide)
