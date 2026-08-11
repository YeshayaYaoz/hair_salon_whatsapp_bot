"""Exercises the real pre_call_handler/get_agent against a stub Tori backend."""
import asyncio, json, os, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = {"status": 200, "body": {}, "seen": []}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        payload = json.loads(self.rfile.read(n) or b"{}")
        STATE["seen"].append((self.path, payload, self.headers.get("Authorization")))
        self.send_response(STATE["status"]); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(STATE["body"]).encode())
    def log_message(self, *a): pass

# Port 0 lets the OS pick. A fixed port below 1024 needs root, which a CI runner is not — and a
# fixed high port would still collide with whatever else the machine happens to be running.
srv = HTTPServer(("127.0.0.1", 0), H)
STUB_URL = f"http://127.0.0.1:{srv.server_address[1]}"
threading.Thread(target=srv.serve_forever, daemon=True).start()

os.environ["TORI_API_URL"] = STUB_URL
os.environ["CARTESIA_TOOL_SECRET"] = "topsecret"
# LlmAgent refuses to construct without one, and every check here builds an agent. Nothing in this
# file reaches the network, so the value only has to exist.
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-not-a-real-key-for-checks")
import main
from line import CallRequest

# Every scenario below reuses one dialled number for a different business, which the context cache
# would serve from the previous scenario. Disabled by default so each check exercises a real fetch;
# scenario 26 re-enables it to test the cache itself.
main._CONTEXT_TTL = 0.0

def req(to="+972555077941", frm="+972533391353", meta=None):
    # Cartesia merges PreCallResult.metadata into call_request.metadata before get_agent runs,
    # so the harness has to do the same or get_agent sees an empty salon.
    return CallRequest(call_id="c1", **{"from": frm}, to=to, agent_call_id="ac1",
                       agent={"id": "a1", "system_prompt": None, "introduction": None},
                       metadata=meta)

SALON = {
    "businessName": "מספרת רונית", "bookingModel": "slot", "voiceId": "voice-abc",
    "greeting": "שלום, הגעתם למספרת רונית!", "timezone": "Asia/Jerusalem", "address": "הרצל 5",
    "services": [{"name": "תספורת אישה", "priceIls": 120, "durationMin": 45, "description": None, "capacity": None}],
    "hours": [{"dayOfWeek": 0, "openMin": 540, "closeMin": 1080}],
    "faq": [{"question": "חניה?", "answer": "יש חניון סמוך"}],
    "caller": {"isKnownCustomer": True, "name": "דנה", "upcomingAppointment": None},
    "vocabulary": {"customerHe": "לקוחה"}, "cancellationPolicy": "ביטול עד 24 שעות",
    "specialPeriods": [], "pricingNotes": None, "availabilityInfo": None, "personality": None,
    "ownerTransferNumber": None,
}
BNB = dict(SALON, bookingModel="inquiry", ownerTransferNumber="+972500000000",
           businessName="צימר בנחת רוח", greeting="שלום, הגעתם לצימר בנחת רוח")

async def main_():
    ok = True
    # --- 1. happy path, slot business -------------------------------------------------
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    path, payload, auth = STATE["seen"][0]
    assert path == "/api/voice/context", path
    assert payload == {"calledNumber": "+972555077941", "callerNumber": "+972533391353"}, payload
    assert auth == "Bearer topsecret", auth
    assert pre.config["tts"]["voice_id"] == "voice-abc", pre.config
    assert pre.config["tts"]["language"] == "he"
    print("1 context fetched with dialled+caller number, secret sent, voice applied   OK")

    agent = await main.get_agent(None, req(meta=pre.metadata))
    cfg = agent._config
    assert cfg.introduction == SALON["greeting"], cfg.introduction
    names = sorted(getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in (agent._tools or []))
    assert names == ["book_appointment", "cancel_appointment", "check_availability", "end_call", "message_owner", "reschedule_appointment", "send_details"], names
    assert "תספורת אישה" in cfg.system_prompt and "120" in cfg.system_prompt
    assert "דנה" in cfg.system_prompt          # known caller surfaced
    assert "לקוחה" in cfg.system_prompt        # vertical vocabulary used
    print("2 slot business: salon greeting, 4 booking tools, prices+caller in prompt   OK")

    # --- 2. inquiry business gets transfer, not booking --------------------------------
    STATE.update(status=200, body=BNB, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    names = sorted(getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in (agent._tools or []))
    assert names == ["end_call", "message_owner", "send_details", "transfer_to_owner"], names
    assert agent._config.introduction == BNB["greeting"]
    print("3 inquiry business: transfer only, no booking tools, own greeting           OK")

    # --- 3. the multi-tenant bug this replaces ----------------------------------------
    assert BNB["greeting"] != SALON["greeting"]
    a1 = (await main.get_agent(None, req(meta=pre.metadata)))._config.introduction
    STATE.update(status=200, body=SALON, seen=[])
    pre2 = await main.pre_call_handler(req(to="+972559450126"))
    a2 = (await main.get_agent(None, req(to="+972559450126", meta=pre2.metadata)))._config.introduction
    assert a1 != a2, "two numbers produced the same greeting"
    print("4 two numbers on one agent answer as different businesses                   OK")

    # --- 4. failure paths still answer the phone --------------------------------------
    STATE.update(status=402, body={"error": "המנוי אינו פעיל."}, seen=[])
    pre = await main.pre_call_handler(req())
    assert pre is not None, "402 must not reject the call"
    agent = await main.get_agent(None, CallRequest(call_id="c", **{"from": "+1"}, to="+2",
        agent_call_id="a", agent={"id": "a"}, metadata=pre.metadata))
    assert agent._config.introduction == "המנוי אינו פעיל.", agent._config.introduction
    assert not (agent._tools or []), "no tools when there is no salon"
    print("5 402 lapsed subscription: call answers and speaks the backend's sentence   OK")

    STATE.update(status=404, body={"error": "No salon configured for this number"}, seen=[])
    pre = await main.pre_call_handler(req())
    assert pre is not None and pre.metadata["tori"].get("error")
    print("6 404 unknown number: answers rather than dropping                          OK")

    main.TORI_API_URL = "http://127.0.0.1:9"   # nothing listening (module const, not env)
    pre = await main.pre_call_handler(req())
    assert pre is not None and "מצטערת" in pre.metadata["tori"]["error"]
    print("7 backend unreachable: generic spoken apology, not silence                  OK")
    main.TORI_API_URL = STUB_URL

    # --- 5. tools close over the numbers ----------------------------------------------
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    tool = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "check_availability")
    STATE.update(status=200, body={"slots": [{"startTime": "2026-08-12T09:00:00Z", "localTime": "12:00", "staffId": None}]}, seen=[])
    out = await tool(None, service_name="תספורת אישה", date="2026-08-12")
    _, payload, _ = STATE["seen"][0]
    assert payload["calledNumber"] == "+972555077941", payload
    assert "service_name" not in str(payload)
    assert "שתים עשרה בצהריים" in out and "2026-08-12T09:00:00Z" in out, out
    print("8 tools carry the dialled number themselves; caller is never asked          OK")

    STATE.update(status=409, body={"error": "Slot no longer available"}, seen=[])
    book = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "book_appointment")
    out = await book(None, service_name="תספורת אישה", start_time="2026-08-12T09:00:00Z")
    assert "נתפס" in out, out
    print("9 booking a taken slot returns a recoverable instruction, not a crash       OK")

    # --- 6. the silent failures: a bot that sounds fine and knows nothing --------------
    # Both of these previously produced a working-sounding agent greeting "שלום, הגעתם ל" with an
    # empty service list — indistinguishable over the phone from a stock template answering.
    STATE.update(status=200, body={"bookingModel": "slot"}, seen=[])
    pre = await main.pre_call_handler(req())
    assert "context" not in pre.metadata["tori"], pre.metadata
    assert "מצטערת" in pre.metadata["tori"]["error"], pre.metadata
    print("10 a 200 with no businessName is a failure, not an anonymous salon          OK")

    # What a real call actually looks like: Cartesia replaces PreCallResult.metadata with its own
    # {'agent_id': …, 'template': 'user_code'}, so nothing pre_call_handler set arrives. This is the
    # failure that made every call greet with "שלום, הגעתם ל".
    CARTESIA_META = {"agent_id": "agent_aqnpeguixt5FNv71XngV1V", "template": "user_code"}
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    assert agent._config.introduction == SALON["greeting"], agent._config.introduction
    assert "תספורת אישה" in agent._config.system_prompt
    print("11 Cartesia's own metadata: the salon still arrives, via the handover        OK")

    # And if even the handover is missed — the two hops landing on different replicas — the dialled
    # number on call_request is enough to fetch it again. Nothing depends on the earlier hop.
    main._PENDING.clear()
    STATE.update(status=200, body=SALON, seen=[])
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    assert agent._config.introduction == SALON["greeting"], agent._config.introduction
    assert STATE["seen"] and STATE["seen"][0][0] == "/api/voice/context", STATE["seen"]
    print("11b handover missed entirely: get_agent re-fetches rather than improvising   OK")

    # A backend that is down at that point still has to produce a spoken sentence.
    main._PENDING.clear()
    STATE.update(status=404, body={"error": "No salon configured for this number"}, seen=[])
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    assert agent._config.introduction == "No salon configured for this number"
    assert not agent._tools, agent._tools
    print("11c re-fetch that fails: apology, never an improvised booking bot            OK")

    # The SDK hands pre_call_handler "unknown" as the caller on the /chats path; /context still
    # has to be called, because the dialled number alone is what identifies the salon.
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req(frm="unknown"))
    _, payload, _ = STATE["seen"][0]
    assert payload == {"calledNumber": "+972555077941", "callerNumber": "unknown"}, payload
    assert pre.metadata["tori"]["context"]["businessName"] == SALON["businessName"]
    print("12 an unknown caller number still resolves the salon                        OK")

    # A booking must never be filed under the string "unknown" — the salon could not call that
    # customer back and the confirmation would go nowhere.
    agent = await main.get_agent(None, req(frm="unknown", meta=pre.metadata))
    assert "caller_phone" in agent._config.system_prompt, agent._config.system_prompt
    book = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "book_appointment")
    STATE.update(status=200, body={"booked": True}, seen=[])
    out = await book(None, service_name="תספורת אישה", start_time="2026-08-12T09:00:00Z")
    assert not STATE["seen"], "booked without a real phone number"
    assert "מספר הטלפון" in out, out
    out = await book(None, service_name="תספורת אישה", start_time="2026-08-12T09:00:00Z", caller_phone="0501234567")
    _, payload, _ = STATE["seen"][0]
    assert payload["callerNumber"] == "0501234567", payload
    print("13 no caller ID: the agent asks for the number instead of filing 'unknown'  OK")

    # ...and with a real caller ID it must not ask, which is the failure this whole file exists for.
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    assert "caller_phone" not in agent._config.system_prompt, agent._config.system_prompt
    book = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "book_appointment")
    STATE.update(status=200, body={"booked": True}, seen=[])
    await book(None, service_name="תספורת אישה", start_time="2026-08-12T09:00:00Z")
    _, payload, _ = STATE["seen"][0]
    assert payload["callerNumber"] == "+972533391353", payload
    print("14 with a caller ID the number is never asked for                           OK")

    # --- 7. the voice and the grammar have to agree -----------------------------------
    # Hebrew inflects every verb for gender, so a masculine voice reading feminine forms is not a
    # style mismatch — it is wrong, and audible in the first sentence.
    STATE.update(status=200, body=dict(SALON, voiceGender="masculine"), seen=[])
    pre = await main.pre_call_handler(req())
    p = (await main.get_agent(None, req(meta=pre.metadata)))._config.system_prompt
    assert "אתה עונה" in p and "אני בודק" in p, p[:300]
    assert "את עונה" not in p and "אני בודקת" not in p, p[:300]
    assert "השתמש ב-check_availability" in p and "השתמשי" not in p, p[:600]
    # The speech rules are imperatives too, and were the easiest place to leave one gender behind.
    assert "אמור במילים" in p and "אל תקרא רשימות" in p, p
    assert "אמרי במילים" not in p and "אל תקראי" not in p, p

    STATE.update(status=200, body=dict(SALON, voiceGender="feminine"), seen=[])
    pre = await main.pre_call_handler(req())
    p = (await main.get_agent(None, req(meta=pre.metadata)))._config.system_prompt
    assert "את עונה" in p and "אני בודקת" in p, p[:300]
    assert "אתה עונה" not in p, p[:300]
    assert "אמרי במילים" in p and "אמור במילים" not in p, p

    # gender_neutral and "no voice chosen" both keep what every salon heard before the setting.
    for unknown in (None, "gender_neutral"):
        STATE.update(status=200, body=dict(SALON, voiceGender=unknown), seen=[])
        pre = await main.pre_call_handler(req())
        p = (await main.get_agent(None, req(meta=pre.metadata)))._config.system_prompt
        assert "את עונה" in p, unknown
    print("15 the agent's grammar follows the chosen voice's gender                     OK")

    # --- 8. data shaped for a calendar, spoken to a person ----------------------------
    # Hebrew numbers agree in gender with the noun they count, and a bare digit gives the model
    # nothing to agree with: "2 לילות" comes out שתיים or שניים at random, and only שני is right.
    assert main._he_num(2) == "שניים" and main._he_num(2, feminine=True) == "שתיים"
    assert main._he_num(21) == "עשרים ואחד" and main._he_num(21, feminine=True) == "עשרים ואחת"
    assert main._he_num(150) == "150"          # out of range: the prompt's rule covers it

    assert main._fmt_duration(1440) == "לילה אחד"
    assert main._fmt_duration(2880) == "שני לילות"      # לילה is masculine, and 2 is construct
    assert main._fmt_duration(4320) == "שלושה לילות"
    assert main._fmt_duration(45) == "ארבעים וחמש דקות"
    assert main._fmt_duration(60) == "שעה"
    assert main._fmt_duration(90) == "שעה וחצי"
    assert main._fmt_duration(120) == "שעתיים"          # dual, not a counted form
    assert main._fmt_duration(150) == "שעתיים וחצי"
    assert main._fmt_duration(180) == "שלוש שעות"       # שעה is feminine — שלוש, not שלושה
    assert main._fmt_duration(75) == "שעה וחמש עשרה דקות"

    assert main._fmt_clock(540) == "תשע בבוקר"
    assert main._fmt_clock(1080) == "שש בערב"
    assert main._fmt_clock(0) == "שתים עשרה בלילה"
    assert main._spoken_clock("14:30") == "שתיים וחצי בצהריים"
    assert main._spoken_clock("08:15") == "שמונה ורבע בבוקר"
    assert main._spoken_clock("08:45") == "רבע לתשע בבוקר"
    assert main._spoken_clock("nonsense") == "nonsense"  # never mangle what it cannot parse

    # ISO dates and timestamps were going into the prompt raw, for the agent to read aloud.
    assert main._fmt_date("2026-08-12") == "שנים עשר באוגוסט"
    assert main._fmt_datetime("2026-08-12T09:00:00Z") == "שנים עשר באוגוסט בשעה תשע בבוקר"

    ZIMMER = dict(SALON, bookingModel="inquiry", ownerTransferNumber="+972500000000",
                  services=[{"name": "יחידת הרים", "priceIls": 1800, "durationMin": 1440,
                             "description": None, "capacity": 4}])
    STATE.update(status=200, body=ZIMMER, seen=[])
    pre = await main.pre_call_handler(req())
    p = (await main.get_agent(None, req(meta=pre.metadata)))._config.system_prompt
    assert "לילה אחד" in p and "1440" not in p, p
    assert "ארבעה אורחים" in p and "4 אורחים" not in p, p   # אורח is masculine
    assert "במילים ולא כספרות" in p          # the model is told to say numbers, not read them
    print("16 an overnight stay is one night, never 1440 minutes                        OK")

    # Everything else the prompt carries that a person has to hear, not read.
    STATE.update(status=200, body=dict(
        SALON,
        hours=[{"dayOfWeek": 0, "openMin": 540, "closeMin": 1080}],
        specialPeriods=[{"label": "סוכות", "startDate": "2026-09-25", "endDate": "2026-10-02",
                         "description": "מינימום שני לילות"}],
        caller={"isKnownCustomer": True, "name": "דנה",
                "upcomingAppointment": {"id": "a1", "serviceName": "צבע",
                                        "startTime": "2026-08-12T09:00:00Z", "staffName": None}},
    ), seen=[])
    pre = await main.pre_call_handler(req())
    p = (await main.get_agent(None, req(meta=pre.metadata)))._config.system_prompt
    assert "- ראשון: מתשע בבוקר עד שש בערב" in p, p
    assert "09:00" not in p and "18:00" not in p, p
    assert "עשרים וחמישה בספטמבר" in p and "2026-09-25" not in p, p
    assert "שנים עשר באוגוסט בשעה תשע בבוקר" in p, p
    assert "2026-08-12T09:00:00Z" not in p, p    # was handed to the agent to read out loud
    print("17 no ISO dates, timestamps or clock digits survive into the prompt          OK")

    # Slot times are spoken; the startTime string must survive untouched for book_appointment.
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    tool = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "check_availability")
    STATE.update(status=200, body={"slots": [
        {"startTime": "2026-08-12T09:00:00Z", "localTime": "12:00", "staffId": None},
        {"startTime": "2026-08-12T11:45:00Z", "localTime": "14:45", "staffId": None},
    ]}, seen=[])
    out = await tool(None, service_name="תספורת אישה", date="2026-08-12")
    assert "שתים עשרה בצהריים" in out and "רבע לשלוש בצהריים" in out, out
    assert "2026-08-12T09:00:00Z" in out and "2026-08-12T11:45:00Z" in out, out
    print("18 slot times are spoken, while startTime stays verbatim for booking         OK")

    # --- 9. "let me talk to a person" ------------------------------------------------
    # The most ordinary request a caller makes, and a booking business had no tool for it: the
    # transfer existed only for inquiry businesses, so a salon's agent simply talked past them.
    STATE.update(status=200, body=dict(SALON, ownerTransferNumber="+972500000000"), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    names = sorted(getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in agent._tools)
    assert "transfer_to_owner" in names and "book_appointment" in names, names
    assert "transfer_to_owner" in agent._config.system_prompt, agent._config.system_prompt

    # A business with no number to transfer to must say so, not promise a handover it cannot do.
    STATE.update(status=200, body=dict(SALON, ownerTransferNumber=None), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    names = sorted(getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in agent._tools)
    assert "transfer_to_owner" not in names and "message_owner" in names, names
    assert "אין אפשרות להעביר שיחות" in agent._config.system_prompt
    print("19 a booking business can hand the caller to a person, or say it cannot      OK")

    # The handover sentence is spoken aloud, so it inflects like everything else.
    STATE.update(status=200, body=dict(SALON, voiceGender="masculine",
                                       ownerTransferNumber="+972500000000"), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    tool = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "transfer_to_owner")
    said = [e async for e in tool(None)]
    assert getattr(said[0], "text", "") == "מעביר אותך לבעל העסק, רגע אחד.", said[0]
    assert getattr(said[-1], "target_phone_number", None) == "+972500000000", said[-1]
    print("20 the handover sentence follows the voice's gender too                      OK")

    # --- 10. the agent is ready before the phone is answered --------------------------
    # Cartesia rings an inbound call for five seconds so pre_call_handler can warm up. Anything left
    # for get_agent happens after the answer, where it is silence on the line.
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    assert main._PENDING, "nothing was prepared during the ring"
    STATE["seen"] = []
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    assert not STATE["seen"], "get_agent went to the network after the call was answered"
    assert agent._config.introduction == SALON["greeting"]
    assert not main._PENDING, "the prepared agent was not handed over"
    print("21 the agent is built during the ring; get_agent does no I/O                 OK")

    # --- 11. a request the agent cannot satisfy still reaches the owner ---------------
    # "someone will get back to you" was previously said with nothing behind it.
    STATE.update(status=200, body=dict(SALON, ownerTransferNumber=None), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    tool = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "message_owner")
    STATE.update(status=200, body={"notified": True}, seen=[])
    out = await tool(None, summary="רוצה מחיר לחבילת כלה", caller_name="דנה")
    path, payload, _ = STATE["seen"][0]
    assert path == "/api/voice/notify-owner", path
    assert payload["message"] == "רוצה מחיר לחבילת כלה" and payload["callerName"] == "דנה", payload
    assert payload["callerNumber"] == "+972533391353", payload
    assert "נשלחה" in out, out

    # An owner with no reachable WhatsApp must not produce a promise the caller waits on.
    STATE.update(status=200, body={"notified": False}, seen=[])
    out = await tool(None, summary="רוצה לדבר עם הבעלים")
    assert "בכנות" in out, out
    print("22 what the agent cannot answer becomes a message to the owner               OK")

    # --- 12. the greeting is spoken, not the WhatsApp one -----------------------------
    # A real call opened by reading the WhatsApp greeting aloud: "🌿" as a word, then the whole
    # intake form — name, adults, children, infants, check-in, check-out — before the caller
    # could say anything.
    WHATSAPP = ("🌿 שלום וברכה! 🌿\nשמחים שפנית אלינו,\nבנחת רוח - צימרים במירון 🏡\n\n"
                "📝 נשמח לקבל את פרטי הבקשה שלך:\n👤 שם מלא:\n📅 תאריך כניסה:")
    STATE.update(status=200, body=dict(SALON, greeting=WHATSAPP, businessName="בנחת רוח"), seen=[])
    pre = await main.pre_call_handler(req())
    intro = (await main.get_agent(None, req(meta=CARTESIA_META)))._config.introduction
    assert intro == "שלום, כאן בנחת רוח. איך אפשר לעזור?", intro
    assert "🌿" not in intro and "שם מלא" not in intro

    # A greeting written deliberately short is still the owner's to keep.
    STATE.update(status=200, body=dict(SALON, greeting="שלום, כאן מספרת רונית. מה שלומך?"), seen=[])
    pre = await main.pre_call_handler(req())
    intro = (await main.get_agent(None, req(meta=CARTESIA_META)))._config.introduction
    assert intro == "שלום, כאן מספרת רונית. מה שלומך?", intro

    # Emoji alone should not cost the owner their greeting — strip them and keep the words.
    assert main.spoken_greeting({"greeting": "🌿 שלום, כאן הצימר 🌷", "businessName": "x"}) == "שלום, כאן הצימר"
    # A bracket placeholder is read out literally, so it falls back like the long ones.
    assert main.spoken_greeting({"greeting": "שלום, [שם העסק]", "businessName": "רונית"}) == "שלום, כאן רונית. איך אפשר לעזור?"
    print("23 the greeting is one spoken sentence, never the WhatsApp text              OK")

    # --- 13. the prepared agent survives a call_id the two hops disagree on -----------
    # Observed live: pre_call_handler stored one id, the start message carried another, and the
    # prepared agent was discarded and rebuilt after the answer — the dead air it exists to remove.
    STATE.update(status=200, body=SALON, seen=[])
    await main.pre_call_handler(req())
    STATE["seen"] = []
    mismatched = CallRequest(call_id="PA_totally_different", **{"from": "+972533391353"},
                             to="+972555077941", agent_call_id="ac", agent={"id": "a1"},
                             metadata=CARTESIA_META)
    agent = await main.get_agent(None, mismatched)
    assert not STATE["seen"], "rebuilt after the answer despite being prepared during the ring"
    assert agent._config.introduction == main.spoken_greeting(SALON)
    print("24 the handover survives the two hops disagreeing about the call id          OK")

    # --- 14. transferring the owner to their own line ---------------------------------
    # The owner testing their own bot calls from the number the business notifies.
    assert main._same_number("972533391353", "+972-53-339-1353")
    assert main._same_number("0533391353", "+972533391353")
    assert not main._same_number("972533391353", "972500000000")

    STATE.update(status=200, body=dict(SALON, ownerTransferNumber="0533391353"), seen=[])
    await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=CARTESIA_META))
    tool = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "transfer_to_owner")
    said = [e async for e in tool(None)]
    assert len(said) == 1 and isinstance(said[0], str), said
    assert "message_owner" in said[0], said[0]
    print("25 no transferring the caller to the line they are already on                OK")

    # --- 26. the context cache, which is what keeps an answered call from waiting -----
    # pre_call_handler and the websocket session run in different processes on the deployed
    # topology, so the _PENDING agent handover misses and get_agent refetches *after* the caller
    # has been answered. Every cache hit here is dead air the caller does not hear.
    main._CONTEXT_TTL = 60.0
    main._CONTEXT_CACHE.clear()
    STATE.update(status=200, body=SALON, seen=[])
    await main.resolve_context(req())
    await main.resolve_context(req())
    assert len(STATE["seen"]) == 1, STATE["seen"]

    # A different caller must NOT reuse it: the response carries the caller's own name and next
    # appointment, so a salon-wide cache would read one caller's details out to the next.
    await main.resolve_context(req(frm="+972540000000"))
    assert len(STATE["seen"]) == 2, STATE["seen"]

    # A failure is never cached — the next call must be free to succeed.
    main._CONTEXT_CACHE.clear()
    STATE.update(status=500, body={"error": "boom"}, seen=[])
    await main.resolve_context(req())
    await main.resolve_context(req())
    assert len(STATE["seen"]) == 2, STATE["seen"]
    main._CONTEXT_TTL = 0.0
    print("26 context cached per caller, never across callers, never on failure         OK")

    # --- 27. the agent's gender belongs to the deployment ------------------------------
    # Two agents exist, one masculine and one feminine, and every call an agent takes is in its own
    # gender. Deriving it per call from Cartesia's voice catalogue put an outbound request between
    # the phone being answered and the greeting — grammar paid for in dead air.
    STATE.update(status=200, body=dict(SALON, voiceGender="feminine"), seen=[])
    main.AGENT_GENDER = "masculine"
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    prompt = agent._config.system_prompt
    assert "אתה עונה" in prompt, prompt[:200]
    # The salon's own voiceGender must not win: it describes a catalogue entry, this describes the
    # deployment actually speaking.
    assert "את עונה" not in prompt

    # Unset falls back to whatever /context worked out, so an older deployment keeps working.
    main.AGENT_GENDER = ""
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    assert "את עונה" in agent._config.system_prompt
    print("27 the deployment's gender wins over the catalogue's, and falls back to it     OK")

    # --- 28. cost reporting, which fails silently by design ----------------------------
    # Every failure path here is swallowed so that bookkeeping can never interrupt a live call —
    # which also means a broken reporter looks exactly like a working one from the outside. These
    # are the only checks that would ever say otherwise.
    class _Usage:
        def __init__(self, prompt, completion, hits=None, details=None):
            self.prompt_tokens = prompt
            self.completion_tokens = completion
            if hits is not None:
                self.prompt_cache_hit_tokens = hits
            if details is not None:
                self.prompt_tokens_details = details

    class _Details:
        def __init__(self, cached, creation):
            self.cached_tokens = cached
            self.cache_creation_tokens = creation

    class _Resp:
        def __init__(self, usage):
            self.usage = usage

    reporter = main._UsageReporter()
    meta = {"litellm_params": {"metadata": main._usage_metadata("+972555077941", "+972533391353")["metadata"]},
            "model": "deepseek/deepseek-chat"}

    STATE.update(status=200, body={"logged": True}, seen=[])
    await reporter.async_log_success_event(meta, _Resp(_Usage(9000, 300, hits=8000)), 0, 1)
    path, payload, _auth = STATE["seen"][0]
    assert path == "/api/voice/usage", path
    # prompt_tokens INCLUDES the cache hits, so reporting it whole would bill the cached portion
    # twice — once at full rate and again as a cache read. Same trap as the WhatsApp side.
    assert payload["inputTokens"] == 1000, payload
    assert payload["cacheReadTokens"] == 8000, payload
    assert payload["outputTokens"] == 300, payload
    # The ledger is keyed on the bare model id; "deepseek/deepseek-chat" would price at null.
    assert payload["model"] == "deepseek-chat", payload
    assert payload["calledNumber"] == "+972555077941", payload

    # A call with no usage block reports nothing rather than zeros, which would read as a free call.
    STATE.update(status=200, body={"logged": True}, seen=[])
    await reporter.async_log_success_event(meta, _Resp(None), 0, 1)
    assert STATE["seen"] == [], STATE["seen"]

    # Somebody else's litellm call (no tori metadata) is not attributed to a random salon.
    STATE.update(status=200, body={"logged": True}, seen=[])
    await reporter.async_log_success_event({"litellm_params": {}}, _Resp(_Usage(10, 1)), 0, 1)
    assert STATE["seen"] == [], STATE["seen"]

    # Anthropic's shape: LiteLLM folds cache reads AND writes into prompt_tokens and reports them
    # under prompt_tokens_details. Reading only DeepSeek's field priced every cached Haiku token at
    # the full input rate — undoing, in the ledger, the exact discount cache_control buys.
    STATE.update(status=200, body={"logged": True}, seen=[])
    await reporter.async_log_success_event(
        meta, _Resp(_Usage(9000, 300, details=_Details(cached=7000, creation=1500))), 0, 1)
    payload = STATE["seen"][0][1]
    assert payload["inputTokens"] == 500, payload
    assert payload["cacheReadTokens"] == 7000, payload
    assert payload["cacheCreationTokens"] == 1500, payload

    # A backend that rejects the report must not raise into the call. This is the one that matters:
    # an exception in a callback mid-call is a caller hearing silence, for a ledger row.
    STATE.update(status=500, body={"error": "boom"}, seen=[])
    await reporter.async_log_success_event(meta, _Resp(_Usage(10, 1)), 0, 1)
    print("28 usage reported per call, deduped against cache hits, never raising          OK")

    # Streamed responses only carry usage when asked for it, and Anthropic rejects the parameter
    # outright — so it has to be attached per provider, not unconditionally.
    assert main._stream_usage_option("deepseek/deepseek-chat") == {"stream_options": {"include_usage": True}}
    # Anthropic 400s on the parameter, which would take down every call rather than just the
    # bookkeeping — and it reports usage on its stream without being asked.
    assert main._stream_usage_option("anthropic/claude-haiku-4-5-20251001") == {}
    print("29 streamed usage is requested, and only where the provider accepts it         OK")

    # --- 30. the settings that decide whether the call feels like a conversation --------
    STATE.update(status=200, body=SALON, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    cfg = agent._config

    # Thinking is measured in seconds with a caller on the line, and nothing here needs it.
    assert cfg.reasoning_effort == "none", cfg.reasoning_effort
    # A backstop against a monologue the caller has to sit through.
    assert cfg.max_tokens == 300, cfg.max_tokens
    # A hung request should become an apology, not an open line.
    assert cfg.timeout == 15.0 and cfg.num_retries == 1, (cfg.timeout, cfg.num_retries)

    # The system prompt carries the whole salon and is re-sent every turn; marking it cacheable is
    # documented to take 200-400ms off time to first token.
    anthropic = main._latency_extra("anthropic/claude-haiku-4-5-20251001")
    assert anthropic["cache_control_injection_points"] == [{"location": "message", "role": "system"}], anthropic
    # Anthropic's shape only. DeepSeek caches server-side and has no use for it; sending it a shape
    # it does not expect risks a 400 on every turn of every call.
    assert main._latency_extra("deepseek/deepseek-chat") == {}
    print("30 the call is configured for first-token latency, not for throughput          OK")

    # --- 31. even the apology speaks in the deployment's gender -------------------------
    # The apology agent answers when there is no salon to speak for — the worst call we have, and
    # the one whose grammar an instruction-only fix can't reach because its sentence is pre-written.
    main.AGENT_GENDER = "masculine"
    ag = main._apology_agent("שלום")
    assert "ענה" in ag._config.system_prompt and "לשון זכר" in ag._config.system_prompt
    main.AGENT_GENDER = ""
    ag = main._apology_agent("שלום")
    assert "עני" in ag._config.system_prompt and "לשון נקבה" in ag._config.system_prompt
    print("31 the apology agent is inflected by deployment gender too                     OK")

    # --- 32. lessons from the first full live call ---------------------------------------
    # Each of these is a sentence the agent actually said on a real call, encoded so it cannot
    # come back: it asked a known caller for the number the system already had (and got a
    # mis-transcribed one, which went to the owner), it offered to send pictures it cannot send,
    # and it spoke markdown asterisks aloud.
    STATE.update(status=200, body=dict(SALON, caller={"isKnownCustomer": True, "name": "דנה", "upcomingAppointment": None}), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    prompt = agent._config.system_prompt
    assert "מועבר אוטומטית" in prompt, "known caller must be told the number is already known"
    assert "ספרה-ספרה" in prompt, "a dictated number must be read back before use"
    assert "send_details" in prompt, "the agent must know it can send details itself"
    assert "Markdown" in prompt, "spoken output must forbid markdown"
    # A live call read the hyphen inside an FAQ phone number aloud as the word "minus" — the model,
    # not the TTS, wrote it while spelling out the digits.
    assert "מינוס" in prompt, "phone numbers must be read digit by digit, hyphens silent"
    print("32 the live call's failures are pinned into the prompt                          OK")

    # --- 33. the agent fulfils "send me pictures" itself ---------------------------------
    # On a live call the only move was relaying a note to the owner — the exact manual step the
    # product sells the removal of. The tool sends details+photos to the caller's WhatsApp or
    # email during the call, and the agent may only claim "sent" after the tool says so.
    STATE.update(status=200, body=ZIMMER, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    send = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "send_details")

    STATE.update(status=200, body={"sent": True, "photos": 3}, seen=[])
    said = await send(None, "גפן", "email", to_email="y@x.test")
    path, payload, _auth = STATE["seen"][0]
    assert path == "/api/voice/send-details", path
    assert payload == {"calledNumber": "+972555077941", "serviceName": "גפן", "channel": "email", "toEmail": "y@x.test"}, payload
    assert "נשלחו" in said, said

    # WhatsApp rides the caller ID the agent already has — never a dictated number.
    STATE.update(status=200, body={"sent": True, "photos": 2}, seen=[])
    await send(None, "גפן", "whatsapp")
    assert STATE["seen"][0][1]["callerNumber"] == "+972533391353", STATE["seen"][0][1]

    # A closed WhatsApp window is refused by the backend (Meta would accept the send and kill it
    # in transit); the agent is steered to email, not to a false "sent".
    STATE.update(status=409, body={"error": "no window"}, seen=[])
    said = await send(None, "גפן", "whatsapp")
    assert "מייל" in said and "נשלחו" not in said, said

    # No photos configured is said honestly, not papered over.
    STATE.update(status=200, body={"sent": True, "photos": 0}, seen=[])
    said = await send(None, "גפן", "email", to_email="y@x.test")
    assert "אין תמונות" in said, said
    print("33 'send me pictures' is fulfilled by the agent, honestly                       OK")

    # --- 34. the agent hangs up when the conversation is over ----------------------------
    # A live call sat open for three minutes after the agent's last word, waiting for the caller
    # to press end — billed airtime, and to the caller a bot that did not notice the call was
    # finished. Ending is the agent's job.
    STATE.update(status=200, body=ZIMMER, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    names = [getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in agent._tools]
    assert "end_call" in names, names
    prompt = agent._config.system_prompt
    # Say goodbye first, and never cut someone off mid-sentence — hanging up on a live caller is
    # worse than the open line this fixes.
    assert "end_call" in prompt and "פרידה" in prompt, prompt[-400:]
    print("34 the agent ends the call itself once the caller is done                       OK")

    # --- 35. the call leaves a record ----------------------------------------------------
    # Until now a phone call left nothing: no customer row, no transcript. Every WhatsApp exchange
    # lands in the dashboard's Conversations view; the channel where a caller states their dates
    # and party size produced one owner note at best, and the owner could not answer "who called
    # this morning and what did they want".
    main._TRANSCRIPT_SENT.clear()
    STATE.update(status=200, body={"stored": 2}, seen=[])
    msgs = [
        {"role": "system", "content": "prompt"},
        {"role": "user", "content": "אני רוצה צימר לשלושה"},
        {"role": "assistant", "content": "יש לנו תאנה"},
    ]
    await main._post_transcript("+972555077941", "+972533391353", msgs)
    path, payload, _auth = STATE["seen"][0]
    assert path == "/api/voice/transcript", path
    # The system prompt is not part of the conversation, and tool plumbing is not either.
    assert payload["turns"] == [
        {"role": "user", "content": "אני רוצה צימר לשלושה"},
        {"role": "assistant", "content": "יש לנו תאנה"},
    ], payload

    # Each turn is stored once: the callback fires per LLM call and sees the whole history again.
    STATE.update(status=200, body={"stored": 1}, seen=[])
    msgs = msgs + [{"role": "user", "content": "כמה זה עולה?"}]
    await main._post_transcript("+972555077941", "+972533391353", msgs)
    assert STATE["seen"][0][1]["turns"] == [{"role": "user", "content": "כמה זה עולה?"}], STATE["seen"][0][1]

    # A failed post is retried on the next turn rather than losing the rows silently.
    main._TRANSCRIPT_SENT.clear()
    STATE.update(status=500, body={"error": "boom"}, seen=[])
    await main._post_transcript("+972555077941", "+972533391353", msgs)
    STATE.update(status=200, body={"stored": 3}, seen=[])
    await main._post_transcript("+972555077941", "+972533391353", msgs)
    assert len(STATE["seen"][0][1]["turns"]) == 3, STATE["seen"][0][1]

    # Never raises into the call — a lost transcript row is a gap in a dashboard; an exception here
    # is a caller hearing silence.
    await main._post_transcript("+972555077941", "+972533391353", None)
    print("35 the call is recorded turn by turn, each turn once, never raising              OK")

    # --- 36. a transfer records the lead before handing the call over --------------------
    # A live call collected name, unit, dates, nights and an email — then the agent transferred
    # and nothing else. The transfer never connected, the call ended, and neither the owner nor
    # the caller got anything. A transfer is best-effort by nature; the written record is not, so
    # it happens inside the transfer rather than as a second tool the model may skip.
    STATE.update(status=200, body=dict(ZIMMER, ownerTransferNumber="+972500000000"), seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    transfer = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "transfer_to_owner")

    STATE.update(status=200, body={"notified": True}, seen=[])
    events = [e async for e in transfer(None, summary="ראובן, תאנה, רביעי-חמישי, שני לילות", caller_name="ראובן")]
    path, payload, _auth = STATE["seen"][0]
    assert path == "/api/voice/notify-owner", path
    assert "ראובן" in payload["message"] and payload["callerName"] == "ראובן", payload
    # And the handover still happens — recording replaces nothing.
    assert any(type(e).__name__ == "AgentTransferCall" for e in events), events

    # The prompt tells it to summarise before transferring, in both places a transfer can happen.
    prompt = agent._config.system_prompt
    assert "message_owner" in prompt and "העברה יכולה להיכשל" in prompt, prompt[-500:]

    # Email is asked for only when WhatsApp is not an option — a live call burned three minutes
    # spelling an address the caller never needed to give.
    assert "אל תבקש" in prompt or "אל תבקשי" in prompt, prompt[-800:]
    print("36 a transfer records the lead first, and email is asked for only on demand     OK")

    # --- 37. the agent knows what day it is, and invents no website ----------------------
    # On a live call someone asked for a room "מחר" and the agent answered "מחר זה יום כמה?",
    # then apologised that it cannot see today's date. Relative dates are how people actually
    # book, so the date goes in the prompt rather than being asked of the caller.
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _tz
    block = main._today_block(_dt(2026, 8, 11, 23, 30, tzinfo=_tz("Asia/Jerusalem")))
    # 11 Aug 2026 is a Tuesday. Late evening, because UTC would still say the 11th at 23:30 but
    # says the 10th at 01:00 — being a day off is worse than being vague.
    assert "היום יום שלישי" in block and "מחר יום רביעי" in block, block
    assert "אחד עשר באוגוסט" in block and "שנים עשר באוגוסט" in block, block
    assert "## היום" in prompt and "יום" in prompt, prompt[:400]

    # The pronunciation example used to be a plausible-looking domain, and the model read it out
    # to a caller as this zimmer's actual website when send_details failed. An example that can be
    # mistaken for real data is data.
    assert "zimmermeron" not in prompt, "a fake domain is back in the prompt"
    assert "אל תמציא" in prompt or "אל תמציאי" in prompt, prompt
    print("37 the agent knows today's date, and quotes no website it was not given         OK")

asyncio.run(main_())
print("\nALL CHECKS PASSED")
