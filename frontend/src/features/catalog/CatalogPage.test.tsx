import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CatalogPage } from "./CatalogPage";
import { apiClient } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  apiClient: { getPage: vi.fn(), patch: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    fields?: Record<string, string>;
    constructor({ code, fields, message, status }: { code: string; fields?: Record<string, string>; message: string; status: number }) {
      super(message);
      this.code = code;
      this.status = status;
      this.fields = fields;
    }
  },
}));

const product = {
  id: 7,
  name: "Pilot Pen",
  sku: "PEN-001",
  barcode: null,
  category_id: 2,
  category_name: "Office",
  unit: "each",
  reorder_level: "8.000",
  default_cost_usd: "0.4500",
  default_sale_price_usd: "1.2500",
  is_active: true,
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
};

const category = {
  id: 2,
  name: "Office",
  description: "Office essentials",
  is_active: true,
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
};

const archivedProduct = {
  ...product,
  id: 8,
  name: "Retired Pen",
  sku: "PEN-OLD",
  is_active: false,
};

const archivedCategory = {
  ...category,
  id: 3,
  name: "Retired office supplies",
  is_active: false,
};

function renderPage(role: "admin" | "manager" | "staff" = "manager") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CatalogPage role={role} /></QueryClientProvider>);
}

describe("CatalogPage", () => {
  it("uses product pagination metadata and sends safe server search and sort parameters", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (path.startsWith("/categories")) {
        return Promise.resolve({ data: [category], meta: { page: 1, pages: 1, per_page: 100, total: 1 } });
      }
      return Promise.resolve({ data: [product], meta: { page: path.includes("page=2") ? 2 : 1, pages: 2, per_page: 10, total: 11 } });
    });
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText("Pilot Pen")).toBeInTheDocument();
    expect(screen.getByText("$1.25")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("1-10 of 11 products")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("/products?page=2")));
    await user.clear(screen.getByRole("searchbox", { name: "Search products" }));
    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "pen");
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("q=pen")));
  });

  it("requests archived rows from the API, resets pagination, and uses the returned page metadata", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      const request = String(path);
      const isArchived = request.includes("status=archived");
      const isSecondPage = request.includes("page=2");

      if (request.startsWith("/categories")) {
        return Promise.resolve({
          data: isArchived ? [archivedCategory] : [category],
          meta: isArchived
            ? { page: 1, pages: 1, per_page: 10, total: 1 }
            : { page: isSecondPage ? 2 : 1, pages: 2, per_page: 10, total: 11 },
        });
      }

      return Promise.resolve({
        data: isArchived ? [archivedProduct] : [product],
        meta: isArchived
          ? { page: 1, pages: 1, per_page: 10, total: 1 }
          : { page: isSecondPage ? 2 : 1, pages: 2, per_page: 10, total: 11 },
      });
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Pilot Pen");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("/products?page=2")));
    await user.selectOptions(screen.getByLabelText("Filter product status"), "archived");

    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).startsWith("/products?page=1") && String(path).includes("status=archived"))).toBe(true));
    expect(await screen.findByText("Retired Pen")).toBeInTheDocument();
    expect(screen.getByText("1-1 of 1 products")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Categories" }));
    await screen.findByText("Office essentials");
    expect(screen.queryByText("Product count")).not.toBeInTheDocument();
    expect(screen.queryByText("Not available from API")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("/categories?page=2")));
    await user.selectOptions(screen.getByLabelText("Filter category status"), "archived");

    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).startsWith("/categories?page=1") && String(path).includes("status=archived"))).toBe(true));
    expect(await screen.findByText("Retired office supplies")).toBeInTheDocument();
    expect(screen.getByText("1-1 of 1 categories")).toBeInTheDocument();
  });

  it("submits a manager product form and refreshes the product query", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (path.startsWith("/categories")) {
        return Promise.resolve({ data: [category], meta: { page: 1, pages: 1, per_page: 100, total: 1 } });
      }
      return Promise.resolve({ data: [product], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
    });
    vi.mocked(apiClient.post).mockResolvedValue(product);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Pilot Pen");
    await user.click(screen.getByRole("button", { name: "New product" }));
    await user.type(screen.getByLabelText("Product name"), "Desk Lamp");
    await user.type(screen.getByLabelText("SKU"), "LAMP-001");
    await user.selectOptions(screen.getByLabelText("Category"), "2");
    await user.type(screen.getByLabelText("Unit"), "each");
    await user.type(screen.getByLabelText("Reorder level"), "3");
    await user.type(screen.getByLabelText("Default cost (USD)"), "10");
    await user.type(screen.getByLabelText("Default sale price (USD)"), "15");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/products", expect.objectContaining({ name: "Desk Lamp", sku: "LAMP-001", category_id: 2 })));
    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.filter(([path]) => String(path).startsWith("/products")).length).toBeGreaterThan(1));
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
  });

  it("keeps catalog actions read-only for Staff", async () => {
    vi.mocked(apiClient.getPage).mockResolvedValue({ data: [product], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });

    renderPage("staff");

    expect(await screen.findByText("Pilot Pen")).toBeInTheDocument();
    expect(screen.getByText(/view-only for your role/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more actions for pilot pen/i })).not.toBeInTheDocument();
  });

  it("shows category archive conflicts returned by the API", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (path.startsWith("/categories")) {
        return Promise.resolve({ data: [category], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
      }
      return Promise.resolve({ data: [product], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
    });
    vi.mocked(apiClient.patch).mockRejectedValue(new Error("Archive active products before archiving this category."));
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole("button", { name: "Categories" }));
    expect(await screen.findByText("Office essentials")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions for Office" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive category" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/categories/2", { is_active: false }));
    expect(await screen.findByText("Archive active products before archiving this category.")).toBeInTheDocument();
  });
});
