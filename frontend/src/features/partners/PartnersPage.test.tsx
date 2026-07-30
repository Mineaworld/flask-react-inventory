import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PartnersPage } from "./PartnersPage";
import { apiClient } from "../../lib/api";

vi.mock("../../lib/api", () => ({ apiClient: { getPage: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

describe("PartnersPage", () => {
  it("shows a loading state without a false error while partners are pending", () => {
    vi.mocked(apiClient.getPage).mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<QueryClientProvider client={queryClient}><PartnersPage role="manager" /></QueryClientProvider>);

    expect(screen.getByLabelText("Loading customers")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("only requests the safe active customer picker for Staff", async () => {
    vi.mocked(apiClient.getPage).mockResolvedValue({ data: [{ id: 4, name: "Walk-in customer", code: "CUS-00004" }], meta: { page: 1, pages: 1, per_page: 10, total: 1 } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<QueryClientProvider client={queryClient}><PartnersPage role="staff" /></QueryClientProvider>);

    expect(await screen.findByText("Walk-in customer")).toBeInTheDocument();
    expect(screen.getByText(/safe customer picker/i)).toBeInTheDocument();
    expect(apiClient.getPage).toHaveBeenCalledWith(expect.stringContaining("for_sale=true"));
    expect(screen.queryByRole("tab", { name: "Suppliers" })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
  });

  it("lets Staff choose the customer-picker page size and reloads page one", async () => {
    vi.mocked(apiClient.getPage).mockImplementation((path) => Promise.resolve({
      data: [{ id: 4, name: "Walk-in customer", code: "CUS-00004" }],
      meta: { page: 1, pages: 1, per_page: String(path).includes("per_page=25") ? 25 : 10, total: 1 },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(<QueryClientProvider client={queryClient}><PartnersPage role="staff" /></QueryClientProvider>);
    await screen.findByText("Walk-in customer");
    await user.click(screen.getByLabelText("Rows per page for customers"));
    await user.click(screen.getByRole("button", { name: "25" }));

    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).includes("page=1") && String(path).includes("per_page=25") && String(path).includes("for_sale=true"))).toBe(true));
  });

  it("sorts Manager partner tables by name and creation time through the API", async () => {
    vi.mocked(apiClient.getPage).mockResolvedValue({
      data: [{
        id: 4,
        name: "Walk-in customer",
        contact_name: null,
        email: null,
        phone: null,
        address: null,
        is_active: true,
        created_at: "2026-07-15T00:00:00Z",
        updated_at: "2026-07-15T00:00:00Z",
      }],
      meta: { page: 1, pages: 1, per_page: 10, total: 1 },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(<QueryClientProvider client={queryClient}><PartnersPage role="manager" /></QueryClientProvider>);
    await screen.findByText("Walk-in customer");
    await user.click(screen.getByRole("button", { name: /name/i }));

    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).includes("sort=name") && String(path).includes("direction=desc"))).toBe(true));
    await user.click(screen.getByRole("button", { name: /created/i }));
    await waitFor(() => expect(vi.mocked(apiClient.getPage).mock.calls.some(([path]) => String(path).includes("sort=created_at") && String(path).includes("direction=asc"))).toBe(true));
  });
});
