"use client";

import { useActionState } from "react";
import { createEvent, type EventState } from "../actions";

const field = "border border-zinc-400 px-2 py-1";

export function NewEventForm() {
  const [state, dispatch, pending] = useActionState<EventState, FormData>(createEvent, {});
  return (
    <form action={dispatch} noValidate className="flex flex-col gap-3">
      <label className="flex flex-col text-sm">
        Title
        <input name="title" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Venue
        <input name="venue" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Starts
        <input name="starts_at" type="datetime-local" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Ends
        <input name="ends_at" type="datetime-local" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Capacity (leave empty for no limit)
        <input name="capacity" inputMode="numeric" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Description
        <textarea name="description" rows={5} maxLength={4000} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Creating..." : "Create event"}
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
