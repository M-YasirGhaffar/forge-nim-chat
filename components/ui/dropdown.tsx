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
  const triggerWrapRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{
    top: number;
    left: number;
    maxHeight: number;
    effectiveSide: "top" | "bottom";
  } | null>(null);

  // Recompute position from a fresh trigger rect.
  const computePosition = React.useCallback(() => {
    const triggerEl = triggerWrapRef.current;
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    // Pick effective side: flip if the requested side doesn't have at least 200px room.
    let effectiveSide: "top" | "bottom" = side;
    if (side === "top" && spaceAbove < 200 && spaceBelow > spaceAbove) effectiveSide = "bottom";
    if (side === "bottom" && spaceBelow < 200 && spaceAbove > spaceBelow) effectiveSide = "top";

    const effectiveSpace = effectiveSide === "top" ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, effectiveSpace - 24);

    // Estimate panel width: prefer the actually-rendered panel width, else fall back to its
    // computed min-width (or 160 for the default "min-w-[10rem]").
    let panelWidth = 0;
    if (panelRef.current) {
      panelWidth = panelRef.current.offsetWidth;
    }
    if (panelWidth === 0) {
      panelWidth = Math.max(160, rect.width);
    }

    const left = align === "end" ? rect.right - panelWidth : rect.left;
    // Clamp horizontally within viewport.
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));

    const top =
      effectiveSide === "top"
        ? Math.max(8, rect.top - 4) // panel will be positioned with `bottom` via translate trick below
        : rect.bottom + 4;

    setPos({ top, left: clampedLeft, maxHeight, effectiveSide });
  }, [side, align]);

  // Re-measure when the panel itself mounts (so width is real) and on every open.
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    computePosition();
    // Re-run after the panel has rendered so its width is known.
    const raf = requestAnimationFrame(() => computePosition());
    return () => cancelAnimationFrame(raf);
  }, [open, computePosition]);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onWin() {
      computePosition();
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, computePosition]);

  const panelStyle: React.CSSProperties | undefined = pos
    ? {
        position: "fixed",
        left: `${pos.left}px`,
        ...(pos.effectiveSide === "top"
          ? { top: "auto", bottom: `${window.innerHeight - pos.top}px` }
          : { top: `${pos.top}px` }),
        maxHeight: `${pos.maxHeight}px`,
        overscrollBehavior: "contain",
      }
    : { visibility: "hidden", position: "fixed", overscrollBehavior: "contain" };

  return (
    <div className="relative inline-block" ref={ref}>
      <div ref={triggerWrapRef} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </div>
      {open && (
        <div
          ref={panelRef}
          className={cn(
            "z-50 min-w-[10rem] rounded-lg border bg-[rgb(var(--color-bg-elev))] shadow-xl py-1.5 overflow-y-auto",
            className
          )}
          style={panelStyle}
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
