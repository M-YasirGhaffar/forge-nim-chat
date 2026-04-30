"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Settings, LogOut, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  user: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  };
  onSignOut: () => void;
}

/**
 * Sidebar-footer profile menu: avatar + name shown by default, opens a popover
 * with avatar, name, email, settings link, and an inline sign-out confirm.
 */
export function ProfilePopover({ user, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setConfirmingSignOut(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmingSignOut(false);
      }
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (user.displayName || user.email || "?")[0].toUpperCase();

  return (
    <div className="relative w-full" ref={wrapRef}>
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+0.4rem)] left-0 right-0 z-30 rounded-lg border bg-[rgb(var(--color-bg-elev))] shadow-2xl p-3"
        >
          <div className="flex items-center gap-2.5 px-1 pb-2.5 mb-2 border-b">
            {user.photoURL ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={user.photoURL} alt="" className="h-9 w-9 rounded-full border" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.5)] grid place-items-center text-[13px] font-semibold border text-white">
                {initial}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] truncate font-medium">{user.displayName || user.email}</div>
              <div className="text-[10.5px] truncate" style={{ color: "rgb(var(--color-fg-subtle))" }}>
                {user.email}
              </div>
            </div>
          </div>

          {/* TODO(task58/quota): show today's quota when /api/usage exists. */}
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="w-full text-left btn btn-ghost h-8 px-2 text-[12px] justify-start"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>

          {confirmingSignOut ? (
            <div className="mt-1 px-2 py-1.5 rounded-md bg-[rgb(var(--color-danger)/0.06)] border border-[rgb(var(--color-danger)/0.25)]">
              <div className="text-[11.5px] mb-1.5" style={{ color: "rgb(var(--color-fg-muted))" }}>
                Sign out of Polyglot?
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  onClick={() => setConfirmingSignOut(false)}
                  className="btn btn-ghost h-7 px-2 text-[11px]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setConfirmingSignOut(false);
                    onSignOut();
                  }}
                  className="btn btn-primary h-7 px-2 text-[11px]"
                  style={{
                    backgroundColor: "rgb(var(--color-danger))",
                    color: "white",
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingSignOut(true)}
              className="w-full text-left btn btn-ghost h-8 px-2 text-[12px] justify-start"
              style={{ color: "rgb(var(--color-fg-muted))" }}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-1 py-1 rounded-md transition-colors",
          "hover:bg-[rgb(var(--color-bg-soft))]"
        )}
      >
        {user.photoURL ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full border shrink-0" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.5)] grid place-items-center text-[11px] font-semibold border text-white shrink-0">
            {initial}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] truncate font-medium">{user.displayName || user.email}</div>
          <div className="text-[10px] truncate" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            {user.email}
          </div>
        </div>
        <ChevronUp
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            !open && "rotate-180",
            "opacity-50"
          )}
        />
      </button>
    </div>
  );
}
