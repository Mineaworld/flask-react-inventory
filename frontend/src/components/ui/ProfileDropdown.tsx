import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SessionUser } from "../../types/api";

type ProfileDropdownProps = {
  user: SessionUser | null;
  onLogout: () => void;
};

export const ProfileDropdown = ({ user, onLogout }: ProfileDropdownProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-[0.625rem] px-2 text-sm font-semibold text-[var(--ink)] outline-none transition-[background-color] duration-150 hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--olive)]"
      >
        <span className="grid size-8 place-items-center rounded-full bg-[var(--olive-soft)] text-[var(--olive-strong)]">
          <UserRound size={15} />
        </span>
        <span className="hidden sm:inline">{user?.full_name}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: -4, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -4, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 z-50 mt-2 w-48 rounded-xl bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-elevated)] p-1.5 flex flex-col"
          >
            <div className="px-3 py-2 text-sm capitalize text-[var(--muted)] border-b border-[var(--line)] mb-1">
              {user?.role ? t(`roles.${user.role}`) : ""}
            </div>
            
            <button
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="px-3 py-2 cursor-pointer text-sm rounded-lg w-full text-left flex items-center gap-x-2 transition-colors hover:bg-[var(--canvas)] hover:text-[var(--ink)] text-[var(--muted)]"
            >
              <LogOut size={16} />
              {t("auth.signOut")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
