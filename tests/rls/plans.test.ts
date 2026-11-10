import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const dom = `pl-${run}.edu`;
type S = { id: string; client: SupabaseClient };
let college: string;
let a: S;
let b: S;
const admin = adminClient();
const TODAY = "2030-03-10";

beforeAll(async () => {
  college = await createCollege(`Plans College ${run}`, dom);
  a = await createStudent(`a-${run}@${dom}`);
  b = await createStudent(`b-${run}@${dom}`);
});

/** Seeds a plan with items at the given offsets from TODAY; returns item ids in order. */
async function seedPlan(owner: S, offsets: number[], done: number[] = []) {
  const { data: plan, error } = await admin
    .from("study_plans")
    .insert({ student_id: owner.id, college_id: college, title: "Plan" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const date = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const { data: items, error: itemError } = await admin
    .from("study_plan_items")
    .insert(offsets.map((o, i) => ({ plan_id: plan!.id, college_id: college, due_on: date(o), task: `T${i}`, done: done.includes(i) })))
    .select("id, task");
  expect(itemError).toBeNull();
  const byTask = new Map(items!.map((r) => [r.task as string, r.id as string]));
  return { planId: plan!.id as string, ids: offsets.map((_, i) => byTask.get(`T${i}`)!), date };
}

const dueOf = async (planId: string) =>
  Object.fromEntries(
    ((await admin.from("study_plan_items").select("task, due_on").eq("plan_id", planId)).data ?? []).map((r) => [r.task, r.due_on]),
  );
const miss = (s: S, id: string, today = TODAY) => s.client.rpc("mark_item_missed", { p_item_id: id, p_today: today });

describe("mark_item_missed", () => {
  test("missed item moves to tomorrow and later items shift one day", async () => {
    // T0 due today-1 (missed), T1 due today, T2 tomorrow, T3 in 3 days, T4 done and tomorrow.
    const p = await seedPlan(a, [-1, 0, 1, 3, 1], [4]);
    const { data, error } = await miss(a, p.ids[0]);
    expect(error).toBeNull();
    const due = await dueOf(p.planId);
    expect(due).toMatchObject({ T0: p.date(1), T1: p.date(0), T2: p.date(2), T3: p.date(4), T4: p.date(1) });
    expect((data as { task: string }[]).map((r) => r.task).sort()).toEqual(["T0", "T2", "T3"]);
  });

  test("last item marked missed moves to tomorrow", async () => {
    const p = await seedPlan(a, [-2, -1]);
    const { data, error } = await miss(a, p.ids[1]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await dueOf(p.planId)).toMatchObject({ T0: p.date(-2), T1: p.date(1) });
  });

  test("done item cannot be marked missed", async () => {
    const p = await seedPlan(a, [-1, 2], [0]);
    const { data, error } = await miss(a, p.ids[0]);
    expect(data).toBeNull();
    expect(error?.message).toContain("item_done");
    expect(await dueOf(p.planId)).toMatchObject({ T0: p.date(-1), T1: p.date(2) });
  });

  test("student B cannot mark student A item missed", async () => {
    const p = await seedPlan(a, [-1, 1]);
    const { data, error } = await miss(b, p.ids[0]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await dueOf(p.planId)).toMatchObject({ T0: p.date(-1), T1: p.date(1) });
  });

  test("unknown item returns no rows and anon is refused", async () => {
    const { data, error } = await miss(a, crypto.randomUUID());
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const res = await anonClient().rpc("mark_item_missed", { p_item_id: crypto.randomUUID(), p_today: TODAY });
    expect(res.error?.code).toBe("42501");
  });
});
