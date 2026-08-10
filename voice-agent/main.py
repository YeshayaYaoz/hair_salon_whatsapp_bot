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
import re
import time
from typing import Annotated, Any, Dict, Optional

import httpx

# Imported from the package root, not from line.voice_agent_app. The docs show
# `from line.voice_agent_app import AgentEnv, ...`, but AgentEnv is defined in line/agent.py and is
# only re-exported at the top level — that import raises ImportError against cartesia-line 0.2.16.
from line import AgentEnv, CallRequest, PreCallResult, VoiceAgentApp
from line.llm_agent import LlmAgent, LlmConfig

logger = logging.getLogger(__name__)

TORI_API_URL = os.environ.get("TORI_API_URL", "").rstrip("/")
TOOL_SECRET = os.environ.get("CARTESIA_TOOL_SECRET", "")
MODEL = os.environ.get("TORI_AGENT_MODEL", "anthropic/claude-haiku-4-5-20251001")
# LlmAgent raises if this is empty, so a missing key fails at deploy rather than mid-call. The
# variable follows the provider in MODEL — swap both together.
MODEL_API_KEY = os.environ.get("TORI_AGENT_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

# Israeli salons and B&Bs; the STT and TTS both need telling, and the voice picked in the dashboard
# is Hebrew-capable by construction (the picker filters on it).
LANGUAGE = "he"

# Spoken aloud, so they are sentences rather than error codes. Used when Tori cannot be reached at
# all — a caller must never hear silence or a stack trace.
UNREACHABLE_HE = (
    "מצטערת, יש תקלה זמנית במערכת ואני לא מצליחה לגשת לפרטים. "
    "אפשר לנסות שוב בעוד כמה דקות."
)


async def _post(path: str, payload: Dict[str, Any]) -> tuple[int, Dict[str, Any]]:
    """One place that knows how to talk to Tori, so auth and timeouts cannot drift apart."""
    if not TORI_API_URL:
        raise RuntimeError("TORI_API_URL is not set — run: cartesia env set TORI_API_URL=https://…")
    # Without this, the header is the bare string "Bearer " and httpx refuses to send it at all:
    # `LocalProtocolError: Illegal header value b'Bearer '`, five frames deep in httpcore, which
    # reads like a network fault rather than an unset variable. Say what it actually is.
    if not TOOL_SECRET:
        raise RuntimeError("CARTESIA_TOOL_SECRET is not set — run: cartesia env set CARTESIA_TOOL_SECRET=…")
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{TORI_API_URL}{path}",
            json=payload,
            headers={"Authorization": f"Bearer {TOOL_SECRET}"},
        )
    try:
        body = res.json()
    except Exception:
        body = {"error": res.text[:300]}
    return res.status_code, body


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


async def resolve_context(call_request: CallRequest) -> Dict[str, Any]:
    """
    Asks Tori who this call is for. Returns `{"context": {...}}` or `{"error": "<spoken sentence>"}`.

    Never raises and never returns nothing: a caller must always hear a sentence, so every failure
    becomes one. The backend's own 402/404 bodies are already written to be read aloud.
    """
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
FORMS = {
    "feminine": {
        "answers": "את עונה לשיחות טלפון של",
        "speaks": "את מדברת, לא כותבת: משפטים קצרים, בלי רשימות, בלי סימני פיסוק מיוחדים.",
        "address": "פני ל{who} בגוף שני, בעברית, בטון חם ומקצועי.",
        "self": 'כשאת מדברת על עצמך — בלשון נקבה: "אני בודקת", "אני מעבירה", "אני לא בטוחה".',
        "brief": "תשובה אחת — שני משפטים לכל היותר. אחר כך עצרי ותני לאדם לדבר.",
        "interrupted": "אם קטעו אותך — שתקי מיד והקשיבי.",
        "unclear": "אם לא הבנת מה נאמר, בקשי לחזור על זה. אל תנחשי.",
        "as_written": "אמרי אותם כפי שהם. אל תחשבי סכומים בעצמך.",
        "known": "המתקשר מוכר: {name}. פני אליו בשמו.",
        "no_booking": "את לא סוגרת הזמנות. את נותנת מידע ומעבירה את השיחה לבעל העסק כשהמתקשר רוצה להזמין.",
        "transfer": "השתמשי בכלי transfer_to_owner כדי להעביר.",
        "transfer_say": "מעבירה אותך לבעל העסק, רגע אחד.",
        "transfer_is_caller": "המספר של בעל העסק הוא המספר שממנו את מתקשרת, אז אי אפשר להעביר. אמרי את זה והציעי לשלוח לו הודעה עם message_owner.",
        "can_transfer": "אם המתקשר מבקש לדבר עם אדם, עם בעל העסק או עם מישהו אחר — אל תתווכחי. השתמשי ב-transfer_to_owner. אם ההעברה לא מצליחה, השתמשי ב-message_owner.",
        "no_transfer": "אין אפשרות להעביר שיחות. אם מבקשים לדבר עם מישהו — השתמשי ב-message_owner כדי לשלוח לבעל העסק הודעה עם הבקשה, ואמרי שהוא יחזור אליהם.",
        "leave_message": "בכל מקרה שבו המתקשר רוצה משהו שאת לא יכולה לתת לו — השתמשי ב-message_owner. אל תבטיחי שמישהו יחזור אליו בלי לקרוא לכלי הזה.",
        "booking": "השתמשי ב-check_availability כדי לראות זמנים פנויים, ואז ב-book_appointment.",
        "no_invent": "אל תמציאי זמנים ואל תאשרי תור שלא חזר מ-book_appointment.",
        "verbatim": "העבירי ל-startTime בדיוק את המחרוזת שהתקבלה מ-check_availability.",
        "ask_phone": "לפני שאת קובעת תור, שאלי את המתקשר מה מספר הטלפון שלו והעבירי אותו ב-caller_phone.",
        "rules": [
            'מספרים אמרי במילים ולא כספרות: "מאה ועשרים שקל".',
            'שעות אמרי כמו בדיבור: "מתשע בבוקר עד שש בערב".',
            "אל תקראי רשימות שלמות. הציעי שתיים או שלוש אפשרויות ותני לאדם לבחור.",
            'ביטויים קבועים נאמרים בדיוק כפי שהם: "ברוך הבא", "תודה רבה", "יום טוב". אל תמציאי גרסה משלך.',
            'אם את לא בטוחה במגדר של המתקשר — נסחי את המשפט בלי פנייה מגדרית: "אפשר לקבוע ליום שלישי".',
            'אל תשתמשי בצורות עם לוכסן ("מעוניין/ת") — הן נשמעות רע בדיבור.',
        ],
    },
    "masculine": {
        "answers": "אתה עונה לשיחות טלפון של",
        "speaks": "אתה מדבר, לא כותב: משפטים קצרים, בלי רשימות, בלי סימני פיסוק מיוחדים.",
        "address": "פנה ל{who} בגוף שני, בעברית, בטון חם ומקצועי.",
        "self": 'כשאתה מדבר על עצמך — בלשון זכר: "אני בודק", "אני מעביר", "אני לא בטוח".',
        "brief": "תשובה אחת — שני משפטים לכל היותר. אחר כך עצור ותן לאדם לדבר.",
        "interrupted": "אם קטעו אותך — שתוק מיד והקשב.",
        "unclear": "אם לא הבנת מה נאמר, בקש לחזור על זה. אל תנחש.",
        "as_written": "אמור אותם כפי שהם. אל תחשב סכומים בעצמך.",
        "known": "המתקשר מוכר: {name}. פנה אליו בשמו.",
        "no_booking": "אתה לא סוגר הזמנות. אתה נותן מידע ומעביר את השיחה לבעל העסק כשהמתקשר רוצה להזמין.",
        "transfer": "השתמש בכלי transfer_to_owner כדי להעביר.",
        "transfer_say": "מעביר אותך לבעל העסק, רגע אחד.",
        "transfer_is_caller": "המספר של בעל העסק הוא המספר שממנו אתה מתקשר, אז אי אפשר להעביר. אמור את זה והצע לשלוח לו הודעה עם message_owner.",
        "can_transfer": "אם המתקשר מבקש לדבר עם אדם, עם בעל העסק או עם מישהו אחר — אל תתווכח. השתמש ב-transfer_to_owner. אם ההעברה לא מצליחה, השתמש ב-message_owner.",
        "no_transfer": "אין אפשרות להעביר שיחות. אם מבקשים לדבר עם מישהו — השתמש ב-message_owner כדי לשלוח לבעל העסק הודעה עם הבקשה, ואמור שהוא יחזור אליהם.",
        "leave_message": "בכל מקרה שבו המתקשר רוצה משהו שאתה לא יכול לתת לו — השתמש ב-message_owner. אל תבטיח שמישהו יחזור אליו בלי לקרוא לכלי הזה.",
        "booking": "השתמש ב-check_availability כדי לראות זמנים פנויים, ואז ב-book_appointment.",
        "no_invent": "אל תמציא זמנים ואל תאשר תור שלא חזר מ-book_appointment.",
        "verbatim": "העבר ל-startTime בדיוק את המחרוזת שהתקבלה מ-check_availability.",
        "ask_phone": "לפני שאתה קובע תור, שאל את המתקשר מה מספר הטלפון שלו והעבר אותו ב-caller_phone.",
        "rules": [
            'מספרים אמור במילים ולא כספרות: "מאה ועשרים שקל".',
            'שעות אמור כמו בדיבור: "מתשע בבוקר עד שש בערב".',
            "אל תקרא רשימות שלמות. הצע שתיים או שלוש אפשרויות ותן לאדם לבחור.",
            'ביטויים קבועים נאמרים בדיוק כפי שהם: "ברוך הבא", "תודה רבה", "יום טוב". אל תמציא גרסה משלך.',
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

    The agent speaks about itself in the gender of the voice the salon chose (`voiceGender` from
    /context, resolved from Cartesia's own catalogue). Unknown or gender-neutral keeps the feminine
    forms, which is what every salon heard before the setting existed.
    """
    vocab = ctx.get("vocabulary") or {}
    customer_word = vocab.get("customerHe") or "לקוח"
    inquiry = ctx.get("bookingModel") == "inquiry"
    caller = ctx.get("caller") or {}
    f = FORMS.get(ctx.get("voiceGender") or "", FORMS["feminine"])

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
        parts += ["", "## חשוב", f["no_booking"], f["transfer"], f["leave_message"]]
    else:
        parts += ["", "## קביעת תורים", f["booking"], f["no_invent"], f["verbatim"]]
        # A caller who asks for a person is not a booking request, and the agent used to have no
        # answer for it at all — the tool existed only for inquiry businesses.
        parts.append(f["can_transfer"] if ctx.get("ownerTransferNumber") else f["no_transfer"])
        parts.append(f["leave_message"])
        if not caller_known:
            # Only when the number really is missing. Asking a caller for a number we already have
            # is the same self-inflicted wound as asking which number they dialled.
            parts.append(f["ask_phone"])

    return "\n".join(parts)


def _apology_agent(sentence: str) -> LlmAgent:
    """One spoken sentence and nothing else, for every case where there is no salon to speak for."""
    return LlmAgent(
        model=MODEL,
        api_key=MODEL_API_KEY,
        config=LlmConfig(
            system_prompt="עני במשפט אחד בלבד, בדיוק את ההודעה שניתנה לך, ואל תוסיפי דבר.",
            introduction=sentence,
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
    f = FORMS.get(salon.get("voiceGender") or "", FORMS["feminine"])
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
        async def transfer_to_owner(ctx):
            """מעביר את השיחה לבעל העסק."""
            # The owner testing their own bot calls from the very number the business notifies, and
            # the transfer then dials the line the call is already on. It cannot connect, and to
            # the caller it looks like the agent ignored the request.
            if _same_number(transfer_to, caller_num):
                logger.warning("transfer target is the caller's own number (%s); messaging instead", transfer_to)
                yield f["transfer_is_caller"]
                return
            yield AgentSendText(text=f["transfer_say"])
            yield AgentTransferCall(target_phone_number=transfer_to)

        tools.append(transfer_to_owner)

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
            return "לא הצלחתי לשלוח את ההודעה. אמרי למתקשר שכדאי להתקשר שוב מאוחר יותר."
        if not body.get("notified"):
            # The owner has no reachable WhatsApp number. Saying "I sent it" would be a lie the
            # caller only discovers by waiting for a call that never comes.
            return "לא הצלחתי להעביר את ההודעה לבעל העסק. אמרי את זה בכנות והציעי להתקשר שוב."
        return "ההודעה נשלחה לבעל העסק."

    tools.append(message_owner)

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

    logger.warning("get_agent: nothing prepared for %s; building after answer", call_request.call_id)
    resolved = (call_request.metadata or {}).get("tori") or await resolve_context(call_request)
    agent = build_agent(resolved, call_request.to, caller_number(call_request))
    logger.info("get_agent: built after answer in %.0fms", (time.monotonic() - started) * 1000)
    return agent


app = VoiceAgentApp(get_agent=get_agent, pre_call_handler=pre_call_handler)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app.fastapi_app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
