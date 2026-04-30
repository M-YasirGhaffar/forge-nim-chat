import { NextRequest } from "next/server";
import { setSessionCookie, clearSessionCookie } from "@/lib/firebase/session";
import { ensureUser } from "@/lib/firebase/firestore";
import { verifyIdToken } from "@/lib/firebase/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { idToken } = await req.json().catch(() => ({}));
  if (!idToken || typeof idToken !== "string") {
    return Response.json({ error: "missing_id_token" }, { status: 400 });
  }
  try {
    const verified = await verifyIdToken(idToken);
    // Best-effort: persist user record. Skip silently if Admin SDK isn't configured.
    try {
      await ensureUser(verified.uid, {
        email: verified.email,
        displayName: verified.name,
        photoUrl: verified.picture,
      });
    } catch (e) {
      console.warn("[session] ensureUser skipped:", (e as Error).message);
    }
    const cookieResult = await setSessionCookie(idToken);
    return Response.json({
      ok: true,
      uid: verified.uid,
      sessionCookieSet: cookieResult.ok,
      ...(cookieResult.reason ? { sessionCookieSkipped: cookieResult.reason } : {}),
    });
  } catch (e) {
    return Response.json({ error: "invalid_id_token", message: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
