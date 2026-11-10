import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ToolContext } from "../../src/agent/types";

const session = vi.hoisted(() => ({ ctx: null as ToolContext | null }));
vi.mock("@/lib/supabase/server", () => ({ getToolContext: async () => session.ctx }));

import { POST } from "../../src/app/api/issues/insights/run/route";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";

const run = Math.random().toString(36).slice(2, 8);
const dom = `rc-${run}.edu`;
const otherDom = `ro-${run}.edu`;

type U = Awaited<ReturnType<typeof createStudent>>;
let college: string;
let locA: string;
let locB: string;
let authority: U;
let otherAdmin: U;
let evidence: string;
let foreignIssue: string;
let student: U;
let n = 0;

async function seed(loc: string, category: string, count: number, opts: { ageDays?: number; status?: string } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const { data, error } = await adminClient()
      .from("issues")
      .insert({
        college_id: college,
        location_id: loc,
        category,
        severity: "high",
        title: `Seeded ${category} ${n++}`,
        status: opts.status ?? "open",
        created_at: new Date(Date.now() - (opts.ageDays ?? 1) * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    ids.push(data!.id);
  }
  return ids;
}

beforeAll(async () => {
  college = await createCollege(`RC ${run}`, dom);
  const other = await createCollege(`RO ${run}`, otherDom);
  const admin = adminClient();
  const mk = async (name: string) => {
    const { data, error } = await admin.from("locations").insert({ college_id: college, name }).select("id").single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  locA = await mk("Hostel Block A");
  locB = await mk("Library");
  authority = await createUserWithRole(`au-${run}@${dom}`, "authority");
  otherAdmin = await createUserWithRole(`oa-${run}@${otherDom}`, "college_admin");
  student = await createStudent(`st-${run}@${dom}`);
  [evidence] = await seed(locB, "other", 1);
  const { data: fl } = await admin.from("locations").insert({ college_id: other, name: "Far" }).select("id").single();
  const { data: fi } = await admin
    .from("issues")
    .insert({ college_id: other, location_id: fl!.id, category: "other", title: "Foreign", severity: "low" })
    .select("id")
    .single();
  foreignIssue = fi!.id;
});

describe("root_cause_groups", () => {
  test("three water issues at Hostel Block A form one group; two do not", async () => {
    const water = await seed(locA, "water", 3);
    await seed(locB, "water", 2);
    const { data, error } = await authority.client.rpc("root_cause_groups");
    expect(error).toBeNull();
    const mine = data.filter((g: { location_id: string; category: string }) => g.location_id === locA && g.category === "water");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ location: "Hostel Block A" });
    expect([...mine[0].issue_ids].sort()).toEqual([...water].sort());
    expect(mine[0].titles).toHaveLength(3);
    expect(data.some((g: { location_id: string; category: string }) => g.location_id === locB && g.category === "water")).toBe(false);
  });

  test("group with a recent accepted insight is excluded", async () => {
    await seed(locB, "electricity", 3);
    const before = await authority.client.rpc("root_cause_groups");
    expect(before.data.some((g: { category: string }) => g.category === "electricity")).toBe(true);
    const { error } = await adminClient().from("root_cause_insights").insert({
      college_id: college,
      location_id: locB,
      category: "electricity",
      hypothesis: "Overloaded circuit in the east wing.",
      confidence: "low",
      evidence_issue_ids: [],
      status: "accepted",
    });
    expect(error).toBeNull();
    const after = await authority.client.rpc("root_cause_groups");
    expect(after.data.some((g: { category: string }) => g.category === "electricity")).toBe(false);
  });

  test("old issues do not count, closed ones do", async () => {
    await seed(locB, "safety", 3, { ageDays: 90 });
    await seed(locB, "sanitation", 3, { status: "closed" });
    const { data } = await authority.client.rpc("root_cause_groups");
    expect(data.some((g: { category: string }) => g.category === "safety")).toBe(false);
    expect(data.some((g: { category: string }) => g.category === "sanitation")).toBe(true);
  });

  test("students are refused and other colleges see nothing", async () => {
    const s = await student.client.rpc("root_cause_groups");
    expect(s.error?.code).toBe("42501");
    const o = await otherAdmin.client.rpc("root_cause_groups");
    expect(o.error).toBeNull();
    expect(o.data).toEqual([]);
  });
});

describe("root_cause_insights", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    location_id: locA,
    category: "water",
    hypothesis: "Shared plumbing is failing on this floor.",
    confidence: "medium",
    evidence_issue_ids: [evidence],
    ...extra,
  });

  test("student cannot read or insert insights", async () => {
    await adminClient().from("root_cause_insights").insert({ ...row({ category: "furniture", location_id: locB }), college_id: college });
    const read = await student.client.from("root_cause_insights").select("id");
    expect(read.data ?? []).toEqual([]);
    const ins = await student.client.from("root_cause_insights").insert({ ...row() });
    expect(ins.error).not.toBeNull();
  });

  test("authority inserts proposed only; other college cannot read", async () => {
    const ok = await authority.client.from("root_cause_insights").insert({ ...row({ category: "safety" }) });
    expect(ok.error).toBeNull();
    const accepted = await authority.client
      .from("root_cause_insights")
      .insert({ ...row(), status: "accepted" });
    expect(accepted.error).not.toBeNull();
    const forged = await authority.client
      .from("root_cause_insights")
      .insert({ ...row(), decided_by: authority.id });
    expect(forged.error).not.toBeNull();
    const read = await otherAdmin.client.from("root_cause_insights").select("id");
    expect(read.data ?? []).toEqual([]);
  });

  test("evidence must be non-empty and from the caller's college", async () => {
    const foreign = await authority.client
      .from("root_cause_insights")
      .insert({ ...row({ category: "sanitation", evidence_issue_ids: [evidence, foreignIssue] }) });
    expect(foreign.error).not.toBeNull();
    const empty = await authority.client
      .from("root_cause_insights")
      .insert({ ...row({ category: "sanitation", evidence_issue_ids: [] }) });
    expect(empty.error).not.toBeNull();
  });

  test("client-supplied college_id is refused", async () => {
    const r = await authority.client
      .from("root_cause_insights")
      .insert({ ...row({ category: "sanitation" }), college_id: college });
    expect(r.error).not.toBeNull();
  });

  test("a second proposed insight for the same place and category is refused", async () => {
    const a = await authority.client.from("root_cause_insights").insert({ ...row({ category: "electricity" }) });
    expect(a.error).toBeNull();
    const b = await authority.client.from("root_cause_insights").insert({ ...row({ category: "electricity" }) });
    expect(b.error?.code).toBe("23505");
  });

  test("another college's authority cannot update or insert", async () => {
    const { data: ins } = await authority.client
      .from("root_cause_insights")
      .insert({ ...row({ category: "other" }) })
      .select("id")
      .single();
    const upd = await otherAdmin.client
      .from("root_cause_insights")
      .update({ status: "dismissed", decided_by: otherAdmin.id })
      .eq("id", ins!.id)
      .select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const { data: still } = await adminClient().from("root_cause_insights").select("status").eq("id", ins!.id).single();
    expect(still!.status).toBe("proposed");
    const other = await otherAdmin.client.from("root_cause_insights").insert({ ...row({ category: "other" }) });
    expect(other.error).not.toBeNull();
  });

  test("authority accepts an insight and decided_by is set", async () => {
    const { data: ins } = await authority.client
      .from("root_cause_insights")
      .insert({ ...row({ category: "internet" }) })
      .select("id")
      .single();
    const upd = await authority.client
      .from("root_cause_insights")
      .update({ status: "accepted", decided_by: authority.id })
      .eq("id", ins!.id)
      .select("status, decided_by")
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual({ status: "accepted", decided_by: authority.id });
    const spoof = await authority.client
      .from("root_cause_insights")
      .update({ status: "dismissed", decided_by: student.id })
      .eq("id", ins!.id)
      .select("id");
    expect(spoof.error !== null || (spoof.data ?? []).length === 0).toBe(true);
    const hyp = await authority.client
      .from("root_cause_insights")
      .update({ hypothesis: "changed" })
      .eq("id", ins!.id);
    expect(hyp.error).not.toBeNull();
  });
});

describe("POST /api/issues/insights/run", () => {
  test("student gets 403 and signed-out gets 401", async () => {
    session.ctx = { db: student.client, userId: student.id, collegeId: college, role: "student" };
    const res = await POST();
    expect(res.status).toBe(403);
    session.ctx = null;
    expect((await POST()).status).toBe(401);
  });

  test("authority creates insights from the groups with the scripted model", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "1");
    await seed(locA, "furniture", 3);
    session.ctx = { db: authority.client, userId: authority.id, collegeId: college, role: "authority" };
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBeGreaterThanOrEqual(1);
    const { data } = await authority.client
      .from("root_cause_insights")
      .select("status, category")
      .eq("category", "furniture")
      .eq("location_id", locA);
    expect(data).toEqual([{ status: "proposed", category: "furniture" }]);
    vi.unstubAllEnvs();
  });
});
