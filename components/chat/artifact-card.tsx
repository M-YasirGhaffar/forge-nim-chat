"use client";

import { FileCode2, FileText, Image as ImageIcon, GitBranch, Code as CodeIcon, FileType, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactType } from "@/lib/types";

interface Props {
  id: string;
  type: ArtifactType;
  title: string;
  language?: string;
  isStreaming?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  bodyLength?: number;
}

export function ArtifactCard({ id, type, title, language, isStreaming, isSelected, onClick, bodyLength }: Props) {
  const Icon = iconForType(type);
  return (
    <button
      type="button"
      onClick={onClick}
      data-artifact-id={id}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border bg-[rgb(var(--color-bg-elev))] p-3 text-left transition-colors",
        "hover:border-[rgb(var(--color-border-strong))] hover:bg-[rgb(var(--color-bg-soft))]",
        isSelected && "border-[rgb(var(--color-accent))] ring-2 ring-[rgb(var(--color-accent)/0.18)]"
      )}
    >
      <div className="h-9 w-9 shrink-0 rounded-lg bg-[rgb(var(--color-bg-soft))] border flex items-center justify-center">
        {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate flex items-center gap-2">
          {title}
          {language && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgb(var(--color-bg-soft))]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
              {language}
            </span>
          )}
        </div>
        <div className="text-xs flex items-center gap-2" style={{ color: "rgb(var(--color-fg-muted))" }}>
          <span>{labelForType(type)}</span>
          {bodyLength != null && bodyLength > 0 && <span>· {Math.max(1, Math.ceil(bodyLength / 80))} lines</span>}
          {isStreaming && <span>· streaming…</span>}
        </div>
      </div>
      <ExternalLink className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function iconForType(t: ArtifactType) {
  switch (t) {
    case "react":
      return FileCode2;
    case "html":
      return FileType;
    case "svg":
      return ImageIcon;
    case "mermaid":
      return GitBranch;
    case "code":
      return CodeIcon;
    case "document":
      return FileText;
  }
}

function labelForType(t: ArtifactType): string {
  switch (t) {
    case "react":
      return "React component";
    case "html":
      return "HTML page";
    case "svg":
      return "SVG illustration";
    case "mermaid":
      return "Mermaid diagram";
    case "code":
      return "Code";
    case "document":
      return "Document";
  }
}
