import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { DeleteButton } from "../delete-button";
import { deletePaper } from "../document-actions";
import { SubjectFilter } from "../subject-filter";
import { UploadForm } from "../upload-form";

type Paper = {
  id: string;
  year: number;
  exam_type: string;
  uploaded_by: string;
  subjects: { name: string } | null;
  profiles: { full_name: string } | null;
};

async function Papers({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const raw = (await searchParams).subject;
  const subject = typeof raw === "string" && UUID.test(raw) ? raw : "";

  let query = me.db
    .from("past_papers")
    .select("id, year, exam_type, uploaded_by, subjects(name), profiles(full_name)")
    .order("year", { ascending: false });
  if (subject) query = query.eq("subject_id", subject);

  const [{ data: subjects }, { data }] = await Promise.all([
    me.db.from("subjects").select("id, name").order("name"),
    query,
  ]);
  const subjectList = (subjects ?? []) as { id: string; name: string }[];
  const papers = (data ?? []) as unknown as Paper[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Past papers</h1>

      <section aria-labelledby="upload-paper" className="flex flex-col gap-3">
        <h2 id="upload-paper" className="text-xl font-semibold">
          Upload a past paper
        </h2>
        <UploadForm kind="paper" subjects={subjectList} />
      </section>

      <section aria-labelledby="paper-list" className="flex flex-col gap-3">
        <h2 id="paper-list" className="text-xl font-semibold">
          Shared past papers
        </h2>
        <SubjectFilter subjects={subjectList} selected={subject} />
        {papers.length === 0 ? (
          <p>No past papers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Year</th>
                  <th scope="col">Exam type</th>
                  <th scope="col">Uploaded by</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {papers.map((p) => {
                  const label = `${p.subjects?.name ?? "paper"} ${p.year} ${p.exam_type}`;
                  return (
                    <tr key={p.id}>
                      <td>{p.subjects?.name ?? "-"}</td>
                      <td>{p.year}</td>
                      <td>{p.exam_type}</td>
                      <td>{p.profiles?.full_name ?? "Unknown"}</td>
                      <td className="flex gap-3">
                        <a href={`/api/academics/files/papers/${p.id}`} className="underline" aria-label={`Download ${label}`}>
                          Download
                        </a>
                        {p.uploaded_by === me.userId && (
                          <DeleteButton action={deletePaper.bind(null, p.id)} label={`Delete ${label}`} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function PapersPage({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading past papers...</p>}>
      <Papers searchParams={searchParams} />
    </Suspense>
  );
}
