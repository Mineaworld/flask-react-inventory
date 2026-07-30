import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { z } from "zod";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { apiClient } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { fetchAllPagesById } from "../../lib/pagination";
import type { Purchase, Role, Sale } from "../../types/api";
import { apiErrorMessage, apiFieldErrors, buildListPath, ResourceError } from "../shared/ResourceUi";
import { estimateDocument } from "./decimal";

type OrderKind = "purchase" | "sale";
type EditableOrder = Purchase | Sale;
type PartnerChoice = { id: number; is_active?: boolean; name: string };
type ProductChoice = { id: number; is_active?: boolean; name: string; sku?: string };

type OrderFormProps = {
  kind: OrderKind;
  onClose: () => void;
  order?: EditableOrder;
  role: Role;
};

const decimalPattern = /^\d+(?:\.\d+)?$/;
const positiveDecimal = z.string().trim().regex(decimalPattern, "Enter a positive decimal value.").refine((value) => /[1-9]/.test(value), "Must be greater than zero.");
const nonnegativeDecimal = z.string().trim().regex(decimalPattern, "Enter zero or a positive decimal value.");
const lineSchema = z.object({
  product_id: z.string().min(1, "Select a product."),
  quantity: positiveDecimal,
  unit_amount: nonnegativeDecimal,
});

const formSchema = z.object({
  partner_id: z.string(),
  currency: z.enum(["USD", "KHR"]),
  exchange_rate_to_usd: positiveDecimal,
  notes: z.string(),
  items: z.array(lineSchema).min(1, "Add at least one line item."),
}).superRefine((values, context) => {
  if (values.currency === "USD" && Number(values.exchange_rate_to_usd) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "USD exchange rate must be exactly 1.", path: ["exchange_rate_to_usd"] });
  }
  const products = new Set<string>();
  values.items.forEach((item, index) => {
    if (item.product_id && products.has(item.product_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A product may appear only once.", path: ["items", index, "product_id"] });
    }
    products.add(item.product_id);
  });
});

type OrderFormValues = z.infer<typeof formSchema>;

const Field = ({ children, error, label }: { children: ReactNode; error?: string; label: string }) => (
  <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
    <span>{label}</span>
    {children}
    {error ? <span className="text-sm font-medium text-[var(--coral-strong)]">{error}</span> : null}
  </label>
);

function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

function orderDefaults(kind: OrderKind, order?: EditableOrder): OrderFormValues {
  if (!order) {
    return { partner_id: "", currency: "USD", exchange_rate_to_usd: "1.00", notes: "", items: [{ product_id: "", quantity: "", unit_amount: "" }] };
  }
  return {
    partner_id: kind === "purchase" ? String((order as Purchase).supplier_id) : String((order as Sale).customer_id ?? ""),
    currency: order.currency,
    exchange_rate_to_usd: order.currency === "USD" ? "1.00" : trimDecimal(order.exchange_rate_to_usd),
    notes: order.notes ?? "",
    items: order.items.map((item) => ({
      product_id: String(item.product_id),
      quantity: trimDecimal(item.quantity),
      unit_amount: kind === "purchase" ? (item as Purchase["items"][number]).unit_cost : (item as Sale["items"][number]).unit_price,
    })),
  };
}

function staffCustomerPickerPath(page: number): string {
  const params = new URLSearchParams({ for_sale: "true", page: String(page), per_page: "100" });
  return `/customers?${params.toString()}`;
}

function mergeCurrentChoices<T extends { id: number }>(choices: T[], currentChoices: T[]): T[] {
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  currentChoices.forEach((choice) => {
    if (!byId.has(choice.id)) byId.set(choice.id, choice);
  });
  return [...byId.values()];
}

export const OrderForm = ({ kind, onClose, order, role }: OrderFormProps) => {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const form = useForm<OrderFormValues>({ resolver: zodResolver(formSchema), defaultValues: orderDefaults(kind, order) });
  const lines = useFieldArray({ control: form.control, name: "items" });
  const currency = form.watch("currency");
  const exchangeRate = form.watch("exchange_rate_to_usd");
  const watchedLines = form.watch("items");

  useEffect(() => {
    if (currency === "USD" && form.getValues("exchange_rate_to_usd") !== "1.00") {
      form.setValue("exchange_rate_to_usd", "1.00", { shouldValidate: true });
    }
  }, [currency, form]);

  const productsQuery = useQuery({
    queryKey: ["order-picker", "products"],
    queryFn: () => fetchAllPagesById<ProductChoice>((page) => apiClient.getPage<ProductChoice>(buildListPath("/products", {
      page,
      perPage: 100,
      sort: "name",
      direction: "asc",
      extra: { status: "active" },
    }))),
    retry: false,
  });
  const partnersQuery = useQuery({
    queryKey: ["order-picker", kind, role],
    queryFn: () => fetchAllPagesById<PartnerChoice>((page) => {
      if (kind === "sale" && role === "staff") {
        return apiClient.getPage<PartnerChoice>(staffCustomerPickerPath(page));
      }
      const path = kind === "purchase" ? "/suppliers" : "/customers";
      return apiClient.getPage<PartnerChoice>(buildListPath(path, { page, perPage: 100, sort: "name", direction: "asc" }));
    }),
    retry: false,
  });
  const estimates = estimateDocument(
    (watchedLines ?? []).map((line) => ({ quantity: line.quantity, unitAmount: line.unit_amount })),
    exchangeRate,
  );
  const mutation = useMutation({
    mutationFn: (values: OrderFormValues) => {
      const payload = {
        ...(kind === "purchase"
          ? { supplier_id: Number(values.partner_id) }
          : { customer_id: values.partner_id ? Number(values.partner_id) : null }),
        currency: values.currency,
        exchange_rate_to_usd: values.exchange_rate_to_usd.trim(),
        notes: values.notes.trim() || null,
        items: values.items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: item.quantity.trim(),
          [kind === "purchase" ? "unit_cost" : "unit_price"]: item.unit_amount.trim(),
        })),
      };
      const path = `/${kind === "purchase" ? "purchases" : "sales"}${order ? `/${order.id}` : ""}`;
      return order ? apiClient.patch<EditableOrder>(path, payload) : apiClient.post<EditableOrder>(path, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [kind === "purchase" ? "purchases" : "sales"] });
      onClose();
    },
  });

  const submit = async (values: OrderFormValues) => {
    setServerError(null);
    setServerFields({});
    if (kind === "purchase" && !values.partner_id) {
      form.setError("partner_id", { message: "Select a supplier." });
      return;
    }
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      setServerError(apiErrorMessage(error, `${kind === "purchase" ? "Purchase" : "Sale"} could not be saved.`));
      setServerFields(apiFieldErrors(error));
    }
  };

  const rootFieldError = (field: "partner_id" | "exchange_rate_to_usd") => form.formState.errors[field]?.message || serverFields[field === "partner_id" ? (kind === "purchase" ? "supplier_id" : "customer_id") : field];
  const currentProducts: ProductChoice[] = order?.items.map((item) => ({
    id: item.product_id,
    name: item.product_name || `Product ${item.product_id}`,
  })) ?? [];
  const currentPartners: PartnerChoice[] = order
    ? kind === "purchase"
      ? [{ id: (order as Purchase).supplier_id, name: (order as Purchase).supplier_name || `Supplier ${(order as Purchase).supplier_id}` }]
      : (order as Sale).customer_id
        ? [{ id: (order as Sale).customer_id as number, name: (order as Sale).customer_name || `Customer ${(order as Sale).customer_id}` }]
        : []
    : [];
  const products = mergeCurrentChoices((productsQuery.data ?? []).filter((product) => product.is_active !== false), currentProducts);
  const partners = mergeCurrentChoices((partnersQuery.data ?? []).filter((partner) => partner.is_active !== false), currentPartners);
  const documentLabel = kind === "purchase" ? "purchase" : "sale";
  const partnerLabel = kind === "purchase" ? "Supplier" : "Customer";
  const unitLabel = kind === "purchase" ? "Unit cost" : "Unit price";

  if (productsQuery.isError || partnersQuery.isError) {
    return <ResourceError message={apiErrorMessage(productsQuery.error ?? partnersQuery.error, "Document choices could not be loaded.")} onRetry={() => void Promise.all([productsQuery.refetch(), partnersQuery.refetch()])} />;
  }

  return (
    <form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
      {serverError ? <p className="rounded-xl bg-[var(--coral-soft)] p-3 text-sm text-[var(--coral-strong)]" role="alert">{serverError}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={partnerLabel} error={rootFieldError("partner_id")}>
          <Controller name="partner_id" control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(rootFieldError("partner_id"))} placeholder={kind === "purchase" ? "Select a supplier" : "Walk-in / no customer"} options={[{ value: "", label: kind === "purchase" ? "Select a supplier" : "Walk-in / no customer" }, ...partners.map(p => ({ value: String(p.id), label: p.name }))]} />} />
        </Field>
        <Field label="Currency" error={form.formState.errors.currency?.message}>
          <Controller name="currency" control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(form.formState.errors.currency?.message)} options={[{ value: "USD", label: "USD" }, { value: "KHR", label: "KHR" }]} />} />
        </Field>
      </div>
      <Field label="Exchange rate to USD" error={rootFieldError("exchange_rate_to_usd")}>
        <Input aria-label="Exchange rate to USD" aria-invalid={Boolean(rootFieldError("exchange_rate_to_usd"))} disabled={currency === "USD"} inputMode="decimal" {...form.register("exchange_rate_to_usd")} />
      </Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h3 className="font-display text-base font-bold text-[var(--ink)]">Line items</h3><Button size="small" variant="secondary" onClick={() => lines.append({ product_id: "", quantity: "", unit_amount: "" })}><Plus size={15} />Add line</Button></div>
        {lines.fields.map((line, index) => {
          const productError = form.formState.errors.items?.[index]?.product_id?.message || serverFields[`items.${index}.product_id`] || (serverFields.items && index === 0 ? serverFields.items : undefined);
          const quantityError = form.formState.errors.items?.[index]?.quantity?.message || serverFields[`items.${index}.quantity`];
          const amountError = form.formState.errors.items?.[index]?.unit_amount?.message || serverFields[`items.${index}.${kind === "purchase" ? "unit_cost" : "unit_price"}`];
          return (
            <section className="rounded-xl bg-[var(--canvas)] p-3 shadow-[inset_0_0_0_1px_var(--line)]" key={line.id}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto] sm:items-end">
                <Field label={`Product ${index + 1}`} error={productError}>
                  <Controller name={`items.${index}.product_id`} control={form.control} render={({ field }) => <Select value={field.value} onChange={field.onChange} hasError={Boolean(productError)} placeholder="Select a product" options={[{ value: "", label: "Select a product" }, ...products.map(p => ({ value: String(p.id), label: `${p.name} (${p.sku || "current"})` }))]} />} />
                </Field>
                <Field label={`Quantity ${index + 1}`} error={quantityError}><Input aria-label={`Quantity ${index + 1}`} aria-invalid={Boolean(quantityError)} inputMode="decimal" {...form.register(`items.${index}.quantity`)} /></Field>
                <Field label={`${unitLabel} ${index + 1}`} error={amountError}><Input aria-label={`${unitLabel} ${index + 1}`} aria-invalid={Boolean(amountError)} inputMode="decimal" {...form.register(`items.${index}.unit_amount`)} /></Field>
                <Button aria-label={`Remove line ${index + 1}`} disabled={lines.fields.length === 1} size="icon" variant="quiet" onClick={() => lines.remove(index)}><Trash2 size={17} /></Button>
              </div>
            </section>
          );
        })}
        {typeof form.formState.errors.items?.message === "string" ? <p className="text-sm font-medium text-[var(--coral-strong)]">{form.formState.errors.items.message}</p> : null}
      </div>
      <Field label="Notes"><textarea aria-label="Notes" className="form-control min-h-20 p-3" {...form.register("notes")} /></Field>
      <div className="rounded-xl bg-[var(--canvas)] p-4 text-sm shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="flex flex-wrap justify-between gap-2"><span className="text-[var(--muted)]">Estimated document total</span><strong className="tabular-nums text-[var(--ink)]">{formatCurrency(estimates.amount, currency)}</strong></div>
        <div className="mt-2 flex flex-wrap justify-between gap-2"><span className="text-[var(--muted)]">Estimated USD total</span><strong className="tabular-nums text-[var(--olive-strong)]">{formatCurrency(estimates.usd, "USD")}</strong></div>
        <p className="mt-2 text-sm text-[var(--muted)]">Final totals lock when saved.</p>
      </div>
      <div className="flex justify-end gap-3"><Button disabled={mutation.isPending} variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending || productsQuery.isPending || partnersQuery.isPending} type="submit">{mutation.isPending ? "Saving..." : `${order ? "Save" : "Create"} ${documentLabel}`}</Button></div>
    </form>
  );
};
