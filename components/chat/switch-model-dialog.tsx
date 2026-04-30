"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { getModel, MODEL_REGISTRY } from "@/lib/models/registry";
import { useAvailableModels } from "@/lib/chat/use-models";
import { authedFetch } from "@/components/auth-provider";

interface Props {
  fromModelId: string;
  // Pass "__pick__" to render an inline list of all models the user can pick.
  toModelId: string;
  lastUserText?: string;
  onCancel: () => void;
}

/**
 * Model switching mid-chat would silently change the active model on the server side
 * (which is technically allowed) but it confuses users — every chat in the sidebar would
 * end up with mixed-model history that's hard to compare. Instead we force the user to
 * start a new chat, with the option to carry the last user prompt forward.
 */
export function SwitchModelDialog({ fromModelId, toModelId: initialToModelId, lastUserText, onCancel }: Props) {
  const router = useRouter();
  const from = getModel(fromModelId);

  const isPickerMode = initialToModelId === "__pick__";
  const [toModelId, setToModelId] = useState(
    isPickerMode ? "" : initialToModelId
  );
  const to = toModelId ? getModel(toModelId) : null;
  const { entries, health } = useAvailableModels();

  const pickList = useMemo(() => {
    const source = entries.length > 0 ? entries : MODEL_REGISTRY;
    return source.filter((m) => {
      if (m.id === fromModelId) return false;
      if (m.endpoint === "chat" && health[m.id]?.state === "unavailable") return false;
      return true;
    });
  }, [fromModelId, entries, health]);

  // Esc to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function newChat(carryPrompt: boolean) {
    if (!toModelId) return;
    // We don't pre-create the chat doc — we just navigate to /chat with the new model
    // pre-selected (via localStorage carry) so the composer picks it up on mount.
    const carry = {
      modelId: toModelId,
      seedText: carryPrompt ? lastUserText ?? "" : "",
    };
    try {
      window.localStorage.setItem("polyglot:newChatCarry", JSON.stringify(carry));
    } catch {
      // ignore quota
    }
    onCancel();
    router.push("/chat");
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center backdrop-blur-sm bg-black/40 p-4"
      onClick={onCancel}
    >
      <div className="card w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {isPickerMode && !to
                ? "Switch model"
                : `Switch to ${to?.displayName}?`}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
              This chat is locked to <strong>{from?.displayName}</strong>. To use a different model,
              start a new chat.
            </p>
          </div>
          <button onClick={onCancel} className="btn btn-ghost h-7 w-7 p-0 -mr-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPickerMode && !to && (
          <div className="mb-4 max-h-72 overflow-y-auto rounded-lg border bg-[rgb(var(--color-bg-soft))] divide-y">
            {pickList.map((m) => (
              <button
                key={m.id}
                onClick={() => setToModelId(m.id)}
                className="w-full text-left px-3 py-2 hover:bg-[rgb(var(--color-bg-elev))] flex items-center gap-2"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--color-accent))] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{m.displayName}</div>
                  <div className="text-[10.5px] truncate" style={{ color: "rgb(var(--color-fg-subtle))" }}>
                    {m.vendor} · {m.tagline}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {lastUserText && to && (
          <div className="rounded-lg border bg-[rgb(var(--color-bg-soft))] p-3 mb-4 text-[12px] line-clamp-3 leading-snug" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <div className="font-medium mb-0.5" style={{ color: "rgb(var(--color-fg))" }}>Last prompt</div>
            {lastUserText}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={onCancel} className="btn btn-secondary">
            Stay here
          </button>
          {to && lastUserText && (
            <button onClick={() => void newChat(true)} className="btn btn-secondary">
              New chat (carry last prompt)
            </button>
          )}
          {to && (
            <button onClick={() => void newChat(false)} className="btn btn-primary">
              New chat
            </button>
          )}
        </div>
        <p className="mt-3 text-[10.5px] text-center" style={{ color: "rgb(var(--color-fg-subtle))" }}>
          Why? Mixing models inside a single chat makes outputs inconsistent and breaks the
          context window math.
        </p>
        {/* unused router prop access just to keep TS happy if logic expands */}
        <span hidden>{router ? null : null}</span>
      </div>
    </div>
  );
}

export async function _serverPing() {
  // Reserved hook for telemetry on switch dialog.
  return authedFetch("/api/settings");
}
