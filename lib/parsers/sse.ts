/**
 * Lightweight SSE parser for upstream NIM responses.
 *
 * Why we parse SSE manually instead of using the Vercel AI SDK's OpenAI-compatible
 * provider directly: the artifact parser (lib/parsers/artifact.ts) needs to be
 * inserted between the upstream stream and the downstream client stream, so it
 * can split content into "chat text" vs "artifact body" before the client sees
 * tokens. The cleanest place to do that is right at the SSE chunk boundary.
 */

export interface NimDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface NimStreamEvent {
  delta?: NimDelta;
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function* parseNimSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<NimStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any buffered multi-byte chars at end-of-stream (audit P2-1).
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let separatorIdx;
      while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{
                delta?: NimDelta;
                finish_reason?: string;
                message?: NimDelta;
              }>;
              usage?: NimStreamEvent["usage"];
              error?: { message?: string; type?: string; code?: string };
            };
            // NIM emits in-stream error events as `{"error":{"message":"...","type":"..."}}` —
            // surface them so the chat route can stop instead of silently flushing nothing.
            if (json.error) {
              const msg = json.error.message || json.error.type || json.error.code || "upstream error";
              throw new Error(`NIM stream error: ${msg}`);
            }
            const choice = json.choices?.[0];
            yield {
              delta: choice?.delta ?? choice?.message,
              finishReason: choice?.finish_reason,
              usage: json.usage,
            };
          } catch (e) {
            // Malformed JSON: ignore. Real upstream errors (thrown above) propagate up.
            if (e instanceof Error && e.message.startsWith("NIM stream error:")) throw e;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* mergeStream(
  events: AsyncGenerator<NimStreamEvent>
): AsyncGenerator<{
  type: "content" | "reasoning" | "usage" | "finish" | "tool";
  text?: string;
  usage?: NimStreamEvent["usage"];
  finishReason?: string;
  toolCalls?: NimDelta["tool_calls"];
}> {
  for await (const e of events) {
    if (e.delta?.content) {
      yield { type: "content", text: e.delta.content };
    }
    if (e.delta?.reasoning_content) {
      yield { type: "reasoning", text: e.delta.reasoning_content };
    }
    if (e.delta?.tool_calls?.length) {
      yield { type: "tool", toolCalls: e.delta.tool_calls };
    }
    if (e.finishReason) {
      yield { type: "finish", finishReason: e.finishReason };
    }
    if (e.usage) {
      yield { type: "usage", usage: e.usage };
    }
  }
}
