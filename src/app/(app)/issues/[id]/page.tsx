import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatWhen, relativeDeadline, statusLabel } from "../labels";
import { VoteButtons } from "./vote-buttons";

type Issue = {
  id: string;
  title: string;
  status: string;
  report_count: number;
  due_at: string | null;
  locations: { name: string } | null;
};
type Event = {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
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

function eventText(e: Event) {
  const base = KIND[e.kind] ?? e.kind;
  return e.kind === "status_changed" && e.to_status ? `${base}: ${statusLabel(e.to_status)}` : base;
}

async function IssueDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [{ data, error }, { data: events }, { data: mine }] = await Promise.all([
    me.db
      .from("issues")
      .select("id, title, status, report_count, due_at, locations(name)")
      .eq("id", id)
      .maybeSingle(),
    me.db
      .from("issue_events")
      .select("id, kind, from_status, to_status, note, created_at")
      .eq("issue_id", id)
      .order("created_at", { ascending: false }),
    me.db.from("issue_reporters").select("issue_id").eq("issue_id", id).eq("student_id", me.userId).maybeSingle(),
  ]);
  if (error) {
    console.error("Could not load issue:", error.message);
    throw new Error("Could not load this issue.");
  }
  // RLS hides other colleges' issues, so they look the same as a missing one.
  if (!data) notFound();
  const issue = data as unknown as Issue;
  const timeline = (events ?? []) as Event[];
  const isReporter = !!mine;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <p>
        <Link href="/issues" className="text-sm underline">
          Back to campus issues
        </Link>
      </p>
      <h1 className="font-slab text-3xl font-bold">{issue.title}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Status</dt>
        <dd>{statusLabel(issue.status)}</dd>
        <dt className="font-medium">Location</dt>
        <dd>{issue.locations?.name ?? "-"}</dd>
        <dt className="font-medium">Reports</dt>
        <dd>{issue.report_count}</dd>
        <dt className="font-medium">Deadline</dt>
        <dd>{relativeDeadline(issue.due_at)}</dd>
      </dl>

      {issue.status === "resolved_pending" && isReporter && (
        <section aria-labelledby="confirm-fix" className="flex flex-col gap-2">
          <h2 id="confirm-fix" className="text-xl font-semibold">
            Is it fixed?
          </h2>
          <VoteButtons issueId={issue.id} />
        </section>
      )}

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="text-xl font-semibold">
          Timeline
        </h2>
        <ol className="flex flex-col gap-2">
          {timeline.map((e) => (
            <li key={e.id} className="border-l-2 border-zinc-400 pl-3 text-sm">
              <div className="font-medium">{eventText(e)}</div>
              {e.note && <div>{e.note}</div>}
              <div>{formatWhen(e.created_at)}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading issue...</p>}>
      <IssueDetail params={params} />
    </Suspense>
  );
}
