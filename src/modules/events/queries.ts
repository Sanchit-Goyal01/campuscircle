import type { SupabaseClient } from '@supabase/supabase-js';
import { localDate, TZ } from './calendar';

export type EventRow = {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
};

const MAX_LIMIT = 100;
const MAX_QUERY = 100;
const DAY = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a local (Asia/Kolkata) day as an ISO instant. Null for invalid dates. */
export function dayStart(date: string): string | null {
  if (!DATE_RE.test(date)) return null;
  const d = new Date(`${date}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) || localDate(d) !== date ? null : d.toISOString();
}

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const todayLocal = () => localDate(new Date(), TZ);

/**
 * Events in the caller's college (RLS limits it) starting in [from, to), soonest
 * first. A non-empty query goes to Postgres as websearch text, which never
 * raises on quotes, `&`, `:` or stray operators.
 */
export async function listEvents(
  db: SupabaseClient,
  opts: { query?: string; fromIso: string; toIso?: string; limit?: number },
): Promise<EventRow[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), MAX_LIMIT);
  const query = (opts.query ?? '').trim().slice(0, MAX_QUERY).trim();
  let q = db
    .from('events')
    .select('id, title, venue, starts_at, ends_at, capacity')
    .gte('starts_at', opts.fromIso);
  if (opts.toIso) q = q.lt('starts_at', opts.toIso);
  if (query) q = q.textSearch('search', query, { type: 'websearch', config: 'simple' });
  const { data, error } = await q.order('starts_at', { ascending: true }).limit(limit);
  if (error) throw new Error(`Could not load events: ${error.message}`);
  return (data ?? []) as EventRow[];
}

export async function registrationCount(db: SupabaseClient, eventId: string): Promise<number> {
  const { data, error } = await db.rpc('event_registration_count', { p_event_id: eventId });
  if (error) throw new Error(`Could not count registrations: ${error.message}`);
  return (data as number) ?? 0;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts });
export const formatWhen = (iso: string) =>
  fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
