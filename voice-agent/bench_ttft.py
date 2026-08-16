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
from typing import Any, Dict, List, Optional

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


def ttft_ms(model: str, api_key: str, system: str, user: str,
            extra: Optional[Dict[str, Any]] = None) -> tuple[float, Any]:
    """
    Milliseconds until the first chunk carrying text, and the usage block if the stream reported one.

    The usage matters as much as the time here: `cache_read_input_tokens` is the only proof that a
    cached run was actually served from cache. Without it a "cached" measurement that quietly missed
    is indistinguishable from one that hit and saved nothing — which is how a latency optimisation
    gets believed in for a year.
    """
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
        **(extra or {}),
    )
    elapsed = None
    usage = None
    for chunk in stream:
        # Drained to the end even after the first token, both so the connection closes cleanly and
        # because the usage block only arrives on the final chunk.
        usage = getattr(chunk, "usage", None) or usage
        delta = (chunk.choices[0].delta.content or "") if chunk.choices else ""
        if delta and elapsed is None:
            elapsed = (time.monotonic() - started) * 1000
    if elapsed is None:
        raise RuntimeError("stream ended with no text")
    return elapsed, usage


def cached_tokens(usage: Any) -> int:
    """Prompt tokens served from cache, under whichever name the provider reports it."""
    if usage is None:
        return 0
    for name in ("cache_read_input_tokens", "prompt_cache_hit_tokens"):
        if getattr(usage, name, None):
            return int(getattr(usage, name))
    details = getattr(usage, "prompt_tokens_details", None)
    return int(getattr(details, "cached_tokens", 0) or 0) if details else 0


# The style rules are the largest removable block in the prompt: nine numbered speech rules plus the
# brevity, interruption and gender paragraphs. Cutting them is the most obvious way to make the
# prompt shorter, so this measures what that would actually buy — before anyone trades the agent's
# Hebrew for it. `bench_quality.py` measures what it would cost.
def trim_prompt(system: str) -> str:
    lines = system.split("\n")
    out, dropping = [], False
    for line in lines:
        if line.startswith("## איך מדברים בטלפון"):
            dropping = True
            out.append(line)
            out.append("תשובה אחת, שני משפטים לכל היותר. מספרים במילים. בלי Markdown ובלי אימוג'י.")
            continue
        if dropping and line.startswith("## "):
            dropping = False
        if not dropping:
            out.append(line)
    return "\n".join(out)


def measure(model: str, api_key: str, system: str, iterations: int,
            extra: Optional[Dict[str, Any]], label: str, warmup: bool) -> Optional[List[float]]:
    """One variant, `iterations` samples. Returns None when every sample failed."""
    short = model.split("/")[-1]
    if warmup:
        # The cache-writing call, thrown away. Anthropic serves a prefix from cache only after it
        # has stored one, so measuring the write and calling it "cached" would report the slowest
        # call of the run as the optimisation's result.
        try:
            ttft_ms(model, api_key, system, TURN, extra)
        except Exception as exc:
            print(f"  {short:24} {label:10} warm-up FAILED — {str(exc)[:100]}")

    samples, cached = [], 0
    for i in range(iterations):
        try:
            ms, usage = ttft_ms(model, api_key, system, TURN, extra)
            samples.append(ms)
            cached = max(cached, cached_tokens(usage))
            print(f"  {short:24} {label:10} sample {i + 1}: {ms:7.0f} ms")
        except Exception as exc:  # provider errors are a result too, not a crash
            print(f"  {short:24} {label:10} sample {i + 1}: FAILED — {str(exc)[:100]}")
    if not samples:
        return None
    if label == "cached":
        # Stated either way. "Cached" with zero cached tokens is the measurement that looks like a
        # disappointing optimisation and is really a misconfigured one.
        print(f"  {short:24} {label:10} cache served {cached} prompt tokens"
              f"{' — NOTHING WAS CACHED' if not cached else ''}")
    return samples


def main_() -> int:
    iterations = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    system = main.build_prompt(CONTEXT, caller_known=False)
    short_system = trim_prompt(system)
    print(f"System prompt: {len(system)} chars ({len(short_system)} trimmed). "
          f"First turn: {TURN!r}. {iterations} samples each.\n")

    # plain   — what the previous run measured: a cold prompt, no caching parameters at all.
    # cached  — what production actually sends. `_latency_extra` is main.py's own function, so this
    #           cannot drift from the agent; on DeepSeek it returns {} and the variant measures that
    #           provider's automatic server-side prefix caching instead, which is the honest
    #           comparison rather than an unfair one.
    # trimmed — the prompt with its speech rules cut, to price the most obvious size reduction.
    results: Dict[str, List[float]] = {}
    for model, key_var in CANDIDATES:
        api_key = os.environ.get(key_var, "")
        if not api_key:
            print(f"{model}\n  skipped — {key_var} is not set\n")
            continue

        for label, sys_prompt, extra, warmup in (
            ("plain", system, None, False),
            ("cached", system, main._latency_extra(model), True),
            ("trimmed", short_system, main._latency_extra(model), True),
        ):
            samples = measure(model, api_key, sys_prompt, iterations, extra, label, warmup)
            if samples:
                results[f"{model} [{label}]"] = samples
        print()

    if not results:
        print("Nothing measured. Set ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY.")
        return 1

    print(f"{'model / variant':48} {'min':>8} {'median':>8} {'max':>8}")
    print("-" * 74)
    for name, samples in results.items():
        print(f"{name:48} {min(samples):8.0f} {statistics.median(samples):8.0f} {max(samples):8.0f}")

    print()
    medians = {k: statistics.median(v) for k, v in results.items()}
    for model, _ in CANDIDATES:
        plain, cache = medians.get(f"{model} [plain]"), medians.get(f"{model} [cached]")
        trim = medians.get(f"{model} [trimmed]")
        if plain and cache:
            print(f"{model.split('/')[-1]}: caching moves the median by {plain - cache:+.0f} ms.")
        if cache and trim:
            print(f"{model.split('/')[-1]}: trimming the speech rules moves it a further {cache - trim:+.0f} ms.")

    fastest = min(medians, key=medians.get)
    print(f"\nFastest configuration measured: {fastest} at {medians[fastest]:.0f} ms.")
    # The decision this informs, stated so the number is read against something.
    print(
        "On a phone call the threshold that matters is roughly a second: past it, callers\n"
        "start talking over the answer. Read the max column, not the median — the slow samples\n"
        "are the ones a caller hears as a dropped line. And read this against bench_quality.py:\n"
        "the trimmed prompt is only a saving if the agent still speaks the way the rules demand."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main_())
