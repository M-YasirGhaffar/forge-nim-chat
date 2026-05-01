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
  let user: Awaited<ReturnType<typeof requireUser>>;
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

  // Resolve the chat *id only* — DO NOT call createChat() yet. We defer that until
  // the first delivered token so a failed/aborted request never pollutes the sidebar
  // with an empty chat.
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
      chatId = null;
    }
  }
  const lastIncoming = body.messages[body.messages.length - 1];
  const userPromptText = lastIncoming.parts
    .map((p) => (p.type === "text" ? (p.text || "") : ""))
    .join(" ")
    .trim();
  const initialTitle = userPromptText
    ? userPromptText.replace(/\s+/g, " ").slice(0, 60)
    : "New chat";
  // For brand-new chats we mint a *provisional* id now so we can echo it to the
  // client in the meta event, but the Firestore row is created lazily on first token.
  if (!chatId) chatId = nanoid(12);
  const isFirstTurn = !wasExisting;
  let chatPersisted = wasExisting;

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

  // Task 18: defensive cap to prevent runaway prompt growth from PDF/text dumps that bypass
  // client-side dedupe. Hard ceiling of 200KB per message before we sanitize/trim.
  for (const m of nimMessages) {
    if (typeof m.content === "string" && m.content.length > 200_000) {
      m.content = m.content.slice(0, 200_000) + "\n[...truncated...]";
    }
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

  // We defer persistence of the user message to first-token too. Hold the parts
  // here for that moment.
  const userParts: MessagePart[] = last.parts.map((p): MessagePart => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "image") return { type: "image", storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
    if (p.type === "file") return { type: "file", storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
    if (p.type === "video") return { type: "file", storagePath: p.storagePath, downloadUrl: p.downloadUrl, fileName: p.fileName, mimeType: "video/mp4" };
    return { type: "text", text: "" };
  });

  /**
   * Create the chat row and persist the user message — exactly once, on first
   * delivered token. Returns true if the row exists after the call (already-existed
   * counts). Concurrent callers (fire-and-forget at first byte + awaited at end of
   * stream) share a single in-flight promise so the chat row is created once with
   * the provisional id we already echoed to the client.
   */
  let inflightPersist: Promise<boolean> | null = null;
  async function ensureChatPersisted(): Promise<boolean> {
    if (chatPersisted) return true;
    if (inflightPersist) return inflightPersist;
    const idToPersist = chatId!;
    inflightPersist = (async () => {
      try {
        const newId = await createChat(user.uid, model!.id, initialTitle, idToPersist);
        chatId = newId;
        await persistUserMessage({
          chatId: newId,
          uid: user.uid,
          message: { id: lastUserMessageId, role: "user", parts: userParts, createdAt: Date.now() },
        });
        chatPersisted = true;
        return true;
      } catch (e) {
        console.warn("[/api/chat] deferred persist failed:", (e as Error).message);
        return false;
      } finally {
        inflightPersist = null;
      }
    })();
    return inflightPersist;
  }

  // Abort controller propagated to the upstream NIM fetch. When the client
  // disconnects (Stop button, navigate away, switch chat) req.signal aborts and
  // we tear down the upstream so we don't keep generating tokens for RPM quota that
  // nobody will see.
  const upstreamAc = new AbortController();
  if (req.signal) {
    if (req.signal.aborted) upstreamAc.abort();
    else req.signal.addEventListener("abort", () => upstreamAc.abort(), { once: true });
  }

  const encoder = encodeEvent;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder(e));
        } catch {
          // Controller torn down by client disconnect — swallow.
        }
      };
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
              message: "Upstream is busy — still waiting.",
            });
          }
        }, 12_000);

        let upstream: Response;
        try {
          upstream = await nimChatCompletionsStream({ ...nimReq, model: modelId }, upstreamAc.signal);
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
        const stripReasoning = (body.thinkingMode ?? null) === "off";
        for await (const ev of events) {
          if (!firstByteSeen) {
            firstByteSeen = true;
            clearTimeout(slowTimer);
            // First real token reached the server. Create the chat row + persist
            // the user message NOW (deferred from request start). If this fails
            // we still continue streaming — the assistant message persist at the
            // end will retry the create.
            void ensureChatPersisted();
            send({ type: "status", status: "streaming", modelId, elapsedMs: Date.now() - reqStart });
          }
          if (ev.type === "reasoning" && ev.text) {
            if (stripReasoning) continue;
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
      let aborted = false;
      try {
        await runStream(model.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAbort = upstreamAc.signal.aborted || /aborted|abort/i.test(msg);
        if (isAbort) {
          aborted = true;
          finishReason = "stop";
        } else {
          streamErrored = true;
          finishReason = "error";
          // Only show the warn-tombstone if we actually have a chat row (existing
          // chat) — avoids a phantom error message for users who never produced
          // any chat in the first place.
          if (!assistantText && chatPersisted) {
            const fallback = `_⚠️ The model couldn't complete this response: ${msg.slice(0, 200)}._`;
            assistantText = fallback;
            send({ type: "text-delta", text: fallback });
          }
        }
      }

      const thinkingDuration = reasoningStart ? Date.now() - reasoningStart : undefined;

      // Task 72: defensively seal any artifacts whose `artifact-close` was never emitted
      // (e.g. truncated streams or parser bailing on malformed output) so the UI doesn't
      // get stuck on a perpetual "Generating artifact..." spinner.
      for (const id of artifactBuffers.keys()) {
        send({ type: "artifact-close", id });
      }

      // Task 59: `finishReason` defaults to "stop" but is overwritten from upstream NIM
      // events above (including "length" when output is cut by max_tokens). The client's
      // Continue button keys off `finishReason === "length"` from the finish event.
      send({ type: "finish", finishReason, thinkingDurationMs: thinkingDuration });
      void streamErrored;

      // Background title generation. Only run if the chat row was actually created
      // (i.e. we got past first token). For aborted/failed-pre-first-token requests
      // there's nothing to title.
      if (isFirstTurn && userPromptText && chatPersisted) {
        void generateTitle(last, assistantText)
          .then(async (t) => {
            if (!t || t === initialTitle) return;
            if (!closed) send({ type: "title", title: t });
            try {
              const { getAdminDb } = await import("@/lib/firebase/admin");
              await getAdminDb().collection("chats").doc(chatId!).update({ title: t });
            } catch {
              // Persistence is best-effort.
            }
          })
          .catch(() => undefined);
      }

      // Persist assistant message + artifacts — only if something was actually
      // produced AND a chat row exists (or can be created). Aborting before
      // first token leaves zero residue in Firestore.
      const hasContent = !!(assistantText || reasoningText || artifactBuffers.size > 0);
      if (hasContent) {
        if (!chatPersisted) await ensureChatPersisted();
      }
      if (hasContent && chatPersisted) {
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
          createdAt: Date.now() + 1,
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
            newTitle: undefined,
          });
        } catch (e) {
          send({ type: "error", message: `Failed to save: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      void aborted;

      // Suppress unused-var warning for unused timing
      void startTime;
      closed = true;
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
  // Inline-attachment paths never need a signed URL — the client embeds the data
  // URL directly in `downloadUrl`. We only reach this branch if a legacy
  // gs:// path slipped through from an old chat. Without a Storage bucket
  // provisioned this will error, which is the desired outcome — we surface it
  // as a missing-attachment instead of crashing the whole stream.
  if (storagePath.startsWith("inline://")) {
    throw new Error("inline attachment missing downloadUrl");
  }
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
  if (e.status === 404) return "Model not currently available";
  if (e.status >= 500) return "Upstream model error";
  return `Upstream error ${e.status}`;
}

async function generateTitle(lastUserMessage: { parts: Array<{ type: string; text?: string }> }, assistantText: string): Promise<string> {
  // Cheap, non-thinking call to V4 Flash for a 4–6 word title. Works even when the
  // assistant text is empty (e.g. stream errored) — falls back to the user prompt.
  const userText = lastUserMessage.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
  if (!userText.trim()) return "New chat";
  const summary = assistantText.slice(0, 300);
  const promptBody = summary ? `User: ${userText}\nAssistant: ${summary}` : `User: ${userText}`;

  try {
    const { nimChatCompletions } = await import("@/lib/nim/client");
    const resp = await nimChatCompletions({
      model: DEFAULT_MODEL_ID,
      messages: [
        {
          role: "system",
          content:
            "Write a concise 3–6 word title that describes this chat. Use Title Case. Reply with the title only — no quotes, no leading/trailing punctuation, no emojis.",
        },
        { role: "user", content: promptBody },
      ],
      temperature: 0.4,
      max_tokens: 32,
      reasoning_effort: "low",
      chat_template_kwargs: { thinking: false, enable_thinking: false },
    });
    const cleaned = resp.content
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .replace(/^title:\s*/i, "")
      .slice(0, 80);
    return cleaned || userText.slice(0, 60) || "New chat";
  } catch {
    return userText.slice(0, 60) || "New chat";
  }
}
