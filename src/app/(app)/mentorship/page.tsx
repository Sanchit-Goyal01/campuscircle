import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen } from "@/modules/events/queries";
import { DecideButtons } from "./decide-buttons";

type Req = {
  id: string;
  student_id: string;
  mentor_id: string;
  subject: string;
  message: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
};
const STATUS = { pending: "Pending", accepted: "Accepted", declined: "Declined" } as const;

async function Mentorship() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  // RLS limits rows to requests where the caller is the student or the mentor.
  const { data, error } = await me.db
    .from("mentorship_requests")
    .select("id, student_id, mentor_id, subject, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Could not load mentorship requests:", error.message);
    throw new Error("Could not load mentorship requests.");
  }
  const reqs = (data ?? []) as Req[];
  const ids = [...new Set(reqs.flatMap((r) => [r.student_id, r.mentor_id]))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await me.db.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name || "A student");
  }
  const incoming = reqs.filter((r) => r.mentor_id === me.userId);
  const outgoing = reqs.filter((r) => r.student_id === me.userId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Mentorship</h1>
      <section aria-labelledby="incoming" className="flex flex-col gap-3">
        <h2 id="incoming" className="text-xl font-semibold">
          Requests to you
        </h2>
        {incoming.length === 0 ? (
          <p>No one has asked you for mentorship yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incoming.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
                <div className="font-medium">
                  {names.get(r.student_id) ?? "A student"} · {r.subject}
                </div>
                <p>{r.message}</p>
                <div>
                  {STATUS[r.status]} · {formatWhen(r.created_at)}
                </div>
                {r.status === "pending" && <DecideButtons requestId={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="outgoing" className="flex flex-col gap-3">
        <h2 id="outgoing" className="text-xl font-semibold">
          Your requests
        </h2>
        {outgoing.length === 0 ? (
          <p>You have not asked anyone for mentorship yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outgoing.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
                <div className="font-medium">
                  {names.get(r.mentor_id) ?? "A mentor"} · {r.subject}
                </div>
                <p>{r.message}</p>
                <div>
                  {STATUS[r.status]} · {formatWhen(r.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function MentorshipPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Mentorship />
    </Suspense>
  );
}
