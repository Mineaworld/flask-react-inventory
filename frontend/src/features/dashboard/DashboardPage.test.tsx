import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";
import { apiClient } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  apiClient: { get: vi.fn() },
}));

describe("DashboardPage", () => {
  it("renders staff-safe dashboard data without manager metric assumptions", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      low_stock_count: 1,
      own_draft_sale_count: 2,
      low_stock: [{ product_id: 4, product_name: "Stapler", quantity: "0.000", reorder_level: "2.000", unit: "each" }],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <DashboardPage role="staff" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Stapler")).toBeInTheDocument();
    expect(screen.getByText("0 each")).toBeInTheDocument();
    expect(screen.getByText("2 each")).toBeInTheDocument();
    expect(screen.queryByText("Stock value")).not.toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: /Sales and purchases trend/i })).not.toBeInTheDocument();
  });

  it("renders manager totals and refetches the activity trend for a selected range", async () => {
    vi.mocked(apiClient.get).mockImplementation((path) => Promise.resolve({
      low_stock_count: 0,
      low_stock: [],
      period_days: path.includes("range=week") ? 7 : 30,
      stock_value_usd: "125.5000",
      sales_total_usd: path.includes("range=week") ? "12.0000" : "45.0000",
      purchases_total_usd: path.includes("range=week") ? "8.0000" : "30.0000",
      draft_purchase_count: 1,
      draft_sale_count: 2,
      latest_movements: [],
      activity: [{ date: "2026-07-15", sales_usd: "12.0000", purchases_usd: "8.0000" }],
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <DashboardPage role="manager" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Stock value")).toBeInTheDocument();
    expect(screen.getByText("$125.50")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /Sales and purchases trend/i })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/dashboard?range=month");

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByText("7-day period")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/dashboard?range=week");
  });
});
