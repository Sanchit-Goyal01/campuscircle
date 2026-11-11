import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen } from "@/modules/events/queries";
import { listAnnouncements, reportedPosts, unverifiedStudents } from "@/modules/admin/queries";
import { AnnouncementForm, DeleteAnnouncementButton, ModerateButtons, VerifyButton } from "./controls";

const box = "flex flex-col gap-3 border border-zinc-300 p-3";

async function Admin({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  if (me.profile.role !== "college_admin") {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="font-slab text-3xl font-bold">College admin</h1>
        <p className="mt-4">This page is for college admins.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 80) ?? "";
  const [students, announcements, reports] = await Promise.all([
    unverifiedStudents(me.db, { query: q }),
    listAnnouncements(me.db),
    reportedPosts(me.db),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">College admin</h1>

      <section aria-labelledby="verify" className={box}>
        <h2 id="verify" className="text-xl font-semibold">
          Students to verify
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            Student name
            <input name="q" defaultValue={q} maxLength={80} className="border border-zinc-400 px-2 py-1" />
          </label>
          <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
            Search students
          </button>
        </form>
        {students.length === 0 ? (
          <p className="text-sm">{q ? "No unverified student matches." : "Every student is verified."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{s.name}</span>
                <VerifyButton profileId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Announcements" className={box}>
        <h2 className="text-xl font-semibold">Announcements</h2>
        <AnnouncementForm />
        {announcements.length === 0 ? (
          <p className="text-sm">No announcements yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {announcements.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 border-t border-zinc-300 pt-2 text-sm">
                <div className="font-medium">{a.title}</div>
                <div>{formatWhen(a.created_at)} IST</div>
                <DeleteAnnouncementButton id={a.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Reported posts" className={box}>
        <h2 className="text-xl font-semibold">Reported posts</h2>
        {reports.length === 0 ? (
          <p className="text-sm">No open reports.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 text-sm">
                <div className="font-medium">{r.author_name}</div>
                <p className="whitespace-pre-wrap">{r.body}</p>
                <div>{r.report_count === 1 ? "1 report" : `${r.report_count} reports`}</div>
                <ul className="list-disc pl-5">
                  {r.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
                <ModerateButtons postId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="societies" className={box}>
        <h2 id="societies" className="text-xl font-semibold">
          Societies
        </h2>
        <p className="text-sm">
          <Link href="/societies/new" className="underline">
            Create a society
          </Link>
        </p>
      </section>
    </div>
  );
}

export default function AdminPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Admin searchParams={props.searchParams} />
    </Suspense>
  );
}
