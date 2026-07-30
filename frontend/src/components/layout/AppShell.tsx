import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Archive, Boxes, ChevronLeft, ChevronRight, Menu, PackageSearch, ReceiptText, ShoppingCart, Users, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { cn } from "../../lib/cn";
import { useAuth } from "../../features/auth/AuthProvider";
import type { Role } from "../../types/api";
import { Button } from "../ui/Button";
import { GlobalProductSearch } from "./GlobalProductSearch";
import { ExpandingSearchDock } from "../ui/expanding-search-dock-shadcnui";
import { LanguageSwitcher } from "../ui/LanguageSwitcher";
import { ProfileDropdown } from "../ui/ProfileDropdown";

type NavItem = {
  icon: typeof Boxes;
  label: string;
  labelKey?: string;
  roles?: Role[];
  to: string;
};

const navigation: NavItem[] = [
  { icon: Archive, label: "Overview", labelKey: "nav.overview", to: "/" },
  { icon: Boxes, label: "Catalog", labelKey: "nav.catalog", to: "/catalog" },
  { icon: PackageSearch, label: "Inventory", labelKey: "nav.inventory", to: "/inventory" },
  { icon: ReceiptText, label: "Purchases", labelKey: "nav.purchases", roles: ["admin", "manager"], to: "/purchases" },
  { icon: ShoppingCart, label: "Sales", labelKey: "nav.sales", to: "/sales" },
  { icon: Users, label: "Customers", labelKey: "nav.customers", to: "/customers" },
];

type NavLinksProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
  role: Role;
};

const NavLinks = ({ collapsed = false, onNavigate, role }: NavLinksProps) => {
  const { t } = useTranslation();
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigation.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
        const Icon = item.icon;
        const displayLabel = item.labelKey ? t(item.labelKey) : item.label;
        return <NavLink end={item.to === "/"} key={item.to} onClick={onNavigate} to={item.to} className={({ isActive }) => cn("group flex min-h-11 items-center gap-3 rounded-[0.625rem] px-3 text-lg font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", isActive ? "bg-[var(--nav-active)] text-[var(--on-ink)] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]" : "text-[var(--on-ink-muted)] hover:bg-white/[0.07] hover:text-[var(--on-ink)]", collapsed && "justify-center px-0")} title={collapsed ? displayLabel : undefined}><Icon size={20} strokeWidth={1.8} className="shrink-0" /><span className={cn("truncate", collapsed && "sr-only")}>{displayLabel}</span></NavLink>;
      })}
    </nav>
  );
};

export const AppShell = () => {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const role = user?.role ?? "staff";

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) {
        return;
      }
      event.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const drawer = mobileDrawerRef.current;
    if (!drawer) {
      return;
    }
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const items = focusable();
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      mobileTriggerRef.current?.focus();
    };
  }, [mobileOpen]);

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-cols-[auto_1fr]">
      <aside aria-hidden={mobileOpen || undefined} className={cn("hidden min-h-screen bg-[var(--ink)] p-3 transition-[width] duration-200 ease-out lg:flex lg:flex-col", collapsed ? "w-[5rem]" : "w-60")} inert={mobileOpen}>
        <div className={cn("mb-7 flex min-h-12", collapsed ? "flex-col items-center gap-4 justify-center pt-2" : "items-center justify-between px-1")}>
          <NavLink aria-label={t("nav.home")} className={cn("flex min-h-11 items-center gap-3 text-[var(--on-ink)]", collapsed && "justify-center")} to="/">
            <img src="/Logo.png" alt={t("nav.logo")} className="size-12 shrink-0 rounded-xl object-contain" />
            <span className={cn("min-w-0", collapsed && "sr-only")}>
              <strong className="block font-display text-base font-semibold tracking-[-0.02em]">{t("nav.app_title")}</strong>
            </span>
          </NavLink>
          <Button 
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} 
            className={cn(collapsed ? "w-full flex justify-center" : "", "text-[var(--on-ink-subtle)] hover:bg-white/[0.07] hover:text-[var(--on-ink)]")} 
            size="icon" 
            variant="quiet" 
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </Button>
        </div>
        <NavLinks collapsed={collapsed} role={role} />
        <div className="mt-auto border-t border-white/10 pt-3">
          <div className={cn("px-2 py-2", collapsed && "sr-only")}>
            <p className="text-base font-semibold capitalize text-[var(--on-ink-muted)]">{t(`roles.${role}`)}</p>
            <p className="mt-0.5 text-xs text-[var(--on-ink-subtle)]">{t("nav.local_workspace")}</p>
          </div>
        </div>
      </aside>

      <div aria-hidden={mobileOpen || undefined} className="min-w-0" inert={mobileOpen}>
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-glass)] px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Button ref={mobileTriggerRef} aria-label={t("nav.open")} className="lg:hidden" size="icon" variant="quiet" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </Button>
            <ExpandingSearchDock 
              onSearch={(query) => {
                setSearchOpen(false);
                navigate(`/catalog?query=${encodeURIComponent(query)}`);
              }} 
              placeholder={t("nav.search")} 
            />
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <ProfileDropdown user={user} onLogout={onLogout} />
          </div>
        </header>
        <main className="app-canvas min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 sm:py-7 lg:px-8"><div className="mx-auto max-w-[88rem]"><Outlet /></div></main>
      </div>

      <GlobalProductSearch
        onClose={() => setSearchOpen(false)}
        onSelect={(product) => {
          setSearchOpen(false);
          navigate(`/catalog?query=${encodeURIComponent(product.sku)}`);
        }}
        open={searchOpen}
      />
      {mobileOpen ? <div className="fixed inset-0 z-40 lg:hidden"><button aria-label={t("nav.close_backdrop")} className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} /><aside ref={mobileDrawerRef} aria-label={t("nav.main")} aria-modal="true" className="relative flex h-full w-72 flex-col bg-[var(--ink)] p-4 shadow-[var(--shadow-elevated)]" role="dialog"><div className="mb-7 flex items-center justify-between"><span className="flex items-center gap-3 text-[var(--on-ink)]"><img src="/Logo.png" alt={t("nav.logo")} className="size-10 rounded-xl object-contain" /><span className="font-display text-sm font-semibold">{t("nav.app_title")}</span></span><Button aria-label={t("nav.close_nav")} className="text-[var(--on-ink-muted)] hover:bg-white/[0.07] hover:text-[var(--on-ink)]" size="icon" variant="quiet" onClick={() => setMobileOpen(false)}><X size={20} /></Button></div><NavLinks onNavigate={() => setMobileOpen(false)} role={role} /></aside></div> : null}
    </div>
  );
};
