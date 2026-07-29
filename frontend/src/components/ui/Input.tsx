import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, type = "text", ...props }: InputProps) => (
  <input
    type={type}
    className={cn(
      "min-h-11 w-full rounded-[0.625rem] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--muted-soft)] focus:border-[var(--olive)] focus:ring-4 focus:ring-[color:var(--olive-soft)] sm:text-sm",
      className,
    )}
    {...props}
  />
);
