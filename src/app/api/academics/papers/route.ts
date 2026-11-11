import { signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';
import { uploadPaper } from '@/modules/academics/ingest';
import { EXAM_TYPES, type ExamType } from '@/modules/academics/exam-types';
import {
  UUID,
  badRequest,
  filePart,
  textField,
  tooLargeResponse,
  uploadErrorResponse,
} from '@/modules/academics/http';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const tooLarge = tooLargeResponse(request);
    if (tooLarge) return tooLarge;

    const form = await request.formData().catch(() => null);
    if (!form) return badRequest('Send the paper as a form upload.');
    const subjectId = textField(form, 'subject_id');
    const year = Number(textField(form, 'year'));
    const examType = textField(form, 'exam_type');
    const file = filePart(form);
    if (!UUID.test(subjectId)) return badRequest('Choose a subject.');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return badRequest('Year must be between 2000 and 2100.');
    if (!EXAM_TYPES.includes(examType as ExamType)) return badRequest('Choose an exam type.');
    if (!file) return badRequest('Choose a PDF file.');

    // RLS limits this to the student's own college.
    const { data, error } = await ctx.db.from('subjects').select('id').eq('id', subjectId).maybeSingle();
    if (error) throw new Error(`Could not check the subject: ${error.message}`);
    if (!data) return badRequest('Choose a subject.');

    const result = await uploadPaper(ctx.db, ctx, { file, subjectId, year, examType });
    return Response.json(result);
  } catch (e) {
    return uploadErrorResponse(e) ?? unexpected('POST /api/academics/papers', e);
  }
}
