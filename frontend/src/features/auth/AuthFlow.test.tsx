import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { apiClient } from "../../lib/api";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./AuthProvider";

vi.mock("../../lib/api", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  clearCsrfToken: vi.fn(),
}));

const AuthStateHarness = () => {
  const { logout, user } = useAuth();

  return (
    <>
      <p>{user?.full_name ?? "Signed out"}</p>
      <button onClick={() => void logout()} type="button">Sign out</button>
    </>
  );
};

describe("session flow", () => {
  it("keeps the logged-in session in the workspace and returns to login after logout", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ id: 1, username: "manager", full_name: "Manager User", role: "manager" })
      .mockResolvedValueOnce({ logged_out: true });
    vi.mocked(apiClient.get).mockResolvedValue({
      low_stock_count: 0,
      low_stock: [],
      period_days: 30,
      stock_value_usd: "0.0000",
      sales_total_usd: "0.0000",
      purchases_total_usd: "0.0000",
      draft_purchase_count: 0,
      draft_sale_count: 0,
      latest_movements: [],
      activity: [],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(["products", "all"], [{ id: 99, name: "Previous user product" }]);
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/login"]}>
          <AuthProvider initialSession={null}>
            <App />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Username"), "manager");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Manager User", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(client.getQueryData(["products", "all"])).toBeUndefined();
    await user.click(screen.getByText("Manager User"));
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("heading", { name: "Sign in to inventory system" })).toBeInTheDocument();
  });

  it("clears the local session and all cached user data when logout rejects", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error("Expired CSRF token"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(["products", "all"], [{ id: 5, name: "Private product" }]);
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <AuthProvider initialSession={{ id: 1, username: "manager", full_name: "Manager User", role: "manager" }}>
          <AuthStateHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(client.getQueryData(["products", "all"])).toBeUndefined();
  });
});
