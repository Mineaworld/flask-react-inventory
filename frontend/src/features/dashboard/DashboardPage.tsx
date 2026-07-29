import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowUpRight, DollarSign, PackageSearch, ReceiptText, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "../../components/ui/Badge";
import { DataTable } from "../../components/ui/DataTable";
import { apiClient, ApiError } from "../../lib/api";
import { formatCurrency, formatQuantity } from "../../lib/format";
import type { DashboardActivity, DashboardData, DashboardRange, Role, StockMovement } from "../../types/api";

type DashboardPageProps = {
  role: Role;
};

const rangeDays: Record<DashboardRange, number> = { today: 1, week: 7, month: 30 };
const rangeLabels: Record<DashboardRange, string> = { today: "Today", week: "Week", month: "Month" };

function managerData(data: DashboardData): data is DashboardData & Required<Pick<DashboardData, "activity" | "draft_purchase_count" | "draft_sale_count" | "latest_movements" | "purchases_total_usd" | "sales_total_usd" | "stock_value_usd">> {
  return typeof data.stock_value_usd === "string"
    && typeof data.sales_total_usd === "string"
    && typeof data.purchases_total_usd === "string"
    && Array.isArray(data.activity)
    && Array.isArray(data.latest_movements)
    && typeof data.draft_purchase_count === "number"
    && typeof data.draft_sale_count === "number";
}

const MetricCard = ({ icon, label, value, tone = "olive" }: { icon: ReactNode; label: string; tone?: "olive" | "teal" | "amber"; value: string }) => {
  const tones = {
    olive: "bg-[var(--olive-soft)] text-[var(--olive-strong)]",
    teal: "bg-[var(--teal-soft)] text-[var(--teal)]",
    amber: "bg-[var(--amber-soft)] text-[var(--amber-strong)]",
  } as const;
  return (
    <article className="surface-panel p-5">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-[var(--muted)]">{label}</p><span className={`grid size-9 place-items-center rounded-lg ${tones[tone]}`}>{icon}</span></div>
      <p className="mt-4 font-display text-2xl font-semibold leading-none tracking-[-0.04em] text-[var(--ink)] tabular-nums">{value}</p>
    </article>
  );
};

function zeroFilledActivity(activity: DashboardActivity[], periodDays: number): DashboardActivity[] {
  const totalsByDate = new Map(activity.map((entry) => [entry.date, entry]));
  const latestDate = activity.at(-1)?.date;
  const endDate = latestDate ? new Date(`${latestDate}T00:00:00Z`) : new Date();
  const fallbackEnd = Number.isNaN(endDate.getTime()) ? new Date() : endDate;

  return Array.from({ length: periodDays }, (_, index) => {
    const date = new Date(fallbackEnd);
    date.setUTCDate(fallbackEnd.getUTCDate() - (periodDays - index - 1));
    const key = date.toISOString().slice(0, 10);
    return totalsByDate.get(key) ?? { date: key, sales_usd: "0", purchases_usd: "0" };
  });
}

function trendPoints(activity: DashboardActivity[], field: "sales_usd" | "purchases_usd", max: number): string {
  const spacing = 320 / Math.max(activity.length - 1, 1);
  return activity.map((entry, index) => `${index * spacing},${80 - (Number(entry[field]) / max) * 62}`).join(" ");
}

const ActivityChart = ({ activity, periodDays }: { activity: DashboardActivity[]; periodDays: number }) => {
  const points = zeroFilledActivity(activity, periodDays);
  const values = points.flatMap((entry) => [Number(entry.sales_usd), Number(entry.purchases_usd)]);
  const max = Math.max(...values, 1);
  const salesTotal = points.reduce((total, entry) => total + Number(entry.sales_usd), 0);
  const purchasesTotal = points.reduce((total, entry) => total + Number(entry.purchases_usd), 0);

  return (
    <figure aria-label="Sales and purchases trend" className="mt-7" role="img">
      <svg aria-hidden="true" className="h-32 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 320 96">
        <line stroke="var(--line)" strokeDasharray="3 5" x1="0" x2="320" y1="80" y2="80" />
        <line stroke="var(--line)" strokeDasharray="3 5" x1="0" x2="320" y1="49" y2="49" />
        <polyline fill="none" points={trendPoints(points, "sales_usd", max)} stroke="var(--teal)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <polyline fill="none" points={trendPoints(points, "purchases_usd", max)} stroke="var(--amber)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]"><span className="flex items-center gap-3"><span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-full bg-[var(--teal)]" />Sales</span><span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-full bg-[var(--amber)]" />Purchases</span></span><span>{formatCurrency(salesTotal, "USD")} sales · {formatCurrency(purchasesTotal, "USD")} purchases</span></figcaption>
    </figure>
  );
};

const MovementFeed = ({ movements }: { movements: StockMovement[] }) => (
  <div className="divide-y divide-[var(--line)]">
    {movements.length === 0 ? <p className="py-8 text-sm text-[var(--muted)]">Nothing has moved through stock yet.</p> : movements.slice(0, 5).map((movement) => {
      const increase = Number(movement.quantity_delta) >= 0;
      return (
        <article className="flex items-center gap-3 py-3" key={movement.id}>
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${increase ? "bg-[var(--teal-soft)] text-[var(--teal)]" : "bg-[var(--coral-soft)] text-[var(--coral)]"}`}>{increase ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--ink)]" title={movement.product_name || "Unknown product"}>{movement.product_name || "Unknown product"}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{movement.reason || movement.movement_type.replace("_", " ")}</p></div>
          <span className={`text-sm font-bold tabular-nums ${increase ? "text-[var(--teal)]" : "text-[var(--coral)]"}`}>{increase ? "+" : ""}{formatQuantity(movement.quantity_delta)}</span>
        </article>
      );
    })}
  </div>
);

export const DashboardPage = ({ role }: DashboardPageProps) => {
  const [range, setRange] = useState<DashboardRange>("month");
  const dashboardQuery = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiClient.get<DashboardData>(`/dashboard?range=${range}`), retry: false });
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  if (dashboardQuery.isPending) {
    return <div className="grid gap-5 lg:grid-cols-3" aria-label="Loading dashboard"><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /></div>;
  }
  if (dashboardQuery.isError || !dashboardQuery.data) {
    const message = dashboardQuery.error instanceof ApiError ? dashboardQuery.error.message : "Dashboard data could not be loaded.";
    return <section className="rounded-xl bg-[var(--coral-soft)] p-6 shadow-[inset_0_0_0_1px_var(--coral)]"><h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Dashboard unavailable</h1><p className="mt-2 text-sm text-[var(--coral-strong)]">{message}</p></section>;
  }

  const data = dashboardQuery.data;
  const canSeeManagerMetrics = (role === "admin" || role === "manager") && managerData(data);
  const ownDrafts = data.own_draft_sale_count || 0;
  const periodDays = data.period_days ?? rangeDays[range];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="page-title flex items-baseline gap-3">Today&apos;s stock pulse<span className="text-sm font-medium text-[var(--muted)]">{today}</span></h1>
        <div className="flex flex-wrap items-center gap-2"><div aria-label="Dashboard period" className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]">{(Object.keys(rangeLabels) as DashboardRange[]).map((option) => <button aria-pressed={range === option} className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] ${range === option ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"}`} key={option} onClick={() => setRange(option)} type="button">{rangeLabels[option]}</button>)}</div><Badge tone="olive"><span className="size-1.5 rounded-full bg-current" />{periodDays}-day period</Badge></div>
      </header>

      {canSeeManagerMetrics ? (
        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard icon={<PackageSearch size={18} />} label="Stock value" value={formatCurrency(data.stock_value_usd, "USD")} />
          <MetricCard icon={<TrendingUp size={18} />} label={`Sales · ${rangeLabels[range]}`} tone="teal" value={formatCurrency(data.sales_total_usd, "USD")} />
          <MetricCard icon={<DollarSign size={18} />} label={`Purchases · ${rangeLabels[range]}`} tone="amber" value={formatCurrency(data.purchases_total_usd, "USD")} />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
        <article className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">Low stock</h2><Badge tone={data.low_stock_count > 0 ? "warning" : "success"}>{data.low_stock_count} item{data.low_stock_count === 1 ? "" : "s"}</Badge></div>
          <div className="border-t border-[var(--line)]">
            {data.low_stock.length === 0 ? <p className="px-5 py-8 text-sm text-[var(--teal)]">All products are above reorder level.</p> : (
              <DataTable>
                <thead><tr className="bg-[var(--canvas)] text-xs uppercase tracking-[0.07em] text-[var(--muted)]"><th className="px-5 py-3 font-semibold">Product</th><th className="px-5 py-3 text-right font-semibold">On hand</th><th className="px-5 py-3 text-right font-semibold">Reorder</th></tr></thead>
                <tbody>{data.low_stock.map((item) => <tr className="data-row border-t border-[var(--line)]" key={item.product_id}><td className="px-5 py-3"><p className="font-semibold text-[var(--ink)]">{item.product_name}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{item.unit}</p></td><td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--coral-strong)]">{formatQuantity(item.quantity)}</td><td className="px-5 py-3 text-right tabular-nums text-[var(--muted)]">{formatQuantity(item.reorder_level)}</td></tr>)}</tbody>
              </DataTable>
            )}
          </div>
        </article>
        <article className="rounded-2xl bg-[var(--ink)] p-5 text-[var(--on-ink)] shadow-[var(--shadow-elevated)] sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold tracking-[-0.03em]">Open drafts</h2><ReceiptText className="text-[var(--on-ink-muted)]" size={19} /></div>
          {canSeeManagerMetrics ? <dl className="mt-7 grid grid-cols-2 divide-x divide-white/10"><div className="pr-4"><dd className="font-display text-3xl font-semibold tabular-nums">{data.draft_purchase_count}</dd><dt className="mt-2 text-xs text-[var(--on-ink-muted)]">Purchases</dt></div><div className="pl-4"><dd className="font-display text-3xl font-semibold tabular-nums">{data.draft_sale_count}</dd><dt className="mt-2 text-xs text-[var(--on-ink-muted)]">Sales</dt></div></dl> : <p className="mt-7 font-display text-xl font-semibold">{ownDrafts} sale draft{ownDrafts === 1 ? "" : "s"} need your attention</p>}
        </article>
      </section>

      {canSeeManagerMetrics ? <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]"><article className="surface-panel p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">Sales and purchases</h2><Activity size={19} className="text-[var(--olive)]" /></div><ActivityChart activity={data.activity} periodDays={periodDays} /></article><article className="surface-panel p-5 sm:p-6"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">Recent movements</h2><MovementFeed movements={data.latest_movements} /></article></section> : null}
    </div>
  );
};
