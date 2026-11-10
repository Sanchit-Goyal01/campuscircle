import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const dom = `gr-${run}.edu`;
const otherDom = `gro-${run}.edu`;
type S = { id: string; client: SupabaseClient };
let college: string;
let otherCollege: string;
let student: S;
let admin: S;
let subjectId: string;
let n = 0;

async function newSubject() {
  const { data, error } = await adminClient()
    .from("subjects")
    .insert({ college_id: college, code: `G${run}${n++}`, name: "Subj", credits: 4 })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

beforeAll(async () => {
  college = await createCollege(`Grades College ${run}`, dom);
  otherCollege = await createCollege(`Grades Other ${run}`, otherDom);
  student = await createStudent(`s-${run}@${dom}`);
  admin = await createStudent(`ad-${run}@${dom}`);
  const up = await adminClient().from("profiles").update({ role: "college_admin" }).eq("id", admin.id);
  expect(up.error).toBeNull();
  subjectId = await newSubject();
});

const insertResult = (subject: string, marks: number | null, semester = 1) =>
  student.client
    .from("subject_results")
    .insert({ student_id: student.id, college_id: college, subject_id: subject, semester, marks, grade_points: 1 })
    .select("id, grade_points")
    .single();

describe("grades", () => {
  test("grade points come from the college scale", async () => {
    const { data, error } = await insertResult(subjectId, 85);
    expect(error).toBeNull();
    expect(Number(data!.grade_points)).toBe(9);
  });

  test("changing marks recomputes grade points", async () => {
    const s = await newSubject();
    const { data } = await insertResult(s, 85);
    const up = await student.client
      .from("subject_results")
      .update({ marks: 92 })
      .eq("id", data!.id)
      .select("grade_points")
      .single();
    expect(up.error).toBeNull();
    expect(Number(up.data!.grade_points)).toBe(10);
  });

  test("marks above 100 or below 0 are refused", async () => {
    expect((await insertResult(await newSubject(), 101)).error).not.toBeNull();
    expect((await insertResult(await newSubject(), -1)).error).not.toBeNull();
  });

  test("same subject twice in one semester is refused", async () => {
    const s = await newSubject();
    expect((await insertResult(s, 50)).error).toBeNull();
    expect((await insertResult(s, 60)).error).not.toBeNull();
  });

  test("new college gets the default scale", async () => {
    const { data, error } = await adminClient()
      .from("grade_scales")
      .select("min_marks, grade, grade_points")
      .eq("college_id", otherCollege)
      .order("min_marks", { ascending: false });
    expect(error).toBeNull();
    expect(data!.map((r) => [Number(r.min_marks), r.grade, Number(r.grade_points)])).toEqual([
      [90, "O", 10], [80, "A+", 9], [70, "A", 8], [60, "B+", 7],
      [50, "B", 6], [45, "C", 5], [40, "P", 4], [0, "F", 0],
    ]);
  });

  test("student reads own college scale only", async () => {
    const { data } = await student.client.from("grade_scales").select("college_id");
    expect(data!.length).toBe(8);
    expect(new Set(data!.map((r) => r.college_id))).toEqual(new Set([college]));
    const w = await student.client.from("grade_scales").insert({ college_id: college, min_marks: 5, grade: "Z", grade_points: 1 });
    expect(w.error).not.toBeNull();
  });

  test("student cannot insert a subject; college_admin can, only in own college", async () => {
    const row = (c: string, code: string) => ({ college_id: c, code, name: "New", credits: 3 });
    expect((await student.client.from("subjects").insert(row(college, `S${run}`))).error).not.toBeNull();
    expect((await admin.client.from("subjects").insert(row(college, `A${run}`))).error).toBeNull();
    expect((await admin.client.from("subjects").insert(row(otherCollege, `B${run}`))).error).not.toBeNull();
    const up = await admin.client.from("subjects").update({ name: "Renamed" }).eq("code", `A${run}`).select("name");
    expect(up.data![0].name).toBe("Renamed");
    const stUp = await student.client.from("subjects").update({ name: "Hack" }).eq("code", `A${run}`).select("name");
    expect(stUp.data ?? []).toHaveLength(0);
  });
});
