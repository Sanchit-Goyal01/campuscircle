import { signedOut, unexpected } from '@/agent/api';
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

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

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
        return badRequest('One of the photos could not be read as an image');
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
