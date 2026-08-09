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
