"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactRecord } from "@/lib/types";

interface Props {
  artifact: ArtifactRecord;
}

export function ArtifactRenderer({ artifact }: Props) {
  if (artifact.type === "html") return <HTMLArtifact body={artifact.body} />;
  if (artifact.type === "react") return <ReactArtifact body={artifact.body} />;
  if (artifact.type === "svg") return <SVGArtifact body={artifact.body} />;
  if (artifact.type === "mermaid") return <MermaidArtifact body={artifact.body} />;
  if (artifact.type === "code") return <CodeArtifact body={artifact.body} language={artifact.language ?? "text"} />;
  return <DocumentArtifact body={artifact.body} />;
}

function HTMLArtifact({ body }: { body: string }) {
  const html = body.trim().toLowerCase().startsWith("<!doctype")
    ? body
    : `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script><style>html,body{margin:0;padding:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}</style></head><body>${body}</body></html>`;

  return (
    <iframe
      title="HTML artifact"
      srcDoc={html}
      sandbox="allow-scripts allow-popups allow-modals allow-forms"
      className="h-full w-full bg-white"
    />
  );
}

function ReactArtifact({ body }: { body: string }) {
  const html = useMemo(() => buildReactPreviewHTML(body), [body]);
  return (
    <iframe
      title="React artifact"
      srcDoc={html}
      sandbox="allow-scripts allow-popups allow-modals allow-forms"
      className="h-full w-full bg-white"
    />
  );
}

function buildReactPreviewHTML(body: string): string {
  const escaped = body.replace(/<\/script>/g, "<\\/script>");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>React preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.min.js"></script>
  <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.25.0/babel.min.js"></script>
  <script src="https://unpkg.com/lodash@4.17.21/lodash.min.js"></script>
  <script src="https://unpkg.com/framer-motion@10.17.0/dist/framer-motion.js"></script>
  <script src="https://unpkg.com/d3@7.9.0/dist/d3.min.js"></script>
  <script src="https://unpkg.com/mathjs@13.0.0/lib/browser/math.js"></script>
  <script src="https://unpkg.com/papaparse@5.4.1/papaparse.min.js"></script>
  <style>
    html, body, #root { height: 100%; margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    #__error { position: fixed; inset: 0; padding: 2rem; font-family: ui-monospace, monospace; color: #b00; background: #fff; white-space: pre-wrap; overflow:auto; display:none; }
  </style>
</head>
<body>
  <div id="root"></div>
  <pre id="__error"></pre>
  <script type="text/babel" data-presets="react,env" data-type="module">
  (() => {
    try {
      const { useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, createContext, Fragment } = React;
      // lucide-react shim — accept any icon name and return an inline SVG via the bundled umd.
      const lucideReact = new Proxy({}, {
        get: (_, name) => {
          if (name === '__esModule' || typeof name === 'symbol') return undefined;
          const key = String(name).replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : '-' + c.toLowerCase()));
          return function LucideIcon(props) {
            const ref = React.useRef(null);
            React.useEffect(() => {
              if (!ref.current) return;
              const node = window.lucide && window.lucide.icons && window.lucide.icons[key];
              if (node && node[2]) {
                ref.current.innerHTML = '';
                const svgNs = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNs, 'svg');
                svg.setAttribute('xmlns', svgNs);
                svg.setAttribute('width', String(props.size || 24));
                svg.setAttribute('height', String(props.size || 24));
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', String(props.strokeWidth || 2));
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                if (props.className) svg.setAttribute('class', props.className);
                node[2].forEach(([tag, attrs]) => {
                  const el = document.createElementNS(svgNs, tag);
                  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                  svg.appendChild(el);
                });
                ref.current.appendChild(svg);
              }
            }, [props.size, props.strokeWidth]);
            return React.createElement('span', {
              ref,
              className: props.className,
              style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', ...(props.style || {}) },
            });
          };
        }
      });

      // Make commonly-imported names available as bare globals (so 'import' isn't required).
      window.LucideReact = lucideReact;
      const Recharts = window.Recharts || {};
      const _ = window._ || {};
      const fm = window.framerMotion || window.Motion || {};
      const motion = fm.motion || {};
      const AnimatePresence = fm.AnimatePresence || (({children}) => children);
      const d3 = window.d3 || {};
      const math = window.math || {};
      const Papa = window.Papa || {};

      // Run the user code (CommonJS-ish).
      const moduleExports = {};
      const moduleObj = { exports: moduleExports };

      ${escaped}

      // Resolve the component: prefer default export (set by babel transform of export default),
      // else look for any function/class declaration named like a component.
      let Component = moduleObj.exports.default || moduleExports.default;
      if (!Component) {
        // Babel without modules will leave the export inline; try common identifier patterns.
        for (const name of Object.keys(window)) {
          if (typeof window[name] === 'function' && /^[A-Z]/.test(name) && !['React','ReactDOM'].includes(name)) {
            Component = window[name];
            break;
          }
        }
      }
      if (!Component) {
        throw new Error("No default-exported component found. Make sure your artifact starts with: export default function YourComponent");
      }
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(Component));
    } catch (e) {
      const el = document.getElementById('__error');
      el.style.display = 'block';
      el.textContent = (e && e.stack) ? e.stack : String(e);
      console.error(e);
    }
  })();
  </script>
</body>
</html>`;
}

function SVGArtifact({ body }: { body: string }) {
  // Sanitize via DOMParser — strip <script> tags and on* event attributes.
  const sanitized = useMemo(() => sanitizeSvg(body), [body]);
  return (
    <div className="h-full w-full grid place-items-center bg-white p-4 overflow-auto">
      <div className="max-w-full" dangerouslySetInnerHTML={{ __html: sanitized }} />
    </div>
  );
}

function sanitizeSvg(body: string): string {
  if (typeof window === "undefined") return body;
  const parser = new DOMParser();
  const doc = parser.parseFromString(body, "image/svg+xml");
  if (!doc.documentElement || doc.documentElement.tagName.toLowerCase() !== "svg") return body;
  doc.querySelectorAll("script").forEach((s) => s.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (attr.name === "href" && /^javascript:/i.test(attr.value)) el.removeAttribute("href");
    }
  });
  return new XMLSerializer().serializeToString(doc);
}

function MermaidArtifact({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      });
      const id = `mmd-${Math.random().toString(36).slice(2)}`;
      try {
        const { svg } = await mermaid.render(id, body);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [body]);
  return (
    <div className="h-full w-full overflow-auto bg-white p-6 grid place-items-center">
      {error ? (
        <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
      ) : (
        <div ref={ref} className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto" />
      )}
    </div>
  );
}

function CodeArtifact({ body, language }: { body: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const h = await codeToHtml(body, {
          lang: normalizeLang(language),
          theme: "github-dark",
        });
        if (!cancelled) setHtml(h);
      } catch {
        if (!cancelled) setHtml(`<pre>${escapeHtml(body)}</pre>`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [body, language]);
  return (
    <div
      className="h-full w-full overflow-auto bg-[#0d1117] [&_pre]:p-5 [&_pre]:m-0 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-[1.55]"
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}

function DocumentArtifact({ body }: { body: string }) {
  // Lazy-load Markdown to keep iframe-free preview lightweight.
  const [Markdown, setMd] = useState<typeof import("./markdown").Markdown | null>(null);
  useEffect(() => {
    void import("./markdown").then((mod) => setMd(() => mod.Markdown));
  }, []);
  return (
    <div className="h-full w-full overflow-auto bg-[rgb(var(--color-bg-elev))] p-8">
      <div className="mx-auto max-w-3xl prose-chat">
        {Markdown ? <Markdown content={body} /> : <pre className="whitespace-pre-wrap">{body}</pre>}
      </div>
    </div>
  );
}

const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  yml: "yaml",
};

function normalizeLang(l: string): string {
  return LANG_ALIAS[l.toLowerCase()] || l.toLowerCase() || "text";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
