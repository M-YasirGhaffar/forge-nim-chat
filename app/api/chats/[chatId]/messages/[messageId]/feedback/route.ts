import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, GuardError } from "@/lib/auth/guard";
import { getChat } from "@/lib/firebase/firestore";
import { getAdminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  rating: z.enum(["up", "down"]),
  note: z.string().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string; messageId: string }> }
) {
  try {
    const user = await requireUser(req);
    const { chatId, messageId } = await ctx.params;

    // Ownership check: only the chat owner can attach feedback to its messages.
    // Returning 404 (rather than 403) for both nonexistent and forbidden cases
    // matches the GET handler's stance on info-leak avoidance.
    const chat = await getChat(chatId);
    if (!chat || chat.ownerId !== user.uid) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const body = Body.parse(await req.json());

    const msgRef = getAdminDb()
      .collection("chats")
      .doc(chatId)
      .collection("messages")
      .doc(messageId);

    // Verify the message exists under this chat before writing feedback so we don't
    // create orphan docs for arbitrary messageIds.
    const snap = await msgRef.get();
    if (!snap.exists) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    await msgRef.update({
      feedback: {
        rating: body.rating,
        note: body.note ?? null,
        at: FieldValue.serverTimestamp(),
      },
    });

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    return Response.json(
      { error: "bad_request", message: (e as Error).message },
      { status: 400 }
    );
  }
}
