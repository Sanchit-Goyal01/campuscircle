"use client";

import { useActionState, useEffect, useRef } from "react";
import { addComment, reportPost, type FeedState } from "./actions";

const field = "border border-zinc-400 px-2 py-1";

export function ReportForm({ postId }: { postId: string }) {
  const [state, dispatch, pending] = useActionState<FeedState, FormData>(reportPost, {});
  return (
    <details className="text-sm">
      <summary className="cursor-pointer underline">Report</summary>
      <form action={dispatch} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="post_id" value={postId} />
        <label className="flex flex-col text-sm">
          Reason
          <input name="reason" maxLength={300} className={field} />
        </label>
        <div>
          <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
            {pending ? "Sending..." : "Send report"}
          </button>
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        {state.ok && !state.error && <p role="status">Report sent. A moderator will review it.</p>}
      </form>
    </details>
  );
}

export function CommentForm({ postId }: { postId: string }) {
  const [state, dispatch, pending] = useActionState<FeedState, FormData>(addComment, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="post_id" value={postId} />
      <label className="flex flex-col text-sm">
        Comment
        <textarea name="body" rows={2} maxLength={1000} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Sending..." : "Comment"}
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
