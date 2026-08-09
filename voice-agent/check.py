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
    assert pre is not None and pre.metadata.get("tori_error")
    print("6 404 unknown number: answers rather than dropping                          OK")

    main.TORI_API_URL = "http://127.0.0.1:9"   # nothing listening (module const, not env)
    pre = await main.pre_call_handler(req())
    assert pre is not None and "מצטערת" in pre.metadata["tori_error"]
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
    assert "12:00" in out and "2026-08-12T09:00:00Z" in out
    print("8 tools carry the dialled number themselves; caller is never asked          OK")

    STATE.update(status=409, body={"error": "Slot no longer available"}, seen=[])
    book = next(t for t in agent._tools if (getattr(t, "__name__", None) or getattr(t, "name", "")) == "book_appointment")
    out = await book(None, service_name="תספורת אישה", start_time="2026-08-12T09:00:00Z")
    assert "נתפס" in out, out
    print("9 booking a taken slot returns a recoverable instruction, not a crash       OK")

asyncio.run(main_())
print("\nALL CHECKS PASSED")
