import "server-only";
import type { ModelEntry, ThinkingMode } from "@/lib/types";
import type { NimChatMessage, NimChatRequest } from "./client";

/**
 * Per SRS §6.5 + §11 caveat 6, every model exposes thinking-mode toggling differently:
 *  - DeepSeek V4: reasoning_effort ∈ {"low", "medium", "high", "max"} (low === Non-think,
 *    medium ≈ Think Low, high === Think High, max === Think Max). Setting temperature in
 *    Think modes is silently ignored.
 *  - Kimi K2 Thinking: always-on, no toggle (mode "high" always).
 *  - GLM 5.1: body parameter `thinking: {type: "enabled"|"disabled"}`.
 *  - Qwen 3.5: `chat_template_kwargs.enable_thinking` boolean.
 *
 * This normalizer hides those differences behind a single `mode` parameter.
 */
export function applyThinkingMode(
  req: Partial<NimChatRequest>,
  model: ModelEntry,
  mode: ThinkingMode | null | undefined
): NimChatRequest {
  const effectiveMode: ThinkingMode = mode ?? model.defaultThinking ?? "off";
  const out: NimChatRequest = {
    model: req.model || model.id,
    messages: req.messages || [],
    ...req,
  };

  if (model.id.startsWith("deepseek-ai/deepseek-v4")) {
    if (effectiveMode === "off") out.reasoning_effort = "low";
    else if (effectiveMode === "high") out.reasoning_effort = "high";
    else if (effectiveMode === "max") out.reasoning_effort = "max";
  } else if (model.id === "deepseek-ai/deepseek-v3.2") {
    if (effectiveMode === "off") out.reasoning_effort = "low";
    else out.reasoning_effort = "high";
  } else if (model.id === "moonshotai/kimi-k2-thinking") {
    // Always on.
  } else if (model.id === "z-ai/glm-5.1") {
    out.thinking = { type: effectiveMode === "off" ? "disabled" : "enabled" };
  } else if (model.id === "qwen/qwen3.5-397b-a17b") {
    out.chat_template_kwargs = {
      ...(out.chat_template_kwargs || {}),
      enable_thinking: effectiveMode !== "off",
    };
  }

  // Apply recommended sampling params, except where thinking-mode silently overrides them
  // (DeepSeek docs explicitly state this — don't surface params that don't apply).
  const isThinking = effectiveMode !== "off" && model.id.startsWith("deepseek-ai/deepseek-v4");
  if (!isThinking) {
    if (out.temperature == null && model.recommendedTemperature != null) {
      out.temperature = model.recommendedTemperature;
    }
    if (out.top_p == null && model.recommendedTopP != null) {
      out.top_p = model.recommendedTopP;
    }
    if (out.top_k == null && model.recommendedTopK != null) {
      out.top_k = model.recommendedTopK;
    }
  }

  if (out.max_tokens == null) {
    // Generous headroom for reasoning traces (SRS §11 caveat 3).
    out.max_tokens = effectiveMode === "max" ? 16_000 : Math.min(8_192, model.maxOutput);
  }

  return out;
}

/**
 * Strips image / video parts from messages destined for text-only models, per SRS §11 caveat 10.
 * Returns the cleaned messages plus a flag indicating whether anything was stripped (so the
 * caller can prepend a system note).
 */
export function sanitizeMessagesForModel(
  messages: NimChatMessage[],
  model: ModelEntry
): { messages: NimChatMessage[]; stripped: boolean } {
  let stripped = false;
  const cleaned = messages.map((m) => {
    if (typeof m.content === "string" || m.content == null) return m;
    const filtered = m.content.filter((p) => {
      if (p.type === "image_url" && !model.supportsImages) {
        stripped = true;
        return false;
      }
      if (p.type === "video_url" && !model.supportsVideo) {
        stripped = true;
        return false;
      }
      return true;
    });
    if (filtered.length === 0) return { ...m, content: "" };
    if (filtered.length === 1 && filtered[0].type === "text") {
      return { ...m, content: filtered[0].text };
    }
    return { ...m, content: filtered };
  });
  return { messages: cleaned, stripped };
}

/**
 * Trim oldest user/assistant pairs until the prompt fits in the model's context window.
 * Per SRS §6.3 — we surface a banner on the assistant side when this happens.
 */
export function trimToContext(
  messages: NimChatMessage[],
  model: ModelEntry,
  budget?: number
): { messages: NimChatMessage[]; trimmed: number } {
  const limit = (budget ?? model.contextWindow) - (model.maxOutput || 4_000) - 1_000; // headroom
  const estimate = (m: NimChatMessage): number => {
    if (typeof m.content === "string") return Math.ceil((m.content || "").length / 3.5);
    if (!m.content) return 50;
    return m.content.reduce((acc, p) => {
      if (p.type === "text") return acc + Math.ceil(p.text.length / 3.5);
      // Each image roughly 1500 tokens at 1024x1024; videos ~5K per second sampled.
      if (p.type === "image_url") return acc + 1500;
      if (p.type === "video_url") return acc + 30_000;
      return acc;
    }, 0);
  };

  let total = messages.reduce((acc, m) => acc + estimate(m), 0);
  if (total <= limit) return { messages, trimmed: 0 };

  // Always keep the first system message and the last user message.
  const sys = messages.find((m) => m.role === "system");
  const last = messages[messages.length - 1];
  const middle = messages.filter((m) => m !== sys && m !== last);

  let trimmed = 0;
  while (total > limit && middle.length > 0) {
    const dropped = middle.shift()!;
    total -= estimate(dropped);
    trimmed++;
  }

  const out: NimChatMessage[] = [];
  if (sys) out.push(sys);
  out.push(...middle);
  if (last && last !== sys) out.push(last);
  return { messages: out, trimmed };
}
