import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { monthGrid } from "@/modules/events/calendar";
import { dayStart, formatWhen, listEvents, todayLocal } from "@/modules/events/queries";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type SP = { view?: string | string[]; month?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const shift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function Events({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const sp = await searchParams;
  const calendar = one(sp.view) === "calendar";
  const canCreate = me.profile.role === "college_admin" || me.profile.role === "society_admin";
  const tab = "text-sm underline";

  const header = (
    <>
      <h1 className="font-slab text-3xl font-bold">Events</h1>
      <div className="flex flex-wrap gap-4">
        <Link href="/events" className={tab} aria-current={calendar ? undefined : "page"}>
          Upcoming
        </Link>
        <Link href="/events?view=calendar" className={tab} aria-current={calendar ? "page" : undefined}>
          Calendar
        </Link>
        {canCreate && (
          <Link href="/events/new" className={tab}>
            Create an event
          </Link>
        )}
      </div>
    </>
  );

  if (!calendar) {
    const events = await listEvents(me.db, { fromIso: new Date().toISOString(), limit: 50 });
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {header}
        {events.length === 0 ? (
          <p>No upcoming events.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
                <Link href={`/events/${e.id}`} className="font-medium underline">
                  {e.title}
                </Link>
                <div>
                  {formatWhen(e.starts_at)} · {e.venue}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const raw = one(sp.month);
  const month = raw && MONTH_RE.test(raw) && +raw.slice(0, 4) >= 2000 && +raw.slice(0, 4) <= 2100 ? raw : todayLocal().slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  const fromIso = dayStart(`${month}-01`)!;
  const toIso = dayStart(`${shift(month, 1)}-01`)!;
  const events = await listEvents(me.db, { fromIso, toIso, limit: 100 });
  const weeks = monthGrid(year, mon, events);
  const label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, mon - 1, 1)),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {header}
      <div className="flex items-center gap-4">
        <Link href={`/events?view=calendar&month=${shift(month, -1)}`} className={tab}>
          Previous month
        </Link>
        <h2 className="text-lg font-semibold">{label}</h2>
        <Link href={`/events?view=calendar&month=${shift(month, 1)}`} className={tab}>
          Next month
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} className="border border-zinc-300 p-1 text-left font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w[0].date}>
                {w.map((d) => (
                  <td
                    key={d.date}
                    className={`h-20 border border-zinc-300 p-1 align-top ${d.inMonth ? "" : "text-zinc-400"}`}
                  >
                    <div>{d.day}</div>
                    {d.events.map((e) => (
                      <Link key={e.id} href={`/events/${e.id}`} className="block break-words underline">
                        {e.title}
                      </Link>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EventsPage(props: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Events searchParams={props.searchParams} />
    </Suspense>
  );
}
