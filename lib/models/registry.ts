import type { ModelEntry } from "@/lib/types";
import { ALLOWED_MODELS, buildEntry, allAllowedIds, isAllowedModel } from "./capabilities";

/**
 * Compatibility shim for the old hardcoded registry.
 *
 * The actual list of available models is now resolved at runtime by lib/models/discovery.ts
 * (server) and surfaced via /api/models (client). But many callers still want a synchronous
 * `getModel(id)` and a default id — those still work because every id we surface is in the
 * static capabilities map (lib/models/capabilities.ts).
 */

export const DEFAULT_MODEL_ID = "deepseek-ai/deepseek-v4-flash";

/** All allowlisted models, regardless of NIM availability. Use the API endpoint for the live list. */
export const MODEL_REGISTRY: ModelEntry[] = allAllowedIds()
  .map(buildEntry)
  .filter((e): e is ModelEntry => e !== null);

export function getModel(id: string): ModelEntry | undefined {
  return buildEntry(id) ?? undefined;
}

export function getModelOrDefault(id: string | undefined | null): ModelEntry {
  if (id) {
    const e = buildEntry(id);
    if (e) return e;
  }
  return buildEntry(DEFAULT_MODEL_ID)!;
}

/**
 * Same-family fallback chain: when the requested model is unavailable mid-stream, we surface
 * the next-best healthy sibling so the user gets *some* answer.
 */
export function getFallbackForModel(id: string): string | null {
  const fallbacks: Record<string, string | null> = {
    "deepseek-ai/deepseek-v4-pro": "deepseek-ai/deepseek-v4-flash",
    "deepseek-ai/deepseek-v4-flash": "moonshotai/kimi-k2-instruct-0905",
    "deepseek-ai/deepseek-v3.2": "moonshotai/kimi-k2-instruct-0905",
    "deepseek-ai/deepseek-v3.1-terminus": "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3.5-397b-a17b": "qwen/qwen3.5-122b-a10b",
    "qwen/qwen3.5-122b-a10b": "deepseek-ai/deepseek-v4-flash",
    "moonshotai/kimi-k2-thinking": "moonshotai/kimi-k2-instruct-0905",
    "moonshotai/kimi-k2-instruct-0905": "deepseek-ai/deepseek-v4-flash",
    "z-ai/glm-5.1": "z-ai/glm5",
    "z-ai/glm5": "z-ai/glm4.7",
    "z-ai/glm4.7": "deepseek-ai/deepseek-v4-flash",
  };
  return fallbacks[id] ?? null;
}

export function modelsByCategory() {
  return {
    reasoning: MODEL_REGISTRY.filter((m) => m.category === "reasoning"),
    multimodal: MODEL_REGISTRY.filter((m) => m.category === "multimodal"),
    image: MODEL_REGISTRY.filter((m) => m.category === "image"),
  };
}

export { isAllowedModel, ALLOWED_MODELS };
