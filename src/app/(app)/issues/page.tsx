import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen, statusLabel } from "./labels";
import { ReportForm } from "./report-form";

type Mine = {
  issue_id: string;
  issues: { id: string; title: string; status: string; updated_at: string; locations: { name: string } | null } | null;
};

async function Issues() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const [{ data: locs }, { data: mine }] = await Promise.all([
    me.db.from("locations").select("id, name").order("name"),
    me.db
      .from("issue_reporters")
      .select("issue_id, issues(id, title, status, updated_at, locations(name))")
      .eq("student_id", me.userId),
  ]);
  const locations = (locs ?? []) as { id: string; name: string }[];
  const reports = ((mine ?? []) as unknown as Mine[])
    .filter((m) => m.issues)
    .sort((a, b) => b.issues!.updated_at.localeCompare(a.issues!.updated_at));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Campus issues</h1>
      <p>
        <Link href="/issues/status" className="text-sm underline">
          See open issues on campus
        </Link>
      </p>

      <section aria-labelledby="report-issue" className="flex flex-col gap-3">
        <h2 id="report-issue" className="text-xl font-semibold">
          Report a problem
        </h2>
        <ReportForm locations={locations} />
      </section>

      <section aria-labelledby="my-reports" className="flex flex-col gap-3">
        <h2 id="my-reports" className="text-xl font-semibold">
          My reports
        </h2>
        {reports.length === 0 ? (
          <p>You have not reported anything yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((r) => (
              <li key={r.issue_id} className="border border-zinc-300 p-3 text-sm">
                <Link href={`/issues/${r.issues!.id}`} className="font-medium underline">
                  {r.issues!.title}
                </Link>
                <div>
                  {statusLabel(r.issues!.status)} · {r.issues!.locations?.name ?? "Unknown location"} · Updated{" "}
                  {formatWhen(r.issues!.updated_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function IssuesPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Issues />
    </Suspense>
  );
}
