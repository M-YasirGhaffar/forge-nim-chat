"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square, X, Image as ImageIcon, FileText, Film, Loader2, Lock } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { ModelPicker } from "./model-picker";
import { ContextMeter } from "./context-meter";
import { getModel } from "@/lib/models/registry";
import type { ThinkingMode, AttachmentRef } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  modelId: string;
  setModelId: (id: string) => void;
  modelLocked?: boolean;
  thinkingMode: ThinkingMode;
  setThinkingMode: (m: ThinkingMode) => void;
  isStreaming: boolean;
  contextUsed: number;
  attachments: AttachmentRef[];
  onAddAttachments: (files: File[]) => Promise<void>;
  onRemoveAttachment: (storagePath: string) => void;
  onSubmit: (text: string) => Promise<void>;
  onAbort: () => void;
  autoFocus?: boolean;
  imageMode?: {
    referenceStoragePath?: string;
    onClearReference: () => void;
    aspectRatio: string;
    setAspectRatio: (s: string) => void;
    steps: number;
    setSteps: (n: number) => void;
  };
}

export function Composer(props: Props) {
  const {
    modelId,
    setModelId,
    modelLocked,
    thinkingMode,
    setThinkingMode,
    isStreaming,
    contextUsed,
    attachments,
    onAddAttachments,
    onRemoveAttachment,
    onSubmit,
    onAbort,
    autoFocus,
    imageMode,
  } = props;

  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const model = getModel(modelId)!;
  const isImage = model.category === "image";
  const supportsImages = model.supportsImages;
  const supportsVideo = model.supportsVideo;
  const accept = isImage
    ? "image/*"
    : [supportsImages && "image/*", supportsVideo && "video/mp4", "application/pdf"]
        .filter(Boolean)
        .join(",");

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
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

  return (
    <div className="px-4 pb-4 pt-2 max-w-3xl w-full mx-auto">
      {(attachments.length > 0 || imageMode?.referenceStoragePath) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {imageMode?.referenceStoragePath && (
            <AttachmentChip
              icon={<ImageIcon className="h-3 w-3" />}
              label="reference image"
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
          style={{ minHeight: "52px" }}
          disabled={isStreaming}
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

          {/* Center zone: model + thinking */}
          <ModelPicker
            modelId={modelId}
            onChange={setModelId}
            size="sm"
            disabled={modelLocked}
            disabledReason="Model is locked for this chat. Start a new chat to switch."
            side="top"
          />
          {modelLocked && (
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
              modelId={modelId}
            />
          )}

          <div className="flex-1" />

          {/* Right zone: meter + submit */}
          {!isImage && model.contextWindow > 0 && contextUsed > 0 && (
            <ContextMeter modelId={modelId} used={contextUsed} />
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
              disabled={isStreaming || (!value.trim() && attachments.length === 0)}
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
}: {
  icon: React.ReactNode;
  label: string;
  onRemove?: () => void;
}) {
  return (
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
}

function ImageOptions({
  aspectRatio,
  setAspectRatio,
  steps,
  setSteps,
  modelId,
}: {
  aspectRatio: string;
  setAspectRatio: (s: string) => void;
  steps: number;
  setSteps: (n: number) => void;
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
    </div>
  );
}
