"use client";

import { useActionState } from "react";
import { createSociety, type SocietyState } from "../actions";

const field = "border border-zinc-400 px-2 py-1";

export function NewSocietyForm({ admins }: { admins: { id: string; name: string }[] }) {
  const [state, dispatch, pending] = useActionState<SocietyState, FormData>(createSociety, {});
  return (
    <form action={dispatch} noValidate className="flex flex-col gap-3">
      <label className="flex flex-col text-sm">
        Name
        <input name="name" maxLength={80} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Description
        <textarea name="description" rows={5} maxLength={2000} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Society admin
        <select name="admin_id" defaultValue="" className={field}>
          <option value="" disabled>
            Choose an admin
          </option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Creating..." : "Create society"}
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
