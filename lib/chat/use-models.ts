"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/components/auth-provider";
import type { ModelEntry } from "@/lib/types";

export type ModelHealthState = "available" | "slow" | "unavailable" | "unknown";

export interface ModelHealth {
  state: ModelHealthState;
  latencyMs: number;
  reason?: string;
}

interface ApiResponse {
  entries: ModelEntry[];
  health: Record<string, ModelHealth>;
  usingFallback?: boolean;
  error?: string;
}

interface State {
  entries: ModelEntry[];
  health: Record<string, ModelHealth>;
  loading: boolean;
  error: string | null;
  usingFallback: boolean;
}

let cached: ApiResponse | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export function useAvailableModels() {
  const [state, setState] = useState<State>({
    entries: cached?.entries ?? [],
    health: cached?.health ?? {},
    loading: !cached,
    error: null,
    usingFallback: cached?.usingFallback ?? false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load(force = false) {
      // Use cache if fresh.
      if (!force && cached && Date.now() - cachedAt < CACHE_MS) {
        if (!cancelled) {
          setState({
            entries: cached.entries,
            health: cached.health,
            loading: false,
            error: null,
            usingFallback: !!cached.usingFallback,
          });
        }
        return;
      }
      try {
        // First call without health probes (fast).
        const fast = await authedFetch("/api/models");
        if (!fast.ok) throw new Error(`HTTP ${fast.status}`);
        const fastData = (await fast.json()) as ApiResponse;
        cached = fastData;
        cachedAt = Date.now();
        if (cancelled) return;
        setState({
          entries: fastData.entries,
          health: fastData.health ?? {},
          loading: false,
          error: null,
          usingFallback: !!fastData.usingFallback,
        });

        // Second call with health probes (slow, runs in background and updates).
        const slow = await authedFetch("/api/models?health=1");
        if (!slow.ok) return;
        const slowData = (await slow.json()) as ApiResponse;
        cached = slowData;
        cachedAt = Date.now();
        if (cancelled) return;
        setState((s) => ({ ...s, health: slowData.health ?? s.health }));
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
