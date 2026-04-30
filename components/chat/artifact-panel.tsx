"use client";

import { useState, useMemo } from "react";
import { Copy, Download, ExternalLink, X, Check, Eye, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ArtifactRecord } from "@/lib/types";
import { ArtifactRenderer } from "./artifact-renderer";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

interface Props {
  artifact: ArtifactRecord | null;
  isStreaming?: boolean;
  onClose: () => void;
}

export function ArtifactPanel({ artifact, isStreaming, onClose }: Props) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  const lang = useMemo(() => {
    if (!artifact) return "text";
    if (artifact.language) return artifact.language;
    switch (artifact.type) {
      case "html":
        return "html";
      case "react":
        return "tsx";
      case "svg":
        return "xml";
      case "mermaid":
        return "mermaid";
      case "document":
        return "markdown";
      default:
        return "text";
    }
  }, [artifact]);

  if (!artifact) return null;

  function copy() {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  function download() {
    if (!artifact) return;
    const ext = extForType(artifact.type, lang);
    const blob = new Blob([artifact.body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(artifact.title || artifact.id)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openInNewTab() {
    if (!artifact) return;
    if (artifact.type !== "html" && artifact.type !== "react") return;
    const html = artifact.type === "html" ? artifact.body : artifact.body; // The renderer wraps; here we open raw for HTML.
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const isPreviewable = artifact.type !== "code";

  return (
    <div className="h-full w-full flex flex-col bg-[rgb(var(--color-bg))]">
      <div className="border-b px-3 py-2 flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-[rgb(var(--color-fg-muted))]" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{artifact.title}</div>
          <div className="text-[11px] flex items-center gap-2" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            <span>{artifact.type}{artifact.language ? ` · ${artifact.language}` : ""}</span>
            <span>·</span>
            <span>v{artifact.version}</span>
            {isStreaming && <span className="text-[rgb(var(--color-accent))]">· streaming…</span>}
          </div>
        </div>
        {isPreviewable && (
          <div className="inline-flex rounded-md border bg-[rgb(var(--color-bg-soft))] p-0.5">
            <button
              onClick={() => setTab("preview")}
              className={cn(
                "h-7 px-2.5 text-[11px] rounded",
                tab === "preview" ? "bg-[rgb(var(--color-bg-elev))] border" : "text-[rgb(var(--color-fg-muted))]"
              )}
            >
              <Eye className="h-3 w-3 inline mr-1" />
              Preview
            </button>
            <button
              onClick={() => setTab("code")}
              className={cn(
                "h-7 px-2.5 text-[11px] rounded",
                tab === "code" ? "bg-[rgb(var(--color-bg-elev))] border" : "text-[rgb(var(--color-fg-muted))]"
              )}
            >
              <FileCode2 className="h-3 w-3 inline mr-1" />
              Code
            </button>
          </div>
        )}
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <Button variant="ghost" size="icon" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </Tooltip>
        <Tooltip label="Download">
          <Button variant="ghost" size="icon" onClick={download}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        {(artifact.type === "html") && (
          <Tooltip label="Open in new tab">
            <Button variant="ghost" size="icon" onClick={openInNewTab}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Close">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex-1 min-h-0 relative">
        {tab === "preview" || !isPreviewable ? (
          <ArtifactRenderer artifact={artifact} />
        ) : (
          <CodePreview body={artifact.body} language={lang} />
        )}
      </div>
    </div>
  );
}

function CodePreview({ body, language }: { body: string; language: string }) {
  // Use Markdown's CodeBlock for highlighting via rehype-highlight.
  const fenced = "```" + language + "\n" + body + "\n```";
  return (
    <div className="h-full overflow-auto bg-[rgb(var(--color-bg-elev))] p-4">
      <Markdown content={fenced} />
    </div>
  );
}

function extForType(type: ArtifactRecord["type"], lang: string): string {
  if (type === "html") return "html";
  if (type === "svg") return "svg";
  if (type === "mermaid") return "mmd";
  if (type === "document") return "md";
  if (type === "react") return "tsx";
  switch (lang.toLowerCase()) {
    case "typescript":
    case "ts":
      return "ts";
    case "javascript":
    case "js":
      return "js";
    case "python":
    case "py":
      return "py";
    case "go":
      return "go";
    case "rust":
    case "rs":
      return "rs";
    case "bash":
    case "sh":
      return "sh";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "html":
      return "html";
    case "css":
      return "css";
    case "sql":
      return "sql";
    default:
      return "txt";
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact"
  );
}
