"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { memo, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

import "highlight.js/styles/github-dark.css";

interface MarkdownProps {
  content: string;
  className?: string;
  // Optional render function for [[artifact:id]] placeholders.
  renderArtifactRef?: (id: string) => React.ReactNode;
}

// Heavy parser — wrap the inner ReactMarkdown render so identical text segments
// don't re-tokenize on every parent re-render during streaming.
const MarkdownSegment = memo(function MarkdownSegment({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        pre({ children, ...rest }) {
          return <CodeBlock {...rest}>{children}</CodeBlock>;
        },
        a({ href, children, ...rest }) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
              {children}
            </a>
          );
        },
        img({ alt, src, ...rest }) {
          if (!src || typeof src !== "string") return null;
          // eslint-disable-next-line @next/next/no-img-element
          return <img alt={alt} src={src} {...rest} className="rounded-lg max-h-[480px] my-2" />;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

export function Markdown({ content, className, renderArtifactRef }: MarkdownProps) {
  // Split the content on [[artifact:id]] tokens so artifact cards render inline.
  const segments = splitArtifactRefs(content);

  return (
    <div className={cn("prose-chat", className)}>
      {segments.map((seg, i) => {
        if (seg.kind === "ref") {
          return (
            <div key={`a-${i}-${seg.id}`} className="my-2">
              {renderArtifactRef ? renderArtifactRef(seg.id) : <em>[artifact: {seg.id}]</em>}
            </div>
          );
        }
        return <MarkdownSegment key={`m-${i}`} text={seg.text} />;
      })}
    </div>
  );
}

function splitArtifactRefs(text: string): Array<{ kind: "text"; text: string } | { kind: "ref"; id: string }> {
  const out: Array<{ kind: "text"; text: string } | { kind: "ref"; id: string }> = [];
  const re = /\[\[artifact:([^\]]+)\]\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) out.push({ kind: "text", text: text.slice(lastIdx, m.index) });
    out.push({ kind: "ref", id: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push({ kind: "text", text: text.slice(lastIdx) });
  if (out.length === 0) out.push({ kind: "text", text });
  return out;
}

function CodeBlock(props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  function copy() {
    const text = ref.current?.innerText || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => setCopied(true));
  }

  return (
    <div className="relative group">
      <pre ref={ref} {...props} className={cn("not-prose")} />
      <button
        type="button"
        onClick={copy}
        // Task 48: keep the copy button reachable on touch devices where there is
        // no hover. We default to a low opacity that becomes full on hover/focus
        // (pointer:fine media query targets desktop only).
        className="absolute top-2 right-2 opacity-50 [@media(pointer:fine)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity btn btn-secondary h-7 px-2 text-[11px]"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
