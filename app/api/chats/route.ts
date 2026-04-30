import { NextRequest } from "next/server";
import { requireUser, GuardError } from "@/lib/auth/guard";
import { listUserChats } from "@/lib/firebase/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const chats = await listUserChats(user.uid, 200);
    return Response.json({ chats });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }
}
