import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { deleteNote } from "../../document-actions";
import { noteStatusLabel } from "../status";

type Note = {
  id: string;
  title: string;
  page_count: number | null;
  status: string;
  uploaded_by: string;
  subjects: { name: string } | null;
  profiles: { full_name: string } | null;
};

async function NoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data, error } = await me.db
    .from("notes")
    .select("id, title, page_count, status, uploaded_by, subjects(name), profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load note: ${error.message}`);
  // RLS hides notes of other colleges, so they look the same as a missing note.
  if (!data) notFound();
  const note = data as unknown as Note;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <p>
        <Link href="/academics/notes" className="text-sm underline">
          Back to notes
        </Link>
      </p>
      <h1 className="font-slab text-3xl font-bold">{note.title}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Subject</dt>
        <dd>{note.subjects?.name ?? "-"}</dd>
        <dt className="font-medium">Uploaded by</dt>
        <dd>{note.profiles?.full_name ?? "Unknown"}</dd>
        <dt className="font-medium">Pages</dt>
        <dd>{note.page_count ?? "-"}</dd>
        <dt className="font-medium">Status</dt>
        <dd>{noteStatusLabel(note.status)}</dd>
      </dl>
      <div className="flex gap-4">
        <a href={`/api/academics/files/notes/${note.id}`} className="underline">
          Download PDF
        </a>
        {note.uploaded_by === me.userId && (
          <form action={deleteNote.bind(null, note.id)}>
            <input type="hidden" name="redirect" value="list" />
            <button type="submit" className="underline">
              Delete this note
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function NotePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading note...</p>}>
      <NoteDetail params={params} />
    </Suspense>
  );
}
