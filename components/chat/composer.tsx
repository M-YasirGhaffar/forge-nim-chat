"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Plus,
  Square,
  X,
  Image as ImageIcon,
  FileText,
  Film,
  Loader2,
  Lock,
  RotateCcw,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { ModelPicker } from "./model-picker";
import { ContextMeter } from "./context-meter";
import { getModel } from "@/lib/models/registry";
import type { ThinkingMode, AttachmentRef } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * The active chat id (or null for a brand-new /chat). Used as a localStorage key so
   * draft text survives a refresh — ChatGPT-style.
   */
  chatId: string | null;
  modelId: string;
  setModelId: (id: string) => void;
  modelLocked?: boolean;
  thinkingMode: ThinkingMode;
  setThinkingMode: (m: ThinkingMode) => void;
  isStreaming: boolean;
  contextUsed: number;
  /**
   * Optional rough live token estimate (e.g. in-flight stream chars / 4) added to the
   * context meter while a response is streaming. Wired by chat-shell.
   */
  contextLiveDelta?: number;
  attachments: AttachmentRef[];
  onAddAttachments: (files: File[]) => Promise<void>;
  onRemoveAttachment: (storagePath: string) => void;
  onSubmit: (text: string) => Promise<void>;
  onAbort: () => void;
  autoFocus?: boolean;
  /**
   * Called when the user requests a model switch from a locked chat. Parent should open
   * the SwitchModelDialog (which routes the user into a new chat).
   */
  onRequestSwitch?: () => void;
  imageMode?: {
    referenceStoragePath?: string;
    referencePreviewUrl?: string;
    onClearReference: () => void;
    aspectRatio: string;
    setAspectRatio: (s: string) => void;
    steps: number;
    setSteps: (n: number) => void;
    seed?: number;
    /** Optional. When wired by the parent, the user can pin a deterministic FLUX seed. */
    setSeed?: (n?: number) => void;
  };
}

const DRAFT_PREFIX = "polyglot:draft:";

function draftKey(chatId: string | null): string {
  return DRAFT_PREFIX + (chatId || "new");
}

export function Composer(props: Props) {
  const {
    chatId,
    modelId,
    setModelId,
    modelLocked,
    thinkingMode,
    setThinkingMode,
    isStreaming,
    contextUsed,
    contextLiveDelta,
    attachments,
    onAddAttachments,
    onRemoveAttachment,
    onSubmit,
    onAbort,
    autoFocus,
    onRequestSwitch,
    imageMode,
  } = props;

  // Draft persistence: hydrate from the per-chat key on mount/chatId change, and write
  // back on every keystroke (debounce-free — localStorage writes are cheap and we want
  // refresh recovery to feel ChatGPT-snappy).
  const [value, setValue] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(draftKey(chatId)) || "";
    } catch {
      return "";
    }
  });
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // Re-hydrate when the chatId changes (e.g. user clicks a different chat in the sidebar).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftKey(chatId)) || "";
      setValue(stored);
    } catch {
      // ignore
    }
  }, [chatId]);

  // Persist on change — keyed per chat.
  useEffect(() => {
    try {
      const k = draftKey(chatId);
      if (value) window.localStorage.setItem(k, value);
      else window.localStorage.removeItem(k);
    } catch {
      // ignore quota
    }
  }, [value, chatId]);

  const model = getModel(modelId)!;
  const isImage = model.category === "image";
  const supportsImages = model.supportsImages;
  const supportsVideo = model.supportsVideo;
  const accept = isImage
    ? "image/*"
    : [supportsImages && "image/*", supportsVideo && "video/mp4", "application/pdf"]
        .filter(Boolean)
        .join(",");

  // Auto-resize textarea: avoid jank on every keystroke. Only mutate height when it would
  // actually move by > 2px so the caret doesn't jump on long pastes.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 320);
    if (Math.abs(el.clientHeight - next) > 2) el.style.height = `${next}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Listen for global "fill composer" events (used by suggestion cards on empty state).
  useEffect(() => {
    function onFill(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === "string") {
        setValue(text);
        requestAnimationFrame(() => taRef.current?.focus());
      }
    }
    window.addEventListener("polyglot:fill-composer", onFill);
    return () => window.removeEventListener("polyglot:fill-composer", onFill);
  }, []);

  // Cmd/Ctrl + K → open the model picker. No-op while in image mode or while the chat is
  // locked (the picker can't be opened in either case).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "k") return;
      if (isImage || modelLocked) return;
      e.preventDefault();
      taRef.current?.blur();
      pickerTriggerRef.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isImage, modelLocked]);

  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await onAddAttachments(Array.from(files));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSubmit() {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    if (isStreaming) return;
    // Clear the persisted draft alongside the in-memory state — refresh-after-submit
    // shouldn't restore a message the user already sent.
    try {
      window.localStorage.removeItem(draftKey(chatId));
    } catch {
      // ignore
    }
    setValue("");
    await onSubmit(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!supportsImages && !isImage) return;
    const items = Array.from(e.clipboardData.items);
    const imgs = items.filter((i) => i.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    const files = imgs.map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (files.length > 0) void pickFiles({ length: files.length, item: (i: number) => files[i] } as unknown as FileList);
  }

  const taOverflow = (taRef.current?.scrollHeight ?? 0) > 320 ? "auto" : "hidden";

  return (
    <div className="px-4 pb-4 pt-2 max-w-3xl w-full mx-auto">
      {(attachments.length > 0 || imageMode?.referenceStoragePath) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {imageMode?.referenceStoragePath && (
            <AttachmentChip
              icon={<ImageIcon className="h-3 w-3" />}
              label="reference image"
              previewUrl={imageMode.referencePreviewUrl}
              onRemove={imageMode.onClearReference}
            />
          )}
          {attachments.map((a) => (
            <AttachmentChip
              key={a.storagePath}
              icon={
                a.type === "image" ? (
                  <ImageIcon className="h-3 w-3" />
                ) : a.type === "video" ? (
                  <Film className="h-3 w-3" />
                ) : (
                  <FileText className="h-3 w-3" />
                )
              }
              label={a.fileName}
              previewUrl={a.type === "image" ? a.downloadUrl : undefined}
              onRemove={() => onRemoveAttachment(a.storagePath)}
            />
          ))}
          {uploading && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--color-fg-muted))" }}>
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "rounded-3xl border bg-[rgb(var(--color-bg-elev))] shadow-md",
          "focus-within:border-[rgb(var(--color-border-strong))] transition-shadow",
          "hover:shadow-lg"
        )}
      >
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            isImage
              ? "Describe the image you want to generate…"
              : "How can I help you today?"
          }
          className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[16px] leading-6 outline-none placeholder:text-[rgb(var(--color-fg-subtle))] max-h-80"
          style={{ minHeight: "52px", overflowY: taOverflow }}
        />

        <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1 flex-wrap">
          {/* Left zone: attach */}
          <Tooltip label={isImage ? "Add reference image" : "Attach files"}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "btn btn-ghost h-9 w-9 p-0 rounded-full",
                !(supportsImages || supportsVideo || isImage) && "opacity-30 pointer-events-none"
              )}
              disabled={isStreaming || uploading || !(supportsImages || supportsVideo || isImage)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </Tooltip>
          <input
            type="file"
            ref={fileRef}
            multiple={!isImage}
            accept={accept}
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />

          {/* Center zone: model + thinking. Always show all categories so users can switch
              between text and image models in a fresh chat without hunting for a hidden picker. */}
          <ModelPicker
            modelId={modelId}
            onChange={setModelId}
            size="sm"
            filter="all"
            disabled={modelLocked}
            disabledReason="Model is locked for this chat. Start a new chat to switch."
            side="top"
            onRequestSwitch={onRequestSwitch}
            triggerRef={pickerTriggerRef}
          />
          {modelLocked && onRequestSwitch && (
            <button
              type="button"
              onClick={onRequestSwitch}
              className="pill text-[10px] py-0 hover:bg-[rgb(var(--color-bg-soft))]"
              title="Start a new chat with a different model"
              style={{ color: "rgb(var(--color-fg-muted))" }}
            >
              <Lock className="h-2.5 w-2.5" /> Switch (new chat)
            </button>
          )}
          {modelLocked && !onRequestSwitch && (
            <span
              className="pill text-[10px] py-0"
              title="Model is locked for this chat. Start a new chat to switch."
              style={{ color: "rgb(var(--color-fg-muted))" }}
            >
              <Lock className="h-2.5 w-2.5" /> locked
            </span>
          )}
          {!isImage && model.thinkingModes.length > 1 && (
            <ThinkingControl
              modes={model.thinkingModes}
              value={thinkingMode}
              onChange={setThinkingMode}
            />
          )}

          {isImage && imageMode && (
            <ImageOptions
              aspectRatio={imageMode.aspectRatio}
              setAspectRatio={imageMode.setAspectRatio}
              steps={imageMode.steps}
              setSteps={imageMode.setSteps}
              seed={imageMode.seed}
              setSeed={imageMode.setSeed}
              modelId={modelId}
            />
          )}

          <div className="flex-1" />

          {/* Right zone: meter + submit */}
          {!isImage && model.contextWindow > 0 && contextUsed > 0 && (
            <ContextMeter
              modelId={modelId}
              used={contextUsed}
              liveDelta={isStreaming ? contextLiveDelta : undefined}
            />
          )}

          {isStreaming ? (
            <button
              type="button"
              onClick={onAbort}
              className="btn btn-secondary h-9 w-9 p-0 rounded-full"
              title="Stop generation"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isStreaming || uploading || (!value.trim() && attachments.length === 0)}
              className={cn(
                "btn btn-primary h-9 w-9 p-0 rounded-full transition-transform",
                (value.trim() || attachments.length > 0) && "hover:scale-[1.04]"
              )}
              title={isImage ? "Generate" : "Send (↵)"}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 text-center text-[10.5px]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
        Polyglot can make mistakes. Verify important info. NIM trial · non-production use.
      </div>
    </div>
  );
}

function ThinkingControl({
  modes,
  value,
  onChange,
}: {
  modes: ThinkingMode[];
  value: ThinkingMode;
  onChange: (v: ThinkingMode) => void;
}) {
  const opts = [
    { value: "off" as ThinkingMode, label: "Off", hint: "Skip reasoning" },
    { value: "high" as ThinkingMode, label: "Think", hint: "Default reasoning" },
    { value: "max" as ThinkingMode, label: "Max", hint: "Maximum reasoning" },
  ].filter((o) => modes.includes(o.value));

  if (opts.length <= 1) return null;
  return <Segmented<ThinkingMode> size="sm" value={value} onChange={onChange} options={opts} />;
}

function AttachmentChip({
  icon,
  label,
  onRemove,
  previewUrl,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove?: () => void;
  previewUrl?: string;
}) {
  // Tooltip can only render plain text labels, so when we have a preview thumbnail we wrap
  // the chip in a CSS-driven hover preview instead.
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-[rgb(var(--color-bg-soft))] pl-2 pr-1 py-1 text-[11px]">
      {icon}
      <span className="max-w-[160px] truncate">{label}</span>
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  if (previewUrl) {
    return (
      <span className="relative inline-flex group">
        {chip}
        <span
          className={cn(
            "pointer-events-none absolute z-50 bottom-full left-0 mb-1.5",
            "rounded-md border bg-[rgb(var(--color-bg-elev))] p-1.5 shadow-xl",
            "opacity-0 scale-95 transition-all group-hover:opacity-100 group-hover:scale-100"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={label}
            className="block h-24 w-24 object-cover rounded"
          />
          <span
            className="block mt-1 max-w-[10rem] truncate text-[10px]"
            style={{ color: "rgb(var(--color-fg-muted))" }}
          >
            {label}
          </span>
        </span>
      </span>
    );
  }

  return <Tooltip label={label}>{chip}</Tooltip>;
}

function ImageOptions({
  aspectRatio,
  setAspectRatio,
  steps,
  setSteps,
  seed,
  setSeed,
  modelId,
}: {
  aspectRatio: string;
  setAspectRatio: (s: string) => void;
  steps: number;
  setSteps: (n: number) => void;
  seed?: number;
  setSeed?: (n?: number) => void;
  modelId: string;
}) {
  const isSchnell = modelId.includes("schnell");
  const stepRange = isSchnell ? [1, 4] : [10, 50];
  return (
    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "rgb(var(--color-fg-muted))" }}>
      <select
        className="bg-transparent border rounded-md h-7 px-1.5 text-[11px]"
        value={aspectRatio}
        onChange={(e) => setAspectRatio(e.target.value)}
      >
        <option value="1:1">1:1</option>
        <option value="3:2">3:2</option>
        <option value="2:3">2:3</option>
        <option value="16:9">16:9</option>
        <option value="9:16">9:16</option>
        <option value="4:3">4:3</option>
        <option value="3:4">3:4</option>
      </select>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px]">Steps</span>
        <input
          type="range"
          min={stepRange[0]}
          max={stepRange[1]}
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="h-7 w-20"
        />
        <span className="tabular-nums w-5 text-right">{steps}</span>
      </div>
      {setSeed && (
        <div className="flex items-center gap-1">
          <span className="text-[10px]">Seed</span>
          <input
            type="number"
            inputMode="numeric"
            value={seed ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setSeed(undefined);
                return;
              }
              const n = Number(raw);
              setSeed(Number.isFinite(n) ? n : undefined);
            }}
            placeholder="random"
            className="bg-transparent border rounded-md h-7 px-1.5 text-[11px] w-[88px] tabular-nums"
          />
          <Tooltip label="Random seed">
            <button
              type="button"
              onClick={() => setSeed(undefined)}
              disabled={seed === undefined}
              className="btn btn-ghost h-7 w-7 p-0 rounded-md disabled:opacity-30"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
