import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchasePage, SalesPage } from "./OrdersPage";
import { ApiError, apiClient } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  apiClient: { get: vi.fn(), getPage: vi.fn(), patch: vi.fn(), post: vi.fn() },
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

const supplier = {
  id: 3,
  name: "Paper House",
  contact_name: null,
  email: null,
  phone: null,
  address: null,
  is_active: true,
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
};

const manager = { id: 2, username: "manager", full_name: "Inventory Manager", role: "manager" as const };
const staff = { id: 3, username: "staff", full_name: "Sales Staff", role: "staff" as const };

const purchase = {
  id: 11,
  document_number: "PUR-000011",
  supplier_id: supplier.id,
  supplier_name: supplier.name,
  status: "draft" as const,
  currency: "KHR" as const,
  exchange_rate_to_usd: "4100.000000",
  total_amount: "82000.00",
  total_usd: "20.0000",
  notes: null,
  created_by: manager,
  received_by: null,
  received_at: null,
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
  items: [{
    id: 21,
    product_id: product.id,
    product_name: product.name,
    quantity: "2.000",
    unit_cost: "41000.00",
    unit_cost_usd: "10.0000",
    line_total: "82000.00",
    line_total_usd: "20.0000",
  }],
};

const sale = {
  id: 12,
  document_number: "SAL-000012",
  customer_id: 4,
  customer_name: "Campus Store",
  status: "draft" as const,
  currency: "USD" as const,
  exchange_rate_to_usd: "1.000000",
  total_amount: "3.50",
  total_usd: "3.5000",
  notes: null,
  created_by: staff,
  completed_by: null,
  completed_at: null,
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
  items: [{
    id: 22,
    product_id: product.id,
    product_name: product.name,
    quantity: "1.000",
    unit_price: "3.50",
    unit_price_usd: "3.5000",
    line_total: "3.50",
    line_total_usd: "3.5000",
  }],
};

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pages: 1, per_page: 10, total: data.length } });
const pickerPage = <T,>(data: T[], currentPage: number, pages = 2) => ({
  data,
  meta: { page: currentPage, pages, per_page: 100, total: 101 },
});

function renderPage(element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
  return { invalidate, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchasePage", () => {
  it("shows a loading state without a false error while orders are pending", () => {
    vi.mocked(apiClient.getPage).mockImplementation(() => new Promise(() => undefined));

    renderPage(<PurchasePage role="manager" />);

    expect(screen.getByLabelText("Loading purchases")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads every product and supplier page for document pickers", async () => {
    const laterProduct = { ...product, id: 107, name: "Later Product", sku: "LATE-107" };
    const laterSupplier = { ...supplier, id: 103, name: "Later Supplier" };
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      const request = new URL(String(path), "http://inventory.test");
      if (request.pathname === "/purchases") return Promise.resolve(page([purchase]));
      if (request.pathname === "/products") {
        return Promise.resolve(pickerPage(request.searchParams.get("page") === "2" ? [laterProduct] : [product], Number(request.searchParams.get("page"))));
      }
      if (request.pathname === "/suppliers") {
        return Promise.resolve(pickerPage(request.searchParams.get("page") === "2" ? [laterSupplier] : [supplier], Number(request.searchParams.get("page"))));
      }
      return Promise.reject(new Error(`Unexpected page ${path}`));
    });
    const user = userEvent.setup();
    renderPage(<PurchasePage role="manager" />);

    await screen.findByText("PUR-000011");
    await user.click(screen.getByRole("button", { name: "New purchase" }));
    const dialog = screen.getByRole("dialog", { name: "New purchase" });

    expect(await within(dialog).findByRole("option", { name: "Later Supplier" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("option", { name: "Later Product (LATE-107)" })).toBeInTheDocument();
    expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).includes("/products") && String(path).includes("page=2"))).toBe(true);
    expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).includes("/suppliers") && String(path).includes("page=2"))).toBe(true);
  });

  it("retains an edited document's current partner and product when active picker results omit them", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      const request = new URL(String(path), "http://inventory.test");
      if (request.pathname === "/purchases") return Promise.resolve(page([purchase]));
      if (request.pathname === "/products" || request.pathname === "/suppliers") return Promise.resolve(page([]));
      return Promise.reject(new Error(`Unexpected page ${path}`));
    });
    const user = userEvent.setup();
    renderPage(<PurchasePage role="manager" />);

    await screen.findByText("PUR-000011");
    await user.click(screen.getByRole("button", { name: "More actions for PUR-000011" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit purchase" });

    expect(within(dialog).getByLabelText("Supplier")).toHaveValue("3");
    expect(within(dialog).getByRole("option", { name: "Paper House" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Product 1")).toHaveValue("7");
    expect(within(dialog).getByRole("option", { name: "Pilot Pen (current)" })).toBeInTheDocument();
  });

  it("lets a Manager create a KHR purchase and receive the returned draft", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (String(path).startsWith("/purchases")) return Promise.resolve(page([purchase]));
      if (String(path).startsWith("/suppliers")) return Promise.resolve(page([supplier]));
      if (String(path).startsWith("/products")) return Promise.resolve(page([product]));
      return Promise.reject(new Error(`Unexpected page ${path}`));
    });
    vi.mocked(apiClient.post).mockImplementation((path) => {
      if (path === "/purchases") return Promise.resolve(purchase);
      if (path === "/purchases/11/receive") return Promise.resolve({ ...purchase, status: "received" });
      return Promise.reject(new Error(`Unexpected post ${path}`));
    });
    const user = userEvent.setup();
    const { invalidate } = renderPage(<PurchasePage role="manager" />);

    expect(await screen.findByText("PUR-000011")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New purchase" }));
    const formDialog = screen.getByRole("dialog", { name: "New purchase" });
    await user.selectOptions(within(formDialog).getByLabelText("Supplier"), "3");
    await user.selectOptions(within(formDialog).getByLabelText("Currency"), "KHR");
    await user.clear(within(formDialog).getByLabelText("Exchange rate to USD"));
    await user.type(within(formDialog).getByLabelText("Exchange rate to USD"), "4100");
    await user.selectOptions(within(formDialog).getByLabelText("Product 1"), "7");
    await user.type(within(formDialog).getByLabelText("Quantity 1"), "2");
    await user.type(within(formDialog).getByLabelText("Unit cost 1"), "41000");
    await waitFor(() => expect(within(formDialog).getByText("Estimated USD total").parentElement).toHaveTextContent("$20.00"));
    await user.click(within(formDialog).getByRole("button", { name: "Create purchase" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchases", expect.objectContaining({
      supplier_id: 3,
      currency: "KHR",
      exchange_rate_to_usd: "4100",
      items: [{ product_id: 7, quantity: "2", unit_cost: "41000" }],
    })));
    await user.click(screen.getByRole("button", { name: "More actions for PUR-000011" }));
    await user.click(screen.getByRole("menuitem", { name: "Receive" }));
    const confirmation = screen.getByRole("dialog", { name: "Receive purchase" });
    await user.click(within(confirmation).getByRole("button", { name: "Receive purchase" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchases/11/receive"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["purchases"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory", "stock"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory", "movements"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("renders saved USD values from the purchase detail endpoint", async () => {
    vi.mocked(apiClient.getPage).mockResolvedValue(page([purchase]));
    vi.mocked(apiClient.get).mockResolvedValue(purchase);
    const user = userEvent.setup();
    renderPage(<PurchasePage role="manager" />);

    await screen.findByText("PUR-000011");
    await user.click(screen.getByRole("button", { name: "More actions for PUR-000011" }));
    await user.click(screen.getByRole("menuitem", { name: "View details" }));

    const detail = await screen.findByRole("dialog", { name: "Purchase PUR-000011" });
    expect(apiClient.get).toHaveBeenCalledWith("/purchases/11");
    expect(within(detail).getByText("$10")).toBeInTheDocument();
    expect(within(detail).getAllByText("$20.00")).toHaveLength(2);
    expect(within(detail).getByText("4,100 KHR/USD")).toBeInTheDocument();
    expect(within(detail).getByText("2")).toBeInTheDocument();
    expect(within(detail).getByText("USD total")).toBeInTheDocument();
    expect(within(detail).getByText("Unit USD")).toBeInTheDocument();
  });

  it("shows a role-safe denied page to Staff without requesting purchases", () => {
    renderPage(<PurchasePage role="staff" />);

    expect(screen.getByRole("heading", { name: "Purchase access is restricted" })).toBeInTheDocument();
    expect(apiClient.getPage).not.toHaveBeenCalled();
  });
});

describe("SalesPage", () => {
  it("loads every safe customer page for Staff without unsupported sorting parameters", async () => {
    const laterCustomer = { id: 104, name: "Later Customer", code: "CUS-00104" };
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      const request = new URL(String(path), "http://inventory.test");
      if (request.pathname === "/sales") return Promise.resolve(page([sale]));
      if (request.pathname === "/products") return Promise.resolve(page([product]));
      if (request.pathname === "/customers") {
        const currentPage = Number(request.searchParams.get("page"));
        return Promise.resolve(pickerPage(currentPage === 2 ? [laterCustomer] : [{ id: 4, name: "Campus Store", code: "CUS-00004" }], currentPage));
      }
      return Promise.reject(new Error(`Unexpected page ${path}`));
    });
    const user = userEvent.setup();
    renderPage(<SalesPage role="staff" />);

    await screen.findByText("SAL-000012");
    await user.click(screen.getByRole("button", { name: "New sale" }));
    const dialog = screen.getByRole("dialog", { name: "New sale" });

    expect(await within(dialog).findByRole("option", { name: "Later Customer" })).toBeInTheDocument();
    const customerCalls = vi.mocked(apiClient.getPage).mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith("/customers"));
    expect(customerCalls.some((path) => path.includes("page=2"))).toBe(true);
    expect(customerCalls.every((path) => path.includes("for_sale=true"))).toBe(true);
    expect(customerCalls.every((path) => !path.includes("sort=") && !path.includes("direction="))).toBe(true);
  });

  it("lets Staff create an own sale draft and never exposes completion", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => {
      if (String(path).startsWith("/sales")) return Promise.resolve(page([sale]));
      if (String(path).startsWith("/customers")) return Promise.resolve(page([{ id: 4, name: "Campus Store", code: "CUS-00004" }]));
      if (String(path).startsWith("/products")) return Promise.resolve(page([product]));
      return Promise.reject(new Error(`Unexpected page ${path}`));
    });
    vi.mocked(apiClient.post).mockResolvedValue(sale);
    const user = userEvent.setup();
    renderPage(<SalesPage role="staff" />);

    expect(await screen.findByText("SAL-000012")).toBeInTheDocument();
    expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("/sales?"));
    expect(screen.queryByRole("menuitem", { name: "Complete" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New sale" }));
    const formDialog = screen.getByRole("dialog", { name: "New sale" });
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("/customers?for_sale=true")));
    await user.selectOptions(within(formDialog).getByLabelText("Customer"), "4");
    await user.selectOptions(within(formDialog).getByLabelText("Product 1"), "7");
    await user.type(within(formDialog).getByLabelText("Quantity 1"), "1");
    await user.type(within(formDialog).getByLabelText("Unit price 1"), "3.50");
    await user.click(within(formDialog).getByRole("button", { name: "Create sale" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/sales", expect.objectContaining({
      customer_id: 4,
      currency: "USD",
      exchange_rate_to_usd: "1.00",
      items: [{ product_id: 7, quantity: "1", unit_price: "3.50" }],
    })));
    await user.click(screen.getByRole("button", { name: "More actions for SAL-000012" }));
    expect(screen.queryByRole("menuitem", { name: "Complete" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows an insufficient-stock completion error prominently to a Manager", async () => {
    vi.mocked(apiClient.getPage).mockResolvedValue(page([sale]));
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError({
      code: "insufficient_stock",
      message: "Pilot Pen has only 0.00 each available.",
      status: 409,
    }));
    const user = userEvent.setup();
    const { invalidate } = renderPage(<SalesPage role="manager" />);

    await screen.findByText("SAL-000012");
    await user.click(screen.getByRole("button", { name: "More actions for SAL-000012" }));
    await user.click(screen.getByRole("menuitem", { name: "Complete" }));
    const confirmation = screen.getByRole("dialog", { name: "Complete sale" });
    await user.click(within(confirmation).getByRole("button", { name: "Complete sale" }));

    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("Pilot Pen has only 0.00 each available.");
    expect(within(confirmation).getByText(/stock was not changed/i)).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["inventory", "stock"] });
  });
});
