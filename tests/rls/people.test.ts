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
let student: S;
let mentor: S;
let plain: S;
let mentorB: S;
let studentB: S;

const ctxFor = (s: S, collegeId: string): ToolContext => ({ db: s.client, userId: s.id, collegeId, role: "student" });
const tool = (name: string) => allTools.find((t) => t.name === name)!;
const MSG = "Could you help me with normalisation and joins?";

beforeAll(async () => {
  vi.stubEnv("AGENT_TEST_MODEL", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseEnv().url);
  collegeA = await createCollege(`People A ${run}`, `pa-${run}.edu`);
  collegeB = await createCollege(`People B ${run}`, `pb-${run}.edu`);
  student = await createStudent(`s-${run}@pa-${run}.edu`);
  mentor = await createStudent(`m-${run}@pa-${run}.edu`);
  plain = await createStudent(`p-${run}@pa-${run}.edu`);
  mentorB = await createStudent(`mb-${run}@pb-${run}.edu`);
  studentB = await createStudent(`sb-${run}@pb-${run}.edu`);
  for (const [s, skills] of [[mentor, ["DBMS", "SQL"]], [mentorB, ["DBMS"]]] as const) {
    const { error } = await s.client.from("profiles").update({ skills, is_mentor: true, bio: "Ask me" }).eq("id", s.id);
    expect(error).toBeNull();
  }
});
afterAll(() => vi.unstubAllEnvs());

describe("people and mentorship", { timeout: 60_000 }, () => {
  test("student updates own skills and is_mentor; cannot update role or another profile", async () => {
    const ok = await student.client.from("profiles").update({ skills: ["Python"], is_mentor: false, bio: "Hi" }).eq("id", student.id).select("skills");
    expect(ok.error).toBeNull();
    expect(ok.data?.[0].skills).toEqual(["Python"]);
    const role = await student.client.from("profiles").update({ role: "college_admin" }).eq("id", student.id);
    expect(role.error?.code).toBe("42501");
    const other = await student.client.from("profiles").update({ skills: ["Hacked"] }).eq("id", mentor.id).select("id");
    expect(other.data ?? []).toEqual([]);
    const { data } = await adminClient().from("profiles").select("skills, role").eq("id", mentor.id).single();
    expect(data?.skills).toEqual(["DBMS", "SQL"]);
    expect(data?.role).toBe("student");
  });

  test("skills over 20 items or 41 characters are refused", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `skill${i}`);
    expect((await student.client.from("profiles").update({ skills: many }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ skills: ["x".repeat(41)] }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ skills: [""] }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ skills: ["   "] }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ skills: ["SQL", "sql"] }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ skills: ["Rust", "Go", "rust"] }).eq("id", student.id)).error?.code).toBe("23514");
    expect((await student.client.from("profiles").update({ bio: "b".repeat(501) }).eq("id", student.id)).error?.code).toBe("23514");
    const ok = await student.client.from("profiles").update({ skills: Array.from({ length: 20 }, (_, i) => String(i).padStart(2, "0").repeat(20)) }).eq("id", student.id);
    expect(ok.error).toBeNull();
    await student.client.from("profiles").update({ skills: [] }).eq("id", student.id);
  });

  test("request_mentorship refuses self, non-mentor and other-college mentor", async () => {
    const call = (s: S, id: string) => s.client.rpc("request_mentorship", { p_mentor_id: id, p_subject: "DBMS", p_message: MSG });
    expect((await call(mentor, mentor.id)).error?.code).toBe("42501");
    expect((await call(student, plain.id)).error?.code).toBe("42501");
    expect((await call(student, mentorB.id)).error?.code).toBe("42501");
    const teacher = await createUserWithRole(`t-${run}@pa-${run}.edu`, "authority");
    expect((await call(teacher, mentor.id)).error?.code).toBe("42501");
    expect((await student.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "DBMS", p_message: "short" })).error?.code).toBe("23514");
    const { count } = await adminClient().from("mentorship_requests").select("id", { count: "exact", head: true }).eq("college_id", collegeA);
    expect(count).toBe(0);
    expect((await student.client.from("mentorship_requests").insert({ college_id: collegeA, student_id: student.id, mentor_id: mentor.id, subject: "x", message: MSG })).error).not.toBeNull();
  });

  let requestId: string;
  test("second pending request to the same mentor is refused", async () => {
    const first = await student.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "DBMS", p_message: MSG });
    expect(first.error).toBeNull();
    requestId = first.data as string;
    const second = await student.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "SQL", p_message: MSG });
    expect(second.error?.code).toBe("23505");
    const { data } = await adminClient().from("notifications").select("link, user_id").eq("user_id", mentor.id).eq("kind", "mentorship_request");
    expect(data).toHaveLength(1);
    expect(data![0].link).toBe("/mentorship");
  });

  test("mentor accepts and the student is notified", async () => {
    expect((await student.client.rpc("decide_mentorship", { p_request_id: requestId, p_accept: true })).error?.code).toBe("42501");
    expect((await plain.client.rpc("decide_mentorship", { p_request_id: requestId, p_accept: true })).error?.code).toBe("42501");
    const ok = await mentor.client.rpc("decide_mentorship", { p_request_id: requestId, p_accept: true });
    expect(ok.error).toBeNull();
    const { data: req } = await student.client.from("mentorship_requests").select("status, decided_at").eq("id", requestId).single();
    expect(req?.status).toBe("accepted");
    expect(req?.decided_at).not.toBeNull();
    const { data } = await adminClient().from("notifications").select("link").eq("user_id", student.id).eq("kind", "mentorship_accepted");
    expect(data).toHaveLength(1);
    expect(data![0].link).toBe("/mentorship");
    // Already decided: a second decision is refused.
    expect((await mentor.client.rpc("decide_mentorship", { p_request_id: requestId, p_accept: false })).error?.code).toBe("42501");
    // The unrelated student cannot read it.
    const { data: seen } = await plain.client.from("mentorship_requests").select("id");
    expect(seen).toEqual([]);
  });

  test("college B cannot see college A mentorship requests or find A mentors", async () => {
    const { data } = await studentB.client.from("mentorship_requests").select("id");
    expect(data).toEqual([]);
    const { findPeople } = await import("../../src/modules/people/queries");
    const people = await findPeople(studentB.client, { skill: "dbms", mentorsOnly: true }, studentB.id);
    expect(people.map((p) => p.id)).toEqual([mentorB.id]);
    const out = (await tool("find_mentor").run({ subject: "DBMS" }, ctxFor(studentB, collegeB))) as any[];
    expect(out.map((m) => m.mentor_id)).toEqual([mentorB.id]);
  });

  test("find_mentor returns DBMS mentors and no email field", async () => {
    const out = (await tool("find_mentor").run({ subject: "dbms" }, ctxFor(student, collegeA))) as any[];
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(["bio", "mentor_id", "name", "skills"]);
    expect(out[0].mentor_id).toBe(mentor.id);
    expect(JSON.stringify(out)).not.toMatch(/@/);
    const mates = (await tool("find_teammates").run({ skills: ["sql", "dbms", "rust"] }, ctxFor(plain, collegeA))) as any[];
    expect(mates[0]).toMatchObject({ skills: ["DBMS", "SQL"], matched: 2 });
    expect(Object.keys(mates[0]).sort()).toEqual(["matched", "name", "skills"]);
    const me = (await tool("get_my_profile").run({}, ctxFor(mentor, collegeA))) as any;
    expect(me).toMatchObject({ is_mentor: true, role: "student", skills: ["DBMS", "SQL"] });
    expect(JSON.stringify(me)).not.toContain(mentor.id);
  });

  test("request_mentorship tool runs only after approval", async () => {
    const S2 = await createStudent(`s2-${run}@pa-${run}.edu`);
    const ctx = ctxFor(S2, collegeA);
    const { data: runRow } = await S2.client.from("agent_runs").insert({ student_id: S2.id, college_id: collegeA, message: "hi" }).select("id").single();
    const out = await executeToolCall({ name: "request_mentorship", input: { mentor_id: mentor.id, subject: "DBMS", message: MSG } }, allTools, ctx, runRow!.id);
    expect(out.status).toBe("pending_approval");
    const before = await adminClient().from("mentorship_requests").select("id", { count: "exact", head: true }).eq("student_id", S2.id);
    expect(before.count).toBe(0);
    if (out.status !== "pending_approval") throw new Error("expected pending");
    const done = await runApprovedAction(out.actionId, allTools, ctx);
    expect(done.status).toBe("ok");
    const after = await adminClient().from("mentorship_requests").select("id", { count: "exact", head: true }).eq("student_id", S2.id);
    expect(after.count).toBe(1);
  });

  test("decline notifies the student, blocks re-request for 7 days; college B cannot decide", async () => {
    const S3 = await createStudent(`s3-${run}@pa-${run}.edu`);
    const r = await S3.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "SQL", p_message: MSG });
    expect(r.error).toBeNull();
    expect((await studentB.client.rpc("decide_mentorship", { p_request_id: r.data, p_accept: true })).error?.code).toBe("42501");
    expect((await mentorB.client.rpc("decide_mentorship", { p_request_id: r.data, p_accept: false })).error?.code).toBe("42501");
    expect((await mentor.client.rpc("decide_mentorship", { p_request_id: r.data, p_accept: false })).error).toBeNull();
    const { data } = await adminClient().from("notifications").select("link").eq("user_id", S3.id).eq("kind", "mentorship_declined");
    expect(data).toHaveLength(1);
    const again = await S3.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "SQL", p_message: MSG });
    expect(again.error?.code).toBe("P0001");
    expect(again.error?.message).toContain("declined_recently");
    await adminClient().from("mentorship_requests").update({ decided_at: new Date(Date.now() - 8 * 86400_000).toISOString() }).eq("id", r.data);
    expect((await S3.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "SQL", p_message: MSG })).error).toBeNull();
  });

  test("a mentor who is not a student is not requestable and not listed", async () => {
    const auth = await createUserWithRole(`au-${run}@pa-${run}.edu`, "authority");
    await adminClient().from("profiles").update({ is_mentor: true, skills: ["DBMS"] }).eq("id", auth.id);
    const r = await student.client.rpc("request_mentorship", { p_mentor_id: auth.id, p_subject: "DBMS", p_message: MSG });
    expect(r.error?.code).toBe("42501");
    const out = (await tool("find_mentor").run({ subject: "DBMS" }, ctxFor(student, collegeA))) as any[];
    expect(out.map((m) => m.mentor_id)).not.toContain(auth.id);
    const { findPeople } = await import("../../src/modules/people/queries");
    expect((await findPeople(student.client, {}, student.id)).map((p) => p.id)).not.toContain(auth.id);
  });

  test("find_teammates applies the limit after matching, even past 50 profiles", async () => {
    const admin = adminClient();
    const college = await createCollege(`People C ${run}`, `pc-${run}.edu`);
    const make = async (name: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email: `${name}-${run}@pc-${run}.edu`, password: "test-password-123!", email_confirm: true, user_metadata: { full_name: name } });
      expect(error).toBeNull();
      return data.user!.id;
    };
    const names = Array.from({ length: 55 }, (_, i) => `a${String(i).padStart(2, "0")}`);
    for (let i = 0; i < names.length; i += 11) await Promise.all(names.slice(i, i + 11).map(make));
    const late = await make("zzlate");
    await admin.from("profiles").update({ skills: ["Rust"] }).eq("id", late);
    const me = await createStudent(`me-${run}@pc-${run}.edu`);
    const out = (await tool("find_teammates").run({ skills: ["rust"] }, ctxFor(me, college))) as any[];
    expect(out.map((o) => o.name)).toEqual(["zzlate"]);
  });

  test("a student cannot update or delete a mentorship request directly", async () => {
    const S4 = await createStudent(`s4-${run}@pa-${run}.edu`);
    const r = await S4.client.rpc("request_mentorship", { p_mentor_id: mentor.id, p_subject: "SQL", p_message: MSG });
    expect(r.error).toBeNull();
    const upd = await S4.client.from("mentorship_requests").update({ status: "accepted" }).eq("id", r.data).select("id");
    expect(upd.error?.code === "42501" || (upd.data ?? []).length === 0).toBe(true);
    const del = await S4.client.from("mentorship_requests").delete().eq("id", r.data).select("id");
    expect(del.error?.code === "42501" || (del.data ?? []).length === 0).toBe(true);
    const { data } = await adminClient().from("mentorship_requests").select("status").eq("id", r.data).single();
    expect(data?.status).toBe("pending");
  });

  test("a sixth pending request is refused with too_many_pending, in the RPC and the tool", async () => {
    const S5 = await createStudent(`s5-${run}@pa-${run}.edu`);
    const mentors: S[] = [];
    for (let i = 0; i < 6; i++) {
      const m = await createStudent(`cap${i}-${run}@pa-${run}.edu`);
      await m.client.from("profiles").update({ is_mentor: true, skills: ["DBMS"] }).eq("id", m.id);
      mentors.push(m);
    }
    const ask = (m: S) => S5.client.rpc("request_mentorship", { p_mentor_id: m.id, p_subject: "DBMS", p_message: MSG });
    for (const m of mentors.slice(0, 5)) expect((await ask(m)).error).toBeNull();
    const sixth = await ask(mentors[5]);
    expect(sixth.error?.code).toBe("P0001");
    expect(sixth.error?.message).toContain("too_many_pending");
    await expect(
      tool("request_mentorship").run({ mentor_id: mentors[5].id, subject: "DBMS", message: MSG }, ctxFor(S5, collegeA)),
    ).rejects.toThrow("5 requests waiting");
    // Deciding one frees a slot.
    const { data: first } = await adminClient().from("mentorship_requests").select("id").eq("student_id", S5.id).eq("mentor_id", mentors[0].id).single();
    expect((await mentors[0].client.rpc("decide_mentorship", { p_request_id: first!.id, p_accept: true })).error).toBeNull();
    expect((await ask(mentors[5])).error).toBeNull();
  });

  test("the approval card names the mentor and the message, with no id", async () => {
    const { describeAction } = await import("../../src/agent/display");
    const d = await describeAction(student.client, {
      tool_name: "request_mentorship",
      input: { mentor_id: mentor.id, subject: "DBMS", message: MSG },
    });
    expect(d).toEqual({ kind: "mentorship", mentor: `m-${run}`, subject: "DBMS", message: MSG });
    expect(JSON.stringify(d)).not.toContain(mentor.id);
    // A mentor in another college, or a made-up id, shows as unknown instead of leaking a name.
    const other = await describeAction(student.client, { tool_name: "request_mentorship", input: { mentor_id: mentorB.id, subject: "DBMS", message: MSG } });
    expect(other).toMatchObject({ kind: "mentorship", mentor: null });
    const junk = await describeAction(student.client, { tool_name: "request_mentorship", input: { mentor_id: "x", subject: "a", message: "b" } });
    expect(junk).toMatchObject({ mentor: null });
    expect(await describeAction(student.client, { tool_name: "get_marks", input: {} })).toBeNull();
  });
});
