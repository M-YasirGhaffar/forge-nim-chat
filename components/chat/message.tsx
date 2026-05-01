"use client";

import { memo, useState } from "react";
import { Copy, Check, Image as ImageIcon, FileText, RefreshCcw, ThumbsUp, ThumbsDown, Pencil, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage, ArtifactRecord } from "@/lib/types";
import { Markdown } from "./markdown";
import { ReasoningDisclosure } from "./reasoning-disclosure";
import { ArtifactCard } from "./artifact-card";
import { Lightbox } from "./lightbox";
import { Tooltip } from "@/components/ui/tooltip";
import { authedFetch } from "@/components/auth-provider";
import { getModel } from "@/lib/models/registry";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";

interface Props {
  chatId: string | null;
  message: ChatMessage;
  artifacts: Map<string, ArtifactRecord>;
  isStreaming?: boolean;
  selectedArtifactId?: string | null;
  onSelectArtifact: (id: string) => void;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onEditUserMessage?: (newText: string) => void;
}

// Memoized markdown wrapper — re-renders only when the rendered string changes.
const MemoizedMarkdown = memo(
  Markdown,
  (prev, next) => prev.content === next.content && prev.className === next.className
);

export function MessageView({
  chatId,
  message,
  artifacts,
  isStreaming,
  selectedArtifactId,
  onSelectArtifact,
  onRegenerate,
  onContinue,
  onEditUserMessage,
}: Props) {
  const isUser = message.role === "user";
  const model = message.model ? getModel(message.model) : undefined;

  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join("\n");
  const reasoningPart = message.parts.find((p) => p.type === "reasoning");
  const imageParts = message.parts.filter((p) => p.type === "image");
  const fileParts = message.parts.filter((p) => p.type === "file");

  if (isUser) {
    return (
      <UserMessage
        text={text}
        imageParts={imageParts}
        fileParts={fileParts}
        onEdit={onEditUserMessage}
      />
    );
  }

  return (
    <div className="group/message">
      {/* Vendor + model badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <ModelBadge vendor={model?.vendor} displayName={model?.displayName} />
      </div>

      {reasoningPart?.reasoningText && (
        <ReasoningDisclosure
          text={reasoningPart.reasoningText}
          durationMs={reasoningPart.durationMs}
          isStreaming={isStreaming && !text}
          defaultOpen={Boolean(isStreaming && !text)}
        />
      )}

      <div className="prose-chat">
        {imageParts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 not-prose">
            {imageParts.map((p, i) => {
              const src = p.downloadUrl || p.storagePath || "";
              if (src.startsWith("placeholder://")) {
                const aspect = src.replace("placeholder://", "") || "1:1";
                return <ImagePlaceholder key={i} aspect={aspect} caption={p.fileName} />;
              }
              return (
                <ImageWithLightbox
                  key={i}
                  src={src}
                  alt={p.fileName || "image"}
                  className="rounded-lg max-h-72 border cursor-zoom-in transition-opacity hover:opacity-95"
                />
              );
            })}
          </div>
        )}
        {fileParts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 not-prose">
            {fileParts.map((p, i) => (
              <a
                key={i}
                href={p.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs"
                style={{ color: "rgb(var(--color-fg-muted))" }}
              >
                {p.mimeType?.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {p.fileName || "attachment"}
              </a>
            ))}
          </div>
        )}

        {text || isStreaming ? (
          <div className={cn(isStreaming && text && "streaming-md")}>
            <MemoizedMarkdown
              content={text}
              renderArtifactRef={(id) => {
                const a = artifacts.get(id);
                if (!a) {
                  return (
                    <ArtifactCard
                      id={id}
                      type="code"
                      title="Generating artifact…"
                      isStreaming={true}
                      onClick={() => onSelectArtifact(id)}
                    />
                  );
                }
                return (
                  <ArtifactCard
                    id={id}
                    type={a.type}
                    title={a.title}
                    language={a.language}
                    bodyLength={a.body?.length}
                    isStreaming={isStreaming}
                    isSelected={selectedArtifactId === id}
                    onClick={() => onSelectArtifact(id)}
                  />
                );
              }}
            />
          </div>
        ) : null}

        {isStreaming && !text && !reasoningPart?.reasoningText && (
          <div className="flex items-center gap-1.5 py-2 not-prose" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>

      {/* Interrupted-turn recovery: empty assistant message with a non-stop finishReason.
          Image/file-only assistant messages (FLUX outputs) and any message that has
          an image part rendering count as content, so we only show the notice when the
          bubble is genuinely empty. */}
      {!isStreaming &&
        !text &&
        !reasoningPart &&
        imageParts.length === 0 &&
        fileParts.length === 0 &&
        message.finishReason !== "stop" &&
        message.finishReason !== "length" && (
          <InterruptedNotice onRetry={onRegenerate} />
        )}

      {!isStreaming && text && (
        <AssistantActions
          chatId={chatId}
          messageId={message.id}
          text={text}
          modelId={message.model}
          usage={message.usage ?? null}
          initialFeedback={
            (message as ChatMessage & { feedback?: { rating?: "up" | "down" } }).feedback?.rating ?? null
          }
          onRegenerate={onRegenerate}
          onContinue={message.finishReason === "length" ? onContinue : undefined}
        />
      )}
    </div>
  );
}

/**
 * Aspect-correct shimmer rendered while a FLUX image is generating. Sized so the
 * largest dimension matches the chat's max-h-72 cap (288px). Real image fades in
 * once it lands.
 */
function ImagePlaceholder({ aspect, caption }: { aspect: string; caption?: string }) {
  const ratios: Record<string, [number, number]> = {
    "1:1": [1, 1],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "3:2": [3, 2],
    "2:3": [2, 3],
    "4:3": [4, 3],
    "3:4": [3, 4],
  };
  const [w, h] = ratios[aspect] ?? [1, 1];
  // Cap the long edge at 288px (matches max-h-72 on real images).
  const max = 288;
  const scale = max / Math.max(w, h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return (
    <div
      className="rounded-lg border bg-[rgb(var(--color-bg-soft))] overflow-hidden relative"
      style={{ width, height }}
      aria-label={caption || "Generating image"}
    >
      <div className="absolute inset-0 shimmer" />
      <div className="absolute inset-0 grid place-items-center text-[11px]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
        <div className="px-2 py-1 rounded bg-[rgb(var(--color-bg-elev))]/80 backdrop-blur-sm border">
          {caption || "Generating…"}
        </div>
      </div>
    </div>
  );
}

function ImageWithLightbox({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className={className}
      />
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function InterruptedNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--color-warning)/0.4)] bg-[rgb(var(--color-warning)/0.06)] px-3 py-2 text-[12px]">
      <AlertTriangle className="h-3.5 w-3.5" style={{ color: "rgb(var(--color-warning))" }} />
      <span style={{ color: "rgb(var(--color-fg-muted))" }}>
        This generation was interrupted (page reload or network drop).
      </span>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-ghost h-6 px-1.5 text-[11px] -mr-1">
          <RefreshCcw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
}

function UserMessage({
  text,
  imageParts,
  fileParts,
  onEdit,
}: {
  text: string;
  imageParts: import("@/lib/types").MessagePart[];
  fileParts: import("@/lib/types").MessagePart[];
  onEdit?: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (editing && onEdit) {
    return (
      <div className="ml-auto max-w-[88%] rounded-2xl bg-[rgb(var(--color-bg-soft))] p-3">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          className="w-full resize-none bg-transparent outline-none text-[15px] leading-6"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
            className="btn btn-ghost h-8 px-3 text-[12px]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onEdit(draft);
              setEditing(false);
            }}
            disabled={!draft.trim() || draft === text}
            className="btn btn-primary h-8 px-3 text-[12px]"
          >
            Save &amp; submit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/message flex justify-end">
      <div className="max-w-[88%]">
        {imageParts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5 justify-end">
            {imageParts.map((p, i) => (
              <ImageWithLightbox
                key={i}
                src={p.downloadUrl || p.storagePath || ""}
                alt={p.fileName || "image"}
                className="rounded-lg max-h-64 border cursor-zoom-in transition-opacity hover:opacity-95"
              />
            ))}
          </div>
        )}
        {fileParts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5 justify-end">
            {fileParts.map((p, i) => (
              <a
                key={i}
                href={p.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs"
                style={{ color: "rgb(var(--color-fg-muted))" }}
              >
                <FileText className="h-3.5 w-3.5" />
                {p.fileName || "attachment"}
              </a>
            ))}
          </div>
        )}
        {text && (
          <div className="rounded-[20px] bg-[rgb(var(--color-bg-soft))] px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap">
            {text}
          </div>
        )}
        {onEdit && (
          <div className="mt-1 flex justify-end opacity-0 group-hover/message:opacity-100 transition-opacity">
            <button
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              className="btn btn-ghost h-7 px-2 text-[11px]"
              style={{ color: "rgb(var(--color-fg-muted))" }}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModelBadge({ vendor, displayName }: { vendor?: string; displayName?: string }) {
  if (!displayName) return null;
  const initial = (vendor || displayName).charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: "rgb(var(--color-fg-muted))" }}>
      <div className="h-5 w-5 rounded-full bg-gradient-to-br from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.55)] grid place-items-center text-[10px] font-semibold text-white shadow-sm">
        {initial}
      </div>
      <span className="font-medium" style={{ color: "rgb(var(--color-fg))" }}>{displayName}</span>
    </div>
  );
}

function AssistantActions({
  chatId,
  messageId,
  text,
  modelId,
  usage,
  initialFeedback,
  onRegenerate,
  onContinue,
}: {
  chatId: string | null;
  messageId: string;
  text: string;
  modelId?: string;
  usage: ChatMessage["usage"];
  initialFeedback: "up" | "down" | null;
  onRegenerate?: () => void;
  onContinue?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(initialFeedback);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  async function submitFeedback(rating: "up" | "down") {
    const next = feedback === rating ? null : rating;
    // Optimistic UI; revert on failure.
    const prev = feedback;
    setFeedback(next);
    if (!chatId || messageId.startsWith("tmp-")) return; // not yet persisted
    if (next === null) return; // current API doesn't support clearing — leave the local toggle visual only
    setFeedbackBusy(true);
    try {
      const res = await authedFetch(
        `/api/chats/${chatId}/messages/${messageId}/feedback`,
        {
          method: "POST",
          body: JSON.stringify({ rating: next }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setFeedback(prev);
      toast.error(`Couldn't save feedback: ${(e as Error).message}`);
    } finally {
      setFeedbackBusy(false);
    }
  }

  return (
    <div
      className="mt-2 flex items-center gap-0.5 transition-opacity opacity-50 group-hover/message:opacity-100"
      style={{ color: "rgb(var(--color-fg-muted))" }}
    >
      <Tooltip label={copied ? "Copied" : "Copy"}>
        <button onClick={copy} className="btn btn-ghost h-7 w-7 p-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </Tooltip>
      <Tooltip label="Helpful">
        <button
          onClick={() => void submitFeedback("up")}
          disabled={feedbackBusy}
          className={cn("btn btn-ghost h-7 w-7 p-0", feedback === "up" && "text-[rgb(var(--color-success))]")}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Not helpful">
        <button
          onClick={() => void submitFeedback("down")}
          disabled={feedbackBusy}
          className={cn("btn btn-ghost h-7 w-7 p-0", feedback === "down" && "text-[rgb(var(--color-danger))]")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      {onRegenerate && (
        <Tooltip label="Regenerate">
          <button onClick={onRegenerate} className="btn btn-ghost h-7 w-7 p-0">
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}
      {onContinue && (
        <Tooltip label="Continue (output was truncated)">
          <button
            onClick={onContinue}
            className="btn btn-ghost h-7 px-2 text-[11px] inline-flex items-center gap-1"
            style={{ color: "rgb(var(--color-accent))" }}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Continue
          </button>
        </Tooltip>
      )}
      <span className="ml-auto text-[10.5px] tabular-nums">
        {usage && `${formatTokens(usage.totalTokens)} tokens`}
        {usage && modelId && " · "}
      </span>
    </div>
  );
}
