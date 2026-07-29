import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, PackageSearch, Search } from "lucide-react";
import { useState } from "react";

import { apiClient } from "../../lib/api";
import type { ProductSearchResult } from "../../types/api";
import { Badge } from "../ui/Badge";
import { Input } from "../ui/Input";
import { Dialog } from "../ui/Dialog";

type GlobalProductSearchProps = {
  onClose: () => void;
  onSelect: (product: ProductSearchResult) => void;
  open: boolean;
};

export const GlobalProductSearch = ({ onClose, onSelect, open }: GlobalProductSearchProps) => {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const canSearch = normalizedQuery.length >= 2;
  const searchQuery = useQuery({
    queryKey: ["product-search", normalizedQuery],
    queryFn: () => apiClient.getPage<ProductSearchResult>(`/products?q=${encodeURIComponent(normalizedQuery)}&per_page=6`),
    enabled: open && canSearch,
    retry: false,
  });
  const message = searchQuery.error instanceof Error ? searchQuery.error.message : "Product search could not be loaded.";
  const products = searchQuery.data?.data ?? [];

  const selectProduct = (product: ProductSearchResult) => {
    onSelect(product);
    setQuery("");
  };

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <Dialog description="Find a product by name or SKU." onClose={close} open={open} title="Search products">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} />
        <Input
          aria-label="Search products"
          className="pl-10"
          data-dialog-initial-focus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Product name or SKU"
          value={query}
        />
      </div>
      <div aria-live="polite" className="mt-4">
        {!canSearch ? <p className="rounded-lg bg-[var(--canvas)] px-3 py-2.5 text-sm text-[var(--muted)]">Type 2 or more characters.</p> : null}
        {canSearch && searchQuery.isPending ? <p className="flex items-center gap-2 px-1 py-3 text-sm text-[var(--muted)]"><LoaderCircle className="animate-spin" size={16} /> Searching products...</p> : null}
        {canSearch && searchQuery.isError ? <p className="rounded-lg bg-[var(--coral-soft)] px-3 py-2.5 text-sm text-[var(--coral-strong)]">{message}</p> : null}
        {canSearch && searchQuery.isSuccess && products.length === 0 ? <p className="rounded-lg bg-[var(--canvas)] px-3 py-2.5 text-sm text-[var(--muted)]">No products found.</p> : null}
        {canSearch && searchQuery.isSuccess && products.length > 0 ? (
          <ul aria-label="Matching products" className="divide-y divide-[var(--line)] overflow-hidden rounded-xl bg-[var(--surface)] shadow-[var(--shadow-border)]">
            {products.map((product) => (
              <li key={product.id}>
                <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color] duration-150 hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--olive)]" onClick={() => selectProduct(product)} type="button">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--olive-soft)] text-[var(--olive-strong)]"><PackageSearch size={16} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{product.name}</span><span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{product.sku}{product.category_name ? ` - ${product.category_name}` : ""}</span></span>
                  <Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Active" : "Inactive"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
};
