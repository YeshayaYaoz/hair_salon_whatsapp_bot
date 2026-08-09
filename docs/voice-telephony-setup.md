# Voice telephony: getting an Israeli number onto the voice bot

How a salon's phone line reaches the voice agent, and how to set one up. Written after establishing
the constraints below the hard way — the short version is that **Cartesia provisions US numbers
only**, so an Israeli line has to arrive over a carrier we bring ourselves.

## How the pieces fit

```
caller → Israeli number at your carrier → SIP → sip.cartesia.ai → shared voice agent
                                                                        ↓
                                                   POST /api/voice/context (this server)
                                                                        ↓
                                            per-salon greeting, hours, services, voice
```

One Cartesia agent serves every salon. An agent may hold many numbers, and the dialled number is
what identifies the salon — so there is no agent-per-business, and the per-salon differences all
arrive at call time from `backend/src/api/voiceRoutes.ts`.

## What is already automated

Once a trunk is registered and `CARTESIA_SIP_PROVIDER_ID` is set, an owner saving their number in
the dashboard's Bot page is the whole flow. `assignNumberToAgent`
(`backend/src/lib/cartesiaAdmin.ts`) imports the number against the trunk **and** assigns the agent
in a single request — deliberately one call, because two would leave a window where the number is
live with no agent behind it, and a caller in that window hears the line answer and hang up.

Numbers *inferred* from the WhatsApp connection are never imported (`importIfMissing: false`). That
guess is usually a Meta Cloud API number, which generally cannot receive voice calls at all —
importing it would bill a line our carrier does not own for a salon that never asked for voice.

## Setting it up

### 1. Pick a carrier

Requirements, in order of how likely they are to disqualify someone:

- **Sells the country's numbers.** For Israel that means `+972`.
- **Forwards inbound calls to an external SIP URI without registration.** Cartesia is the
  destination; it does not register to your carrier.
- **Can reach `sip.cartesia.ai`.** That host is a CNAME to LiveKit Cloud, which accepts SIP over
  UDP, TCP and TLS. Cartesia's own docs advertise only `;transport=tcp` and `;transport=tls`, so
  prefer those; UDP is what most carriers send by default and is worth testing before assuming it
  is refused.

**Zadarma works** — confirmed against a live Cartesia account, not just on paper. `+972` numbers at
$0 connection and $2–3/month, forwarded via *External Server → SIP URI*, with their published
signalling ranges in the trunk's `allowed_addresses`. The trunk registers, numbers import, and
**one agent holds several numbers at once**.

That last part is worth recording, because the published Cartesia TypeScript SDK claims otherwise:
its `listPhoneNumbers` docstring says *"you can only have one phone number per agent"*. That is
stale. The prose docs say *"an agent can have multiple numbers route to it"*, and a live account
confirms it. Do not size the architecture off that comment.

### 2. Register the trunk (one time)

```bash
cd backend
npx tsx scripts/cartesia-trunk-setup.ts --label "Zadarma" --numbers +972XXXXXXXXX
```

Cartesia refuses an inbound trunk with no access control, and so does the script. `--numbers` is the
quickest if you have nothing else; `--addresses` with the carrier's signalling ranges is the better
end state, because it keeps working as you add numbers instead of needing the allowlist edited each
time. Zadarma publishes its ranges on the SIP URI page in the account, and `allowed_addresses` has
been confirmed working on a live Cartesia account — LiveKit's own docs say that field needs per-
project enablement, but Cartesia evidently handles that for you.

Put the printed id in `CARTESIA_SIP_PROVIDER_ID`. Without it, `assignNumberToAgent` keeps its old
behaviour and fails with a message telling you to import the number by hand — which is accurate,
not a bug.

### 3. Point the number at Cartesia (per number, carrier side)

In Zadarma: Settings → Virtual phone numbers → the number's gear → **External Server** → tick
**SIP URI**, destination `sip.cartesia.ai`. Zadarma's API (`/direct_numbers/order/` and friends) can
buy numbers but exposes no endpoint for this field, so it stays a dashboard step per number.

### 4. Save it in the dashboard

Bot page → voice tab → the number → Save. The app imports and assigns it. The owner is told plainly
if Cartesia could not be reached, because the number saves either way and the line will not answer
until it is assigned.

## Checking it worked

```bash
cd backend && railway run npx tsx scripts/cartesia-probe.ts
```

Read-only. It prints the agents and their default voices, every number with its provider and agent,
and the linked providers — and warns about the two failures that are otherwise invisible:

- **a number assigned to no agent** — it accepts the call and hangs up, and because the call never
  reaches us, nothing appears in our logs
- **`CARTESIA_SIP_PROVIDER_ID` naming a provider that does not exist** — which surfaces otherwise as
  a confusing error at the moment an owner saves their number

Then dial the number. That is the only test that proves the media path, not just the signalling.

## Cost

| | Number | Per minute |
|---|---|---|
| Cartesia-provisioned | US only | $0.06 agent + $0.014 telephony |
| BYO SIP trunk | your carrier's price (Zadarma: $2–3/mo) | $0.06 agent + your carrier's rate |

The telephony add-on applies only to Cartesia's own numbers, so a trunk avoids it entirely.

## Still manual

- Buying the number and setting its SIP URI (carrier dashboard).
- The agent-side line that applies each salon's chosen voice:
  `yield AgentUpdateCall(voice_id=ctx["voiceId"])`. The agent lives in Cartesia, not this repo.
  Until it exists, `voiceId` rides along in `/context` and is ignored — harmlessly.
