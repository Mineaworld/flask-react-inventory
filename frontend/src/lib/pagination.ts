import type { PaginatedResult } from "./api";

type Identified = {
  id: number;
};

export async function fetchAllPagesById<T extends Identified>(
  fetchPage: (page: number) => Promise<PaginatedResult<T>>,
): Promise<T[]> {
  const firstPage = await fetchPage(1);
  const remainingPageNumbers = Array.from(
    { length: Math.max(firstPage.meta.pages - 1, 0) },
    (_, index) => index + 2,
  );
  const remainingPages = await Promise.all(remainingPageNumbers.map(fetchPage));
  const byId = new Map<number, T>();

  for (const item of [...firstPage.data, ...remainingPages.flatMap((page) => page.data)]) {
    byId.set(item.id, item);
  }

  return [...byId.values()];
}
