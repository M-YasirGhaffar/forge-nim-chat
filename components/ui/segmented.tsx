"use client";

import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex rounded-lg border p-0.5 bg-[rgb(var(--color-bg-soft))]",
        size === "sm" ? "text-[11px]" : "text-xs",
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => !o.disabled && onChange(o.value)}
          className={cn(
            "rounded-md transition-colors",
            size === "sm" ? "px-2 h-6" : "px-2.5 h-7",
            value === o.value
              ? "bg-[rgb(var(--color-bg-elev))] text-[rgb(var(--color-fg))] border border-[rgb(var(--color-border))] font-medium"
              : "text-[rgb(var(--color-fg-muted))] hover:text-[rgb(var(--color-fg))]",
            o.disabled && "opacity-40 cursor-not-allowed"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
