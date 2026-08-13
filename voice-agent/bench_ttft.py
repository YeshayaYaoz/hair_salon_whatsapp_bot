"""
Time to first token, Haiku against DeepSeek, on the prompt this agent actually sends.

The model choice in main.py is justified by one number: "published figures put Haiku 4.5 near
100-150ms against DeepSeek's 0.8-1.8s", and that gap is what buys the ~7x token price. A real call
measured 590, 594, 898, 936 and 1051ms of `llm_first_chunk_ms` — four to seven times the figure the
decision rested on. Some of that is the network and the hop through Cartesia rather than the model,
which is exactly why it cannot be settled from a call log: the log times the whole round trip and
the decision is about one leg of it.

So this measures that leg directly, from one machine, against both providers in turn.

Two things it does deliberately:

  * It sends the real system prompt, rendered by build_prompt from a salon of realistic size.
    Time to first token scales with how much prompt the model reads first, and a "hello" benchmark
    would flatter both models by a margin that has nothing to do with answering a phone.
  * It reports every sample, not just an average. The number that matters on a phone call is not
    the mean — it is how bad the slow ones get, because one caller in ten talking over the answer
    is the failure, and a mean hides it behind the fast majority.

    cd voice-agent && python bench_ttft.py [iterations]

Reads ANTHROPIC_API_KEY and DEEPSEEK_API_KEY; a model whose key is absent is skipped and said so.
"""

import os
import statistics
import sys
import time

# main.py reads these at import. Nothing here reaches the Tori backend — only the model providers —
# so they exist to let the module load, exactly as in check.py.
os.environ.setdefault("TORI_API_URL", "http://127.0.0.1:1")
os.environ.setdefault("CARTESIA_TOOL_SECRET", "bench")

import main  # noqa: E402 — env must be set before the module reads it

# The Meron B&B from the call that raised the question: four units with prices, hours, policy and
# an FAQ. Roughly what a real salon renders to, which is the point — see the note above.
CONTEXT = {
    "businessName": 'צימר "בנחת רוח"',
    "bookingModel": "inquiry",
    "timezone": "Asia/Jerusalem",
    "address": "מירון",
    "greeting": 'שלום, כאן צימר "בנחת רוח". איך אפשר לעזור?',
    "services": [
        {"name": "חיטה", "priceIls": 800, "durationMin": 1440, "description": "צימר זוגי קטן ונעים", "capacity": 2},
        {"name": "תאנה", "priceIls": 1000, "durationMin": 1440, "description": "צימר לזוג וילד", "capacity": 3},
        {"name": "גפן", "priceIls": 2100, "durationMin": 1440, "description": "משפחתית גדולה", "capacity": 6},
        {"name": "תמר", "priceIls": 3000, "durationMin": 1440, "description": "משפחתית ענקית", "capacity": 10},
    ],
    "hours": [{"dayOfWeek": d, "openMin": 540, "closeMin": 1200} for d in range(6)],
    "faq": [
        {"question": "יש בריכה?", "answer": "לכל יחידה יש ג'קוזי פרטי"},
        {"question": "מותר להביא חיות?", "answer": "לא, אין אפשרות להכניס בעלי חיים"},
        {"question": "יש חניה?", "answer": "חניה פרטית צמודה לכל יחידה"},
    ],
    "caller": {"isKnownCustomer": False, "name": None, "upcomingAppointment": None},
    "vocabulary": {"customerHe": "אורח"},
    "cancellationPolicy": "ביטול עד שבעה ימים לפני מועד ההגעה ללא חיוב",
    "availabilityInfo": "בסופי שבוע מינימום שני לילות",
    "specialPeriods": [],
    "pricingNotes": "המחירים ללילה, לא כולל ארוחת בוקר",
    "personality": None,
    "ownerTransferNumber": "+972500000000",
}

# What a caller says first, more often than anything else.
TURN = "אני רוצה להזמין צימר לסוף השבוע"

CANDIDATES = [
    ("anthropic/claude-haiku-4-5-20251001", "ANTHROPIC_API_KEY"),
    ("deepseek/deepseek-chat", "DEEPSEEK_API_KEY"),
]


def ttft_ms(model: str, api_key: str, system: str, user: str) -> float:
    """Milliseconds until the first chunk carrying text. Raises on provider errors."""
    import litellm

    started = time.monotonic()
    stream = litellm.completion(
        model=model,
        api_key=api_key,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        stream=True,
        max_tokens=64,
        # The agent runs at 0.3; sampling does not move first-token latency, but matching it
        # removes one difference between this and production.
        temperature=0.3,
    )
    for chunk in stream:
        delta = (chunk.choices[0].delta.content or "") if chunk.choices else ""
        if delta:
            elapsed = (time.monotonic() - started) * 1000
            # Drain, so the connection closes cleanly and the next sample starts from scratch
            # rather than inheriting a half-read socket.
            for _ in stream:
                pass
            return elapsed
    raise RuntimeError("stream ended with no text")


def main_() -> int:
    iterations = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    system = main.build_prompt(CONTEXT, caller_known=False)
    print(f"System prompt: {len(system)} chars. First turn: {TURN!r}. {iterations} samples each.\n")

    results = {}
    for model, key_var in CANDIDATES:
        api_key = os.environ.get(key_var, "")
        if not api_key:
            print(f"{model}\n  skipped — {key_var} is not set\n")
            continue

        samples, failures = [], []
        for i in range(iterations):
            try:
                ms = ttft_ms(model, api_key, system, TURN)
                samples.append(ms)
                print(f"  {model.split('/')[-1]:32} sample {i + 1}: {ms:7.0f} ms")
            except Exception as exc:  # provider errors are a result too, not a crash
                failures.append(str(exc)[:120])
                print(f"  {model.split('/')[-1]:32} sample {i + 1}: FAILED — {str(exc)[:120]}")
        if samples:
            results[model] = samples
        if failures and not samples:
            print(f"  every sample failed for {model}")
        print()

    if not results:
        print("Nothing measured. Set ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY.")
        return 1

    print(f"{'model':38} {'min':>8} {'median':>8} {'max':>8}")
    print("-" * 64)
    for model, samples in results.items():
        print(f"{model:38} {min(samples):8.0f} {statistics.median(samples):8.0f} {max(samples):8.0f}")

    print()
    if len(results) == 2:
        (m1, s1), (m2, s2) = results.items()
        gap = statistics.median(s2) - statistics.median(s1)
        faster, slower = (m1, m2) if gap > 0 else (m2, m1)
        print(f"{faster.split('/')[-1]} is {abs(gap):.0f} ms faster at the median than {slower.split('/')[-1]}.")
        # The decision this informs, stated so the number is read against something.
        print(
            "On a phone call the threshold that matters is roughly a second: past it, callers\n"
            "start talking over the answer. Read the max column, not the median — the slow samples\n"
            "are the ones a caller hears as a dropped line."
        )
    else:
        print("Only one model measured — set the other key to get the comparison this exists for.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_())
