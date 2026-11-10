"use client";

import { useActionState } from "react";
import { cancelRegistration, registerForEvent, type EventState } from "../actions";

const btn = "border border-zinc-800 px-3 py-1 text-sm";

export function RegisterButton({ eventId, registered }: { eventId: string; registered: boolean }) {
  const [regState, register, regPending] = useActionState<EventState, FormData>(registerForEvent, {});
  const [cancelState, cancel, cancelPending] = useActionState<EventState, FormData>(cancelRegistration, {});
  const error = regState.error ?? cancelState.error;
  const message = regState.message ?? cancelState.message;
  return (
    <div className="flex flex-col gap-2">
      {registered ? (
        <form action={cancel}>
          <input type="hidden" name="event_id" value={eventId} />
          <button type="submit" disabled={cancelPending} className={btn}>
            Cancel registration
          </button>
        </form>
      ) : (
        <form action={register}>
          <input type="hidden" name="event_id" value={eventId} />
          <button type="submit" disabled={regPending} className={btn}>
            Register
          </button>
        </form>
      )}
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
    </div>
  );
}
