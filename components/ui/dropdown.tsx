"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}

export function Dropdown({ trigger, children, align = "start", side = "bottom", className }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-[10rem] rounded-lg border bg-[rgb(var(--color-bg-elev))] shadow-xl py-1.5 max-h-[70vh] overflow-y-auto",
            align === "end" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-1 mt-0" : "",
            className
          )}
          onClick={(e) => {
            // Close when an item is clicked unless it explicitly stops propagation.
            if ((e.target as HTMLElement).closest("[data-dropdown-keep-open]")) return;
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  active,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2",
        active
          ? "bg-[rgb(var(--color-bg-soft))] text-[rgb(var(--color-fg))]"
          : "hover:bg-[rgb(var(--color-bg-soft))] text-[rgb(var(--color-fg))]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-[rgb(var(--color-border))]" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "rgb(var(--color-fg-subtle))" }}>
      {children}
    </div>
  );
}
