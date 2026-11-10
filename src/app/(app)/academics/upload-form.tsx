"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { EXAM_TYPES } from "@/modules/academics/exam-types";

type Subject = { id: string; name: string };
const field = "border border-zinc-400 px-2 py-1";
const GENERIC = "Could not upload the file. Try again.";

export function UploadForm({ kind, subjects }: { kind: "note" | "paper"; subjects: Subject[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(kind === "note" ? "/api/academics/notes" : "/api/academics/papers", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? GENERIC);
        return;
      }
      formRef.current?.reset();
      router.refresh();
    } catch {
      setError(GENERIC);
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      {kind === "note" && (
        <label className="flex flex-col text-sm">
          Title
          <input name="title" type="text" maxLength={200} className={field} />
        </label>
      )}
      <label className="flex flex-col text-sm">
        Subject
        <select name="subject_id" defaultValue="" className={field}>
          <option value="">{kind === "note" ? "No subject" : "Choose a subject"}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {kind === "paper" && (
        <>
          <label className="flex flex-col text-sm">
            Year
            <input name="year" type="number" min={2000} max={2100} className={`w-24 ${field}`} />
          </label>
          <label className="flex flex-col text-sm">
            Exam type
            <select name="exam_type" defaultValue="midterm" className={field}>
              {EXAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="flex flex-col text-sm">
        PDF file
        <input name="file" type="file" accept="application/pdf" className={field} />
      </label>
      <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
        {pending ? "Uploading..." : kind === "note" ? "Upload note" : "Upload paper"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
