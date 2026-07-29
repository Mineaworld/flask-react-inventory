import { describe, expect, it, vi } from "vitest";

import { fetchAllPagesById } from "./pagination";

describe("fetchAllPagesById", () => {
  it("fetches remaining pages in parallel and merges duplicate IDs once", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      data: page === 1
        ? [{ id: 1, name: "First" }, { id: 2, name: "Original" }]
        : page === 2
          ? [{ id: 2, name: "Updated" }, { id: 3, name: "Third" }]
          : [{ id: 4, name: "Fourth" }],
      meta: { page, pages: 3, per_page: 100, total: 4 },
    }));

    await expect(fetchAllPagesById(fetchPage)).resolves.toEqual([
      { id: 1, name: "First" },
      { id: 2, name: "Updated" },
      { id: 3, name: "Third" },
      { id: 4, name: "Fourth" },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1);
    expect(fetchPage.mock.calls.slice(1).map(([page]) => page)).toEqual([2, 3]);
  });
});
