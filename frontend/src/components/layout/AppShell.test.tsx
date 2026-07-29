import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../../features/auth/AuthProvider";
import { apiClient } from "../../lib/api";
import { AppShell } from "./AppShell";

vi.mock("../../lib/api", () => ({
  apiClient: { get: vi.fn(), getPage: vi.fn(), post: vi.fn() },
  clearCsrfToken: vi.fn(),
}));

const productPageApi = apiClient as typeof apiClient & {
  getPage: <T>(path: string) => Promise<{ data: T[]; meta: { page: number; pages: number; per_page: number; total: number } }>;
};

const LocationDisplay = () => {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
};

const renderShell = (role: "manager" | "staff" = "manager") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider initialSession={{ id: 1, username: role, full_name: `${role} User`, role }}>
          <Routes>
            <Route element={<AppShell />} path="/">
              <Route index element={<LocationDisplay />} />
              <Route element={<LocationDisplay />} path="catalog" />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("AppShell global product search", () => {
  it("hides purchase navigation from Staff while keeping sale access", () => {
    renderShell("staff");

    expect(screen.queryByRole("link", { name: "Purchases" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sales" })).toBeInTheDocument();
  });

  it("opens with slash, queries products after two characters, and routes from a result", async () => {
    vi.mocked(productPageApi.getPage).mockResolvedValue({
      data: [{ id: 7, name: "Notebook", sku: "NOTE 001", category_name: "Stationery", is_active: true, unit: "each", reorder_level: "4.000", default_sale_price_usd: "2.5000" }],
      meta: { page: 1, pages: 1, per_page: 6, total: 1 },
    });
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("/");
    const input = await screen.findByRole("textbox", { name: "Search products" });
    expect(input).toHaveFocus();

    await user.type(input, "no");
    expect(await screen.findByRole("button", { name: /notebook/i })).toBeInTheDocument();
    expect(productPageApi.getPage).toHaveBeenCalledWith("/products?q=no&per_page=6");

    await user.click(screen.getByRole("button", { name: /notebook/i }));
    expect(screen.queryByRole("dialog", { name: "Search products" })).not.toBeInTheDocument();
    expect(screen.getByText("/catalog?query=NOTE%20001")).toBeInTheDocument();
  });

  it("does not claim slash typed into a text field", async () => {
    const user = userEvent.setup();
    renderShell();
    const searchControl = screen.getByRole("button", { name: /search products and skus/i });

    await user.click(searchControl);
    const input = await screen.findByRole("textbox", { name: "Search products" });
    await user.keyboard("{Escape}");
    expect(input).not.toBeInTheDocument();

    const editable = document.createElement("textarea");
    document.body.append(editable);
    editable.focus();
    await user.keyboard("/");

    expect(screen.queryByRole("dialog", { name: "Search products" })).not.toBeInTheDocument();
    editable.remove();
  });

  it("provides one visible mobile search trigger without duplicating the desktop control", () => {
    renderShell();

    const mobileTrigger = screen.getByRole("button", { name: "Search products" });
    const desktopTrigger = screen.getByRole("button", { name: /search products and skus/i });

    expect(mobileTrigger).toHaveClass("sm:hidden");
    expect(desktopTrigger).toHaveClass("hidden", "sm:flex");
    expect(screen.getAllByRole("button", { name: "Search products" })).toHaveLength(1);
  });

  it("keeps keyboard focus inside the mobile navigation and restores it when closed", async () => {
    const user = userEvent.setup();
    renderShell();
    const openButton = screen.getByRole("button", { name: "Open navigation" });

    await user.click(openButton);

    const drawer = screen.getByRole("dialog", { name: "Main navigation" });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Main navigation" })).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("renders the product-search API error", async () => {
    vi.mocked(productPageApi.getPage).mockRejectedValue(new Error("Catalog is temporarily unavailable."));
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("/");
    await user.type(await screen.findByRole("textbox", { name: "Search products" }), "no");

    expect(await screen.findByText("Catalog is temporarily unavailable.")).toBeInTheDocument();
  });

  it("uses ASCII-safe search status, empty-result, and category copy", async () => {
    vi.mocked(productPageApi.getPage)
      .mockResolvedValueOnce({
      data: [],
      meta: { page: 1, pages: 1, per_page: 6, total: 0 },
      })
      .mockResolvedValue({
        data: [{ id: 9, name: "Notebook", sku: "NOTE-001", category_name: "Stationery", is_active: true, unit: "each", reorder_level: "4.000", default_sale_price_usd: "2.5000" }],
        meta: { page: 1, pages: 1, per_page: 6, total: 1 },
      });
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("/");
    await user.type(await screen.findByRole("textbox", { name: "Search products" }), "no");

    expect(await screen.findByText("No products found.")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Search products" }));
    await user.type(screen.getByRole("textbox", { name: "Search products" }), "notes");

    expect(await screen.findByText("NOTE-001 - Stationery")).toBeInTheDocument();
  });

  it("uses ASCII-safe loading copy while a product search is pending", async () => {
    vi.mocked(productPageApi.getPage).mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("/");
    await user.type(await screen.findByRole("textbox", { name: "Search products" }), "no");

    expect(await screen.findByText("Searching products...")).toBeInTheDocument();
  });
});
