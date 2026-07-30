import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, PackageSearch, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { apiClient } from "../../lib/api";
import { formatQuantity } from "../../lib/format";
import type { Product, Role, StockMovement, StockRecord } from "../../types/api";
import { apiErrorMessage, apiFieldErrors, buildListPath, Pagination, ResourceError } from "../shared/ResourceUi";

type InventoryPageProps = { role: Role };
type InventoryTab = "stock" | "movements";
type AdjustmentValues = { direction: "in" | "out"; product_id: string; quantity: string; reason: string; unit_cost_usd?: string };

const adjustmentSchema = z.object({
  product_id: z.string().regex(/^\d+$/, "inventory.error_select_product"),
  direction: z.enum(["in", "out"]),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "inventory.error_positive_quantity").refine((value) => Number(value) > 0, "inventory.error_greater_zero"),
  unit_cost_usd: z.string().regex(/^\d*(\.\d+)?$/, "inventory.error_usd_value").optional(),
  reason: z.string().trim().min(1, "inventory.error_reason_required").max(255, "inventory.error_reason_long"),
});

const managerRoles: Role[] = ["admin", "manager"];
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function canManage(role: Role) { return managerRoles.includes(role); }
function isLowStock(stock: StockRecord): boolean { return Number(stock.quantity) <= Number(stock.reorder_level); }
function formatDate(value: string | null): string { return value ? dateTime.format(new Date(value)) : ""; }

const Field = ({ children, error, label }: { children: ReactNode; error?: string; label: string }) => <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]"><span>{label}</span>{children}{error ? <span className="text-sm font-medium text-[var(--coral-strong)]">{error}</span> : null}</label>;

const AdjustmentForm = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const form = useForm<AdjustmentValues>({ defaultValues: { direction: "in", product_id: "", quantity: "", reason: "", unit_cost_usd: "" }, resolver: zodResolver(adjustmentSchema) });
  const productsQuery = useQuery({ queryKey: ["products", "adjustment"], queryFn: () => apiClient.getPage<Product>(buildListPath("/products", { page: 1, perPage: 100, sort: "name" })), retry: false });
  const mutation = useMutation({
    mutationFn: (values: AdjustmentValues) => {
      const payload: { direction: "in" | "out"; product_id: number; quantity: string; reason: string; unit_cost_usd?: string } = { direction: values.direction, product_id: Number(values.product_id), quantity: values.quantity, reason: values.reason };
      if (values.unit_cost_usd?.trim()) payload.unit_cost_usd = values.unit_cost_usd.trim();
      return apiClient.post<StockMovement>("/inventory/adjustments", payload);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", "stock"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", "movements"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      onClose();
    },
  });
  const submit = async (values: AdjustmentValues) => {
    setServerError(null); setServerFields({});
    try { await mutation.mutateAsync(values); } catch (error) { setServerError(apiErrorMessage(error, t("inventory.error_save"))); setServerFields(apiFieldErrors(error)); }
  };
  const fieldError = (field: keyof AdjustmentValues) => {
    const errorMsg = form.formState.errors[field]?.message;
    return errorMsg ? t(errorMsg) : serverFields[field];
  };
  const products = (productsQuery.data?.data ?? []).filter((product) => product.is_active);
  return <form className="space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>{serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}<Field label={t("inventory.form_product")} error={fieldError("product_id")}><Controller name="product_id" control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(fieldError("product_id"))} placeholder={t("inventory.form_select_product")} options={[{ value: "", label: t("inventory.form_select_product") }, ...products.map(p => ({ value: String(p.id), label: `${p.name} (${p.sku})` }))]} />} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label={t("inventory.form_direction")} error={fieldError("direction")}><Controller name="direction" control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(fieldError("direction"))} options={[{ value: "in", label: t("inventory.form_increase") }, { value: "out", label: t("inventory.form_decrease") }]} />} /></Field><Field label={t("inventory.form_quantity")} error={fieldError("quantity")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("quantity"))} {...form.register("quantity")} /></Field></div><Field label={t("inventory.form_unit_cost")} error={fieldError("unit_cost_usd")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("unit_cost_usd"))} placeholder={t("inventory.form_use_default")} {...form.register("unit_cost_usd")} /></Field><Field label={t("inventory.form_reason")} error={fieldError("reason")}><Input aria-invalid={Boolean(fieldError("reason"))} placeholder={t("inventory.form_count_correction")} {...form.register("reason")} /></Field><div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={mutation.isPending || productsQuery.isPending} type="submit">{mutation.isPending ? t("common.saving") : t("inventory.save_adjustment")}</Button></div></form>;
};

export const InventoryPage = ({ role }: InventoryPageProps) => {
  const { t } = useTranslation();
  const manager = canManage(role);
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [stockSort, setStockSort] = useState<"name" | "quantity">("name");
  const [movementSort, setMovementSort] = useState<"created_at" | "quantity_delta">("created_at");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [lowOnly, setLowOnly] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const stockPath = buildListPath("/inventory/stock", { page, perPage, q: query, sort: stockSort, direction, extra: { low_stock: lowOnly ? "true" : undefined } });
  const movementPath = buildListPath("/inventory/movements", { page, perPage, q: query, sort: movementSort, direction });
  const stockQuery = useQuery({ queryKey: ["inventory", "stock", { page, perPage, query, stockSort, direction, lowOnly }], queryFn: () => apiClient.getPage<StockRecord>(stockPath), retry: false, enabled: tab === "stock" });
  const movementsQuery = useQuery({ queryKey: ["inventory", "movements", { page, perPage, query, movementSort, direction }], queryFn: () => apiClient.getPage<StockMovement>(movementPath), retry: false, enabled: manager && tab === "movements" });
  const activeQuery = tab === "stock" ? stockQuery : movementsQuery;
  const activeMeta = activeQuery.data?.meta;
  const setSort = (value: "name" | "quantity" | "created_at" | "quantity_delta") => {
    if (tab === "stock") { const next = value as "name" | "quantity"; setDirection((current) => stockSort === next ? (current === "asc" ? "desc" : "asc") : "asc"); setStockSort(next); } else { const next = value as "created_at" | "quantity_delta"; setDirection((current) => movementSort === next ? (current === "asc" ? "desc" : "asc") : "asc"); setMovementSort(next); }
    setPage(1);
  };
  const switchTab = (next: InventoryTab) => { setTab(next); setPage(1); setQuery(""); setLowOnly(false); };
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <h1 className="page-title">{t("inventory.title")}</h1>
          <div aria-label={t("inventory.sections")} className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]"><button aria-pressed={tab === "stock"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "stock" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => switchTab("stock")}>{t("inventory.tabs_on_hand")}</button>{manager ? <button aria-pressed={tab === "movements"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "movements" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => switchTab("movements")}>{t("inventory.tabs_movements")}</button> : null}</div>
        </div>
        {manager ? <Button onClick={() => setAdjustmentOpen(true)}><Plus size={17} />{t("inventory.adjust_stock")}</Button> : null}
      </header>
      {tab === "stock" ? (
        <div className="flex justify-end">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--muted)]"><SlidersHorizontal size={15} /><input checked={lowOnly} className="size-4 accent-[var(--olive)]" type="checkbox" onChange={(event) => { setLowOnly(event.target.checked); setPage(1); }} />{t("inventory.low_stock_only")}</label>
        </div>
      ) : null}
      <section className="surface-panel overflow-hidden"><div className="surface-toolbar p-4"><div className="relative max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={tab === "stock" ? t("inventory.search_stock") : t("inventory.search_movements")} className="pl-10" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("inventory.search_placeholder")} /></div></div>{activeQuery.isPending ? <div aria-label={tab === "stock" ? t("inventory.loading_stock") : t("inventory.loading_movements")} className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div> : null}{activeQuery.isError ? <div className="p-4"><ResourceError message={apiErrorMessage(activeQuery.error, t("inventory.error_loading"))} onRetry={() => void activeQuery.refetch()} /></div> : !activeQuery.data ? null : tab === "stock" ? <StockTable items={stockQuery.data?.data ?? []} sort={stockSort} onSort={setSort} /> : <MovementsTable items={movementsQuery.data?.data ?? []} sort={movementSort} onSort={setSort} />}{activeMeta ? <Pagination label={tab === "stock" ? t("inventory.stock_records") : t("inventory.movements_records")} meta={activeMeta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} /> : null}</section>
      <Dialog description="" onClose={() => setAdjustmentOpen(false)} open={adjustmentOpen} title={t("inventory.adjust_stock")}>{adjustmentOpen ? <AdjustmentForm onClose={() => setAdjustmentOpen(false)} /> : null}</Dialog>
    </div>
  );
};

const StockTable = ({ items, onSort, sort }: { items: StockRecord[]; onSort: (sort: "name" | "quantity") => void; sort: "name" | "quantity" }) => {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyState icon={<PackageSearch size={22} />} text={t("inventory.empty_stock")} />;
  return <DataTable><thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><SortHeader active={sort === "name"} onClick={() => onSort("name")}>{t("inventory.table_product")}</SortHeader></th><th className="px-4 py-3">{t("inventory.table_sku")}</th><th className="px-4 py-3 text-right"><SortHeader active={sort === "quantity"} onClick={() => onSort("quantity")}>{t("inventory.table_on_hand")}</SortHeader></th><th className="px-4 py-3 text-right">{t("inventory.table_reorder")}</th><th className="px-4 py-3">{t("inventory.table_health")}</th><th className="px-4 py-3">{t("inventory.table_last_movement")}</th></tr></thead><tbody>{items.map((stock) => { const low = isLowStock(stock); return <tr className="data-row border-t border-[var(--line)]" key={stock.product_id}><td className="px-4 py-3"><p className="font-semibold text-[var(--ink)]">{stock.product_name}</p><p className="mt-0.5 text-sm text-[var(--muted)]">{stock.unit}</p></td><td className="px-4 py-3 font-mono text-sm text-[var(--muted)]">{stock.sku}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${low ? "text-[var(--coral-strong)]" : "text-[var(--ink)]"}`}>{formatQuantity(stock.quantity)}</td><td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">{formatQuantity(stock.reorder_level)}</td><td className="px-4 py-3"><Badge tone={low ? "warning" : "success"}>{low ? t("inventory.badge_reorder") : t("inventory.badge_healthy")}</Badge></td><td className="px-4 py-3 text-sm text-[var(--muted)]">{stock.updated_at ? formatDate(stock.updated_at) : t("inventory.no_movement")}</td></tr>; })}</tbody></DataTable>;
};

const MovementsTable = ({ items, onSort, sort }: { items: StockMovement[]; onSort: (sort: "created_at" | "quantity_delta") => void; sort: "created_at" | "quantity_delta" }) => {
  const { t } = useTranslation();
  if (items.length === 0) return <EmptyState icon={<History size={22} />} text={t("inventory.empty_movements")} />;
  return <DataTable><thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><SortHeader active={sort === "created_at"} onClick={() => onSort("created_at")}>{t("inventory.table_when")}</SortHeader></th><th className="px-4 py-3">{t("inventory.table_product")}</th><th className="px-4 py-3">{t("inventory.table_event")}</th><th className="px-4 py-3 text-right"><SortHeader active={sort === "quantity_delta"} onClick={() => onSort("quantity_delta")}>{t("inventory.table_change")}</SortHeader></th><th className="px-4 py-3">{t("inventory.table_reason")}</th></tr></thead><tbody>{items.map((movement) => { const incoming = Number(movement.quantity_delta) >= 0; const outgoing = movement.movement_type === "sale_issue" || movement.movement_type === "adjustment_out"; return <tr className="data-row border-t border-[var(--line)]" key={movement.id}><td className="px-4 py-3 text-sm text-[var(--muted)]">{formatDate(movement.created_at)}</td><td className="px-4 py-3 font-semibold text-[var(--ink)]">{movement.product_name || t("common.unknown_product")}</td><td className="px-4 py-3"><Badge tone={outgoing ? "danger" : "success"}>{t(`inventory.movement_types.${movement.movement_type}`)}</Badge></td><td className={`px-4 py-3 text-right font-bold tabular-nums ${incoming ? "text-[var(--teal)]" : "text-[var(--coral-strong)]"}`}>{incoming ? "+" : ""}{formatQuantity(movement.quantity_delta)}</td><td className="px-4 py-3 text-sm text-[var(--muted)]">{movement.reason || t("inventory.document_movement")}</td></tr>; })}</tbody></DataTable>;
};

const SortHeader = ({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) => <button className={`inline-flex items-center gap-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] ${active ? "text-[var(--olive-strong)]" : "hover:text-[var(--ink)]"}`} type="button" onClick={onClick}>{children}<span aria-hidden="true">{active ? "↕" : "↕"}</span></button>;
const EmptyState = ({ icon, text }: { icon: ReactNode; text: string }) => <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]">{icon}</span><p className="mt-3 font-semibold text-[var(--ink)]">{text}</p></div></div>;
