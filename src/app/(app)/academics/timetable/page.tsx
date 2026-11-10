import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { agentToday } from "@/lib/today";
import { DeleteButton } from "../delete-button";
import { deleteEntry } from "./actions";
import { TimetableForm } from "./timetable-form";
import { WEEKDAYS } from "./weekdays";

type Entry = {
  id: string;
  kind: "class" | "exam";
  weekday: number | null;
  exam_date: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  subjects: { name: string } | null;
};

const hhmm = (t: string) => t.slice(0, 5);
const label = (e: Entry) => e.subjects?.name ?? (e.kind === "exam" ? "Exam" : "Class");
const timeRange = (e: Entry) => (e.end_time ? `${hhmm(e.start_time)} to ${hhmm(e.end_time)}` : hhmm(e.start_time));

function daysLeft(examDate: string, today: string): string {
  const diff = Math.round((Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "today";
  return diff === 1 ? "1 day left" : `${diff} days left`;
}

async function Timetable() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const [{ data: subjects }, { data: entries }] = await Promise.all([
    me.db.from("subjects").select("id, name").order("name"),
    me.db
      .from("timetable_entries")
      .select("id, kind, weekday, exam_date, start_time, end_time, location, subjects(name)")
      .order("start_time"),
  ]);

  const rows = (entries ?? []) as unknown as Entry[];
  const today = agentToday();
  const classes = rows.filter((r) => r.kind === "class");
  const upcoming = rows
    .filter((r) => r.kind === "exam" && r.exam_date !== null && r.exam_date >= today)
    .sort((a, b) => (a.exam_date! + a.start_time).localeCompare(b.exam_date! + b.start_time));

  const remove = (e: Entry) => (
    <DeleteButton
      action={deleteEntry.bind(null, e.id)}
      label={`Delete ${label(e)} ${timeRange(e)}`}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Timetable</h1>

      <section aria-labelledby="add-entry" className="flex flex-col gap-3">
        <h2 id="add-entry" className="text-xl font-semibold">
          Add a class or exam
        </h2>
        <TimetableForm subjects={(subjects ?? []) as { id: string; name: string }[]} />
      </section>

      <section aria-labelledby="upcoming" className="flex flex-col gap-2">
        <h2 id="upcoming" className="text-xl font-semibold">
          Upcoming exams
        </h2>
        {upcoming.length === 0 ? (
          <p>No upcoming exams.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {label(e)}, {e.exam_date} at {timeRange(e)}
                  {e.location ? `, ${e.location}` : ""}
                </span>
                <strong>{daysLeft(e.exam_date!, today)}</strong>
                {remove(e)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="week" className="flex flex-col gap-2">
        <h2 id="week" className="text-xl font-semibold">
          Weekly timetable
        </h2>
        {classes.length === 0 && <p>No classes yet. Add your first class above.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                {WEEKDAYS.map((d, i) => (
                  <td key={d} aria-label={d}>
                    <ul className="flex flex-col gap-2">
                      {classes
                        .filter((c) => c.weekday === i + 1)
                        .map((c) => (
                          <li key={c.id}>
                            <p className="font-medium">{label(c)}</p>
                            <p>{timeRange(c)}</p>
                            {c.location && <p>{c.location}</p>}
                            {remove(c)}
                          </li>
                        ))}
                    </ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function TimetablePage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading timetable...</p>}>
      <Timetable />
    </Suspense>
  );
}
