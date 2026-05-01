import "server-only";
import { ALLOWED_MODELS } from "./capabilities";

/**
 * Lightweight health checker that fires a 1-token probe at each model and caches
 * availability + observed latency. Surfaces "available", "slow", "unavailable" badges
 * in the picker and lets the chat route auto-fall-back to a healthy sibling on 5xx.
 *
 * Probe frequency: lazy — first call to `getHealth(id)` triggers a probe if cache is stale.
 * We deliberately avoid an aggressive cron because NIM trial caps at 40 RPM per model.
 *
 * Rationale (trial-tier rate limits):
 *   The NIM hosted trial enforces a 40 RPM per-model-per-account ceiling, and every
 *   probe consumes one of those requests. To keep the probe traffic well below user
 *   traffic we (a) cache results for 30 minutes (TTL_MS) and (b) issue probes
 *   strictly single-flight (concurrency = 1 in batchHealth). This trades freshness
 *   for headroom — by the time a user clicks an "unavailable" model, our staleness
 *   is bounded but never the dominant cause of rate-limit spend.
 */

export type HealthState = "available" | "slow" | "unavailable" | "unknown";

interface HealthEntry {
  state: HealthState;
  latencyMs: number;
  checkedAt: number;
  reason?: string;
}

const cache = new Map<string, HealthEntry>();
const inFlight = new Map<string, Promise<HealthEntry>>();
const TTL_MS = 30 * 60 * 1000;
const SLOW_MS = 6_000;
const PROBE_TIMEOUT_MS = 12_000;

const BASE = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_API_KEY || "";

async function probe(id: string): Promise<HealthEntry> {
  const cap = ALLOWED_MODELS[id];
  if (!cap) {
    return { state: "unknown", latencyMs: 0, checkedAt: Date.now(), reason: "not in allowlist" };
  }

  // Image models live behind /genai/.../infer — we skip the probe (no cheap probe exists)
  // and trust them; failures will surface at use time as a clear error.
  if (cap.endpoint === "infer") {
    return { state: "available", latencyMs: 0, checkedAt: Date.now() };
  }

  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      return {
        state: latency > SLOW_MS ? "slow" : "available",
        latencyMs: latency,
        checkedAt: Date.now(),
      };
    }
    if (res.status === 404) {
      return { state: "unavailable", latencyMs: latency, checkedAt: Date.now(), reason: "not found" };
    }
    if (res.status === 401 || res.status === 403) {
      return { state: "unavailable", latencyMs: latency, checkedAt: Date.now(), reason: "tier locked" };
    }
    if (res.status === 429) {
      // Rate-limited probes don't actually mean the model is unavailable — keep prior state if any.
      return { state: cache.get(id)?.state ?? "available", latencyMs: latency, checkedAt: Date.now(), reason: "rate limited at probe" };
    }
    return { state: "unavailable", latencyMs: latency, checkedAt: Date.now(), reason: `HTTP ${res.status}` };
  } catch (e) {
    const latency = Date.now() - start;
    if ((e as Error).name === "AbortError") {
      return { state: "slow", latencyMs: latency, checkedAt: Date.now(), reason: "probe timeout" };
    }
    return { state: "unavailable", latencyMs: latency, checkedAt: Date.now(), reason: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(id: string, force = false): Promise<HealthEntry> {
  const cached = cache.get(id);
  if (!force && cached && Date.now() - cached.checkedAt < TTL_MS) return cached;

  let pending = inFlight.get(id);
  if (!pending) {
    pending = probe(id).finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  const fresh = await pending;
  cache.set(id, fresh);
  return fresh;
}

export function getCachedHealth(id: string): HealthEntry | null {
  return cache.get(id) ?? null;
}

export async function batchHealth(ids: string[]): Promise<Record<string, HealthEntry>> {
  const out: Record<string, HealthEntry> = {};
  const queue = [...ids];
  const workers = Math.min(8, queue.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          out[id] = await getHealth(id);
        } catch {
          out[id] = { state: "unavailable", latencyMs: 0, checkedAt: Date.now() };
        }
      }
    })
  );
  return out;
}

/**
 * Fire-and-forget refresh of stale entries. Returns immediately. The next request that
 * reads getCachedHealth() will see fresher values once probes complete.
 */
let backgroundRefreshing = false;
export function kickBackgroundRefresh(ids: string[]): void {
  if (backgroundRefreshing) return;
  const stale = ids.filter((id) => {
    const c = cache.get(id);
    return !c || Date.now() - c.checkedAt > TTL_MS;
  });
  if (stale.length === 0) return;
  backgroundRefreshing = true;
  void batchHealth(stale).finally(() => {
    backgroundRefreshing = false;
  });
}
