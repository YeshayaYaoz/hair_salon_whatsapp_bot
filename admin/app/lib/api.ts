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

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? `${JSON.stringify(body.error)} | ${JSON.stringify(body.debug ?? {})}` : `Request failed (${res.status})`);
  }
  return res.json();
}
