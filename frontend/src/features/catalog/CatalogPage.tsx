import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Edit3, Filter, PackagePlus, Plus, Search, Tags } from "lucide-react";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Badge } from "../../components/ui/Badge";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { apiClient } from "../../lib/api";
import { formatCurrency, formatQuantity } from "../../lib/format";
import type { Category, Product, Role } from "../../types/api";
import { ConfirmArchiveDialog, apiErrorMessage, apiFieldErrors, buildListPath, Pagination, ResourceError } from "../shared/ResourceUi";

type CatalogPageProps = { role: Role };
type CatalogTab = "products" | "categories";
type ProductSort = "name" | "sku" | "created_at";
type CategorySort = "name" | "created_at";
type FormMode<T> = { mode: "create"; item?: undefined } | { mode: "edit"; item: T };

const productSchema = z.object({
  name: z.string().trim().min(1, "catalog.error_product_name"),
  sku: z.string().trim().min(1, "catalog.error_sku"),
  barcode: z.string().trim().max(80, "catalog.error_barcode").optional(),
  category_id: z.string().regex(/^\d+$/, "catalog.error_category"),
  unit: z.string().trim().min(1, "catalog.error_unit"),
  reorder_level: z.string().regex(/^\d+(\.\d+)?$/, "catalog.error_non_negative"),
  default_cost_usd: z.string().regex(/^\d+(\.\d+)?$/, "catalog.error_non_negative_usd"),
  default_sale_price_usd: z.string().regex(/^\d+(\.\d+)?$/, "catalog.error_non_negative_usd"),
});
type ProductFormValues = z.infer<typeof productSchema>;

const categorySchema = z.object({
  name: z.string().trim().min(1, "catalog.error_category_name"),
  description: z.string().trim().max(2000, "catalog.error_description").optional(),
});
type CategoryFormValues = z.infer<typeof categorySchema>;

const managerRoles: Role[] = ["admin", "manager"];

function isManager(role: Role): boolean {
  return managerRoles.includes(role);
}

function initialProductValues(product?: Product): ProductFormValues {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    category_id: product?.category_id ? String(product.category_id) : "",
    unit: product?.unit ?? "",
    reorder_level: product?.reorder_level ?? "0.00",
    default_cost_usd: product?.default_cost_usd ?? "0.00",
    default_sale_price_usd: product?.default_sale_price_usd ?? "0.00",
  };
}

function initialCategoryValues(category?: Category): CategoryFormValues {
  return { name: category?.name ?? "", description: category?.description ?? "" };
}

const ProductForm = ({ onClose, product, role }: { onClose: () => void; product?: Product; role: Role }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const form = useForm<ProductFormValues>({ defaultValues: initialProductValues(product), resolver: zodResolver(productSchema) });
  const categoriesQuery = useQuery({
    queryKey: ["categories", "product-form"],
    queryFn: () => apiClient.getPage<Category>(buildListPath("/categories", { page: 1, perPage: 100, sort: "name" })),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const payload = { ...values, barcode: values.barcode?.trim() || null, category_id: Number(values.category_id) };
      return product ? apiClient.patch<Product>(`/products/${product.id}`, payload) : apiClient.post<Product>("/products", payload);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", "stock"] }),
      ]);
      onClose();
    },
  });
  const categories = (categoriesQuery.data?.data ?? []).filter((category) => category.is_active || category.id === product?.category_id);

  const submit = async (values: ProductFormValues) => {
    setServerError(null);
    setServerFields({});
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      setServerError(apiErrorMessage(error, t("catalog.error_save_product")));
      setServerFields(apiFieldErrors(error));
    }
  };
  const fieldError = (field: keyof ProductFormValues) => {
    const errorMsg = form.formState.errors[field]?.message;
    return errorMsg ? t(errorMsg) : serverFields[field];
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      {serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("catalog.form_product_name")} error={fieldError("name")}><Input aria-invalid={Boolean(fieldError("name"))} {...form.register("name")} /></Field>
        <Field label={t("common.sku")} error={fieldError("sku")}><Input aria-invalid={Boolean(fieldError("sku"))} {...form.register("sku")} /></Field>
        <Field label={t("catalog.form_category")} error={fieldError("category_id")}><Controller name="category_id" control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(fieldError("category_id"))} placeholder={t("catalog.select_category")} options={[{ value: "", label: t("catalog.select_category") }, ...categories.map(c => ({ value: String(c.id), label: c.name + (c.is_active ? "" : t("catalog.archived_suffix")) }))]} />} /></Field>
        <Field label={t("catalog.form_unit")} error={fieldError("unit")}><Input placeholder={t("catalog.unit_examples")} aria-invalid={Boolean(fieldError("unit"))} {...form.register("unit")} /></Field>
        <Field label={t("catalog.form_cost")} error={fieldError("default_cost_usd")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("default_cost_usd"))} {...form.register("default_cost_usd")} /></Field>
        <Field label={t("catalog.form_price")} error={fieldError("default_sale_price_usd")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("default_sale_price_usd"))} {...form.register("default_sale_price_usd")} /></Field>
        <Field label={t("catalog.form_reorder")} error={fieldError("reorder_level")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("reorder_level"))} {...form.register("reorder_level")} /></Field>
        <Field label={t("catalog.form_barcode")} error={fieldError("barcode")}><Input aria-invalid={Boolean(fieldError("barcode"))} {...form.register("barcode")} /></Field>
      </div>
      {!isManager(role) ? null : <div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={mutation.isPending || categoriesQuery.isPending} type="submit">{mutation.isPending ? t("common.saving") : product ? t("catalog.save_product") : t("catalog.create_product")}</Button></div>}
    </form>
  );
};

const CategoryForm = ({ category, onClose }: { category?: Category; onClose: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const form = useForm<CategoryFormValues>({ defaultValues: initialCategoryValues(category), resolver: zodResolver(categorySchema) });
  const mutation = useMutation({
    mutationFn: (values: CategoryFormValues) => category ? apiClient.patch<Category>(`/categories/${category.id}`, values) : apiClient.post<Category>("/categories", values),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["categories"] }); onClose(); },
  });
  const submit = async (values: CategoryFormValues) => {
    setServerError(null);
    setServerFields({});
    try { await mutation.mutateAsync(values); } catch (error) { setServerError(apiErrorMessage(error, t("catalog.error_save_category"))); setServerFields(apiFieldErrors(error)); }
  };
  const nameErrorMsg = form.formState.errors.name?.message;
  const nameError = (nameErrorMsg ? t(nameErrorMsg) : null) || serverFields.name;
  const descErrorMsg = form.formState.errors.description?.message;
  const descriptionError = (descErrorMsg ? t(descErrorMsg) : null) || serverFields.description;
  return <form className="space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>{serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}<Field label={t("catalog.form_category_name")} error={nameError}><Input aria-invalid={Boolean(nameError)} {...form.register("name")} /></Field><Field label={t("catalog.form_description")} error={descriptionError}><textarea className="form-control min-h-24 px-3 py-2" {...form.register("description")} /></Field><div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={mutation.isPending} type="submit">{mutation.isPending ? t("common.saving") : category ? t("catalog.save_category") : t("catalog.create_category")}</Button></div></form>;
};

const Field = ({ children, error, label }: { children: React.ReactNode; error?: string; label: string }) => <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]"><span>{label}</span>{children}{error ? <span className="text-sm font-medium text-[var(--coral-strong)]">{error}</span> : null}</label>;

const SortButton = ({ active, children, direction, onClick }: { active: boolean; children: React.ReactNode; direction: "asc" | "desc"; onClick: () => void }) => {
  const { t } = useTranslation();
  return <button className="inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)]" type="button" onClick={onClick}>{children}<ChevronsUpDown aria-hidden="true" size={13} className={active ? "text-[var(--olive)]" : ""} /><span className="sr-only">{direction === "asc" ? t("catalog.sort_asc") : t("catalog.sort_desc")}</span></button>;
};

export const CatalogPage = ({ role }: CatalogPageProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canManage = isManager(role);
  const [tab, setTab] = useState<CatalogTab>("products");
  const [productQuery, setProductQuery] = useState(() => new URLSearchParams(window.location.search).get("query") ?? "");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [categoryPage, setCategoryPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [productSort, setProductSort] = useState<ProductSort>("name");
  const [categorySort, setCategorySort] = useState<CategorySort>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const [productForm, setProductForm] = useState<FormMode<Product> | null>(null);
  const [categoryForm, setCategoryForm] = useState<FormMode<Category> | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ item: Category | Product; type: "category" | "product" } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const productsPath = buildListPath("/products", { page: productPage, perPage, q: productQuery, sort: productSort, direction, extra: { status: statusFilter } });
  const categoriesPath = buildListPath("/categories", { page: categoryPage, perPage, q: categoryQuery, sort: categorySort, direction, extra: { status: statusFilter } });
  const productsQuery = useQuery({ queryKey: ["products", { productPage, perPage, productQuery, productSort, direction, statusFilter }], queryFn: () => apiClient.getPage<Product>(productsPath), retry: false });
  const categoriesQuery = useQuery({ queryKey: ["categories", { categoryPage, perPage, categoryQuery, categorySort, direction, statusFilter }], queryFn: () => apiClient.getPage<Category>(categoriesPath), retry: false, enabled: tab === "categories" });
  const archiveMutation = useMutation({
    mutationFn: ({ id, type }: { id: number; type: "category" | "product" }) => apiClient.patch(type === "product" ? `/products/${id}` : `/categories/${id}`, { is_active: false }),
    onSuccess: async (_, target) => {
      await queryClient.invalidateQueries({ queryKey: [target.type === "product" ? "products" : "categories"] });
      if (target.type === "product") await queryClient.invalidateQueries({ queryKey: ["inventory", "stock"] });
      setArchiveTarget(null);
      setArchiveError(null);
    },
  });

  const changeProductSort = (sort: ProductSort) => { setProductSort(sort); setDirection((current) => productSort === sort ? (current === "asc" ? "desc" : "asc") : "asc"); setProductPage(1); };
  const changeCategorySort = (sort: CategorySort) => { setCategorySort(sort); setDirection((current) => categorySort === sort ? (current === "asc" ? "desc" : "asc") : "asc"); setCategoryPage(1); };
  const changeStatus = (value: "all" | "active" | "archived") => { setStatusFilter(value); if (tab === "products") setProductPage(1); else setCategoryPage(1); };
  const archive = async () => {
    if (!archiveTarget) return;
    setArchiveError(null);
    try { await archiveMutation.mutateAsync({ id: archiveTarget.item.id, type: archiveTarget.type }); } catch (error) { setArchiveError(apiErrorMessage(error, t("catalog.error_archive"))); }
  };

  const activeMeta = tab === "products" ? productsQuery.data?.meta : categoriesQuery.data?.meta;
  const activeSearch = tab === "products" ? productQuery : categoryQuery;
  const setActiveSearch = (value: string) => {
    if (tab === "products") { setProductQuery(value); setProductPage(1); } else { setCategoryQuery(value); setCategoryPage(1); }
  };
  const activeLabel = tab === "products" ? t("catalog.tabs_products") : t("catalog.tabs_categories");

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <h1 className="page-title">{t("catalog.title")}</h1>
        <div aria-label={t("catalog.catalog_sections")} className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]"><button aria-pressed={tab === "products"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "products" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("products"); setStatusFilter("all"); }}>{t("catalog.tabs_products")}</button><button aria-pressed={tab === "categories"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "categories" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("categories"); setStatusFilter("all"); }}>{t("catalog.tabs_categories")}</button></div>
      </div>
      {canManage ? <Button onClick={() => tab === "products" ? setProductForm({ mode: "create" }) : setCategoryForm({ mode: "create" })}><Plus size={17} />{tab === "products" ? t("catalog.new_product") : t("catalog.new_category")}</Button> : <p className="text-sm font-medium text-[var(--muted)]">{t("catalog.view_only")}</p>}
    </header>
    <section className="surface-panel overflow-hidden">
      <div className="surface-toolbar flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={tab === "products" ? t("catalog.search_products") : t("catalog.search_categories")} className="pl-10" type="search" value={activeSearch} placeholder={tab === "products" ? t("catalog.search_products") : t("catalog.search_categories")} onChange={(event) => setActiveSearch(event.target.value)} /></div><label className="flex shrink-0 items-center gap-2 text-sm font-medium text-[var(--muted)]"><Filter size={15} />{t("common.status")}<div className="w-36"><Select aria-label={t("catalog.filter_status", { type: tab === "products" ? t("catalog.tabs_products") : t("catalog.tabs_categories") })} value={statusFilter} onChange={(value) => changeStatus(value as "all" | "active" | "archived")} options={[{ value: "all", label: t("common.all") }, { value: "active", label: t("common.active") }, { value: "archived", label: t("common.archived") }]} /></div></label></div>
      {tab === "products" ? <ProductsTable canManage={canManage} direction={direction} items={productsQuery.data?.data ?? []} onArchive={(product) => { setArchiveError(null); setArchiveTarget({ type: "product", item: product }); }} onEdit={(product) => setProductForm({ mode: "edit", item: product })} onSort={changeProductSort} sort={productSort} loading={productsQuery.isPending} /> : <CategoriesTable canManage={canManage} direction={direction} items={categoriesQuery.data?.data ?? []} loading={categoriesQuery.isPending} onArchive={(category) => { setArchiveError(null); setArchiveTarget({ type: "category", item: category }); }} onEdit={(category) => setCategoryForm({ mode: "edit", item: category })} onSort={changeCategorySort} sort={categorySort} />}
      {(tab === "products" ? productsQuery.isError : categoriesQuery.isError) ? <div className="p-4"><ResourceError message={apiErrorMessage(tab === "products" ? productsQuery.error : categoriesQuery.error, t("catalog.error_loading"))} onRetry={() => void (tab === "products" ? productsQuery.refetch() : categoriesQuery.refetch())} /></div> : null}
      {activeMeta ? <Pagination label={activeLabel} meta={activeMeta} onPageChange={(page) => tab === "products" ? setProductPage(page) : setCategoryPage(page)} onPerPageChange={(size) => { setPerPage(size); setProductPage(1); setCategoryPage(1); }} /> : null}
    </section>
    <Dialog description="" onClose={() => setProductForm(null)} open={productForm !== null} title={productForm?.mode === "edit" ? t("catalog.edit_product") : t("catalog.new_product")}>{productForm ? <ProductForm product={productForm.item} role={role} onClose={() => setProductForm(null)} /> : null}</Dialog>
    <Dialog description="" onClose={() => setCategoryForm(null)} open={categoryForm !== null} title={categoryForm?.mode === "edit" ? t("catalog.edit_category") : t("catalog.new_category")}>{categoryForm ? <CategoryForm category={categoryForm.item} onClose={() => setCategoryForm(null)} /> : null}</Dialog>
    <ConfirmArchiveDialog description={archiveTarget?.type === "category" ? t("catalog.empty_category_warning") : t("catalog.archived_warning")} error={archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(null); }} onConfirm={() => void archive()} open={archiveTarget !== null} pending={archiveMutation.isPending} title={archiveTarget?.type === "category" ? t("catalog.archive_category") : t("catalog.archive_product")} />
  </div>;
};

const ProductsTable = ({ canManage, direction, items, loading, onArchive, onEdit, onSort, sort }: { canManage: boolean; direction: "asc" | "desc"; items: Product[]; loading: boolean; onArchive: (item: Product) => void; onEdit: (item: Product) => void; onSort: (sort: ProductSort) => void; sort: ProductSort }) => {
  const { t } = useTranslation();
  if (loading) return <div aria-label={t("catalog.loading_items", { type: t("catalog.tabs_products") })} className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div>;
  if (items.length === 0) return <EmptyState icon={<PackagePlus size={22} />} text={t("catalog.empty_products")} />;
  return (
    <DataTable>
      <thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><SortButton active={sort === "name"} direction={direction} onClick={() => onSort("name")}>{t("common.product")}</SortButton></th><th className="px-4 py-3"><SortButton active={sort === "sku"} direction={direction} onClick={() => onSort("sku")}>{t("common.sku")}</SortButton></th><th className="px-4 py-3">{t("common.category")}</th><th className="px-4 py-3 text-right">{t("catalog.sale_price")}</th><th className="px-4 py-3 text-right">{t("catalog.reorder_at")}</th><th className="px-4 py-3">{t("common.status")}</th>{canManage ? <th className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th> : null}</tr></thead>
      <tbody>{items.map((product) => <tr className="data-row border-t border-[var(--line)]" key={product.id}><td className="px-4 py-3"><p className="font-semibold text-[var(--ink)]">{product.name}</p><p className="mt-0.5 text-sm text-[var(--muted)]">{product.unit}</p></td><td className="px-4 py-3 font-mono text-sm text-[var(--muted)]">{product.sku}</td><td className="px-4 py-3">{product.category_name ? <Badge tone="olive">{product.category_name}</Badge> : <span className="text-[var(--muted)]">{t("catalog.uncategorized")}</span>}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">{formatCurrency(product.default_sale_price_usd, "USD")}</td><td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">{formatQuantity(product.reorder_level)}</td><td className="px-4 py-3"><Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? t("common.active") : t("common.archived")}</Badge></td>{canManage ? <td className="px-4 py-3 text-right"><ActionMenu triggerLabel={t("catalog.more_actions", { name: product.name })} items={[{ icon: <Edit3 size={14} />, label: t("actions.edit"), onSelect: () => onEdit(product) }, ...(product.is_active ? [{ label: t("actions.archive"), onSelect: () => onArchive(product), tone: "danger" as const }] : [])]} /></td> : null}</tr>)}</tbody>
    </DataTable>
  );
};

const CategoriesTable = ({ canManage, direction, items, loading, onArchive, onEdit, onSort, sort }: { canManage: boolean; direction: "asc" | "desc"; items: Category[]; loading: boolean; onArchive: (item: Category) => void; onEdit: (item: Category) => void; onSort: (sort: CategorySort) => void; sort: CategorySort }) => {
  const { t } = useTranslation();
  if (loading) return <div aria-label={t("catalog.loading_items", { type: t("catalog.tabs_categories") })} className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div>;
  if (items.length === 0) return <EmptyState icon={<Tags size={22} />} text={t("catalog.empty_categories")} />;
  return (
    <DataTable>
      <thead><tr className="bg-[var(--canvas)] text-sm font-medium text-[var(--muted)]"><th className="px-4 py-3"><SortButton active={sort === "name"} direction={direction} onClick={() => onSort("name")}>{t("common.category")}</SortButton></th><th className="px-4 py-3">{t("common.description")}</th><th className="px-4 py-3">{t("common.status")}</th>{canManage ? <th className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th> : null}</tr></thead>
      <tbody>{items.map((category) => <tr className="data-row border-t border-[var(--line)]" key={category.id}><td className="px-4 py-3 font-semibold text-[var(--ink)]">{category.name}</td><td className="max-w-sm px-4 py-3 text-[var(--muted)]">{category.description || <span className="text-sm">{t("catalog.form_no_description")}</span>}</td><td className="px-4 py-3"><Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? t("common.active") : t("common.archived")}</Badge></td>{canManage ? <td className="px-4 py-3 text-right"><ActionMenu triggerLabel={t("catalog.more_actions", { name: category.name })} items={[{ icon: <Edit3 size={14} />, label: t("actions.edit"), onSelect: () => onEdit(category) }, ...(category.is_active ? [{ label: t("actions.archive"), onSelect: () => onArchive(category), tone: "danger" as const }] : [])]} /></td> : null}</tr>)}</tbody>
    </DataTable>
  );
};

const EmptyState = ({ icon, text }: { icon: React.ReactNode; text: string }) => <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]">{icon}</span><p className="mt-3 font-semibold text-[var(--ink)]">{text}</p></div></div>;
