import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { findPeople } from "@/modules/people/queries";
import { MessageButton } from "../messages/message-button";
import { RequestForm } from "./request-form";

const field = "border border-zinc-400 px-2 py-1";

async function People({ searchParams }: { searchParams: Promise<{ skill?: string | string[]; mentors?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const sp = await searchParams;
  const skill = (Array.isArray(sp.skill) ? sp.skill[0] : sp.skill)?.trim().slice(0, 40) ?? "";
  const mentorsOnly = (Array.isArray(sp.mentors) ? sp.mentors[0] : sp.mentors) === "1";
  const people = await findPeople(me.db, { skill: skill || undefined, mentorsOnly, limit: 30 }, me.userId);
  const { data: pend } = await me.db
    .from("mentorship_requests")
    .select("mentor_id")
    .eq("student_id", me.userId)
    .eq("status", "pending");
  const pending = new Set(((pend ?? []) as { mentor_id: string }[]).map((r) => r.mentor_id));
  const canRequest = me.profile.role === "student";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">People</h1>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          Skill
          <input name="skill" defaultValue={skill} maxLength={40} className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mentors" value="1" defaultChecked={mentorsOnly} />
          Mentors only
        </label>
        <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
          Search
        </button>
      </form>
      {people.length === 0 ? (
        <p>No one matches. Try another skill.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map((p) => (
            <li key={p.id} className="border border-zinc-300 p-3 text-sm">
              <div className="font-medium">
                {p.name || "Unnamed student"}
                {p.is_mentor ? " · Mentor" : ""}
              </div>
              {p.bio && <p>{p.bio}</p>}
              <p>{p.skills.length > 0 ? `Skills: ${p.skills.join(", ")}` : "No skills listed."}</p>
              {p.id !== me.userId && (
                <div className="mt-2">
                  <MessageButton personId={p.id} />
                </div>
              )}
              {canRequest && p.is_mentor && (pending.has(p.id) ? <p className="mt-2">Request pending</p> : <RequestForm mentorId={p.id} />)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PeoplePage(props: { searchParams: Promise<{ skill?: string | string[]; mentors?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <People searchParams={props.searchParams} />
    </Suspense>
  );
}
