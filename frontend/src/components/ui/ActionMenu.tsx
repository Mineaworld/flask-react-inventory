import { MoreHorizontal } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/cn";
import { useTranslation } from "react-i18next";

export type ActionMenuItem = {
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger" | "success";
};

type ActionMenuProps = {
  items: ActionMenuItem[];
  triggerLabel: string;
};

// render action menu
export const ActionMenu = ({ items, triggerLabel }: ActionMenuProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    if (!isOpen && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current && 
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    
    const handleScroll = (event: Event) => {
      if (
        menuRef.current && 
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        className="inline-flex size-11 select-none items-center justify-center rounded-[0.625rem] text-[var(--muted)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--canvas-deep)] hover:text-[var(--ink)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] focus-visible:ring-offset-2"
        onClick={toggleDropdown}
        type="button"
      >
        <MoreHorizontal size={18} />
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {isOpen && rect && (
            <motion.div
              ref={menuRef}
              initial={{ y: -5, scale: 0.95, filter: "blur(10px)", opacity: 0 }}
              animate={{ y: 0, scale: 1, filter: "blur(0px)", opacity: 1 }}
              exit={{ y: -5, scale: 0.95, opacity: 0, filter: "blur(10px)" }}
              transition={{ duration: 0.6, ease: "circInOut", type: "spring" }}
              className="fixed z-[9999] w-48 p-1.5 bg-[var(--surface)] rounded-xl shadow-[var(--shadow-elevated)] flex flex-col gap-1 border border-[var(--line)]"
              role="menu"
              style={{
                top: rect.bottom + 4,
                left: rect.right - 192,
              }}
            >
              {items && items.length > 0 ? (
                items.map((item, index) => (
                  <motion.button
                    initial={{ opacity: 0, x: 10, scale: 0.95, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: 10, scale: 0.95, filter: "blur(10px)" }}
                    transition={{ duration: 0.4, delay: index * 0.1, ease: "easeInOut", type: "spring" }}
                    whileHover={{ 
                      backgroundColor: item.tone === 'danger' ? "var(--coral-soft)" : 
                                       item.tone === 'success' ? "var(--teal-soft)" : "var(--canvas)",
                      transition: { duration: 0.2, ease: "easeInOut" } 
                    }}
                    whileTap={{ scale: 0.97, transition: { duration: 0.1, ease: "easeInOut" } }}
                    key={item.label}
                    role="menuitem"
                    onClick={() => {
                      item.onSelect();
                      setIsOpen(false);
                    }}
                    className={cn(
                      "px-3 py-2.5 cursor-pointer text-sm rounded-lg w-full text-left flex items-center gap-x-2 font-medium transition-colors",
                      item.tone === 'danger' ? "text-[var(--coral-strong)]" : 
                      item.tone === 'success' ? "text-[var(--teal)]" : "text-[var(--ink)]"
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </motion.button>
                ))
              ) : (
                <div className="px-4 py-2 text-[var(--muted)] text-sm">{t("common.no_options")}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};
