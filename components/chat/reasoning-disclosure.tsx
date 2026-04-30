"use client";

import { useState } from "react";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  durationMs?: number;
  isStreaming?: boolean;
  defaultOpen?: boolean;
}

export function ReasoningDisclosure({ text, durationMs, isStreaming, defaultOpen }: Props) {
  const [open, setOpen] = useState(Boolean(defaultOpen ?? isStreaming));
  const seconds = durationMs ? (durationMs / 1000).toFixed(1) : null;
  const truncated = text.length > 50_000;
  const display = truncated ? text.slice(text.length - 50_000) : text;

  return (
    <div className="my-2 border-l-2 border-[rgb(var(--color-border-strong))] pl-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] font-medium hover:text-[rgb(var(--color-fg))] transition-colors"
        style={{ color: "rgb(var(--color-fg-muted))" }}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        <Brain className="h-3.5 w-3.5" />
        {isStreaming
          ? "Thinking…"
          : seconds
            ? `Thought for ${seconds}s`
            : "Thinking trace"}
        <span className="ml-1 text-[10px] uppercase tracking-wider" style={{ color: "rgb(var(--color-fg-subtle))" }}>
          {(text.length / 1000).toFixed(1)}K chars
        </span>
      </button>
      {open && (
        <div
          className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.6] font-mono p-3 rounded-md bg-[rgb(var(--color-bg-soft))]"
          style={{ color: "rgb(var(--color-fg-muted))", maxHeight: "32rem", overflow: "auto" }}
        >
          {truncated && (
            <div className="mb-2 text-[11px] italic" style={{ color: "rgb(var(--color-fg-subtle))" }}>
              … {(text.length - 50_000).toLocaleString()} chars truncated for display, full trace persisted.
            </div>
          )}
          {display}
          {isStreaming && <span className="blink-cursor" />}
        </div>
      )}
    </div>
  );
}
