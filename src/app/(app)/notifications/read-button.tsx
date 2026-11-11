"use client";

import { useActionState } from "react";
import { markRead } from "../issues/actions";

export function ReadButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(() => markRead(id), {});
  return (
    <form action={formAction} className="flex items-center gap-3">
      <button type="submit" disabled={pending} className="underline">
        Mark as read
      </button>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
