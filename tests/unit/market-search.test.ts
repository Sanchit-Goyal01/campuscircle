import { describe, expect, test } from "vitest";
import { searchListings } from "../../src/modules/market/queries";

function fakeDb() {
  const calls: { textSearch?: unknown[]; limit?: number; eq: unknown[][] } = { eq: [] };
  const chain: any = {
    select: () => chain,
    eq: (...a: unknown[]) => (calls.eq.push(a), chain),
    order: () => chain,
    textSearch: (...a: unknown[]) => ((calls.textSearch = a), chain),
    limit: (n: number) => ((calls.limit = n), chain),
    then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
  };
  return { db: { from: () => chain } as any, calls };
}

describe("searchListings", () => {
  test("search query with quotes, & and : does not throw and is passed as websearch text", async () => {
    const { db, calls } = fakeDb();
    const q = `"data base" & x:y | !z '`;
    await expect(searchListings(db, { query: q })).resolves.toEqual([]);
    expect(calls.textSearch).toEqual(["search", q, { type: "websearch", config: "simple" }]);
  });

  test("empty query skips text search; long query is trimmed and capped at 100", async () => {
    const a = fakeDb();
    await searchListings(a.db, { query: "   " });
    expect(a.calls.textSearch).toBeUndefined();
    const b = fakeDb();
    await searchListings(b.db, { query: ` ${"a".repeat(300)} ` });
    expect((b.calls.textSearch as any[])[1]).toHaveLength(100);
  });

  test("limit is clamped", async () => {
    const a = fakeDb();
    await searchListings(a.db, { limit: 9999 });
    expect(a.calls.limit).toBe(50);
  });
});
