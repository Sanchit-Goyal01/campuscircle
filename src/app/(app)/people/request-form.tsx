"use client";

import { useActionState } from "react";
import { requestMentorship, type RequestState } from "./actions";

const field = "border border-zinc-400 px-2 py-1";

export function RequestForm({ mentorId }: { mentorId: string }) {
  const [state, dispatch, pending] = useActionState<RequestState, FormData>(requestMentorship, {});
  return (
    <form action={dispatch} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="mentor_id" value={mentorId} />
      <label className="flex flex-col text-sm">
        Subject
        <input name="subject" maxLength={80} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Message
        <textarea name="message" rows={2} maxLength={500} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Sending..." : "Request mentorship"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm">
          Request sent.
        </p>
      )}
    </form>
  );
}
