import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';
import { UUID } from '@/modules/academics/http';

const TABLES = { notes: 'notes', papers: 'past_papers' } as const;
const SIGNED_URL_SECONDS = 60;

/** Redirects to a 60 second Storage signed URL, made with the student's own client. */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const { kind, id } = await params;
    const notFound = () => errorResponse(404, 'File not found.');
    if (!Object.hasOwn(TABLES, kind) || !UUID.test(id)) return notFound();

    // RLS: only rows of the student's own college are visible.
    const { data: row, error } = await ctx.db
      .from(TABLES[kind as keyof typeof TABLES])
      .select('file_path')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the document: ${error.message}`);
    if (!row) return notFound();

    const { data, error: signError } = await ctx.db.storage
      .from('academics')
      .createSignedUrl(row.file_path as string, SIGNED_URL_SECONDS);
    if (signError || !data) throw new Error(`Could not sign the URL: ${signError?.message ?? 'no url'}`);
    return new Response(null, { status: 302, headers: { Location: data.signedUrl, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return unexpected('GET /api/academics/files', e);
  }
}
