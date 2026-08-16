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

**Latency decided this, and on paper it favoured managed hosting — a live call reversed it.** Read
this section for why the trade-off is close; the answer it reaches is out of date, and the
self-hosted section below says what production actually runs. The agent sits on the hot path of every
single turn — caller speaks, Cartesia transcribes, *the agent* produces the reply, Cartesia speaks
it. It does not call this repo's backend every turn: `/context` is fetched once before the
conversation starts, and the booking tools fire only when the model uses them. So the link that
matters per turn is agent↔Cartesia, not agent↔backend.

A managed deployment is built into **US, EU and APAC simultaneously** and each call is routed to a
near region (call records carry `deployment_region`). Self-hosting puts the agent in exactly one
place — fine if that place is near the caller and near Cartesia, an added round trip on every turn
if it is not. Railway defaulting to a US region while the callers are Israeli would be the bad case.

### Managed, via the CLI (no longer the deployment — kept as the way back)

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

### Self-hosted — **this is the current deployment**

> Live since 2026-08-16. Calls go to the Railway service **`tori-voice-agent`** in project `Tori`,
> at `https://tori-voice-agent-production.up.railway.app`, which reports
> `ready_for_calls: true`. `GET /agents/{id}` returns that host in `self_hosted_deployment_url`
> (Cartesia stores it without the scheme). The ~5s cold start on the first call of the morning is
> gone — that was the managed runtime scaling from zero, and nothing scales to zero now.
>
> Two workflows own this and neither needs a laptop: **"Provision the voice agent on Railway"**
> creates or updates the service and prints what it booted with, and **"Fix Cartesia agent config"**
> points Cartesia at it. `railway run npx tsx scripts/cartesia-probe.ts` (from `backend/`) prints
> the current mode if you want a second opinion.
>
> `deploy-voice-agent.yml` still pushes to the managed runtime on every push, and that runtime is
> now the thing nobody dials. Either retire it or leave it as the way back: restoring managed
> hosting is one PATCH clearing `self_hosted_deployment_url`.

Cartesia calls your server instead of hosting the code itself. This directory runs as its own
Railway service — `main.py` serves the FastAPI app on `$PORT`, which is all the `Procfile` does —
and the agent points at it via `self_hosted_deployment_url`:

```bash
curl -X PATCH https://api.cartesia.ai/agents/$CARTESIA_AGENT_ID \
  -H "Authorization: Bearer $CARTESIA_API_KEY" \
  -H "Cartesia-Version: 2026-03-01" \
  -H "Content-Type: application/json" \
  -d '{"self_hosted_deployment_url": "https://tori-voice-agent-production.up.railway.app"}'
```

(`cartesia connect --url …` does the same thing from the CLI.)

#### Clear the console's own prompt while you are in there

The agent object keeps an `llm_system_prompt` of its own, editable in the Cartesia console — and a
one-line `llm_introduce` beside it. On a
self-hosted agent both are dead weight — `build_prompt` renders the real prompt per call from the
salon's data, and `main.py` passes its own `introduction=spoken_greeting(salon)` — but it is not
harmless dead weight. The copy found on the live agent was written in
the opposite gender to `TORI_AGENT_GENDER` and told the model to call `get_context`, a tool that
was deliberately removed (see the module docstring: with no tool registered, the model asked a real
caller out loud for "the number you called"). Two prompts that disagree is a coin toss nobody is
watching.

Replace it with a marker rather than an empty string, so an agent that somehow answers without the
self-hosted URL is obviously misconfigured instead of quietly promptless:

```bash
curl -X PATCH https://api.cartesia.ai/agents/$CARTESIA_AGENT_ID \
  -H "Authorization: Bearer $CARTESIA_API_KEY" \
  -H "Cartesia-Version: 2026-03-01" \
  -H "Content-Type: application/json" \
  -d '{"llm_system_prompt": "Self-hosted agent — the live prompt is built per call in voice-agent/main.py (build_prompt). This field is intentionally unused; do not write instructions here.",
       "llm_introduce": "Unused — the spoken greeting is built per call in voice-agent/main.py."}'
```

**The field is `llm_system_prompt`, not `system_prompt`.** The websocket `start` message names it
`system_prompt` and the REST object does not, so the obvious guess PATCHes to
`Unrecognized key: "system_prompt"` — and a GET for it reports "0 chars" rather than "absent",
because jq on a missing field looks exactly like jq on an empty one. `GET /agents/{id} | jq keys`
settles it in one line. The "Fix Cartesia agent config" workflow does all of this with the key that
never leaves GitHub.

`railway run npx tsx scripts/cartesia-probe.ts` (from `backend/`) reports the length of whatever is
there and flags it when it grows back into a second prompt.

**This is the route now taken.** The reasoning reversed on live
measurement. The managed
runtime scales the agent to zero when idle, and the first call after a quiet stretch pays ~5
seconds of dead air waking the container — measured on a real call, and confirmed as cold start by
an immediate second call answering within a second. A Railway service on a paid plan never sleeps,
so no caller is ever the cold one. The price is single-region: every conversational turn crosses
from Cartesia's infrastructure to the Railway region and back, adding some fixed per-turn latency.
A steady ~150ms on every turn is a far better deal than 5 seconds of silence for the first caller
of the morning — and first impressions are exactly the calls a booking line exists for.

Two further wins over the managed route, both learned the hard way:
- **Deploys ride `git push`** like the rest of the repo, retiring the `cartesia deploy` laptop
  ritual and the stray-`cartesia.toml` failure mode entirely.
- **`GET /health` says which code is live** — model, gender, whether usage reporting is wired —
  answering in one curl the "which code answered that call" question that once took an evening.

### Railway setup

Already done, and re-running it is how you redeploy. **Actions → "Provision the voice agent on
Railway" → Run workflow** creates the service if it is missing, sets `TORI_API_URL`,
`CARTESIA_TOOL_SECRET`, `ANTHROPIC_API_KEY` and `TORI_AGENT_GENDER`, uploads this directory, and
finishes by printing `/health`. It refuses to run against the backend's own service name, because
the project token can reach both and deploying the agent onto the API would take every salon down.

Two things it knows that are easy to get wrong by hand:

- **Railway variables are per service, not per project.** The Anthropic key had been in the project
  for a month — on the backend, the service using it — while `tori-voice-agent` had none and
  reported `model_key: false`. Both facts were true at once. The workflow now reads the backend's
  key and copies it across when GitHub holds none, so there is one key to rotate rather than two.
- **`railway up --ci` exits non-zero on a broken log stream** exactly as it does on a failed build.
  The health check, not the exit code, is the verdict on whether a deploy shipped.

Then **"Fix Cartesia agent config"** with `deployment_url` points Cartesia at it. Calls switch over
immediately; switching back is the same call with `self_hosted_deployment_url` cleared.

Set `TORI_AGENT_MODEL` by hand in the Railway dashboard if you ever want to override the model —
the workflow does not manage it, so a value set there survives every future run.

## Environment

Set these wherever the agent ends up running — Railway service variables when self-hosted, or
`cartesia env set …` for a managed deployment.

| Variable | Purpose |
|---|---|
| `TORI_API_URL` | Base URL of the backend, e.g. `https://api.torionline.co.il` |
| `CARTESIA_TOOL_SECRET` | Must equal the backend's — `voiceRoutes` rejects every request without it |
| `TORI_AGENT_MODEL` | Optional; defaults to `anthropic/claude-haiku-4-5-20251001` |
| `TORI_AGENT_GENDER` | `masculine` or `feminine` — the gender this deployment speaks about itself in |

The matching model provider key is needed too: `ANTHROPIC_API_KEY` for the default, or
`TORI_AGENT_API_KEY` to set one explicitly regardless of provider.

The model is chosen on time to first token, not on price. Published figures put Haiku 4.5 near
100–150ms against DeepSeek's 0.8–1.8s, and on a phone line that gap is the difference between an
answer and a dropped call — the caller starts talking again over it. The WhatsApp bot runs DeepSeek,
where the same wait costs nothing. Change this only with a real call as the test.

### What keeps the call fast

Every one of these was bought with a measured problem, so they are worth knowing before changing:

- **Prompt caching** on the system message (`cache_control_injection_points`). The prompt carries
  the whole salon and is re-sent every turn — around 9,000 tokens. Anthropic-only; DeepSeek caches
  server-side by itself.
- **`reasoning_effort="none"`.** A reasoning turn's first token is minutes out against ~100ms.
- **`max_tokens=300`** as a backstop against a monologue the caller sits through.
- **Context cached per dialled+caller number for 60s**, because `pre_call_handler` and the websocket
  session run in different processes — the agent is rebuilt *after* the answer, and every
  millisecond of that fetch is silence.
- **`TORI_AGENT_GENDER`**, so the agent's Hebrew grammar costs no Cartesia round trip per call.
- **One shared httpx client**, so the context fetch is not preceded by a TLS handshake.

There are two agents, one per voice gender, so `TORI_AGENT_GENDER` is a property of the deployment
rather than of the call. Set it to match the voice the agent actually speaks in: Hebrew marks gender
on every verb, and it also picks which of the two apology sentences a caller hears when the backend
is unreachable. Left unset, the agent falls back to the `voiceGender` `/context` reports.

Token usage from every model call is reported to `POST /api/voice/usage`, so phone spend lands in
the same per-business ledger as WhatsApp. It rides `TORI_API_URL` + `CARTESIA_TOOL_SECRET`; with
either unset the agent still runs and logs a warning, it just reports nothing.

## What it does per booking model

- **slot** (salons, clinics): `check_availability`, `book_appointment`, `cancel_appointment`,
  `reschedule_appointment`, all against `/api/voice/*`.
- **inquiry** (B&Bs): no booking. It informs and hands over with `transfer_to_owner`, because those
  businesses close bookings human-to-human — the backend refuses booking calls from them outright
  (`rejectIfInquiry`), so an agent that tried would only produce errors mid-call.

`transfer_to_owner` is available to **both**. It was originally built for inquiry businesses only,
which left a salon's agent with no answer to *"אפשר לדבר עם מישהו?"* — the most ordinary request a
caller makes. `/context` now returns `ownerTransferNumber` for every business rather than only
inquiry ones. Where the owner never set a notification phone the tool is absent, and the prompt
tells the agent to take a name and number instead of promising a handover it cannot perform.

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

## Everything in the prompt is written to be heard

The database stores what a calendar needs. Read out, those shapes are wrong in ways that are obvious
on the phone and invisible on screen, so the prompt is rendered in spoken Hebrew before the model
ever sees it.

**Numbers agree in gender with what they count, and a bare digit gives the model nothing to agree
with.** `2 לילות` came out שתיים or שניים depending on the guess; only שני is right. `_he_num`
carries 1–99 in both genders, and the call sites know the noun — לילה is masculine (שני לילות),
שעה is feminine (שתי שעות, and 2 is really the dual שעתיים). Above 99 it falls back to digits and
the prompt's own rule covers it, which is why a ₪1,800 price is still written `1800`.

| Stored | Spoken |
|---|---|
| `durationMin: 1440` | לילה אחד |
| `durationMin: 150` | שעתיים וחצי |
| `capacity: 4` | עד ארבעה אורחים |
| `openMin: 540, closeMin: 825` | מתשע בבוקר עד רבע לשתיים בצהריים |
| `startDate: "2026-09-25"` | עשרים וחמישה בספטמבר |
| `startTime: "2026-08-12T09:00:00Z"` | שנים עשר באוגוסט בשעה תשע בבוקר |

That last row was going into the prompt raw, for the agent to read a UTC timestamp aloud to a
customer about their own appointment.

`check_availability` is the one place both forms are needed: the time is spoken (`רבע לשלוש
בצהריים`) while `startTime` stays byte-identical, because `book_appointment` hands it straight back
to the backend.

**The rules are gendered too.** They are imperatives — אמור/אמרי, אל תקרא/אל תקראי — so they live
inside `FORMS` rather than beside it. Keeping them in one shared list is exactly how a masculine
instruction ends up in a feminine agent's prompt; that happened once here and checks 15 and 17 now
assert against it in both directions.

## Failure behaviour

Every failure still answers the phone and says one sentence. A caller must never hear a line that
connects and dies.

`/context` returning 402 (subscription lapsed or not on the plan that includes voice) or 404 (no
salon on this number) already carries a sentence written to be spoken aloud; it is passed through
verbatim as the introduction. Only an unreachable backend falls back to a generic apology.

## Verified on a live call

Deployed to `dialogue-partner` and answered a real call to `+972555077941` speaking the business's
own greeting and data.

Getting there took six deploys that all changed nothing, because four separate problems produced one
identical symptom — a bot that answered in Hebrew and greeted with `שלום, הגעתם ל`, no business name.
Each is worth knowing before wiring the next number:

1. **`CARTESIA_TOOL_SECRET` was unset**, making the auth header the bare string `Bearer `. httpx
   refuses to send that: `LocalProtocolError: Illegal header value b'Bearer '`, raised five frames
   deep in httpcore and easily misread as a network fault. `_post` now names the missing variable.
2. **`PreCallResult.metadata` never reached the agent** (see above). This one survived every fix to
   the others, because the context could not arrive no matter what `/context` returned.
3. **`cartesia env set` requires `--agent-id`.** Without it the CLI reports *"No agent linked.
   Initializing project…"*, writes a `cartesia.toml` into whatever directory you are standing in,
   and tries to deploy that — from the repo root that means a 386 MB upload of `node_modules`,
   which the server rejects. Always run it from `voice-agent/`, always pass `--agent-id`.
4. **A `git pull` that aborted on local changes.** Windows checkouts show most of the repo as
   modified via `core.autocrlf`, `pull` refuses to overwrite them, and `cartesia deploy` cheerfully
   ships the unchanged files. A deploy succeeding says nothing about which code it packaged.

The lesson that would have saved the evening: **the per-call runtime logs answer in one look what a
phone call cannot answer at all.** Console → agent → Calls → the call → logs. `pre_call_handler`
logs on entry, so its absence means this code did not serve the call, and everything after it says
where the context went. Reach for that before forming a theory.

Two shell notes for Windows/WSL: secrets containing `!` need `set +H` and single quotes or bash
history expansion eats them (`-bash: !w2: event not found`), and the CLI has **no `env ls`** — only
`set` and `rm`, so a variable can only be confirmed by behaviour.
