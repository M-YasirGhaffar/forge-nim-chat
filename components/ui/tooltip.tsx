"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({ children, label, side = "top" }: { children: React.ReactNode; label: string; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium",
          "bg-[rgb(var(--color-fg))] text-[rgb(var(--color-bg-elev))]",
          "opacity-0 scale-95 transition-all group-hover:opacity-100 group-hover:scale-100",
          side === "top" && "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
          side === "bottom" && "top-full left-1/2 -translate-x-1/2 mt-1.5",
          side === "left" && "right-full top-1/2 -translate-y-1/2 mr-1.5",
          side === "right" && "left-full top-1/2 -translate-y-1/2 ml-1.5"
        )}
      >
        {label}
      </span>
    </span>
  );
}
