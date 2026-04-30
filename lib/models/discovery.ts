import "server-only";
import { ALLOWED_MODELS, allAllowedIds, imageModelIds, buildEntry } from "./capabilities";
import type { ModelEntry } from "@/lib/types";
import { nimListModels } from "@/lib/nim/client";

/**
 * Source of truth for "what models can the user pick right now".
 *
 * Strategy:
 *  1. Fetch NIM /v1/models (5-min cache) to see what's actually live.
 *  2. Intersect with our ALLOWED_MODELS allowlist (so deprecations vanish automatically,
 *     and a new flagship from a known vendor only appears once we add it to the allowlist).
 *  3. Always include FLUX entries (they live on a different endpoint — /genai/.../infer —
 *     so they don't show up in /v1/models). Their availability is verified by the
 *     health-pinger separately.
 *  4. Fallback to allowlist-as-static-list if NIM is down so the UI never breaks.
 */

interface CacheState {
  ids: Set<string>;
  fetchedAt: number;
  lastError?: string;
}

let cache: CacheState | null = null;
const TTL_MS = 5 * 60 * 1000;

async function ensureCache(force = false): Promise<CacheState> {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  try {
    const data = await nimListModels();
    if (data) {
      cache = { ids: new Set(data.map((d) => d.id)), fetchedAt: Date.now() };
      return cache;
    }
    throw new Error("nimListModels returned null");
  } catch (e) {
    // Fallback: assume the entire allowlist is available so UX stays usable.
    cache = {
      ids: new Set(allAllowedIds()),
      fetchedAt: Date.now(),
      lastError: e instanceof Error ? e.message : String(e),
    };
    return cache;
  }
}

export async function listAvailableEntries(): Promise<{ entries: ModelEntry[]; usingFallback: boolean; error?: string }> {
  const c = await ensureCache();
  const entries: ModelEntry[] = [];

  // Chat models: must be in both allowlist and NIM /v1/models.
  for (const id of allAllowedIds()) {
    if (ALLOWED_MODELS[id].endpoint === "chat" && c.ids.has(id)) {
      const e = buildEntry(id);
      if (e) entries.push(e);
    }
  }
  // Image models: always include allowlisted ones (NIM /v1/models doesn't list them).
  for (const id of imageModelIds()) {
    const e = buildEntry(id);
    if (e) entries.push(e);
  }

  return { entries, usingFallback: !!c.lastError, error: c.lastError };
}

export async function refreshDiscovery() {
  await ensureCache(true);
}

export function defaultModelId(): string {
  // Pick the fastest-known available model as the default.
  // Order of preference:
  return (
    "deepseek-ai/deepseek-v4-flash"
  );
}
