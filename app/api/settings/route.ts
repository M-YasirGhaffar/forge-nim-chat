import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, GuardError } from "@/lib/auth/guard";
import { updateUserPreferences } from "@/lib/firebase/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  lastModel: z.string().optional(),
  thinkingDefault: z.enum(["off", "high", "max"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  displayName: z.string().min(1).max(80).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Body.parse(await req.json());
    await updateUserPreferences(user.uid, body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    return Response.json({ error: "bad_request", message: (e as Error).message }, { status: 400 });
  }
}
