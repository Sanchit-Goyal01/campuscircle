"use client";

import { useActionState } from "react";
import type { ItemState } from "./actions";

/** One plan item's buttons; a failure shows inline instead of throwing to the error page. */
export function ItemActions({
  task,
  done,
  canMiss,
  toggle,
  miss,
}: {
  task: string;
  done: boolean;
  canMiss: boolean;
  toggle: (done: boolean) => Promise<ItemState>;
  miss: () => Promise<ItemState>;
}) {
  // One state for both buttons, so the latest result (success clears it) is all that shows.
  const [state, formAction, pending] = useActionState<ItemState, FormData>(
    (_prev, formData) => (formData.get("intent") === "miss" ? miss() : toggle(!done)),
    {},
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        name="intent"
        value="toggle"
        disabled={pending}
        className="underline"
        aria-label={`${done ? "Mark not done" : "Mark done"}: ${task}`}
      >
        {done ? "Undo" : "Done"}
      </button>
      {canMiss && !done && (
        <button type="submit" name="intent" value="miss" disabled={pending} className="underline" aria-label={`Mark missed: ${task}`}>
          Missed
        </button>
      )}
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
