import "server-only";
import { verifyIdToken, verifyAppCheckToken, getBearerToken, type VerifiedUser } from "@/lib/firebase/verify";
import { getSessionUser } from "@/lib/firebase/session";

const REQUIRE_APP_CHECK = process.env.REQUIRE_APP_CHECK === "1";

export class GuardError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
  toResponse() {
    return Response.json({ error: this.code, message: this.message }, { status: this.status });
  }
}

export async function requireUser(req: Request): Promise<VerifiedUser> {
  // Try the Authorization header first (used by useChat client which forwards the ID token).
  const bearer = getBearerToken(req);
  if (bearer) {
    try {
      return await verifyIdToken(bearer);
    } catch (e) {
      throw new GuardError(401, "invalid_token", "Sign-in token is invalid or expired.");
    }
  }

  // Fall back to the session cookie (set after login on the server).
  const session = await getSessionUser();
  if (session) return session;

  throw new GuardError(401, "unauthenticated", "Please sign in.");
}

export async function maybeRequireAppCheck(req: Request): Promise<void> {
  const token = req.headers.get("x-firebase-appcheck") || req.headers.get("X-Firebase-AppCheck");
  if (!token) {
    if (REQUIRE_APP_CHECK) throw new GuardError(401, "missing_appcheck", "App Check token required.");
    return;
  }
  const ok = await verifyAppCheckToken(token);
  if (!ok && REQUIRE_APP_CHECK) {
    throw new GuardError(401, "invalid_appcheck", "App Check token rejected.");
  }
}
