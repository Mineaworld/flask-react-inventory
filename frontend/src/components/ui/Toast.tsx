import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type ToastProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "success" | "error" | "info";
};

export const Toast = ({ className, tone = "info", ...props }: ToastProps) => {
  const tones = {
    success: "border-[var(--teal)] bg-[var(--teal-soft)] text-[var(--teal)]",
    error: "border-[var(--coral)] bg-[var(--coral-soft)] text-[var(--coral-strong)]",
    info: "border-[var(--olive)] bg-[var(--olive-soft)] text-[var(--olive-strong)]",
  } as const;
  return <div className={cn("rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-border)]", tones[tone], className)} role="status" {...props} />;
};
