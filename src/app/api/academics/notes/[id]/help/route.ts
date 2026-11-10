import { z } from 'zod';
import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { getModelClient } from '@/agent/model';
import { getToolContext } from '@/lib/supabase/server';
import { UUID, badRequest } from '@/modules/academics/http';
import { StudyHelpError, studyHelp, type StudyHelpErrorCode } from '@/modules/academics/study-help';

// A model call over up to 24,000 characters of note text.
export const maxDuration = 120;

const STATUS: Record<StudyHelpErrorCode, number> = {
  note_not_found: 404,
  note_not_searchable: 409,
  note_not_ready: 409,
  daily_limit: 429,
  model_failure: 502,
};

const body = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ask'), question: z.string().trim().min(1).max(500) }),
  z.object({ mode: z.literal('summary') }),
  z.object({ mode: z.literal('quiz') }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const { id } = await params;
    if (!UUID.test(id)) return errorResponse(404, 'Note not found.');

    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest('Choose Ask, Summarise or Quiz me. A question needs 1 to 500 characters.');

    const result = await studyHelp({
      db: ctx.db,
      ctx,
      model: getModelClient(),
      noteId: id,
      ...parsed.data,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof StudyHelpError) return errorResponse(STATUS[e.code], e.message);
    return unexpected('POST /api/academics/notes/[id]/help', e);
  }
}
