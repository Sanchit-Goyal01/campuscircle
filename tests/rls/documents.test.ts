import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { ingestNote, uploadPaper } from "../../src/modules/academics/ingest";
import type { Embedder } from "../../src/modules/academics/embed";
import { imageOnlyPdf, textPdf } from "../fixtures/pdf";

const run = Math.random().toString(36).slice(2, 8);
const dom = `doc-${run}.edu`;
const otherDom = `dco-${run}.edu`;
type S = { id: string; client: SupabaseClient };
let college: string;
let otherCollege: string;
let student: S;
let mate: S;
let outsider: S;
let subject: string;

/** Deterministic 384-dim vector: each word hashes to a bucket, then normalise. */
function fakeVector(text: string): number[] {
  const v = new Array<number>(384).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % 384] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
function decoyVector(q: number[], i: number, n: number): number[] {
  const t = 0.05 + 0.5 * (i / n);
  const v = q.map((x, d) => (1 - t) * x + t * Math.sin(i * 12.9898 + d * 78.233) * 0.1);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}
const fake: Embedder = async (_db, texts) => texts.map(fakeVector);

const pdfFile = (bytes: Uint8Array, name = "n.pdf") =>
  new File([bytes as BlobPart], name, { type: "application/pdf" });
const ctxOf = (s: S, collegeId: string) => ({ userId: s.id, collegeId });

beforeAll(async () => {
  college = await createCollege(`Docs College ${run}`, dom);
  otherCollege = await createCollege(`Docs Other ${run}`, otherDom);
  student = await createStudent(`s-${run}@${dom}`);
  mate = await createStudent(`m-${run}@${dom}`);
  outsider = await createStudent(`o-${run}@${otherDom}`);
  const { data, error } = await adminClient()
    .from("subjects")
    .insert({ college_id: college, code: `D${run}`, name: "Docs Subject", credits: 3 })
    .select("id")
    .single();
  expect(error).toBeNull();
  subject = data!.id as string;
});

const ingest = async (pages: string[], title = "Notes") =>
  ingestNote(
    student.client,
    ctxOf(student, college),
    { file: pdfFile(await textPdf(pages)), title, subjectId: subject },
    fake,
  );

describe("documents", () => {
  test("ingestNote stores file, chunks and status ready", async () => {
    const { noteId, status } = await ingest(["photosynthesis converts light into chemical energy stored in glucose molecules"]);
    expect(status).toBe("ready");
    const admin = adminClient();
    const { data: note } = await admin.from("notes").select("*").eq("id", noteId).single();
    expect(note).toMatchObject({ status: "ready", page_count: 1, college_id: college, uploaded_by: student.id });
    expect(note!.file_path).toMatch(new RegExp(`^${college}/notes/[0-9a-f-]+\\.pdf$`));
    const { data: stored, error } = await admin.storage.from("academics").download(note!.file_path);
    expect(error).toBeNull();
    expect(stored!.size).toBeGreaterThan(0);
    const { count } = await admin
      .from("note_chunks")
      .select("id", { count: "exact", head: true })
      .eq("note_id", noteId);
    expect(count).toBeGreaterThan(0);
  });

  test("image-only PDF is stored with status not_searchable and no chunks", async () => {
    const { noteId, status } = await ingestNote(
      student.client,
      ctxOf(student, college),
      { file: pdfFile(await imageOnlyPdf(2)), title: "Scan", subjectId: null },
      fake,
    );
    expect(status).toBe("not_searchable");
    const admin = adminClient();
    const { data: note } = await admin.from("notes").select("status, page_count, file_path").eq("id", noteId).single();
    expect(note).toMatchObject({ status: "not_searchable", page_count: 2 });
    expect((await admin.storage.from("academics").download(note!.file_path)).error).toBeNull();
    const { count } = await admin
      .from("note_chunks")
      .select("id", { count: "exact", head: true })
      .eq("note_id", noteId);
    expect(count).toBe(0);
  });

  test("embedding failure marks the note failed and keeps the file", async () => {
    const boom: Embedder = async () => {
      throw new Error("model down");
    };
    const { noteId, status } = await ingestNote(
      student.client,
      ctxOf(student, college),
      { file: pdfFile(await textPdf(["x ".repeat(60)])), title: "Boom", subjectId: null },
      boom,
    );
    expect(status).toBe("failed");
    const admin = adminClient();
    const { data: note } = await admin.from("notes").select("status, file_path").eq("id", noteId).single();
    expect(note!.status).toBe("failed");
    expect((await admin.storage.from("academics").download(note!.file_path)).error).toBeNull();
  });

  test("match_note_chunks returns the closest chunk with its page", async () => {
    const { noteId } = await ingest(
      [
        "mitochondria generate cellular energy through respiration in every cell of the body",
        "the french revolution began in seventeen eighty nine with the storming of the bastille",
      ],
      "Mixed",
    );
    const { data, error } = await mate.client.rpc("match_note_chunks", {
      query_embedding: JSON.stringify(fakeVector("storming of the bastille french revolution")),
      match_count: 3,
      filter_note: noteId,
    });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0]).toMatchObject({ note_id: noteId, title: "Mixed", page: 2 });
    expect(data![0].content).toContain("bastille");
    expect(data![0].similarity).toBeGreaterThan(data![data!.length - 1].similarity - 1e-9);
  });

  test("student of college B finds no chunks and cannot read the file from college A", async () => {
    const { noteId } = await ingest(["quantum entanglement links particles across any distance of space"], "Quantum");
    const admin = adminClient();
    const { data: note } = await admin.from("notes").select("file_path").eq("id", noteId).single();
    // The rows and the file exist, proven through the admin client.
    expect((await admin.storage.from("academics").download(note!.file_path)).error).toBeNull();
    const { count } = await admin.from("note_chunks").select("id", { count: "exact", head: true }).eq("note_id", noteId);
    expect(count).toBeGreaterThan(0);

    const q = JSON.stringify(fakeVector("quantum entanglement particles"));
    const own = await student.client.rpc("match_note_chunks", { query_embedding: q, match_count: 5, filter_note: noteId });
    expect(own.data!.length).toBeGreaterThan(0);
    const foreign = await outsider.client.rpc("match_note_chunks", { query_embedding: q, match_count: 5 });
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);

    const rows = await outsider.client.from("notes").select("id").eq("id", noteId);
    expect(rows.data).toEqual([]);
    const chunks = await outsider.client.from("note_chunks").select("id").eq("note_id", noteId);
    expect(chunks.data).toEqual([]);

    const dl = await outsider.client.storage.from("academics").download(note!.file_path);
    expect(dl.data).toBeNull();
    expect(dl.error).not.toBeNull();

    // And cannot write into college A's folder either.
    const up = await outsider.client.storage
      .from("academics")
      .upload(`${college}/notes/${crypto.randomUUID()}.pdf`, new Uint8Array(await textPdf(["x"])), {
        contentType: "application/pdf",
      });
    expect(up.error).toMatchObject({ statusCode: "403" });
  });

  test("only the uploader can delete a note; chunks go with it", async () => {
    const { noteId } = await ingest(["gravity bends spacetime around every massive object in the universe"], "Gravity");
    const admin = adminClient();
    const chunkCount = async () =>
      (await admin.from("note_chunks").select("id", { count: "exact", head: true }).eq("note_id", noteId)).count;
    expect(await chunkCount()).toBeGreaterThan(0);

    // A classmate's delete matches no row (RLS), proven by the row surviving.
    const refused = await mate.client.from("notes").delete().eq("id", noteId).select("id");
    expect(refused.data).toEqual([]);
    expect((await admin.from("notes").select("id").eq("id", noteId)).data).toHaveLength(1);
    expect(await chunkCount()).toBeGreaterThan(0);

    // Nor can a classmate change its status.
    const upd = await mate.client.from("notes").update({ status: "failed" }).eq("id", noteId).select("id");
    expect(upd.data).toEqual([]);
    expect((await admin.from("notes").select("status").eq("id", noteId).single()).data!.status).toBe("ready");

    const ok = await student.client.from("notes").delete().eq("id", noteId).select("id");
    expect(ok.data).toHaveLength(1);
    expect(await chunkCount()).toBe(0);
  });

  test("a classmate cannot add chunks to someone else's note", async () => {
    const { noteId } = await ingest(["entropy always increases in an isolated system over time"], "Entropy");
    const { error } = await mate.client.from("note_chunks").insert({
      note_id: noteId,
      college_id: college,
      page: 1,
      seq: 99,
      content: "injected",
      embedding: JSON.stringify(fakeVector("injected")),
    });
    expect(error?.code).toBe("42501");
  });

  test("papers: upload, classmates read, only uploader deletes", async () => {
    const { paperId } = await uploadPaper(student.client, ctxOf(student, college), {
      file: pdfFile(await textPdf(["paper"])),
      subjectId: subject,
      year: 2024,
      examType: "midterm",
    });
    const seen = await mate.client.from("past_papers").select("id").eq("id", paperId);
    expect(seen.data).toHaveLength(1);
    expect((await outsider.client.from("past_papers").select("id").eq("id", paperId)).data).toEqual([]);
    const refused = await mate.client.from("past_papers").delete().eq("id", paperId).select("id");
    expect(refused.data).toEqual([]);
    expect((await adminClient().from("past_papers").select("id").eq("id", paperId)).data).toHaveLength(1);
    const ok = await student.client.from("past_papers").delete().eq("id", paperId).select("id");
    expect(ok.data).toHaveLength(1);
  });

  test("non-PDF and 21 MB files are refused with not_pdf and too_large", async () => {
    const c = ctxOf(student, college);
    const txt = new File(["hello"], "a.txt", { type: "text/plain" });
    await expect(ingestNote(student.client, c, { file: txt, title: "t", subjectId: null }, fake)).rejects.toMatchObject({
      code: "not_pdf",
    });
    const fakePdf = new File(["not really a pdf"], "a.pdf", { type: "application/pdf" });
    await expect(ingestNote(student.client, c, { file: fakePdf, title: "t", subjectId: null }, fake)).rejects.toMatchObject({
      code: "not_pdf",
    });
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    await expect(ingestNote(student.client, c, { file: big, title: "t", subjectId: null }, fake)).rejects.toMatchObject({
      code: "too_large",
    });
    await expect(
      uploadPaper(student.client, c, { file: big, subjectId: subject, year: 2024, examType: "quiz" }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  test("a PDF over 300 pages is refused with too_many_pages", async () => {
    const f = pdfFile(await imageOnlyPdf(301));
    await expect(
      ingestNote(student.client, ctxOf(student, college), { file: f, title: "t", subjectId: null }, fake),
    ).rejects.toMatchObject({ code: "too_many_pages" });
  });

  test("a failure while storing chunks leaves zero chunks and a failed note", async () => {
    // 150 chunks; the last vector has the wrong dimension, so the insert is refused.
    const bad: Embedder = async (_db, texts) =>
      texts.map((t, i) => (i === texts.length - 1 ? [1, 2, 3] : fakeVector(t)));
    const longText = Array.from({ length: 2600 }, (_, i) => `w${i % 97}`).join(" ");
    const { noteId, status } = await ingestNote(
      student.client,
      ctxOf(student, college),
      { file: pdfFile(await textPdf([longText, longText, longText])), title: "Atomic", subjectId: null },
      bad,
    );
    expect(status).toBe("failed");
    const admin = adminClient();
    const { count } = await admin.from("note_chunks").select("id", { count: "exact", head: true }).eq("note_id", noteId);
    expect(count).toBe(0);
    expect((await admin.from("notes").select("status").eq("id", noteId).single()).data!.status).toBe("failed");
  });

  test("search still finds ready chunks behind thousands of nearer filtered-out ones", async () => {
    const admin = adminClient();
    // The query is far from the target and identical to every decoy, so all
    // of HNSW's first candidates are decoys that RLS and the filter then drop.
    const q = fakeVector("unrelated query words about algebra and calculus homework");
    // Thousands of nearer decoys in a note that is still processing: same college,
    // so only the status filter (applied after the HNSW scan) drops them.
    const { data: decoyNote } = await admin
      .from("notes")
      .insert({ college_id: college, uploaded_by: student.id, title: "Decoys", file_path: `${college}/notes/d.pdf`, status: "processing" })
      .select("id")
      .single();
        // Many ready notes make `status = 'ready'` look unselective, so the planner
    // scans the HNSW index first and filters afterwards, as it would at scale.
    const readyNotes = await admin
      .from("notes")
      .insert(
        Array.from({ length: 200 }, (_, i) => ({
          college_id: college, uploaded_by: student.id, title: `Filler ${i}`,
          file_path: `${college}/notes/f${i}.pdf`, status: "ready",
        })),
      )
      .select("id");
    expect(readyNotes.error).toBeNull();
    const rows = Array.from({ length: 12000 }, (_, i) => ({
      note_id: decoyNote!.id, college_id: college, page: 1, seq: i, content: "decoy",
      // A continuum from the query towards random directions: every decoy stays
      // nearer to the query than the target, yet the HNSW graph stays connected.
      embedding: JSON.stringify(decoyVector(q, i, 12000)),
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      expect((await admin.from("note_chunks").insert(rows.slice(i, i + 1000))).error).toBeNull();
    }
    // Ingested after the decoys so it is linked into the HNSW graph like any later upload.
    const target = await ingest(["zebra crossing paint stripes zebra herd migration savanna zebra"], "Zebra");
    const { data, error } = await student.client.rpc("match_note_chunks", {
      query_embedding: JSON.stringify(q),
      match_count: 50,
    });
    expect(error).toBeNull();
    expect(data!.map((r: { note_id: string }) => r.note_id)).toContain(target.noteId);
  }, 120_000);

  test("an outsider cannot insert a note pointing at college A", async () => {
    const forged = { uploaded_by: outsider.id, title: "x", file_path: `${college}/notes/${crypto.randomUUID()}.pdf` };
    const a = await outsider.client.from("notes").insert({ ...forged, college_id: college });
    expect(a.error?.code).toBe("42501");
    const b = await outsider.client.from("notes").insert({ ...forged, college_id: otherCollege });
    expect(b.error?.code).toBe("42501");
  });

  test("a paper with a foreign-college subject is refused", async () => {
    const { data: foreign } = await adminClient()
      .from("subjects")
      .insert({ college_id: otherCollege, code: `F${run}`, name: "Foreign", credits: 3 })
      .select("id")
      .single();
    const { error } = await student.client.from("past_papers").insert({
      college_id: college,
      uploaded_by: student.id,
      subject_id: foreign!.id,
      year: 2024,
      exam_type: "quiz",
      file_path: `${college}/papers/${crypto.randomUUID()}.pdf`,
    });
    expect(error?.code).toBe("42501");
  });

  test("a classmate can download the uploaded file from Storage", async () => {
    const { noteId } = await ingest(["classmates may read the shared study file freely here today"], "Shared");
    const { data: note } = await adminClient().from("notes").select("file_path").eq("id", noteId).single();
    const dl = await mate.client.storage.from("academics").download(note!.file_path);
    expect(dl.error).toBeNull();
    expect(dl.data!.size).toBeGreaterThan(0);
  });

  test("edge embed function returns 384 numbers for a signed-in student", async () => {
    const { data, error } = await student.client.functions.invoke("embed", {
      body: { texts: ["hello world"] },
    });
    expect(error).toBeNull();
    expect(data.embeddings).toHaveLength(1);
    expect(data.embeddings[0]).toHaveLength(384);
    expect(Math.hypot(...(data.embeddings[0] as number[]))).toBeCloseTo(1, 2);
  }, 120_000); // the first call downloads the model
});
