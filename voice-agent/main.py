"""
Tori's Cartesia voice agent.

One agent answers for every salon. Which salon a caller reached is decided by the number they
dialled, and everything that differs between businesses — name, greeting, hours, services, prices,
policy, FAQ, even the voice — is fetched from Tori at call time.

## Why the context is fetched before the conversation starts

The obvious design is a `get_context` tool the model calls on its first turn. That was tried, and it
fails in a specific way: with no tool actually registered, the model does the only thing left to it
and *asks the caller* for the arguments. A real caller was asked, out loud, for "the number you
called and your number". Even with the tool registered it is the wrong shape — the model can decline
to call it, call it late, or start talking before the answer arrives, and the salon's own greeting
cannot be spoken until it does.

So the fetch happens in `pre_call_handler`, before the agent exists. By the time anyone speaks we
already know the salon, its greeting, and its voice. The model cannot get this wrong because it is
never asked to.

The result is handed to `get_agent` in-process rather than through `PreCallResult.metadata`:
Cartesia replaces that metadata with its own before the agent sees it, so anything put there is
lost. `get_agent` re-fetches if the handover is missing, which makes the salon depend only on the
dialled number that is on every `CallRequest`.

## Deploy

    cd voice-agent && cartesia deploy

Env: TORI_API_URL, CARTESIA_TOOL_SECRET (must match the backend's), plus a model key.
"""

import logging
import os
import threading
import re
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Annotated, Any, Dict, Optional

import httpx

# Imported from the package root, not from line.voice_agent_app. The docs show
# `from line.voice_agent_app import AgentEnv, ...`, but AgentEnv is defined in line/agent.py and is
# only re-exported at the top level — that import raises ImportError against cartesia-line 0.2.16.
from line import AgentEnv, CallRequest, PreCallResult, VoiceAgentApp
from line.llm_agent import LlmAgent, LlmConfig, end_call

# LiteLLM is what cartesia-line calls under the hood (see line/llm_agent/http_provider.py), which
# makes its success callback the only place the agent's token usage is visible to us.
# NOT imported here. `import litellm` costs ~3.5 seconds, and it is the single largest thing
# standing between a cold container and a caller hearing a word — measured against `line.llm_agent`
# itself, which loads in 0.6s and does not pull litellm in at all. That cost was ours, paid at
# module scope, for a callback that only fires *after* a call is answered.
#
# So it is loaded on a background thread while the process finishes starting. Python's import lock
# makes that safe: whichever of this thread and the first real completion gets there first, the
# other waits, and neither loads it twice.
#
# The measurement, so nobody has to redo it: litellm 3.5s, httpx 1.8s, line 0.6s. The first caller
# after every deploy paid all of it.

logger = logging.getLogger("tori")
# Cartesia's runtime configures loguru for the SDK's own output and leaves the standard library's
# root logger at its WARNING default, so every logger.info here was silently dropped — including the
# one line that says which salon, voice and transfer number a call resolved to. Diagnosing anything
# from a call log meant reading warnings and inferring the rest. Own the handler explicitly.
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s | tori | %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

TORI_API_URL = os.environ.get("TORI_API_URL", "").rstrip("/")
TOOL_SECRET = os.environ.get("CARTESIA_TOOL_SECRET", "")
# Haiku, not DeepSeek, and deliberately: on the phone the only latency that matters is time to
# first token, and published figures put Haiku 4.5 near 100-150ms against DeepSeek's 0.8-1.8s. That
# gap is inaudible in WhatsApp and unbearable in a conversation — a second of silence after someone
# stops speaking reads as a dropped call, and they start talking again over the answer. The token
# price is roughly 7x higher and it is still the right trade here; the WhatsApp bot keeps DeepSeek,
# where the wait costs nothing.
MODEL = os.environ.get("TORI_AGENT_MODEL", "anthropic/claude-haiku-4-5-20251001")
_KEY_BY_PROVIDER = {"anthropic": "ANTHROPIC_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}

# Import time, so it identifies the process rather than the request. Reported by /health — see the
# note there for what it is for.
STARTED_AT = datetime.now(ZoneInfo("UTC")).isoformat()


def _model_api_key(model: str) -> tuple[str, str]:
    """
    The key belonging to the provider named in MODEL, and the variable it came from.

    This used to be a flat `TORI_AGENT_API_KEY or ANTHROPIC_API_KEY or DEEPSEEK_API_KEY`, with a
    comment telling whoever changed the model to swap the key too. That instruction cannot be
    followed on a service that holds both keys — and this one does, because provisioning copies
    the model key across. Setting TORI_AGENT_MODEL to a DeepSeek model would have handed DeepSeek
    an Anthropic key, and the failure mode is the bad one: the service boots, /health reports
    model_key true, the phone is answered, and every single turn dies on an auth error the caller
    hears as silence.

    So the provider decides, and there is deliberately no cross-provider fallback: a missing key
    for the configured provider yields an empty string, LlmAgent refuses to construct, /health
    reports model_key false, and the deploy workflow's gate fails the run. Loud and before any
    caller, rather than quiet and during every call.

    TORI_AGENT_API_KEY still wins outright and stays provider-agnostic — it is the explicit
    override, and someone who sets it has already decided.
    """
    explicit = os.environ.get("TORI_AGENT_API_KEY")
    if explicit:
        return explicit, "TORI_AGENT_API_KEY"
    name = _KEY_BY_PROVIDER.get(model.split("/", 1)[0] if "/" in model else "")
    if name:
        return os.environ.get(name, ""), name
    # A provider we have no mapping for: nothing to be principled about, so try both rather than
    # refuse to start on a model that might work fine.
    for fallback in ("ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"):
        value = os.environ.get(fallback)
        if value:
            return value, fallback
    return "", ""


# LlmAgent raises if this is empty, so a missing key fails at deploy rather than mid-call.
MODEL_API_KEY, MODEL_API_KEY_SOURCE = _model_api_key(MODEL)

# Israeli salons and B&Bs; the STT and TTS both need telling, and the voice picked in the dashboard
# is Hebrew-capable by construction (the picker filters on it).
LANGUAGE = "he"

# Which gender this deployment speaks about itself in.
#
# Hebrew marks gender on every verb, so the agent has to know before it says a word. This used to be
# derived per call from Cartesia's voice catalogue, which meant an outbound request to Cartesia
# sitting between the phone being answered and the greeting — grammar bought with dead air.
#
# It is a property of the deployment, not of the call: there are two agents, one masculine and one
# feminine, and every call an agent takes is in its own gender. So it is read once, from the
# environment, and costs nothing per call.
#
# `/context` still sends `voiceGender` and it is still honoured when this is unset, so an older
# deployment keeps working — but on a configured agent this wins, because the catalogue can only
# ever be a guess at what this particular deployment sounds like.
AGENT_GENDER = os.environ.get("TORI_AGENT_GENDER", "").strip().lower()

# Spoken aloud, so they are sentences rather than error codes. Used when Tori cannot be reached at
# all — a caller must never hear silence or a stack trace.
#
# Inflected, because this is one of the few lines the agent speaks without the model's involvement:
# a masculine agent apologising in "מצטערת" is the first thing a caller would hear on the worst call
# we have, and it is the sentence that has to sound most like a person.
_UNREACHABLE = {
    "feminine": "מצטערת, יש תקלה זמנית במערכת ואני לא מצליחה לגשת לפרטים. אפשר לנסות שוב בעוד כמה דקות.",
    "masculine": "מצטער, יש תקלה זמנית במערכת ואני לא מצליח לגשת לפרטים. אפשר לנסות שוב בעוד כמה דקות.",
}
UNREACHABLE_HE = _UNREACHABLE.get(AGENT_GENDER, _UNREACHABLE["feminine"])


_HTTP: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    """
    One connection pool for the process, not one per request.

    A fresh `AsyncClient` per call meant a fresh TCP connect and TLS handshake to the backend on
    every tool call and on the context fetch — and the context fetch is the one thing standing
    between the phone being answered and the caller hearing a word. Keeping the pool alive turns
    the repeat cost into a single round trip.
    """
    global _HTTP
    if _HTTP is None or _HTTP.is_closed:
        _HTTP = httpx.AsyncClient(timeout=10.0)
    return _HTTP


async def _post(path: str, payload: Dict[str, Any]) -> tuple[int, Dict[str, Any]]:
    """One place that knows how to talk to Tori, so auth and timeouts cannot drift apart."""
    if not TORI_API_URL:
        raise RuntimeError("TORI_API_URL is not set — run: cartesia env set TORI_API_URL=https://…")
    # Without this, the header is the bare string "Bearer " and httpx refuses to send it at all:
    # `LocalProtocolError: Illegal header value b'Bearer '`, five frames deep in httpcore, which
    # reads like a network fault rather than an unset variable. Say what it actually is.
    if not TOOL_SECRET:
        raise RuntimeError("CARTESIA_TOOL_SECRET is not set — run: cartesia env set CARTESIA_TOOL_SECRET=…")
    res = await _client().post(
        f"{TORI_API_URL}{path}",
        json=payload,
        headers={"Authorization": f"Bearer {TOOL_SECRET}"},
    )
    try:
        body = res.json()
    except Exception:
        body = {"error": res.text[:300]}
    return res.status_code, body


# How many transcript turns have already been posted for each call, so each turn is stored once.
# Keyed by the same (called|caller) pair the transcript is filed under; a handful of ints per call,
# swept when the process restarts, which is the same lifetime as the call itself.
_TRANSCRIPT_SENT: Dict[str, int] = {}


async def _post_transcript(called: str, caller: str, messages: Any) -> None:
    """
    Stores the turns of this call that Tori has not seen yet.

    Read off the message list LiteLLM is about to send, because that list IS the conversation and
    it costs nothing extra to look at. Posted per turn rather than as one summary at the end: a
    call can drop at any moment, and a transcript that only survives a clean goodbye is missing
    exactly the calls worth reading.

    Never raises. A lost transcript row is a gap in the dashboard; an exception here is a caller
    hearing silence.
    """
    try:
        if not isinstance(messages, list):
            return
        turns = [
            {"role": m["role"], "content": m["content"].strip()}
            for m in messages
            if isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)
            and m.get("content", "").strip()
        ]
        key = f"{called}|{caller}"
        already = _TRANSCRIPT_SENT.get(key, 0)
        fresh = turns[already:]
        if not fresh:
            return
        status, _body = await _post(
            "/api/voice/transcript",
            {"calledNumber": called, "callerNumber": caller, "turns": fresh[-20:]},
        )
        if status == 200:
            _TRANSCRIPT_SENT[key] = len(turns)
    except Exception:
        logger.exception("transcript post failed")


async def _report_usage(kwargs, response_obj) -> None:
    """
    Reports the agent's token usage to Tori, so voice spend appears in the same ledger as WhatsApp.

    Hooked into LiteLLM rather than into the Cartesia SDK because that is where the numbers exist:
    `LlmAgent` streams through `litellm.acompletion` and its `StreamChunk` carries only text and
    tool calls — usage never reaches any surface the SDK exposes to us. LiteLLM's success callback
    sees the completed response, including the usage block, for every call the agent makes.

    Which call belongs to which salon is carried on the request itself (`metadata`), since this
    callback is global and fires for concurrent calls to different businesses on one worker. Reading
    it from a module-level "current call" would attribute one salon's tokens to another the moment
    two people phone at once.

    A plain function rather than the callback class itself: the class has to subclass LiteLLM's
    CustomLogger, and importing that is what used to cost every first caller 3.5 seconds. The
    subclass is built in `_usage_reporter()` once litellm is actually loaded.
    """
    try:
        meta = (kwargs.get("litellm_params") or {}).get("metadata") or {}
        called = meta.get("tori_called_number")
        if not called:
            return  # not one of ours (or a warmup call) — nothing to attribute

        usage = getattr(response_obj, "usage", None)
        if usage is None:
            return
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        # Both providers fold cached tokens into prompt_tokens, but report them in different
        # fields. DeepSeek puts hits in prompt_cache_hit_tokens; LiteLLM normalizes Anthropic
        # into prompt_tokens_details (cached_tokens = reads, cache_creation_tokens = writes),
        # and Anthropic's prompt_tokens includes BOTH. Reading only DeepSeek's field priced
        # every cached Haiku token at the full input rate — quietly undoing, in the ledger,
        # exactly the discount the cache_control work went in to buy.
        details = getattr(usage, "prompt_tokens_details", None)
        cache_read = (
            (getattr(usage, "prompt_cache_hit_tokens", 0) or 0)
            or (getattr(details, "cached_tokens", 0) or 0)
        )
        cache_write = getattr(details, "cache_creation_tokens", 0) or 0

        await _post_transcript(called, meta.get("tori_caller_number") or "unknown", kwargs.get("messages"))

        await _post(
            "/api/voice/usage",
            {
                "calledNumber": called,
                "callerNumber": meta.get("tori_caller_number") or "unknown",
                "model": _billed_model_name(kwargs.get("model") or MODEL),
                "inputTokens": max(0, prompt_tokens - cache_read - cache_write),
                "outputTokens": getattr(usage, "completion_tokens", 0) or 0,
                "cacheReadTokens": cache_read,
                "cacheCreationTokens": cache_write,
            },
        )
    except Exception:
        # Never let cost bookkeeping touch a live call. A lost ledger row is a reporting gap;
        # an exception raised inside a callback during a call is a caller hearing silence.
        logger.exception("usage report failed")


def _usage_reporter():
    """Builds the LiteLLM callback object. Imports inside, so module load stays cheap."""
    from litellm.integrations.custom_logger import CustomLogger  # noqa: PLC0415 — see import note

    class _UsageReporter(CustomLogger):
        async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
            await _report_usage(kwargs, response_obj)

    return _UsageReporter()


def _billed_model_name(model: str) -> str:
    """
    The bare model id, matching the keys in the backend's rate table.

    LiteLLM works in "provider/model" form while the ledger is keyed on model alone, so
    "deepseek/deepseek-chat" has to arrive as "deepseek-chat" or it silently prices at null.
    """
    return model.split("/", 1)[1] if "/" in model else model


def _usage_metadata(called: str, caller: str) -> Dict[str, Any]:
    """Per-request metadata the usage callback reads back. See `_UsageReporter`."""
    return {"metadata": {"tori_called_number": called, "tori_caller_number": caller}}


def _latency_extra(model: str) -> Dict[str, Any]:
    """
    LiteLLM parameters intended to buy time to first token, which on a phone line is the only
    latency anyone hears.

    Prompt caching was the big one, and measurement says it is currently doing nothing. The system
    prompt carries the whole salon — services, prices, hours, policy, FAQ — and is re-sent verbatim
    on every turn. `cache_control_injection_points` tells LiteLLM to mark the system message as
    cacheable, and Anthropic would then serve it from cache on later turns.

    ‼️ Anthropic publishes a *minimum cacheable prefix* per model, and on Haiku 4.5 it is 4096
    tokens. A shorter prompt is not cached even with the marker set: no error, no warning, the
    marker is simply ignored. This salon's prompt is under that floor, and `bench_ttft.py` confirms
    it — the cached variant reports `cache_read_input_tokens: 0` on every sample and lands within
    noise of the uncached one. So this parameter is inert today.

    It is kept rather than deleted because it costs nothing to send and starts working by itself
    the moment either side of the inequality moves: a longer prompt, or a model with a lower floor
    (the newest are 512-1024). The docstring is the thing that had to change — it claimed
    200-400ms and a tenth of the input cost, and a future reader would have gone on believing a
    saving that was never being made.

    Anthropic-only, deliberately. The hook rewrites the message into content blocks carrying
    `cache_control`, which is Anthropic's shape — DeepSeek caches server-side on its own and has no
    use for it, and sending it a shape it does not expect risks a 400 on every turn of every call.
    """
    if not model.startswith("anthropic/"):
        return {}
    return {"cache_control_injection_points": [{"location": "message", "role": "system"}]}


def _stream_usage_option(model: str) -> Dict[str, Any]:
    """
    OpenAI-compatible providers (DeepSeek among them) only emit usage on a streamed response when
    asked. Anthropic's API rejects the parameter outright and reports usage on its stream anyway, so
    it is attached by provider rather than unconditionally — a 400 here would take every call down,
    not just the bookkeeping.
    """
    return {} if model.startswith("anthropic/") else {"stream_options": {"include_usage": True}}


_STREAM_USAGE_OPTION: Dict[str, Any] = _stream_usage_option(MODEL)
_LATENCY_EXTRA: Dict[str, Any] = _latency_extra(MODEL)

# Global by design: LiteLLM has no per-request callback hook, and the callback attributes each call
# via request metadata rather than shared state (see `_UsageReporter`).
#
# Registered from a background thread so the ~3.5s litellm import never sits between the container
# starting and the phone being answered. The callback is only needed once a completion finishes,
# which is seconds after the greeting at the earliest.
def _register_usage_callback() -> None:
    if not (TORI_API_URL and TOOL_SECRET):
        logger.warning("usage reporting disabled: TORI_API_URL or CARTESIA_TOOL_SECRET unset")
        return
    try:
        import litellm  # noqa: PLC0415 — deliberately not at module scope; see the note on imports

        # litellm prints a "Give Feedback / Get Help: <github issues url>" banner to stderr on
        # every failed request, outside our logging entirely. One failure per call — a wrong key,
        # a warm-up that could not connect — would put three lines of advertisement into the call
        # log between the lines that say which salon answered. Set once, here, where litellm is
        # already being imported off the startup path. It suppresses the banner only; real error
        # messages still come through.
        litellm.suppress_debug_info = True

        litellm.callbacks = [*getattr(litellm, "callbacks", []), _usage_reporter()]
        logger.info("usage reporting enabled")
    except Exception:
        # A missing cost report is a gap in a dashboard. Refusing to answer the phone over it is not
        # a trade anyone would choose.
        logger.exception("could not enable usage reporting")


threading.Thread(target=_register_usage_callback, name="litellm-warmup", daemon=True).start()


def _warm_model_connection() -> None:
    """
    Opens the connection to the model provider during the ring, so the caller's first turn does
    not pay for the handshake.

    In every benchmark variant the first sample is the slow one — 726ms against 621 and 632 on one
    run, 923ms against ~650 on another — and the gap is DNS, TCP and the TLS handshake, not the
    model. A long-lived process usually has that connection already open, so this costs nothing
    most of the time. It matters for exactly the case that has been the problem all along: the
    first call after a quiet stretch, where the pool has idled out and the caller is the one who
    pays to re-establish it.

    It must go through litellm rather than a bare socket. The connection pool that the agent's
    completions use is litellm's own, so a connection opened with any other client is a different
    connection and warms nothing.

    Fire-and-forget on a thread: `litellm.completion` is blocking, and pre_call_handler is on the
    event loop with a phone ringing on the other end. Nothing here can delay or fail the call —
    the result is discarded and every exception is swallowed, because a failed warm-up is a call
    that is merely as slow as it used to be.

    Cost is one ~10-token request per call, against the dozens the conversation itself makes. Not
    deduplicated across back-to-back calls for that reason: the bookkeeping would cost more than
    the request it saves.
    """
    if not MODEL_API_KEY:
        return

    def _run() -> None:
        try:
            import litellm  # noqa: PLC0415 — same reason as the callback above

            litellm.completion(
                model=MODEL,
                api_key=MODEL_API_KEY,
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=1,
                timeout=5.0,
            )
        except Exception:
            # debug, not warning: this failing is invisible to the caller by design, and a
            # warning per call would train everyone to ignore the log.
            logger.debug("model connection warm-up failed", exc_info=True)

    threading.Thread(target=_run, name="model-connection-warmup", daemon=True).start()


def caller_number(call_request: CallRequest) -> str:
    """
    The caller's number, or a placeholder the backend will accept.

    cartesia-line 0.2.16 loses it on this path. `CallRequest.from_` is declared with
    `alias="from"` — the name the harness actually puts on the wire, as its own `StartInput` model
    confirms — but `VoiceAgentApp.create_chat_session` builds the request with
    `body.get("from_", "unknown")`, reading the *field* name rather than the alias. So inside
    `pre_call_handler` the caller number is the literal string "unknown" no matter who dialled.

    That is survivable: the caller number only personalises the greeting, and `/context` requires a
    non-empty string rather than a valid number. It is not survivable silently, hence the warning —
    a salon reporting "it never recognises returning customers" should land on this line, not on a
    hunt through our own lookup code.
    """
    raw = (call_request.from_ or "").strip()
    if not raw or raw == "unknown":
        logger.warning("caller number unavailable from the SDK; continuing without it")
        return "unknown"
    return raw


_CONTEXT_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
# Short enough that a price or hours edit in the dashboard reaches the phone within a minute, long
# enough that a run of calls to one salon pays for the fetch once.
_CONTEXT_TTL = 60.0


async def resolve_context(call_request: CallRequest) -> Dict[str, Any]:
    """
    Asks Tori who this call is for. Returns `{"context": {...}}` or `{"error": "<spoken sentence>"}`.

    Never raises and never returns nothing: a caller must always hear a sentence, so every failure
    becomes one. The backend's own 402/404 bodies are already written to be read aloud.

    Cached briefly per dialled number because the `_PENDING` agent handover does not survive in the
    deployed topology: `pre_call_handler` and the websocket session run in different processes, so
    `get_agent` finds nothing prepared and refetches *after the call is answered* — and every
    millisecond of that fetch is silence on an answered line. The cache does not fix the first call
    into a cold worker, which still pays the round trip; it stops every call after it from paying
    again. Errors are deliberately not cached: a failed fetch must be retried on the next call, not
    turned into a minute of apologies.
    """
    # Keyed on dialled AND caller number, never on the salon alone: the response carries a
    # `caller` block (isKnownCustomer, name, upcomingAppointment), so a salon-wide cache would greet
    # the next caller by the previous caller's name and read out their appointment. In practice the
    # key is usually "<number>|unknown" because cartesia-line 0.2.16 loses the caller ID on this
    # path (see caller_number), which is what makes the cache hit at all.
    cache_key = f"{call_request.to}|{caller_number(call_request)}"
    cached = _CONTEXT_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _CONTEXT_TTL:
        logger.info("context cache hit for %s", call_request.to)
        return {"context": cached[1]}

    try:
        status, body = await _post(
            "/api/voice/context",
            {"calledNumber": call_request.to, "callerNumber": caller_number(call_request)},
        )
    except Exception:  # network, DNS, timeout, malformed auth header
        logger.exception("context fetch failed for %s", call_request.to)
        return {"error": UNREACHABLE_HE}

    if status != 200:
        # 404 = no salon on this number, 402 = subscription/plan. Both carry a spoken sentence;
        # falling back only if one somehow does not.
        logger.warning("context %s for %s: %s", status, call_request.to, body)
        return {"error": body.get("error") or UNREACHABLE_HE}

    # A 200 without a business name is not a context. Letting it through builds an agent whose
    # greeting is "שלום, הגעתם ל" and whose prompt lists no services — a bot that sounds like it is
    # working while knowing nothing, which is the hardest failure to diagnose from a phone call.
    if not body.get("businessName"):
        logger.error("context 200 for %s but no businessName; keys=%s", call_request.to, sorted(body))
        return {"error": UNREACHABLE_HE}

    logger.info("context resolved for %s: %s", call_request.to, body.get("businessName"))
    _CONTEXT_CACHE[cache_key] = (time.monotonic(), body)
    for key, (at, _) in list(_CONTEXT_CACHE.items()):
        if time.monotonic() - at > _CONTEXT_TTL:
            _CONTEXT_CACHE.pop(key, None)
    return {"context": body}


# Agents built during the ring, waiting for the websocket to arrive.
#
# Keyed by the dialled number, not the call id. A live call showed the two hops disagreeing about
# the id — pre_call_handler stored one, the websocket start message carried 'PA_GMGzcsM7PSLM', and
# the prepared agent was thrown away and rebuilt after the answer, which is exactly the dead air
# this exists to remove. The dialled number is the one identifier both hops agree on, because it is
# what the SIP trunk routed on.
#
# Two callers reaching the same salon within the window get the same prepared agent. That is
# harmless here: the agent is built from the salon's context and the dialled number, and the caller
# number is "unknown" in pre_call_handler anyway (see caller_number), so both would be identical.
_PENDING: Dict[str, tuple[float, "LlmAgent"]] = {}
_PENDING_TTL = 120.0


def _remember(dialled: str, agent: "LlmAgent") -> None:
    now = time.monotonic()
    # Calls whose websocket never arrived. Cheap to sweep here rather than run a timer.
    for key, (at, _) in list(_PENDING.items()):
        if now - at > _PENDING_TTL:
            _PENDING.pop(key, None)
    _PENDING[dialled] = (now, agent)


def _take(dialled: str) -> Optional["LlmAgent"]:
    entry = _PENDING.pop(dialled, None)
    if entry is None:
        return None
    at, agent = entry
    if time.monotonic() - at > _PENDING_TTL:
        return None
    return agent


async def pre_call_handler(call_request: CallRequest) -> Optional[PreCallResult]:
    """
    Resolves the salon and its voice before the agent is built.

    Returning None would reject the call with a 403, which the caller hears as a line that answers
    and dies. Every failure here instead produces a call that connects and explains itself.
    """
    # First line of the call in the logs, and the one that says whether this code is serving at all.
    # An agent whose console prompt answered instead prints nothing here.
    logger.info("pre_call_handler: to=%r from=%r call_id=%r", call_request.to, call_request.from_, call_request.call_id)

    # First thing, before the context fetch: it runs on its own thread, so the earlier it starts
    # the more of the ring it has to finish the handshake in. See `_warm_model_connection`.
    _warm_model_connection()

    started = time.monotonic()
    resolved = await resolve_context(call_request)
    fetched_ms = (time.monotonic() - started) * 1000

    # Built here rather than in get_agent, which runs only after the call is answered. Cartesia
    # rings an inbound call for five seconds precisely so this can happen first ("Pre-Call
    # Initialization" in their deployment docs) — work left until after the answer is dead air.
    agent = build_agent(resolved, call_request.to, caller_number(call_request))
    _remember(call_request.to, agent)

    ctx = resolved.get("context") or {}
    logger.info(
        "pre_call_handler ready in %.0fms (context %.0fms) — salon=%r voice=%s transfer=%s",
        (time.monotonic() - started) * 1000, fetched_ms,
        ctx.get("businessName"), ctx.get("voiceGender") or "default",
        "yes" if ctx.get("ownerTransferNumber") else "NO",
    )

    tts: Dict[str, Any] = {"language": LANGUAGE}
    # The salon's own voice, chosen in the dashboard. Null means "whatever the agent is set to",
    # which is exactly the behaviour before the setting existed — so it is simply left out. Unlike
    # metadata, config *is* honoured: the voice applied here is the one the first word is spoken in.
    voice_id = (resolved.get("context") or {}).get("voiceId")
    if voice_id:
        tts["voice_id"] = voice_id

    # Still sent, in case Cartesia starts echoing it back; get_agent prefers it when present.
    return PreCallResult(metadata={"tori": resolved}, config={"tts": tts})


# Hebrew numbers agree in gender with what they count, and the model cannot know which noun a bare
# digit belongs to: "2 לילות" is read as שתיים or שניים depending on the guess, and only שני is
# right. So anything read aloud is written as words here, where the noun is known.
#
# Standalone forms. 1 and 2 are special before a noun (שני לילות, שתי שעות) and are handled at the
# call sites, which know the noun.
_ONES_M = ["", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה", "עשרה"]
_ONES_F = ["", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"]
_TEENS_M = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר",
            "שישה עשר", "שבעה עשר", "שמונה עשר", "תשעה עשר"]
_TEENS_F = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה",
            "שש עשרה", "שבע עשרה", "שמונה עשרה", "תשע עשרה"]
_TENS = ["", "עשר", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]


def _he_num(n: int, feminine: bool = False) -> str:
    """1–99 in words. Outside that range the digits are returned and the prompt's rule covers it."""
    if not 1 <= n <= 99:
        return str(n)
    ones, teens = (_ONES_F, _TEENS_F) if feminine else (_ONES_M, _TEENS_M)
    if n <= 10:
        return ones[n]
    if n < 20:
        return teens[n - 10]
    tens, rest = divmod(n, 10)
    return _TENS[tens] if not rest else f"{_TENS[tens]} ו{ones[rest]}"


HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
             "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def _fmt_date(iso: str) -> str:
    """`2026-08-12` → `שנים עשר באוגוסט`. Unparseable input is passed through untouched."""
    try:
        y, m, d = (int(x) for x in str(iso)[:10].split("-"))
        return f"{_he_num(d)} ב{HE_MONTHS[m - 1]}"
    except Exception:
        return str(iso)


HE_WEEKDAYS = ["יום שני", "יום שלישי", "יום רביעי", "יום חמישי",
               "יום שישי", "שבת", "יום ראשון"]  # indexed by date.weekday(), Monday=0


def _today_block(now: Optional[datetime] = None) -> str:
    """
    What day it is, in the prompt.

    Without this the agent has no clock at all. On a live call someone asked for a room "מחר" and
    the agent answered "מחר זה יום כמה?" — then apologised that it cannot see today's date. Every
    real booking conversation is anchored on today ("מחר", "בסופ\"ש", "עוד שבוע"), so a booking
    agent that does not know the date cannot take a booking.

    Israel time, not the container's UTC: at 01:00 Israel time UTC still says yesterday, and being
    one day off is worse than being vague.
    """
    now = now or datetime.now(ZoneInfo("Asia/Jerusalem"))
    d = now.date()
    tomorrow = d + timedelta(days=1)
    return (
        f"היום {HE_WEEKDAYS[d.weekday()]}, {_fmt_date(d.isoformat())}. "
        f"מחר {HE_WEEKDAYS[tomorrow.weekday()]}, {_fmt_date(tomorrow.isoformat())}. "
        'חשב תאריכים יחסיים ("מחר", "בסופ"ש הקרוב", "עוד שבוע") מהיום הזה, ואל תשאל את המתקשר מה התאריך.'
    )


def _fmt_clock(minutes: int) -> str:
    """
    Minutes past midnight as someone says a time: `540` → `תשע בבוקר`.

    שעה is feminine, so the hour takes the feminine forms — תשע, not תשעה.
    """
    h, mm = divmod(minutes % (24 * 60), 60)
    if h < 5:
        part = "בלילה"
    elif h < 12:
        part = "בבוקר"
    elif h < 17:
        part = "בצהריים"
    elif h < 21:
        part = "בערב"
    else:
        part = "בלילה"
    # Quarters have their own forms and are what appointment slots actually land on: 8:45 is
    # "רבע לתשע", never "שמונה וארבעים וחמש".
    if mm == 45:
        return f"רבע ל{_he_num((h + 1) % 12 or 12, feminine=True)} {part}"
    spoken = _he_num(h % 12 or 12, feminine=True)
    if mm == 30:
        spoken += " וחצי"
    elif mm == 15:
        spoken += " ורבע"
    elif mm:
        spoken += f" ו{_he_num(mm, feminine=True)}"
    return f"{spoken} {part}"


def _spoken_clock(hhmm: str) -> str:
    """`14:30` → `שתיים וחצי בצהריים`. Anything unparseable is left alone rather than mangled."""
    try:
        h, m = (int(x) for x in str(hhmm).split(":")[:2])
    except Exception:
        return str(hhmm)
    return _fmt_clock(h * 60 + m)


def _fmt_datetime(iso: str) -> str:
    """`2026-08-12T09:00:00Z` → `שנים עשר באוגוסט בשעה תשע בבוקר`, never read out as-is."""
    text = str(iso)
    if "T" not in text:
        return _fmt_date(text)
    date_part, time_part = text.split("T", 1)
    try:
        h, m = int(time_part[:2]), int(time_part[3:5])
    except Exception:
        return _fmt_date(date_part)
    return f"{_fmt_date(date_part)} בשעה {_fmt_clock(h * 60 + m)}"


# Emoji, ZWJ sequences and variation selectors. A WhatsApp greeting is full of them and the TTS
# reads each one out — a real call opened with the agent saying "🌿" aloud.
_DECORATION = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D\u2190-\u21FF]")


def _same_number(a: str, b: str) -> bool:
    """Digits only, last nine compared: 972533391353, +972-53-339-1353 and 0533391353 are one line."""
    da, db = re.sub(r"\D", "", a or ""), re.sub(r"\D", "", b or "")
    return bool(da) and bool(db) and da[-9:] == db[-9:]


def spoken_greeting(salon: Dict[str, Any]) -> str:
    """
    The first thing the caller hears.

    `greeting` comes from `botGreeting`, which is written for WhatsApp: several lines, emoji, an
    intake form, and sometimes bracket placeholders the WhatsApp bot itself refuses to send raw.
    Spoken down a phone line that is a minute of talking before the caller can say a word.

    A greeting written deliberately short is still honoured — one line, no placeholders, and short
    enough to say in a breath. Anything larger is a chat greeting, and gets a spoken one instead.
    """
    name = str(salon.get("businessName") or "").strip()
    raw = _DECORATION.sub("", str(salon.get("greeting") or "")).strip()
    if raw and "\n" not in raw and len(raw) <= 120 and "[" not in raw:
        return raw
    # "כאן X" is how Israeli businesses answer the phone, and it avoids the ל+ה contraction that
    # "הגעתם ל…" hits on any name starting with ה — no rule separates להרמוניה from למספרה.
    return f"שלום, כאן {name}. איך אפשר לעזור?" if name else "שלום, איך אפשר לעזור?"


def _fmt_duration(minutes: int) -> str:
    """
    A duration as someone would say it on the phone.

    The database stores minutes because that is what the calendar needs. Read out, that turns an
    overnight stay into "אלף ארבע מאות וארבעים דקות" — a number no guest has ever used for one
    night. The unit has to change with the size, the way speech does.
    """
    if minutes % 1440 == 0:
        nights = minutes // 1440
        # לילה is masculine, and 2 takes the construct form: שני לילות, not שניים לילות.
        return {1: "לילה אחד", 2: "שני לילות"}.get(nights, f"{_he_num(nights)} לילות")
    if minutes < 60:
        return f"{_he_num(minutes, feminine=True)} דקות"
    hours, rest = divmod(minutes, 60)
    # שעה is feminine; 2 hours is the dual שעתיים rather than a counted form.
    whole = {1: "שעה", 2: "שעתיים"}.get(hours, f"{_he_num(hours, feminine=True)} שעות")
    if rest == 30:
        return f"{whole} וחצי"
    if rest:
        return f"{whole} ו{_he_num(rest, feminine=True)} דקות"
    return whole


def _fmt_services(ctx: Dict[str, Any]) -> str:
    lines = []
    for s in ctx.get("services") or []:
        bits = [s.get("name", "")]
        if s.get("priceIls") is not None:
            bits.append(f"{s['priceIls']} ש\"ח")
        if s.get("durationMin"):
            bits.append(_fmt_duration(int(s["durationMin"])))
        if s.get("capacity"):
            bits.append(f"עד {_he_num(int(s['capacity']))} אורחים")
        if s.get("description"):
            bits.append(str(s["description"]))
        lines.append(" — ".join(str(b) for b in bits if b))
    return "\n".join(f"- {l}" for l in lines) if lines else "(אין שירותים מוגדרים)"


DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]


def _fmt_hours(ctx: Dict[str, Any]) -> str:
    out = []
    for h in ctx.get("hours") or []:
        day = DAYS_HE[h["dayOfWeek"] % 7]
        o, c = h["openMin"], h["closeMin"]
        out.append(f"- {day}: מ{_fmt_clock(o)} עד {_fmt_clock(c)}")
    return "\n".join(out) if out else "(שעות לא הוגדרו)"


# Hebrew marks gender on every verb, so an agent cannot be written once and voiced either way. A
# feminine voice saying "אני מעביר אותך" is wrong in a way that has no English equivalent — it is not
# a style choice, it is a grammatical error the caller hears immediately.
#
# The forms are written out per gender rather than derived by substitution: Hebrew inflection is not
# a suffix swap (שתקי/שתוק, פני/פנה, אמרי/אמור), and a rule that "usually" conjugates correctly would
# produce invented words on the exceptions.
def _forms_for(context_gender: Optional[str]) -> Dict[str, str]:
    """This deployment's gender if it declares one, otherwise whatever /context worked out."""
    return FORMS.get(AGENT_GENDER) or FORMS.get(context_gender or "") or FORMS["feminine"]


FORMS = {
    "feminine": {
        "answers": "את עונה לשיחות טלפון של",
        "speaks": "את מדברת, לא כותבת: משפטים קצרים, בלי רשימות, בלי סימני פיסוק מיוחדים.",
        "address": "פני ל{who} בגוף שני, בעברית, בטון חם ומקצועי.",
        "self": 'כשאת מדברת על עצמך — כל פועל, כל שם תואר וכל צורת גוף ראשון בלשון נקבה יחיד, בלי יוצא מן הכלל: "אני בודקת", "אני מעבירה", "אני שמחה", "אני צריכה", "אני מבינה", "אני לא בטוחה". הכלל חל גם על מילים שלא מופיעות ברשימה הזאת — אם פועל לא מופיע כאן, הטי אותו לנקבה בעצמך ואל תשתמשי בצורת הזכר.',
        "brief": "תשובה אחת — שני משפטים לכל היותר. אחר כך עצרי ותני לאדם לדבר.",
        "interrupted": "אם קטעו אותך — שתקי מיד והקשיבי.",
        "unclear": "אם לא הבנת מה נאמר, בקשי לחזור על זה. אל תנחשי.",
        "as_written": "אמרי אותם כפי שהם. אל תחשבי סכומים בעצמך.",
        "known": "המתקשר מוכר: {name}. פני אליו בשמו. מספר הטלפון שלו כבר ידוע למערכת ומועבר אוטומטית לבעל העסק — אל תבקשי אותו ואל תגידי שאינך רואה אותו.",
        "no_booking": "את לא סוגרת הזמנות. את נותנת מידע ומעבירה את השיחה לבעל העסק כשהמתקשר רוצה להזמין.",
        "transfer_say": "מעבירה אותך לבעל העסק, רגע אחד.",
        "transfer_is_caller": "המספר של בעל העסק הוא המספר שממנו את מתקשרת, אז אי אפשר להעביר. אמרי את זה והציעי לשלוח לו הודעה עם message_owner.",
        "can_transfer": "אם המתקשר מבקש לדבר עם אדם, עם בעל העסק או עם מישהו אחר — אל תתווכחי ואל תשאלי אותו שאלות קודם. השתמשי ב-transfer_to_owner מיד, עם מה שכבר ידוע לך; אם לא ידוע לך כלום, העבירי בלי סיכום. אם ההעברה לא מצליחה, השתמשי ב-message_owner.",
        "no_transfer": "אין אפשרות להעביר שיחות. אם מבקשים לדבר עם מישהו — השתמשי ב-message_owner כדי לשלוח לבעל העסק הודעה עם הבקשה, ואמרי שהוא יחזור אליהם.",
        "leave_message": "בכל מקרה שבו המתקשר רוצה משהו שאת לא יכולה לתת לו — השתמשי ב-message_owner. אל תבטיחי שמישהו יחזור אליו בלי לקרוא לכלי הזה.",
        "end_call": 'כשהשיחה נגמרה — המתקשר נפרד, אמר תודה וסיים, או אין לו עוד מה לשאול — אמרי משפט פרידה קצר ומיד אחריו קראי ל-end_call. אל תחכי שינתק. אם הוא עוד באמצע משהו, אל תסיימי.',
        "booking": "השתמשי ב-check_availability כדי לראות זמנים פנויים, ואז ב-book_appointment.",
        "no_invent": "אל תמציאי זמנים ואל תאשרי תור שלא חזר מ-book_appointment.",
        "verbatim": "העבירי ל-startTime בדיוק את המחרוזת שהתקבלה מ-check_availability.",
        "ask_phone": "לפני שאת קובעת תור, שאלי את המתקשר מה מספר הטלפון שלו והעבירי אותו ב-caller_phone.",
        "confirm_number": 'אם מתקשר מכתיב לך מספר טלפון — חזרי עליו ספרה-ספרה ובקשי אישור לפני שאת משתמשת בו. תמלול קולי טועה במספרים.',
        "no_media": 'כשמבקשים תמונות או פרטים — השתמשי ב-send_details ושלחי לוואטסאפ של המתקשר. אל תבקשי כתובת מייל: המספר שלו כבר ידוע והוואטסאפ הוא ברירת המחדל. רק אם הוא אומר שאין לו וואטסאפ, או מבקש מייל במפורש — בקשי כתובת מייל, חזרי עליה ובקשי אישור, ואז שלחי במייל. אל תגידי "נשלח" לפני שהכלי החזיר שהשליחה הצליחה.',
        "record_first": 'לפני שאת מעבירה שיחה או מסיימת אותה — קראי ל-message_owner עם כל מה שאספת: שם, יחידה, תאריכים, מספר לילות, מספר אנשים וכל בקשה מיוחדת. תמיד, גם אם את מעבירה. העברה יכולה להיכשל בלי שאף אחד ידע, וההודעה היא הדבר היחיד שנשאר אם היא נכשלה.',
        "rules": [
            'מספרים אמרי במילים ולא כספרות: "מאה ועשרים שקל".',
            "אל תשתמשי בכוכביות, בסולמיות או בכל סימון Markdown — כל תו שאת כותבת נאמר בקול.",
            'מספר טלפון הקריאי ספרה אחרי ספרה: "אפס ארבע, שש תשע תשע, תשע תשע אחת תשע". מקף בתוך מספר הוא שקט — לעולם אל תגידי "מינוס".',
            'כתובת אתר: קראי את השם, ואת הפיסוק אמרי במילה — "zimmermeron נקודה co נקודה IL". בלי הקידומת "אייץ טי טי פי אס". אל תמסרי כתובת אתר שלא כתובה במידע שקיבלת; אם אין כזו, אל תמציאי.',
            'שעות אמרי כמו בדיבור: "מתשע בבוקר עד שש בערב".',
            "אל תקראי רשימות שלמות — גם כששואלים אותך ישירות מה האפשרויות. הציעי שתיים או שלוש שמתאימות למה שביקשו, ואמרי שיש עוד. רשימה של ארבעה פריטים עם מחירים היא מונולוג של רבע דקה שאי אפשר לזכור בטלפון.",
            'ביטויים קבועים נאמרים בדיוק כפי שהם: "ברוך הבא", "תודה רבה", "יום טוב". אל תמציאי גרסה משלך, ואל תפתחי תשובה בקריאת התלהבות שלא ביקשו ("בהנאה!", "מצוין!"). תשובה מתחילה בעניין עצמו.',
            'אם את לא בטוחה במגדר של המתקשר — נסחי את המשפט בלי פנייה מגדרית: "אפשר לקבוע ליום שלישי".',
            'אל תשתמשי בצורות עם לוכסן ("מעוניין/ת") — הן נשמעות רע בדיבור.',
        ],
    },
    "masculine": {
        "answers": "אתה עונה לשיחות טלפון של",
        "speaks": "אתה מדבר, לא כותב: משפטים קצרים, בלי רשימות, בלי סימני פיסוק מיוחדים.",
        "address": "פנה ל{who} בגוף שני, בעברית, בטון חם ומקצועי.",
        "self": 'כשאתה מדבר על עצמך — כל פועל, כל שם תואר וכל צורת גוף ראשון בלשון זכר יחיד, בלי יוצא מן הכלל: "אני בודק", "אני מעביר", "אני שמח", "אני צריך", "אני מבין", "אני לא בטוח". הכלל חל גם על מילים שלא מופיעות ברשימה הזאת — אם פועל לא מופיע כאן, הטה אותו לזכר בעצמך ואל תשתמש בצורת הנקבה.',
        "brief": "תשובה אחת — שני משפטים לכל היותר. אחר כך עצור ותן לאדם לדבר.",
        "interrupted": "אם קטעו אותך — שתוק מיד והקשב.",
        "unclear": "אם לא הבנת מה נאמר, בקש לחזור על זה. אל תנחש.",
        "as_written": "אמור אותם כפי שהם. אל תחשב סכומים בעצמך.",
        "known": "המתקשר מוכר: {name}. פנה אליו בשמו. מספר הטלפון שלו כבר ידוע למערכת ומועבר אוטומטית לבעל העסק — אל תבקש אותו ואל תגיד שאינך רואה אותו.",
        "no_booking": "אתה לא סוגר הזמנות. אתה נותן מידע ומעביר את השיחה לבעל העסק כשהמתקשר רוצה להזמין.",
        "transfer_say": "מעביר אותך לבעל העסק, רגע אחד.",
        "transfer_is_caller": "המספר של בעל העסק הוא המספר שממנו אתה מתקשר, אז אי אפשר להעביר. אמור את זה והצע לשלוח לו הודעה עם message_owner.",
        "can_transfer": "אם המתקשר מבקש לדבר עם אדם, עם בעל העסק או עם מישהו אחר — אל תתווכח ואל תשאל אותו שאלות קודם. השתמש ב-transfer_to_owner מיד, עם מה שכבר ידוע לך; אם לא ידוע לך כלום, העבר בלי סיכום. אם ההעברה לא מצליחה, השתמש ב-message_owner.",
        "no_transfer": "אין אפשרות להעביר שיחות. אם מבקשים לדבר עם מישהו — השתמש ב-message_owner כדי לשלוח לבעל העסק הודעה עם הבקשה, ואמור שהוא יחזור אליהם.",
        "leave_message": "בכל מקרה שבו המתקשר רוצה משהו שאתה לא יכול לתת לו — השתמש ב-message_owner. אל תבטיח שמישהו יחזור אליו בלי לקרוא לכלי הזה.",
        "end_call": 'כשהשיחה נגמרה — המתקשר נפרד, אמר תודה וסיים, או אין לו עוד מה לשאול — אמור משפט פרידה קצר ומיד אחריו קרא ל-end_call. אל תחכה שינתק. אם הוא עוד באמצע משהו, אל תסיים.',
        "booking": "השתמש ב-check_availability כדי לראות זמנים פנויים, ואז ב-book_appointment.",
        "no_invent": "אל תמציא זמנים ואל תאשר תור שלא חזר מ-book_appointment.",
        "verbatim": "העבר ל-startTime בדיוק את המחרוזת שהתקבלה מ-check_availability.",
        "ask_phone": "לפני שאתה קובע תור, שאל את המתקשר מה מספר הטלפון שלו והעבר אותו ב-caller_phone.",
        "confirm_number": 'אם מתקשר מכתיב לך מספר טלפון — חזור עליו ספרה-ספרה ובקש אישור לפני שאתה משתמש בו. תמלול קולי טועה במספרים.',
        "no_media": 'כשמבקשים תמונות או פרטים — השתמש ב-send_details ושלח לוואטסאפ של המתקשר. אל תבקש כתובת מייל: המספר שלו כבר ידוע והוואטסאפ הוא ברירת המחדל. רק אם הוא אומר שאין לו וואטסאפ, או מבקש מייל במפורש — בקש כתובת מייל, חזור עליה ובקש אישור, ואז שלח במייל. אל תגיד "נשלח" לפני שהכלי החזיר שהשליחה הצליחה.',
        "record_first": 'לפני שאתה מעביר שיחה או מסיים אותה — קרא ל-message_owner עם כל מה שאספת: שם, יחידה, תאריכים, מספר לילות, מספר אנשים וכל בקשה מיוחדת. תמיד, גם אם אתה מעביר. העברה יכולה להיכשל בלי שאף אחד ידע, וההודעה היא הדבר היחיד שנשאר אם היא נכשלה.',
        "rules": [
            'מספרים אמור במילים ולא כספרות: "מאה ועשרים שקל".',
            "אל תשתמש בכוכביות, בסולמיות או בכל סימון Markdown — כל תו שאתה כותב נאמר בקול.",
            'מספר טלפון הקרא ספרה אחרי ספרה: "אפס ארבע, שש תשע תשע, תשע תשע אחת תשע". מקף בתוך מספר הוא שקט — לעולם אל תגיד "מינוס".',
            'כתובת אתר: קרא את השם, ואת הפיסוק אמור במילה — "zimmermeron נקודה co נקודה IL". בלי הקידומת "אייץ טי טי פי אס". אל תמסור כתובת אתר שלא כתובה במידע שקיבלת; אם אין כזו, אל תמציא.',
            'שעות אמור כמו בדיבור: "מתשע בבוקר עד שש בערב".',
            "אל תקרא רשימות שלמות — גם כששואלים אותך ישירות מה האפשרויות. הצע שתיים או שלוש שמתאימות למה שביקשו, ואמור שיש עוד. רשימה של ארבעה פריטים עם מחירים היא מונולוג של רבע דקה שאי אפשר לזכור בטלפון.",
            'ביטויים קבועים נאמרים בדיוק כפי שהם: "ברוך הבא", "תודה רבה", "יום טוב". אל תמציא גרסה משלך, ואל תפתח תשובה בקריאת התלהבות שלא ביקשו ("בהנאה!", "מצוין!"). תשובה מתחילה בעניין עצמו.',
            'אם אתה לא בטוח במגדר של המתקשר — נסח את המשפט בלי פנייה מגדרית: "אפשר לקבוע ליום שלישי".',
            'אל תשתמש בצורות עם לוכסן ("מעוניין/ת") — הן נשמעות רע בדיבור.',
        ],
    },
}

def build_prompt(ctx: Dict[str, Any], caller_known: bool = True) -> str:
    """
    The salon's data, rendered into the prompt rather than left for the model to ask about.

    Prices, hours and policy are stated verbatim and never computed: a voice agent that does
    arithmetic on a price list will eventually quote a total the salon does not honour.

    The agent speaks about itself in this deployment's own gender (TORI_AGENT_GENDER), falling back
    to the voice gender /context reports. Unknown keeps the feminine forms, which is what every
    salon heard before the setting existed.
    """
    vocab = ctx.get("vocabulary") or {}
    customer_word = vocab.get("customerHe") or "לקוח"
    inquiry = ctx.get("bookingModel") == "inquiry"
    caller = ctx.get("caller") or {}
    f = _forms_for(ctx.get("voiceGender"))

    parts = [
        f'{f["answers"]} "{ctx.get("businessName", "")}".',
        f["speaks"],
        f["address"].format(who=customer_word),
        f["self"],
        "",
        "## איך מדברים בטלפון",
        f["brief"],
        f["interrupted"],
        f["unclear"],
        *f["rules"],
        f["confirm_number"],
        f["no_media"],
        "",
        "## היום",
        _today_block(),
        "",
        "## שירותים ומחירים",
        _fmt_services(ctx),
        "",
        "## שעות פעילות",
        _fmt_hours(ctx),
    ]

    if ctx.get("pricingNotes"):
        parts += ["", "## כללי תמחור", str(ctx["pricingNotes"]), f["as_written"]]
    if ctx.get("availabilityInfo"):
        parts += ["", "## זמינות", str(ctx["availabilityInfo"])]
    if ctx.get("specialPeriods"):
        parts += ["", "## תאריכים מיוחדים"]
        for p in ctx["specialPeriods"]:
            parts.append(f"- {p.get('label')}: מ{_fmt_date(p.get('startDate'))} עד {_fmt_date(p.get('endDate'))}. {p.get('description') or ''}")
    if ctx.get("cancellationPolicy"):
        parts += ["", "## מדיניות ביטול", str(ctx["cancellationPolicy"])]
    if ctx.get("faq"):
        parts += ["", "## שאלות נפוצות"]
        for q in ctx["faq"]:
            parts.append(f"- {q.get('question')} → {q.get('answer')}")
    if ctx.get("address"):
        parts += ["", f"## כתובת\n{ctx['address']}"]
    if ctx.get("personality"):
        parts += ["", "## סגנון", str(ctx["personality"])]

    if caller.get("isKnownCustomer"):
        parts += ["", f["known"].format(name=caller.get("name"))]
        appt = caller.get("upcomingAppointment")
        if appt:
            parts.append(f"יש לו כבר תור ל{appt.get('serviceName')} ב{_fmt_datetime(appt.get('startTime'))}.")

    if inquiry:
        # The B&B model closes bookings human-to-human. Saying otherwise invents a confirmation.
        parts += ["", "## חשוב", f["no_booking"], f["record_first"]]
        # `can_transfer`, not the bare `transfer` line this used to carry. Two bugs lived in that
        # one word:
        #
        #   * A caller asking for a person is not a booking request. Without this rule the only
        #     nearby instruction is `record_first` ("call message_owner with everything you
        #     gathered before transferring"), and both models read it as licence to interrogate:
        #     asked for the owner, they answered "first tell me what you want" and
        #     "may I ask your name and what this is about". bench_quality.py's `human-please`
        #     case is exactly this, and it failed identically on Haiku and DeepSeek — which is
        #     what says it is the prompt and not the model.
        #   * With no ownerTransferNumber, `build_agent` never registers transfer_to_owner, yet
        #     this line still told the agent to use it. `no_transfer` is the honest branch.
        parts.append(f["can_transfer"] if ctx.get("ownerTransferNumber") else f["no_transfer"])
        parts += [f["leave_message"], f["end_call"]]
    else:
        parts += ["", "## קביעת תורים", f["booking"], f["no_invent"], f["verbatim"]]
        # A caller who asks for a person is not a booking request, and the agent used to have no
        # answer for it at all — the tool existed only for inquiry businesses.
        parts.append(f["can_transfer"] if ctx.get("ownerTransferNumber") else f["no_transfer"])
        parts.append(f["record_first"])
        parts.append(f["leave_message"])
        parts.append(f["end_call"])
        if not caller_known:
            # Only when the number really is missing. Asking a caller for a number we already have
            # is the same self-inflicted wound as asking which number they dialled.
            parts.append(f["ask_phone"])

    return "\n".join(parts)


def _apology_agent(sentence: str) -> LlmAgent:
    """
    One spoken sentence and nothing else, for every case where there is no salon to speak for.

    The instruction is inflected like everything else: it addresses the model in the agent's own
    gender, and it names that gender for self-reference — the introduction is pre-written, but a
    caller who answers the apology gets a model-generated reply, and Hebrew marks the gender on
    every verb of it.
    """
    masculine = _forms_for(None) is FORMS["masculine"]
    instruction = (
        "ענה במשפט אחד בלבד, חזור בדיוק על ההודעה שניתנה לך, ואל תוסיף דבר. דבר על עצמך בלשון זכר."
        if masculine
        else "עני במשפט אחד בלבד, חזרי בדיוק על ההודעה שניתנה לך, ואל תוסיפי דבר. דברי על עצמך בלשון נקבה."
    )
    return LlmAgent(
        model=MODEL,
        api_key=MODEL_API_KEY,
        config=LlmConfig(
            system_prompt=instruction,
            introduction=sentence,
            # Same budget-for-latency stance as the real agent — this one has even less to say.
            reasoning_effort="none",
            max_tokens=150,
            timeout=15.0,
            num_retries=1,
        ),
    )


def build_agent(resolved: Dict[str, Any], called: str, caller_num: str) -> LlmAgent:
    """
    The whole agent, built without touching the network.

    Kept separate from `get_agent` so it can run during `pre_call_handler` — see the note on
    `_PENDING`. Everything this does (rendering the prompt, generating tool schemas, constructing
    LlmAgent) is silence on the line if it happens after the call is answered.
    """
    if resolved.get("error"):
        return _apology_agent(resolved["error"])

    salon: Dict[str, Any] = resolved["context"]
    f = _forms_for(salon.get("voiceGender"))
    caller_known = caller_num != "unknown"

    # The numbers are closed over rather than exposed as tool parameters. The model cannot mistype
    # them, cannot invent them, and cannot ask the caller for them — which is exactly what it did
    # when the context was a tool it did not have.
    async def check_availability(
        ctx,
        service_name: Annotated[str, "שם השירות בדיוק כפי שמופיע ברשימת השירותים"],
        date: Annotated[str, "התאריך המבוקש בפורמט YYYY-MM-DD"],
        staff_name: Annotated[str, "שם איש הצוות, אם המתקשר ביקש מישהו מסוים"] = "",
    ):
        """מחזיר את הזמנים הפנויים לשירות בתאריך מסוים."""
        payload = {"calledNumber": called, "serviceName": service_name, "date": date}
        if staff_name:
            payload["staffName"] = staff_name
        status, body = await _post("/api/voice/check-availability", payload)
        if status not in (200, 404):
            logger.error("check-availability %s for %s: %s", status, called, body)
        if status == 404 and body.get("availableServices"):
            return f"אין שירות בשם הזה. השירותים הקיימים: {', '.join(body['availableServices'])}"
        if status != 200:
            return f"לא הצלחתי לבדוק זמינות: {body.get('error', '')}"
        slots = body.get("slots") or []
        if not slots:
            return "אין זמנים פנויים בתאריך הזה."
        # localTime is what to say out loud, so it is spelled out here rather than left as "14:30"
        # for the model to read digit by digit. startTime stays exactly as received — book_appointment
        # sends it back verbatim and the backend parses it.
        return "\n".join(
            f"{_spoken_clock(s['localTime'])} (startTime={s['startTime']})" for s in slots[:12]
        )

    async def book_appointment(
        ctx,
        service_name: Annotated[str, "שם השירות"],
        start_time: Annotated[str, "מחרוזת startTime המדויקת שהתקבלה מ-check_availability"],
        caller_name: Annotated[str, "שם המתקשר"] = "",
        caller_phone: Annotated[str, "מספר הטלפון של המתקשר. נדרש רק אם ביקשת ממנו אותו"] = "",
        staff_name: Annotated[str, "שם איש הצוות, אם נבחר"] = "",
    ):
        """קובע תור בזמן שהתקבל מ-check_availability."""
        # The booked customer is created under this number, so "unknown" would produce an
        # appointment the salon cannot call back and a confirmation message sent nowhere. When the
        # SDK loses the caller ID, the number has to come from the conversation instead — the one
        # question a salon asks on every call anyway.
        number = caller_num if caller_known else caller_phone.strip()
        if not number:
            return "שאלי את המתקשר מה מספר הטלפון שלו, ואז קראי לי שוב עם caller_phone."

        payload = {
            "calledNumber": called,
            "callerNumber": number,
            "serviceName": service_name,
            "startTime": start_time,
        }
        if caller_name:
            payload["callerName"] = caller_name
        if staff_name:
            payload["staffName"] = staff_name
        status, body = await _post("/api/voice/book", payload)
        if status not in (200, 409):
            logger.error("book %s for %s: %s", status, called, body)
        if status == 409:
            return "התור נתפס בינתיים. בדקי זמינות שוב והציעי זמן אחר."
        if status != 200:
            return f"לא הצלחתי לקבוע את התור: {body.get('error', '')}"
        return "התור נקבע."

    async def cancel_appointment(
        ctx,
        appointment_id: Annotated[str, "מזהה התור שיש לבטל"],
    ):
        """מבטל תור קיים."""
        status, body = await _post(
            "/api/voice/cancel", {"calledNumber": called, "appointmentId": appointment_id}
        )
        if status != 200:
            return f"לא הצלחתי לבטל: {body.get('error', '')}"
        return "התור בוטל."

    async def reschedule_appointment(
        ctx,
        appointment_id: Annotated[str, "מזהה התור הקיים"],
        new_start_time: Annotated[str, "מחרוזת startTime המדויקת שהתקבלה מ-check_availability"],
        new_service_name: Annotated[str, "שירות חדש, אם השתנה"] = "",
        new_staff_name: Annotated[str, "איש צוות חדש, אם השתנה"] = "",
    ):
        """מעביר תור קיים לזמן אחר."""
        payload = {
            "calledNumber": called,
            "appointmentId": appointment_id,
            "newStartTime": new_start_time,
        }
        if new_service_name:
            payload["newServiceName"] = new_service_name
        if new_staff_name:
            payload["newStaffName"] = new_staff_name
        status, body = await _post("/api/voice/reschedule", payload)
        if status != 200:
            return f"לא הצלחתי להעביר את התור: {body.get('error', '')}"
        return "התור הועבר."

    # Inquiry businesses close bookings by voice with the owner, so the handover *is* the job.
    # Everyone else books here — but "let me talk to a person" is the most ordinary request a caller
    # makes, and an agent that cannot honour it just talks past them. Both get the tool.
    tools = [] if salon.get("bookingModel") == "inquiry" else [
        check_availability, book_appointment, cancel_appointment, reschedule_appointment
    ]

    transfer_to = salon.get("ownerTransferNumber")
    if transfer_to:
        from line.events import AgentSendText, AgentTransferCall

        # No decorator: the SDK branches per yielded value at runtime — raw values feed back to
        # the model, OutputEvent instances go straight to the caller. @passthrough_tool is
        # documented for this but its own docstring calls it legacy and identical to loopback.
        async def transfer_to_owner(
            ctx,
            summary: Annotated[str, "מה המתקשר רוצה, במשפט אחד: שם, יחידה, תאריכים, לילות, כמה אנשים"] = "",
            caller_name: Annotated[str, "שם המתקשר, אם אמר אותו"] = "",
        ):
            """מעביר את השיחה לבעל העסק, אחרי שהפרטים נשמרים אצלו."""
            # The owner testing their own bot calls from the very number the business notifies, and
            # the transfer then dials the line the call is already on. It cannot connect, and to
            # the caller it looks like the agent ignored the request.
            if _same_number(transfer_to, caller_num):
                logger.warning("transfer target is the caller's own number (%s); messaging instead", transfer_to)
                yield f["transfer_is_caller"]
                return

            # Send the summary BEFORE handing the call over, not as a separate step the model may
            # skip. A live call collected a complete request — name, unit, dates, nights, email —
            # and the agent went straight to transfer; the transfer never connected, the call
            # ended, and nobody heard about the lead at all. A transfer is best-effort by nature
            # (the owner may not answer, the trunk may not bridge); the written record is the only
            # part that must survive, so it goes first and does not depend on the model choosing
            # to call a second tool.
            if summary.strip():
                payload = {"calledNumber": called, "callerNumber": caller_num, "message": summary.strip()}
                if caller_name:
                    payload["callerName"] = caller_name
                status, body = await _post("/api/voice/notify-owner", payload)
                if status != 200 or not body.get("notified"):
                    logger.error("notify-owner before transfer failed (%s): %s", status, body)

            yield AgentSendText(text=f["transfer_say"])
            yield AgentTransferCall(target_phone_number=transfer_to)

        tools.append(transfer_to_owner)

    async def send_details(
        ctx,
        service_name: Annotated[str, "שם היחידה או השירות בדיוק כפי שמופיע ברשימה"],
        channel: Annotated[str, 'לאן לשלוח: "whatsapp" או "email"'],
        to_email: Annotated[str, "כתובת המייל של המתקשר — חובה בערוץ email, אחרי שאישר אותה"] = "",
    ):
        """שולח למתקשר את הפרטים והתמונות של יחידה — לוואטסאפ שלו או למייל שלו — עכשיו, בזמן השיחה."""
        payload: Dict[str, Any] = {"calledNumber": called, "serviceName": service_name, "channel": channel}
        if channel == "whatsapp":
            payload["callerNumber"] = caller_num
        if to_email:
            payload["toEmail"] = to_email.strip()
        status, body = await _post("/api/voice/send-details", payload)
        if status == 409 and channel == "whatsapp":
            # No open WhatsApp window for this caller — Meta would accept the send and kill it in
            # transit, so the backend refuses instead. Email is the honest alternative.
            return "אי אפשר לשלוח לוואטסאפ של המתקשר הזה. הציעי לשלוח למייל במקום, או השתמשי ב-message_owner."
        if status != 200:
            logger.error("send-details %s for %s: %s", status, called, body)
            return f"השליחה נכשלה: {body.get('error', '')}. אל תגידי שנשלח."
        if not body.get("photos"):
            return "הפרטים נשלחו, אבל ליחידה הזאת אין תמונות במערכת. אמרי את זה בכנות."
        return "הפרטים והתמונות נשלחו. אפשר להגיד למתקשר שזה אצלו."

    tools.append(send_details)

    async def message_owner(
        ctx,
        summary: Annotated[str, "מה המתקשר רוצה, במשפט אחד, כדי שבעל העסק יוכל לחזור אליו"],
        caller_name: Annotated[str, "שם המתקשר, אם אמר אותו"] = "",
    ):
        """שולח הודעת ווטסאפ לבעל העסק עם בקשת המתקשר."""
        payload = {"calledNumber": called, "callerNumber": caller_num, "message": summary}
        if caller_name:
            payload["callerName"] = caller_name
        status, body = await _post("/api/voice/notify-owner", payload)
        if status != 200:
            # 404 here means the backend predates this endpoint, which is indistinguishable over
            # the phone from WhatsApp being down. The caller hears the same sentence either way,
            # so the difference has to be in the log.
            logger.error("notify-owner %s for %s: %s", status, called, body)
            return "לא הצלחתי לשלוח את ההודעה. אמרי למתקשר שכדאי להתקשר שוב מאוחר יותר."
        if not body.get("notified"):
            # The owner has no reachable WhatsApp number. Saying "I sent it" would be a lie the
            # caller only discovers by waiting for a call that never comes.
            return "לא הצלחתי להעביר את ההודעה לבעל העסק. אמרי את זה בכנות והציעי להתקשר שוב."
        return "ההודעה נשלחה לבעל העסק."

    tools.append(message_owner)

    # Hanging up is the agent's job, not the caller's. Without this the line stayed open after
    # goodbye until the caller pressed end — one live call sat open for three minutes past the
    # last word, which is billed airtime and reads to the caller as a bot that did not understand
    # the conversation was over. The SDK's own tool emits the hangup event; the wording tells it
    # to say goodbye first, and never to cut someone off mid-sentence.
    tools.append(end_call(description=(
        "מסיים את השיחה ומנתק. השתמש בזה רק אחרי שאמרת משפט פרידה, וכשברור שהמתקשר סיים — "
        "הוא נפרד, אמר תודה, או אמר שאין לו עוד שאלות. אל תשתמש בזה אם הוא באמצע משפט, "
        "מבקש להמתין, או שהכוונה שלו לא ברורה."
    )))

    return LlmAgent(
        model=MODEL,
        api_key=MODEL_API_KEY,
        tools=tools,
        config=LlmConfig(
            system_prompt=build_prompt(salon, caller_known=caller_known),
            # Spoken, not the WhatsApp greeting. Hardcoding one business's name here is what made
            # a second number answer as the first — this is said before any tool could correct it.
            introduction=spoken_greeting(salon),
            temperature=0.3,
            # `extra` is merged into the LiteLLM kwargs verbatim. stream_options asks the provider
            # to emit a usage block on the final streamed chunk — without it a streamed call
            # reports no usage at all and voice spend stays invisible, which is the whole point.
            extra={**_usage_metadata(called, caller_num), **_STREAM_USAGE_OPTION, **_LATENCY_EXTRA},
            # Thinking is measured in seconds and a caller is waiting: published figures put a
            # reasoning turn's first token minutes out, against ~100ms without. Nothing this agent
            # does — quoting a price, reading back a slot — needs it.
            reasoning_effort="none",
            # A runaway turn is the other way a call stops feeling like a conversation: the caller
            # waits through a monologue they did not ask for. The prompt already asks for two
            # sentences; this is the backstop for when the model ignores it.
            max_tokens=300,
            # Long enough to survive a slow turn, short enough that a hung request becomes an
            # apology rather than an open line. One retry, because a second costs more silence
            # than it is likely to save.
            timeout=15.0,
            num_retries=1,
        ),
    )


async def get_agent(env: AgentEnv, call_request: CallRequest):
    """
    Runs after the call is answered, so everything it does is silence on the line.

    The agent is normally already built — `pre_call_handler` did it during the ring — and this just
    hands it over. The slow path stays correct rather than fast: if the handover is missing, the
    dialled number on `call_request` is enough to fetch and build from scratch.
    """
    started = time.monotonic()
    prepared = _take(call_request.to)

    if prepared is not None:
        logger.info("get_agent: prepared during ring, %.0fms", (time.monotonic() - started) * 1000)
        return prepared

    # The dialled number, not the call id: the prepared agent is keyed by `to`, so when the handover
    # misses, the key that was looked up and the keys that were waiting are the only facts that
    # separate "pre_call_handler never ran" from "it ran and stored under a different string".
    # Logging the call id instead answered neither, on a miss seen live with both hops on the same
    # number — the 175ms of ring-time prep was thrown away and the log could not say why.
    logger.warning(
        "get_agent: nothing prepared for to=%r (call %s); waiting keys=%r; building after answer",
        call_request.to, call_request.call_id, list(_PENDING.keys()),
    )
    resolved = (call_request.metadata or {}).get("tori") or await resolve_context(call_request)
    agent = build_agent(resolved, call_request.to, caller_number(call_request))
    logger.info("get_agent: built after answer in %.0fms", (time.monotonic() - started) * 1000)
    return agent


app = VoiceAgentApp(get_agent=get_agent, pre_call_handler=pre_call_handler)


# For the self-hosted deployment (Railway), which is what removes the cold start: Cartesia's
# managed runtime scales the agent to zero when idle, and the first caller after a quiet stretch
# pays ~5 seconds of dead air waking it — measured live, and confirmed by an immediate second call
# answering within a second. A Railway service on a paid plan never sleeps, so no caller is ever
# first.
#
# The endpoint doubles as the "which code is live" check that took a whole evening during the first
# deploy saga: it reports the configuration this process actually booted with, so a stale deploy is
# visible in one curl instead of a test call.
@app.fastapi_app.get("/health")
def health():
    return {
        "ok": True,
        # When this process booted, which is the only way to tell it apart from the one it replaced.
        # Railway keeps the old container serving until the new one is healthy, so for a minute
        # after a variable change /health answers perfectly — from a process that has never seen the
        # new value. A secret rotation waiting on "is it up" got exactly that answer 200ms after
        # setting the variable, and then failed proving the change had landed. The backend reports
        # the same field for the same reason.
        "started_at": STARTED_AT,
        "model": MODEL,
        # The one variable whose absence breaks every call, and the one this endpoint used to omit.
        # LlmAgent refuses to construct without a key, so a deployment missing it answers the phone
        # and dies building the agent — the caller hears the line pick up and go silent. Reporting
        # the other three as true while this was unreported made a service that cannot take a call
        # look ready to be pointed at, which is exactly the mistake this endpoint exists to prevent.
        # The boolean only: never the key.
        "model_key": bool(MODEL_API_KEY),
        # Which variable it came from — the name, never the value. `model` and `model_key` were
        # both true while the key belonged to the other provider, which is a service that answers
        # the phone and fails every turn on auth. This is the field that makes that visible in the
        # same curl that reports the model.
        "model_key_from": MODEL_API_KEY_SOURCE or "none",
        "gender": AGENT_GENDER or "unset (falls back to /context voiceGender)",
        "tori_api": bool(TORI_API_URL),
        "tool_secret": bool(TOOL_SECRET),
        "usage_reporting": bool(TORI_API_URL and TOOL_SECRET),
        # Everything a call needs, in one field, so "is this safe to route calls to" is not four
        # separate readings and an inference.
        "ready_for_calls": bool(MODEL_API_KEY and TORI_API_URL and TOOL_SECRET),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app.fastapi_app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
