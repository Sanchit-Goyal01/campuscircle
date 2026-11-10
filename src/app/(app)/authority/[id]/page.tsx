import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatWhen, relativeDeadline } from "../../issues/labels";
import { TransitionButtons, TriageForm } from "../forms";

type Issue = {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  department_id: string | null;
  needs_triage: boolean;
  report_count: number;
  due_at: string | null;
  escalation_level: number;
  locations: { name: string } | null;
  departments: { name: string } | null;
};
type Report = { id: string; body: string; photo_paths: string[]; created_at: string };
type Event = {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
};

const LABEL: Record<string, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved_pending: "Resolved",
  closed: "Closed",
  closed_unverified: "Closed (not confirmed)",
};
const NEXT: Record<string, string[]> = {
  open: ["assigned", "in_progress"],
  assigned: ["in_progress", "resolved_pending"],
  in_progress: ["resolved_pending"],
};
const KIND: Record<string, string> = {
  reported: "Reported",
  merged: "Another student reported the same problem",
  status_changed: "Status changed",
  triaged: "Routed by a college admin",
  escalated: "Escalated",
  vote_closed: "Closed after student confirmation",
  vote_reopened: "Reopened after student votes",
  closed_unverified: "Closed without confirmation",
};

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me) return null;
  const role = me.profile.role;
  if (role !== "authority" && role !== "college_admin") notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const isAdmin = role === "college_admin";
  const [issueRes, reportsRes, eventsRes, meRes, deptRes] = await Promise.all([
    me.db
      .from("issues")
      .select("id, title, status, severity, department_id, needs_triage, report_count, due_at, escalation_level, locations(name), departments(name)")
      .eq("id", id)
      .maybeSingle(),
    me.db.from("issue_reports").select("id, body, photo_paths, created_at").eq("issue_id", id).order("created_at"),
    me.db
      .from("issue_events")
      .select("id, kind, from_status, to_status, note, created_at")
      .eq("issue_id", id)
      .order("created_at", { ascending: false }),
    me.db.from("profiles").select("department_id").eq("id", me.userId).maybeSingle(),
    isAdmin ? me.db.from("departments").select("id, name").order("name") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [issueRes, reportsRes, eventsRes, meRes, deptRes]) {
    if (r.error) {
      console.error("Could not load issue:", r.error.message);
      throw new Error("Could not load this issue.");
    }
  }
  if (!issueRes.data) notFound();
  const issue = issueRes.data as unknown as Issue;
  const reports = (reportsRes.data ?? []) as Report[];
  const events = (eventsRes.data ?? []) as Event[];

  const photos = await Promise.all(
    reports.map(async (r) =>
      (
        await Promise.all(
          r.photo_paths.map(async (p) => {
            const { data, error } = await me.db.storage.from("issue-photos").createSignedUrl(p, 300);
            if (error) console.error("Could not sign photo URL:", error.message);
            return data?.signedUrl ?? null;
          }),
        )
      ).filter((u): u is string => !!u),
    ),
  );

  const options = (NEXT[issue.status] ?? []).map((to) => ({ to, label: LABEL[to] }));
  // Only an admin or an authority of the issue's department may move it; the RPC enforces the same rule.
  const myDept = (meRes.data as { department_id: string | null } | null)?.department_id ?? null;
  const canAct = isAdmin || (role === "authority" && !!issue.department_id && myDept === issue.department_id);
  const departments = (deptRes.data ?? []) as { id: string; name: string }[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <p>
        <Link href="/authority" className="text-sm underline">
          Back to dashboard
        </Link>
      </p>
      <h1 className="font-slab text-3xl font-bold">{issue.title}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Status</dt>
        <dd>{issue.needs_triage ? "Needs triage" : (LABEL[issue.status] ?? issue.status)}</dd>
        <dt className="font-medium">Location</dt>
        <dd>{issue.locations?.name ?? "-"}</dd>
        <dt className="font-medium">Department</dt>
        <dd>{issue.departments?.name ?? "Not assigned"}</dd>
        <dt className="font-medium">Severity</dt>
        <dd>{issue.severity ?? "Not triaged"}</dd>
        <dt className="font-medium">Reports</dt>
        <dd>{issue.report_count}</dd>
        <dt className="font-medium">Deadline</dt>
        <dd>{relativeDeadline(issue.due_at)}</dd>
        <dt className="font-medium">Escalation</dt>
        <dd>Level {issue.escalation_level}</dd>
      </dl>

      <section aria-labelledby="actions" className="flex flex-col gap-2">
        <h2 id="actions" className="text-xl font-semibold">
          Actions
        </h2>
        {issue.needs_triage ? (
          isAdmin ? (
            <TriageForm issueId={issue.id} title={issue.title} departments={departments} />
          ) : (
            <p className="text-sm">Waiting for triage</p>
          )
        ) : !canAct ? (
          <p className="text-sm">Only this issue&apos;s department or a college admin can change it.</p>
        ) : options.length === 0 ? (
          <p className="text-sm">No further actions for this status.</p>
        ) : (
          <TransitionButtons issueId={issue.id} options={options} />
        )}
      </section>

      <section aria-labelledby="reports" className="flex flex-col gap-3">
        <h2 id="reports" className="text-xl font-semibold">
          Reports
        </h2>
        {reports.map((r, i) => (
          <article key={r.id} className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
            <p>{r.body}</p>
            {photos[i].length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos[i].map((u, j) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={j} src={u} alt={`Report photo ${j + 1}`} className="max-h-48 max-w-full" />
                ))}
              </div>
            )}
            <p>{formatWhen(r.created_at)}</p>
          </article>
        ))}
      </section>

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="text-xl font-semibold">
          Timeline
        </h2>
        <ol className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-zinc-400 pl-3 text-sm">
              <div className="font-medium">
                {KIND[e.kind] ?? e.kind}
                {e.kind === "status_changed" && e.to_status ? `: ${LABEL[e.to_status] ?? e.to_status}` : ""}
              </div>
              {e.note && <div>{e.note}</div>}
              <div>{formatWhen(e.created_at)}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function AuthorityIssuePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading issue...</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
