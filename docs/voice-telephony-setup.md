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
**SIP URI**, Server address `+972XXXXXXXXX@sip.cartesia.ai`.

> **Keep the leading `+`.** Routing matches the SIP `To` header against imported numbers in +E.164.
> Written without it (`972XXXXXXXXX@…`) the destination matches nothing, so there is no agent to
> route to and the call is dropped **before a call record exists** — the number looks perfectly
> configured on both sides while every call silently fails, and Cartesia's call list stays empty
> because nothing ever got as far as being a call. This cost a live debugging session; it is the
> first thing to check when a correctly-imported number does not answer.

If calls still do not land, suspect transport next: append `;transport=tcp` to the destination.
Cartesia documents TCP and TLS, while most carriers send UDP by default.

**This does not have to be a dashboard step.** An earlier version of this page said Zadarma's API
could buy numbers but had no endpoint for this field, so it stayed manual per number — that was
wrong, and it is the reason onboarding a salon still needs someone in a browser:

```
PUT /v1/direct_numbers/set_sip_id/
  type      the number's type, as returned by GET /v1/direct_numbers/
  number    the virtual number
  sip_id    a SIP login, or an external server address — "+972XXXXXXXXX@sip.cartesia.ai"
```

`sip_id` set to an address rather than a SIP login *is* the External Server (SIP URI) setting. The
leading `+` matters here for the same reason it matters in the dashboard (see the warning above).

The rest of the chain is API-addressable too, which means provisioning a salon's line end to end
needs no console at all: `GET /v1/direct_numbers/country/?country=IL` for destinations,
`GET /v1/direct_numbers/available/<DIRECTION_ID>/` to pick a number, `POST /v1/direct_numbers/order/`
to buy it, then `set_sip_id` to point it at Cartesia. Israeli numbers additionally require identity
documents, which have their own endpoints (`/v1/documents/groups/create/`, `/v1/documents/upload/`)
— that is the one part with a human in it, and it is per *account*, not per number.

Auth is a signed header rather than a bearer token:

```
Authorization: <user_key>:<signature>
signature = base64( hmac_sha1( method_path + query + md5(query), secret_key ) )
```

where `query` is the parameters sorted by key and urlencoded, and `method_path` is the path from
the version onward (`/v1/direct_numbers/set_sip_id/`). POST and PUT bodies must be
`application/x-www-form-urlencoded`. Keys are generated in the Zadarma account.

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

### When the call connects but the agent is wrong

Do not diagnose this from the phone call. A bot that answers in Hebrew and knows nothing about the
business has at least four distinct causes that sound identical to a caller, and we spent six
deploys distinguishing them by ear before looking in the right place.

**Go straight to the per-call runtime logs**: console → the agent → Calls → the call → logs. They
show the websocket start message, every tool invocation, and any traceback from our code. The first
line to look for is

```
pre_call_handler: to='+972…' from=… call_id=…
```

Absent, and `voice-agent/main.py` did not serve that call — check which agent the number is on.
Present, and the next lines say exactly where the context went. `voice-agent/README.md` lists the
four causes and what each looks like in that log.

## When the greeting is slow

Measure before touching anything: the delay between "answered" and the first word is three
segments, and only one of them is in our code.

```
[Zadarma answers] ──?──▶ [pre_call_handler: logs its own ms] ──▶ [websocket] ──▶ [audio]
```

The agent log shows the last two segments (`pre_call_handler ready in Xms`, then the websocket
timestamps — audio starts ~0.4s after the websocket on a healthy call). Whatever remains of the
caller's wait sits **before** `pre_call_handler`, between Zadarma and Cartesia, and one question
splits it:

**Does the caller hear ringback or silence during the wait?**

Verified live (2026-08-11), in two steps that each eliminated a suspect:

1. The wait was heard as **silence**, not ringback — so Zadarma's External Server mode answers
   the caller's leg immediately and bridges after, which is what turns any upstream setup time
   into audible dead air.
2. **Two calls in a row: the first waited ~5s, the second answered within a second.** That
   acquits any fixed window (a window would hit every call equally) and convicts a **cold
   start** — Cartesia scales agents to zero when idle, and the first call after a quiet stretch
   pays the container wake-up. The "exactly five seconds" that suggested their documented
   pre-call ring window was a coincidence; the second call disproved it.

So the slow greeting hits exactly one caller: the first after ~30+ minutes of quiet. Two fixes,
both support tickets rather than code:

- **Cartesia**: ask for a minimum-instances / keep-warm option for the deployment, citing the
  cold-vs-warm timeline. Their platform markets "scale from zero"; a paid floor of one is the
  standard ask.
- **Zadarma**: ask whether External Server forwarding can relay ringing / early media instead of
  answering the caller before the destination answers. Even with cold starts unchanged, five
  seconds of ringback feels normal where five seconds of post-answer silence feels like a dead
  line — and this fix covers every future upstream delay, whatever causes it.

The two-calls-in-a-row test is the cheap way to re-run this diagnosis after any change.

Do not re-optimize the agent code for this: after the context cache and ring-time build landed,
its whole contribution is under half a second and the log proves it per call.

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
