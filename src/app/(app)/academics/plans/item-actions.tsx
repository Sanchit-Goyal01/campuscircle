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
  const [toggleState, toggleAction, togglePending] = useActionState<ItemState>(() => toggle(!done), {});
  const [missState, missAction, missPending] = useActionState<ItemState>(() => miss(), {});
  const error = toggleState.error ?? missState.error;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={toggleAction}>
        <button type="submit" disabled={togglePending} className="underline" aria-label={`${done ? "Mark not done" : "Mark done"}: ${task}`}>
          {done ? "Undo" : "Done"}
        </button>
      </form>
      {canMiss && !done && (
        <form action={missAction}>
          <button type="submit" disabled={missPending} className="underline" aria-label={`Mark missed: ${task}`}>
            Missed
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
