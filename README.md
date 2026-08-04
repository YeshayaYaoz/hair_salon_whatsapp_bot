# Salon WhatsApp Bot

Multi-tenant SaaS: a WhatsApp assistant for hair salons (and similar appointment-based businesses).
Customers ask questions or book appointments over WhatsApp; each salon manages its own services,
hours, staff and FAQ through a web dashboard.

## Stack

- `backend/` — Node.js + TypeScript + Express + Prisma (Postgres). Handles the multi-tenant REST
  API, the WhatsApp Cloud API webhook, and the Claude-powered bot.
- `admin/` — Next.js dashboard where each salon logs in and manages its data.
- Anthropic Claude (`@anthropic-ai/sdk`) answers customer messages, grounded in that salon's
  services/hours/staff/FAQ, with tool-use for checking availability and booking appointments.

## Local setup

### 1. Database

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in ANTHROPIC_API_KEY and WHATSAPP_VERIFY_TOKEN
npm install
npx prisma migrate dev --name init
npm run dev             # listens on :4000
```

### 3. Admin dashboard

```bash
cd admin
cp .env.local.example .env.local
npm install
npm run dev              # http://localhost:3000
```

Sign up, then visit the Services / Hours / WhatsApp tabs to configure a test salon.

## Connecting a real WhatsApp number (Meta Cloud API)

1. Create a Meta developer app at developers.facebook.com → add the **WhatsApp** product.
2. Under WhatsApp → API Setup you'll get a test phone number, a **Phone number ID**, and a
   temporary access token (generate a permanent one under System Users for production).
3. Run the backend locally and expose it with a tunnel, e.g. `ngrok http 4000`.
4. In the Meta app's WhatsApp → Configuration page, set the webhook URL to
   `https://<your-tunnel>/webhook/whatsapp` and the verify token to the same value as
   `WHATSAPP_VERIFY_TOKEN` in `backend/.env`. Subscribe to the `messages` field.
5. In the admin dashboard's WhatsApp tab, paste the Phone number ID and access token for the
   salon you want to connect.
6. Message that WhatsApp number from your phone — the bot should reply using that salon's data.

## Testing the bot without a real WhatsApp number

POST a simulated Meta webhook payload directly:

```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "metadata": { "phone_number_id": "<the id you saved in the WhatsApp tab>" },
          "messages": [{ "from": "15555550123", "type": "text", "text": { "body": "What are your hours?" } }]
        }
      }]
    }]
  }'
```

Check the backend logs / the recipient's WhatsApp (if `whatsappAccessToken` is a real token) for
the reply, since the webhook responds `200` immediately and processes asynchronously.

## Known limitation in this sandbox

`npx prisma generate` could not download Prisma's query engine binary in this development
sandbox (outbound network policy blocked the CDN). The TypeScript source is otherwise complete
and the only compile errors left are missing Prisma-generated types, which resolve themselves as
soon as `npx prisma generate` (or `prisma migrate dev`) runs somewhere with normal network access.

## Multi-tenancy model

Every table (`Service`, `BusinessHours`, `StaffMember`, `Customer`, `Appointment`, `FaqEntry`) is
scoped by `businessId`. Incoming WhatsApp messages are routed to a tenant by looking up the
`phone_number_id` Meta sends in the webhook payload against `Business.whatsappPhoneNumberId`.

WhatsApp access tokens are encrypted at rest (AES-256-GCM, see `backend/src/lib/crypto.ts`) using
the `TOKEN_ENCRYPTION_KEY` env var — keep that secret safe and stable, since rotating it makes
previously stored tokens undecryptable (salons would need to reconnect WhatsApp).

## Deploying

### Option A: managed platforms (Railway / Render / Fly.io)

Each of these can build directly from `backend/Dockerfile` and `admin/Dockerfile`:

1. Create a managed Postgres instance on the platform, copy its `DATABASE_URL`.
2. Deploy `backend/` as a service: set `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`,
   `TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `WHATSAPP_VERIFY_TOKEN`. The container runs
   `prisma migrate deploy` automatically on start.

   `DIRECT_URL` is easy to miss and fails quietly: `schema.prisma` declares it as `directUrl`, so
   Prisma needs it to resolve the datasource at all, and `migrate deploy` will not run without it.
   On a pooled provider (Neon) it is the same URL with `-pooler` removed from the host; anywhere
   without a pooler, repeat `DATABASE_URL` verbatim.
3. Deploy `admin/` as a service: set build arg `NEXT_PUBLIC_API_URL` to the backend's public URL.
4. Point Meta's webhook at `https://<backend-public-url>/webhook/whatsapp`.

### Option B: self-hosted single VM

```bash
cp .env.prod.example .env   # fill in real secrets
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

This builds and runs Postgres + backend + admin together. Put a reverse proxy (Caddy/Nginx) with
TLS in front of ports 3000/4000 for production traffic.

## Billing / subscriptions

Each `Business` has a `subscriptionStatus` (`trial`, `active`, `past_due`, `canceled`) and
optional Stripe customer/subscription IDs. See `backend/src/billing/` for the Stripe Checkout
session creation and webhook handler that keeps `subscriptionStatus` in sync. The bot and admin
API both reject requests for businesses without an active/trial subscription
(`requireActiveSubscription` middleware) — see `backend/src/lib/subscriptionGate.ts`.

To go live: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, create a Product/Price in your
Stripe dashboard, and put that Price ID in `STRIPE_PRICE_ID`.

## WhatsApp UX

Slot selection uses WhatsApp interactive list messages (not just plain text) so customers tap a
button instead of typing back a time. Customers can also say "cancel my appointment" or
"reschedule" — the bot has `cancel_appointment` and `list_my_appointments` tools in addition to
`check_availability` / `book_appointment`.

## Not yet built (flagged for later, out of v1 scope)

- Multiple subscription tiers / usage-based billing (current model is a single flat plan gate).
- Staff-specific working hours (currently all staff share the business's hours).
