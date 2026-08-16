"""
Does the model do what the prompt tells it to — in Hebrew, and with the tools?

`bench_ttft.py` settled speed and found the gap between Haiku and DeepSeek is ~100ms rather than the
order of magnitude the model choice was justified by. Speed was never the whole question though: an
agent that answers in 660ms and books the wrong hour is worse than one that answers in 790ms and
books the right one. This measures the other two axes, on the same prompt and the same tools the
live agent runs with.

## What it checks, and why these things

**Tool calling.** Every case is one where the right move is not a matter of taste:

  * A caller asking for a time must produce `check_availability` — the model has no slot list and
    inventing one is the failure the prompt spends three rules trying to prevent.
  * Given a slot list, booking must send `start_time` back **byte for byte**. The prompt says so
    explicitly ("העבר ל-startTime בדיוק את המחרוזת"), because the backend parses that string and a
    model that "tidies" the timezone books a different hour, or nothing at all. This is the single
    most valuable case here: it is silent when it breaks — the caller hears a confirmation.
  * "Let me talk to a person" must reach `transfer_to_owner`, the most ordinary request a caller
    makes and the one an agent without the tool talks straight past.
  * Goodbye must reach `end_call`, or the line stays open on billed airtime.
  * A price question must call **nothing**. The price is in the prompt. A model that reaches for a
    tool it does not need spends a network round trip per turn, and this is the case that catches
    tool-calling enthusiasm as a latency bug rather than a correctness one.

**Hebrew.** Only rules the prompt actually states, checked mechanically, so the score is not one
model's opinion of another's Hebrew:

  * digits (the prompt demands words — "מאה ועשרים שקל", never "120")
  * Markdown and emoji (every character reaches TTS and is spoken aloud)
  * slash forms ("מעוניין/ת"), which the prompt bans by name
  * self-reference in the wrong grammatical gender — the rule with the most words devoted to it
  * length past two sentences, the prompt's stated ceiling

The gender check is a lexicon of unambiguous participles, not a parser. Hebrew has many forms that
are identical in both genders (רוצה, עונה, עושה) and those are deliberately absent — counting them
would manufacture violations. It reports what it flagged and quotes the sentence, so a wrong flag is
visible rather than buried in a total.

    cd voice-agent && python bench_quality.py [--models a,b] [--dry-run]

Reads ANTHROPIC_API_KEY and DEEPSEEK_API_KEY; a model whose key is absent is skipped and said so.
"""

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional

# Before `import main`: the module reads all three at import time. The gender is what production
# runs (TORI_AGENT_GENDER=masculine on the Railway service), and it decides which half of FORMS the
# prompt is built from — so leaving it unset would grade the model against rules the live agent is
# not given.
os.environ.setdefault("TORI_API_URL", "http://127.0.0.1:1")
os.environ.setdefault("CARTESIA_TOOL_SECRET", "bench")
os.environ.setdefault("TORI_AGENT_GENDER", "masculine")

# LlmAgent refuses to construct without a key, and this builds one purely to read its tool schemas
# back — the completions below go through litellm directly with the real key. So a placeholder when
# nothing is configured, which is what makes `--dry-run` work on a machine with no keys at all.
if not any(os.environ.get(k) for k in ("TORI_AGENT_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY")):
    os.environ["TORI_AGENT_API_KEY"] = "unused-by-bench"

import main  # noqa: E402 — env must be set before the module reads it

CANDIDATES = [
    ("anthropic/claude-haiku-4-5-20251001", "ANTHROPIC_API_KEY"),
    ("deepseek/deepseek-chat", "DEEPSEEK_API_KEY"),
]

# A salon that books by itself: the tools under test are the booking ones.
SALON = {
    "businessName": "מספרת רות",
    "bookingModel": "appointment",
    "voiceGender": "masculine",
    "timezone": "Asia/Jerusalem",
    "address": "הרצל 12, חיפה",
    "services": [
        {"name": "תספורת גבר", "priceIls": 80, "durationMin": 30},
        {"name": "תספורת אישה", "priceIls": 120, "durationMin": 45},
        {"name": "צבע", "priceIls": 320, "durationMin": 120},
    ],
    "hours": [{"dayOfWeek": d, "openMin": 540, "closeMin": 1140} for d in range(6)],
    "faq": [{"question": "יש חניה?", "answer": "חניון בתשלום מתחת לבניין"}],
    "caller": {"isKnownCustomer": True, "name": "דנה", "upcomingAppointment": None},
    "vocabulary": {"customerHe": "לקוח"},
    "cancellationPolicy": "ביטול עד 24 שעות לפני התור",
    "ownerTransferNumber": "+972500000000",
}

# The Meron B&B from bench_ttft: an inquiry business, so it has no booking tools and the handover
# *is* the job. Kept because the two businesses exercise different tool sets from one prompt builder.
BNB = {
    "businessName": 'צימר "בנחת רוח"',
    "bookingModel": "inquiry",
    "voiceGender": "masculine",
    "timezone": "Asia/Jerusalem",
    "address": "מירון",
    "services": [
        {"name": "חיטה", "priceIls": 800, "durationMin": 1440, "description": "צימר זוגי", "capacity": 2},
        {"name": "גפן", "priceIls": 2100, "durationMin": 1440, "description": "משפחתית גדולה", "capacity": 6},
    ],
    "hours": [{"dayOfWeek": d, "openMin": 540, "closeMin": 1200} for d in range(6)],
    "faq": [{"question": "יש בריכה?", "answer": "לכל יחידה יש ג'קוזי פרטי"}],
    "caller": {"isKnownCustomer": False, "name": None, "upcomingAppointment": None},
    "vocabulary": {"customerHe": "אורח"},
    "pricingNotes": "המחירים ללילה, לא כולל ארוחת בוקר",
    "ownerTransferNumber": "+972500000000",
}

CALLER = "+972521234567"
DIALLED = "+97247777777"

# What check_availability really returns, built with the agent's own formatter so the fixture cannot
# drift from production. The startTime strings are what book_appointment must echo back untouched.
SLOT_ISO = ["2026-08-18T15:00:00+03:00", "2026-08-18T16:30:00+03:00"]
SLOTS_REPLY = "\n".join(
    f"{main._spoken_clock(t[11:16])} (startTime={t})" for t in SLOT_ISO
)


def tool_defs_for(ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    The tool schemas the live agent sends, taken from the live agent.

    `build_agent` is the only place that decides which tools a business gets (an inquiry B&B has no
    booking tools at all), so the agent is built and its tools read back rather than re-listed here
    — a hand-copied list would pass this benchmark long after production stopped matching it.

    The normalization mirrors the SDK's own `_normalize_tools`, minus the web-search branch this
    agent never uses. It is private, hence copied rather than called; `_tools` and the two helpers
    are the seam, and if a future SDK moves them this raises rather than silently measuring nothing.
    """
    from line.llm_agent.schema_converter import tools_to_litellm
    from line.llm_agent.tools.decorators import loopback_tool
    from line.llm_agent.tools.utils import ClassTool, FunctionTool

    agent = main.build_agent({"context": ctx}, DIALLED, CALLER)
    resolved = []
    for spec in agent._tools:
        if isinstance(spec, FunctionTool):
            resolved.append(spec)
        elif isinstance(spec, ClassTool):
            resolved.append(spec.as_function_tool())
        else:
            resolved.append(loopback_tool(spec))
    return tools_to_litellm(resolved)


def _assistant_tool_call(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)},
        }],
    }


# Each case is a conversation the agent could plausibly be in, and one unambiguous next move.
CASES = [
    {
        "id": "availability",
        "ctx": SALON,
        "turns": [{"role": "user", "content": "אני רוצה תור לתספורת אישה ביום שלישי"}],
        "expect_tool": "check_availability",
        "why": "אין לו רשימת זמנים — כל תשובה אחרת היא המצאה",
    },
    {
        "id": "verbatim-booking",
        "ctx": SALON,
        "turns": [
            {"role": "user", "content": "אני רוצה תור לתספורת אישה ביום שלישי"},
            _assistant_tool_call("check_availability", {"service_name": "תספורת אישה", "date": "2026-08-18"}),
            {"role": "tool", "tool_call_id": "call_1", "content": SLOTS_REPLY},
            {"role": "assistant", "content": "יש שלוש וארבע וחצי. מה מתאים?"},
            {"role": "user", "content": "שלוש זה מצוין"},
        ],
        "expect_tool": "book_appointment",
        "expect_args": {"start_time": SLOT_ISO[0]},
        "why": "startTime חייב לחזור מילה במילה — הבקאנד מפרסר את המחרוזת הזאת",
    },
    {
        "id": "human-please",
        "ctx": BNB,
        "turns": [{"role": "user", "content": "אפשר לדבר עם בעל המקום בבקשה?"}],
        "expect_tool": "transfer_to_owner",
        "why": "הבקשה הכי רגילה בטלפון",
    },
    {
        "id": "goodbye",
        "ctx": SALON,
        "turns": [
            {"role": "user", "content": "מעולה, תודה רבה"},
            {"role": "assistant", "content": "בשמחה. שיהיה יום טוב."},
            {"role": "user", "content": "ביי ביי"},
        ],
        "expect_tool": "end_call",
        "why": "בלי זה הקו נשאר פתוח על זמן אוויר בתשלום",
    },
    {
        "id": "price-no-tool",
        "ctx": SALON,
        "turns": [{"role": "user", "content": "כמה עולה תספורת גבר?"}],
        "expect_no_tool": True,
        "why": "המחיר כתוב בפרומפט — קריאת כלי כאן היא סבב רשת מיותר בכל תור",
    },
]

# Cases graded on what is said rather than what is called. Kept apart because a turn that calls a
# tool produces no speech at all, and grading silence as perfect Hebrew would flatter every model
# that reaches for a tool.
SPEECH_CASES = [
    {"id": "price", "ctx": SALON, "turns": [{"role": "user", "content": "כמה עולה צבע?"}]},
    {"id": "hours", "ctx": SALON, "turns": [{"role": "user", "content": "עד מתי אתם פתוחים היום?"}]},
    {"id": "phone-back", "ctx": SALON, "turns": [
        {"role": "user", "content": "תרשום את הטלפון שלי, אפס חמש שתיים, אחד שתיים שלוש, ארבע חמש שש שבע"},
    ]},
    {"id": "options", "ctx": BNB, "turns": [{"role": "user", "content": "מה יש לכם?"}]},
    {"id": "unknown", "ctx": BNB, "turns": [{"role": "user", "content": "יש גישה לנכים?"}]},
    {"id": "self-ref", "ctx": SALON, "turns": [{"role": "user", "content": "אתה יכול לבדוק לי משהו?"}]},
]

# ---------------------------------------------------------------------------
# Hebrew checks. Every one of these is a rule the prompt states in so many words.
# ---------------------------------------------------------------------------

DIGITS = re.compile(r"\d")
MARKDOWN = re.compile(r"[*#`_~]|^\s*[-•]\s", re.M)
SLASH_FORM = re.compile(r"[֐-׿]/[֐-׿]")
OPENING_CRY = re.compile(r"^\s*(מצוין|מעולה|נהדר|וואו|בהנאה|יופי|אחלה)\s*[!,.]")

# Unambiguous present-tense participles only. Pairs that are spelled the same in both genders
# (רוצה, עונה, עושה, יכולה vs יכול is fine, but שמח/שמחה is) are the reason this is a list and not a
# suffix rule: "אני רוצה" is correct in either gender and a ־ה rule would score it as feminine.
MASC_SELF = ["בודק", "מעביר", "שולח", "מבין", "יכול", "צריך", "שמח", "בטוח", "מצטער",
             "אומר", "קובע", "מחפש", "מציע", "ממליץ", "מתנצל", "יודע", "חושב", "כותב", "רואה"]
FEM_SELF = ["בודקת", "מעבירה", "שולחת", "מבינה", "יכולה", "צריכה", "שמחה", "בטוחה", "מצטערת",
            "אומרת", "קובעת", "מחפשת", "מציעה", "ממליצה", "מתנצלת", "יודעת", "חושבת", "כותבת"]

# "אני" (or "אני לא", "אני כבר") within a couple of words before the participle. Without the anchor
# the check would fire on "אתה צריך", which is the agent talking about the caller and perfectly
# correct.
def _self_forms(text: str, words: List[str]) -> List[str]:
    hits = []
    for w in words:
        for m in re.finditer(rf"\bאני\b[֐-׿\s]{{0,12}}?\b{w}\b", text):
            hits.append(m.group(0))
    return hits


def _sentences(text: str) -> List[str]:
    return [s for s in re.split(r"[.!?]+", text) if s.strip()]


def speech_violations(text: str, want_gender: str) -> List[str]:
    """Rule name → one per violated rule, with the offending fragment quoted."""
    bad = []
    if DIGITS.search(text):
        bad.append(f"digits({''.join(sorted(set(DIGITS.findall(text))))})")
    if MARKDOWN.search(text):
        bad.append(f"markdown({MARKDOWN.search(text).group(0)!r})")
    if main._DECORATION.search(text):
        bad.append("emoji")
    if SLASH_FORM.search(text):
        bad.append(f"slash({SLASH_FORM.search(text).group(0)})")
    if OPENING_CRY.search(text):
        bad.append(f"opens-with({OPENING_CRY.search(text).group(1)})")
    wrong = _self_forms(text, FEM_SELF if want_gender == "masculine" else MASC_SELF)
    if wrong:
        bad.append(f"gender({wrong[0]!r})")
    n = len(_sentences(text))
    if n > 2:
        bad.append(f"{n}-sentences")
    return bad


# ---------------------------------------------------------------------------


def run_turn(model: str, api_key: str, system: str, turns: List[Dict[str, Any]],
             tools: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """One non-streamed completion, shaped like the agent's. Returns text and tool calls."""
    import litellm

    kwargs: Dict[str, Any] = dict(
        model=model,
        api_key=api_key,
        messages=[{"role": "system", "content": system}, *turns],
        temperature=0.3,
        max_tokens=300,
    )
    if tools:
        kwargs["tools"] = tools
    # Matching production: a reasoning turn on a phone call is seconds of silence, so the agent
    # turns it off and the benchmark must grade the same configuration.
    if model.startswith("anthropic/"):
        kwargs["reasoning_effort"] = "none"

    resp = litellm.completion(**kwargs)
    msg = resp.choices[0].message
    calls = []
    for call in (getattr(msg, "tool_calls", None) or []):
        try:
            args = json.loads(call.function.arguments or "{}")
        except Exception:
            args = {"__unparseable__": call.function.arguments}
        calls.append({"name": call.function.name, "args": args})
    return {"text": (msg.content or "").strip(), "calls": calls}


def main_() -> int:
    dry = "--dry-run" in sys.argv
    only = None
    for i, a in enumerate(sys.argv):
        if a == "--models" and i + 1 < len(sys.argv):
            only = set(sys.argv[i + 1].split(","))

    prompts = {id(SALON): main.build_prompt(SALON, caller_known=True),
               id(BNB): main.build_prompt(BNB, caller_known=False)}
    tools = {id(SALON): tool_defs_for(SALON), id(BNB): tool_defs_for(BNB)}

    print(f"Salon prompt: {len(prompts[id(SALON)])} chars, "
          f"{len(tools[id(SALON)])} tools: {', '.join(t['function']['name'] for t in tools[id(SALON)])}")
    print(f"B&B prompt:   {len(prompts[id(BNB)])} chars, "
          f"{len(tools[id(BNB)])} tools: {', '.join(t['function']['name'] for t in tools[id(BNB)])}")
    print(f"Gender under test: {main.AGENT_GENDER}\n")

    if dry:
        print(json.dumps(tools[id(SALON)], ensure_ascii=False, indent=2)[:4000])
        return 0

    models = [(m, k) for m, k in CANDIDATES if not only or m in only]
    scores: Dict[str, Dict[str, int]] = {}

    for model, key_var in models:
        api_key = os.environ.get(key_var, "")
        if not api_key:
            print(f"{model}\n  skipped — {key_var} is not set\n")
            continue

        short = model.split("/")[-1]
        tool_pass = tool_total = 0
        speech_bad: List[str] = []
        print(f"=== {short} — tool calling ===")
        for case in CASES:
            tool_total += 1
            try:
                out = run_turn(model, api_key, prompts[id(case["ctx"])], case["turns"], tools[id(case["ctx"])])
            except Exception as exc:
                print(f"  {case['id']:20} ERROR — {str(exc)[:110]}")
                continue

            names = [c["name"] for c in out["calls"]]
            if case.get("expect_no_tool"):
                if names:
                    print(f"  {case['id']:20} FAIL — called {names}, should have answered from the prompt")
                else:
                    tool_pass += 1
                    print(f"  {case['id']:20} ok   — answered without a tool")
                continue

            want = case["expect_tool"]
            if want not in names:
                print(f"  {case['id']:20} FAIL — called {names or 'nothing'}, wanted {want}")
                if out["text"]:
                    print(f"  {'':20}        said: {out['text'][:90]}")
                continue

            call = next(c for c in out["calls"] if c["name"] == want)
            wrong = {k: (call["args"].get(k), v) for k, v in (case.get("expect_args") or {}).items()
                     if call["args"].get(k) != v}
            if wrong:
                for k, (got, exp) in wrong.items():
                    print(f"  {case['id']:20} FAIL — {want}.{k}={got!r}, wanted {exp!r}")
            else:
                tool_pass += 1
                print(f"  {case['id']:20} ok   — {want}")

        print(f"\n=== {short} — spoken Hebrew ===")
        for case in SPEECH_CASES:
            try:
                out = run_turn(model, api_key, prompts[id(case["ctx"])], case["turns"], tools[id(case["ctx"])])
            except Exception as exc:
                print(f"  {case['id']:20} ERROR — {str(exc)[:110]}")
                continue
            text = out["text"]
            if not text:
                print(f"  {case['id']:20} (no speech — called {[c['name'] for c in out['calls']]})")
                continue
            bad = speech_violations(text, main.AGENT_GENDER)
            speech_bad += bad
            mark = "ok  " if not bad else "FAIL"
            print(f"  {case['id']:20} {mark} {' '.join(bad)}")
            print(f"  {'':20}      {text[:150]}")

        scores[short] = {"tools_pass": tool_pass, "tools_total": tool_total, "speech_violations": len(speech_bad)}
        print()

    if not scores:
        print("Nothing measured. Set ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY.")
        return 1

    print(f"{'model':34} {'tools':>10} {'speech rule breaks':>20}")
    print("-" * 66)
    for name, s in scores.items():
        print(f"{name:34} {s['tools_pass']}/{s['tools_total']:>8} {s['speech_violations']:>20}")
    print(
        "\nTool failures are the ones to read first: a wrong startTime books the wrong hour and the\n"
        "caller hears a confirmation either way. Speech breaks are audible but recoverable — a digit\n"
        "read as a digit sounds wrong, it does not book anything wrong."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main_())
