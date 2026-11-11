import { PDFDocument, StandardFonts } from "pdf-lib";

/** A PDF with one page per string, each carrying a real text layer. */
export async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595, 842]);
    // Wrap long text across lines so it stays on the page.
    const words = text.split(/\s+/);
    let line = "";
    let y = 800;
    const flush = () => {
      if (line) page.drawText(line, { x: 40, y, size: 10, font });
      y -= 14;
      line = "";
    };
    for (const w of words) {
      if ((line + " " + w).length > 90) flush();
      line = line ? `${line} ${w}` : w;
    }
    flush();
  }
  return doc.save();
}

/** A PDF whose pages are blank: no text layer at all. */
export async function imageOnlyPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return doc.save();
}
