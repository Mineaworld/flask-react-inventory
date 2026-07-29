import { Boxes } from "lucide-react";

import { LoginForm } from "./LoginForm";

export const LoginPage = () => (
  <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-4 py-8 sm:px-6">
    <section className="w-full max-w-md rounded-[1.5rem] bg-[var(--surface)] p-7 shadow-[var(--shadow-elevated)] sm:p-10">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--ink)] text-[var(--on-ink)]"><Boxes size={21} /></span>
        <div><p className="font-display text-sm font-semibold text-[var(--ink)]">Inventory Management</p><p className="text-xs text-[var(--muted)]">SETEC course project</p></div>
      </div>
      <h1 className="mt-10 text-balance font-display text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-[var(--ink)]">Sign in to inventory system</h1>
      <div className="mt-8"><LoginForm /></div>
    </section>
  </main>
);
