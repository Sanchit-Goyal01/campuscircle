import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { cgpa, sgpaBySemester, weakSubjects, type ResultRow } from "@/modules/academics/gpa";
import { deleteResult } from "./actions";
import { MarksForm } from "./marks-form";

type Row = ResultRow & { id: string };

async function Academics() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const [{ data: subjects }, { data: results }] = await Promise.all([
    me.db.from("subjects").select("id, name").order("name"),
    me.db
      .from("subject_results")
      .select("id, semester, marks, grade_points, subjects(name, credits)")
      .order("semester"),
  ]);

  const rows: Row[] = (results ?? []).map((r) => {
    const s = r.subjects as unknown as { name: string; credits: number } | null;
    return {
      id: r.id as string,
      semester: r.semester as number,
      subject: s?.name ?? "Unknown subject",
      credits: Number(s?.credits ?? 0),
      marks: r.marks === null ? null : Number(r.marks),
      grade_points: r.grade_points === null ? null : Number(r.grade_points),
    };
  });

  const sgpas = sgpaBySemester(rows);
  const overall = cgpa(rows);
  const weak = weakSubjects(rows);
  const semesters = [...new Set(rows.map((r) => r.semester))].sort((a, b) => a - b);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Academics</h1>
      <nav aria-label="Academics" className="flex gap-4 text-sm">
        <Link href="/academics/notes" className="underline">
          Notes
        </Link>
        <Link href="/academics/papers" className="underline">
          Past papers
        </Link>
        <Link href="/academics/plans" className="underline">
          Study plans
        </Link>
      </nav>

      <section aria-labelledby="add-marks" className="flex flex-col gap-3">
        <h2 id="add-marks" className="text-xl font-semibold">
          Enter a result
        </h2>
        <MarksForm subjects={(subjects ?? []) as { id: string; name: string }[]} />
      </section>

      {rows.length === 0 ? (
        <p>No marks yet. Add your first subject above.</p>
      ) : (
        <>
          {semesters.map((sem) => {
            const sgpa = sgpas.find((s) => s.semester === sem);
            return (
              <section key={sem} aria-label={`Semester ${sem}`} className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold">Semester {sem}</h2>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col">Subject</th>
                      <th scope="col">Credits</th>
                      <th scope="col">Marks</th>
                      <th scope="col">Grade points</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((r) => r.semester === sem)
                      .map((r) => (
                        <tr key={r.id}>
                          <td>{r.subject}</td>
                          <td>{r.credits}</td>
                          <td>{r.marks ?? "-"}</td>
                          <td>{r.grade_points ?? "-"}</td>
                          <td>
                            <form action={deleteResult.bind(null, r.id)}>
                              <button type="submit" className="underline" aria-label={`Delete ${r.subject} semester ${sem}`}>
                                Delete
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="font-medium">SGPA: {sgpa ? sgpa.sgpa.toFixed(2) : "-"}</p>
              </section>
            );
          })}

          <p className="text-lg font-semibold">CGPA: {overall === null ? "-" : overall.toFixed(2)}</p>

          <section aria-labelledby="weak" className="flex flex-col gap-2">
            <h2 id="weak" className="text-xl font-semibold">
              Weak subjects
            </h2>
            {weak.length === 0 ? (
              <p>No weak subjects. Nice work.</p>
            ) : (
              <ul className="list-disc pl-5">
                {weak.map((w) => (
                  <li key={w.subject}>
                    {w.subject}: {w.marks} in semester {w.semester} (average {w.average}), trend{" "}
                    {w.trend.replace("_", " ")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function AcademicsPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading marks...</p>}>
      <Academics />
    </Suspense>
  );
}
