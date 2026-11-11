export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved_pending: "Waiting for your confirmation",
  closed: "Closed",
  closed_unverified: "Closed (not confirmed)",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** "in 2 days", "3 hours overdue". */
export function relativeDeadline(iso: string | null, now = Date.now()): string {
  if (!iso) return "No deadline set";
  const diff = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  const text =
    mins < 60 ? `${mins} minute${mins === 1 ? "" : "s"}` : mins < 2880 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
  return diff >= 0 ? `in ${text}` : `${text} overdue`;
}
