import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatWhen } from "@/modules/events/queries";
import { getSociety } from "@/modules/societies/queries";
import { AnnouncementForm } from "./announcement-form";
import { DecideButtons } from "./decide-buttons";
import { JoinButtons } from "./join-buttons";

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const s = await getSociety(me.db, me.userId, id);
  if (!s) notFound();
  const isAdmin = s.adminId === me.userId;
  const isStudent = me.profile.role === "student";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-slab text-3xl font-bold">{s.name}</h1>
        <p className="text-sm">
          {s.adminName ? `Admin: ${s.adminName}` : "No admin assigned"} · {s.members} {s.members === 1 ? "member" : "members"}
        </p>
        {s.description && <p className="whitespace-pre-wrap">{s.description}</p>}
      </div>
      {isStudent && <JoinButtons societyId={s.id} status={s.myStatus} />}

      {isAdmin && (
        <>
          <section aria-labelledby="requests" className="flex flex-col gap-3">
            <h2 id="requests" className="text-xl font-semibold">
              Join requests
            </h2>
            {s.pending.length === 0 ? (
              <p className="text-sm">No pending requests.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {s.pending.map((r) => (
                  <li key={r.studentId} className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
                    <div className="font-medium">
                      {r.name} · {formatWhen(r.created_at)}
                    </div>
                    <DecideButtons societyId={s.id} studentId={r.studentId} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="post" className="flex flex-col gap-3">
            <h2 id="post" className="text-xl font-semibold">
              Post an announcement
            </h2>
            <AnnouncementForm societyId={s.id} />
          </section>
        </>
      )}

      <section aria-labelledby="announcements" className="flex flex-col gap-3">
        <h2 id="announcements" className="text-xl font-semibold">
          Announcements
        </h2>
        {s.announcements.length === 0 ? (
          <p className="text-sm">No announcements yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {s.announcements.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
                <div className="font-medium">{a.title}</div>
                <p className="whitespace-pre-wrap">{a.body}</p>
                <div>{formatWhen(a.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>
        <Link href="/societies" className="text-sm underline">
          Back to societies
        </Link>
      </p>
    </div>
  );
}

export default function SocietyPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Detail params={props.params} />
    </Suspense>
  );
}
