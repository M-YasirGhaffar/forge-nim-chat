"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { PanelLeft, PanelRight, Pencil, Code, Brain, Image as ImageIcon, X, FlaskConical, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth, authedFetch } from "@/components/auth-provider";
import { ChatSidebar } from "./sidebar";
import { Composer } from "./composer";
import { MessageView } from "./message";
import { SwitchModelDialog } from "./switch-model-dialog";
import { StreamStatusPill } from "./stream-status";
import { OfflineBanner } from "./offline-banner";
import { useChatStream } from "@/lib/chat/use-chat-stream";
import { uploadAttachment } from "@/lib/chat/attachments";
import { getModel, DEFAULT_MODEL_ID } from "@/lib/models/registry";
import type { ArtifactRecord, AttachmentRef, ChatMessage, ThinkingMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const ArtifactPanel = dynamic(
  () => import("./artifact-panel").then((m) => ({ default: m.ArtifactPanel })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full grid place-items-center">
        <div className="shimmer h-3 w-32 rounded" />
      </div>
    ),
  }
);

interface Props {
  chatId: string | null;
  initialMessages: ChatMessage[];
  initialArtifacts: ArtifactRecord[];
  initialTitle?: string;
  initialModelId?: string;
  initialThinking?: ThinkingMode;
}

// AttachmentRef plus the optional fields we attach client-side.
type ExtendedAttachment = AttachmentRef & {
  pdfText?: string;
  // Marks a chip that hasn't been uploaded yet — its `storagePath` is "pending:..."
  // and the `downloadUrl` is a blob: URL we own and must revoke.
  isPending?: boolean;
};

export function ChatShell({
  chatId: initialChatId,
  initialMessages,
  initialArtifacts,
  initialTitle,
  initialModelId,
  initialThinking,
}: Props) {
  const router = useRouter();
  const { user, idToken, loading } = useAuth();

  // If `initialModelId` was saved by an older code version under a since-renamed id,
  // fall back to the default — otherwise getModel() would later return undefined and
  // every render of the picker / composer would explode on `model.category`.
  const [modelId, setModelId] = useState(() => {
    if (initialModelId && getModel(initialModelId)) return initialModelId;
    return DEFAULT_MODEL_ID;
  });
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(initialThinking || "high");
  const [attachments, setAttachments] = useState<ExtendedAttachment[]>([]);
  // pendingFiles is keyed by storagePath of the matching pending chip so removals stay in sync.
  const [pendingFiles, setPendingFiles] = useState<Array<{ key: string; file: File }>>([]);
  // Stable client-generated id for attachment uploads when there's no chat yet.
  // Reset whenever a new chat starts so the next chat's storage paths are isolated.
  const pendingChatIdRef = useRef<string>(nanoid(12));

  // Task 19: every blob URL we create lives here so we can revoke deterministically.
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const trackObjectUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url);
  }, []);
  const revokeObjectUrl = useCallback((url: string | undefined) => {
    if (!url || !url.startsWith("blob:")) return;
    if (objectUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  }, []);
  useEffect(() => {
    return () => {
      // Cleanup on unmount.
      for (const url of objectUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      objectUrlsRef.current.clear();
    };
  }, []);

  const [showSidebar, setShowSidebar] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !window.matchMedia("(min-width: 768px)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      setIsMobile(!mq.matches);
      // Auto-collapse on mobile, auto-expand on desktop.
      setShowSidebar(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [showArtifactPanel, setShowArtifactPanel] = useState(initialArtifacts.length > 0);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    initialArtifacts.length > 0 ? initialArtifacts[0].id : null
  );

  const [referenceImagePath, setReferenceImagePath] = useState<string | undefined>();
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | undefined>();
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [steps, setSteps] = useState(4);

  const [pendingSwitch, setPendingSwitch] = useState<boolean>(false);

  const stream = useChatStream({ initialChatId, initialMessages, initialArtifacts, initialTitle });

  // The model is locked once the chat has at least one assistant turn (or while a turn is streaming).
  const modelLocked = useMemo(() => {
    return stream.messages.some((m) => m.role === "assistant");
  }, [stream.messages]);

  function handleModelChange(newId: string) {
    if (newId === modelId) return;
    if (modelLocked) {
      setPendingSwitch(true);
      return;
    }
    setModelId(newId);
  }

  const handleRequestSwitch = useCallback(() => {
    setPendingSwitch(true);
  }, []);

  // Regenerate: resend the most recent user message + drop the current assistant turn.
  async function handleRegenerate() {
    if (!idToken || stream.isStreaming) return;
    const reversed = [...stream.messages].reverse();
    const lastUser = reversed.find((m) => m.role === "user");
    if (!lastUser) return;
    const lastUserText =
      lastUser.parts.find((p) => p.type === "text")?.text ?? "";
    // Drop everything after (and including) the last assistant turn that came after this user msg.
    const lastUserIdx = stream.messages.findIndex((m) => m.id === lastUser.id);
    stream.setMessages((prev) => prev.slice(0, lastUserIdx));
    const lastUserAttachments = lastUser.parts
      .filter((p) => p.type !== "text")
      .map((p) => ({
        storagePath: p.storagePath ?? "",
        downloadUrl: p.downloadUrl ?? "",
        mimeType: p.mimeType ?? "",
        fileName: p.fileName ?? "",
        type: p.type === "image" ? ("image" as const) : ("pdf" as const),
        size: 0,
      }));
    await stream.send({
      text: lastUserText,
      attachments: lastUserAttachments,
      modelId,
      thinkingMode,
      idToken,
    });
  }

  // Task 42: edit a user message and resend from that point.
  async function handleEditUserMessage(messageId: string, newText: string) {
    if (!idToken || stream.isStreaming) return;
    const idx = stream.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const targetUser = stream.messages[idx];
    if (targetUser.role !== "user") return;
    const preservedAttachments = targetUser.parts
      .filter((p) => p.type !== "text")
      .map((p) => ({
        storagePath: p.storagePath ?? "",
        downloadUrl: p.downloadUrl ?? "",
        mimeType: p.mimeType ?? "",
        fileName: p.fileName ?? "",
        type: p.type === "image" ? ("image" as const) : ("pdf" as const),
        size: 0,
      }));
    // Truncate everything from idx onward — the server will re-persist the new user
    // message via its normal flow when we call stream.send().
    stream.setMessages((prev) => prev.slice(0, idx));
    await stream.send({
      text: newText,
      attachments: preservedAttachments,
      modelId,
      thinkingMode,
      idToken,
    });
  }

  // Task 59: resume a length-truncated assistant message.
  async function handleContinue() {
    if (!idToken || stream.isStreaming) return;
    await stream.send({
      text: "Continue from where you left off — pick up exactly where you stopped.",
      attachments: [],
      modelId,
      thinkingMode,
      idToken,
    });
  }

  // Auth gate.
  useEffect(() => {
    if (!loading && !user) {
      const next = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, user, router]);

  // Reflect server-assigned chatId in URL — using history.replaceState (NOT router.replace)
  // because router.replace triggers a remount of the route segment, which kills the in-flight
  // streaming fetch + drops all assistant tokens on the floor.
  useEffect(() => {
    if (stream.chatId && stream.chatId !== initialChatId) {
      window.history.replaceState({}, "", `/chat/${stream.chatId}`);
      window.dispatchEvent(new Event("polyglot:refresh-chats"));
    }
  }, [stream.chatId, initialChatId]);

  useEffect(() => {
    if (stream.title && stream.title !== "New chat") {
      window.dispatchEvent(new Event("polyglot:refresh-chats"));
    }
  }, [stream.title]);

  useEffect(() => {
    if (stream.recentlyOpenedArtifact) {
      setActiveArtifactId(stream.recentlyOpenedArtifact);
      setShowArtifactPanel(true);
    }
  }, [stream.recentlyOpenedArtifact]);

  // Persist last-used model server-side (best-effort, debounced).
  useEffect(() => {
    if (!user || !idToken) return;
    const t = setTimeout(() => {
      authedFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ lastModel: modelId, thinkingDefault: thinkingMode }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [modelId, thinkingMode, user, idToken]);

  // Drop attachments incompatible with the new model.
  useEffect(() => {
    const m = getModel(modelId)!;
    setAttachments((prev) => {
      const dropped: ExtendedAttachment[] = [];
      const kept = prev.filter((a) => {
        let ok = true;
        if (a.type === "image") ok = m.supportsImages || m.category === "image";
        else if (a.type === "video") ok = m.supportsVideo;
        if (!ok) dropped.push(a);
        return ok;
      });
      // Revoke any blob URLs we created for the dropped previews.
      for (const a of dropped) revokeObjectUrl(a.downloadUrl);
      return kept;
    });
    setPendingFiles((prev) =>
      prev.filter(({ file }) => {
        if (file.type.startsWith("image/")) return m.supportsImages || m.category === "image";
        if (file.type.startsWith("video/")) return m.supportsVideo;
        return true;
      })
    );
  }, [modelId, revokeObjectUrl]);

  // Respond to "new chat" reset events from the sidebar without remounting. This MUST
  // abort any in-flight stream — otherwise switching to a fresh chat while a model is
  // still responding leaves the Stop button on the new (empty) composer.
  useEffect(() => {
    function onReset() {
      // Revoke any pending blob URLs.
      for (const a of attachments) revokeObjectUrl(a.downloadUrl);
      revokeObjectUrl(referenceImageUrl);
      objectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      objectUrlsRef.current.clear();

      pendingChatIdRef.current = nanoid(12);
      setAttachments([]);
      setPendingFiles([]);
      setReferenceImagePath(undefined);
      setReferenceImageUrl(undefined);
      setShowArtifactPanel(false);
      setActiveArtifactId(null);
      // resetAll() aborts the in-flight fetch, clears messages/artifacts/streaming flags
      // AND the context-usage meter so the new chat starts truly fresh.
      stream.resetAll();
      // Replace URL so the address bar reflects the cleared state.
      if (window.location.pathname !== "/chat") {
        window.history.replaceState({}, "", "/chat");
      }
    }
    window.addEventListener("polyglot:reset-chat", onReset);
    return () => window.removeEventListener("polyglot:reset-chat", onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, referenceImageUrl, revokeObjectUrl]);


  const model = getModel(modelId)!;
  const isImageMode = model.category === "image";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // Task 21+29: track whether the user has scrolled away from the bottom.
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  function handleScroll() {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    setUserScrolledUp(distance > 80);
  }

  // Streaming auto-scroll: instant during stream, smooth at end. Only follows when the
  // user hasn't scrolled away.
  useEffect(() => {
    if (userScrolledUp) return;
    if (stream.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [stream.messages, stream.isStreaming, userScrolledUp]);

  function jumpToLatest() {
    setUserScrolledUp(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  const isEmpty = stream.messages.length === 0;

  // When there's no chat yet, files still upload right away — we route them under a
  // client-generated chat id (pendingChatIdRef). The server's signed-URL endpoint
  // accepts any chatId; the real chat doc id is assigned during /api/chat and the
  // storage path is captured verbatim in Firestore.
  async function handleAddAttachments(files: File[]) {
    const targetChatId = stream.chatId || pendingChatIdRef.current;

    if (isImageMode) {
      // Reference image upload (single).
      const f = files[0];
      if (!f) return;
      if (model.id !== "black-forest-labs/flux.1-kontext-dev") {
        toast.error(`${model.displayName} doesn't accept reference images. Use FLUX.1 Kontext.`);
        return;
      }
      // Show a local preview immediately for snappy feedback.
      const preview = URL.createObjectURL(f);
      trackObjectUrl(preview);
      revokeObjectUrl(referenceImageUrl);
      setReferenceImageUrl(preview);
      try {
        const a = await uploadAttachment({ chatId: targetChatId, file: f });
        setReferenceImagePath(a.storagePath);
        // Keep the local preview as URL — it's faster than the signed URL during composition.
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
        revokeObjectUrl(preview);
        setReferenceImageUrl(undefined);
      }
      return;
    }

    // Standard text-mode attachments. Optimistically render preview chips while the upload runs.
    const previews: ExtendedAttachment[] = files.map((f, i) => {
      const blobUrl = URL.createObjectURL(f);
      trackObjectUrl(blobUrl);
      const pendingKey = `pending:${Date.now()}-${i}-${f.name}`;
      return {
        storagePath: pendingKey,
        downloadUrl: blobUrl,
        mimeType: f.type,
        fileName: f.name,
        type: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "pdf",
        size: f.size,
        isPending: true,
      };
    });
    setAttachments((prev) => [...prev, ...previews]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const preview = previews[i];
      try {
        const a = await uploadAttachment({ chatId: targetChatId, file });
        // Replace the pending chip with the uploaded ref. Carry the local blob URL forward
        // until the message is sent so previews stay snappy; the server-side ref has the
        // real storagePath.
        setAttachments((prev) =>
          prev.map((p) =>
            p.storagePath === preview.storagePath
              ? {
                  ...a,
                  downloadUrl: a.downloadUrl, // keep authoritative for sending; UI blob already revoked below
                  isPending: false,
                  ...(a as { pdfText?: string }).pdfText
                    ? { pdfText: (a as unknown as { pdfText: string }).pdfText }
                    : {},
                }
              : p
          )
        );
        // The blob URL is no longer needed — the chip will use the signed URL.
        revokeObjectUrl(preview.downloadUrl);
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
        // Drop the failed chip and revoke its preview.
        setAttachments((prev) => prev.filter((p) => p.storagePath !== preview.storagePath));
        revokeObjectUrl(preview.downloadUrl);
      }
    }
  }

  function handleRemoveAttachment(storagePath: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.storagePath === storagePath);
      if (target) revokeObjectUrl(target.downloadUrl);
      return prev.filter((a) => a.storagePath !== storagePath);
    });
    setPendingFiles((prev) => prev.filter((p) => p.key !== storagePath));
  }

  async function handleSubmit(text: string) {
    if (!idToken) {
      toast.error("Sign in expired. Please refresh.");
      return;
    }
    // Route by both category and endpoint to catch stale-state mismatches: for FLUX
    // models the two always agree, but checking both means a cosmetic drift in either
    // field still routes the request to /api/image instead of /api/chat (which would
    // 400 with "unknown_model" because /api/chat only accepts endpoint:"chat" entries).
    if (isImageMode || model.endpoint === "infer") {
      await handleImageGeneration(text);
      return;
    }

    // Wait for any still-pending uploads to settle before we send. We don't have a
    // promise here — but uploads have already started in handleAddAttachments. If
    // there are pending chips remaining, surface a quick toast and bail; the user
    // can resubmit once uploads complete.
    const stillPending = attachments.filter((a) => a.isPending);
    if (stillPending.length > 0) {
      toast.info("Uploading attachments… please wait a moment.");
      return;
    }

    const pdfs = attachments.filter(
      (a) => a.type === "pdf" && (a as { pdfText?: string }).pdfText
    );
    let composed = text;
    for (const p of pdfs) {
      composed += `\n\n--- PDF: ${p.fileName} ---\n${(p as unknown as { pdfText: string }).pdfText}`;
    }
    const sendable = attachments.filter(
      (a) => !(a.type === "pdf") && !a.storagePath.startsWith("pending:")
    );
    await stream.send({ text: composed, attachments: sendable, modelId, thinkingMode, idToken });
    // Revoke any remaining blob URLs and clear pending state.
    for (const a of attachments) revokeObjectUrl(a.downloadUrl);
    setAttachments([]);
    setPendingFiles([]);
  }

  async function handleImageGeneration(prompt: string) {
    if (!idToken) {
      toast.error("Sign in expired. Please refresh.");
      return;
    }
    const referencePath = referenceImagePath;
    const optimisticUserMessage: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: prompt }],
      createdAt: Date.now(),
    };
    const placeholderId = `tmp-asst-${Date.now() + 1}`;
    // Use a sentinel `placeholder://` URL on a real image part. MessageView detects
    // this and renders an aspect-correct shimmer card at the chosen dimensions
    // instead of an `<img>`. Once the API returns, we swap the part in place and
    // the shimmer fades out → the real image fades in.
    const placeholderMessage: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      parts: [
        {
          type: "image",
          storagePath: `placeholder://${aspectRatio}`,
          downloadUrl: `placeholder://${aspectRatio}`,
          mimeType: "image/jpeg",
          fileName: `Generating with ${model.displayName}…`,
        },
      ],
      model: model.id,
      createdAt: Date.now() + 1,
    };
    stream.setMessages((prev) => [...prev, optimisticUserMessage, placeholderMessage]);

    try {
      const res = await authedFetch("/api/image", {
        method: "POST",
        idToken,
        body: JSON.stringify({
          chatId: stream.chatId,
          modelId,
          prompt,
          referenceImageStoragePath: referencePath,
          steps,
          aspectRatio,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        try {
          const json = JSON.parse(text);
          toast.error(json.message || json.error || "Generation failed.");
        } catch {
          toast.error(`Generation failed (${res.status})`);
        }
        stream.setMessages((prev) =>
          prev.filter((m) => m.id !== placeholderId && m.id !== optimisticUserMessage.id)
        );
        return;
      }
      const data = await res.json();
      stream.setChatId(data.chatId);
      stream.setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                id: data.assistantMessageId,
                parts: [
                  {
                    type: "image",
                    storagePath: data.storagePath,
                    downloadUrl: data.imageUrl,
                    mimeType: data.imageUrl?.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
                    fileName: `${data.assistantMessageId}.${data.imageUrl?.startsWith("data:image/jpeg") ? "jpg" : "png"}`,
                  },
                  {
                    type: "text",
                    text: `Generated by ${model.displayName}.`,
                  },
                ],
              }
            : m.id === optimisticUserMessage.id
              ? { ...m, id: data.userMessageId }
              : m
        )
      );
      // Cleanup reference + previews — revoke any blob URLs we still own.
      revokeObjectUrl(referenceImageUrl);
      setReferenceImagePath(undefined);
      setReferenceImageUrl(undefined);
      setPendingFiles([]);
      window.dispatchEvent(new Event("polyglot:refresh-chats"));
      window.history.replaceState({}, "", `/chat/${data.chatId}`);
    } catch (e) {
      toast.error(`Generation error: ${(e as Error).message}`);
      stream.setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
    }
  }

  if (loading) {
    return (
      <div className="h-screen grid place-items-center">
        <div className="shimmer h-2 w-32 rounded" />
      </div>
    );
  }
  if (!user) {
    // Loading is complete and there's no user → middleware/effect is redirecting to /login.
    // Render nothing so the user doesn't see a shimmer that says "Signing you in" during sign-OUT.
    return null;
  }

  const activeArtifact = activeArtifactId ? stream.artifacts.get(activeArtifactId) || null : null;
  const totalUsed = stream.contextUsage?.totalTokens ?? 0;
  const lastAssistant = [...stream.messages].reverse().find((m) => m.role === "assistant");
  const isStreamingActive =
    stream.isStreaming && lastAssistant && stream.streamingMessageId === lastAssistant.id;

  // Hoist the Composer into a single closure so empty + filled states share props.
  const composerNode = (
    <Composer
      chatId={stream.chatId}
      modelId={modelId}
      setModelId={handleModelChange}
      modelLocked={modelLocked}
      thinkingMode={thinkingMode}
      setThinkingMode={setThinkingMode}
      isStreaming={stream.isStreaming}
      contextUsed={totalUsed}
      attachments={attachments}
      onAddAttachments={handleAddAttachments}
      onRemoveAttachment={handleRemoveAttachment}
      onSubmit={handleSubmit}
      onAbort={stream.abort}
      autoFocus={isEmpty}
      onRequestSwitch={handleRequestSwitch}
      imageMode={
        isImageMode
          ? {
              referenceStoragePath: referenceImagePath || (referenceImageUrl ? "preview" : undefined),
              onClearReference: () => {
                revokeObjectUrl(referenceImageUrl);
                setReferenceImagePath(undefined);
                setReferenceImageUrl(undefined);
                setPendingFiles([]);
              },
              aspectRatio,
              setAspectRatio,
              steps,
              setSteps,
            }
          : undefined
      }
    />
  );

  return (
    <div className="h-screen flex bg-[rgb(var(--color-bg))] overflow-hidden">
      {showSidebar && (
        <>
          {isMobile && (
            <div
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={() => setShowSidebar(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={cn(
              isMobile ? "fixed inset-y-0 left-0 z-40 shadow-2xl" : "relative",
              "h-full"
            )}
          >
            <ChatSidebar activeChatId={initialChatId ?? stream.chatId} onCollapse={() => setShowSidebar(false)} />
          </div>
        </>
      )}

      <div className="flex-1 flex min-w-0">
        <main className="flex-1 flex flex-col min-w-0 relative">
          <OfflineBanner />

          {/* Slim top bar — only shows when sidebar is collapsed or there's an artifact panel toggle */}
          <header className="h-12 shrink-0 flex items-center px-3 gap-2">
            {!showSidebar && (
              <button
                onClick={() => setShowSidebar(true)}
                className="btn btn-ghost h-8 w-8 p-0"
                title="Open sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            )}

            {!isEmpty && model && (
              <div className="inline-flex items-center gap-1.5 rounded-full border bg-[rgb(var(--color-bg-elev))] px-2.5 py-1 text-[11.5px]" style={{ color: "rgb(var(--color-fg-muted))" }}>
                <span
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "rgb(var(--color-accent))" }}
                  aria-hidden="true"
                />
                <span className="font-medium" style={{ color: "rgb(var(--color-fg))" }}>{model.displayName}</span>
              </div>
            )}

            <div className="flex-1" />
            {stream.artifacts.size > 0 && (
              <button
                onClick={() => setShowArtifactPanel((s) => !s)}
                className={cn(
                  "btn h-8 px-2 text-[12px]",
                  showArtifactPanel ? "btn-secondary" : "btn-ghost"
                )}
                title={showArtifactPanel ? "Hide artifacts" : "Show artifacts"}
              >
                <PanelRight className="h-3.5 w-3.5" />
                {stream.artifacts.size} {stream.artifacts.size === 1 ? "artifact" : "artifacts"}
              </button>
            )}
          </header>

          {isEmpty ? (
            <EmptyView
              user={user}
              modelDisplay={model.displayName}
              category={model.category}
              composer={composerNode}
            />
          ) : (
            <>
              {/* Task 31: flex-column layout, composer is shrink-0 sibling not absolute. */}
              <div
                ref={messagesScrollRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto"
              >
                <div className="mx-auto max-w-3xl w-full px-4 pt-4 pb-4 space-y-7">
                  {stream.messages.map((m) => (
                    <div key={m.id}>
                      <MessageView
                        chatId={stream.chatId}
                        message={m}
                        artifacts={stream.artifacts}
                        isStreaming={stream.isStreaming && stream.streamingMessageId === m.id}
                        selectedArtifactId={showArtifactPanel ? activeArtifactId : null}
                        onSelectArtifact={(id) => {
                          setActiveArtifactId(id);
                          setShowArtifactPanel(true);
                        }}
                        onRegenerate={
                          m.role === "assistant" && !stream.isStreaming
                            ? handleRegenerate
                            : undefined
                        }
                        onContinue={
                          m.role === "assistant" && !stream.isStreaming
                            ? handleContinue
                            : undefined
                        }
                        onEditUserMessage={
                          m.role === "user" && !stream.isStreaming
                            ? (newText) => void handleEditUserMessage(m.id, newText)
                            : undefined
                        }
                      />
                      {stream.isStreaming &&
                        stream.streamingMessageId === m.id &&
                        stream.streamStatus.status &&
                        stream.streamStatus.status !== "streaming" && (
                          <StreamStatusPill
                            status={stream.streamStatus.status}
                            message={stream.streamStatus.message}
                            modelId={stream.streamStatus.modelId}
                            retryAfter={stream.streamStatus.retryAfter}
                          />
                        )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Jump-to-latest pill, only when user has scrolled away during streaming. */}
              {userScrolledUp && (
                <div className="absolute bottom-32 inset-x-0 grid place-items-center pointer-events-none">
                  <button
                    onClick={jumpToLatest}
                    className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-[rgb(var(--color-bg-elev))] shadow-md px-3 py-1.5 text-[12px] hover:shadow-lg transition-shadow"
                    style={{ color: "rgb(var(--color-fg-muted))" }}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    Jump to latest
                  </button>
                </div>
              )}

              {/* Composer is a shrink-0 sibling — no more absolute/gradient. */}
              <div className="shrink-0 bg-[rgb(var(--color-bg))]">{composerNode}</div>
            </>
          )}

          {referenceImageUrl && isImageMode && (
            <div className="absolute bottom-32 inset-x-0 px-4 pointer-events-none">
              <div className="max-w-3xl mx-auto pointer-events-auto">
                <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md border bg-[rgb(var(--color-bg-soft))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceImageUrl} alt="ref" className="h-10 w-10 rounded object-cover" />
                  <span className="text-[11px]">Reference loaded</span>
                  <button
                    className="opacity-60 hover:opacity-100"
                    onClick={() => {
                      revokeObjectUrl(referenceImageUrl);
                      setReferenceImagePath(undefined);
                      setReferenceImageUrl(undefined);
                      setPendingFiles([]);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {showArtifactPanel && activeArtifact && (
          <aside className="w-[44%] min-w-[480px] max-w-[860px] border-l bg-[rgb(var(--color-bg))] flex flex-col">
            <ArtifactPanel
              artifact={activeArtifact}
              isStreaming={
                Boolean(isStreamingActive) &&
                stream.streamingMessageId === activeArtifact.createdByMessageId
              }
              onClose={() => setShowArtifactPanel(false)}
            />
            {stream.artifacts.size > 1 && (
              <div className="border-t p-2 flex flex-wrap gap-1.5">
                {Array.from(stream.artifacts.values()).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setActiveArtifactId(a.id)}
                    className={cn(
                      "text-[11px] px-2 py-1 rounded-md border",
                      a.id === activeArtifactId
                        ? "bg-[rgb(var(--color-accent))] text-[rgb(var(--color-accent-fg))] border-[rgb(var(--color-accent))]"
                        : "bg-[rgb(var(--color-bg-elev))] hover:bg-[rgb(var(--color-bg-soft))]"
                    )}
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {pendingSwitch && (
        <SwitchModelDialog
          fromModelId={modelId}
          onCancel={() => setPendingSwitch(false)}
        />
      )}
    </div>
  );
}

function EmptyView({
  user,
  modelDisplay,
  category,
  composer,
}: {
  user: { displayName?: string | null; email?: string | null };
  modelDisplay: string;
  category: string;
  composer: React.ReactNode;
}) {
  const greeting = useMemo(() => greet(user), [user]);

  // TODO(task38): randomize suggestion order on mount once the static list grows.
  const suggestions = useMemo(() => {
    if (category === "image") {
      return [
        { icon: ImageIcon, title: "Isometric workshop", body: "An isometric pixel-art workshop with neon signage at golden hour" },
        { icon: ImageIcon, title: "Watercolor café", body: "A vibrant watercolor of a coffee shop interior on a rainy afternoon" },
        { icon: ImageIcon, title: "Astronaut portrait", body: "A photorealistic portrait of an astronaut floating above earth, soft rim light" },
        { icon: ImageIcon, title: "Logo mark", body: "A minimalist line-art mountain logo with a sunrise behind it, monoline weight" },
      ];
    }
    return [
      { icon: Code, title: "Build a UI component", body: "Build a React component for a sortable, paginated user table with Tailwind styling." },
      { icon: Brain, title: "Explain a tradeoff", body: "Explain the tradeoffs between Raft and Paxos using a real-world example." },
      { icon: Pencil, title: "Make a diagram", body: "Make a Mermaid sequence diagram of an OAuth 2.1 authorization-code flow." },
      { icon: FlaskConical, title: "Write a landing page", body: "Write a one-page HTML landing page for a coffee subscription startup." },
    ];
  }, [category]);

  function fillComposer(text: string) {
    window.dispatchEvent(new CustomEvent("polyglot:fill-composer", { detail: text }));
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <h1
          className="text-center text-[2.6rem] md:text-[3rem] font-semibold tracking-tight leading-[1.05] mb-2"
          style={{ fontFamily: "ui-serif, Georgia, 'Times New Roman', serif" }}
        >
          <span className="bg-gradient-to-r from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.6)] bg-clip-text text-transparent">
            {greeting},
          </span>{" "}
          <span style={{ color: "rgb(var(--color-fg))" }}>{firstName(user)}</span>
        </h1>
        <p className="text-center text-sm mb-8" style={{ color: "rgb(var(--color-fg-muted))" }}>
          Talking to <strong>{modelDisplay}</strong>. Switch models from the composer below.
        </p>

        {composer}

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-4">
          {suggestions.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.title}
                onClick={() => fillComposer(s.body)}
                className="text-left rounded-xl border bg-[rgb(var(--color-bg-elev))] hover:bg-[rgb(var(--color-bg-soft))] hover:border-[rgb(var(--color-border-strong))] transition-colors px-3.5 py-3 group"
              >
                <div className="flex items-start gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-[rgb(var(--color-bg-soft))] grid place-items-center shrink-0 mt-0.5 group-hover:bg-[rgb(var(--color-bg-elev))] border" style={{ color: "rgb(var(--color-accent))" }}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{s.title}</div>
                    <div className="text-[12px] mt-0.5 line-clamp-2" style={{ color: "rgb(var(--color-fg-muted))" }}>{s.body}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function greet(user: { displayName?: string | null; email?: string | null } | null): string {
  void user;
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late night";
}

function firstName(user: { displayName?: string | null; email?: string | null } | null): string {
  if (!user) return "";
  if (user.displayName) return user.displayName.split(" ")[0];
  if (user.email) {
    const local = user.email.split("@")[0];
    return local.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/)[0]?.replace(/^./, (c) => c.toUpperCase()) || "";
  }
  return "";
}
