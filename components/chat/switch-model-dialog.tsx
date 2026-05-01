"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { getModel } from "@/lib/models/registry";

interface Props {
  fromModelId: string;
  onCancel: () => void;
}

/**
 * Tiny modal shown when a user clicks the locked model dropdown. Two choices:
 * start a new chat (fresh model), or stay on the current chat.
 */
export function SwitchModelDialog({ fromModelId, onCancel }: Props) {
  const router = useRouter();
  const from = getModel(fromModelId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function startNewChat() {
    onCancel();
    router.push("/chat");
    window.dispatchEvent(new Event("polyglot:reset-chat"));
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center backdrop-blur-sm bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-sm p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold tracking-tight">Model is locked</h2>
          <button onClick={onCancel} className="btn btn-ghost h-7 w-7 p-0 -mr-1 -mt-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
          This chat is locked to <strong>{from?.displayName ?? "the current model"}</strong>.
          Start a new chat to switch.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary">
            Stay here
          </button>
          <button onClick={startNewChat} className="btn btn-primary">
            New chat
          </button>
        </div>
      </div>
    </div>
  );
}
