import type { SupabaseClient } from '@supabase/supabase-js';

export type Person = { id: string; name: string; bio: string | null; skills: string[]; is_mentor: boolean };

export type FindPeopleOptions = { skill?: string; skills?: string[]; mentorsOnly?: boolean; limit?: number };

const MAX_LIMIT = 50;

/**
 * Students in the caller's college (RLS limits profiles to it), excluding the caller.
 * `skill` matches case-insensitively, whole skill, in JS so no user text reaches a filter string.
 */
export async function findPeople(
  db: SupabaseClient,
  opts: FindPeopleOptions,
  callerId?: string,
): Promise<Person[]> {
  let me = callerId;
  if (!me) {
    const { data } = await db.auth.getUser();
    me = data.user?.id;
  }
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20), 1), MAX_LIMIT);
  let q = db
    .from('profiles')
    .select('id, full_name, bio, skills, is_mentor')
    .eq('role', 'student')
    .order('full_name')
    .order('id')
    .limit(1000);
  if (me) q = q.neq('id', me);
  if (opts.mentorsOnly) q = q.eq('is_mentor', true);
  const { data, error } = await q;
  if (error) throw new Error(`Could not search people: ${error.message}`);
  const want = new Set([...(opts.skill ? [opts.skill] : []), ...(opts.skills ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean));
  // The limit applies after matching, over the whole fetched set.
  return ((data ?? []) as any[])
    .filter((p) => want.size === 0 || (p.skills as string[]).some((s) => want.has(s.toLowerCase())))
    .slice(0, limit)
    .map((p) => ({
      id: p.id as string,
      name: p.full_name as string,
      bio: (p.bio ?? null) as string | null,
      skills: p.skills as string[],
      is_mentor: p.is_mentor as boolean,
    }));
}
