/**
 * Newline-delimited JSON streaming protocol used between /api/chat and the chat UI.
 *
 * One JSON object per line. We use NDJSON instead of SSE because the artifact parser
 * needs to emit several event types (text, reasoning, artifact-open/delta/close, usage,
 * finish, meta) and NDJSON is friendlier than re-encoding events into SSE format.
 */

import type { ArtifactType } from "@/lib/types";

export type StreamStatus =
  | "connecting" // request sent, awaiting first response
  | "queued" // upstream returned 429 / pool full, waiting
  | "streaming" // first byte received, tokens flowing
  | "slow" // > N seconds elapsed without finish
  | "rate_limited" // local app-level limiter
  | "fallback" // model unavailable, switched to a sibling
  | "retry"; // transient error, retrying

export type StreamEvent =
  | { type: "meta"; chatId: string; userMessageId: string; assistantMessageId: string; modelId: string; trimmed?: number; strippedAttachments?: boolean }
  | { type: "status"; status: StreamStatus; modelId?: string; message?: string; retryAfter?: number; elapsedMs?: number }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "artifact-open"; id: string; artifactType: ArtifactType; title: string; language?: string }
  | { type: "artifact-delta"; id: string; text: string }
  | { type: "artifact-close"; id: string }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "finish"; finishReason: string; thinkingDurationMs?: number }
  | { type: "title"; title: string }
  | { type: "error"; message: string; code?: string };

export function encodeEvent(e: StreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e) + "\n");
}

export async function* parseEventStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as StreamEvent;
        } catch {
          // ignore malformed
        }
      }
    }
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as StreamEvent;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}
