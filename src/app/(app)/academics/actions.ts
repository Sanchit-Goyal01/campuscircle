"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type SaveState = { error?: string; saved?: boolean };

const DUPLICATE = "You already added this subject for this semester.";
const RANGE = "Marks must be between 0 and 100.";
const GENERIC = "Could not save marks. Try again.";

export async function saveResult(formData: FormData): Promise<SaveState> {
  const me = await getProfile();
  if (!me) return { error: GENERIC };

  const subjectId = String(formData.get("subject_id") ?? "");
  const semester = Number(formData.get("semester"));
  const marksRaw = String(formData.get("marks") ?? "").trim();
  const marks = Number(marksRaw);

  if (!subjectId) return { error: "Choose a subject." };
  if (!Number.isInteger(semester) || semester < 1 || semester > 10) {
    return { error: "Semester must be between 1 and 10." };
  }
  if (marksRaw === "" || !Number.isFinite(marks) || marks < 0 || marks > 100) return { error: RANGE };

  // grade_points is set by a database trigger from the college grade scale.
  const { error } = await me.db.from("subject_results").insert({
    student_id: me.userId,
    college_id: me.profile.college_id,
    subject_id: subjectId,
    semester,
    marks,
  });
  if (error) {
    if (error.code === "23505") return { error: DUPLICATE };
    if (error.code === "23514") return { error: RANGE };
    if (error.code === "42501") return { error: "That subject is not available to you." };
    return { error: GENERIC };
  }
  revalidatePath("/academics");
  return { saved: true };
}

export type DeleteState = { error?: string };

const DELETE_FAILED = "Could not delete these marks. Try again.";

export async function deleteResult(id: string, ..._rest: [DeleteState, FormData]): Promise<DeleteState> {
  if (!UUID.test(id)) return { error: DELETE_FAILED };
  const me = await getProfile();
  if (!me) return { error: DELETE_FAILED };
  // RLS limits deletes to the student's own rows.
  const { error } = await me.db.from("subject_results").delete().eq("id", id);
  if (error) return { error: DELETE_FAILED };
  revalidatePath("/academics");
  return {};
}
