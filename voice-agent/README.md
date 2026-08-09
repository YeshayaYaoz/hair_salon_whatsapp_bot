# Tori voice agent

The Cartesia agent that answers salons' phone calls. Deployed to Cartesia, not to Railway — it runs
on their infrastructure and calls this repo's backend over HTTP.

One agent serves every salon. The number the caller dialled decides which one, and everything
per-business is fetched from `POST /api/voice/context` before the conversation starts.

## Why the context is fetched up front

The agent this replaces used Cartesia's stock chat template with a prompt that said *"at the start
of every call, call `get_context`"* — but a template deployment defines no tools, so there was no
`get_context` to call. The model did the only thing left to it and **asked the caller** for the
arguments. From a real recorded call:

> *"אני צריכה את המספר שאליו התקשרת והמספר שלך כדי לקבל את כל המידע על הצימר"*
> — I need the number you called and your number, to get all the information

Registering the tool would have fixed that particular symptom and left the shape wrong: the model
could still call it late, or not at all, and the salon's own greeting cannot be spoken until the
answer is back. So the fetch happens in `pre_call_handler`, before the agent object exists. The
model is never asked for something it cannot know.

The same handler sets the salon's chosen **voice** (`voiceId` from `/context`) via
`PreCallResult.config.tts.voice_id`, so the very first word is already in the right voice.

### `PreCallResult.metadata` does not reach the agent

Observed on a live call: whatever `pre_call_handler` returns as metadata is discarded, and the
websocket start message carries Cartesia's own instead —

```
'metadata': {'agent_id': 'agent_…', 'template': 'user_code'}
```

`config` **is** honoured (the voice applies), only `metadata` is replaced. So the context is handed
over in-process through `_PENDING`, keyed by `call_id`, and `get_agent` re-fetches when it finds
nothing there — which also covers the two hops landing on different replicas. Nothing about the
salon depends on that round trip any more; the dialled number on `CallRequest` is enough on its own.

This is what made every call open with `שלום, הגעתם ל` and no business name.

## Deploying

The agent is code that runs during calls, so Cartesia has to reach it somehow. There are three
ways, and the choice is really "who hosts it".

**Latency decides this, and it favours managed hosting.** The agent sits on the hot path of every
single turn — caller speaks, Cartesia transcribes, *the agent* produces the reply, Cartesia speaks
it. It does not call this repo's backend every turn: `/context` is fetched once before the
conversation starts, and the booking tools fire only when the model uses them. So the link that
matters per turn is agent↔Cartesia, not agent↔backend.

A managed deployment is built into **US, EU and APAC simultaneously** and each call is routed to a
near region (call records carry `deployment_region`). Self-hosting puts the agent in exactly one
place — fine if that place is near the caller and near Cartesia, an added round trip on every turn
if it is not. Railway defaulting to a US region while the callers are Israeli would be the bad case.

### Managed, via the CLI (recommended)

```bash
curl -fsSL https://cartesia.sh | sh
cartesia auth login          # paste an API key from play.cartesia.ai/keys
cd voice-agent && cartesia init && cartesia deploy
```

**On Windows this needs WSL, not Git Bash.** The installer switches on `uname -s` and accepts only
`Darwin*` or `Linux*`; Git Bash reports `MINGW64_NT-…` and falls to "Unsupported operating system".
WSL reports `Linux` and works.

### Managed, via a linked GitHub repository

Cartesia's deployment docs mention this in one sentence — *"Use `cartesia deploy` or push to a
linked GitHub repository"* — and document it nowhere else in 715KB of documentation. The agent
object carries `git_repository` and `git_deploy_branch` fields, so the capability exists server-side,
but there is no published way to set them and no console page for it at the time of writing. Treat
it as unavailable unless Cartesia support says otherwise.

### Self-hosted

Cartesia calls your server instead of hosting the code itself. Deploy this directory as its own
Railway service — `main.py` already serves the FastAPI app on `$PORT`, which is all the `Procfile`
does — then point the agent at it by setting `self_hosted_deployment_url`:

```bash
curl -X PATCH https://api.cartesia.ai/agents/$CARTESIA_AGENT_ID \
  -H "Authorization: Bearer $CARTESIA_API_KEY" \
  -H "Cartesia-Version: 2026-03-01" \
  -H "Content-Type: application/json" \
  -d '{"self_hosted_deployment_url": "https://tori-voice-agent.up.railway.app"}'
```

(`cartesia connect --url …` does the same thing from the CLI.)

Use this when the managed routes are unavailable, or when you want the agent's uptime and rollout
under your own control — accepting single-region latency and cold starts in exchange. Cartesia's own
docs frame managed as the way to deploy *low-latency* agents, so treat this as the deliberate
trade rather than the default.

## Environment

Set these wherever the agent ends up running — Railway service variables when self-hosted, or
`cartesia env set …` for a managed deployment.

| Variable | Purpose |
|---|---|
| `TORI_API_URL` | Base URL of the backend, e.g. `https://api.torionline.co.il` |
| `CARTESIA_TOOL_SECRET` | Must equal the backend's — `voiceRoutes` rejects every request without it |
| `TORI_AGENT_MODEL` | Optional; defaults to `anthropic/claude-haiku-4-5-20251001` |

The matching model provider key (e.g. `ANTHROPIC_API_KEY`) is needed too.

## What it does per booking model

- **slot** (salons, clinics): `check_availability`, `book_appointment`, `cancel_appointment`,
  `reschedule_appointment`, all against `/api/voice/*`.
- **inquiry** (B&Bs): no booking. It informs and hands over with `transfer_to_owner`, because those
  businesses close bookings human-to-human — the backend refuses booking calls from them outright
  (`rejectIfInquiry`), so an agent that tried would only produce errors mid-call.

The dialled and caller numbers are **closed over, not tool parameters**. The model cannot mistype
them, invent them, or ask for them.

## Telling "wrong agent" from "wrong context"

A bot that answers, speaks Hebrew, and knows nothing about the business has two very different
causes, and over the phone they sound identical:

1. **A different agent took the call** — the number is attached to an agent that isn't this
   deployment, so its console-configured prompt answered and none of this code ran.
2. **The context did not arrive** — this code ran and `/context` gave it nothing.

The agent's logs separate them in one line. `pre_call_handler` logs `pre_call_handler: to=… from=…`
on entry (`main.py:100`) before doing anything else. **No such line on a call means cause 1** — check
`GET /agents/phone-numbers` for which agent the number points at. If the line is there, the next one
says which way the fetch went: `context resolved for … : <name>`, or a `context 404/402 …` warning,
or `context 200 … but no businessName`.

Neither cause can produce a plausible-sounding empty bot any more. Both `/context` returning a body
with no `businessName` and `tori_context` missing from the metadata now speak the fallback sentence
instead of building an agent that greets with `שלום, הגעתם ל` and an empty price list.

### The caller number is lost on this path

`cartesia-line` 0.2.16 gives `pre_call_handler` the literal string `"unknown"` instead of the
caller's number, whoever dialled. `CallRequest.from_` is declared `Field(alias="from")` — the name
the harness puts on the wire, as its own `StartInput` model confirms — but
`VoiceAgentApp.create_chat_session` builds the request with `body.get("from_", "unknown")`, reading
the field name rather than the alias. The websocket path (`_call_request_from_start_data`) uses the
alias correctly; only the HTTP `/chats` path is affected, which is exactly where this runs.

Two consequences. Returning customers are not recognised by name — unavoidable, since the lookup key
is the number itself. And bookings would have been filed under the customer phone `"unknown"`:
`/api/voice/book` passes `callerNumber` straight through to `customerPhone`, so the salon would end
up with an appointment it cannot call back and a confirmation message sent nowhere.

So when the caller ID is missing — and only then — `book_appointment` takes a `caller_phone`
parameter and the prompt tells the agent to ask for the number before booking. That is a question
salons ask on every call, unlike "which number did you dial". With a real caller ID present, nothing
is asked and the number stays closed over. `caller_number()` logs a warning either way, so this does
not get re-diagnosed as our bug.

## Failure behaviour

Every failure still answers the phone and says one sentence. A caller must never hear a line that
connects and dies.

`/context` returning 402 (subscription lapsed or not on the plan that includes voice) or 404 (no
salon on this number) already carries a sentence written to be spoken aloud; it is passed through
verbatim as the introduction. Only an unreachable backend falls back to a generic apology.

## Not verified here

This has not been deployed or exercised against a live call — it is written against the endpoint
contracts in `backend/src/api/voiceRoutes.ts` and the Line SDK's own types (`cartesia-line` 0.2.16:
`CallRequest.to` / `.from_`, `PreCallResult`, `LlmConfig`). Treat the first deploy as the test, and
check the transcript afterwards: `GET /agents/calls?agent_id=…` shows whether tools were called or
the model narrated them instead.
