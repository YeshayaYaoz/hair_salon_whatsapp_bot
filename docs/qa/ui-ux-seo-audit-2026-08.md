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

## Second round

Everything below was on the "recommended" list at first publication and has since been built.

### Per-salon accessibility statements

The differentiator described above, now shipped. `/book/{id}/accessibility` generates a statement
in the salon's own name: what it covers, the conformance level, the eight measures the booking page
implements, the one known limitation (third-party payment pages), and a contact.

Two decisions worth recording. **The statement is scoped narrowly and says so** — it covers the
booking page and explicitly disclaims the salon's physical premises, other websites and social
channels, because we know nothing about those and an overreaching statement is worse than a narrow
one. And **the contact is a real field the owner fills in**, not something we invent: a new
`Business.accessibilityContact` column, edited on the Settings page with an explanation of why the
duty is theirs rather than ours. Left empty, the statement still publishes and directs visitors to
the business's usual channels — better than no statement, and honest about what we don't know.

### Motion: cost and craft

**Cost.** All three scroll/pointer effects on both landing pages read layout and wrote styles
synchronously inside their own handlers — the textbook thrash loop, since `getBoundingClientRect()`
right after a style write forces a synchronous layout. `mousemove` is the worst offender: a
high-polling mouse fires it well over 100 times a second, and each one measured a card and wrote a
transform. All six now coalesce to one read/write pass per animation frame behind a `ticking`
latch, card geometry is measured once on `mouseenter` instead of on every move, and the sticky CTA
only writes its opacity when it actually crosses the threshold.

Two behaviours came out of this that weren't in the original finding. The tilt effects now **honour
`prefers-reduced-motion` in JavaScript**, which the global CSS rule could never do for them — that
rule neutralises CSS animations and transitions, and these are direct style writes. And the card
tilt is **skipped entirely on coarse pointers**, where a synthetic `mousemove` on tap was leaving
cards frozen mid-tilt with no pointer to leave and un-tilt them.

**Craft.** Every entrance in the system animated on `ease` — `cubic-bezier(0.25, 0.1, 0.25, 1)` —
which accelerates before it decelerates. That is right for something moving between two on-screen
positions and wrong for something arriving: the slow start reads as lag, because the element hangs
at its offset for the first few frames before committing. Every major motion system (Material,
Apple HIG, Carbon) says entrances decelerate only. Three curves are now named once on `:root`:

| Token | Curve | Used for |
| --- | --- | --- |
| `--ease-entrance` | `cubic-bezier(0.16, 1, 0.3, 1)` | everything arriving — fade-up, fade-in, slide-in, scale-in |
| `--ease-exit` | `cubic-bezier(0.7, 0, 0.84, 0)` | anything leaving |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | confirmations only (`pop`) — the overshoot is the point |

### Live regions

`SavedBadge` — used across six settings-style pages — now carries `role="status"`. It is mounted
*after* an async save completes, and a screen reader has no reason to revisit that corner of the
screen, so the save was previously silent and the only way to confirm it was to reload.

### Closed days on the booking date picker

The public endpoint has always returned the salon's opening hours and this page has always ignored
them, so a customer could pick a day the salon is simply never open — Saturday, for most Israeli
salons — wait for a request, and be told there was nothing, with no way to distinguish that from a
day that merely happened to be full. Closed weekdays are now struck through and disabled.

Scoped honestly: only weekly closures. Holidays, vacations and one-off blocks live in tables this
endpoint doesn't expose, so an enabled day still isn't a promise of availability — it just isn't a
*guaranteed* dead end.

### Trust bar

Railway Cloud removed. This strip is read by a salon owner deciding whether to trust us with their
appointment book, and which PaaS we deploy on answers a question they have not asked and cannot
evaluate. The AI vendors stay: they back the product's central claim. Hosting doesn't.

### Correction: the multiple-`<h1>` finding was wrong

The first version of this report flagged three `<h1>`s on `/dashboard/analytics` and two each on
`/bot` and `/settings`, and said `/dashboard/blocked` had no heading. On inspection **none of that
is a defect**. The duplicates are mutually exclusive early-return branches — error state, loading
state, loaded state — so exactly one `<h1>` ever renders. And `/dashboard/blocked` is a redirect
stub kept alive for old bookmarks; it correctly renders nothing at all. The finding was an artefact
of counting matches with `grep` rather than reading the branches. No change made.

---

## Third round: the visual pass

The first two rounds fixed what was *wrong* — truth, law, structure, performance — and deliberately
changed almost nothing about how the site looks. That was the honest read of what the audit found,
but it is not what "more professional, more engaging" asks for. This round is the visual work, done
to a brief: **keep the waves**, activate the unused display font, soften the bands.

### Correction: the display font was tried and rejected

Karantina was loaded in the root layout and used by nothing — a whole display face fetched on every
page load and thrown away. It was wired up to the landing-page headings to fix that, **and it did
not work**: it is a condensed, high-contrast face drawn from Israeli signage, and at heading sizes
in Hebrew it read as decorative rather than as the voice of a business product. Reverted on the
owner's call.

Rather than leave the download in place for a font nobody uses, it is now **removed from the layout
entirely**. Headings are Heebo, which is what they were, and the page no longer pays for a face it
never renders — so the original finding is resolved, just in the other direction.

The section below is kept as the record of what was tried and why.

### The display font was being downloaded and never used *(reverted — see above)*

`Karantina` is loaded in the root layout with weights 400 and 700, exposed as `--font-karantina` —
and referenced by **nothing anywhere in the app**. A whole display face was being fetched on every
page load and thrown away.

The cost of that was not just the request. With only Heebo on the page, a 62px headline and a 16px
paragraph were *the same typeface at two sizes* — size hierarchy, not typographic hierarchy. The
page had no display voice at all.

Karantina now sets the four narrative headings: hero `h1`, section titles, the closing CTA title
and the premium title. It is a condensed face, so it needed the opposite treatment to Heebo: the
negative tracking those headings carried (−1.5px to −2.5px) was compensating for Heebo's width and
would crush an already-narrow face, so tracking goes to 0 and each heading scales up to hold the
same presence. It tops out at 700, so the 800s become 700 rather than being synthetically
emboldened.

**Deliberately not applied to prices, stat numbers or the ROI figure**, for one aesthetic and one
functional reason: the numbers are the page's factual claims and read as more trustworthy in a
neutral face, and the stat band *animates its counters* — a display face without tabular figures
would make those digits jitter in width as they count. The page now has two intentional voices:
editorial for the argument, neutral for the evidence.

One trap worth recording: the new rules are scoped `.lp .lp-h1` rather than `.lp-h1`. The original
single-class heading rules appear **later** in the same stylesheet, so at equal specificity they
would have won on source order and every override would have silently done nothing.

### Softened bands

`#0A0A0A` was never a brand colour. The login panel, the legal pages and the dashboard's own dark
surfaces all use `#0D2A38` — a deep blue-green — so the landing page was the single surface in the
product going full black. The dark bands are now `#0C1D26`, in that family: still unmistakably a
dark band, but a deliberate colour rather than an absence of one, and the transitions in and out of
it are softer because it shares the page's hue. The light-grey bands move from a neutral `#F8F8F8`
to `#F5F8FA`, the same faint cool tint the dashboard already uses for its body background.

Both are named constants (`INK`, `ALT`) rather than repeated hexes, because each wave takes the
colour of the section above it as its background and the section below it as its fill — a hex
changed in one place and not the other shows up as a visible seam.

### The waves now move

They stay, and they do more. Each divider is two copies of the same wave drifting in opposite
directions at different speeds, the back one dimmed to 42% and lifted 5px, so its crest breaks the
surface of the front one at a shifting offset. The boundary reads as moving water rather than a
printed shape.

The mechanism: one wave period is 1440 units, the path is drawn twice with the second copy's
control points shifted by +1440, and the SVG is twice the container width — so translating it by
exactly −50% lands period two where period one started and the loop has no seam. Only `transform`
animates, so all nine run on the compositor and cost nothing on the main thread. They stop dead
under `prefers-reduced-motion`.

Nine hand-written `<div className="wave">` blocks collapsed into one `<Wave top bottom shape />`
component.

### Scroll-driven reveals

The genuinely modern piece. `animation-timeline: view()` ties an animation's progress to the
element's own passage through the viewport, so reveals are driven by the compositor with no
JavaScript, no IntersectionObserver callback, and no per-element main-thread work — and they
*scrub*, so scrolling back up un-reveals instead of leaving everything permanently on.

Wrapped in `@supports` so it is purely additive: browsers without it keep the existing observer
path exactly as it was. Gated on `prefers-reduced-motion: no-preference`. The stagger classes shift
each card's `animation-range` instead of its `transition-delay`, so a row of three still arrives in
sequence.

Also added: `text-wrap: balance` on headings, which stops a Hebrew heading dropping a single orphan
word onto its own line — far more disruptive in a condensed face than in Heebo.

### Verified in a real render

Not just a green build. The production server was started and both pages fetched: `/` serves 18
wave layers across 9 dividers, the new ink in 18 places, the Karantina rule, and the scroll-driven
block; `/en` serves the mirrored palette and type. The `--font-karantina` variable resolves in the
CSS bundle and the woff2 returns **HTTP 200, 12KB** — i.e. the font is genuinely being served, not
merely referenced.

### The waves shipped broken, and grep-based verification could never have caught it

Worth recording as a process failure, not just a bug. The first version of the animated dividers
went out visibly broken: every wave cut off partway across with a hard vertical edge, the section
above showing through the gap.

**Cause.** A leftover single-layer rule, `.wave svg { display: block; width: 100% }`, survived the
rewrite further down the same stylesheet. `.wave svg` is element+class (0,1,1) and beats
`.wave-layer` (0,1,0), so `width: 100%` won over `width: 200%`. Each SVG was pinned to one
container width while its viewBox held *two* 1440-unit periods — so both periods were squeezed into
the visible width, and the −50% drift then slid the whole thing half a container across, leaving
the trailing half of every divider empty.

**Why it shipped.** The verification claimed at the time — "started a production server and
fetched both pages" — checked that *strings were present in the HTML*: wave layers, the new ink,
the Karantina rule. Every one of those greps passed on a completely broken page, because the bug
was in cascade resolution and layout, which no amount of string matching can see.

**What replaced it.** Chromium via Playwright, measuring real geometry: for every `.wave`, assert
it has exactly two `.wave-layer` children and each is ≥ 1.99× its container's width. Before the
fix that reads 1.00×; after, 2.00×. Then actual screenshots of a divider mid-animation, looked at.
Result: `/` 9 waves, 0 bad; `/en` 13 waves, 0 bad.

The general lesson: *presence of markup is not evidence of rendering.* Anything whose failure mode
is visual has to be verified visually.

### `/en` now has waves too, and prices in dollars

`/en` had no dividers at all — hard cuts between sections. It now carries **13**, one at every
tonal transition (a wave between two same-coloured sections is invisible, so those are skipped).
Adding them exposed one more artefact: `.lp-ba` carried 1px top and bottom borders, and since the
wave's own background is that same ink, the border drew a hairline stripe straight across the
water. Removed — the waves are the separator now.

Pricing moved to **USD headline with the shekel amount stated underneath** — `$52 / $122 / $230`,
each card reading "billed as ₪189 / ₪449 / ₪849 per month".

The care here is deliberate: this page's original sin was advertising `$39/$79`, prices the system
would never charge. So the dollar figures are **derived, not typed** — `Math.ceil(ils /
ILS_PER_USD)` from the same shekel constants that mirror `PLAN_PRICES_ILS`, the only code that
charges money. They cannot drift the way hardcoded ones did. Rounded **up**, because a quote
landing under the real charge is the one that generates a complaint. And every card states the
shekel amount actually billed, so a stale FX rate makes the dollar figure approximate rather than
makes the page wrong.

**`ILS_PER_USD` is currently 3.7 and needs a human to revisit it when the rate moves materially.**

---

## Still recommended

1. **A real testimonial, obtained properly.** Testimonials placed next to a CTA are reported to
   lift B2B SaaS conversion by up to 68%, and pricing pages carrying them convert ~34% better. The
   product now has *no* social proof rather than fake proof, which is the right trade — but the
   honest version is worth actively going and getting. One named salon owner, with written
   permission, beats every invented number that was removed. Restore the JSON-LD `aggregateRating`
   only once reviews are visible on the page. **This is the one item on the list that cannot be
   built — it has to be asked for.**
2. **Tell existing salons about their accessibility obligation.** The statement now generates
   automatically, but no owner knows it exists or that the duty was ever theirs. A one-off message
   pointing at their new statement and the contact field is both a genuine service and a good
   reason to be in their inbox.
3. **Prompt for the accessibility contact in the setup checklist**, so the field gets filled rather
   than sitting empty behind a Settings tab.

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
