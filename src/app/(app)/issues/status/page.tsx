import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { statusLabel } from "../labels";

type Row = {
  id: string;
  title: string;
  category: string | null;
  severity: string | null;
  status: string;
  report_count: number;
  locations: { name: string } | null;
};

async function Status() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const { data, error } = await me.db
    .from("issues")
    .select("id, title, category, severity, status, report_count, locations(name)")
    .in("status", ["open", "assigned", "in_progress", "resolved_pending"])
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Could not load campus status:", error.message);
    throw new Error("Could not load campus status.");
  }
  const groups = new Map<string, Row[]>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const key = r.locations?.name ?? "Unknown location";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const names = [...groups.keys()].sort();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <p>
        <Link href="/issues" className="text-sm underline">
          Back to campus issues
        </Link>
      </p>
      <h1 className="font-slab text-3xl font-bold">Campus status</h1>
      {names.length === 0 && <p>No open issues.</p>}
      {names.map((name, i) => (
        <section key={name} aria-labelledby={`loc-${i}`} className="flex flex-col gap-2">
          <h2 id={`loc-${i}`} className="text-xl font-semibold">
            {name}
          </h2>
          <ul className="flex flex-col gap-2">
            {groups.get(name)!.map((r) => (
              <li key={r.id} className="border border-zinc-300 p-3 text-sm">
                <Link href={`/issues/${r.id}`} className="font-medium underline">
                  {r.title}
                </Link>
                <div className="flex flex-wrap gap-x-3">
                  <span>{r.category ?? "uncategorised"}</span>
                  <span>{r.severity ?? "unrated"}</span>
                  <span>{statusLabel(r.status)}</span>
                  <span>
                    {r.report_count} report{r.report_count === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Status />
    </Suspense>
  );
}
