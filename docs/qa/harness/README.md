# UI QA harness

Scripts behind `../ui-qa-sweep-2026-07.md`. They drive a real browser against a locally running
stack — nothing here is imported by the app, and nothing runs in CI.

## Setup

```bash
# 1. Database (or use docker compose up -d)
pg_ctlcluster 16 main start
createdb salonbot

# 2. Backend — .env needs DATABASE_URL, JWT_SECRET, TOKEN_ENCRYPTION_KEY.
#    Set SUPER_ADMIN_EMAIL=qa@torionline.test to reach /dashboard/admin.
cd backend
npx prisma db push          # NOT `migrate deploy` — see the report's last section
npx prisma generate
npm run dev                 # :4000

# 3. Admin
cd ../admin && npm run dev  # :3000

# 4. Seed. Must run from backend/ so @prisma/client and bcryptjs resolve.
cd ../backend && cp ../docs/qa/harness/seed.ts ./seed-qa.local.ts \
  && npx tsx seed-qa.local.ts && rm seed-qa.local.ts
```

Seeds `qa@torionline.test` / `QaPassword123` (an active salon with full data), plus a trial B&B and
a past-due clinic so empty and fleet states are covered.

## Running

`QA_OUT` sets the output directory (default `./qa-out`). Chromium comes from
`PLAYWRIGHT_BROWSERS_PATH`; adjust `executablePath` if yours lives elsewhere.

```bash
QA_OUT=./qa-out node sweep.mjs              # all routes × he/en × desktop/mobile + report.json
QA_OUT=./qa-out node sweep.mjs services     # filter by slug
QA_OUT=./qa-out node contrast.mjs           # WCAG AA audit → contrast.json
QA_OUT=./qa-out node interact.mjs           # modals, validation, empty/error states
QA_OUT=./qa-out node nojs.mjs               # server paint with JS off, inspects the CSSOM
node probe.mjs                              # focus trap, touch targets, landmarks (stdout only)
```

## Gotcha

`contrast.mjs` runs with `reducedMotion: "reduce"` and skips any node whose cumulative ancestor
opacity is below 0.95. Without both, the page's `fade-up` animations are sampled mid-flight and the
audit invents failures that don't exist — an early run flagged the primary teal button at 2.29:1
when it is actually 4.58:1 and passes. Keep both guards if you modify it.
