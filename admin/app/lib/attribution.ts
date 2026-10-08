/**
 * Where a visitor came from, remembered until they sign up.
 *
 * Nothing on the site recorded this before, so every account that ever signed up arrived from
 * "somewhere" — and the question that decides what marketing to repeat ("which channel brought the
 * ones who paid?") had no answer. The landing page calls `rememberArrival()` once; the signup form
 * calls `signupSource()` and sends the result with the form; the backend stores it on the account.
 *
 * Kept deliberately small: the UTM parameters when a link carried them, otherwise the referring
 * site, otherwise nothing. First touch wins — a person who came from an Instagram video and
 * returned a week later by typing the address is still an Instagram signup.
 *
 * localStorage can be unavailable (private windows, blocked storage); every access is wrapped so
 * attribution can never break the page it rides on.
 */
const KEY = "tori_arrival";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"] as const;

export function rememberArrival(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(KEY)) return; // first touch wins
    const params = new URLSearchParams(window.location.search);
    const parts: string[] = [];
    for (const k of UTM_KEYS) {
      const v = params.get(k)?.trim();
      if (v) parts.push(`${k}=${v.slice(0, 60)}`);
    }
    if (parts.length === 0 && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        if (host && host !== window.location.hostname) parts.push(`referrer=${host}`);
      } catch {
        /* a malformed referrer is not worth anything */
      }
    }
    if (parts.length === 0) return;
    localStorage.setItem(KEY, parts.join(" "));
  } catch {
    /* storage unavailable — fine */
  }
}

/** What the signup form sends. Empty string when nothing was recorded. */
export function signupSource(): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(KEY) ?? "").slice(0, 300);
  } catch {
    return "";
  }
}

export function forgetArrival(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
