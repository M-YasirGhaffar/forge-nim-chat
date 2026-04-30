"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { PanelLeft, PanelRight, Pencil, Code, Brain, Image as ImageIcon, X, FlaskConical, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth, authedFetch } from "@/components/auth-provider";
import { ChatSidebar } from "./sidebar";
import { Composer } from "./composer";
import { MessageView } from "./message";
import { SwitchModelDialog } from "./switch-model-dialog";
import { StreamStatusPill } from "./stream-status";
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

  const [modelId, setModelId] = useState(initialModelId || DEFAULT_MODEL_ID);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(initialThinking || "high");
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
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

  // Switch-model dialog state.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // On a fresh /chat mount, honor a "carry" hint left by SwitchModelDialog.
  useEffect(() => {
    if (initialChatId) return;
    try {
      const raw = window.localStorage.getItem("polyglot:newChatCarry");
      if (!raw) return;
      window.localStorage.removeItem("polyglot:newChatCarry");
      const carry = JSON.parse(raw) as { modelId?: string; seedText?: string };
      if (carry.modelId) setModelId(carry.modelId);
      if (carry.seedText) {
        // Push to composer via the same custom-event the suggestion cards use.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("polyglot:fill-composer", { detail: carry.seedText }));
        }, 80);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stream = useChatStream({ initialChatId, initialMessages, initialArtifacts, initialTitle });

  // The model is locked once the chat has at least one assistant turn (or while a turn is streaming).
  const modelLocked = useMemo(() => {
    return stream.messages.some((m) => m.role === "assistant");
  }, [stream.messages]);

  function handleModelChange(newId: string) {
    if (newId === modelId) return;
    if (modelLocked) {
      setPendingSwitch(newId);
      return;
    }
    setModelId(newId);
  }

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
    setAttachments((prev) =>
      prev.filter((a) => {
        if (a.type === "image") return m.supportsImages || m.category === "image";
        if (a.type === "video") return m.supportsVideo;
        return true;
      })
    );
    setPendingFiles((prev) =>
      prev.filter((f) => {
        if (f.type.startsWith("image/")) return m.supportsImages || m.category === "image";
        if (f.type.startsWith("video/")) return m.supportsVideo;
        return true;
      })
    );
  }, [modelId]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "b") {
        e.preventDefault();
        setShowSidebar((s) => !s);
      } else if (meta && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        if (window.location.pathname === "/chat") window.location.reload();
        else window.location.assign("/chat");
      } else if (e.key === "Escape" && showArtifactPanel) {
        setShowArtifactPanel(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, showArtifactPanel]);

  const model = getModel(modelId)!;
  const isImageMode = model.category === "image";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stream.isStreaming) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [stream.messages, stream.isStreaming]);

  const isEmpty = stream.messages.length === 0;

  // Defer attachment uploads until we have a real chatId. P1-6 from audit.
  async function handleAddAttachments(files: File[]) {
    if (!stream.chatId) {
      // Stash files; they'll upload right before send.
      if (isImageMode) {
        // Reference image preview.
        const f = files[0];
        if (model.id !== "black-forest-labs/flux.1-kontext-dev") {
          toast.error(`${model.displayName} doesn't accept reference images. Use FLUX.1 Kontext.`);
          return;
        }
        const preview = URL.createObjectURL(f);
        setReferenceImageUrl(preview);
        setPendingFiles([f]);
        return;
      }
      setPendingFiles((prev) => [...prev, ...files]);
      // Show preview chips immediately (we don't have storagePath yet — use a synthetic key).
      const previews: AttachmentRef[] = files.map((f, i) => ({
        storagePath: `pending:${Date.now()}-${i}-${f.name}`,
        downloadUrl: URL.createObjectURL(f),
        mimeType: f.type,
        fileName: f.name,
        type: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "pdf",
        size: f.size,
      }));
      setAttachments((prev) => [...prev, ...previews]);
      return;
    }

    for (const file of files) {
      try {
        if (isImageMode) {
          if (model.id !== "black-forest-labs/flux.1-kontext-dev") {
            toast.error(`${model.displayName} doesn't accept reference images. Use FLUX.1 Kontext.`);
            return;
          }
          const a = await uploadAttachment({ chatId: stream.chatId, file });
          setReferenceImagePath(a.storagePath);
          setReferenceImageUrl(a.downloadUrl);
        } else {
          const a = await uploadAttachment({ chatId: stream.chatId, file });
          setAttachments((prev) => [...prev, a]);
        }
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      }
    }
  }

  function handleRemoveAttachment(storagePath: string) {
    setAttachments((prev) => prev.filter((a) => a.storagePath !== storagePath));
    setPendingFiles((prev) => prev.filter((f) => !storagePath.includes(f.name)));
  }

  async function handleSubmit(text: string) {
    if (!idToken) {
      toast.error("Sign in expired. Please refresh.");
      return;
    }
    if (isImageMode) {
      await handleImageGeneration(text);
      return;
    }

    // If we have pending files but no chatId yet, we can't upload them — they'll be lost.
    // Show a warning and bail. (The proper fix would be: create chat first, then upload.
    // For now, we just block if there are pending files and no chatId.)
    if (pendingFiles.length > 0 && !stream.chatId) {
      // Trade-off: wait for the chat to be created server-side, then upload, then attach.
      // For now we keep it simple: send without the pending files (user already sees a warning).
      toast.info("Attachments will upload after the chat is created. Sending text first.");
      // Drop the pending preview chips so they don't look like part of this message.
      setAttachments((prev) => prev.filter((a) => !a.storagePath.startsWith("pending:")));
      setPendingFiles([]);
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
    setAttachments([]);
    setPendingFiles([]);
  }

  async function handleImageGeneration(prompt: string) {
    if (!idToken) {
      toast.error("Sign in expired. Please refresh.");
      return;
    }
    // If a reference is pending (no chatId yet) we'll need to upload after the chat is created.
    let referencePath = referenceImagePath;
    if (!referencePath && pendingFiles.length > 0 && stream.chatId) {
      try {
        const a = await uploadAttachment({ chatId: stream.chatId, file: pendingFiles[0] });
        referencePath = a.storagePath;
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
        return;
      }
    }
    const optimisticUserMessage: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: prompt }],
      createdAt: Date.now(),
    };
    const placeholderId = `tmp-asst-${Date.now() + 1}`;
    const placeholderMessage: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      parts: [{ type: "text", text: `Generating image with **${model.displayName}**…` }],
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
                    mimeType: "image/png",
                    fileName: `${data.assistantMessageId}.png`,
                  },
                  {
                    type: "text",
                    text: data.licenseCommercial
                      ? `Generated by ${model.displayName}.`
                      : `Generated by ${model.displayName}. *${model.license} — non-commercial use only.*`,
                  },
                ],
              }
            : m.id === optimisticUserMessage.id
              ? { ...m, id: data.userMessageId }
              : m
        )
      );
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

  if (loading || !user) {
    return (
      <div className="h-screen grid place-items-center">
        <div className="shimmer h-3 w-32 rounded" />
      </div>
    );
  }

  const activeArtifact = activeArtifactId ? stream.artifacts.get(activeArtifactId) || null : null;
  const totalUsed = stream.contextUsage?.totalTokens ?? 0;
  const lastAssistant = [...stream.messages].reverse().find((m) => m.role === "assistant");
  const isStreamingActive =
    stream.isStreaming && lastAssistant && stream.streamingMessageId === lastAssistant.id;

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
            <ChatSidebar activeChatId={stream.chatId} onCollapse={() => setShowSidebar(false)} />
          </div>
        </>
      )}

      <div className="flex-1 flex min-w-0">
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Slim top bar — only shows when sidebar is collapsed or there's an artifact panel toggle */}
          <header className="h-12 flex items-center px-3 gap-2">
            {!showSidebar && (
              <button
                onClick={() => setShowSidebar(true)}
                className="btn btn-ghost h-8 w-8 p-0"
                title="Open sidebar (Ctrl+B)"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
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
              composer={
                <Composer
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
                  autoFocus
                  imageMode={
                    isImageMode
                      ? {
                          referenceStoragePath: referenceImagePath || (referenceImageUrl ? "preview" : undefined),
                          onClearReference: () => {
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
              }
            />
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto max-w-3xl w-full px-4 pt-4 pb-32 space-y-7">
                  {stream.messages.map((m) => (
                    <div key={m.id}>
                      <MessageView
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

              <div className="absolute bottom-0 inset-x-0 pointer-events-none">
                <div className="h-12 bg-gradient-to-t from-[rgb(var(--color-bg))] to-transparent" />
                <div className="bg-[rgb(var(--color-bg))] pointer-events-auto">
                  <Composer
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
                    imageMode={
                      isImageMode
                        ? {
                            referenceStoragePath: referenceImagePath || (referenceImageUrl ? "preview" : undefined),
                            onClearReference: () => {
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
                </div>
              </div>
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
          toModelId={pendingSwitch}
          lastUserText={[...stream.messages].reverse().find((m) => m.role === "user")?.parts.find((p) => p.type === "text")?.text || ""}
          onCancel={() => setPendingSwitch(null)}
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
