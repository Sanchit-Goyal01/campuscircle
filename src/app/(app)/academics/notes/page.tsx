import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { deleteNote } from "../document-actions";
import { SubjectFilter } from "../subject-filter";
import { UploadForm } from "../upload-form";
import { noteStatusLabel } from "./status";

type Note = {
  id: string;
  title: string;
  page_count: number | null;
  status: string;
  uploaded_by: string;
  subjects: { name: string } | null;
  profiles: { full_name: string } | null;
};

async function Notes({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const raw = (await searchParams).subject;
  const subject = typeof raw === "string" && UUID.test(raw) ? raw : "";

  let query = me.db
    .from("notes")
    .select("id, title, page_count, status, uploaded_by, subjects(name), profiles(full_name)")
    .order("created_at", { ascending: false });
  if (subject) query = query.eq("subject_id", subject);

  const [{ data: subjects }, { data }] = await Promise.all([
    me.db.from("subjects").select("id, name").order("name"),
    query,
  ]);
  const subjectList = (subjects ?? []) as { id: string; name: string }[];
  const notes = (data ?? []) as unknown as Note[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Notes</h1>

      <section aria-labelledby="upload-note" className="flex flex-col gap-3">
        <h2 id="upload-note" className="text-xl font-semibold">
          Upload a note
        </h2>
        <UploadForm kind="note" subjects={subjectList} />
      </section>

      <section aria-labelledby="note-list" className="flex flex-col gap-3">
        <h2 id="note-list" className="text-xl font-semibold">
          Shared notes
        </h2>
        <SubjectFilter subjects={subjectList} selected={subject} />
        {notes.length === 0 ? (
          <p>No notes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Uploaded by</th>
                  <th scope="col">Pages</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Link href={`/academics/notes/${n.id}`} className="underline">
                        {n.title}
                      </Link>
                    </td>
                    <td>{n.subjects?.name ?? "-"}</td>
                    <td>{n.profiles?.full_name ?? "Unknown"}</td>
                    <td>{n.page_count ?? "-"}</td>
                    <td>{noteStatusLabel(n.status)}</td>
                    <td className="flex gap-3">
                      <a href={`/api/academics/files/notes/${n.id}`} className="underline" aria-label={`Download ${n.title}`}>
                        Download
                      </a>
                      {n.uploaded_by === me.userId && (
                        <form action={deleteNote.bind(null, n.id)}>
                          <button type="submit" className="underline" aria-label={`Delete ${n.title}`}>
                            Delete
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function NotesPage({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading notes...</p>}>
      <Notes searchParams={searchParams} />
    </Suspense>
  );
}
