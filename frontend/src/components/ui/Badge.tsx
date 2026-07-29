import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "danger" | "olive";
};

export const Badge = ({ className, tone = "neutral", ...props }: BadgeProps) => {
  const tones = {
    neutral: "bg-[var(--canvas)] text-[var(--muted)]",
    success: "bg-[var(--teal-soft)] text-[var(--teal)]",
    warning: "bg-[var(--amber-soft)] text-[var(--amber-strong)]",
    danger: "bg-[var(--coral-soft)] text-[var(--coral-strong)]",
    olive: "bg-[var(--olive-soft)] text-[var(--olive-strong)]",
  } as const;

  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none", tones[tone], className)} {...props} />;
};
