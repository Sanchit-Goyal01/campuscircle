import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent, supabaseEnv } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";
import { executeToolCall, runApprovedAction } from "../../src/agent/executor";
import type { ToolContext } from "../../src/agent/types";
import { allTools } from "../../src/modules";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let collegeB: string;
let admin: S;
let society: S;
let student: S;
let other: S;
let studentB: S;
let eventId: string;

const ctxFor = (s: S, collegeId: string): ToolContext => ({ db: s.client, userId: s.id, collegeId, role: "student" });
const tool = (name: string) => allTools.find((t) => t.name === name)!;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const newEvent = (over: Record<string, unknown> = {}) => ({
  title: `Workshop ${run}`,
  description: "Bring a laptop.",
  venue: "Seminar Hall",
  starts_at: inDays(5),
  ends_at: inDays(5.1),
  ...over,
});

beforeAll(async () => {
  vi.stubEnv("AGENT_TEST_MODEL", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseEnv().url);
  collegeA = await createCollege(`Events A ${run}`, `ea-${run}.edu`);
  collegeB = await createCollege(`Events B ${run}`, `eb-${run}.edu`);
  admin = await createUserWithRole(`ad-${run}@ea-${run}.edu`, "college_admin");
  society = await createUserWithRole(`so-${run}@ea-${run}.edu`, "society_admin");
  student = await createStudent(`s-${run}@ea-${run}.edu`);
  other = await createStudent(`o-${run}@ea-${run}.edu`);
  studentB = await createStudent(`sb-${run}@eb-${run}.edu`);
});
afterAll(() => vi.unstubAllEnvs());

describe("events", { timeout: 60_000 }, () => {
  test("student cannot insert an event; college_admin can", async () => {
    const bad = await student.client.from("events").insert(newEvent());
    expect(bad.error?.code).toBe("42501");
    const ins = await admin.client.from("events").insert(newEvent()).select("id, college_id, created_by").single();
    expect(ins.error).toBeNull();
    expect(ins.data).toMatchObject({ college_id: collegeA, created_by: admin.id });
    eventId = ins.data!.id;
    const soc = await society.client.from("events").insert(newEvent({ title: "Society meetup" })).select("id").single();
    expect(soc.error).toBeNull();
    // Checks.
    expect((await admin.client.from("events").insert(newEvent({ ends_at: inDays(4) }))).error?.code).toBe("23514");
    expect((await admin.client.from("events").insert(newEvent({ capacity: 0 }))).error?.code).toBe("23514");
    expect((await admin.client.from("events").insert(newEvent({ venue: "" }))).error?.code).toBe("23514");
    expect((await admin.client.from("events").insert(newEvent({ title: "ab" }))).error?.code).toBe("23514");
    // Students cannot edit or delete.
    const upd = await student.client.from("events").update({ title: "Hacked" }).eq("id", eventId).select("id");
    expect(upd.data ?? []).toEqual([]);
    const del = await student.client.from("events").delete().eq("id", eventId).select("id");
    expect(del.data ?? []).toEqual([]);
    // Everyone in the college can read.
    const seen = await student.client.from("events").select("id").eq("id", eventId);
    expect(seen.data).toHaveLength(1);
  });

  test("register twice returns already_registered", async () => {
    const first = await student.client.rpc("register_for_event", { p_event_id: eventId });
    expect(first.error).toBeNull();
    expect(first.data).toBe("registered");
    const second = await student.client.rpc("register_for_event", { p_event_id: eventId });
    expect(second.data).toBe("already_registered");
    const count = await student.client.rpc("event_registration_count", { p_event_id: eventId });
    expect(count.data).toBe(1);
    // No client insert.
    const direct = await other.client.from("event_registrations").insert({ event_id: eventId, student_id: other.id });
    expect(direct.error).not.toBeNull();
    // Staff cannot register (students only).
    const staff = await admin.client.rpc("register_for_event", { p_event_id: eventId });
    expect(staff.error?.code).toBe("42501");
  });

  test("two concurrent registrations for the last seat: one succeeds, one gets \"This event is full.\"", async () => {
    const ev = await admin.client.from("events").insert(newEvent({ title: "Tiny lab", capacity: 1 })).select("id").single();
    const id = ev.data!.id;
    const [a, b] = await Promise.all([
      student.client.rpc("register_for_event", { p_event_id: id }),
      other.client.rpc("register_for_event", { p_event_id: id }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.data === "registered")).toHaveLength(1);
    const failed = results.filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.message).toBe("This event is full.");
    const count = await student.client.rpc("event_registration_count", { p_event_id: id });
    expect(count.data).toBe(1);
    // Cancelling frees the seat.
    const mine = [student, other].find((s, i) => results[i].data === "registered")!;
    const del = await mine.client.from("event_registrations").delete().eq("event_id", id).select("event_id");
    expect(del.data).toHaveLength(1);
    const retry = await [student, other].find((s) => s !== mine)!.client.rpc("register_for_event", { p_event_id: id });
    expect(retry.data).toBe("registered");
  });

  test("registration for a started event is refused", async () => {
    const past = await adminClient()
      .from("events")
      .insert({ college_id: collegeA, created_by: admin.id, title: "Already begun", venue: "Hall", starts_at: inDays(-1), ends_at: inDays(1) })
      .select("id")
      .single();
    expect(past.error).toBeNull();
    const r = await student.client.rpc("register_for_event", { p_event_id: past.data!.id });
    expect(r.error?.message).toBe("This event has already started.");
  });

  test("student sees only own registrations", async () => {
    await other.client.rpc("register_for_event", { p_event_id: eventId });
    const mine = await student.client.from("event_registrations").select("student_id");
    expect(mine.data!.length).toBeGreaterThan(0);
    expect(mine.data!.every((r) => r.student_id === student.id)).toBe(true);
    const staff = await admin.client.from("event_registrations").select("student_id").eq("event_id", eventId);
    expect(staff.data!.map((r) => r.student_id).sort()).toEqual([student.id, other.id].sort());
    const b = await studentB.client.from("event_registrations").select("student_id");
    expect(b.data).toEqual([]);
    // Cannot delete someone else's registration.
    const del = await other.client.from("event_registrations").delete().eq("event_id", eventId).eq("student_id", student.id).select("event_id");
    expect(del.data ?? []).toEqual([]);
  });

  test("college B cannot see or register for college A events", async () => {
    const list = await studentB.client.from("events").select("id");
    expect(list.data).toEqual([]);
    const r = await studentB.client.rpc("register_for_event", { p_event_id: eventId });
    expect(r.error?.code).toBe("42501");
    const c = await studentB.client.rpc("event_registration_count", { p_event_id: eventId });
    expect(c.error).not.toBeNull();
    const out = (await tool("search_events").run({ query: "" }, ctxFor(studentB, collegeB))) as unknown[];
    expect(out).toEqual([]);
    const outA = (await tool("search_events").run({ query: "Workshop" }, ctxFor(student, collegeA))) as any[];
    expect(outA.length).toBeGreaterThan(0);
    expect(Object.keys(outA[0]).sort()).toEqual(["id", "seats_left", "starts_at", "title", "venue"]);
  });

  test("search_events handles odd queries and date ranges", async () => {
    for (const q of ['"', "a & b", "x:y", "", "' or 1=1 --"]) {
      await expect(tool("search_events").run({ query: q }, ctxFor(student, collegeA))).resolves.toBeInstanceOf(Array);
    }
    const none = (await tool("search_events").run({ from: "2020-01-01", to: "2020-01-31" }, ctxFor(student, collegeA))) as unknown[];
    expect(none).toEqual([]);
  });

  test("register_for_event tool runs only after approval", async () => {
    const S2 = await createStudent(`s2-${run}@ea-${run}.edu`);
    const ctx = ctxFor(S2, collegeA);
    const { data: runRow } = await S2.client.from("agent_runs").insert({ student_id: S2.id, college_id: collegeA, message: "hi" }).select("id").single();
    const out = await executeToolCall({ name: "register_for_event", input: { event_id: eventId } }, allTools, ctx, runRow!.id);
    expect(out.status).toBe("pending_approval");
    const before = await adminClient().from("event_registrations").select("event_id", { count: "exact", head: true }).eq("student_id", S2.id);
    expect(before.count).toBe(0);
    if (out.status !== "pending_approval") throw new Error("expected pending");
    const done = await runApprovedAction(out.actionId, allTools, ctx);
    expect(done.status).toBe("ok");
    const after = await adminClient().from("event_registrations").select("event_id", { count: "exact", head: true }).eq("student_id", S2.id);
    expect(after.count).toBe(1);
  });
});
