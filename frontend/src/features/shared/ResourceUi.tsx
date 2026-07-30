import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Select } from "../../components/ui/Select";
import type { PaginationMeta } from "../../lib/api";
import { useTranslation } from "react-i18next";

export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function apiFieldErrors(error: unknown): Record<string, string> {
  if (typeof error !== "object" || error === null || !("fields" in error)) {
    return {};
  }
  const fields = (error as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function buildListPath(path: string, options: { direction?: "asc" | "desc"; page: number; perPage: number; q?: string; sort: string; extra?: Record<string, string | undefined> }): string {
  const params = new URLSearchParams({
    page: String(options.page),
    per_page: String(options.perPage),
    sort: options.sort,
    direction: options.direction ?? "asc",
  });
  if (options.q?.trim()) {
    params.set("q", options.q.trim());
  }
  Object.entries(options.extra ?? {}).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  return `${path}?${params.toString()}`;
}

type ResourceErrorProps = {
  message: string;
  onRetry: () => void;
  title?: string;
};

export const ResourceError = ({ message, onRetry, title }: ResourceErrorProps) => {
  const { t } = useTranslation();
  return (
  <section className="rounded-xl bg-[var(--coral-soft)] p-5 shadow-[inset_0_0_0_1px_var(--coral)]" role="alert">
    <h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{title || t("common.workspace_error")}</h2>
    <p className="mt-1 text-sm text-[var(--coral-strong)]">{message}</p>
    <Button className="mt-4" size="small" variant="secondary" onClick={onRetry}><RotateCcw size={15} />{t("common.try_again")}</Button>
  </section>
  );
};

type PaginationProps = {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  label: string;
};

export const Pagination = ({ label, meta, onPageChange, onPerPageChange }: PaginationProps) => {
  const { t } = useTranslation();
  const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.per_page + 1;
  const end = Math.min(meta.page * meta.per_page, meta.total);
  const pages = Math.max(meta.pages, 1);
  return (
    <footer className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-3.5 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="tabular-nums">{start}-{end}{t("common.pagination_of")}{meta.total} {label}</span><label className="flex items-center gap-1.5">{t("common.pagination_rows")}<div className="w-20"><Select aria-label={t("common.pagination_rows_per_page", { label })} value={meta.per_page} onChange={(value) => onPerPageChange(Number(value))} options={[10, 25, 50, 100].map(size => ({ value: size, label: String(size) }))} /></div></label></div>
      <nav aria-label={t("common.pagination_nav", { label })} className="flex items-center gap-2">
        <Button aria-label={t("common.prev_page")} disabled={meta.page <= 1} size="small" variant="secondary" onClick={() => onPageChange(meta.page - 1)}><ChevronLeft size={15} />{t("common.prev")}</Button>
        <span className="min-w-14 text-center font-semibold tabular-nums text-[var(--ink)]">{meta.page} / {pages}</span>
        <Button aria-label={t("common.next_page")} disabled={meta.page >= pages || meta.pages === 0} size="small" variant="secondary" onClick={() => onPageChange(meta.page + 1)}>{t("common.next")}<ChevronRight size={15} /></Button>
      </nav>
    </footer>
  );
};

type ConfirmArchiveDialogProps = {
  description: string;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  pending?: boolean;
  title: string;
};

export const ConfirmArchiveDialog = ({ description, error, onClose, onConfirm, open, pending = false, title }: ConfirmArchiveDialogProps) => {
  const { t } = useTranslation();
  return (
    <Dialog description={description} onClose={onClose} open={open} title={title}>
      {error ? <p className="mb-4 rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{error}</p> : null}
      <div className="flex justify-end gap-3"><Button disabled={pending} variant="secondary" onClick={onClose}>{t("actions.cancel")}</Button><Button disabled={pending} variant="danger" onClick={onConfirm}>{pending ? t("actions.archiving") : t("actions.archive")}</Button></div>
    </Dialog>
  );
};
