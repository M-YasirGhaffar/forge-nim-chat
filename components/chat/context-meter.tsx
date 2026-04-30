"use client";

import { getModel } from "@/lib/models/registry";
import { formatTokens } from "@/lib/utils";

interface Props {
  modelId: string;
  used: number;
  /**
   * Optional live delta (rough token estimate of in-flight stream output) added on top of
   * the committed `used` count so the meter ticks during a stream. Pass undefined when not
   * streaming.
   */
  liveDelta?: number;
}

export function ContextMeter({ modelId, used, liveDelta }: Props) {
  const m = getModel(modelId);
  if (!m || m.contextWindow === 0) return null;
  const totalUsed = used + (liveDelta ?? 0);
  const pct = Math.min(100, (totalUsed / m.contextWindow) * 100);
  const danger = pct > 85;
  const warn = pct > 65 && pct <= 85;
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: "rgb(var(--color-fg-muted))" }}>
      <div className="h-1.5 w-24 rounded-full bg-[rgb(var(--color-bg-soft))] overflow-hidden">
        <div
          className="h-full transition-[width]"
          style={{
            width: `${pct}%`,
            backgroundColor: danger
              ? "rgb(var(--color-danger))"
              : warn
                ? "rgb(var(--color-warning))"
                : "rgb(var(--color-accent))",
          }}
        />
      </div>
      <span title={`${Math.round(totalUsed).toLocaleString()} of ${m.contextWindow.toLocaleString()} tokens`}>
        {formatTokens(Math.round(totalUsed))} / {formatTokens(m.contextWindow)}
      </span>
    </div>
  );
}
