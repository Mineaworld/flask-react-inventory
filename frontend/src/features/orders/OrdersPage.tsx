import { useState } from "react";
import type { ReactNode } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FilePlus2, Pencil, Search, ShoppingCart, Truck, XCircle } from "lucide-react";

import { ActionMenu } from "../../components/ui/ActionMenu";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { ApiError, apiClient } from "../../lib/api";
import { formatCurrency, formatExchangeRate, formatQuantity, formatUsdValue } from "../../lib/format";
import type { Purchase, Role, Sale } from "../../types/api";
import { apiErrorMessage, buildListPath, Pagination, ResourceError } from "../shared/ResourceUi";
import { OrderForm } from "./OrderForm";
import { useTranslation } from "react-i18next";

type OrderKind = "purchase" | "sale";
type Order = Purchase | Sale;
type OrderSort = "created_at" | "document_number" | "total_usd";
type ActionName = "cancel" | "receive" | "complete";

type OrdersPageProps = {
  kind: OrderKind;
  role: Role;
};

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : dateFormatter.format(date);
}

function canManage(role: Role): boolean {
  return role === "admin" || role === "manager";
}

function statusTone(status: Order["status"]): "neutral" | "success" | "danger" | "warning" {
  if (status === "received" || status === "completed") return "success";
  if (status === "cancelled") return "danger";
  return "warning";
}

function displayAmount(order: Order): string {
  return formatCurrency(order.total_amount, order.currency);
}

const SortButton = ({ active, children, direction, onClick }: { active: boolean; children: ReactNode; direction: "asc" | "desc"; onClick: () => void }) => (
  <button className={`inline-flex items-center gap-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] ${active ? "text-[var(--olive-strong)]" : "hover:text-[var(--ink)]"}`} type="button" onClick={onClick}>
    {children}<span aria-hidden="true">{active ? (direction === "asc" ? "â†‘" : "â†“") : "↕"}</span>
  </button>
);

const AccessDenied = () => {
  const { t } = useTranslation();
  return (
  <div className="grid min-h-[60vh] place-items-center">
    <section className="surface-panel max-w-lg p-8 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[var(--amber-soft)] text-[var(--amber-strong)]"><Truck size={22} /></span>
      <h1 className="mt-4 text-balance font-display text-2xl font-semibold leading-tight tracking-[-0.04em] text-[var(--ink)]">{t("orders.purchase_restricted")}</h1>
      <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-6 text-[var(--muted)]">{t("orders.purchase_restricted_desc")}</p>
    </section>
  </div>
  );
};

type DetailDialogProps = {
  kind: OrderKind;
  onClose: () => void;
  order: Order;
};

const DetailDialog = ({ kind, onClose, order }: DetailDialogProps) => {
  const { t } = useTranslation();
  const detailQuery = useQuery({
    queryKey: [kind === "purchase" ? "purchases" : "sales", "detail", order.id],
    queryFn: () => apiClient.get<Order>(`/${kind === "purchase" ? "purchases" : "sales"}/${order.id}`),
    retry: false,
  });
  const detail = detailQuery.data;
  return (
    <Dialog description="" onClose={onClose} open title={t("orders.document_title", { kind: kind === "purchase" ? t("orders.purchase") : t("orders.sale"), number: order.document_number })}>
      {detailQuery.isPending ? <div aria-label={t("orders.loading_detail")} className="space-y-3"><div className="h-20 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-28 animate-pulse rounded-xl bg-[var(--canvas)]" /></div> : null}
      {detailQuery.isError ? <ResourceError message={apiErrorMessage(detailQuery.error, t("orders.error_detail"))} onRetry={() => void detailQuery.refetch()} /> : detail ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 rounded-xl bg-[var(--canvas)] p-4 text-sm shadow-[inset_0_0_0_1px_var(--line)]">
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.partner")}</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{kind === "purchase" ? (detail as Purchase).supplier_name : (detail as Sale).customer_name || t("orders.walk_in")}</dd></div>
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.state")}</dt><dd className="mt-1"><Badge tone={statusTone(detail.status)}>{detail.status}</Badge></dd></div>
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.document_total")}</dt><dd className="mt-1 font-bold tabular-nums text-[var(--ink)]">{displayAmount(detail)}</dd></div>
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.usd_total")}</dt><dd className="mt-1 font-bold tabular-nums text-[var(--olive-strong)]">{formatCurrency(detail.total_usd, "USD")}</dd></div>
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.exchange_rate")}</dt><dd className="mt-1 tabular-nums text-[var(--ink)]">{formatExchangeRate(detail.exchange_rate_to_usd)} {detail.currency}/USD</dd></div>
            <div><dt className="text-sm uppercase tracking-wide text-[var(--muted)]">{t("orders.created")}</dt><dd className="mt-1 text-[var(--ink)]">{formatDate(detail.created_at)}</dd></div>
          </dl>
          <div>
            <h3 className="font-display text-base font-bold text-[var(--ink)]">{t("orders.items")}</h3>
            <div className="mt-2 overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_var(--line)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--canvas)] text-sm uppercase tracking-wide text-[var(--muted)]"><tr><th className="px-3 py-2">{t("orders.product")}</th><th className="px-3 py-2 text-right">{t("orders.quantity")}</th><th className="px-3 py-2 text-right">{t("orders.unit")}</th><th className="px-3 py-2 text-right">{t("orders.unit_usd")}</th><th className="px-3 py-2 text-right">{t("orders.line_usd")}</th></tr></thead>
                <tbody>{detail.items.map((item) => {
                  const unitAmount = kind === "purchase" ? (item as Purchase["items"][number]).unit_cost : (item as Sale["items"][number]).unit_price;
                  const unitUsd = kind === "purchase" ? (item as Purchase["items"][number]).unit_cost_usd : (item as Sale["items"][number]).unit_price_usd;
                  return <tr className="data-row border-t border-[var(--line)]" key={item.id}><td className="px-3 py-3 font-semibold text-[var(--ink)]">{item.product_name || `${t("orders.product")} ${item.product_id}`}</td><td className="px-3 py-3 text-right tabular-nums">{formatQuantity(item.quantity)}</td><td className="px-3 py-3 text-right tabular-nums">{formatCurrency(unitAmount, detail.currency)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums text-[var(--olive-strong)]">${formatUsdValue(unitUsd)}</td><td className="px-3 py-3 text-right font-bold tabular-nums text-[var(--ink)]">{formatCurrency(item.line_total_usd, "USD")}</td></tr>;
                })}</tbody>
              </table>
            </div>
          </div>
          {detail.notes ? <div className="rounded-xl bg-[var(--canvas)] p-3 shadow-[inset_0_0_0_1px_var(--line)]"><p className="compact-label">{t("orders.notes")}</p><p className="mt-1 break-words text-sm text-[var(--ink)]">{detail.notes}</p></div> : null}
          <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{t("orders.close")}</Button></div>
        </div>
      ) : null}
    </Dialog>
  );
};

type ConfirmActionDialogProps = {
  action: ActionName;
  kind: OrderKind;
  onClose: () => void;
  order: Order;
};

const ConfirmActionDialog = ({ action, kind, onClose, order }: ConfirmActionDialogProps) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const basePath = `/${kind === "purchase" ? "purchases" : "sales"}/${order.id}`;
  const title = action === "receive" ? t("orders.receive_purchase") : action === "complete" ? t("orders.complete_sale") : kind === "purchase" ? t("orders.cancel_purchase") : t("orders.cancel_sale");
  const mutation = useMutation({
    mutationFn: () => action === "cancel"
      ? apiClient.patch<Order>(basePath, { status: "cancelled" })
      : apiClient.post<Order>(`${basePath}/${action}`),
    onSuccess: async () => {
      const listKey = kind === "purchase" ? "purchases" : "sales";
      const invalidations = [queryClient.invalidateQueries({ queryKey: [listKey] })];
      if (action === "receive" || action === "complete") {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["inventory", "stock"] }),
          queryClient.invalidateQueries({ queryKey: ["inventory", "movements"] }),
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        );
      }
      await Promise.all(invalidations);
      onClose();
    },
  });
  const confirm = async () => {
    setError(null);
    try { await mutation.mutateAsync(); } catch (nextError) { setError(nextError); }
  };
  const insufficientStock = error instanceof ApiError && error.code === "insufficient_stock";
  const description = action === "receive"
    ? t("orders.receive_desc")
    : action === "complete"
      ? t("orders.complete_desc")
      : t("orders.cancel_desc", { kind: kind === "purchase" ? t("orders.purchase").toLowerCase() : t("orders.sale").toLowerCase() });
  return (
    <Dialog description={description} onClose={onClose} open title={title}>
      {error ? <div className="mb-4 rounded-xl bg-[var(--coral-soft)] p-3 shadow-[inset_0_0_0_1px_var(--coral)]" role="alert"><p className="font-semibold text-[var(--coral-strong)]">{apiErrorMessage(error, t("orders.error_action"))}</p>{insufficientStock ? <p className="mt-1 text-sm text-[var(--coral-strong)]">{t("orders.error_stock")}</p> : null}</div> : null}
      <div className="rounded-xl bg-[var(--canvas)] p-3 text-sm shadow-[inset_0_0_0_1px_var(--line)]"><p className="font-semibold text-[var(--ink)]">{t("orders.document_title", { kind: kind === "purchase" ? t("orders.purchase") : t("orders.sale"), number: order.document_number })}</p><p className="mt-1 tabular-nums text-[var(--muted)]">{displayAmount(order)} · {t("orders.usd_total")} {formatCurrency(order.total_usd, "USD")}</p></div>
      <div className="mt-5 flex justify-end gap-3"><Button disabled={mutation.isPending} variant="secondary" onClick={onClose}>{t("orders.back")}</Button><Button disabled={mutation.isPending} variant={action === "cancel" ? "danger" : "primary"} onClick={() => void confirm()}>{mutation.isPending ? t("orders.working") : title}</Button></div>
    </Dialog>
  );
};

const OrdersPage = ({ kind, role }: OrdersPageProps) => {
  const { t } = useTranslation();
  const manager = canManage(role);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sort, setSort] = useState<OrderSort>("created_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [detailTarget, setDetailTarget] = useState<Order | null>(null);
  const [editTarget, setEditTarget] = useState<Order | "create" | null>(null);
  const [actionTarget, setActionTarget] = useState<{ action: ActionName; order: Order } | null>(null);
  const resource = kind === "purchase" ? "purchases" : "sales";
  const singular = kind === "purchase" ? "purchase" : "sale";
  const path = buildListPath(`/${resource}`, { page, perPage, q: query, sort, direction });
  const ordersQuery = useQuery({ queryKey: [resource, { page, perPage, query, sort, direction }], queryFn: () => apiClient.getPage<Order>(path), retry: false });

  const changeSort = (next: OrderSort) => {
    setDirection((current) => sort === next ? (current === "asc" ? "desc" : "asc") : next === "created_at" ? "desc" : "asc");
    setSort(next);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="page-title">{kind === "purchase" ? t("nav.purchases") : t("nav.sales")}</h1></div>
        <Button onClick={() => setEditTarget("create")}><FilePlus2 size={17} />{t("actions.new_item", { item: t(`orders.${singular}`) })}</Button>
      </header>
      {kind === "sale" && role === "staff" ? <div><Badge tone="olive">{t("orders.your_drafts_only")}</Badge></div> : null}
      <section className="surface-panel overflow-hidden">
        <div className="surface-toolbar p-4"><div className="relative max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={`Search ${resource}`} className="pl-10" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("orders.search_number", { singular: t(`orders.${singular}`).toLowerCase() })} /></div></div>
        {ordersQuery.isPending ? <div aria-label={`Loading ${resource}`} className="space-y-2 p-4"><div className="h-16 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-16 animate-pulse rounded-xl bg-[var(--canvas)]" /></div> : null}
        {ordersQuery.isError ? <div className="p-4"><ResourceError message={apiErrorMessage(ordersQuery.error, `${resource} could not be loaded.`)} onRetry={() => void ordersQuery.refetch()} /></div> : !ordersQuery.data ? null : ordersQuery.data.data.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]">{kind === "purchase" ? <Truck size={20} /> : <ShoppingCart size={20} />}</span><p className="mt-3 font-semibold text-[var(--ink)]">{t("common.empty_orders", { item: t(`nav.${resource}`).toLowerCase() })}</p></div></div>
        ) : (
          <DataTable>
            <thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><SortButton active={sort === "document_number"} direction={direction} onClick={() => changeSort("document_number")}>{t("orders.document")}</SortButton></th><th className="px-4 py-3">{kind === "purchase" ? t("orders.supplier") : t("orders.customer")}</th><th className="px-4 py-3">{t("orders.state")}</th><th className="px-4 py-3 text-right">{t("orders.currency_total")}</th><th className="px-4 py-3 text-right"><SortButton active={sort === "total_usd"} direction={direction} onClick={() => changeSort("total_usd")}>{t("orders.usd_total")}</SortButton></th><th className="px-4 py-3"><SortButton active={sort === "created_at"} direction={direction} onClick={() => changeSort("created_at")}>{t("orders.created")}</SortButton></th><th className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th></tr></thead>
            <tbody>{ordersQuery.data.data.map((order) => {
              const draft = order.status === "draft";
              const partnerName = kind === "purchase" ? (order as Purchase).supplier_name : (order as Sale).customer_name || t("orders.walk_in");
              const actionItems = [
                { icon: <Eye size={14} />, label: t("actions.view_details"), onSelect: () => setDetailTarget(order) },
                ...(draft ? [{ icon: <Pencil size={14} />, label: t("actions.edit"), onSelect: () => setEditTarget(order) }] : []),
                ...(draft && kind === "purchase" ? [{ icon: <Truck size={14} />, label: t("actions.receive"), onSelect: () => setActionTarget({ action: "receive", order }), tone: "success" as const }] : []),
                ...(draft && kind === "sale" && manager ? [{ icon: <ShoppingCart size={14} />, label: t("actions.complete"), onSelect: () => setActionTarget({ action: "complete", order }), tone: "success" as const }] : []),
                ...(draft ? [{ icon: <XCircle size={14} />, label: t("actions.cancel"), onSelect: () => setActionTarget({ action: "cancel", order }), tone: "danger" as const }] : []),
              ];
              return (
                <tr className="data-row border-t border-[var(--line)]" key={order.id}>
                  <td className="px-4 py-3"><p className="font-mono text-sm font-bold text-[var(--ink)]">{order.document_number}</p><p className="mt-1 text-sm text-[var(--muted)]">{order.items.length === 1 ? t("orders.lines_one", { count: order.items.length }) : t("orders.lines_other", { count: order.items.length })}</p></td>
                  <td className="px-4 py-3 font-semibold text-[var(--ink)]">{partnerName}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(order.status)}>{order.status}</Badge></td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">{displayAmount(order)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--olive-strong)]">{formatCurrency(order.total_usd, "USD")}</td>
                  <td className="px-4 py-3 text-sm text-[var(--muted)]">{formatDate(order.created_at)}</td>
                  <td className="px-4 py-3 text-right"><ActionMenu items={actionItems} triggerLabel={`More actions for ${order.document_number}`} /></td>
                </tr>
              );
            })}</tbody>
          </DataTable>
        )}
        {ordersQuery.data ? <Pagination label={resource} meta={ordersQuery.data.meta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} /> : null}
      </section>
      {detailTarget ? <DetailDialog kind={kind} onClose={() => setDetailTarget(null)} order={detailTarget} /> : null}
      <Dialog description="" onClose={() => setEditTarget(null)} open={editTarget !== null} title={editTarget === "create" ? t("actions.new_item", { item: t(`orders.${singular}`) }) : t("actions.edit_item", { item: t(`orders.${singular}`) })}>
        {editTarget ? <OrderForm kind={kind} onClose={() => setEditTarget(null)} order={editTarget === "create" ? undefined : editTarget} role={role} /> : null}
      </Dialog>
      {actionTarget ? <ConfirmActionDialog action={actionTarget.action} kind={kind} onClose={() => setActionTarget(null)} order={actionTarget.order} /> : null}
    </div>
  );
};

export const PurchasePage = ({ role }: { role: Role }) => role === "staff" ? <AccessDenied /> : <OrdersPage kind="purchase" role={role} />;
export const SalesPage = ({ role }: { role: Role }) => <OrdersPage kind="sale" role={role} />;
