const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** The date in `timeZone` as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** AGENT_TIMEZONE, or the default when it is unset or not a real timezone. */
export function agentTimezone(): string {
  const timeZone = process.env.AGENT_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    console.error('AGENT_TIMEZONE is not a valid timezone:', timeZone);
    return DEFAULT_TIMEZONE;
  }
}

export const agentToday = (now: Date = new Date()) => todayIn(agentTimezone(), now);

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
