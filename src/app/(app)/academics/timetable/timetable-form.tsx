"use client";

import { useActionState, useState } from "react";
import { saveEntry, type SaveState } from "./actions";
import { WEEKDAYS } from "./weekdays";

type Subject = { id: string; name: string };

export function TimetableForm({ subjects }: { subjects: Subject[] }) {
  const [kind, setKind] = useState<"class" | "exam">("class");
  const [state, action, pending] = useActionState<SaveState, FormData>(
    (_prev, formData) => saveEntry(formData),
    {},
  );
  const field = "border border-zinc-400 px-2 py-1";

  return (
    <form action={action} noValidate className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        Type
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "class" | "exam")} className={field}>
          <option value="class">Class</option>
          <option value="exam">Exam</option>
        </select>
      </label>
      {kind === "class" ? (
        <label className="flex flex-col text-sm">
          Weekday
          <select name="weekday" defaultValue="1" className={field}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col text-sm">
          Exam date
          <input name="exam_date" type="date" className={field} />
        </label>
      )}
      <label className="flex flex-col text-sm">
        Subject
        <select name="subject_id" defaultValue="" className={field}>
          <option value="">No subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Start time
        <input name="start_time" type="time" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        End time
        <input name="end_time" type="time" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Location
        <input name="location" type="text" className={field} />
      </label>
      <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
        {pending ? "Saving..." : "Add entry"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
