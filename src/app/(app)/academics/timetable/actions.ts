"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";

export type SaveState = { error?: string; saved?: boolean };

const GENERIC = "Could not save this entry. Try again.";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function saveEntry(formData: FormData): Promise<SaveState> {
  const me = await getProfile();
  if (!me) return { error: GENERIC };

  const kind = text(formData, "kind");
  const subjectId = text(formData, "subject_id");
  const start = text(formData, "start_time");
  const end = text(formData, "end_time");
  const location = text(formData, "location");

  if (kind !== "class" && kind !== "exam") return { error: "Choose class or exam." };
  if (!TIME.test(start)) return { error: "Enter a start time." };
  if (end && !TIME.test(end)) return { error: "End time is not valid." };
  if (end && end <= start) return { error: "End time must be after the start time." };

  let weekday: number | null = null;
  let examDate: string | null = null;
  if (kind === "class") {
    weekday = Number(text(formData, "weekday"));
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: "Choose a weekday." };
  } else {
    examDate = text(formData, "exam_date");
    if (!DATE.test(examDate) || Number.isNaN(Date.parse(`${examDate}T00:00:00Z`))) {
      return { error: "Enter the exam date." };
    }
  }

  const { error } = await me.db.from("timetable_entries").insert({
    student_id: me.userId,
    college_id: me.profile.college_id,
    subject_id: subjectId || null,
    kind,
    weekday,
    exam_date: examDate,
    start_time: start,
    end_time: end || null,
    location: location || null,
  });
  if (error) {
    if (error.code === "23514") return { error: "Class entries need a weekday and exam entries need a date." };
    if (error.code === "42501") return { error: "That subject is not available to you." };
    return { error: GENERIC };
  }
  revalidatePath("/academics/timetable");
  return { saved: true };
}

export async function deleteEntry(id: string): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  // RLS limits deletes to the student's own rows.
  const { error } = await me.db.from("timetable_entries").delete().eq("id", id);
  if (error) throw new Error("Could not delete this entry.");
  revalidatePath("/academics/timetable");
}
