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

## Deploy

    cd voice-agent && cartesia deploy

Env: TORI_API_URL, CARTESIA_TOOL_SECRET (must match the backend's), plus a model key.
"""

import logging
import os
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
        raise RuntimeError("TORI_API_URL is not set")
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


async def pre_call_handler(call_request: CallRequest) -> Optional[PreCallResult]:
    """
    Resolves the salon and its voice before the agent is built.

    Returning None would reject the call with a 403, which the caller hears as a line that answers
    and dies. Every failure here instead produces a call that connects and explains itself — the
    backend's own 402/404 messages are written to be spoken, so they are carried through as-is.
    """
    # First line of the call in the logs, and the one that says whether this code is serving at all.
    # An agent whose console prompt answered instead prints nothing here.
    logger.info("pre_call_handler: to=%r from=%r call_id=%r", call_request.to, call_request.from_, call_request.call_id)

    status, body = 0, {}
    try:
        status, body = await _post(
            "/api/voice/context",
            {"calledNumber": call_request.to, "callerNumber": caller_number(call_request)},
        )
    except Exception as err:  # network, DNS, timeout
        logger.exception("context fetch failed for %s", call_request.to)
        return PreCallResult(metadata={"tori_error": UNREACHABLE_HE}, config={"tts": {"language": LANGUAGE}})

    if status != 200:
        # 404 = no salon on this number, 402 = subscription/plan. Both already carry a sentence
        # meant to be read out; falling back only if one somehow does not.
        logger.warning("context %s for %s: %s", status, call_request.to, body)
        return PreCallResult(
            metadata={"tori_error": body.get("error") or UNREACHABLE_HE},
            config={"tts": {"language": LANGUAGE}},
        )

    # A 200 that carries no business name is not a context. Letting it through builds an agent whose
    # greeting is "שלום, הגעתם ל" and whose prompt lists no services — a bot that sounds like it is
    # working while knowing nothing, which is the hardest failure to diagnose from a phone call.
    if not body.get("businessName"):
        logger.error("context 200 for %s but no businessName; keys=%s", call_request.to, sorted(body))
        return PreCallResult(metadata={"tori_error": UNREACHABLE_HE}, config={"tts": {"language": LANGUAGE}})

    logger.info("context resolved for %s: %s", call_request.to, body.get("businessName"))

    tts: Dict[str, Any] = {"language": LANGUAGE}
    # The salon's own voice, chosen in the dashboard. Null means "whatever the agent is set to",
    # which is exactly the behaviour before the setting existed — so it is simply left out.
    if body.get("voiceId"):
        tts["voice_id"] = body["voiceId"]

    return PreCallResult(metadata={"tori_context": body}, config={"tts": tts})


def _fmt_services(ctx: Dict[str, Any]) -> str:
    lines = []
    for s in ctx.get("services") or []:
        bits = [s.get("name", "")]
        if s.get("priceIls") is not None:
            bits.append(f"{s['priceIls']} ש\"ח")
        if s.get("durationMin"):
            bits.append(f"{s['durationMin']} דקות")
        if s.get("capacity"):
            bits.append(f"עד {s['capacity']} אורחים")
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
        out.append(f"- {day}: {o // 60:02d}:{o % 60:02d}–{c // 60:02d}:{c % 60:02d}")
    return "\n".join(out) if out else "(שעות לא הוגדרו)"


def build_prompt(ctx: Dict[str, Any], caller_known: bool = True) -> str:
    """
    The salon's data, rendered into the prompt rather than left for the model to ask about.

    Prices, hours and policy are stated verbatim and never computed: a voice agent that does
    arithmetic on a price list will eventually quote a total the salon does not honour.
    """
    vocab = ctx.get("vocabulary") or {}
    customer_word = vocab.get("customerHe") or "לקוח"
    inquiry = ctx.get("bookingModel") == "inquiry"
    caller = ctx.get("caller") or {}

    parts = [
        f'את עונה לשיחות טלפון של "{ctx.get("businessName", "")}".',
        "את מדברת, לא כותבת: משפטים קצרים, בלי רשימות, בלי סימני פיסוק מיוחדים.",
        f"פני ל{customer_word} בגוף שני, בעברית, בטון חם ומקצועי.",
        "",
        "## שירותים ומחירים",
        _fmt_services(ctx),
        "",
        "## שעות פעילות",
        _fmt_hours(ctx),
    ]

    if ctx.get("pricingNotes"):
        parts += ["", "## כללי תמחור", str(ctx["pricingNotes"]),
                  "אמרי אותם כפי שהם. אל תחשבי סכומים בעצמך."]
    if ctx.get("availabilityInfo"):
        parts += ["", "## זמינות", str(ctx["availabilityInfo"])]
    if ctx.get("specialPeriods"):
        parts += ["", "## תאריכים מיוחדים"]
        for p in ctx["specialPeriods"]:
            parts.append(f"- {p.get('label')}: {p.get('startDate')} עד {p.get('endDate')}. {p.get('description') or ''}")
    if ctx.get("cancellationPolicy"):
        parts += ["", "## מדיניות ביטול", str(ctx["cancellationPolicy"])]
    if ctx.get("faq"):
        parts += ["", "## שאלות נפוצות"]
        for f in ctx["faq"]:
            parts.append(f"- {f.get('question')} → {f.get('answer')}")
    if ctx.get("address"):
        parts += ["", f"## כתובת\n{ctx['address']}"]
    if ctx.get("personality"):
        parts += ["", "## סגנון", str(ctx["personality"])]

    if caller.get("isKnownCustomer"):
        parts += ["", f"המתקשר מוכר: {caller.get('name')}. פני אליו בשמו."]
        appt = caller.get("upcomingAppointment")
        if appt:
            parts.append(f"יש לו כבר תור ל{appt.get('serviceName')} בתאריך {appt.get('startTime')}.")

    if inquiry:
        # The B&B model closes bookings human-to-human. Saying otherwise invents a confirmation.
        parts += [
            "",
            "## חשוב",
            "את לא סוגרת הזמנות. את נותנת מידע ומעבירה את השיחה לבעל העסק כשהמתקשר רוצה להזמין.",
            "השתמשי בכלי transfer_to_owner כדי להעביר.",
        ]
    else:
        parts += [
            "",
            "## קביעת תורים",
            "השתמשי ב-check_availability כדי לראות זמנים פנויים, ואז ב-book_appointment.",
            "אל תמציאי זמנים ואל תאשרי תור שלא חזר מ-book_appointment.",
            "העבירי ל-startTime בדיוק את המחרוזת שהתקבלה מ-check_availability.",
        ]
        if not caller_known:
            # Only when the number really is missing. Asking a caller for a number we already have
            # is the same self-inflicted wound as asking which number they dialled.
            parts.append(
                "לפני שאת קובעת תור, שאלי את המתקשר מה מספר הטלפון שלו והעבירי אותו ב-caller_phone."
            )

    return "\n".join(parts)


async def get_agent(env: AgentEnv, call_request: CallRequest):
    meta = call_request.metadata or {}

    # Nothing to work with — say the one sentence we have and stop. Better than a bot improvising
    # about a business it knows nothing about.
    if meta.get("tori_error"):
        return LlmAgent(
            model=MODEL,
            api_key=MODEL_API_KEY,
            config=LlmConfig(
                system_prompt="עני במשפט אחד בלבד, בדיוק את ההודעה שניתנה לך, ואל תוסיפי דבר.",
                introduction=meta["tori_error"],
            ),
        )

    salon: Dict[str, Any] = meta.get("tori_context") or {}

    # pre_call_handler always sets one of the two keys, so an empty context here means its result
    # never made it back — the metadata the /chats response returns is echoed to us on the websocket
    # start message, and that round trip is the part outside this file. Say the fallback rather than
    # improvise about a business we know nothing about.
    if not salon:
        logger.error("no tori_context in metadata (keys=%s); pre-call result did not survive", sorted(meta))
        return LlmAgent(
            model=MODEL,
            api_key=MODEL_API_KEY,
            config=LlmConfig(
                system_prompt="עני במשפט אחד בלבד, בדיוק את ההודעה שניתנה לך, ואל תוסיפי דבר.",
                introduction=UNREACHABLE_HE,
            ),
        )

    called = call_request.to
    caller_num = caller_number(call_request)
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
        # localTime is what to say out loud; startTime is what book_appointment needs back verbatim.
        return "\n".join(f"{s['localTime']} (startTime={s['startTime']})" for s in slots[:12])

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

    tools = []
    if salon.get("bookingModel") == "inquiry":
        # Inquiry businesses close bookings by voice with the owner; the agent's job ends at the
        # handover. ownerTransferNumber is only populated for them.
        transfer_to = salon.get("ownerTransferNumber")
        if transfer_to:
            from line.events import AgentSendText, AgentTransferCall

            # No decorator: the SDK branches per yielded value at runtime — raw values feed back to
            # the model, OutputEvent instances go straight to the caller. @passthrough_tool is
            # documented for this but its own docstring calls it legacy and identical to loopback.
            async def transfer_to_owner(ctx):
                """מעביר את השיחה לבעל העסק."""
                yield AgentSendText(text="מעבירה אותך לבעל העסק, רגע אחד.")
                yield AgentTransferCall(target_phone_number=transfer_to)

            tools.append(transfer_to_owner)
    else:
        tools = [check_availability, book_appointment, cancel_appointment, reschedule_appointment]

    return LlmAgent(
        model=MODEL,
        api_key=MODEL_API_KEY,
        tools=tools,
        config=LlmConfig(
            system_prompt=build_prompt(salon, caller_known=caller_known),
            # The salon's own greeting. Hardcoding one business's name here is what made a second
            # number answer as the first — the introduction is spoken before any tool could correct it.
            introduction=salon.get("greeting") or f'שלום, הגעתם ל{salon.get("businessName", "")}. איך אפשר לעזור?',
            temperature=0.3,
        ),
    )


app = VoiceAgentApp(get_agent=get_agent, pre_call_handler=pre_call_handler)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app.fastapi_app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
