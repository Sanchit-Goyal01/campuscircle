"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { submitReport, type ReportState } from "./actions";

type Location = { id: string; name: string };
const field = "border border-zinc-400 px-2 py-1";
const UPLOAD_FAILED = "Could not upload the photos. Try again.";

export function resultMessage(s: ReportState): string | null {
  if (!s.ok) return null;
  if (s.merged) {
    return s.reporters ? `Added to an existing report. ${s.reporters} students have reported this.` : "Added to an existing report.";
  }
  if (s.needs_triage || !s.department) return "Report received. A college admin will route it.";
  return `Report received. It has been sent to the ${s.department} team.`;
}

export function ReportForm({ locations }: { locations: Location[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState<ReportState, FormData>(submitReport, {});
  // Clear the form only once the server accepted the report; a failure keeps what was typed.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    const data = new FormData(e.currentTarget);
    const files = data.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    data.delete("photos");
    if (files.length > 0) {
      setUploading(true);
      try {
        const upload = new FormData();
        for (const f of files) upload.append("photos", f);
        const res = await fetch("/api/issues/photos", { method: "POST", body: upload });
        const body = (await res.json().catch(() => null)) as { error?: string; paths?: string[] } | null;
        if (!res.ok || !body?.paths) {
          setUploadError(body?.error ?? UPLOAD_FAILED);
          return;
        }
        data.set("photo_paths", body.paths.join(","));
      } catch {
        setUploadError(UPLOAD_FAILED);
        return;
      } finally {
        setUploading(false);
      }
    }
    startTransition(() => dispatch(data));
  }

  const message = resultMessage(state);
  const error = uploadError ?? state.error;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-3">
      <label className="flex flex-col text-sm">
        Location
        <select name="location_id" defaultValue="" className={field}>
          <option value="">Choose a location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        What is the problem?
        <textarea name="body" rows={4} maxLength={2000} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Photos
        <input name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className={field} />
      </label>
      <p className="text-sm">Your name is never shown to staff. Details like your room number can still identify you. A short title of your report is shown to all students on the campus status page, so put names and room numbers in the description only; staff alone read the description.</p>
      <div>
        <button type="submit" disabled={pending || uploading} className="border border-zinc-800 px-3 py-1 text-sm">
          {uploading ? "Uploading photos..." : pending ? "Sending..." : "Send report"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {message && !error && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
