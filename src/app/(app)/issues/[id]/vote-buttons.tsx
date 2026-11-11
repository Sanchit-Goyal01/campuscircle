"use client";

import { useActionState } from "react";
import { voteFix, type VoteState } from "../actions";

export function VoteButtons({ issueId }: { issueId: string }) {
  const [state, formAction, pending] = useActionState<VoteState, FormData>(
    (_prev, formData) => voteFix(issueId, formData.get("fixed") === "yes"),
    {},
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button type="submit" name="fixed" value="yes" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
        Yes, it&apos;s fixed
      </button>
      <button type="submit" name="fixed" value="no" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
        No, still broken
      </button>
      {state.voted && <p role="status" className="text-sm">Your vote was recorded.</p>}
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
