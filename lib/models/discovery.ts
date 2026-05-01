import "server-only";
import { ALLOWED_MODELS, allAllowedIds, imageModelIds, buildEntry } from "./capabilities";
import type { ModelEntry } from "@/lib/types";
import { nimListModels } from "@/lib/nim/client";

/**
 * What can the user pick right now?
 *  1. NIM /v1/models is the live truth — every id it lists is surfaced.
 *  2. Image models (FLUX) don't appear in /v1/models, so we always append the
 *     allowlisted infer-endpoint entries on top.
 *  3. If NIM is unreachable, fall back to the static hint allowlist so the UI
 *     never breaks during a brief upstream outage.
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
    cache = {
      ids: new Set(allAllowedIds().filter((id) => ALLOWED_MODELS[id].endpoint === "chat")),
      fetchedAt: Date.now(),
      lastError: e instanceof Error ? e.message : String(e),
    };
    return cache;
  }
}

export async function listAvailableEntries(): Promise<{ entries: ModelEntry[]; usingFallback: boolean; error?: string }> {
  const c = await ensureCache();
  const entries: ModelEntry[] = [];

  // Surface every id NIM exposes. Capabilities come from the hint table when
  // available, otherwise inferred from the id (so newly-launched models flow
  // through without code edits).
  for (const id of c.ids) {
    const e = buildEntry(id);
    if (e && e.endpoint === "chat") entries.push(e);
  }

  // FLUX-style image endpoints never show up in /v1/models — append from the
  // allowlist directly.
  for (const id of imageModelIds()) {
    const e = buildEntry(id);
    if (e) entries.push(e);
  }

  // Stable order: chat reasoning → multimodal → image, then by displayName.
  const order = (m: ModelEntry) =>
    m.category === "reasoning" ? 0 : m.category === "multimodal" ? 1 : 2;
  entries.sort((a, b) => order(a) - order(b) || a.displayName.localeCompare(b.displayName));

  return { entries, usingFallback: !!c.lastError, error: c.lastError };
}

export async function refreshDiscovery() {
  await ensureCache(true);
}

export function defaultModelId(): string {
  return "deepseek-ai/deepseek-v4-flash";
}
