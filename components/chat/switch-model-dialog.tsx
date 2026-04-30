"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { getModel } from "@/lib/models/registry";
import { authedFetch } from "@/components/auth-provider";

interface Props {
  fromModelId: string;
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
export function SwitchModelDialog({ fromModelId, toModelId, lastUserText, onCancel }: Props) {
  const router = useRouter();
  const from = getModel(fromModelId);
  const to = getModel(toModelId);

  // Esc to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function newChat(carryPrompt: boolean) {
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
    <div className="fixed inset-0 z-[60] grid place-items-center backdrop-blur-sm bg-black/40">
      <div className="card w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Switch to {to?.displayName}?</h2>
            <p className="mt-1 text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
              This chat is locked to <strong>{from?.displayName}</strong>. To use a different model,
              start a new chat.
            </p>
          </div>
          <button onClick={onCancel} className="btn btn-ghost h-7 w-7 p-0 -mr-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {lastUserText && (
          <div className="rounded-lg border bg-[rgb(var(--color-bg-soft))] p-3 mb-4 text-[12px] line-clamp-3 leading-snug" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <div className="font-medium mb-0.5" style={{ color: "rgb(var(--color-fg))" }}>Last prompt</div>
            {lastUserText}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={onCancel} className="btn btn-secondary">
            Stay here
          </button>
          {lastUserText && (
            <button onClick={() => void newChat(true)} className="btn btn-secondary">
              New chat (carry last prompt)
            </button>
          )}
          <button onClick={() => void newChat(false)} className="btn btn-primary">
            New chat
          </button>
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
