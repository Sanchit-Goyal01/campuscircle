import { extractText, getDocumentProxy } from 'unpdf';

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;
const SEARCHABLE_MIN_CHARS = 50;

/** One string per page, in page order. */
export async function extractPages(bytes: Uint8Array): Promise<string[]> {
  // pdf.js may detach the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Searchable when at least one page carries 50 or more non-whitespace characters. */
export function isSearchable(pages: string[]): boolean {
  return pages.some((p) => p.replace(/\s+/g, '').length >= SEARCHABLE_MIN_CHARS);
}

/** Chunks of at most 1000 characters with 150 overlap; a chunk never crosses a page. */
export function chunkPages(pages: string[]): { page: number; seq: number; content: string }[] {
  const out: { page: number; seq: number; content: string }[] = [];
  let seq = 0;
  pages.forEach((raw, i) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    for (let start = 0; ; start += CHUNK_SIZE - CHUNK_OVERLAP) {
      const content = text.slice(start, start + CHUNK_SIZE);
      out.push({ page: i + 1, seq: seq++, content });
      if (start + CHUNK_SIZE >= text.length) break;
    }
  });
  return out;
}
