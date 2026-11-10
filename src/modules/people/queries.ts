import type { SupabaseClient } from '@supabase/supabase-js';

export type Person = { id: string; name: string; bio: string | null; skills: string[]; is_mentor: boolean };

export type FindPeopleOptions = { skill?: string; mentorsOnly?: boolean; limit?: number };

const MAX_LIMIT = 50;

/**
 * People in the caller's college (RLS limits profiles to it), excluding the caller.
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
    .order('full_name')
    .order('id')
    .limit(1000);
  if (me) q = q.neq('id', me);
  if (opts.mentorsOnly) q = q.eq('is_mentor', true);
  const { data, error } = await q;
  if (error) throw new Error(`Could not search people: ${error.message}`);
  const want = opts.skill?.trim().toLowerCase();
  return ((data ?? []) as any[])
    .filter((p) => !want || (p.skills as string[]).some((s) => s.toLowerCase() === want))
    .slice(0, limit)
    .map((p) => ({
      id: p.id as string,
      name: p.full_name as string,
      bio: (p.bio ?? null) as string | null,
      skills: p.skills as string[],
      is_mentor: p.is_mentor as boolean,
    }));
}
