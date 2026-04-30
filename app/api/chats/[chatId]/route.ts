import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, GuardError } from "@/lib/auth/guard";
import { getChat, getChatMessages, getChatArtifacts, deleteChat } from "@/lib/firebase/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const user = await requireUser(req);
    const { chatId } = await ctx.params;
    const chat = await getChat(chatId);
    if (!chat || chat.ownerId !== user.uid) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const [messages, artifacts] = await Promise.all([getChatMessages(chatId), getChatArtifacts(chatId)]);
    return Response.json({ chat, messages, artifacts });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    console.error("[/api/chats/:id GET] failed:", e);
    return Response.json(
      { error: "server_error", message: (e as Error).message },
      { status: 500 }
    );
  }
}

const PatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const user = await requireUser(req);
    const { chatId } = await ctx.params;
    const chat = await getChat(chatId);
    if (!chat || chat.ownerId !== user.uid) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const body = PatchBody.parse(await req.json());
    const update: Record<string, unknown> = {};
    if (body.title !== undefined) update.title = body.title;
    if (body.archived !== undefined) update.archived = body.archived;
    if (Object.keys(update).length === 0) return Response.json({ ok: true });
    await getAdminDb().collection("chats").doc(chatId).update(update);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    return Response.json({ error: "bad_request", message: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const user = await requireUser(req);
    const { chatId } = await ctx.params;
    const chat = await getChat(chatId);
    if (!chat || chat.ownerId !== user.uid) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    await deleteChat(chatId);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    console.error("[/api/chats/:id DELETE] failed:", e);
    return Response.json(
      { error: "server_error", message: (e as Error).message },
      { status: 500 }
    );
  }
}
