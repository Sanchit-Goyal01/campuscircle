import type { SupabaseClient } from '@supabase/supabase-js';
import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';
import { badRequest } from '@/modules/academics/http';
import { stripAndEncode } from '@/modules/issues/photos';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BAD_TYPE = 'The photo must be JPEG, PNG or WebP';
const TOO_BIG = 'The photo must be 5 MB or less';
const DAILY_PHOTOS = 20;
const DAILY_LIMIT = 'You have uploaded too many photos today. Try again tomorrow.';

/** Photos this author stored in the last 24 hours (their own folder, newest first). */
async function photosToday(db: SupabaseClient, folder: string): Promise<number> {
  const { data, error } = await db.storage
    .from('post-photos')
    .list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw new Error(`Could not count photos: ${error.message}`);
  const since = Date.now() - 24 * 3600_000;
  return (data ?? []).filter((o) => o.id && o.created_at && new Date(o.created_at).getTime() > since).length;
}

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();
    const folder = `${ctx.collegeId}/${ctx.userId}`;
    if ((await photosToday(ctx.db, folder)) >= DAILY_PHOTOS) return errorResponse(429, DAILY_LIMIT);

    if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES + 1024 * 1024) return badRequest(TOO_BIG);
    const form = await request.formData().catch(() => null);
    if (!form) return badRequest('Send the photo as a form upload.');
    const file = form.get('photo');
    if (!(file instanceof File) || file.size === 0) return badRequest('Choose a photo.');
    if (!TYPES.has(file.type)) return badRequest(BAD_TYPE);
    if (file.size > MAX_PHOTO_BYTES) return badRequest(TOO_BIG);

    let body: Buffer;
    try {
      body = await stripAndEncode(Buffer.from(await file.arrayBuffer()));
    } catch {
      return badRequest(BAD_TYPE);
    }
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await ctx.db.storage.from('post-photos').upload(path, body, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Could not store the photo: ${error.message}`);
    return Response.json({ path });
  } catch (e) {
    return unexpected('POST /api/feed/photos', e);
  }
}
