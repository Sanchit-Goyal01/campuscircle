"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileState } from "./actions";

const field = "border border-zinc-400 px-2 py-1";

export function ProfileForm({
  fullName,
  bio,
  skills,
  isMentor,
}: {
  fullName: string;
  bio: string;
  skills: string[];
  isMentor: boolean;
}) {
  const [state, dispatch, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <label className="flex flex-col text-sm">
        Name
        <input name="full_name" defaultValue={fullName} maxLength={100} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Bio
        <textarea name="bio" rows={3} maxLength={500} defaultValue={bio} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Skills
        <input name="skills" defaultValue={skills.join(", ")} className={field} />
        <span>Separate skills with commas. Up to 20, each up to 40 characters.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_mentor" defaultChecked={isMentor} />
        I can mentor other students
      </label>
      <p className="text-sm">Your name, bio, skills and mentor setting are visible to students in your college.</p>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Saving..." : "Save profile"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm">
          Profile saved.
        </p>
      )}
    </form>
  );
}
