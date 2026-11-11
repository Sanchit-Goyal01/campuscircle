"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type RequestState = { error?: string; ok?: boolean };

const TOO_MANY = "You have 5 requests waiting for a reply. Wait for an answer before asking someone else.";
const GENERIC = "Could not send your request. Try again.";

export async function requestMentorship(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const mentorId = String(formData.get("mentor_id") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!UUID.test(mentorId)) return { error: GENERIC };
  if (subject.length < 1 || subject.length > 80) return { error: "Enter a subject of 1 to 80 characters." };
  if (message.length < 10 || message.length > 500) return { error: "Write a message of 10 to 500 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("request_mentorship", {
    p_mentor_id: mentorId,
    p_subject: subject,
    p_message: message,
  });
  if (error) {
    if (error.message.includes("declined_recently")) return { error: "This mentor declined recently. Try again later." };
    if (error.message.includes("too_many_pending")) return { error: TOO_MANY };
    if (error.code === "23505") return { error: "You already have a pending request to this mentor." };
    if (error.code === "42501") return { error: "You can't request mentorship from this person." };
    if (error.code === "23514") return { error: "Check the subject and message length." };
    console.error("Mentorship request failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath("/mentorship");
  return { ok: true };
}
