import { NextRequest } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser, maybeRequireAppCheck, GuardError } from "@/lib/auth/guard";
import { checkChatLimits, checkFluxLimit } from "@/lib/ratelimit";
import { getModel } from "@/lib/models/registry";
import { nimImageGenerate, NimError } from "@/lib/nim/client";
import { getAdminStorage } from "@/lib/firebase/admin";
import { ensureUser, persistAssistantMessage, persistUserMessage, createChat, getChat } from "@/lib/firebase/firestore";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const Body = z.object({
  chatId: z.string().optional().nullable(),
  modelId: z.string(),
  prompt: z.string().min(1).max(4_000),
  referenceImageStoragePath: z.string().optional(),
  steps: z.number().int().min(1).max(50).optional(),
  cfgScale: z.number().min(0).max(20).optional(),
  aspectRatio: z.string().optional(),
  seed: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
    await maybeRequireAppCheck(req);
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }

  const flux = await checkFluxLimit(user.uid);
  if (!flux.ok) return Response.json({ error: "rate_limited", scope: "flux", retryAfter: flux.retryAfter }, { status: 429 });
  const lim = await checkChatLimits(user.uid);
  if (!lim.ok) return Response.json({ error: "rate_limited", scope: lim.scope, retryAfter: lim.retryAfter }, { status: 429 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const model = getModel(body.modelId);
  if (!model || model.endpoint !== "infer") {
    console.warn("[/api/image] unknown_model:", {
      modelId: body.modelId,
      foundModel: !!model,
      endpoint: model?.endpoint,
    });
    return Response.json(
      {
        error: "unknown_model",
        modelId: body.modelId,
        message: model
          ? `Model "${body.modelId}" is a ${model.endpoint} model — pick an image model (FLUX) instead.`
          : `Model "${body.modelId}" is not in the allowlist. Try refreshing the page.`,
      },
      { status: 400 }
    );
  }

  await ensureUser(user.uid, { email: user.email, displayName: user.name, photoUrl: user.picture });

  // Resolve chat id. DO NOT create the row yet — defer until image bytes land
  // so a failed FLUX call doesn't pollute the sidebar with an empty chat.
  let chatId = body.chatId && body.chatId !== "new" ? body.chatId : null;
  const wasExisting = !!chatId;
  if (chatId) {
    const existing = await getChat(chatId);
    if (!existing) chatId = null;
    else if (existing.ownerId !== user.uid) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const userMessageId = nanoid(12);
  const assistantMessageId = nanoid(12);

  // Optional reference image (Kontext). Two cases:
  //   - "data:image/png;example_id,N" — pass through verbatim (preview API only allows N∈{0,1,2}).
  //   - any other value (legacy Storage path) — reject with a clear error since the preview
  //     endpoint won't accept arbitrary uploads.
  let referenceImage: string | undefined;
  if (body.referenceImageStoragePath) {
    if (body.referenceImageStoragePath.startsWith("data:image/")) {
      referenceImage = body.referenceImageStoragePath;
    } else {
      return Response.json(
        {
          error: "reference_unavailable",
          message: "FLUX Kontext only accepts the 3 sample reference images on the preview API. Custom uploads aren't supported.",
          modelId: model.id,
        },
        { status: 400 }
      );
    }
  }

  let result;
  try {
    result = await nimImageGenerate({
      model: model.id,
      prompt: body.prompt,
      image: referenceImage,
      steps: body.steps,
      cfg_scale: body.cfgScale,
      aspect_ratio: body.aspectRatio,
      seed: body.seed,
    });
  } catch (e) {
    const detail = e instanceof NimError ? `${e.status}: ${e.body.slice(0, 400)}` : (e as Error).message;
    console.error("[/api/image] generation_failed:", { model: model.id, detail });
    return Response.json(
      { error: "generation_failed", message: detail, modelId: model.id },
      { status: 502 }
    );
  }

  // Skip Cloud Storage and inline the JPEG as a data URL persisted directly in the
  // Firestore message. FLUX outputs are typically 80–400 KB — well under Firestore's
  // 1 MB doc cap. If a future model produces something larger we surface a 413 below.
  const ext = result.mimeType === "image/jpeg" ? "jpg" : "png";
  const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
  const approxBytes = Math.ceil((result.base64.length * 3) / 4);
  if (approxBytes > 950_000) {
    return Response.json(
      {
        error: "image_too_large",
        message: `Generated image is ${(approxBytes / 1024).toFixed(0)} KB — exceeds the inline storage limit. Try a smaller aspect ratio.`,
        modelId: model.id,
      },
      { status: 413 }
    );
  }
  const downloadUrl = dataUrl;
  // Storage path is purely metadata at this point — kept for compatibility with the
  // ChatMessage type so older code paths still typecheck. It does not refer to a
  // real Cloud Storage object.
  const storagePath = `inline://${user.uid}/${chatId}/${assistantMessageId}.${ext}`;
  void getAdminStorage; // kept imported for parity with the chat route's signed-url helper

  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: [
      {
        type: "image",
        storagePath,
        downloadUrl,
        mimeType: result.mimeType,
        fileName: `${assistantMessageId}.${ext}`,
      },
      { type: "text", text: `Generated by ${model.displayName}.` },
    ],
    model: model.id,
    thinkingMode: null,
    usage: null,
    finishReason: "stop",
    createdAt: Date.now() + 1,
  };

  // Generation succeeded — NOW create the chat row (if needed) and persist both
  // the user prompt and the assistant message. If chat creation/persist fails we
  // still return the image so the user sees it; refreshing won't show it but the
  // bytes won't be lost on this turn.
  try {
    if (!chatId) {
      chatId = await createChat(user.uid, model.id, body.prompt.slice(0, 60) || "New image");
    }
    await persistUserMessage({
      chatId,
      uid: user.uid,
      message: {
        id: userMessageId,
        role: "user",
        parts: [{ type: "text", text: body.prompt }],
        createdAt: Date.now(),
      },
    });
    await persistAssistantMessage({
      chatId,
      uid: user.uid,
      message: assistantMessage,
      artifacts: [],
      modelId: model.id,
      isFirstTurn: !wasExisting,
      newTitle: body.prompt.slice(0, 60) || undefined,
    });
  } catch (e) {
    const detail = (e as Error).message || String(e);
    console.error("[/api/image] persist_failed:", detail);
    return Response.json({
      chatId,
      userMessageId,
      assistantMessageId,
      imageUrl: downloadUrl,
      storagePath,
      seed: result.seed,
      warning: `Generated image but couldn't persist chat: ${detail}`,
    });
  }

  return Response.json({
    chatId,
    userMessageId,
    assistantMessageId,
    imageUrl: downloadUrl,
    storagePath,
    seed: result.seed,
  });
}
