import { describe, expect, test } from "vitest";
import { chunkPages, extractPages, isSearchable } from "../../src/modules/academics/pdf";
import { imageOnlyPdf, textPdf } from "../fixtures/pdf";

describe("pdf", () => {
  test("extractPages returns one string per page", async () => {
    const pages = await extractPages(await textPdf(["alpha", "beta"]));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("alpha");
    expect(pages[1]).toContain("beta");
    expect(pages[0]).not.toContain("beta");
  });

  test("image-only PDF is not searchable", async () => {
    const pages = await extractPages(await imageOnlyPdf(3));
    expect(pages).toHaveLength(3);
    expect(isSearchable(pages)).toBe(false);
  });

  test("page with 50 non-whitespace characters is searchable", () => {
    expect(isSearchable(["", "a ".repeat(50)])).toBe(true);
    expect(isSearchable(["a ".repeat(49), "  \n "])).toBe(false);
  });

  test("chunks never cross a page and keep page numbers", () => {
    const chunks = chunkPages(["first page text", "", "third page text"]);
    expect(chunks).toEqual([
      { page: 1, seq: 0, content: "first page text" },
      { page: 3, seq: 1, content: "third page text" },
    ]);
  });

  test("long page splits into 1000-character chunks with 150 overlap", () => {
    const text = Array.from({ length: 2500 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const chunks = chunkPages([text]);
    expect(chunks.map((c) => c.content.length)).toEqual([1000, 1000, 800]);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.page === 1)).toBe(true);
    expect(chunks[1].content.slice(0, 150)).toBe(chunks[0].content.slice(-150));
    expect(chunks[2].content.slice(0, 150)).toBe(chunks[1].content.slice(-150));
    expect(chunks[0].content + chunks[1].content.slice(150) + chunks[2].content.slice(150)).toBe(text);
  });
});
