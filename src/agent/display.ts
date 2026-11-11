import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID } from '../modules/academics/http';
import { formatWhen } from '../modules/events/queries';

/** Plain details for an approval card, so the student never has to read an id. A null name or title means the lookup found nothing. */
export type PersonDisplay = {
  name: string | null;
  verified: boolean;
  /** Role, then up to 2 skills, so same-named people can be told apart. */
  detail: string;
  /** Same-college profiles with exactly this full name (including this one). */
  sameNameCount: number;
};

export type ActionDisplay =
  | { kind: 'mentorship'; mentor: string | null; person: PersonDisplay; subject: string; message: string }
  | { kind: 'message'; recipient: string | null; person: PersonDisplay; body: string }
  | { kind: 'event'; title: string | null; when: string | null; venue: string | null };

type Pending = { tool_name: string; input: unknown };

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const idOf = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

const NO_PERSON: PersonDisplay = { name: null, verified: false, detail: '', sameNameCount: 0 };

/** Name, Verified flag, role and skills of a profile, and how many same-college profiles share the exact name. */
async function describePerson(db: SupabaseClient, id: string | null): Promise<PersonDisplay> {
  if (!id) return NO_PERSON;
  const { data } = await db
    .from('profiles')
    .select('full_name, verified, role, skills, college_id')
    .eq('id', id)
    .maybeSingle();
  const name = (data?.full_name as string | undefined)?.trim() || null;
  if (!data || !name) return NO_PERSON;
  const { count } = await db
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('college_id', data.college_id as string)
    .eq('full_name', data.full_name as string);
  const skills = Array.isArray(data.skills) ? (data.skills as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  const role = typeof data.role === 'string' ? data.role.replace(/_/g, ' ') : '';
  return {
    name,
    verified: data.verified === true,
    detail: [role, ...skills.slice(0, 2)].filter(Boolean).join(', '),
    sameNameCount: count ?? 1,
  };
}

/**
 * Resolves who or what a write action would touch. It runs on the server with the
 * student's own RLS client, so only things in their college can be named, and the
 * name shown is the one the action would really use (not model-written text).
 */
export async function describeAction(db: SupabaseClient, action: Pending): Promise<ActionDisplay | null> {
  const input = (action.input ?? {}) as Record<string, unknown>;
  if (action.tool_name === 'request_mentorship') {
    const person = await describePerson(db, idOf(input.mentor_id));
    return { kind: 'mentorship', mentor: person.name, person, subject: text(input.subject), message: text(input.message) };
  }
  if (action.tool_name === 'send_message') {
    const person = await describePerson(db, idOf(input.recipient_id));
    return { kind: 'message', recipient: person.name, person, body: text(input.body) };
  }
  if (action.tool_name === 'register_for_event') {
    const id = idOf(input.event_id);
    if (id) {
      const { data } = await db.from('events').select('title, starts_at, venue').eq('id', id).maybeSingle();
      if (data) {
        return { kind: 'event', title: data.title, when: formatWhen(data.starts_at) + ' IST', venue: data.venue };
      }
    }
    return { kind: 'event', title: null, when: null, venue: null };
  }
  return null;
}
