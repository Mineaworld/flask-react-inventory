import { Construction, MoveRight } from "lucide-react";

import { NavLink } from "react-router-dom";

type FeaturePlaceholderProps = {
  eyebrow: string;
  title: string;
};

export const FeaturePlaceholder = ({ eyebrow, title }: FeaturePlaceholderProps) => (
  <section className="surface-panel max-w-2xl p-8 sm:p-10"><span className="grid size-12 place-items-center rounded-xl bg-[var(--olive-soft)] text-[var(--olive-strong)]"><Construction size={23} /></span><p className="compact-label mt-8">{eyebrow}</p><h1 className="page-title mt-2">{title}</h1><p className="page-copy mt-4">This workspace is ready for its next workflow.</p><NavLink className="mt-8 inline-flex min-h-11 select-none items-center gap-2 rounded-[0.625rem] bg-[var(--ink)] px-4 text-sm font-semibold text-[var(--on-ink)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--ink-soft)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] focus-visible:ring-offset-2" to="/"><MoveRight size={17} />Back to overview</NavLink></section>
);
