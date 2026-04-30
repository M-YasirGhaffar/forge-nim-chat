"use client";

import { useCallback, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { parseEventStream, type StreamEvent, type StreamStatus } from "@/lib/stream/protocol";
import { getClientAuth } from "@/lib/firebase/client";
import type {
  ArtifactRecord,
  AttachmentRef,
  ChatMessage,
  MessagePart,
  ThinkingMode,
} from "@/lib/types";

type SetMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;

interface SendArgs {
  text: string;
  attachments: AttachmentRef[];
  modelId: string;
  thinkingMode: ThinkingMode;
  idToken: string;
}

interface UseChatStreamOpts {
  initialChatId: string | null;
  initialMessages: ChatMessage[];
  initialArtifacts: ArtifactRecord[];
  initialTitle?: string;
}

export function useChatStream(opts: UseChatStreamOpts) {
  const [chatId, setChatId] = useState<string | null>(opts.initialChatId);
  const [messages, setMessagesState] = useState<ChatMessage[]>(opts.initialMessages);
  const [artifacts, setArtifactsState] = useState<Map<string, ArtifactRecord>>(() => {
    const m = new Map<string, ArtifactRecord>();
    for (const a of opts.initialArtifacts) m.set(a.id, a);
    return m;
  });
  const [title, setTitle] = useState(opts.initialTitle ?? "New chat");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number } | null>(null);
  const [recentlyOpenedArtifact, setRecentlyOpenedArtifact] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<{
    status: StreamStatus | null;
    message?: string;
    elapsedMs?: number;
    retryAfter?: number;
    modelId?: string;
  }>({ status: null });
  const abortRef = useRef<AbortController | null>(null);

  const setMessages: SetMessages = useCallback((updater) => {
    setMessagesState((prev) => updater(prev));
  }, []);

  const send = useCallback(
    async (args: SendArgs) => {
      if (isStreaming) return;
      const userMessage: ChatMessage = {
        id: nanoid(12),
        role: "user",
        parts: [
          ...(args.text ? [{ type: "text" as const, text: args.text }] : []),
          ...args.attachments.map((a): MessagePart => {
            if (a.type === "image") {
              return {
                type: "image",
                storagePath: a.storagePath,
                downloadUrl: a.downloadUrl,
                mimeType: a.mimeType,
                fileName: a.fileName,
              };
            }
            return {
              type: "file",
              storagePath: a.storagePath,
              downloadUrl: a.downloadUrl,
              mimeType: a.mimeType,
              fileName: a.fileName,
            };
          }),
        ],
        createdAt: Date.now(),
      };

      // Mutable id ref so the meta event can swap the placeholder id for the server-assigned id
      // and every subsequent text-delta/reasoning-delta/etc. uses the updated value.
      // (Using a string-by-value parameter is a closure trap — see code review P0-1.)
      const idRef = { current: nanoid(12) };
      const assistantPlaceholder: ChatMessage = {
        id: idRef.current,
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        model: args.modelId,
        thinkingMode: args.thinkingMode,
        createdAt: Date.now() + 1,
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setStreamingMessageId(idRef.current);
      setIsStreaming(true);
      setStreamStatus({ status: "connecting", modelId: args.modelId });
      setRecentlyOpenedArtifact(null);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const payloadMessages = [...messages, userMessage].map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts.map((p) => {
          if (p.type === "text") return { type: "text" as const, text: p.text || "" };
          if (p.type === "image") return { type: "image" as const, storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
          if (p.type === "file") return { type: "file" as const, storagePath: p.storagePath, downloadUrl: p.downloadUrl, mimeType: p.mimeType, fileName: p.fileName };
          return { type: "text" as const, text: "" };
        }),
      }));

      const requestBody = JSON.stringify({
        chatId,
        modelId: args.modelId,
        thinkingMode: args.thinkingMode,
        messages: payloadMessages,
      });

      // Task 16: if our cached idToken has rotated server-side, the API will return 401.
      // Force-refresh via Firebase auth and retry the streaming POST exactly once.
      const doFetch = async (token: string): Promise<Response> =>
        fetch("/api/chat", {
          method: "POST",
          signal: ac.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: requestBody,
        });

      let response: Response;
      let retried = false;
      try {
        response = await doFetch(args.idToken);
        if (response.status === 401 && !retried) {
          retried = true;
          const fresh = await getClientAuth().currentUser?.getIdToken(true).catch(() => null);
          if (fresh) {
            response = await doFetch(fresh);
          }
        }
      } catch (e) {
        // Task 33: ensure we always clear streaming state when the fetch itself fails
        // before we ever read a byte. The previous code did this only on AbortError.
        if ((e as Error).name === "AbortError") {
          setIsStreaming(false);
          setStreamingMessageId(null);
          setStreamStatus({ status: null });
          setMessages((prev) => prev.filter((m) => m.id !== idRef.current));
          return;
        }
        toast.error(`Network error: ${(e as Error).message}`);
        setIsStreaming(false);
        setStreamingMessageId(null);
        setStreamStatus({ status: null });
        setMessages((prev) => prev.filter((m) => m.id !== idRef.current && m.id !== userMessage.id));
        return;
      }

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        let userFriendly = "";
        let isRateLimit = false;
        try {
          const json = JSON.parse(text);
          if (json.error === "rate_limited") {
            isRateLimit = true;
            userFriendly = `Rate limited (${json.scope}). Try again in ${json.retryAfter}s.`;
            toast.error(userFriendly, { duration: 6000 });
          } else if (json.error === "unauthenticated") {
            userFriendly = "Sign-in expired. Please refresh the page.";
            toast.error(userFriendly);
          } else {
            userFriendly = json.message || json.error || "Request failed.";
            toast.error(userFriendly);
          }
        } catch {
          userFriendly = `Server error (${response.status}): ${text.slice(0, 200)}`;
          toast.error(userFriendly);
        }
        setIsStreaming(false);
        setStreamingMessageId(null);
        setStreamStatus({ status: null });
        if (isRateLimit) {
          // Don't pollute the chat with an error bubble for a transient rate-limit;
          // the toast already conveys it and the user message is preserved.
          setMessages((prev) => prev.filter((m) => m.id !== idRef.current));
        } else {
          // Replace the placeholder with a proper failed-turn so the user gets a Retry
          // affordance via MessageView's InterruptedNotice + the failure context inline.
          const failureText = `_⚠️ ${userFriendly || "The request failed."}_`;
          setMessages((prev) => {
            const out = [...prev];
            const i = out.findIndex((m) => m.id === idRef.current);
            if (i !== -1) {
              out[i] = {
                ...out[i],
                parts: [{ type: "text", text: failureText }],
                finishReason: "error",
              };
            }
            return out;
          });
        }
        return;
      }

      const reasoningStartByMessage = new Map<string, number>();
      let networkLost = false;
      try {
        for await (const ev of parseEventStream(response.body)) {
          handleEvent(ev, {
            idRef,
            setMessages,
            setArtifactsState,
            setStreamingMessageId,
            setChatId,
            setTitle,
            setContextUsage,
            setRecentlyOpenedArtifact,
            setStreamStatus,
            reasoningStartByMessage,
          });
        }
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          // Intentional cancel — UI state is reset in finally.
        } else if (err.name === "TypeError" || err.name === "NetworkError") {
          // Task 56: surface a "Connection lost — reconnecting..." status so the chat
          // shell can display a banner. We don't actually reconnect here; that's owned
          // by the chat-shell layer (Agent E). We just emit the status and skip the
          // generic error toast so the banner is the canonical signal.
          networkLost = true;
          setStreamStatus({ status: "retry", message: "Connection lost — reconnecting…" });
        } else {
          toast.error(`Stream error: ${err.message}`);
        }
      } finally {
        setIsStreaming(false);
        setStreamingMessageId(null);
        // Task 56: keep the "retry" status visible after the loop tears down so the
        // banner doesn't immediately disappear. Otherwise reset to clear.
        if (!networkLost) setStreamStatus({ status: null });
      }
    },
    [chatId, isStreaming, messages, setMessages]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingMessageId(null);
    setStreamStatus({ status: null });
  }, []);

  const setArtifacts = useCallback((updater: (m: Map<string, ArtifactRecord>) => Map<string, ArtifactRecord>) => {
    setArtifactsState((m) => updater(new Map(m)));
  }, []);

  // Hard reset for "new chat" — aborts any in-flight stream, clears chat-level state.
  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStreamingMessageId(null);
    setStreamStatus({ status: null });
    setContextUsage(null);
    setRecentlyOpenedArtifact(null);
    setArtifactsState(new Map());
    setMessagesState([]);
    setTitle("New chat");
    setChatId(null);
  }, []);

  return {
    chatId,
    messages,
    artifacts,
    title,
    isStreaming,
    streamingMessageId,
    streamStatus,
    contextUsage,
    recentlyOpenedArtifact,
    send,
    abort,
    resetAll,
    setMessages,
    setArtifacts,
    setChatId,
    setTitle,
  };
}

interface EventHandlers {
  idRef: { current: string };
  setMessages: SetMessages;
  setArtifactsState: React.Dispatch<React.SetStateAction<Map<string, ArtifactRecord>>>;
  setStreamingMessageId: (id: string | null) => void;
  setChatId: (id: string) => void;
  setTitle: (t: string) => void;
  setContextUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  setRecentlyOpenedArtifact: (id: string | null) => void;
  setStreamStatus: React.Dispatch<React.SetStateAction<{ status: StreamStatus | null; message?: string; elapsedMs?: number; retryAfter?: number; modelId?: string }>>;
  reasoningStartByMessage: Map<string, number>;
}

function handleEvent(ev: StreamEvent, h: EventHandlers) {
  switch (ev.type) {
    case "meta": {
      h.setChatId(ev.chatId);
      const oldId = h.idRef.current;
      const newId = ev.assistantMessageId;
      h.setMessages((prev) => {
        const out = [...prev];
        const idx = out.findIndex((m) => m.id === oldId);
        if (idx >= 0) out[idx] = { ...out[idx], id: newId };
        return out;
      });
      h.idRef.current = newId;
      h.setStreamingMessageId(newId);
      if (ev.trimmed && ev.trimmed > 0) {
        toast.info(`Trimmed ${ev.trimmed} earlier messages to fit ${ev.modelId}'s context window.`);
      }
      if (ev.strippedAttachments) {
        toast.info("Some attachments were stripped because the selected model doesn't accept them.");
      }
      break;
    }

    case "text-delta": {
      h.setMessages((prev) => appendText(prev, h.idRef.current, ev.text));
      break;
    }

    case "reasoning-delta": {
      h.setMessages((prev) => appendReasoning(prev, h.idRef.current, ev.text, h.reasoningStartByMessage));
      break;
    }

    case "artifact-open": {
      const id = ev.id;
      const newRecord: ArtifactRecord = {
        id,
        type: ev.artifactType,
        title: ev.title,
        language: ev.language,
        body: "",
        version: 1,
        createdAt: Date.now(),
        createdByMessageId: h.idRef.current,
      };
      h.setArtifactsState((prev) => {
        const m = new Map(prev);
        const existing = m.get(id);
        if (existing) {
          m.set(id, {
            ...existing,
            type: ev.artifactType,
            title: ev.title,
            language: ev.language,
            body: "",
            version: existing.version + 1,
          });
        } else {
          m.set(id, newRecord);
        }
        return m;
      });
      h.setRecentlyOpenedArtifact(id);
      h.setMessages((prev) => addArtifactRefIfMissing(prev, h.idRef.current, id));
      break;
    }

    case "artifact-delta": {
      h.setArtifactsState((prev) => {
        const m = new Map(prev);
        const r = m.get(ev.id);
        if (r) m.set(ev.id, { ...r, body: r.body + ev.text });
        return m;
      });
      break;
    }

    case "artifact-close": {
      // Marker only — body is already complete.
      break;
    }

    case "usage": {
      h.setContextUsage(ev.usage);
      const id = h.idRef.current;
      h.setMessages((prev) => {
        const out = [...prev];
        const idx = out.findIndex((m) => m.id === id);
        if (idx >= 0) out[idx] = { ...out[idx], usage: ev.usage };
        return out;
      });
      break;
    }

    case "finish": {
      const id = h.idRef.current;
      h.setMessages((prev) => {
        const out = [...prev];
        const idx = out.findIndex((m) => m.id === id);
        if (idx >= 0) {
          const reasoningPart = out[idx].parts.find((p) => p.type === "reasoning");
          if (reasoningPart && ev.thinkingDurationMs) reasoningPart.durationMs = ev.thinkingDurationMs;
          out[idx] = { ...out[idx], finishReason: ev.finishReason };
        }
        return out;
      });
      break;
    }

    case "title":
      h.setTitle(ev.title);
      break;

    case "status":
      h.setStreamStatus({
        status: ev.status,
        message: ev.message,
        elapsedMs: ev.elapsedMs,
        retryAfter: ev.retryAfter,
        modelId: ev.modelId,
      });
      // For long-running statuses, also surface a transient toast so the user knows.
      if (ev.status === "fallback" && ev.message) toast.info(ev.message);
      if (ev.status === "rate_limited" && ev.message) toast.warning(ev.message);
      break;

    case "error":
      toast.error(ev.message);
      break;
  }
}

function appendText(prev: ChatMessage[], assistantId: string, delta: string): ChatMessage[] {
  const out = [...prev];
  const idx = out.findIndex((m) => m.id === assistantId);
  if (idx === -1) return prev;
  const msg = out[idx];
  const parts = [...msg.parts];
  let lastTextIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === "text") {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx === -1) {
    parts.push({ type: "text", text: delta });
  } else {
    parts[lastTextIdx] = { ...parts[lastTextIdx], text: (parts[lastTextIdx].text || "") + delta };
  }
  out[idx] = { ...msg, parts };
  return out;
}

function appendReasoning(prev: ChatMessage[], assistantId: string, delta: string, startMap: Map<string, number>): ChatMessage[] {
  const out = [...prev];
  const idx = out.findIndex((m) => m.id === assistantId);
  if (idx === -1) return prev;
  const msg = out[idx];
  const parts = [...msg.parts];
  let reasoningIdx = parts.findIndex((p) => p.type === "reasoning");
  if (!startMap.has(assistantId)) startMap.set(assistantId, Date.now());
  if (reasoningIdx === -1) {
    parts.unshift({ type: "reasoning", reasoningText: delta, durationMs: 0 });
    reasoningIdx = 0;
  } else {
    parts[reasoningIdx] = {
      ...parts[reasoningIdx],
      reasoningText: (parts[reasoningIdx].reasoningText || "") + delta,
      durationMs: Date.now() - (startMap.get(assistantId) ?? Date.now()),
    };
  }
  out[idx] = { ...msg, parts };
  return out;
}

function addArtifactRefIfMissing(prev: ChatMessage[], assistantId: string, artifactId: string): ChatMessage[] {
  const out = [...prev];
  const idx = out.findIndex((m) => m.id === assistantId);
  if (idx === -1) return prev;
  const msg = out[idx];
  const has = msg.parts.some((p) => p.type === "artifact-ref" && p.artifactId === artifactId);
  if (has) return prev;
  out[idx] = { ...msg, parts: [...msg.parts, { type: "artifact-ref", artifactId }] };
  return out;
}
