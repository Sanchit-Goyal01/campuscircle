import type { SupabaseClient } from '@supabase/supabase-js';

export type ReportedPost = {
  id: string;
  body: string;
  author_name: string;
  report_count: number;
  reasons: string[];
};

export type CollegeAnnouncement = { id: string; title: string; body: string; created_at: string };

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/**
 * Posts with open reports in the caller's college. The grouping and counts
 * happen in SQL (reported_posts_queue), which returns no reporter column, so
 * reporter identities never reach the admin's session.
 */
export async function reportedPosts(db: SupabaseClient, limit = 50): Promise<ReportedPost[]> {
  const n = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const { data: groups, error } = await db.rpc('reported_posts_queue', { p_limit: n });
  if (error) throw new Error(`Could not load reported posts: ${error.message}`);
  const rows = (groups ?? []) as { post_id: string; report_count: number | string; reasons: string[] }[];
  if (rows.length === 0) return [];
  const { data: posts, error: pErr } = await db
    .from('posts')
    .select('id, body, profiles!posts_author_id_fkey(full_name)')
    .in('id', rows.map((r) => r.post_id));
  if (pErr) throw new Error(`Could not load reported posts: ${pErr.message}`);
  const byId = new Map(((posts ?? []) as any[]).map((p) => [p.id as string, p]));
  const out: ReportedPost[] = [];
  for (const r of rows) {
    const post = byId.get(r.post_id);
    if (!post) continue;
    out.push({
      id: post.id as string,
      body: post.body as string,
      author_name: (one<any>(post.profiles)?.full_name || 'A student') as string,
      report_count: Number(r.report_count),
      reasons: r.reasons ?? [],
    });
  }
  return out;
}

/**
 * Students in the caller's college who are not verified yet. `query` filters by
 * name (case-insensitive substring; LIKE wildcards are escaped and PostgREST's `*` alias is stripped).
 */
export async function unverifiedStudents(
  db: SupabaseClient,
  opts: { query?: string; limit?: number } = {},
): Promise<{ id: string; name: string }[]> {
  const query = (opts.query ?? '').trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '');
  let q = db.from('profiles').select('id, full_name').eq('role', 'student').eq('verified', false);
  if (query) q = q.ilike('full_name', `%${query}%`);
  const { data, error } = await q
    .order('full_name')
    .order('id')
    .limit(Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 100));
  if (error) throw new Error(`Could not load students: ${error.message}`);
  return ((data ?? []) as any[]).map((p) => ({ id: p.id as string, name: (p.full_name || 'Unnamed student') as string }));
}

/** Like listAnnouncements, but a failed read is logged and reported as `failed` instead of thrown (optional page content). */
export async function loadAnnouncements(
  db: SupabaseClient,
  limit = 50,
): Promise<{ items: CollegeAnnouncement[]; failed: boolean }> {
  try {
    return { items: await listAnnouncements(db, limit), failed: false };
  } catch (e) {
    console.error('Announcements unavailable:', e instanceof Error ? e.message : e);
    return { items: [], failed: true };
  }
}

/** College announcements, newest first. */
export async function listAnnouncements(db: SupabaseClient, limit = 50): Promise<CollegeAnnouncement[]> {
  const { data, error } = await db
    .from('college_announcements')
    .select('id, title, body, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));
  if (error) throw new Error(`Could not load announcements: ${error.message}`);
  return (data ?? []) as CollegeAnnouncement[];
}
