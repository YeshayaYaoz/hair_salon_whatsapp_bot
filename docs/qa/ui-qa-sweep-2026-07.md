# Tori — full UI design & QA sweep

**Date:** 2026-07-30 · **Branch:** `claude/torionline-ui-design-qa-9r2mbq` · **Scope:** `admin/` (dashboard, landing, auth, public booking)

Every item below was reproduced against a locally running stack, and each one names the file and
line it came from.

> **Status:** all four P1s and most P2s are **fixed** on this branch — see
> [What was fixed](#what-was-fixed) at the end for the verified before/after. Line numbers in the
> findings refer to the code *as it was when the defect was found*. Items still marked open are
> listed in [Still open](#still-open).

---

## How this was produced

- Postgres 16 (local), backend on `:4000`, Next dev server on `:3000`, schema via `prisma db push`.
- Seeded one realistic Hebrew salon (6 services incl. a group class, 3 staff, 7 customers, 55
  appointments across past/today/upcoming/cancelled/awaiting-deposit, blocked times, FAQ, waitlist,
  conversations, 30 days of usage + metric snapshots) plus a trial B&B and a past-due clinic so
  fleet and empty states were exercised too.
- **108 page visits**: every route × `he`/`en` × desktop (1440×900) and mobile (390×844), capturing
  full-page screenshots, console errors, uncaught exceptions, failed requests, horizontal overflow,
  clipped text, touch-target sizes, missing `alt`, and unlabeled controls.
- **Computed WCAG contrast audit** over 23 routes, walking every text node and resolving the real
  composited background through ancestors.
- **Interaction passes**: modals, empty submits, bad credentials, filter tabs, mobile nav sheet,
  keyboard tabbing, a forced API 500, and a forced network failure.
- **No-JS pass** with the CSSOM inspected directly, to separate "server paint" bugs from hydration.

Harness scripts are in `docs/qa/harness/` so any of this can be re-run.

> **Methodology note.** A first contrast pass reported ~50 extra failures — including white-on-teal
> primary buttons — that were artifacts of sampling mid-`fade-up`. Re-running under
> `reducedMotion: "reduce"` with cumulative ancestor opacity removed them. The brand teal
> `#1B7FA0` with white text is **4.58:1 and passes AA**. Numbers below are from the corrected run.

---

## P1 — Broken

### 1. The customer-facing booking page is untranslated English, and RTL garbles it

`admin/app/book/[businessId]/page.tsx` never imports `useLanguage`. It has no i18n at all:

- `:26` `const STEP_LABELS = ["Service", "Date", "Time", "Details"];`
- `:192` `<h2 …>Choose a service</h2>`
- `:314` `Powered by …`
- `:206` `<div …>{svc.durationMin} min</div>`

The document inherits `dir="rtl"` from `LanguageProvider`, so line 206 renders as **“min 30”** —
the English string is reordered by the bidi algorithm. Every salon's own customers land here.
This is the only page in the product that non-owners ever see.

*Evidence:* `shots/mobile-he-public-booking.png`

### 2. Appointments fails hydration on every load and throws away the server render

`admin/app/dashboard/appointments/page.tsx:504`

```
{weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — {weekEnd.toLocaleDateString(…)}
```

React's own diff, captured from the console:

```
Warning: Text content did not match. Server: "Jul 26" Client: "26 ביולי"
Warning: An error occurred during hydration. The server HTML was replaced with client content in <#document>.
```

`undefined` locale means Node renders `en-US` and the browser renders its own locale. Three
consequences: the whole document is re-rendered client-side on every visit; the week-range label
follows the *browser's* locale rather than the app's language toggle; and no `timeZone` is passed,
so it isn't the business's timezone either.

### 3. Inline `<style>` blocks ship invalid CSS to the browser

`admin/app/page.tsx:245`, `admin/app/en/page.tsx:235`, `admin/app/login/page.tsx:99` all use
`` <style>{`…`}</style> ``. React escapes text children, so every apostrophe becomes `&#x27;` in the
server HTML — but `<style>` is a raw-text element, so browsers **do not decode entities inside it**.

Confirmed by reading the CSSOM with JS disabled:

```
.login-root  { … font-family: var(--font-heebo), &#x27; }          ← value corrupted
.login-aurora::before, ::after { position:absolute; border-radius:50%; filter:blur(90px) }
                                                                   ← `content: ''` is GONE
```

A `::before` without `content` generates no box at all, so **every decorative pseudo-element on both
landing pages and the login page is missing from the server paint** (`.lp-hero-phone::before`,
`.phone-wrap::before`, `.phone-frame::before`, both `.login-aurora` glows). React then detects the
`<style>` text mismatch and replaces the entire document — the marketing pages, which need SSR most,
effectively lose it.

Fix: `dangerouslySetInnerHTML={{ __html: css }}`. Avoiding apostrophes isn't enough — React escapes
`"` too.

*Evidence:* `shots/nojs-login.png`, `shots/nojs-landing-he.png`

### 4. Cancel-appointment is invisible, 6×12px, and still clickable

`admin/app/dashboard/appointments/page.tsx:309-315` — `opacity-0 group-hover:opacity-100`. Measured:

```
count: 3, opacity: "0", pointerEvents: "auto", size: "6x12",
tabbableWhileInvisible: true, opacityAfterFocus: "0"
```

`group-hover` never fires on touch, and it doesn't respond to `:focus` either. So a keyboard user
can tab to a destructive action and fire it while it stays invisible, and a pointer user can cancel
a customer's appointment by clicking a corner that shows nothing. Target is 6×12px against a 44px
guideline.

---

## P2 — Significant

### 5. The new-appointment modal has no dialog semantics

Measured on open: no `role="dialog"`, no `aria-modal`, focus stays on the trigger, **Escape does not
close it**, `body` overflow stays `visible` so the page scrolls behind it, and focus is not trapped —
the first Tab lands on “חבר Google Calendar”, a button *behind* the modal.

### 6. A failed data load leaves a permanent skeleton and prints the raw server error elsewhere

`admin/app/dashboard/services/page.tsx`

- `:74` `useEffect(() => { load().catch((e) => setError(e.message)); }, [])` — sets `error` but never
  `loaded`, so `:189-190` renders skeleton rows **forever**.
- `:290` renders that error *inside the “add service” card* at the bottom — nowhere near the list
  that actually failed.
- The message is the raw backend string. Forcing a 500 with `{"error":"boom"}` puts the literal
  word **`boom`** in front of the salon owner, in English.

*Evidence:* `shots/ix-api-500-view.png`

### 7. Onboarding shows Hebrew-only copy inside the English UI, bidi-broken

`admin/app/dashboard/onboarding/page.tsx:94` renders `{tpl.descriptionHe}` unconditionally, and
`backend/src/lib/businessTemplates.ts:56-58` defines `labelHe` / `labelEn` but only `descriptionHe` —
there is no English description to fall back to.

So in English the card *titles* translate ("Salon & Barber", "Health Clinic") while every description
and every sample-service chip stays Hebrew. With no `dir` on the element, that Hebrew sits in an LTR
block and the punctuation detaches — sentences render with the full stop leading the next line
(`.אחרי הביקור`).

*Evidence:* `shots/desktop-en-onboarding.png`

### 8. WhatsApp green fails AA on the primary conversion path

White on `#25D366` = **1.98:1** (needs 4.5:1):

| Where | File |
| --- | --- |
| “נסה חינם — 14 יום”, “התחל עכשיו בחינם” | `app/page.tsx` |
| “Try Free — 14 Days” | `app/en/page.tsx` |
| “חבר WhatsApp Business” | `app/dashboard/whatsapp/page.tsx` |

Green-on-white at display size is just as bad: the hero headline “גם כשאתה ישן.” / “Even while you
sleep.” is 1.98:1 against a 3:1 requirement. This is the brand colour of the integration, so it
needs a deliberate decision — darken to ~`#128C4A` for text/buttons and keep `#25D366` for fills
and the chat mockups.

### 9. Native browser chrome leaks English and US formats into the Hebrew UI

The new-appointment modal's `required` fields raise Chromium's own bubble — **“Please fill out this
field.”** — in an otherwise fully Hebrew screen, because that string follows the browser's UI
language, not the page's. The `datetime-local` input renders **`mm/dd/yyyy, --:-- --`**: US order and
12-hour time for an Israeli product. (The “לפי אזור הזמן Asia/Jerusalem” helper underneath is a nice
touch and should stay.)

*Evidence:* `shots/ix-appts-modal-empty-submit.png`

### 10. The stale amber brand is still the accent, and it encodes two different things at once

`admin/app/dashboard/analytics/page.tsx`

- `:297` daily chart — amber gradient means **“today”**
- `:333` top-services — the *same* amber gradient on **every** bar, meaning nothing

The two charts sit side by side, so the reader learns “amber = today” from one and is contradicted
by the other. Both should be teal; use weight or a marker for “today”.

Underneath it, `admin/tailwind.config.js` still declares `brand: "#F59E0B"`, `brand-dim`, and
`slate950/900/800/700` — **zero utility usages anywhere in `app/`**. Dead tokens that contradict the
real brand `#1B7FA0`, which is itself hardcoded as a hex in `globals.css` and in per-page CSS rather
than being a token. There is no single source of truth for colour right now.

---

## P3 — Polish and consistency

**Dates and timezones** — the codebase has `partsInTz` / `dayKeyInTz` "for day/hour grouping", and
these sites bypass them:

- `analytics/page.tsx:286-287,304` — `new Date(date + "T00:00:00")`, `d.getDay()`, and
  `new Date().toDateString()` are all browser-local, so day labels and the “today” highlight shift
  for a viewer outside Israel. `dayKeyInTz` is imported in the same file.
- `appointments/page.tsx:278,295` — same `toDateString()` comparison for the today column.
- `appointments/page.tsx:219-220` — CSV export uses `toLocaleDateString()` / `toLocaleTimeString([])`
  with no timezone, so exported appointment times are in the viewer's zone, not the salon's.

**Hardcoded strings**

| String | Location | Shows wrongly in |
| --- | --- | --- |
| `"Today"` | `appointments/page.tsx:518` | Hebrew UI |
| `"Admin"` (label + section header) | `layout.tsx:222,225` | Hebrew UI |
| `"מציאת לידים"` | `layout.tsx:226,449`, `admin/leads/page.tsx:369` | English UI |
| `"הזמנת תורים בוואטסאפ"` | `layout.tsx:185`, `forgot-password:36`, `reset-password:103` | English UI |
| `"תורי"` wordmark | `layout.tsx:184,338` | English UI (landing says “Tori”) |
| `"⏳ ממתין למקדמה"` | `appointments/page.tsx:304,308` | English UI — and `:651` localises the *same* status correctly in list view |

**RTL** — `appointments/page.tsx:499-517`: the week chevrons are static SVG paths, so in RTL the
right-hand “previous” button points left and the left-hand “next” points right. Both read backwards.

**Dark-theme leftovers** — `appointments/page.tsx:28-29`:
`cancelled: "bg-red-950/50 text-red-600 border-red-200"` and
`pending: "bg-yellow-950/50 text-yellow-400 border-yellow-800"` render a muddy near-black chip in a
light UI, next to `bg-green-50` / `bg-amber-50` siblings. (`pending` also looks dead — the status is
`pending_payment`.) *Evidence:* `shots/ix-appts-list-cancelled.png`

**Iconography**

- “רשימת המתנה” and “לוח זמנים” ship the **identical** clock path
  (`M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z`); payments and billing share a card icon. Four nav
  entries, two glyphs.
- Analytics stat cards mix emoji (`📅 👤 🏆`) with a typographic `₪` (`analytics/page.tsx:226-248`).
  The 📅 renders with a baked-in “17” — also on the Google Calendar connect card, where a wrong date
  on a calendar-connect CTA is especially unfortunate. None are `aria-hidden`, so screen readers
  announce “calendar”, “bust in silhouette”, “trophy” before each label. Differing emoji heights also
  misalign the onboarding card titles.

**Mobile**

- Bottom tab label truncates to “מחירים ושי…” — the rename to “מחירים ושירותים” doesn't fit a 5-tab bar.
- The “עוד” sheet's last items sit under the fixed tab bar. *Evidence:* `shots/ix-mobilenav-more-open.png`
- Week grid is hardcoded `07:00–21:00` (`appointments/page.tsx:263`) regardless of the salon's real
  hours (09:00–19:00 here), so there are always dead rows. At 390px the 7 day columns are ~44px each
  and appointment chips measure 39–71px, truncating names to a few characters. A day view or
  horizontal scroll would serve phones better. (Chips do *not* overflow their cells — verified.)
- Sub-44px targets throughout: “עריכה” 46×24, “מחק” 38×24, “הסרה” 44×24, segmented control 58×28,
  and checkboxes squeezed to 13×16 on the hours page (`globals.css` sets 16px; flex shrink overrides it —
  needs `flex-shrink-0`).

**Accessibility**

- No skip-to-content link: 17 sidebar links are focused before page content on every page. Otherwise
  structure is sound — one `<h1>`, clean H1→H2 order, `<main>` and `<nav>` present.
- Unlabeled controls: checkboxes on customers/blocked, time inputs on hours/blocked, selects on
  billing and the admin fleet list.
- With JS off the login form never appears: `.login-card` only gets its `.show` class from a
  `useEffect` (`login/page.tsx:27-30,674`), so it stays invisible rather than degrading.

**Remaining AA failures** (126 real failures / 66 distinct colour+size combos; emoji excluded)

| Ratio | Colour | Where |
| --- | --- | --- |
| 2.11:1 | `#A8B4C0` on white | login dividers — “או עם אימייל”, “עוד אין לכם חשבון?” |
| 2.34:1 | `#9CA3AF` on `#F4F6F8` | “On this page” TOC — privacy & terms carry 16–17 failures each |
| 2.14–3.5:1 | `rgba(255,255,255,.25–.38)` | landing footer, nav, feature captions |
| 1.97–3.07:1 | `#F59E0B` / `#D97706` | “✓ Premium”, “⚠ Partial”, “חודשיים מתנה”, duration chips, admin warnings |
| 2.03–3.32:1 | white on provider brand colours | payments page chips (GI / iC / PP / חשבונית ירוקה) |
| 2.95–3.3:1 | `#16A34A` on tinted greens | analytics trend chip, billing loyalty note |

Contrast inside the landing phone mockups (`21:03`, `✓✓`, “מקליד”) is a faithful reproduction of
WhatsApp and is lower priority — but the testimonial attributions (“Dana K., Tel Aviv”, 3.39:1) are
real content, not decoration.

**Copy / IA** — in Hebrew, `billing: "תשלום"` (what the salon pays Tori) and
`payments: "סליקה וחשבוניות"` (what customers pay the salon) are easy to transpose;
English “Billing” vs “Payments” is clearer. Worth renaming the Hebrew pair.

**Minor** — `LanguageContext` fires `/api/business/me` on every public page with no token, so every
landing/login/legal view logs a 401. `formatPhone` is correctly wrapped in `dir="ltr"` at 8 of 9 call
sites; the exception is `appointments/page.tsx:304`, inside a `title` attribute where the documented
fix can't be applied.

---

## Not a UI bug, but it blocks new contributors

`prisma migrate deploy` fails on a fresh database: there is no init migration, and the first one
(`20240101000000_add_customer_crm_fields`) assumes the tables already exist —
`ERROR: relation "Customer" does not exist`. Production was created with `db push`, and
`scripts/db-deploy.sh` baselines around it, but the README's `npx prisma migrate dev --name init`
doesn't reproduce a working local DB. `db push` is the working path today.

---

## What was fixed

Re-measured with the same harness after the fixes, on the same seed data:

| Metric | Before | After |
| --- | --- | --- |
| Hydration failures (108 page visits) | 10 | **0** |
| Pages with uncaught JS errors | 10 | **0** |
| WCAG AA contrast failures | 126 | **50** |
| Distinct failing colour+size combinations | 66 | **27** |
| Horizontal overflow / navigation errors | 0 | 0 (no regression) |

Backend suite: 125 tests passing. `tsc --noEmit` clean in both packages — it previously failed,
because `app/dashboard/layout.tsx` exported `isVisibleFor` and Next.js permits only its own known
exports from a layout module. That broke `npm run typecheck` and `next build`; the export is now
module-private (nothing imported it).

**All four P1s.** Booking-page i18n (plus RTL logical properties, mirrored chevrons, salon-timezone
slot times, and an `isoDate` that no longer returns yesterday for evening visitors in Israel);
the `toLocaleDateString(undefined)` hydration mismatch, via `formatDateIn`/`localeFor` in `lib/tz.ts`
which *require* an explicit locale; the `<style>` escaping, via `dangerouslySetInnerHTML`; and the
invisible cancel button, now 20×20, hidden only on hover-capable devices, `pointer-events-none`
while hidden, revealed on `focus-visible`, and labelled with the customer's name.

**P2 #5 — modal semantics.** New `lib/useDialog.ts` gives all seven dialogs `role="dialog"`,
`aria-modal`, Escape-to-close, focus moved in on open and restored on close, a focus trap, and a
body scroll lock. Verified: focus now lands on the first control and every Tab stays inside.

**P2 #6 — failed loads.** Services and onboarding set `loaded` on the error path too, so a dead API
no longer renders skeletons forever; the message moved next to the list that actually failed and
gained a retry.

**P2 #7 — onboarding i18n.** `descriptionEn` added to all five templates in
`businessTemplates.ts` and served by the API; sample-service chips keep their Hebrew names (they
become the real seeded services) but carry `dir="auto"` so they stop being bidi-mangled in the
English UI. Emoji are now fixed-width, which also un-skews the card titles.

**P2 #8/#10 — the colour system.** `tailwind.config.js` now defines real `brand` and `wa` scales;
the dead `brand: #F59E0B` / `brand-dim` / `slate950-700` tokens (zero usages) are gone. `wa.DEFAULT`
is Meta's `#25D366` for fills only, `wa.ink` (`#0F8043`, 5.0:1) for anything carrying text — the
landing CTAs and the dashboard's WhatsApp connect button now pass. Amber that carried text moved to
`#B45309` (5.0:1). Both analytics charts are teal, so the colour no longer means "today" in one
chart and nothing in the one beside it.

**P2 #9 — validation copy.** New `lib/validation.ts` replaces Chromium's English
"Please fill out this field." with localised text on the appointment modal's required fields.

**Several P3s**, where they sat in code already being touched: `"Today"` and the awaiting-deposit
chip localised, week-nav chevrons mirrored for RTL, dark-theme status pills replaced, the duplicate
waitlist/schedule clock icon replaced, `aria-hidden` on decorative stat emoji, and a
skip-to-content link (previously 17 sidebar links stood between a keyboard user and page content).

One systemic fix worth calling out: service price chips derive their text colour from the
owner-chosen swatch, and **12 of the 17 stock swatches failed AA against their own tint** (amber
2.04:1, teal 2.33:1). Rather than hand-tune swatches a user can change anyway,
`lib/readableColor.ts` keeps the hue and walks lightness down until it clears 4.5:1. All 17 now
pass, worst case 4.52:1.

## Still open

Deliberately not fixed, with reasons:

- **Phone-mockup internals** on the landing pages (`21:03`, `✓✓`, `מקליד`, `Message`) — a faithful
  reproduction of WhatsApp's own UI. Changing them makes the mockup less convincing; they carry no
  information the page doesn't state elsewhere. This is most of the remaining 50.
- **Payments provider chips** (GI / iC / PP / חשבונית ירוקה) — white on third-party brand colours
  at 2.0–3.3:1. Fixing properly means not using each provider's brand colour as a fill, which is a
  product decision.
- **`datetime-local` rendering `mm/dd/yyyy`** — the native control follows browser locale and can't
  be overridden; a real fix means a custom date picker.
- **The mobile week grid** (~44px columns, hardcoded 07:00–21:00 regardless of opening hours). A
  day view or horizontal scroll is a design change, not a bug fix.
- **Sub-44px touch targets** on row actions (עריכה/מחק/הסרה at 24px high) — worth a pass over the
  shared row-action pattern rather than page-by-page patches.
- **`billing: "תשלום"` vs `payments: "סליקה וחשבוניות"`** — genuinely ambiguous in Hebrew, but
  renaming a nav item owners already know is a call for whoever owns the product vocabulary.
- **The Lead Finder page body is Hebrew-only** (`0 קמפיינים`, `צור קמפיין חדש`, …). Its chrome —
  the nav entry, the section heading, the page `h1` — is localised now, but the page itself is
  hundreds of Hebrew strings. It's an internal sales tool gated behind `SUPER_ADMIN_EMAIL`, never
  seen by a salon owner or their customers, so translating it wasn't worth the churn in this pass.
- **Login form invisible with JS off**, and `/api/business/me` 401ing on every public page.
- **The missing init migration** (see above) — outside UI scope, but it still blocks a fresh clone.
