import type { ArtifactType } from "@/lib/types";

/**
 * Streaming parser for the ::artifact{}:: directive (SRS §7.4).
 *
 * Feeds a fragment of streamed text in, returns a list of events:
 *  - { type: "text", text } — append to chat body
 *  - { type: "artifact-open", id, artifactType, title, language } — show artifact card
 *  - { type: "artifact-chunk", id, text } — stream into artifact body
 *  - { type: "artifact-close", id } — flush
 *
 * The chat-message body retains a placeholder `[[artifact:<id>]]` so the React
 * renderer can replace it with the artifact card without breaking markdown.
 */

export type ParserEvent =
  | { type: "text"; text: string }
  | {
      type: "artifact-open";
      id: string;
      artifactType: ArtifactType;
      title: string;
      language?: string;
    }
  | { type: "artifact-chunk"; id: string; text: string }
  | { type: "artifact-close"; id: string };

interface ParserState {
  mode: "text" | "in-artifact";
  buffer: string;
  currentId: string | null;
  // Track artifact ids we've seen so duplicates from the model don't double-flush.
  seenIds: Set<string>;
}

export function createArtifactParser() {
  const state: ParserState = {
    mode: "text",
    buffer: "",
    currentId: null,
    seenIds: new Set(),
  };

  function feed(chunk: string): ParserEvent[] {
    state.buffer += chunk;
    const events: ParserEvent[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (state.mode === "text") {
        // Look for "::artifact{". We need to keep enough buffered to detect the open
        // marker even when it spans chunk boundaries.
        const open = state.buffer.indexOf("::artifact{");
        if (open === -1) {
          // Emit everything except the last 20 chars (could be a partial "::artifact").
          if (state.buffer.length > 20) {
            const safeEnd = state.buffer.length - 20;
            const text = state.buffer.slice(0, safeEnd);
            if (text) events.push({ type: "text", text });
            state.buffer = state.buffer.slice(safeEnd);
          }
          break;
        }
        // Emit text before the open marker.
        if (open > 0) {
          events.push({ type: "text", text: state.buffer.slice(0, open) });
        }
        state.buffer = state.buffer.slice(open);

        // Find the closing `}` that matches our `::artifact{`, scanning past quoted strings
        // (so `}` inside attribute values doesn't trip us up — audit P1-1).
        const closeBrace = findMatchingClose(state.buffer);
        if (closeBrace === -1) {
          // Wait for more data.
          break;
        }
        const headerEnd = state.buffer.indexOf("\n", closeBrace);
        if (headerEnd === -1) break;

        const header = state.buffer.slice(0, headerEnd);
        state.buffer = state.buffer.slice(headerEnd + 1);

        const attrs = parseHeaderAttrs(header);
        const id = attrs.id || `art-${Math.random().toString(36).slice(2, 8)}`;
        const type = (attrs.type as ArtifactType) || "code";
        const title = attrs.title || titleFromType(type);
        const language = attrs.language;

        // Emit a placeholder for the chat body so markdown rendering preserves position.
        events.push({ type: "text", text: `\n\n[[artifact:${id}]]\n\n` });

        if (!state.seenIds.has(id)) {
          state.seenIds.add(id);
        }
        events.push({
          type: "artifact-open",
          id,
          artifactType: type,
          title,
          language,
        });
        state.mode = "in-artifact";
        state.currentId = id;
      } else {
        // In artifact mode — emit body chunks until we see a "\n::" that's the actual
        // close marker (audit P1-3: don't false-trigger on `::before`, `::after`, etc.).
        // The valid close marker is `\n::` followed by EOL or end-of-buffer.
        const closeIdx = findArtifactClose(state.buffer);
        if (closeIdx === -1) {
          // Stream everything except a trailing partial close marker.
          // Be conservative — keep last 4 chars buffered (max length of `\n::\n`).
          if (state.buffer.length > 4) {
            const safeEnd = state.buffer.length - 4;
            const text = state.buffer.slice(0, safeEnd);
            if (text && state.currentId) {
              events.push({ type: "artifact-chunk", id: state.currentId, text });
            }
            state.buffer = state.buffer.slice(safeEnd);
          }
          break;
        }
        const bodyText = state.buffer.slice(0, closeIdx);
        if (bodyText && state.currentId) {
          events.push({ type: "artifact-chunk", id: state.currentId, text: bodyText });
        }
        let consumed = closeIdx + 3; // "\n::"
        if (state.buffer[consumed] === "\n") consumed++;
        state.buffer = state.buffer.slice(consumed);
        if (state.currentId) events.push({ type: "artifact-close", id: state.currentId });
        state.mode = "text";
        state.currentId = null;
      }
    }

    return events;
  }

  function flush(): ParserEvent[] {
    const events: ParserEvent[] = [];
    if (state.mode === "in-artifact" && state.currentId) {
      // Model didn't close the artifact — flush whatever we have.
      if (state.buffer) {
        events.push({ type: "artifact-chunk", id: state.currentId, text: state.buffer });
      }
      events.push({ type: "artifact-close", id: state.currentId });
      state.buffer = "";
      state.currentId = null;
      state.mode = "text";
    } else if (state.buffer) {
      events.push({ type: "text", text: state.buffer });
      state.buffer = "";
    }
    return events;
  }

  return { feed, flush };
}

function parseHeaderAttrs(header: string): Record<string, string> {
  // header like: ::artifact{id="x" type="react" title="Foo" language="ts"}
  // Extract the body between the matching braces using brace-aware scanning so attribute values
  // containing `}` (e.g. title="fn() { ... }") parse correctly.
  const open = header.indexOf("{");
  if (open < 0) return {};
  const close = findMatchingClose(header.slice(open)) + open;
  if (close <= open) return {};
  const body = header.slice(open + 1, close);
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return out;
}

/**
 * Given a buffer that starts with `::artifact{`, find the index of the matching closing brace.
 * Skips `}` inside double-quoted attribute values.
 */
function findMatchingClose(buf: string): number {
  const start = buf.indexOf("{");
  if (start < 0) return -1;
  let i = start + 1;
  let inQuote = false;
  while (i < buf.length) {
    const c = buf[i];
    if (!inQuote) {
      if (c === '"') inQuote = true;
      else if (c === "}") return i;
    } else {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') inQuote = false;
    }
    i++;
  }
  return -1;
}

/**
 * Find a valid `\n::` artifact close marker in the buffer.
 * A valid close is `\n::` followed by `\n`, `\r\n`, or end-of-buffer.
 * Returns the index of the leading `\n`, or -1 if no valid close exists yet.
 */
function findArtifactClose(buf: string): number {
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const idx = buf.indexOf("\n::", from);
    if (idx === -1) return -1;
    const after = idx + 3;
    if (after === buf.length) return idx; // exactly `\n::` at end-of-buffer — valid (need more data to confirm trailing newline, but it's ok)
    const next = buf[after];
    if (next === "\n" || next === "\r" || next === undefined) return idx;
    // false match — the content after `::` is more characters (e.g. `::before`, `::class`). Move past it.
    from = idx + 1;
  }
}

function titleFromType(type: ArtifactType): string {
  switch (type) {
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
