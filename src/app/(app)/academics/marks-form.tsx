"use client";

import { useActionState } from "react";
import { saveResult, type SaveState } from "./actions";

type Subject = { id: string; name: string };

export function MarksForm({ subjects }: { subjects: Subject[] }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(
    (_prev, formData) => saveResult(formData),
    {},
  );

  return (
    <form action={action} noValidate className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        Semester
        <select name="semester" defaultValue="1" className="border border-zinc-400 px-2 py-1">
          {Array.from({ length: 10 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Subject
        <select name="subject_id" className="border border-zinc-400 px-2 py-1" defaultValue="">
          <option value="" disabled>
            Choose a subject
          </option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Marks
        <input
          name="marks"
          type="number"
          step="any"
          min={0}
          max={100}
          className="w-24 border border-zinc-400 px-2 py-1"
        />
      </label>
      <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
        {pending ? "Saving..." : "Save marks"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
