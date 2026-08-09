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

srv = HTTPServer(("127.0.0.1", 877), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

os.environ["TORI_API_URL"] = "http://127.0.0.1:877"
os.environ["CARTESIA_TOOL_SECRET"] = "topsecret"
import main
from line import CallRequest

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
    assert names == ["book_appointment", "cancel_appointment", "check_availability", "reschedule_appointment"], names
    assert "תספורת אישה" in cfg.system_prompt and "120" in cfg.system_prompt
    assert "דנה" in cfg.system_prompt          # known caller surfaced
    assert "לקוחה" in cfg.system_prompt        # vertical vocabulary used
    print("2 slot business: salon greeting, 4 booking tools, prices+caller in prompt   OK")

    # --- 2. inquiry business gets transfer, not booking --------------------------------
    STATE.update(status=200, body=BNB, seen=[])
    pre = await main.pre_call_handler(req())
    agent = await main.get_agent(None, req(meta=pre.metadata))
    names = sorted(getattr(t, "__name__", None) or getattr(t, "name", str(t)) for t in (agent._tools or []))
    assert names == ["transfer_to_owner"], names
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
    main.TORI_API_URL = "http://127.0.0.1:877"

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
    assert "transfer_to_owner" not in names, names
    assert "אין מספר להעברת שיחות" in agent._config.system_prompt
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

asyncio.run(main_())
print("\nALL CHECKS PASSED")
