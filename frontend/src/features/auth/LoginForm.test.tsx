import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LoginForm } from "./LoginForm";
import { AuthProvider } from "./AuthProvider";

describe("LoginForm", () => {
  it("validates blank credentials before calling the API", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <AuthProvider initialSession={null}>
          <MemoryRouter>
            <LoginForm />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Username is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
  });
});
