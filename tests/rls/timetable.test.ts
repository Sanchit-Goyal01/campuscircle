import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const dom = `tt-${run}.edu`;
const otherDom = `tto-${run}.edu`;
type S = { id: string; client: SupabaseClient };
let college: string;
let otherCollege: string;
let student: S;
let other: S;
let otherSubject: string;

beforeAll(async () => {
  college = await createCollege(`Timetable College ${run}`, dom);
  otherCollege = await createCollege(`Timetable Other ${run}`, otherDom);
  student = await createStudent(`s-${run}@${dom}`);
  other = await createStudent(`o-${run}@${dom}`);
  const { data, error } = await adminClient()
    .from("subjects")
    .insert({ college_id: otherCollege, code: `T${run}`, name: "Foreign", credits: 3 })
    .select("id")
    .single();
  expect(error).toBeNull();
  otherSubject = data!.id as string;
});

const insert = (s: S, row: Record<string, unknown>) =>
  s.client
    .from("timetable_entries")
    .insert({ student_id: s.id, college_id: college, start_time: "09:00", ...row })
    .select("id")
    .single();

describe("timetable", () => {
  test("student reads own entries only", async () => {
    expect((await insert(student, { kind: "class", weekday: 1 })).error).toBeNull();
    expect((await insert(other, { kind: "exam", exam_date: "2030-01-01" })).error).toBeNull();
    const { data, error } = await student.client.from("timetable_entries").select("student_id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r) => r.student_id === student.id)).toBe(true);
  });

  test("class row without weekday is refused", async () => {
    expect((await insert(student, { kind: "class" })).error).not.toBeNull();
    expect((await insert(student, { kind: "class", weekday: 1, exam_date: "2030-01-01" })).error).not.toBeNull();
  });

  test("exam row with weekday is refused", async () => {
    expect((await insert(student, { kind: "exam", exam_date: "2030-01-01", weekday: 2 })).error).not.toBeNull();
    expect((await insert(student, { kind: "exam" })).error).not.toBeNull();
  });

  test("subject from another college is refused", async () => {
    const res = await insert(student, { kind: "class", weekday: 3, subject_id: otherSubject });
    expect(res.error).not.toBeNull();
  });

  test("insert for another student or college is refused", async () => {
    const a = await student.client
      .from("timetable_entries")
      .insert({ student_id: other.id, college_id: college, kind: "class", weekday: 1, start_time: "09:00" });
    expect(a.error).not.toBeNull();
    const b = await student.client
      .from("timetable_entries")
      .insert({ student_id: student.id, college_id: otherCollege, kind: "class", weekday: 1, start_time: "09:00" });
    expect(b.error).not.toBeNull();
  });
});
