import { NextRequest } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser, maybeRequireAppCheck, GuardError } from "@/lib/auth/guard";
import { checkChatLimits } from "@/lib/ratelimit";
import { getModel, getFallbackForModel, DEFAULT_MODEL_ID } from "@/lib/models/registry";
import { applyThinkingMode, sanitizeMessagesForModel, trimToContext } from "@/lib/nim/adapter";
import { nimChatCompletionsStream, NimError } from "@/lib/nim/client";
import type { NimChatMessage, NimContentPart } from "@/lib/nim/client";
import { parseNimSSE, mergeStream } from "@/lib/parsers/sse";
import { createArtifactParser } from "@/lib/parsers/artifact";
import { ARTIFACT_SYSTEM_PROMPT } from "@/lib/prompts/artifact-system";
import { ensureUser, persistUserMessage, persistAssistantMessage, createChat, getChat } from "@/lib/firebase/firestore";
import { encodeEvent, type StreamEvent } from "@/lib/stream/protocol";
import { getAdminStorage } from "@/lib/firebase/admin";
import type { ChatMessage, MessagePart, ThinkingMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    storagePath: z.string().optional(),
    downloadUrl: z.string().optional(),
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    storagePath: z.string().optional(),
    downloadUrl: z.string().optional(),
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
  }),
  z.object({ type: z.literal("video"), storagePath: z.string().optional(), downloadUrl: z.string().optional(), fileName: z.string().optional() }),
]);

const MessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(PartSchema),
});

const BodySchema = z.object({
  chatId: z.string().optional().nullable(),
  modelId: z.string(),
  thinkingMode: z.enum(["off", "high", "max"]).optional().nullable(),
  messages: z.array(MessageSchema).min(1),
});

export async function POST(req: NextRequest) {
  try {
    return await handleChat(req);
  } catch (e) {
    console.error("[/api/chat] unhandled:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "server_error", message: msg.slice(0, 500) },
      { status: 500 }
    );
  }
}

async function handleChat(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
    await maybeRequireAppCheck(req);
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }

  const limits = await checkChatLimits(user.uid);
  if (!limits.ok) {
    return Response.json(
      { error: "rate_limited", scope: limits.scope, retryAfter: limits.retryAfter },
      { status: 429 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const model = getModel(body.modelId);
  if (!model || model.endpoint !== "chat") {
    return Response.json({ error: "unknown_model", modelId: body.modelId }, { status: 400 });
  }

  try {
    await ensureUser(user.uid, {
      email: user.email,
      displayName: user.name,
      photoUrl: user.picture,
    });
  } catch (e) {
    console.warn("[/api/chat] ensureUser failed:", (e as Error).message);
  }

  // Resolve or create the chat. Firestore is best-effort — a Firestore outage shouldn't
  // block the user from chatting. We fall back to an ephemeral chat id so streaming still
  // works (audit: chat must continue even if persistence fails).
  let chatId = body.chatId && body.chatId !== "new" ? body.chatId : null;
  const wasExisting = !!chatId;
  if (chatId) {
    try {
      const existing = await getChat(chatId);
      if (!existing) chatId = null;
      else if (existing.ownerId !== user.uid) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
    } catch (e) {
      console.warn("[/api/chat] getChat failed:", (e as Error).message);
      // Treat as a fresh chat — we'll create a new id below.
      chatId = null;
    }
  }
  if (!chatId) {
    try {
      chatId = await createChat(user.uid, model.id);
    } catch (e) {
      console.warn("[/api/chat] createChat failed, using ephemeral id:", (e as Error).message);
      chatId = nanoid(12);
    }
  }
  // Audit P2-2: avoid the redundant getChat round-trip — a brand-new chat is by definition the first turn.
  const isFirstTurn = !wasExisting;

  // Translate UI messages → NIM messages.
  const last = body.messages[body.messages.length - 1];
  const lastUserMessageId = last.id || nanoid(12);
  const assistantMessageId = nanoid(12);

  const nimMessages: NimChatMessage[] = [
    { role: "system", content: ARTIFACT_SYSTEM_PROMPT },
  ];

  for (const m of body.messages) {
    const parts: NimContentPart[] = [];
    let textBuffer = "";
    for (const p of m.parts) {
      if (p.type === "text") {
        textBuffer += (textBuffer ? "\n" : "") + p.text;
      } else if (p.type === "image" && (p.downloadUrl || p.storagePath)) {
        if (textBuffer) {
          parts.push({ type: "text", text: textBuffer });
          textBuffer = "";
        }
        const url = p.downloadUrl || (await signedUrl(p.storagePath!));
        parts.push({ type: "image_url", image_url: { url } });
      } else if (p.type === "video" && (p.downloadUrl || p.storagePath)) {
        if (textBuffer) {
          parts.push({ type: "text", text: textBuffer });
          textBuffer = "";
        }
        const url = p.downloadUrl || (await signedUrl(p.storagePath!));
        parts.push({ type: "video_url", video_url: { url } });
      } else if (p.type === "file" && (p.downloadUrl || p.storagePath)) {
        // PDF: client extracted text already and put it in a text part. If still a binary,
        // we noop — the client should have parsed it before sending.
      }
    }
    if (textBuffer) parts.push({ type: "text", text: textBuffer });
    const content: NimChatMessage["content"] =
      parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
    nimMessages.push({ role: m.role as "user" | "assistant" | "system", content });
  }

  const sanitized = sanitizeMessagesForModel(nimMessages, model);
  const trimmed = trimToContext(sanitized.messages, model);

  const nimReq = applyThinkingMode(
    {
      model: model.id,
      messages: trimmed.messages,
    },
    model,
    body.thinkingMode as ThinkingMode | undefined
  );

  // Persist the user message right away so refresh-during-stream is recoverable.
  const userParts: MessagePart[] = last.parts.map((p): MessagePart => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "image") return { type: "image", storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
    if (p.type === "file") return { type: "file", storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
    if (p.type === "video") return { type: "file", storagePath: p.storagePath, downloadUrl: p.downloadUrl, fileName: p.fileName, mimeType: "video/mp4" };
    return { type: "text", text: "" };
  });
  try {
    await persistUserMessage({
      chatId,
      uid: user.uid,
      message: {
        id: lastUserMessageId,
        role: "user",
        parts: userParts,
        createdAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn("[/api/chat] persistUserMessage failed:", (e as Error).message);
  }

  // Build the SSE stream from NIM and translate to our protocol.
  const encoder = encodeEvent;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder(e));
      const startTime = Date.now();

      send({
        type: "meta",
        chatId: chatId!,
        userMessageId: lastUserMessageId,
        assistantMessageId,
        modelId: model.id,
        trimmed: trimmed.trimmed > 0 ? trimmed.trimmed : undefined,
        strippedAttachments: sanitized.stripped || undefined,
      });

      // State that the parser collects across the whole stream.
      let assistantText = "";
      let reasoningText = "";
      let reasoningStart: number | null = null;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
      let finishReason = "stop";
      const artifactBuffers = new Map<string, { type: import("@/lib/types").ArtifactType; title: string; language?: string; body: string }>();
      const parser = createArtifactParser();

      async function runStream(modelId: string, retryFallback = true): Promise<void> {
        const reqStart = Date.now();
        send({ type: "status", status: "connecting", modelId });

        // Emit a "slow" status if no first byte within 12s.
        let firstByteSeen = false;
        const slowTimer = setTimeout(() => {
          if (!firstByteSeen) {
            send({
              type: "status",
              status: "slow",
              modelId,
              elapsedMs: Date.now() - reqStart,
              message: "Free-tier capacity is busy — still waiting.",
            });
          }
        }, 12_000);

        let upstream: Response;
        try {
          upstream = await nimChatCompletionsStream({ ...nimReq, model: modelId });
        } catch (e) {
          clearTimeout(slowTimer);
          if (e instanceof NimError) {
            if (e.status === 429) {
              send({
                type: "status",
                status: "rate_limited",
                modelId,
                retryAfter: e.retryAfter,
                message: friendlyError(e),
              });
            }
            if (retryFallback && (e.status === 404 || e.status >= 500 || e.status === 429)) {
              const fb = getFallbackForModel(modelId);
              if (fb) {
                send({
                  type: "status",
                  status: "fallback",
                  modelId: fb,
                  message: `${friendlyError(e)} — switched to ${fb}.`,
                });
                return runStream(fb, false);
              }
            }
          }
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          throw e;
        }

        const events = mergeStream(parseNimSSE(upstream.body!));
        for await (const ev of events) {
          if (!firstByteSeen) {
            firstByteSeen = true;
            clearTimeout(slowTimer);
            send({ type: "status", status: "streaming", modelId, elapsedMs: Date.now() - reqStart });
          }
          if (ev.type === "reasoning" && ev.text) {
            if (reasoningStart === null) reasoningStart = Date.now();
            reasoningText += ev.text;
            send({ type: "reasoning-delta", text: ev.text });
          } else if (ev.type === "content" && ev.text) {
            const parserEvents = parser.feed(ev.text);
            for (const pe of parserEvents) {
              if (pe.type === "text") {
                assistantText += pe.text;
                send({ type: "text-delta", text: pe.text });
              } else if (pe.type === "artifact-open") {
                artifactBuffers.set(pe.id, {
                  type: pe.artifactType,
                  title: pe.title,
                  language: pe.language,
                  body: "",
                });
                assistantText += `\n\n[[artifact:${pe.id}]]\n\n`;
                send({
                  type: "artifact-open",
                  id: pe.id,
                  artifactType: pe.artifactType,
                  title: pe.title,
                  language: pe.language,
                });
              } else if (pe.type === "artifact-chunk") {
                const buf = artifactBuffers.get(pe.id);
                if (buf) buf.body += pe.text;
                send({ type: "artifact-delta", id: pe.id, text: pe.text });
              } else if (pe.type === "artifact-close") {
                send({ type: "artifact-close", id: pe.id });
              }
            }
          } else if (ev.type === "usage" && ev.usage) {
            usage = {
              promptTokens: ev.usage.prompt_tokens,
              completionTokens: ev.usage.completion_tokens,
              totalTokens: ev.usage.total_tokens,
            };
            send({ type: "usage", usage });
          } else if (ev.type === "finish" && ev.finishReason) {
            finishReason = ev.finishReason;
          }
        }
        // Flush parser tail.
        for (const pe of parser.flush()) {
          if (pe.type === "text") {
            assistantText += pe.text;
            send({ type: "text-delta", text: pe.text });
          } else if (pe.type === "artifact-chunk") {
            const buf = artifactBuffers.get(pe.id);
            if (buf) buf.body += pe.text;
            send({ type: "artifact-delta", id: pe.id, text: pe.text });
          } else if (pe.type === "artifact-close") {
            send({ type: "artifact-close", id: pe.id });
          }
        }
      }

      let streamErrored = false;
      try {
        await runStream(model.id);
      } catch (e) {
        streamErrored = true;
        finishReason = "error";
        const msg = e instanceof Error ? e.message : String(e);
        // Make sure the user sees a recoverable assistant turn rather than a missing reply
        // (audit P0-2: persist a tombstone so the chat isn't left in a half-state).
        if (!assistantText) {
          const fallback = `_⚠️ The model couldn't complete this response: ${msg.slice(0, 200)}._`;
          assistantText = fallback;
          send({ type: "text-delta", text: fallback });
        }
      }

      const thinkingDuration = reasoningStart ? Date.now() - reasoningStart : undefined;
      send({ type: "finish", finishReason, thinkingDurationMs: thinkingDuration });
      void streamErrored;

      // Auto-generate a title on first turn (cheap async call after streaming).
      let newTitle: string | undefined;
      if (isFirstTurn && assistantText.length > 0) {
        newTitle = await generateTitle(last, assistantText).catch(() => undefined);
        if (newTitle) send({ type: "title", title: newTitle });
      }

      // Persist assistant message + artifacts.
      const assistantParts: MessagePart[] = [];
      if (reasoningText) {
        assistantParts.push({ type: "reasoning", reasoningText, durationMs: thinkingDuration });
      }
      assistantParts.push({ type: "text", text: assistantText });
      for (const id of artifactBuffers.keys()) {
        assistantParts.push({ type: "artifact-ref", artifactId: id });
      }

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        parts: assistantParts,
        model: model.id,
        thinkingMode: body.thinkingMode ?? null,
        usage,
        finishReason,
        createdAt: Date.now() + 1, // ensure it sorts after user msg even on millisecond ties
      };

      try {
        await persistAssistantMessage({
          chatId: chatId!,
          uid: user.uid,
          message: assistantMessage,
          artifacts: Array.from(artifactBuffers.entries()).map(([id, a]) => ({
            id,
            type: a.type,
            title: a.title,
            language: a.language,
            body: a.body,
          })),
          modelId: model.id,
          isFirstTurn,
          newTitle,
        });
      } catch (e) {
        send({ type: "error", message: `Failed to save: ${e instanceof Error ? e.message : String(e)}` });
      }

      // Suppress unused-var warning for unused timing
      void startTime;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function signedUrl(storagePath: string): Promise<string> {
  // storagePath might be a gs:// URL or a bucket-relative path.
  const path = storagePath.replace(/^gs:\/\/[^/]+\//, "");
  const bucket = getAdminStorage().bucket();
  const [url] = await bucket.file(path).getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });
  return url;
}

function friendlyError(e: NimError): string {
  if (e.status === 429) return "Rate limit hit on upstream";
  if (e.status === 404) return "Model not available on NIM trial";
  if (e.status >= 500) return "Upstream model error";
  return `Upstream error ${e.status}`;
}

async function generateTitle(lastUserMessage: { parts: Array<{ type: string; text?: string }> }, assistantText: string): Promise<string> {
  // Cheap, non-thinking call to V4 Flash for a 4–8 word title.
  const userText = lastUserMessage.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
  const summary = assistantText.slice(0, 300);

  try {
    const { nimChatCompletions } = await import("@/lib/nim/client");
    const resp = await nimChatCompletions({
      model: DEFAULT_MODEL_ID,
      messages: [
        {
          role: "system",
          content:
            "Generate a concise 3–6 word title for the following conversation. Use Title Case. Reply with the title only — no quotes, no punctuation at the end.",
        },
        { role: "user", content: `User: ${userText}\nAssistant: ${summary}` },
      ],
      temperature: 0.4,
      max_tokens: 32,
      reasoning_effort: "low",
    });
    return resp.content.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 80) || "New chat";
  } catch {
    return userText.slice(0, 60) || "New chat";
  }
}
