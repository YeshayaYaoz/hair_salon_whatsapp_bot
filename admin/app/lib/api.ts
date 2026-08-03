const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("token");
}

export function setToken(token: string) {
  window.localStorage.setItem("token", token);
}

export function clearToken() {
  window.localStorage.removeItem("token");
}

/** Decodes the JWT payload client-side (no signature check — just for UI, the server is the
 * actual authority). Used to detect an impersonation token's `impersonatedBy` claim. */
export function decodeToken(): { businessId?: string; impersonatedBy?: string } | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** Enters impersonation: stashes the admin's own token so it can be restored, then swaps in the
 * short-lived impersonation token. */
export function startImpersonation(impersonationToken: string) {
  const adminToken = getToken();
  if (adminToken) window.sessionStorage.setItem("adminToken", adminToken);
  setToken(impersonationToken);
}

/** Restores the admin's own token after impersonating a business, if one was stashed. */
export function exitImpersonation(): boolean {
  const adminToken = window.sessionStorage.getItem("adminToken");
  if (!adminToken) return false;
  setToken(adminToken);
  window.sessionStorage.removeItem("adminToken");
  return true;
}

/**
 * Navigates after the signed-in identity has changed, with a full page load.
 *
 * Swapping the token is only half of switching accounts: router.push() is a client-side
 * navigation, so every provider, every piece of component state and every list already fetched
 * with the previous token survives it. The admin would land on the dashboard still looking at the
 * previous business's services, customers and language settings — data belonging to someone else,
 * which is worse than a stale screen.
 *
 * A real page load is the only way to guarantee nothing carries over. It costs a second, and this
 * happens rarely; correctness wins outright.
 */
export function reloadAs(path: string): void {
  window.location.href = path;
}

// The backend mostly returns terse English strings for infra/auth-level errors (session expired,
// not found, unauthorized) — the ones customers never see but business owners using this dashboard
// do. Translate the common ones so an owner reading Hebrew doesn't hit a raw English string; any
// error not listed here still shows as its own message (never JSON), just untranslated.
const ERROR_TRANSLATIONS: Record<string, { he: string; en: string }> = {
  "Invalid or expired token": {
    he: "החיבור פג תוקף — יש להתחבר מחדש.",
    en: "Your session has expired — please log in again.",
  },
  "Token invalid or expired": {
    he: "החיבור פג תוקף — יש להתחבר מחדש.",
    en: "Your session has expired — please log in again.",
  },
  "Missing bearer token": {
    he: "יש להתחבר מחדש כדי להמשיך.",
    en: "Please log in again to continue.",
  },
  "Unauthorized": {
    he: "אין הרשאה לפעולה הזו.",
    en: "You're not authorized to do this.",
  },
  "Not authorized": {
    he: "אין הרשאה לפעולה הזו.",
    en: "You're not authorized to do this.",
  },
  "Not found": {
    he: "הפריט לא נמצא — ייתכן שנמחק.",
    en: "That item wasn't found — it may have been deleted.",
  },
  "Invalid credentials": {
    he: "אימייל או סיסמה שגויים.",
    en: "Incorrect email or password.",
  },
  "Email already registered": {
    he: "כתובת האימייל כבר רשומה במערכת.",
    en: "This email is already registered.",
  },
  "Internal server error": {
    he: "אירעה תקלה בשרת — נסה שוב בעוד רגע.",
    en: "A server error occurred — please try again shortly.",
  },
  "Server error": {
    he: "אירעה תקלה בשרת — נסה שוב בעוד רגע.",
    en: "A server error occurred — please try again shortly.",
  },
  "This account has been suspended. Contact support.": {
    he: "החשבון הושעה. יש ליצור קשר עם התמיכה.",
    en: "This account has been suspended. Contact support.",
  },
  "Subscription inactive. Please update billing to continue.": {
    he: "המנוי אינו פעיל — יש לעדכן את פרטי התשלום כדי להמשיך.",
    en: "Subscription inactive. Please update billing to continue.",
  },
};

function currentLang(): "he" | "en" {
  if (typeof window === "undefined") return "he";
  return (window.localStorage.getItem("lang") as "he" | "en") ?? "he";
}

/** Many endpoints return zod's `.flatten()` shape as `error` on a 400 — {formErrors, fieldErrors}
 * — instead of a plain string. Pull out the first real message rather than showing raw JSON. */
function extractZodMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
  if (Array.isArray(flat.formErrors) && flat.formErrors[0]) return flat.formErrors[0];
  if (flat.fieldErrors && typeof flat.fieldErrors === "object") {
    for (const [field, messages] of Object.entries(flat.fieldErrors)) {
      if (messages?.[0]) return `${field}: ${messages[0]}`;
    }
  }
  return null;
}

/** Maps a raw backend error string to a friendly, localized one. Exported so pages that want to
 * translate an error they already caught (rather than one thrown fresh by apiFetch) can reuse the
 * same table instead of hand-rolling their own. Falls back to the raw message untouched. */
export function friendlyError(raw: string): string {
  const known = ERROR_TRANSLATIONS[raw];
  if (known) return known[currentLang()];
  return raw;
}

/**
 * Uploads files as multipart/form-data.
 *
 * Separate from apiFetch because that one always sets Content-Type: application/json. For a
 * FormData body the browser has to set the header itself — it has to append the multipart boundary
 * — and overriding it produces a request the server cannot parse.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body: formData,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error(
      currentLang() === "he"
        ? "בעיית חיבור לרשת — בדוק את החיבור לאינטרנט ונסה שוב."
        : "Network error — check your connection and try again."
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = typeof data.error === "string" ? data.error : extractZodMessage(data.error);
    throw new Error(
      raw
        ? friendlyError(raw)
        : currentLang() === "he"
          ? `העלאת התמונות נכשלה (${res.status})`
          : `Upload failed (${res.status})`
    );
  }
  return data as T;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      currentLang() === "he"
        ? "בעיית חיבור לרשת — בדוק את החיבור לאינטרנט ונסה שוב."
        : "Network error — check your connection and try again."
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const rawMessage = typeof body.error === "string" ? body.error : extractZodMessage(body.error);
    const message = rawMessage
      ? friendlyError(rawMessage)
      : currentLang() === "he"
        ? `הבקשה נכשלה (${res.status})`
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.json();
}
