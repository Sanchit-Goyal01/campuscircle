"use client";

import { useActionState } from "react";
import type { DeleteState } from "./document-actions";

/** Delete form that shows a failure inline instead of throwing to the error page. */
export function DeleteButton({
  action,
  label,
  text = "Delete",
  redirectToList = false,
}: {
  action: (prev: DeleteState, formData: FormData) => Promise<DeleteState>;
  label: string;
  text?: string;
  redirectToList?: boolean;
}) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, {});
  return (
    <form action={formAction}>
      {redirectToList && <input type="hidden" name="redirect" value="list" />}
      <button type="submit" disabled={pending} className="underline" aria-label={label}>
        {text}
      </button>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
