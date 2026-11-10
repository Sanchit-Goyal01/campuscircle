import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { executeToolCall, runApprovedAction } from "../../src/agent/executor";
import type { ToolContext } from "../../src/agent/types";
import { allTools } from "../../src/modules";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let collegeB: string;
let A: S;
let A2: S;
let B: S;

const ctxFor = (s: S, collegeId: string): ToolContext => ({
  db: s.client,
  userId: s.id,
  collegeId,
  role: "student",
});
const tool = (name: string) => allTools.find((t) => t.name === name)!;

async function newRun(s: S, collegeId: string) {
  const { data, error } = await s.client
    .from("agent_runs")
    .insert({ student_id: s.id, college_id: collegeId, message: "hi" })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

const text = "The water cooler on the second floor is not working at all.";

beforeAll(async () => {
  vi.stubEnv("AGENT_TEST_MODEL", "1");
  const admin = adminClient();
  collegeA = await createCollege(`ITools A ${run}`, `ita-${run}.edu`);
  collegeB = await createCollege(`ITools B ${run}`, `itb-${run}.edu`);
  for (const [c, loc] of [
    [collegeA, "Hostel Block A"],
    [collegeA, "Library"],
    [collegeB, "Arts Block"],
  ] as const) {
    const r = await admin.from("locations").insert({ college_id: c, name: loc });
    expect(r.error).toBeNull();
  }
  for (const c of [collegeA, collegeB]) {
    const d = await admin
      .from("departments")
      .insert(["Hostel", "Maintenance"].map((name) => ({ college_id: c, name })));
    expect(d.error).toBeNull();
  }
  A = await createStudent(`a-${run}@ita-${run}.edu`);
  A2 = await createStudent(`a2-${run}@ita-${run}.edu`);
  B = await createStudent(`b-${run}@itb-${run}.edu`);
});
afterAll(() => vi.unstubAllEnvs());

async function file(s: S, college: string, location: string, description: string) {
  const ctx = ctxFor(s, college);
  const out = await executeToolCall({ name: "file_complaint", input: { location, description } }, allTools, ctx, await newRun(s, college));
  if (out.status !== "pending_approval") throw new Error(`expected pending, got ${JSON.stringify(out)}`);
  const done = await runApprovedAction(out.actionId, allTools, ctx);
  if (done.status !== "ok") throw new Error(`approval failed: ${JSON.stringify(done)}`);
  return done.result as { issue_id: string; merged: boolean; needs_triage: boolean };
}

describe("issue agent tools", { timeout: 60_000 }, () => {
  test("file_complaint via approved pending action creates or merges an issue", async () => {
    const ctx = ctxFor(A, collegeA);
    const out = await executeToolCall(
      { name: "file_complaint", input: { location: "hostel block a", description: text } },
      allTools,
      ctx,
      await newRun(A, collegeA),
    );
    expect(out.status).toBe("pending_approval");
    const { count } = await adminClient().from("issues").select("id", { count: "exact", head: true }).eq("college_id", collegeA);
    expect(count).toBe(0);
    if (out.status !== "pending_approval") throw new Error("expected pending");
    const done = await runApprovedAction(out.actionId, allTools, ctx);
    expect(done.status).toBe("ok");
    const first = (done as { result: { issue_id: string; merged: boolean } }).result;
    expect(first.merged).toBe(false);
    const second = await file(A2, collegeA, "Hostel Block A", text);
    expect(second.merged).toBe(true);
    expect(second.issue_id).toBe(first.issue_id);
  });

  test("get_my_complaints returns only the caller's issues", async () => {
    const other = await file(A2, collegeA, "Library", "The library lights keep flickering badly every evening.");
    const ctx = ctxFor(A, collegeA);
    const mine = (await tool("get_my_complaints").run({}, ctx)) as any[];
    expect(mine.length).toBe(1);
    expect(mine.map((m) => m.id)).not.toContain(other.issue_id);
    expect(mine[0]).toMatchObject({ title: "Water cooler not working", location: "Hostel Block A", status: "open", report_count: 2 });
    expect(mine[0].last_event.kind).toBeTruthy();
    expect(Object.keys(mine[0]).sort()).toEqual(["due_at", "id", "last_event", "location", "report_count", "status", "title"]);
    expect((await tool("get_my_complaints").run({}, ctxFor(B, collegeB))) as any[]).toEqual([]);
  });

  test("get_campus_status for college B shows no college A issues", async () => {
    const outB = (await tool("get_campus_status").run({}, ctxFor(B, collegeB))) as any[];
    expect(outB).toEqual([]);
    const outA = (await tool("get_campus_status").run({}, ctxFor(A, collegeA))) as any[];
    expect(outA.map((g) => g.location).sort()).toEqual(["Hostel Block A", "Library"]);
    const filtered = (await tool("get_campus_status").run({ location: "library" }, ctxFor(A, collegeA))) as any[];
    expect(filtered.map((g) => g.location)).toEqual(["Library"]);
    await expect(tool("get_campus_status").run({ location: "Arts Block" }, ctxFor(A, collegeA))).rejects.toThrow(/Unknown location\. Known locations: /);
  });

  test("get_campus_status output contains no student ids", async () => {
    const out = JSON.stringify(await tool("get_campus_status").run({}, ctxFor(A, collegeA)));
    for (const id of [A.id, A2.id, B.id]) expect(out).not.toContain(id);
    expect(out).not.toMatch(/student|actor|reporter/i);
  });

  test("file_complaint refuses an unknown location with the list", async () => {
    await expect(
      tool("file_complaint").run({ location: "Moon Base", description: text }, ctxFor(A, collegeA)),
    ).rejects.toThrow("Unknown location. Known locations: Hostel Block A, Library");
  });
});
