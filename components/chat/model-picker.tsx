"use client";

import type { RefObject } from "react";
import { ChevronDown, Sparkles, Eye, ImageIcon, Check, Brain, Loader2, AlertTriangle, Zap } from "lucide-react";
import { Dropdown, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { getModel, MODEL_REGISTRY } from "@/lib/models/registry";
import { useAvailableModels, type ModelHealthState } from "@/lib/chat/use-models";
import type { ModelEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Props {
  modelId: string;
  onChange: (id: string) => void;
  size?: "sm" | "md";
  filter?: "all" | "chat" | "image";
  disabled?: boolean;
  side?: "top" | "bottom";
  /**
   * Called when the user clicks the picker while it is `disabled` (locked chat). The parent
   * is expected to surface a small "Start a new chat?" popup.
   */
  onRequestSwitch?: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function ModelPicker({
  modelId,
  onChange,
  size = "md",
  filter = "all",
  disabled,
  side = "top",
  onRequestSwitch,
  triggerRef,
}: Props) {
  const current = getModel(modelId);
  const { entries, health, loading } = useAvailableModels();

  const rawList = entries.length > 0 ? entries : MODEL_REGISTRY;
  const list = rawList.filter((m) => {
    if (m.endpoint === "chat" && health[m.id]?.state === "unavailable") return false;
    return true;
  });
  const reasoning = list.filter((m) => m.category === "reasoning");
  const multi = list.filter((m) => m.category === "multimodal");
  const img = list.filter((m) => m.category === "image");

  const showChat = filter !== "image";
  const showImage = filter !== "chat";

  if (disabled) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "btn btn-secondary opacity-70 cursor-pointer",
          size === "sm" ? "h-8 px-2 text-[12px]" : "h-9 px-3 text-[13px]"
        )}
        onClick={() => onRequestSwitch?.()}
      >
        <span className="flex items-center gap-2 max-w-[280px]">
          {current?.category === "image" ? (
            <ImageIcon className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
          ) : current?.category === "multimodal" ? (
            <Eye className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
          )}
          <span className="truncate">{current?.displayName ?? "Choose a model"}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-30" />
      </button>
    );
  }

  return (
    <Dropdown
      side={side}
      trigger={
        <button
          ref={triggerRef}
          className={cn(
            "btn btn-secondary",
            size === "sm" ? "h-8 px-2 text-[12px]" : "h-9 px-3 text-[13px]"
          )}
        >
          <span className="flex items-center gap-2 max-w-[280px]">
            {current?.category === "image" ? (
              <ImageIcon className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
            ) : current?.category === "multimodal" ? (
              <Eye className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[rgb(var(--color-fg-muted))]" />
            )}
            <span className="truncate">{current?.displayName ?? "Choose a model"}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      }
      className="w-[460px]"
    >
      {showChat && (
        <>
          <DropdownLabel>Reasoning · text</DropdownLabel>
          {reasoning.length === 0 && loading ? (
            <SkeletonRow />
          ) : (
            reasoning.map((m) => (
              <ModelOption
                key={m.id}
                model={m}
                active={m.id === modelId}
                health={health[m.id]?.state ?? "unknown"}
                latency={health[m.id]?.latencyMs}
                onSelect={onChange}
              />
            ))
          )}
          <DropdownSeparator />
          <DropdownLabel>
            Multimodal · text {multi.some((m) => m.supportsVideo) ? "+ image + video" : "+ image"}
          </DropdownLabel>
          {multi.length === 0 && loading ? (
            <SkeletonRow />
          ) : (
            multi.map((m) => (
              <ModelOption
                key={m.id}
                model={m}
                active={m.id === modelId}
                health={health[m.id]?.state ?? "unknown"}
                latency={health[m.id]?.latencyMs}
                onSelect={onChange}
              />
            ))
          )}
        </>
      )}
      {showImage && (
        <>
          {showChat && <DropdownSeparator />}
          <DropdownLabel>Image generation</DropdownLabel>
          {img.map((m) => (
            <ModelOption
              key={m.id}
              model={m}
              active={m.id === modelId}
              health={health[m.id]?.state ?? "unknown"}
              latency={health[m.id]?.latencyMs}
              onSelect={onChange}
            />
          ))}
        </>
      )}
    </Dropdown>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-3 text-xs" style={{ color: "rgb(var(--color-fg-muted))" }}>
      <Loader2 className="h-3 w-3 animate-spin" />
      Loading models…
    </div>
  );
}

function ModelOption({
  model,
  active,
  health,
  latency,
  onSelect,
}: {
  model: ModelEntry;
  active: boolean;
  health: ModelHealthState;
  latency?: number;
  onSelect: (id: string) => void;
}) {
  const isImage = model.endpoint === "infer";
  const unavailable = health === "unavailable";
  return (
    <button
      onClick={() => onSelect(model.id)}
      disabled={unavailable}
      className={cn(
        "w-full text-left px-3 py-2.5 transition-colors",
        unavailable ? "cursor-not-allowed opacity-50" : "hover:bg-[rgb(var(--color-bg-soft))]",
        active && "bg-[rgb(var(--color-bg-soft))]"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {active ? (
            <Check className="h-4 w-4 text-[rgb(var(--color-accent))]" />
          ) : (
            <span className="block h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium">{model.displayName}</span>
            <HealthBadge state={isImage ? "available" : health} latency={latency} />
            {model.supportsThinking && (
              <span className="pill text-[10px] py-0">
                <Brain className="h-2.5 w-2.5" /> thinking
              </span>
            )}
            {model.supportsImages && (
              <span className="pill text-[10px] py-0">
                <Eye className="h-2.5 w-2.5" /> vision
              </span>
            )}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "rgb(var(--color-fg-muted))" }}>
            {model.tagline}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            <span>{model.paramHint}</span>
            {model.contextWindow > 0 && (
              <>
                <span>·</span>
                <span>{(model.contextWindow / 1000).toFixed(0)}K context</span>
              </>
            )}
            <span>·</span>
            <span>{model.vendor}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function HealthBadge({ state, latency }: { state: ModelHealthState; latency?: number }) {
  if (state === "unknown") return null;
  if (state === "available") {
    return (
      <span
        className="pill text-[10px] py-0"
        style={{ color: "rgb(var(--color-success))", borderColor: "rgb(var(--color-success) / 0.4)" }}
        title={latency ? `${latency}ms response` : "Available"}
      >
        <Zap className="h-2.5 w-2.5" />
        {latency ? `${(latency / 1000).toFixed(1)}s` : "fast"}
      </span>
    );
  }
  if (state === "slow") {
    return (
      <span
        className="pill text-[10px] py-0"
        style={{ color: "rgb(var(--color-warning))", borderColor: "rgb(var(--color-warning) / 0.4)" }}
        title={latency ? `${latency}ms response (slow)` : "Upstream is responding slowly"}
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        slow
      </span>
    );
  }
  return (
    <span
      className="pill text-[10px] py-0"
      style={{ color: "rgb(var(--color-danger))", borderColor: "rgb(var(--color-danger) / 0.4)" }}
      title="Unavailable"
    >
      unavailable
    </span>
  );
}
