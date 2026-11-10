export const TZ = 'Asia/Kolkata';

export type CalendarDay<E> = {
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  day: number;
  inMonth: boolean;
  events: E[];
};

/** Local `YYYY-MM-DD` of an instant in the given time zone. */
export function localDate(iso: string | Date, tz = TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Weeks (Monday first) covering `month` (1-12) of `year`, each day carrying
 * the events whose start falls on that local date. Leading and trailing days
 * from neighbouring months are included and flagged `inMonth: false`.
 */
export function monthGrid<E extends { starts_at: string }>(
  year: number,
  month: number,
  events: E[],
  tz = TZ,
): CalendarDay<E>[][] {
  const byDate = new Map<string, E[]>();
  for (const e of events) {
    const k = localDate(e.starts_at, tz);
    byDate.set(k, [...(byDate.get(k) ?? []), e]);
  }
  // Calendar arithmetic on UTC dates so the host time zone never matters.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getTime() - lead * 86_400_000);
  const total = Math.ceil((lead + last.getUTCDate()) / 7) * 7;
  const weeks: CalendarDay<E>[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const date = iso(d);
    const day: CalendarDay<E> = {
      date,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
      events: byDate.get(date) ?? [],
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A `datetime-local` value is campus time (Asia/Kolkata). Null when malformed or not a real date. */
export function parseLocal(v: string): string | null {
  if (!LOCAL.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  // 2026-02-31 rolls forward in Date, so the local date must round-trip.
  if (Number.isNaN(d.getTime()) || localDate(d) !== v.slice(0, 10)) return null;
  return d.toISOString();
}
