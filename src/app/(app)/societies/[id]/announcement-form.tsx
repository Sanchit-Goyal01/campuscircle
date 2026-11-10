"use client";

import { useActionState, useEffect, useRef } from "react";
import { postAnnouncement, type SocietyState } from "../actions";

const field = "border border-zinc-400 px-2 py-1";

export function AnnouncementForm({ societyId }: { societyId: string }) {
  const [state, dispatch, pending] = useActionState<SocietyState, FormData>(postAnnouncement, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={dispatch} noValidate className="flex flex-col gap-3">
      <input type="hidden" name="society_id" value={societyId} />
      <label className="flex flex-col text-sm">
        Title
        <input name="title" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Announcement
        <textarea name="body" rows={4} maxLength={4000} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Posting..." : "Post announcement"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
