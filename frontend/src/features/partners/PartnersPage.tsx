import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Edit3, Plus, Search, ShieldCheck, Truck, Users } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "../../components/ui/Badge";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { apiClient } from "../../lib/api";
import type { Partner, Role, SaleCustomerPicker } from "../../types/api";
import { ConfirmArchiveDialog, apiErrorMessage, apiFieldErrors, buildListPath, Pagination, ResourceError } from "../shared/ResourceUi";
import { useTranslation } from "react-i18next";

type PartnersPageProps = { role: Role };
type PartnerTab = "customers" | "suppliers";
type PartnerSort = "name" | "created_at";
type PartnerFormMode = { mode: "create"; tab: PartnerTab } | { mode: "edit"; tab: PartnerTab; partner: Partner };

const partnerSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  contact_name: z.string().trim().max(120, "Contact name is too long.").optional(),
  email: z.string().trim().email("Enter a valid email.").or(z.literal("")).optional(),
  phone: z.string().trim().max(40, "Phone is too long.").optional(),
  address: z.string().trim().max(2000, "Address is too long.").optional(),
});
type PartnerFormValues = z.infer<typeof partnerSchema>;

const managerRoles: Role[] = ["admin", "manager"];
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function canManage(role: Role) { return managerRoles.includes(role); }
function partnerPath(tab: PartnerTab): "/customers" | "/suppliers" { return tab === "customers" ? "/customers" : "/suppliers"; }
function partnerLabel(tab: PartnerTab): "Customer" | "Supplier" { return tab === "customers" ? "Customer" : "Supplier"; }
function partnerValues(partner?: Partner): PartnerFormValues { return { name: partner?.name ?? "", contact_name: partner?.contact_name ?? "", email: partner?.email ?? "", phone: partner?.phone ?? "", address: partner?.address ?? "" }; }
function formatDate(value: string): string { return dateTime.format(new Date(value)); }

const Field = ({ children, error, label }: { children: ReactNode; error?: string; label: string }) => <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-[var(--ink)]"><span className="truncate">{label}</span>{children}{error ? <span className="text-sm font-medium text-[var(--coral-strong)]">{error}</span> : null}</label>;

const PartnerSortButton = ({ active, children, direction, onClick }: { active: boolean; children: ReactNode; direction: "asc" | "desc"; onClick: () => void }) => <button className={`inline-flex items-center gap-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)] ${active ? "text-[var(--olive-strong)]" : "hover:text-[var(--ink)]"}`} type="button" onClick={onClick}>{children}<ChevronsUpDown aria-hidden="true" size={13} /><span className="sr-only">Sort {direction === "asc" ? "ascending" : "descending"}</span></button>;

const PartnerForm = ({ formMode, onClose }: { formMode: PartnerFormMode; onClose: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const partner = formMode.mode === "edit" ? formMode.partner : undefined;
  const tab = formMode.tab;
  const form = useForm<PartnerFormValues>({ defaultValues: partnerValues(partner), resolver: zodResolver(partnerSchema) });
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (values: PartnerFormValues) => partner ? apiClient.patch<Partner>(`${partnerPath(tab)}/${partner.id}`, values) : apiClient.post<Partner>(partnerPath(tab), values),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [tab] }); onClose(); },
  });
  const submit = async (values: PartnerFormValues) => {
    setServerError(null);
    setServerFields({});
    try { await mutation.mutateAsync(values); } catch (error) { setServerError(apiErrorMessage(error, `${partnerLabel(tab)} could not be saved.`)); setServerFields(apiFieldErrors(error)); }
  };
  const fieldError = (field: keyof PartnerFormValues) => form.formState.errors[field]?.message || serverFields[field];
  return <form className="space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>{serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}<div className="grid gap-4 sm:grid-cols-2"><Field label={`${partnerLabel(tab)} name`} error={fieldError("name")}><Input aria-invalid={Boolean(fieldError("name"))} {...form.register("name")} /></Field><Field label="Contact name (optional)" error={fieldError("contact_name")}><Input aria-invalid={Boolean(fieldError("contact_name"))} {...form.register("contact_name")} /></Field><Field label="Email (optional)" error={fieldError("email")}><Input aria-invalid={Boolean(fieldError("email"))} type="email" {...form.register("email")} /></Field><Field label="Phone (optional)" error={fieldError("phone")}><Input aria-invalid={Boolean(fieldError("phone"))} {...form.register("phone")} /></Field></div><Field label="Address (optional)" error={fieldError("address")}><textarea className="form-control min-h-24 px-3 py-2" {...form.register("address")} /></Field><div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={mutation.isPending} type="submit">{mutation.isPending ? t("common.saving") : partner ? t("partners.save_partner", { partner: t(`partners.${partnerLabel(tab).toLowerCase()}`).toLowerCase() }) : t("partners.create_partner", { partner: t(`partners.${partnerLabel(tab).toLowerCase()}`).toLowerCase() })}</Button></div></form>;
};

const StaffCustomerPicker = () => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const path = buildListPath("/customers", { page, perPage, q: query, sort: "name", extra: { for_sale: "true" } });
  const customersQuery = useQuery({ queryKey: ["customers", "for-sale", page, perPage, query], queryFn: () => apiClient.getPage<SaleCustomerPicker>(path), retry: false });
  if (customersQuery.isPending) return <div aria-label="Loading safe customer picker" className="h-48 animate-pulse rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-border)]" />;
  if (customersQuery.isError || !customersQuery.data) return <ResourceError title="Customer picker unavailable" message={apiErrorMessage(customersQuery.error, "Customers could not be loaded.")} onRetry={() => void customersQuery.refetch()} />;
  return <section className="surface-panel overflow-hidden"><div className="surface-toolbar p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--olive-strong)]"><ShieldCheck size={17} />{t("partners.safe_picker")}</div><div className="relative mt-3 max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={t("partners.search_sale_customers")} className="pl-10" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("partners.search_customers")} /></div></div>{customersQuery.data.data.length === 0 ? <EmptyState icon={<Users size={22} />} text={t("partners.no_active_customers")} /> : <DataTable><thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3">{t("partners.customer")}</th><th className="px-4 py-3">{t("partners.reference")}</th></tr></thead><tbody>{customersQuery.data.data.map((customer) => <tr className="data-row border-t border-[var(--line)]" key={customer.id}><td className="px-4 py-3 font-semibold text-[var(--ink)]">{customer.name}</td><td className="px-4 py-3 font-mono text-sm text-[var(--muted)]">{customer.code}</td></tr>)}</tbody></DataTable>}<Pagination label="customers" meta={customersQuery.data.meta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} /></section>;
};

export const PartnersPage = ({ role }: PartnersPageProps) => {
  const { t } = useTranslation();
  const isManager = canManage(role);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PartnerTab>(() => new URLSearchParams(window.location.search).get("tab") === "suppliers" ? "suppliers" : "customers");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sort, setSort] = useState<PartnerSort>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [formMode, setFormMode] = useState<PartnerFormMode | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Partner | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const path = buildListPath(partnerPath(tab), { page, perPage, q: query, sort, direction });
  const partnersQuery = useQuery({ queryKey: [tab, { page, perPage, query, sort, direction }], queryFn: () => apiClient.getPage<Partner>(path), retry: false, enabled: isManager });
  const archiveMutation = useMutation({
    mutationFn: (partner: Partner) => apiClient.patch<Partner>(`${partnerPath(tab)}/${partner.id}`, { is_active: false }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [tab] }); setArchiveTarget(null); setArchiveError(null); },
  });
  const changeSort = (next: PartnerSort) => { setDirection((current) => sort === next ? (current === "asc" ? "desc" : "asc") : "asc"); setSort(next); setPage(1); };
  const archive = async () => { if (!archiveTarget) return; setArchiveError(null); try { await archiveMutation.mutateAsync(archiveTarget); } catch (error) { setArchiveError(apiErrorMessage(error, `${partnerLabel(tab)} could not be archived.`)); } };
  if (!isManager) return <div className="space-y-5"><header><h1 className="page-title">{t("nav.customers")}</h1></header><StaffCustomerPicker /></div>;
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <h1 className="page-title">{t("partners.title")}</h1>
          <div aria-label="Partner sections" className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]">
            <button aria-pressed={tab === "customers"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "customers" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("customers"); setPage(1); setQuery(""); }}>{t("nav.customers")}</button>
            <button aria-pressed={tab === "suppliers"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "suppliers" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("suppliers"); setPage(1); setQuery(""); }}>{t("nav.suppliers")}</button>
          </div>
        </div>
        <Button onClick={() => setFormMode({ mode: "create", tab })}><Plus size={17} />{t("actions.new_item", { item: t(`partners.${partnerLabel(tab).toLowerCase()}`) })}</Button>
      </header>
      <section className="surface-panel overflow-hidden">
        <div className="surface-toolbar p-4"><div className="relative max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={tab === "customers" ? t("partners.search_customers") : t("partners.search_suppliers")} className="pl-10" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "customers" ? t("partners.search_customers") : t("partners.search_suppliers")} /></div></div>
        {partnersQuery.isPending ? <div aria-label={`Loading ${tab}`} className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div> : null}
        {partnersQuery.isError ? <div className="p-4"><ResourceError message={apiErrorMessage(partnersQuery.error, `${partnerLabel(tab)}s could not be loaded.`)} onRetry={() => void partnersQuery.refetch()} /></div> : !partnersQuery.data ? null : partnersQuery.data.data.length === 0 ? <EmptyState icon={tab === "customers" ? <Users size={22} /> : <Truck size={22} />} text={t("partners.no_match", { tab: tab === "customers" ? t("nav.customers").toLowerCase() : t("nav.suppliers").toLowerCase() })} /> : <DataTable><thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><PartnerSortButton active={sort === "name"} direction={direction} onClick={() => changeSort("name")}>{t("partners.name")}</PartnerSortButton></th><th className="px-4 py-3">{t("partners.contact")}</th><th className="px-4 py-3">{t("partners.phone")}</th><th className="px-4 py-3"><PartnerSortButton active={sort === "created_at"} direction={direction} onClick={() => changeSort("created_at")}>{t("partners.created")}</PartnerSortButton></th><th className="px-4 py-3">{t("partners.status")}</th><th className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th></tr></thead><tbody>{partnersQuery.data.data.map((partner) => <tr className="data-row border-t border-[var(--line)]" key={partner.id}><td className="px-4 py-3"><p className="font-semibold text-[var(--ink)]">{partner.name}</p><p className="mt-0.5 text-sm text-[var(--muted)]">{partner.email || "No email"}</p></td><td className="px-4 py-3 text-[var(--muted)]">{partner.contact_name || "-"}</td><td className="px-4 py-3 tabular-nums text-[var(--muted)]">{partner.phone || "-"}</td><td className="px-4 py-3 text-sm text-[var(--muted)]">{formatDate(partner.created_at)}</td><td className="px-4 py-3"><Badge tone={partner.is_active ? "success" : "neutral"}>{partner.is_active ? t("common.active") : t("common.archived")}</Badge></td><td className="px-4 py-3 text-right"><ActionMenu triggerLabel={`More actions for ${partner.name}`} items={[{ icon: <Edit3 size={14} />, label: t("actions.edit"), onSelect: () => setFormMode({ mode: "edit", tab, partner }) }, ...(partner.is_active ? [{ label: t("actions.archive"), onSelect: () => { setArchiveError(null); setArchiveTarget(partner); }, tone: "danger" as const }] : [])]} /></td></tr>)}</tbody></DataTable>}
        {partnersQuery.data ? <Pagination label={tab} meta={partnersQuery.data.meta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} /> : null}
      </section>
      <Dialog description="" onClose={() => setFormMode(null)} open={formMode !== null} title={formMode?.mode === "edit" ? t("actions.edit_item", { item: t(`partners.${partnerLabel(formMode.tab).toLowerCase()}`) }) : t("actions.new_item", { item: formMode ? t(`partners.${partnerLabel(formMode.tab).toLowerCase()}`) : "partner" })}>{formMode ? <PartnerForm formMode={formMode} onClose={() => setFormMode(null)} /> : null}</Dialog>
      <ConfirmArchiveDialog description="" error={archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(null); }} onConfirm={() => void archive()} open={archiveTarget !== null} pending={archiveMutation.isPending} title={t("actions.archive") + " " + t(`partners.${partnerLabel(tab).toLowerCase()}`)} />
    </div>
  );
};

const EmptyState = ({ icon, text }: { icon: ReactNode; text: string }) => <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]">{icon}</span><p className="mt-3 font-semibold text-[var(--ink)]">{text}</p></div></div>;
