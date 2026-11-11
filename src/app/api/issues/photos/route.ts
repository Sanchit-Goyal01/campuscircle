import type { SupabaseClient } from '@supabase/supabase-js';
import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';
import { badRequest } from '@/modules/academics/http';
import { stripAndEncode } from '@/modules/issues/photos';

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// Three 8 MB photos plus multipart overhead.
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const BAD_TYPE = 'Photos must be JPEG, PNG or WebP';
const TOO_BIG = 'Each photo must be 8 MB or less';
const TOO_MANY = 'At most 3 photos';
const DAILY_PHOTOS = 20;
const DAILY_LIMIT = 'You have uploaded too many photos today. Try again tomorrow.';

/**
 * Photos this student stored in the last 24 hours, read through their own
 * client: the storage select policy shows a student only their own objects.
 * Route uploads live directly under `<college>/`, newest first.
 */
async function photosToday(db: SupabaseClient, collegeId: string): Promise<number> {
  const { data, error } = await db.storage
    .from('issue-photos')
    .list(collegeId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw new Error(`Could not count photos: ${error.message}`);
  const since = Date.now() - 24 * 3600_000;
  return (data ?? []).filter((o) => o.id && o.created_at && new Date(o.created_at).getTime() > since).length;
}

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();
    if (ctx.role !== 'student') return errorResponse(403, 'Only students can upload issue photos');
    if ((await photosToday(ctx.db, ctx.collegeId)) >= DAILY_PHOTOS) return errorResponse(429, DAILY_LIMIT);

    if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return badRequest(TOO_BIG);

    const form = await request.formData().catch(() => null);
    if (!form) return badRequest('Send the photos as a form upload.');
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return badRequest('Choose at least one photo.');
    if (files.length > MAX_PHOTOS) return badRequest(TOO_MANY);
    for (const f of files) {
      if (!TYPES.has(f.type)) return badRequest(BAD_TYPE);
      if (f.size > MAX_PHOTO_BYTES) return badRequest(TOO_BIG);
    }

    // Re-encode everything first so one bad image stores nothing.
    const encoded: Buffer[] = [];
    for (const f of files) {
      try {
        encoded.push(await stripAndEncode(Buffer.from(await f.arrayBuffer())));
      } catch {
        return badRequest(BAD_TYPE);
      }
    }

    const paths: string[] = [];
    for (const body of encoded) {
      const path = `${ctx.collegeId}/${crypto.randomUUID()}.jpg`;
      const { error } = await ctx.db.storage.from('issue-photos').upload(path, body, { contentType: 'image/jpeg' });
      if (error) {
        if (paths.length) await ctx.db.storage.from('issue-photos').remove(paths);
        throw new Error(`Could not store the photo: ${error.message}`);
      }
      paths.push(path);
    }
    return Response.json({ paths });
  } catch (e) {
    return unexpected('POST /api/issues/photos', e);
  }
}
