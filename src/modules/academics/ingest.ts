import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '../../agent/types';
import { edgeEmbedder, type Embedder } from './embed';
import { chunkPages, extractPages, isSearchable } from './pdf';

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 300;
const BUCKET = 'academics';

export type UploadErrorCode = 'not_pdf' | 'too_large' | 'too_many_pages';

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

type Ctx = Pick<ToolContext, 'collegeId' | 'userId'>;

function looksLikePdf(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5)).startsWith('%PDF-');
}

/** Checks type and size, returns the bytes. Page count is checked by the caller. */
async function readPdf(file: File): Promise<Uint8Array> {
  if (file.type !== 'application/pdf') throw new UploadError('not_pdf', 'Only PDF files are accepted.');
  if (file.size > MAX_BYTES) throw new UploadError('too_large', 'The file is larger than 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new UploadError('not_pdf', 'Only PDF files are accepted.');
  return bytes;
}

async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  let pages: string[];
  try {
    pages = await extractPages(bytes);
  } catch {
    throw new UploadError('not_pdf', 'This file could not be read as a PDF.');
  }
  if (pages.length > MAX_PAGES) {
    throw new UploadError('too_many_pages', `The PDF has more than ${MAX_PAGES} pages.`);
  }
  return pages;
}

async function storeFile(
  db: SupabaseClient,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (error) throw new Error(`Could not store the file: ${error.message}`);
}

async function removeFile(db: SupabaseClient, path: string): Promise<void> {
  await db.storage.from(BUCKET).remove([path]);
}

export async function ingestNote(
  db: SupabaseClient,
  ctx: Ctx,
  input: { file: File; title: string; subjectId: string | null },
  embed: Embedder = edgeEmbedder,
): Promise<{ noteId: string; status: 'ready' | 'not_searchable' | 'failed' }> {
  const bytes = await readPdf(input.file);
  const pages = await pagesOf(bytes);

  const path = `${ctx.collegeId}/notes/${crypto.randomUUID()}.pdf`;
  await storeFile(db, path, bytes);

  const { data: note, error } = await db
    .from('notes')
    .insert({
      college_id: ctx.collegeId,
      uploaded_by: ctx.userId,
      subject_id: input.subjectId,
      title: input.title,
      file_path: path,
    })
    .select('id')
    .single();
  if (error || !note) {
    await removeFile(db, path);
    throw new Error(`Could not save the note: ${error?.message ?? 'no row returned'}`);
  }
  const noteId = note.id as string;

  const finish = async (status: 'ready' | 'not_searchable' | 'failed') => {
    const { error: upErr } = await db
      .from('notes')
      .update({ status, page_count: pages.length })
      .eq('id', noteId);
    // A failed update to `failed` is reported as failed anyway; the caller can delete and retry.
    if (upErr && status !== 'failed') throw new Error(`Could not update the note: ${upErr.message}`);
    return { noteId, status };
  };

  if (!isSearchable(pages)) return finish('not_searchable');

  try {
    const chunks = chunkPages(pages);
    const vectors = await embed(db, chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) throw new Error('embedding count mismatch');
    const rows = chunks.map((c, i) => ({ ...c, embedding: JSON.stringify(vectors[i]) }));
    // One statement: either every chunk is stored or none is.
    const { error: insErr } = await db.rpc('insert_note_chunks', {
      p_note_id: noteId,
      p_chunks: rows,
    });
    if (insErr) throw new Error(insErr.message);
  } catch {
    // The file stays so the student can delete the note and retry.
    return finish('failed');
  }
  return finish('ready');
}

export async function uploadPaper(
  db: SupabaseClient,
  ctx: Ctx,
  input: { file: File; subjectId: string; year: number; examType: string },
): Promise<{ paperId: string }> {
  const bytes = await readPdf(input.file);
  await pagesOf(bytes);

  const path = `${ctx.collegeId}/papers/${crypto.randomUUID()}.pdf`;
  await storeFile(db, path, bytes);

  const { data, error } = await db
    .from('past_papers')
    .insert({
      college_id: ctx.collegeId,
      uploaded_by: ctx.userId,
      subject_id: input.subjectId,
      year: input.year,
      exam_type: input.examType,
      file_path: path,
    })
    .select('id')
    .single();
  if (error || !data) {
    await removeFile(db, path);
    throw new Error(`Could not save the paper: ${error?.message ?? 'no row returned'}`);
  }
  return { paperId: data.id as string };
}
