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
const CACHE_MS = 30 * 60 * 1000;

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

    async function load() {
      if (cached && Date.now() - cachedAt < CACHE_MS) {
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
        // Single call. The route returns whatever health is cached server-side and
        // kicks a background refresh — nothing waits 24s anymore.
        const res = await authedFetch("/api/models?health=1");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ApiResponse;
        cached = data;
        cachedAt = Date.now();
        if (cancelled) return;
        setState({
          entries: data.entries,
          health: data.health ?? {},
          loading: false,
          error: null,
          usingFallback: !!data.usingFallback,
        });
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
