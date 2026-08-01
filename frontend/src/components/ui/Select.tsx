import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

export type SelectOption = {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
};

interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  hasError?: boolean;
  className?: string;
  "aria-label"?: string;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  hasError,
  className = "",
  ...props
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayPlaceholder = placeholder || t("common.select_option");

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`relative inline-block w-full text-left ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={props["aria-label"]}
        className={`flex min-h-[38px] w-full items-center justify-between gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--olive)] ${
          hasError ? "border-[var(--coral-strong)]" : "border-[var(--line-strong)]"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {selectedOption?.icon}
          <span className="truncate">{selectedOption ? selectedOption.label : displayPlaceholder}</span>
        </div>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.4, ease: "easeInOut", type: "spring" }}
          className="ml-2 shrink-0 text-[var(--muted)]"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: -4, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -4, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-elevated)]"
          >
            {options.map((option) => {
              const isSelected = String(option.value) === String(value);
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onChange(String(option.value));
                    setIsOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-[var(--olive)] text-[var(--on-olive)]"
                      : "text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                  </div>
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
