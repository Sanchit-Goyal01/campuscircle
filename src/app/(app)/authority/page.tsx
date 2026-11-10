import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { relativeDeadline, statusLabel } from "../issues/labels";
import { RunCheck, SlaForm, TriageForm } from "./forms";

const ACTIVE = ["open", "assigned", "in_progress", "resolved_pending"];
const STATUSES = [...ACTIVE, "closed", "closed_unverified"];
const SEVERITIES = ["critical", "high", "medium", "low"];

type Row = {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  report_count: number;
  due_at: string | null;
  escalation_level: number;
  needs_triage: boolean;
  locations: { name: string } | null;
};
type Metrics = {
  median_resolution_hours: number | null;
  deadline_misses: number | null;
  verified_closure_rate: number | null;
  open: number | null;
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

// The request is already dynamic (the session was read), so the clock is safe here.
const currentTime = () => Date.now();

const NO_DATA = "No data yet";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-300 p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const role = me.profile.role;
  if (role !== "authority" && role !== "college_admin") notFound();
  const isAdmin = role === "college_admin";

  const sp = await searchParams;
  const status = one(sp.status);
  const severity = one(sp.severity);
  const location = one(sp.location);
  const statusF = status && STATUSES.includes(status) ? status : "";
  const severityF = severity && SEVERITIES.includes(severity) ? severity : "";
  const locationF = location && UUID.test(location) ? location : "";

  let queueQuery = me.db
    .from("issues")
    .select("id, title, status, severity, report_count, due_at, escalation_level, needs_triage, locations(name)")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  queueQuery = statusF ? queueQuery.eq("status", statusF) : queueQuery.in("status", ACTIVE);
  if (severityF) queueQuery = queueQuery.eq("severity", severityF);
  if (locationF) queueQuery = queueQuery.eq("location_id", locationF);

  const [queueRes, locRes, openRes, metricsRes, deptRes, slaRes, triageRes] = await Promise.all([
    queueQuery,
    me.db.from("locations").select("id, name").order("name"),
    me.db.from("issues").select("location_id").in("status", ACTIVE).limit(5000),
    me.db.rpc("issue_metrics"),
    isAdmin ? me.db.from("departments").select("id, name").order("name") : Promise.resolve({ data: [], error: null }),
    isAdmin ? me.db.from("sla_rules").select("severity, deadline_minutes") : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? me.db
          .from("issues")
          .select("id, title, locations(name)")
          .eq("needs_triage", true)
          .in("status", ["open", "assigned", "in_progress"])
          .order("created_at")
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [queueRes, locRes, openRes, metricsRes, deptRes, slaRes, triageRes]) {
    if (r.error) {
      console.error("Could not load dashboard:", r.error.message);
      throw new Error("Could not load the dashboard.");
    }
  }

  const rows = (queueRes.data ?? []) as unknown as Row[];
  const locations = (locRes.data ?? []) as { id: string; name: string }[];
  const counts = new Map<string, number>();
  for (const o of (openRes.data ?? []) as { location_id: string }[]) {
    counts.set(o.location_id, (counts.get(o.location_id) ?? 0) + 1);
  }
  const maxCount = Math.max(1, ...counts.values());
  const m = (metricsRes.data ?? {}) as Metrics;
  const now = currentTime();
  const departments = (deptRes.data ?? []) as { id: string; name: string }[];
  const sla = Object.fromEntries(
    ((slaRes.data ?? []) as { severity: string; deadline_minutes: number }[]).map((r) => [r.severity, r.deadline_minutes]),
  ) as { critical: number; high: number; medium: number; low: number };
  const triage = (triageRes.data ?? []) as unknown as { id: string; title: string; locations: { name: string } | null }[];

  const field = "border border-zinc-800 px-2 py-1 text-sm";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Authority dashboard</h1>

      <section aria-labelledby="metrics" className="flex flex-col gap-2">
        <h2 id="metrics" className="text-xl font-semibold">
          Metrics
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Median resolution (hours)"
            value={m.median_resolution_hours == null ? NO_DATA : String(m.median_resolution_hours)}
          />
          <Tile label="Deadline misses" value={String(m.deadline_misses ?? 0)} />
          <Tile
            label="Verified closure rate"
            value={m.verified_closure_rate == null ? NO_DATA : `${Math.round(Number(m.verified_closure_rate) * 100)}%`}
          />
          <Tile label="Open issues" value={String(m.open ?? 0)} />
        </div>
      </section>

      <section aria-labelledby="heatmap" className="flex flex-col gap-2">
        <h2 id="heatmap" className="text-xl font-semibold">
          Open issues by location
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {locations.map((l) => {
            const n = counts.get(l.id) ?? 0;
            return (
              <li
                key={l.id}
                className="border border-zinc-400 p-2 text-sm"
                style={{ backgroundColor: `rgba(220, 38, 38, ${(n / maxCount) * 0.45})` }}
              >
                <div className="font-medium">{l.name}</div>
                <div>{n} open</div>
              </li>
            );
          })}
        </ul>
      </section>

      {isAdmin && (
        <section aria-labelledby="needs-triage" className="flex flex-col gap-3">
          <h2 id="needs-triage" className="text-xl font-semibold">
            Needs triage
          </h2>
          {triage.length === 0 ? (
            <p className="text-sm">Nothing waiting for triage.</p>
          ) : (
            triage.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 border border-zinc-300 p-3">
                <p className="text-sm">
                  <Link href={`/authority/${t.id}`} className="underline">
                    {t.title}
                  </Link>{" "}
                  at {t.locations?.name ?? "unknown location"}
                </p>
                <TriageForm issueId={t.id} title={t.title} departments={departments} />
              </div>
            ))
          )}
        </section>
      )}

      {isAdmin && (
        <section aria-labelledby="sla" className="flex flex-col gap-3">
          <h2 id="sla" className="text-xl font-semibold">
            Deadlines
          </h2>
          <SlaForm
            minutes={{
              critical: sla.critical ?? 1440,
              high: sla.high ?? 2880,
              medium: sla.medium ?? 4320,
              low: sla.low ?? 10080,
            }}
          />
          <RunCheck />
        </section>
      )}

      <section aria-labelledby="queue" className="flex flex-col gap-3">
        <h2 id="queue" className="text-xl font-semibold">
          Queue
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select name="status" defaultValue={statusF} className={field}>
              <option value="">Active</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Severity
            <select name="severity" defaultValue={severityF} className={field}>
              <option value="">All</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Location
            <select name="location" defaultValue={locationF} className={field}>
              <option value="">All</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
            Apply filters
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm">No issues match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-400">
                  <th className="p-2">Title</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Severity</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Reports</th>
                  <th className="p-2">Due</th>
                  <th className="p-2">Escalation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = ACTIVE.slice(0, 3).includes(r.status) && !!r.due_at && new Date(r.due_at).getTime() < now;
                  return (
                    <tr key={r.id} className="border-b border-zinc-300">
                      <td className="p-2">
                        <Link href={`/authority/${r.id}`} className="underline">
                          {r.title}
                        </Link>
                      </td>
                      <td className="p-2">{r.locations?.name ?? "-"}</td>
                      <td className="p-2">{r.severity ?? "Not triaged"}</td>
                      <td className="p-2">{r.needs_triage ? "Needs triage" : statusLabel(r.status)}</td>
                      <td className="p-2">{r.report_count}</td>
                      <td className={`p-2 ${overdue ? "font-semibold text-red-700" : ""}`}>
                        {relativeDeadline(r.due_at, now)}
                      </td>
                      <td className="p-2">Level {r.escalation_level}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AuthorityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm">Loading dashboard...</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
