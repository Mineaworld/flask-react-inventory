import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient, clearCsrfToken } from "./api";

afterEach(() => {
  clearCsrfToken();
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("preserves a backend error envelope as a typed ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "validation_error", message: "Check your entry.", fields: { username: "Required" } } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiClient.get("/products")).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      message: "Check your entry.",
      fields: { username: "Required" },
    });
  });

  it("obtains a CSRF token before a mutation and sends it without exposing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { csrf_token: "safe-test-token" } }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 3 } }), { headers: { "Content-Type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.post("/categories", { name: "Office" })).resolves.toEqual({ id: 3 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/auth/csrf", expect.objectContaining({ credentials: "same-origin" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/categories",
      expect.objectContaining({ headers: expect.objectContaining({ "X-CSRFToken": "safe-test-token" }) }),
    );
  });

  it("refreshes an expired CSRF token and retries a mutation exactly once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { csrf_token: "expired-token" } }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "csrf_failed", message: "CSRF token expired." } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { csrf_token: "fresh-token" } }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 4 } }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.post("/categories", { name: "Office" })).resolves.toEqual({ id: 4 });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/categories",
      expect.objectContaining({ headers: expect.objectContaining({ "X-CSRFToken": "expired-token" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/categories",
      expect.objectContaining({ headers: expect.objectContaining({ "X-CSRFToken": "fresh-token" }) }),
    );
  });

  it("does not retry a second CSRF failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrf_token: "first-token" } }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "csrf_failed", message: "Expired." } }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrf_token: "second-token" } }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "csrf_failed", message: "Still expired." } }), { status: 400, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.post("/categories", { name: "Office" })).rejects.toMatchObject({ code: "csrf_failed", message: "Still expired." });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("preserves paginated data and metadata with the page request client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 7, name: "Notebook" }], meta: { page: 2, per_page: 6, total: 13, pages: 3 } }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const pageClient = apiClient as typeof apiClient & {
      getPage: <T>(path: string) => Promise<{ data: T[]; meta: { page: number; pages: number; per_page: number; total: number } }>;
    };

    await expect(pageClient.getPage<{ id: number; name: string }>("/products?page=2")).resolves.toEqual({
      data: [{ id: 7, name: "Notebook" }],
      meta: { page: 2, per_page: 6, total: 13, pages: 3 },
    });
  });

  it("rejects paginated responses with invalid metadata fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [], meta: { page: "1", per_page: 10, total: 0, pages: 0 } }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiClient.getPage("/products")).rejects.toMatchObject({
      code: "invalid_response",
      message: "The server returned an invalid paginated response.",
    });
  });
});
