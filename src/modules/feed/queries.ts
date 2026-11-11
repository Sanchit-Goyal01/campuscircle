import type { SupabaseClient } from '@supabase/supabase-js';

export type FeedPost = {
  id: string;
  author_id: string;
  author_name: string;
  verified: boolean;
  body: string;
  created_at: string;
  hidden: boolean;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  photo_url: string | null;
};

const MAX_LIMIT = 50;
const SELECT =
  'id, author_id, body, photo_path, hidden_at, created_at, profiles!posts_author_id_fkey(full_name, verified), post_likes(count), post_comments(count)';

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** Shapes rows from the posts select above: counts, my like, and a signed photo URL. */
export async function shapePosts(db: SupabaseClient, rows: any[], viewerId: string): Promise<FeedPost[]> {
  const ids = rows.map((r) => r.id as string);
  const liked = new Set<string>();
  if (ids.length > 0) {
    const { data, error } = await db.from('post_likes').select('post_id').eq('user_id', viewerId).in('post_id', ids);
    if (error) throw new Error(`Could not load likes: ${error.message}`);
    for (const l of data ?? []) liked.add(l.post_id as string);
  }
  // Photos are private: sign each with the viewer's own session.
  const urls = await Promise.all(
    rows.map(async (r) => {
      if (!r.photo_path) return null;
      const { data } = await db.storage.from('post-photos').createSignedUrl(r.photo_path, 300);
      return data?.signedUrl ?? null;
    }),
  );
  return rows.map((r, i) => {
    const p = one<any>(r.profiles);
    return {
      id: r.id as string,
      author_id: r.author_id as string,
      author_name: (p?.full_name || 'A student') as string,
      verified: p?.verified === true,
      body: r.body as string,
      created_at: r.created_at as string,
      hidden: r.hidden_at != null,
      like_count: (one<any>(r.post_likes)?.count ?? 0) as number,
      liked_by_me: liked.has(r.id as string),
      comment_count: (one<any>(r.post_comments)?.count ?? 0) as number,
      photo_url: urls[i],
    };
  });
}

/**
 * Posts in the caller's college (RLS limits it, and hides moderated posts from
 * everyone but their author and college admins), newest first. `before` is the
 * created_at of the last post already shown.
 */
export async function listFeed(
  db: SupabaseClient,
  opts: { before?: string; limit?: number; viewerId: string },
): Promise<FeedPost[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20), 1), MAX_LIMIT);
  let q = db.from('posts').select(SELECT);
  if (opts.before) q = q.lt('created_at', opts.before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not load the feed: ${error.message}`);
  return shapePosts(db, (data ?? []) as any[], opts.viewerId);
}

/** One post, or null when it does not exist or the caller cannot see it. */
export async function getPost(db: SupabaseClient, id: string, viewerId: string): Promise<FeedPost | null> {
  const { data, error } = await db.from('posts').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load the post: ${error.message}`);
  if (!data) return null;
  return (await shapePosts(db, [data], viewerId))[0] ?? null;
}

export type FeedComment = { id: string; author_id: string; author_name: string; verified: boolean; body: string; created_at: string };

export async function listComments(db: SupabaseClient, postId: string, limit = 100): Promise<FeedComment[]> {
  const { data, error } = await db
    .from('post_comments')
    .select('id, author_id, body, created_at, profiles(full_name, verified)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));
  if (error) throw new Error(`Could not load comments: ${error.message}`);
  return ((data ?? []) as any[]).map((c) => {
    const p = one<any>(c.profiles);
    return {
      id: c.id as string,
      author_id: c.author_id as string,
      author_name: (p?.full_name || 'A student') as string,
      verified: p?.verified === true,
      body: c.body as string,
      created_at: c.created_at as string,
    };
  });
}
