import { signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';
import { ingestNote } from '@/modules/academics/ingest';
import { UUID, badRequest, filePart, textField, tooLargeResponse, uploadErrorResponse } from '@/modules/academics/http';

// Extracting and embedding a long PDF can take a while.
export const maxDuration = 300;

const MAX_TITLE = 200;

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const tooLarge = tooLargeResponse(request);
    if (tooLarge) return tooLarge;

    const form = await request.formData().catch(() => null);
    if (!form) return badRequest('Send the note as a form upload.');
    const title = textField(form, 'title');
    const subjectRaw = textField(form, 'subject_id');
    const file = filePart(form);
    if (!title || title.length > MAX_TITLE) return badRequest(`Enter a title of 1 to ${MAX_TITLE} characters.`);
    if (subjectRaw && !UUID.test(subjectRaw)) return badRequest('Choose a valid subject.');
    if (!file) return badRequest('Choose a PDF file.');

    if (subjectRaw) {
      // RLS limits this to the student's own college.
      const { data, error } = await ctx.db.from('subjects').select('id').eq('id', subjectRaw).maybeSingle();
      if (error) throw new Error(`Could not check the subject: ${error.message}`);
      if (!data) return badRequest('Choose a valid subject.');
    }

    const result = await ingestNote(ctx.db, ctx, { file, title, subjectId: subjectRaw || null });
    return Response.json(result);
  } catch (e) {
    return uploadErrorResponse(e) ?? unexpected('POST /api/academics/notes', e);
  }
}
