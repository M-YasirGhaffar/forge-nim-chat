"use client";

import { useEffect, useState } from "react";
import { Loader2, Clock, AlertTriangle, Zap, ArrowRightLeft, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { getModel } from "@/lib/models/registry";
import type { StreamStatus } from "@/lib/stream/protocol";

interface Props {
  status: StreamStatus | null;
  message?: string;
  modelId?: string;
  retryAfter?: number;
}

/**
 * Live status pill rendered next to the streaming assistant turn so the user always knows
 * whether we're waiting on NIM, mid-stream, retrying, or falling back to a sibling model.
 *
 * The pill ticks an elapsed-seconds counter for "connecting", "queued", and "slow" states.
 */
export function StreamStatusPill({ status, message, modelId, retryAfter }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const tickStates: StreamStatus[] = ["connecting", "queued", "slow", "rate_limited", "retry"];
  const ticking = status && tickStates.includes(status);

  useEffect(() => {
    if (!ticking) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [ticking, status]);

  if (!status || status === "streaming") return null;

  const display = describe(status, message, modelId, retryAfter, elapsed);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border my-1.5",
        display.tone === "info" && "bg-[rgb(var(--color-bg-soft))] border-[rgb(var(--color-border))]",
        display.tone === "warn" &&
          "bg-[rgb(var(--color-warning)/0.08)] border-[rgb(var(--color-warning)/0.4)] text-[rgb(var(--color-warning))]",
        display.tone === "danger" &&
          "bg-[rgb(var(--color-danger)/0.08)] border-[rgb(var(--color-danger)/0.4)] text-[rgb(var(--color-danger))]"
      )}
      style={display.tone === "info" ? { color: "rgb(var(--color-fg-muted))" } : undefined}
      role="status"
      aria-live="polite"
    >
      {display.icon}
      <span>{display.label}</span>
    </div>
  );
}

function describe(
  status: StreamStatus,
  message?: string,
  modelId?: string,
  retryAfter?: number,
  elapsed?: number
): { label: string; icon: React.ReactNode; tone: "info" | "warn" | "danger" } {
  const modelName = modelId ? getModel(modelId)?.displayName ?? modelId : null;
  switch (status) {
    case "connecting":
      return {
        label: `Connecting to ${modelName ?? "model"}…${elapsed ? ` ${elapsed}s` : ""}`,
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        tone: "info",
      };
    case "queued":
      return {
        label: `Waiting for ${modelName ?? "model"} capacity…${elapsed ? ` ${elapsed}s` : ""}`,
        icon: <Hourglass className="h-3 w-3" />,
        tone: "info",
      };
    case "streaming":
      return {
        label: `Streaming from ${modelName ?? "model"}`,
        icon: <Zap className="h-3 w-3" />,
        tone: "info",
      };
    case "slow":
      return {
        label: message
          ? `${message} · ${elapsed ?? 0}s elapsed`
          : `Slow response — ${modelName ?? "model"} is busy. ${elapsed ?? 0}s elapsed.`,
        icon: <Clock className="h-3 w-3" />,
        tone: "warn",
      };
    case "rate_limited":
      return {
        label: retryAfter
          ? `Rate-limited, retrying in ${retryAfter}s`
          : message ?? "Rate-limited, retrying…",
        icon: <AlertTriangle className="h-3 w-3" />,
        tone: "warn",
      };
    case "fallback":
      return {
        label: message ?? `Falling back to ${modelName ?? "another model"}…`,
        icon: <ArrowRightLeft className="h-3 w-3" />,
        tone: "warn",
      };
    case "retry":
      return {
        label: message ?? "Retrying…",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        tone: "warn",
      };
    default:
      return { label: status, icon: null, tone: "info" };
  }
}
