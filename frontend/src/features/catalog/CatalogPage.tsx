import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Edit3, Filter, PackagePlus, Plus, Search, Tags } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "../../components/ui/Badge";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
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
  name: z.string().trim().min(1, "Product name is required."),
  sku: z.string().trim().min(1, "SKU is required."),
  barcode: z.string().trim().max(80, "Barcode must be at most 80 characters.").optional(),
  category_id: z.string().regex(/^\d+$/, "Select an active category."),
  unit: z.string().trim().min(1, "Unit is required."),
  reorder_level: z.string().regex(/^\d+(\.\d+)?$/, "Enter a non-negative number."),
  default_cost_usd: z.string().regex(/^\d+(\.\d+)?$/, "Enter a non-negative USD value."),
  default_sale_price_usd: z.string().regex(/^\d+(\.\d+)?$/, "Enter a non-negative USD value."),
});
type ProductFormValues = z.infer<typeof productSchema>;

const categorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required."),
  description: z.string().trim().max(2000, "Description is too long.").optional(),
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
      setServerError(apiErrorMessage(error, "Product could not be saved."));
      setServerFields(apiFieldErrors(error));
    }
  };
  const fieldError = (field: keyof ProductFormValues) => form.formState.errors[field]?.message || serverFields[field];

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      {serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" error={fieldError("name")}><Input aria-invalid={Boolean(fieldError("name"))} {...form.register("name")} /></Field>
        <Field label="SKU" error={fieldError("sku")}><Input aria-invalid={Boolean(fieldError("sku"))} {...form.register("sku")} /></Field>
        <Field label="Category" error={fieldError("category_id")}><select aria-invalid={Boolean(fieldError("category_id"))} className="form-control px-3" {...form.register("category_id")}><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (archived)"}</option>)}</select></Field>
        <Field label="Unit" error={fieldError("unit")}><Input placeholder="each, box, kg" aria-invalid={Boolean(fieldError("unit"))} {...form.register("unit")} /></Field>
        <Field label="Default cost (USD)" error={fieldError("default_cost_usd")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("default_cost_usd"))} {...form.register("default_cost_usd")} /></Field>
        <Field label="Default sale price (USD)" error={fieldError("default_sale_price_usd")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("default_sale_price_usd"))} {...form.register("default_sale_price_usd")} /></Field>
        <Field label="Reorder level" error={fieldError("reorder_level")}><Input inputMode="decimal" aria-invalid={Boolean(fieldError("reorder_level"))} {...form.register("reorder_level")} /></Field>
        <Field label="Barcode (optional)" error={fieldError("barcode")}><Input aria-invalid={Boolean(fieldError("barcode"))} {...form.register("barcode")} /></Field>
      </div>
      {!isManager(role) ? null : <div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending || categoriesQuery.isPending} type="submit">{mutation.isPending ? "Saving..." : product ? "Save product" : "Create product"}</Button></div>}
    </form>
  );
};

const CategoryForm = ({ category, onClose }: { category?: Category; onClose: () => void }) => {
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
    try { await mutation.mutateAsync(values); } catch (error) { setServerError(apiErrorMessage(error, "Category could not be saved.")); setServerFields(apiFieldErrors(error)); }
  };
  const nameError = form.formState.errors.name?.message || serverFields.name;
  const descriptionError = form.formState.errors.description?.message || serverFields.description;
  return <form className="space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>{serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}<Field label="Category name" error={nameError}><Input aria-invalid={Boolean(nameError)} {...form.register("name")} /></Field><Field label="Description (optional)" error={descriptionError}><textarea className="form-control min-h-24 px-3 py-2" {...form.register("description")} /></Field><div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending} type="submit">{mutation.isPending ? "Saving..." : category ? "Save category" : "Create category"}</Button></div></form>;
};

const Field = ({ children, error, label }: { children: React.ReactNode; error?: string; label: string }) => <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]"><span>{label}</span>{children}{error ? <span className="text-xs font-medium text-[var(--coral-strong)]">{error}</span> : null}</label>;

const SortButton = ({ active, children, direction, onClick }: { active: boolean; children: React.ReactNode; direction: "asc" | "desc"; onClick: () => void }) => <button className="inline-flex items-center gap-1 font-semibold hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--olive)]" type="button" onClick={onClick}>{children}<ChevronsUpDown aria-hidden="true" size={13} className={active ? "text-[var(--olive)]" : ""} /><span className="sr-only">Sort {direction === "asc" ? "ascending" : "descending"}</span></button>;

export const CatalogPage = ({ role }: CatalogPageProps) => {
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
    try { await archiveMutation.mutateAsync({ id: archiveTarget.item.id, type: archiveTarget.type }); } catch (error) { setArchiveError(apiErrorMessage(error, "This record could not be archived.")); }
  };

  const activeMeta = tab === "products" ? productsQuery.data?.meta : categoriesQuery.data?.meta;
  const activeSearch = tab === "products" ? productQuery : categoryQuery;
  const setActiveSearch = (value: string) => {
    if (tab === "products") { setProductQuery(value); setProductPage(1); } else { setCategoryQuery(value); setCategoryPage(1); }
  };
  const activeLabel = tab === "products" ? "products" : "categories";

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <h1 className="page-title">Catalog</h1>
        <div aria-label="Catalog sections" className="inline-flex rounded-xl bg-[var(--surface)] p-1 shadow-[var(--shadow-border)]"><button aria-pressed={tab === "products"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "products" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("products"); setStatusFilter("all"); }}>Products</button><button aria-pressed={tab === "categories"} className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color] duration-150 ${tab === "categories" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "text-[var(--muted)] hover:bg-[var(--canvas)]"}`} type="button" onClick={() => { setTab("categories"); setStatusFilter("all"); }}>Categories</button></div>
      </div>
      {canManage ? <Button onClick={() => tab === "products" ? setProductForm({ mode: "create" }) : setCategoryForm({ mode: "create" })}><Plus size={17} />New {tab === "products" ? "product" : "category"}</Button> : <p className="text-sm font-medium text-[var(--muted)]">View-only for your role</p>}
    </header>
    <section className="surface-panel overflow-hidden">
      <div className="surface-toolbar flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-md"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><Input aria-label={`Search ${activeLabel}`} className="pl-10" type="search" value={activeSearch} placeholder={`Search ${activeLabel}`} onChange={(event) => setActiveSearch(event.target.value)} /></div><label className="flex shrink-0 items-center gap-2 text-sm font-medium text-[var(--muted)]"><Filter size={15} />Status<select aria-label={`Filter ${tab === "products" ? "product" : "category"} status`} className="min-h-11 rounded-[0.625rem] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] sm:min-h-10 sm:text-sm" value={statusFilter} onChange={(event) => changeStatus(event.target.value as "all" | "active" | "archived")}><option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div>
      {tab === "products" ? <ProductsTable canManage={canManage} direction={direction} items={productsQuery.data?.data ?? []} onArchive={(product) => { setArchiveError(null); setArchiveTarget({ type: "product", item: product }); }} onEdit={(product) => setProductForm({ mode: "edit", item: product })} onSort={changeProductSort} sort={productSort} loading={productsQuery.isPending} /> : <CategoriesTable canManage={canManage} direction={direction} items={categoriesQuery.data?.data ?? []} loading={categoriesQuery.isPending} onArchive={(category) => { setArchiveError(null); setArchiveTarget({ type: "category", item: category }); }} onEdit={(category) => setCategoryForm({ mode: "edit", item: category })} onSort={changeCategorySort} sort={categorySort} />}
      {(tab === "products" ? productsQuery.isError : categoriesQuery.isError) ? <div className="p-4"><ResourceError message={apiErrorMessage(tab === "products" ? productsQuery.error : categoriesQuery.error, "Catalog data could not be loaded.")} onRetry={() => void (tab === "products" ? productsQuery.refetch() : categoriesQuery.refetch())} /></div> : null}
      {activeMeta ? <Pagination label={activeLabel} meta={activeMeta} onPageChange={(page) => tab === "products" ? setProductPage(page) : setCategoryPage(page)} onPerPageChange={(size) => { setPerPage(size); setProductPage(1); setCategoryPage(1); }} /> : null}
    </section>
    <Dialog description="" onClose={() => setProductForm(null)} open={productForm !== null} title={productForm?.mode === "edit" ? "Edit product" : "New product"}>{productForm ? <ProductForm product={productForm.item} role={role} onClose={() => setProductForm(null)} /> : null}</Dialog>
    <Dialog description="" onClose={() => setCategoryForm(null)} open={categoryForm !== null} title={categoryForm?.mode === "edit" ? "Edit category" : "New category"}>{categoryForm ? <CategoryForm category={categoryForm.item} onClose={() => setCategoryForm(null)} /> : null}</Dialog>
    <ConfirmArchiveDialog description={archiveTarget?.type === "category" ? "Empty the category before archiving." : "Archived products are hidden from stock."} error={archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(null); }} onConfirm={() => void archive()} open={archiveTarget !== null} pending={archiveMutation.isPending} title={`Archive ${archiveTarget?.type ?? "record"}`} />
  </div>;
};

const ProductsTable = ({ canManage, direction, items, loading, onArchive, onEdit, onSort, sort }: { canManage: boolean; direction: "asc" | "desc"; items: Product[]; loading: boolean; onArchive: (item: Product) => void; onEdit: (item: Product) => void; onSort: (sort: ProductSort) => void; sort: ProductSort }) => {
  if (loading) return <div aria-label="Loading products" className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div>;
  if (items.length === 0) return <EmptyState icon={<PackagePlus size={22} />} text="No products match this view." />;
  return (
    <DataTable>
      <thead><tr className="bg-[var(--canvas)] text-xs uppercase tracking-[0.07em] text-[var(--muted)]"><th className="px-4 py-3"><SortButton active={sort === "name"} direction={direction} onClick={() => onSort("name")}>Product</SortButton></th><th className="px-4 py-3"><SortButton active={sort === "sku"} direction={direction} onClick={() => onSort("sku")}>SKU</SortButton></th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Sale price</th><th className="px-4 py-3 text-right">Reorder at</th><th className="px-4 py-3">Status</th>{canManage ? <th className="px-4 py-3"><span className="sr-only">Actions</span></th> : null}</tr></thead>
      <tbody>{items.map((product) => <tr className="data-row border-t border-[var(--line)]" key={product.id}><td className="px-4 py-3"><p className="font-semibold text-[var(--ink)]">{product.name}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{product.unit}</p></td><td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{product.sku}</td><td className="px-4 py-3">{product.category_name ? <Badge tone="olive">{product.category_name}</Badge> : <span className="text-[var(--muted)]">Uncategorized</span>}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">{formatCurrency(product.default_sale_price_usd, "USD")}</td><td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">{formatQuantity(product.reorder_level)}</td><td className="px-4 py-3"><Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Active" : "Archived"}</Badge></td>{canManage ? <td className="px-4 py-3 text-right"><ActionMenu triggerLabel={`More actions for ${product.name}`} items={[{ icon: <Edit3 size={14} />, label: "Edit", onSelect: () => onEdit(product) }, ...(product.is_active ? [{ label: "Archive", onSelect: () => onArchive(product), tone: "danger" as const }] : [])]} /></td> : null}</tr>)}</tbody>
    </DataTable>
  );
};

const CategoriesTable = ({ canManage, direction, items, loading, onArchive, onEdit, onSort, sort }: { canManage: boolean; direction: "asc" | "desc"; items: Category[]; loading: boolean; onArchive: (item: Category) => void; onEdit: (item: Category) => void; onSort: (sort: CategorySort) => void; sort: CategorySort }) => {
  if (loading) return <div aria-label="Loading categories" className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /><div className="h-14 animate-pulse rounded-xl bg-[var(--canvas)]" /></div>;
  if (items.length === 0) return <EmptyState icon={<Tags size={22} />} text="No categories match this view." />;
  return (
    <DataTable>
      <thead><tr className="bg-[var(--canvas)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><th className="px-4 py-3"><SortButton active={sort === "name"} direction={direction} onClick={() => onSort("name")}>Category</SortButton></th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Status</th>{canManage ? <th className="px-4 py-3"><span className="sr-only">Actions</span></th> : null}</tr></thead>
      <tbody>{items.map((category) => <tr className="data-row border-t border-[var(--line)]" key={category.id}><td className="px-4 py-3 font-semibold text-[var(--ink)]">{category.name}</td><td className="max-w-sm px-4 py-3 text-[var(--muted)]">{category.description || <span className="text-xs">No description</span>}</td><td className="px-4 py-3"><Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? "Active" : "Archived"}</Badge></td>{canManage ? <td className="px-4 py-3 text-right"><ActionMenu triggerLabel={`More actions for ${category.name}`} items={[{ icon: <Edit3 size={14} />, label: "Edit", onSelect: () => onEdit(category) }, ...(category.is_active ? [{ label: "Archive", onSelect: () => onArchive(category), tone: "danger" as const }] : [])]} /></td> : null}</tr>)}</tbody>
    </DataTable>
  );
};

const EmptyState = ({ icon, text }: { icon: React.ReactNode; text: string }) => <div className="grid min-h-48 place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]">{icon}</span><p className="mt-3 font-semibold text-[var(--ink)]">{text}</p></div></div>;
