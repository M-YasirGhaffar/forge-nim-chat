"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "secondary" && "btn-secondary",
        variant === "ghost" && "btn-ghost",
        variant === "danger" &&
          "bg-[rgb(var(--color-danger))] text-white hover:bg-[rgb(var(--color-danger)/0.9)]",
        size === "sm" && "h-8 px-2.5 text-[0.8rem]",
        size === "lg" && "h-10 px-4 text-[0.95rem]",
        size === "icon" && "h-8 w-8 p-0",
        className
      )}
      {...rest}
    />
  );
});
