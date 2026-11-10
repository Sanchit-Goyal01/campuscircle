import type { SupabaseClient } from '@supabase/supabase-js';

export type Listing = {
  id: string;
  title: string;
  price_inr: number;
  condition: string;
  seller_name: string;
  created_at: string;
  photo_path: string | null;
};

const MAX_LIMIT = 50;
const MAX_QUERY = 100;

/** `₹1,200`, Indian digit grouping. */
export const formatPrice = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`;

/**
 * Available listings in the caller's college (RLS limits it), newest first.
 * A non-empty query goes to Postgres as websearch text, which never raises on
 * quotes, `&`, `:` or stray operators. Trimmed and capped at 100 characters.
 */
export async function searchListings(
  db: SupabaseClient,
  opts: { query?: string; limit?: number } = {},
): Promise<Listing[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 30), 1), MAX_LIMIT);
  const query = (opts.query ?? '').trim().slice(0, MAX_QUERY).trim();
  let q = db
    .from('listings')
    .select('id, title, price_inr, condition, created_at, photo_path, profiles(full_name)')
    .eq('status', 'available');
  if (query) q = q.textSearch('search', query, { type: 'websearch', config: 'simple' });
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not search listings: ${error.message}`);
  return ((data ?? []) as any[]).map((l) => {
    const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
    return {
      id: l.id as string,
      title: l.title as string,
      price_inr: l.price_inr as number,
      condition: l.condition as string,
      seller_name: (p?.full_name || 'A student') as string,
      created_at: l.created_at as string,
      photo_path: (l.photo_path ?? null) as string | null,
    };
  });
}
