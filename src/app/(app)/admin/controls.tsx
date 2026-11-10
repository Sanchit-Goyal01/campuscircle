"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  deleteAnnouncement,
  moderatePost,
  publishAnnouncement,
  verifyStudent,
  type AdminState,
} from "./actions";

const field = "border border-zinc-400 px-2 py-1";
const button = "border border-zinc-800 px-3 py-1 text-sm";

function Err({ state }: { state: AdminState }) {
  return state.error ? (
    <p role="alert" className="text-sm">
      {state.error}
    </p>
  ) : null;
}

export function VerifyButton({ profileId }: { profileId: string }) {
  const [state, dispatch, pending] = useActionState<AdminState, FormData>(verifyStudent, {});
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="profile_id" value={profileId} />
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Verifying..." : "Verify"}
      </button>
      <Err state={state} />
    </form>
  );
}

export function AnnouncementForm() {
  const [state, dispatch, pending] = useActionState<AdminState, FormData>(publishAnnouncement, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={dispatch} noValidate className="flex flex-col gap-2">
      <label className="flex flex-col text-sm">
        Title
        <input name="title" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Announcement
        <textarea name="body" rows={4} maxLength={4000} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Publishing..." : "Publish"}
        </button>
      </div>
      <Err state={state} />
    </form>
  );
}

export function DeleteAnnouncementButton({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState<AdminState, FormData>(deleteAnnouncement, {});
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="announcement_id" value={id} />
      <button type="submit" disabled={pending} className={button}>
        Delete
      </button>
      <Err state={state} />
    </form>
  );
}

export function ModerateButtons({ postId }: { postId: string }) {
  const [state, dispatch, pending] = useActionState<AdminState, FormData>(moderatePost, {});
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="post_id" value={postId} />
      <button type="submit" name="action" value="hide" disabled={pending} className={button}>
        Hide
      </button>
      <button type="submit" name="action" value="dismiss" disabled={pending} className={button}>
        Dismiss
      </button>
      <Err state={state} />
    </form>
  );
}
