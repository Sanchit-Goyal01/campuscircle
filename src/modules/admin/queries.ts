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
 * Posts with open reports in the caller's college (RLS limits reports to the
 * reporter and to college admins). Reporter ids and names are never selected.
 */
export async function reportedPosts(db: SupabaseClient, limit = 50): Promise<ReportedPost[]> {
  const { data, error } = await db
    .from('post_reports')
    .select('reason, created_at, posts!inner(id, body, profiles!posts_author_id_fkey(full_name))')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not load reported posts: ${error.message}`);
  const byPost = new Map<string, ReportedPost>();
  for (const r of (data ?? []) as any[]) {
    const post = one<any>(r.posts);
    if (!post) continue;
    let row = byPost.get(post.id);
    if (!row) {
      row = {
        id: post.id as string,
        body: post.body as string,
        author_name: (one<any>(post.profiles)?.full_name || 'A student') as string,
        report_count: 0,
        reasons: [],
      };
      byPost.set(post.id, row);
    }
    row.report_count += 1;
    row.reasons.push(r.reason as string);
  }
  return [...byPost.values()].slice(0, Math.min(Math.max(Math.trunc(limit), 1), 100));
}

/**
 * Students in the caller's college who are not verified yet. `query` filters by
 * name (case-insensitive substring; LIKE wildcards are escaped).
 */
export async function unverifiedStudents(
  db: SupabaseClient,
  opts: { query?: string; limit?: number } = {},
): Promise<{ id: string; name: string }[]> {
  const query = (opts.query ?? '').trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`);
  let q = db.from('profiles').select('id, full_name').eq('role', 'student').eq('verified', false);
  if (query) q = q.ilike('full_name', `%${query}%`);
  const { data, error } = await q
    .order('full_name')
    .order('id')
    .limit(Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 100));
  if (error) throw new Error(`Could not load students: ${error.message}`);
  return ((data ?? []) as any[]).map((p) => ({ id: p.id as string, name: (p.full_name || 'Unnamed student') as string }));
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
