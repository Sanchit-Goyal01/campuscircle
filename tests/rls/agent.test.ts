import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const dom = `ag-${run}.edu`;
let college: string;
let A: { id: string; client: SupabaseClient };
let B: { id: string; client: SupabaseClient };
let runA: string;
let runB: string;
let subjectId: string;
let collegeX: string;
let X: { id: string; client: SupabaseClient };
let subjectX: string;

async function pendingFor(s: typeof A, runId: string) {
  const { data, error } = await s.client
    .from("agent_pending_actions")
    .insert({
      run_id: runId,
      student_id: s.id,
      college_id: college,
      tool_name: "post_thing",
      input: { x: 1 },
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function statusOf(id: string) {
  const { data } = await adminClient()
    .from("agent_pending_actions")
    .select("status")
    .eq("id", id)
    .single();
  return data!.status;
}

beforeAll(async () => {
  college = await createCollege(`Agent College ${run}`, dom);
  A = await createStudent(`a-${run}@${dom}`);
  B = await createStudent(`b-${run}@${dom}`);
  collegeX = await createCollege(`Other College ${run}`, `x-${run}.edu`);
  X = await createStudent(`x-${run}@x-${run}.edu`);
  const admin = adminClient();
  const mk = async (s: typeof A) => {
    const { data, error } = await admin
      .from("agent_runs")
      .insert({ student_id: s.id, college_id: college, message: "hi" })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  runA = await mk(A);
  runB = await mk(B);
  await admin.from("agent_steps").insert([
    { run_id: runA, college_id: college, seq: 1, kind: "tool_call", tool_name: "t", payload: {} },
    { run_id: runB, college_id: college, seq: 1, kind: "tool_call", tool_name: "t", payload: {} },
  ]);
  const { data: subj, error } = await admin
    .from("subjects")
    .insert({ college_id: college, code: `CS${run}`, name: "Algo", credits: 4 })
    .select("id")
    .single();
  expect(error).toBeNull();
  subjectId = subj!.id;
  const sx = await admin
    .from("subjects")
    .insert({ college_id: collegeX, code: `CX${run}`, name: "Other", credits: 3 })
    .select("id")
    .single();
  expect(sx.error).toBeNull();
  subjectX = sx.data!.id;
  for (const s of [A, B]) {
    const r = await admin.from("subject_results").insert({
      student_id: s.id,
      college_id: college,
      subject_id: subjectId,
      semester: 1,
      marks: 80,
      grade_points: 9,
    });
    expect(r.error).toBeNull();
  }
});

describe("agent tables", () => {
  test("student reads own runs, steps and actions only", async () => {
    const actA = await pendingFor(A, runA);
    await pendingFor(B, runB);
    const runs = await A.client.from("agent_runs").select("id, student_id");
    expect(runs.data!.map((r) => r.id)).toEqual([runA]);
    const steps = await A.client.from("agent_steps").select("run_id");
    expect(steps.data!.length).toBe(1);
    expect(steps.data!.every((s) => s.run_id === runA)).toBe(true);
    const acts = await A.client.from("agent_pending_actions").select("id, student_id");
    expect(acts.data!.map((a) => a.id)).toContain(actA);
    expect(acts.data!.every((a) => a.student_id === A.id)).toBe(true);
  });

  test("student cannot insert a pending action with status approved", async () => {
    const { error } = await A.client.from("agent_pending_actions").insert({
      run_id: runA,
      student_id: A.id,
      college_id: college,
      tool_name: "x",
      input: {},
      status: "approved",
    });
    expect(error).not.toBeNull();
  });

  test("student cannot insert a pending action on another student's run", async () => {
    const { error } = await A.client.from("agent_pending_actions").insert({
      run_id: runB,
      student_id: A.id,
      college_id: college,
      tool_name: "x",
      input: {},
    });
    expect(error).not.toBeNull();
  });

  test("student cannot update pending action status directly", async () => {
    const id = await pendingFor(A, runA);
    const { error } = await A.client
      .from("agent_pending_actions")
      .update({ status: "approved" })
      .eq("id", id);
    expect(error).not.toBeNull();
    expect(await statusOf(id)).toBe("pending");
  });

  test("student cannot delete a pending action", async () => {
    const id = await pendingFor(A, runA);
    await A.client.from("agent_pending_actions").delete().eq("id", id);
    expect(await statusOf(id)).toBe("pending");
  });

  test("student can update only status and reply of own run", async () => {
    const ok = await A.client.from("agent_runs").update({ status: "completed", reply: "done" }).eq("id", runA);
    expect(ok.error).toBeNull();
    const bad = await A.client.from("agent_runs").update({ message: "tampered" }).eq("id", runA);
    expect(bad.error).not.toBeNull();
  });

  test("student can insert steps on own run only", async () => {
    const ok = await A.client.from("agent_steps").insert({
      run_id: runA, college_id: college, seq: 2, kind: "tool_result", payload: {},
    });
    expect(ok.error).toBeNull();
    const bad = await A.client.from("agent_steps").insert({
      run_id: runB, college_id: college, seq: 9, kind: "tool_result", payload: {},
    });
    expect(bad.error).not.toBeNull();
  });

  test("approve works once: second call raises invalid_action_state", async () => {
    const id = await pendingFor(A, runA);
    const first = await A.client.rpc("approve_pending_action", { p_id: id });
    expect(first.error).toBeNull();
    const row = Array.isArray(first.data) ? first.data[0] : first.data;
    expect(row.tool_name).toBe("post_thing");
    expect(row.status).toBe("approved");
    const second = await A.client.rpc("approve_pending_action", { p_id: id });
    expect(second.error?.message).toContain("invalid_action_state");
  });

  test("student B cannot approve student A action", async () => {
    const id = await pendingFor(A, runA);
    const r = await B.client.rpc("approve_pending_action", { p_id: id });
    expect(r.error?.message).toContain("invalid_action_state");
    expect(await statusOf(id)).toBe("pending");
  });

  test("rejected action cannot be approved", async () => {
    const id = await pendingFor(A, runA);
    const rej = await A.client.rpc("reject_pending_action", { p_id: id });
    expect(rej.error).toBeNull();
    const r = await A.client.rpc("approve_pending_action", { p_id: id });
    expect(r.error?.message).toContain("invalid_action_state");
    expect(await statusOf(id)).toBe("rejected");
  });

  test("finish only moves approved to done or failed", async () => {
    const id = await pendingFor(A, runA);
    const early = await A.client.rpc("finish_pending_action", { p_id: id, p_status: "done", p_result: null });
    expect(early.error?.message).toContain("invalid_action_state");
    await A.client.rpc("approve_pending_action", { p_id: id });
    const badStatus = await A.client.rpc("finish_pending_action", { p_id: id, p_status: "pending", p_result: null });
    expect(badStatus.error?.message).toContain("invalid_action_state");
    const other = await B.client.rpc("finish_pending_action", { p_id: id, p_status: "done", p_result: null });
    expect(other.error?.message).toContain("invalid_action_state");
    const ok = await A.client.rpc("finish_pending_action", { p_id: id, p_status: "done", p_result: { ok: true } });
    expect(ok.error).toBeNull();
    expect(await statusOf(id)).toBe("done");
    const again = await A.client.rpc("finish_pending_action", { p_id: id, p_status: "failed", p_result: null });
    expect(again.error?.message).toContain("invalid_action_state");
  });
});

describe("academics", () => {
  test("student reads own results only, not a classmate results", async () => {
    const { data, error } = await A.client.from("subject_results").select("student_id");
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].student_id).toBe(A.id);
  });

  test("subjects readable within college but not writable", async () => {
    const r = await A.client.from("subjects").select("id");
    expect(r.data!.map((s) => s.id)).toContain(subjectId);
    const w = await A.client.from("subjects").insert({ college_id: college, code: "ZZ", name: "n", credits: 1 });
    expect(w.error).not.toBeNull();
  });

  test("student cannot write results for a classmate", async () => {
    const w = await A.client.from("subject_results").insert({
      student_id: B.id, college_id: college, subject_id: subjectId, semester: 2, marks: 1, grade_points: 1,
    });
    expect(w.error).not.toBeNull();
  });

  test("study plan items are reachable only through own plan", async () => {
    const plan = await A.client
      .from("study_plans")
      .insert({ student_id: A.id, college_id: college, title: "Plan" })
      .select("id")
      .single();
    expect(plan.error).toBeNull();
    const item = await A.client.from("study_plan_items").insert({
      plan_id: plan.data!.id, college_id: college, due_on: "2026-12-01", task: "read",
    });
    expect(item.error).toBeNull();
    const bad = await B.client.from("study_plan_items").insert({
      plan_id: plan.data!.id, college_id: college, due_on: "2026-12-01", task: "intrude",
    });
    expect(bad.error).not.toBeNull();
    const seen = await B.client.from("study_plan_items").select("id");
    expect(seen.data).toEqual([]);
    const mine = await A.client.from("study_plan_items").select("id");
    expect(mine.data!.length).toBe(1);
  });
});

describe("agent run creation and cross-college isolation", () => {
  test("the exact payload the loop sends creates a run with status running", async () => {
    const { data, error } = await A.client
      .from("agent_runs")
      .insert({ student_id: A.id, college_id: college, message: "hello" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: row } = await adminClient().from("agent_runs").select("status").eq("id", data!.id).single();
    expect(row!.status).toBe("running");
  });

  test("student cannot forge the initial run status", async () => {
    const { error } = await A.client
      .from("agent_runs")
      .insert({ student_id: A.id, college_id: college, message: "m", status: "completed" });
    expect(error).not.toBeNull();
  });

  test("forged college_id on run insert is rejected", async () => {
    const { error } = await A.client
      .from("agent_runs")
      .insert({ student_id: A.id, college_id: collegeX, message: "m" });
    expect(error).not.toBeNull();
  });

  test("student cannot read another college's subjects", async () => {
    const { data } = await A.client.from("subjects").select("id");
    const ids = data!.map((s) => s.id);
    expect(ids).toContain(subjectId);
    expect(ids).not.toContain(subjectX);
  });

  test("subject_results insert with another college's subject is rejected", async () => {
    const { error } = await A.client.from("subject_results").insert({
      student_id: A.id, college_id: college, subject_id: subjectX, semester: 3, marks: 1, grade_points: 1,
    });
    expect(error).not.toBeNull();
  });

  test("pending action with forged student_id is rejected", async () => {
    const { error } = await A.client.from("agent_pending_actions").insert({
      run_id: runA, student_id: B.id, college_id: college, tool_name: "x", input: {},
    });
    expect(error).not.toBeNull();
  });

  test("other-college student cannot see or approve this college's actions", async () => {
    const id = await pendingFor(A, runA);
    const seen = await X.client.from("agent_pending_actions").select("id").eq("id", id);
    expect(seen.data).toEqual([]);
    const r = await X.client.rpc("approve_pending_action", { p_id: id });
    expect(r.error?.message).toContain("invalid_action_state");
  });
});
