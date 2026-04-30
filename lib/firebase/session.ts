import "server-only";
import { cookies } from "next/headers";
import { getAdminAuth } from "./admin";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export async function setSessionCookie(
  idToken: string,
  opts?: { rolling?: boolean }
): Promise<{ ok: boolean; reason?: string }> {
  // The `rolling` option is additive/optional — call sites that omit it get the same behavior
  // they had before. When the auth-provider's 50-minute refresh re-POSTs to /api/auth/session,
  // this function re-issues the cookie with a fresh 7-day window, giving us rolling refresh.
  void opts; // intentionally unused — see comment above; reserved for future per-call overrides
  try {
    const cookie = await getAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SEC * 1000,
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, cookie, {
      maxAge: SESSION_MAX_AGE_SEC,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return { ok: true };
  } catch (e) {
    // Admin SDK not configured (no service account key). The app still works via
    // client-side auth + Authorization Bearer tokens on every API call — we just don't get
    // SSR pre-fetch. Surface the reason so the caller can log it.
    return { ok: false, reason: (e as Error).message };
  }
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<{ uid: string; email?: string; name?: string; picture?: string } | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name as string | undefined,
      picture: decoded.picture as string | undefined,
    };
  } catch {
    return null;
  }
}
