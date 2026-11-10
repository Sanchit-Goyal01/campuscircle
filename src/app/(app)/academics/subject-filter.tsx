type Subject = { id: string; name: string };

/** Plain GET form: the chosen subject becomes a `subject` query parameter. */
export function SubjectFilter({ subjects, selected }: { subjects: Subject[]; selected: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        Filter by subject
        <select name="subject" defaultValue={selected} className="border border-zinc-400 px-2 py-1">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
        Apply filter
      </button>
    </form>
  );
}
