import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID } from '../modules/academics/http';
import { formatWhen } from '../modules/events/queries';

/** Plain details for an approval card, so the student never has to read an id. A null name or title means the lookup found nothing. */
export type ActionDisplay =
  | { kind: 'mentorship'; mentor: string | null; subject: string; message: string }
  | { kind: 'event'; title: string | null; when: string | null; venue: string | null };

type Pending = { tool_name: string; input: unknown };

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const idOf = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

/**
 * Resolves who or what a write action would touch. It runs on the server with the
 * student's own RLS client, so only things in their college can be named, and the
 * name shown is the one the action would really use (not model-written text).
 */
export async function describeAction(db: SupabaseClient, action: Pending): Promise<ActionDisplay | null> {
  const input = (action.input ?? {}) as Record<string, unknown>;
  if (action.tool_name === 'request_mentorship') {
    const id = idOf(input.mentor_id);
    let mentor: string | null = null;
    if (id) {
      const { data } = await db.from('profiles').select('full_name').eq('id', id).maybeSingle();
      mentor = (data?.full_name as string | undefined)?.trim() || null;
    }
    return { kind: 'mentorship', mentor, subject: text(input.subject), message: text(input.message) };
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
