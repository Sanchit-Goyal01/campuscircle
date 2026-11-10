import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { todayIn } from "../../src/lib/today";

const run = Math.random().toString(36).slice(2, 8);
const dom = `sh-${run}.edu`;
const otherDom = `sho-${run}.edu`;
const TZ = "Asia/Kolkata"; // +05:30, no daylight saving
type S = { id: string; client: SupabaseClient };
let college: string;
let otherCollege: string;
let note: string;
let otherNote: string;
let a: S;
let b: S;
let outsider: S;

const admin = adminClient();
const claim = (s: S, noteId: string, limit: number, tz = TZ, mode = "ask") =>
  s.client.rpc("claim_study_help", { p_note_id: noteId, p_mode: mode, p_tz: tz, p_limit: limit });
const rowsOf = async (studentId: string) =>
  (await admin.from("study_help_requests").select("id, created_at").eq("student_id", studentId)).data ?? [];

async function makeNote(owner: string, collegeId: string) {
  const { data, error } = await admin
    .from("notes")
    .insert({ college_id: collegeId, uploaded_by: owner, title: "N", file_path: `${collegeId}/notes/${crypto.randomUUID()}.pdf`, status: "ready" })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

beforeAll(async () => {
  college = await createCollege(`SH College ${run}`, dom);
  otherCollege = await createCollege(`SH Other ${run}`, otherDom);
  a = await createStudent(`a-${run}@${dom}`);
  b = await createStudent(`b-${run}@${dom}`);
  outsider = await createStudent(`o-${run}@${otherDom}`);
  note = await makeNote(a.id, college);
  otherNote = await makeNote(outsider.id, otherCollege);
});

describe("study_help_requests and claim_study_help", () => {
  test("claims succeed up to the limit, then are refused, and only allowed ones are recorded", async () => {
    const results: unknown[] = [];
    for (let i = 0; i < 4; i++) results.push((await claim(a, note, 3)).data);
    expect(results).toEqual([true, true, true, false]);
    const rows = await rowsOf(a.id);
    expect(rows).toHaveLength(3);
    const { data } = await admin.from("study_help_requests").select("*").eq("student_id", a.id).limit(1).single();
    expect(data).toMatchObject({ college_id: college, note_id: note, mode: "ask" });
  });

  test("parallel claims cannot exceed the limit", async () => {
    const out = await Promise.all(Array.from({ length: 12 }, () => claim(b, note, 5, TZ, "quiz")));
    expect(out.every((r) => r.error === null)).toBe(true);
    expect(out.filter((r) => r.data === true)).toHaveLength(5);
    expect(await rowsOf(b.id)).toHaveLength(5);
  });

  test("the limit is per student: another student is unaffected by a full quota", async () => {
    expect((await claim(outsider, otherNote, 3)).data).toBe(true);
    expect(await rowsOf(outsider.id)).toHaveLength(1);
  });

  test("the day follows the given timezone and ignores older days", async () => {
    const c = await createStudent(`c-${run}@${dom}`);
    const localDay = todayIn(TZ, new Date());
    const midnight = Date.parse(`${localDay}T00:00:00+05:30`);
    const base = { student_id: c.id, college_id: college, note_id: note, mode: "ask" };
    const { error } = await admin.from("study_help_requests").insert([
      { ...base, created_at: new Date(midnight - 60_000).toISOString() }, // yesterday, local
      { ...base, created_at: new Date(midnight - 3 * 86_400_000).toISOString() },
    ]);
    expect(error).toBeNull();
    // Yesterday's rows do not count against today's limit of 1...
    expect((await claim(c, note, 1)).data).toBe(true);
    // ...and today's own row does.
    expect((await claim(c, note, 1)).data).toBe(false);
    expect(await rowsOf(c.id)).toHaveLength(3);
  });

  test("a note of another college cannot be claimed", async () => {
    const before = await rowsOf(a.id);
    const { data, error } = await claim(a, otherNote, 100);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await rowsOf(a.id)).toHaveLength(before.length);
  });

  test("a student sees only their own rows", async () => {
    expect((await rowsOf(a.id)).length).toBeGreaterThan(0); // exists, proven through admin
    const { data, error } = await b.client.from("study_help_requests").select("id").eq("student_id", a.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: own } = await a.client.from("study_help_requests").select("id");
    expect(own!.length).toBe((await rowsOf(a.id)).length);
  });

  test("direct insert for another student is refused and update and delete are not granted", async () => {
    const forged = await b.client
      .from("study_help_requests")
      .insert({ student_id: a.id, college_id: college, note_id: note, mode: "ask" });
    expect(forged.error?.code).toBe("42501");
    const crossCollege = await a.client
      .from("study_help_requests")
      .insert({ student_id: a.id, college_id: college, note_id: otherNote, mode: "ask" });
    expect(crossCollege.error?.code).toBe("42501");
    const id = (await rowsOf(a.id))[0].id;
    expect((await a.client.from("study_help_requests").update({ mode: "quiz" }).eq("id", id)).error?.code).toBe("42501");
    expect((await a.client.from("study_help_requests").delete().eq("id", id)).error?.code).toBe("42501");
    expect((await rowsOf(a.id)).some((r) => r.id === id)).toBe(true);
  });

  test("anon cannot claim", async () => {
    const { anonClient } = await import("../helpers/supabase");
    const { error } = await anonClient().rpc("claim_study_help", { p_note_id: note, p_mode: "ask", p_tz: TZ, p_limit: 5 });
    expect(error?.code).toBe("42501");
  });

  test("deleting the note keeps the request row, so quota is not refunded", async () => {
    const d = await createStudent(`d-${run}@${dom}`);
    const tmp = await makeNote(d.id, college);
    expect((await claim(d, tmp, 1)).data).toBe(true);
    await admin.from("notes").delete().eq("id", tmp);
    const rows = await admin.from("study_help_requests").select("note_id").eq("student_id", d.id);
    expect(rows.data).toEqual([{ note_id: null }]);
    expect((await claim(d, note, 1)).data).toBe(false);
  });
});
