import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InventoryPage } from "./InventoryPage";
import { apiClient } from "../../lib/api";

vi.mock("../../lib/api", () => ({ apiClient: { getPage: vi.fn(), post: vi.fn() } }));

const stock = { product_id: 7, product_name: "Pilot Pen", sku: "PEN-001", unit: "each", quantity: "2.000", reorder_level: "8.000", updated_at: "2026-07-15T00:00:00Z" };
const healthyStock = { product_id: 8, product_name: "Copy Paper", sku: "PAPER-001", unit: "ream", quantity: "12.000", reorder_level: "4.000", updated_at: "2026-07-15T00:00:00Z" };
const product = { id: 7, name: "Pilot Pen", sku: "PEN-001", barcode: null, category_id: 2, category_name: "Office", unit: "each", reorder_level: "8.000", default_cost_usd: "0.4500", default_sale_price_usd: "1.2500", is_active: true, created_at: "2026-07-15T00:00:00Z", updated_at: "2026-07-15T00:00:00Z" };

function renderPage(role: "admin" | "manager" | "staff" = "manager") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><InventoryPage role={role} /></QueryClientProvider>);
}

describe("InventoryPage", () => {
  it("shows a loading state without a false error while stock is pending", () => {
    vi.mocked(apiClient.getPage).mockImplementation(() => new Promise(() => undefined));

    renderPage();

    expect(screen.getByLabelText("Loading stock")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requests low-stock rows from the API so pagination metadata stays accurate", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (path.includes("low_stock=true")) {
        return Promise.resolve({ data: [stock], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
      }
      return Promise.resolve({ data: [stock, healthyStock], meta: { page: 1, pages: 1, per_page: 10, total: 2 } });
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Copy Paper");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Low stock only" }));

    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("low_stock=true")));
    await waitFor(() => expect(screen.queryByText("Copy Paper")).not.toBeInTheDocument());
    expect(screen.getByText("1-1 of 1 stock records")).toBeInTheDocument();
  });

  it("submits an immutable stock adjustment and invalidates stock and movement data", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (path.startsWith("/products")) return Promise.resolve({ data: [product], meta: { page: 1, pages: 1, per_page: 100, total: 1 } });
      if (path.startsWith("/inventory/movements")) return Promise.resolve({ data: [], meta: { page: 1, pages: 1, per_page: 10, total: 0 } });
      return Promise.resolve({ data: [stock], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
    });
    vi.mocked(apiClient.post).mockResolvedValue({ id: 1 });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Pilot Pen");
    await user.click(screen.getByRole("button", { name: "Adjust stock" }));
    await user.selectOptions(screen.getByLabelText("Product"), "7");
    await user.selectOptions(screen.getByLabelText("Direction"), "in");
    await user.type(screen.getByLabelText("Quantity"), "5");
    await user.type(screen.getByLabelText("Reason"), "Count correction");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/inventory/adjustments", expect.objectContaining({ product_id: 7, direction: "in", quantity: "5", reason: "Count correction" })));
    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).startsWith("/inventory/stock"))).toBe(true));
  });
});
