import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowUpRight, DollarSign, PackageSearch, ReceiptText, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "../../components/ui/Badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { DataTable } from "../../components/ui/DataTable";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { apiClient, ApiError } from "../../lib/api";
import { formatCurrency, formatQuantity } from "../../lib/format";
import type { DashboardActivity, DashboardData, DashboardRange, Role, StockMovement } from "../../types/api";

type DashboardPageProps = {
  role: Role;
};

const rangeDays: Record<DashboardRange, number> = { today: 1, week: 7, month: 30 };
const dashboardRanges: DashboardRange[] = ["today", "week", "month"];

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

const ActivityChart = ({ activity, periodDays }: { activity: DashboardActivity[]; periodDays: number }) => {
  const { t, i18n } = useTranslation();
  const points = zeroFilledActivity(activity, periodDays);
  
  const chartConfig = {
    sales: {
      label: t("dashboard.sales"),
      color: "var(--teal)",
    },
    purchases: {
      label: t("dashboard.purchases"),
      color: "var(--amber)",
    },
  } satisfies ChartConfig;
  
  // Convert string values to numbers for recharts
  const chartData = points.map((p) => ({
    date: p.date,
    sales: Number(p.sales_usd),
    purchases: Number(p.purchases_usd)
  }));
  
  const salesTotal = chartData.reduce((total, entry) => total + entry.sales, 0);
  const purchasesTotal = chartData.reduce((total, entry) => total + entry.purchases, 0);

  return (
    <figure aria-label={t("dashboard.trend_label")} className="mt-7" role="figure">
      <ChartContainer config={chartConfig} className="h-48 w-full">
        <AreaChart
          accessibilityLayer
          data={chartData}
          margin={{
            left: 0,
            right: 0,
            top: 10,
            bottom: 0,
          }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => {
              const date = new Date(value);
              return new Intl.DateTimeFormat(i18n.language === "km" ? "km-KH" : "en-US", {
                month: "short",
                day: "numeric",
              }).format(date);
            }}
            className="text-sm text-[var(--muted)]"
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent 
                indicator="dot"
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return new Intl.DateTimeFormat(i18n.language === "km" ? "km-KH" : "en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }).format(date);
                }}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="sales"
            stroke="var(--color-sales)"
            fill="var(--color-sales)"
            fillOpacity={0.1}
            strokeWidth={3}
          />
          <Area
            type="monotone"
            dataKey="purchases"
            stroke="var(--color-purchases)"
            fill="var(--color-purchases)"
            fillOpacity={0.1}
            strokeWidth={3}
          />
        </AreaChart>
      </ChartContainer>
      <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--muted)]">
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-full bg-[var(--teal)]" />{t("dashboard.sales")}</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-full bg-[var(--amber)]" />{t("dashboard.purchases")}</span>
        </span>
        <span>{formatCurrency(salesTotal, "USD")} {t("dashboard.sales")} · {formatCurrency(purchasesTotal, "USD")} {t("dashboard.purchases")}</span>
      </figcaption>
    </figure>
  );
};

const MovementFeed = ({ movements }: { movements: StockMovement[] }) => {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-[var(--line)]">
      {movements.length === 0 ? <p className="py-8 text-sm text-[var(--muted)]">{t("dashboard.no_movement")}</p> : movements.slice(0, 5).map((movement) => {
        const increase = Number(movement.quantity_delta) >= 0;
        return (
          <article className="flex items-center gap-3 py-3" key={movement.id}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${increase ? "bg-[var(--teal-soft)] text-[var(--teal)]" : "bg-[var(--coral-soft)] text-[var(--coral)]"}`}>{increase ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--ink)]" title={movement.product_name || t("common.unknown_product")}>{movement.product_name || t("common.unknown_product")}</p><p className="mt-0.5 text-sm text-[var(--muted)]">{movement.reason || t(`inventory.movement_types.${movement.movement_type}`)}</p></div>
            <span className={`text-sm font-bold tabular-nums ${increase ? "text-[var(--teal)]" : "text-[var(--coral)]"}`}>{increase ? "+" : ""}{formatQuantity(movement.quantity_delta)}</span>
          </article>
        );
      })}
    </div>
  );
};

export const DashboardPage = ({ role }: DashboardPageProps) => {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<DashboardRange>("month");
  const dashboardQuery = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiClient.get<DashboardData>(`/dashboard?range=${range}`), retry: false });
  const today = new Intl.DateTimeFormat(i18n.language === "km" ? "km-KH" : "en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  if (dashboardQuery.isPending) {
    return <div className="grid gap-5 lg:grid-cols-3" aria-label={t("dashboard.loading")}><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" /></div>;
  }
  if (dashboardQuery.isError || !dashboardQuery.data) {
    const message = dashboardQuery.error instanceof ApiError ? dashboardQuery.error.message : t("dashboard.error_loading");
    return <section className="rounded-xl bg-[var(--coral-soft)] p-6 shadow-[inset_0_0_0_1px_var(--coral)]"><h1 className="font-display text-2xl font-semibold text-[var(--ink)]">{t("dashboard.unavailable")}</h1><p className="mt-2 text-sm text-[var(--coral-strong)]">{message}</p></section>;
  }

  const data = dashboardQuery.data;
  const canSeeManagerMetrics = (role === "admin" || role === "manager") && managerData(data);
  const ownDrafts = data.own_draft_sale_count || 0;
  const periodDays = data.period_days ?? rangeDays[range];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="page-title flex items-baseline gap-3">{t("dashboard.title")}<span className="text-sm font-medium text-[var(--muted)]">{today}</span></h1>
        <div className="flex flex-wrap items-center gap-2"><div aria-label={t("dashboard.period")} className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]">{dashboardRanges.map((option) => <button aria-pressed={range === option} className={`min-h-9 rounded-lg px-3 text-sm font-semibold transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] ${range === option ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"}`} key={option} onClick={() => setRange(option)} type="button">{t(`dashboard.${option}`)}</button>)}</div><Badge tone="olive"><span className="size-1.5 rounded-full bg-current" />{t("dashboard.period", { days: periodDays })}</Badge></div>
      </header>

      {canSeeManagerMetrics ? (
        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard icon={<PackageSearch size={18} />} label={t("dashboard.stock_value")} value={formatCurrency(data.stock_value_usd, "USD")} />
          <MetricCard icon={<TrendingUp size={18} />} label={`${t("dashboard.sales")} · ${t(`dashboard.${range}`)}`} tone="teal" value={formatCurrency(data.sales_total_usd, "USD")} />
          <MetricCard icon={<DollarSign size={18} />} label={`${t("dashboard.purchases")} · ${t(`dashboard.${range}`)}`} tone="amber" value={formatCurrency(data.purchases_total_usd, "USD")} />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
        <article className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{t("dashboard.low_stock")}</h2><Badge tone={data.low_stock_count > 0 ? "warning" : "success"}>{t(data.low_stock_count === 1 ? "dashboard.items" : "dashboard.items_plural", { count: data.low_stock_count })}</Badge></div>
          <div className="border-t border-[var(--line)]">
            {data.low_stock.length === 0 ? <p className="px-5 py-8 text-sm text-[var(--teal)]">{t("dashboard.all_healthy")}</p> : (
              <DataTable>
                <thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-5 py-3 font-semibold">{t("dashboard.table_product")}</th><th className="px-5 py-3 text-right font-semibold">{t("dashboard.table_on_hand")}</th><th className="px-5 py-3 text-right font-semibold">{t("dashboard.table_reorder")}</th></tr></thead>
                <tbody>{data.low_stock.map((item) => <tr className="data-row border-t border-[var(--line)]" key={item.product_id}><td className="px-5 py-3"><p className="font-semibold text-[var(--ink)]">{item.product_name}</p><p className="mt-0.5 text-sm text-[var(--muted)]">{item.unit}</p></td><td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--coral-strong)]">{formatQuantity(item.quantity)}</td><td className="px-5 py-3 text-right tabular-nums text-[var(--muted)]">{formatQuantity(item.reorder_level)}</td></tr>)}</tbody>
              </DataTable>
            )}
          </div>
        </article>
        <article className="rounded-2xl bg-[var(--ink)] p-5 text-[var(--on-ink)] shadow-[var(--shadow-elevated)] sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold tracking-[-0.03em]">{t("dashboard.open_drafts")}</h2><ReceiptText className="text-[var(--on-ink-muted)]" size={19} /></div>
          {canSeeManagerMetrics ? <dl className="mt-7 grid grid-cols-2 divide-x divide-white/10"><div className="pr-4"><dd className="font-display text-3xl font-semibold tabular-nums">{data.draft_purchase_count}</dd><dt className="mt-2 text-sm text-[var(--on-ink-muted)]">{t("dashboard.purchases")}</dt></div><div className="pl-4"><dd className="font-display text-3xl font-semibold tabular-nums">{data.draft_sale_count}</dd><dt className="mt-2 text-sm text-[var(--on-ink-muted)]">{t("dashboard.sales")}</dt></div></dl> : <p className="mt-7 font-display text-xl font-semibold">{t(ownDrafts === 1 ? "dashboard.sale_drafts" : "dashboard.sale_drafts_plural", { count: ownDrafts })}</p>}
        </article>
      </section>

      {canSeeManagerMetrics ? <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]"><article className="surface-panel p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{t("dashboard.sales_purchases")}</h2><Activity size={19} className="text-[var(--olive)]" /></div><ActivityChart activity={data.activity} periodDays={periodDays} /></article><article className="surface-panel p-5 sm:p-6"><h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{t("dashboard.recent_movements")}</h2><MovementFeed movements={data.latest_movements} /></article></section> : null}
    </div>
  );
};
