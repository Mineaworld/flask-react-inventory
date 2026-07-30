import type { ComponentPropsWithRef } from "react";

import { cn } from "../../lib/cn";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "default" | "icon" | "small";
};

export const Button = ({ className, variant = "primary", size = "default", type = "button", ...props }: ButtonProps) => {
  const variants = {
    primary: "bg-[var(--olive)] text-[var(--on-ink)] shadow-[0_8px_18px_-10px_var(--olive-strong)] hover:bg-[var(--olive-strong)] hover:shadow-[0_10px_22px_-12px_var(--olive-strong)]",
    secondary: "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-border)] hover:bg-[var(--canvas)] hover:shadow-[var(--shadow-border-hover)]",
    quiet: "bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]",
    danger: "bg-[var(--coral)] text-[var(--on-ink)] hover:bg-[var(--coral-strong)]",
  } as const;
  const sizes = {
    default: "min-h-11 px-4 text-sm",
    small: "min-h-11 px-3 text-sm sm:min-h-10",
    icon: "size-11 p-0",
  } as const;

  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-[0.625rem] font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
};
