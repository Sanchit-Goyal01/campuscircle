"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { p0001Token } from "@/lib/pg-error";
import { UUID } from "@/modules/academics/http";

export type SocietyState = { error?: string; ok?: boolean };

const GENERIC = "Something went wrong. Try again.";

function refresh(id: string) {
  revalidatePath(`/societies/${id}`);
  revalidatePath("/societies");
}

export async function requestToJoin(societyId: string): Promise<SocietyState> {
  if (!UUID.test(societyId)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("request_to_join", { p_society_id: societyId });
  if (error) {
    const token = p0001Token(error);
    if (token === "already_requested") return { error: "You already asked to join this society." };
    if (token === "declined_recently") {
      return { error: "Your last request was declined less than 7 days ago. Try again later." };
    }
    if (token === "withdrew_recently") {
      return { error: "You withdrew a request to this society recently. Try again tomorrow." };
    }
    if (error.code === "42501") return { error: "Only students of this college can join this society." };
    console.error("Request to join failed:", error.message);
    return { error: GENERIC };
  }
  refresh(societyId);
  return { ok: true };
}

export async function leaveSociety(societyId: string): Promise<SocietyState> {
  if (!UUID.test(societyId)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("leave_society", { p_society_id: societyId });
  if (error) {
    console.error("Leave society failed:", error.message);
    return { error: GENERIC };
  }
  refresh(societyId);
  return { ok: true };
}

export async function decideJoin(societyId: string, studentId: string, accept: boolean): Promise<SocietyState> {
  if (!UUID.test(societyId) || !UUID.test(studentId)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("decide_join", {
    p_society_id: societyId,
    p_student_id: studentId,
    p_accept: accept,
  });
  if (error) {
    if (error.code === "42501") return { error: "This request was already decided or is not yours to decide." };
    console.error("Join decision failed:", error.message);
    return { error: GENERIC };
  }
  refresh(societyId);
  return { ok: true };
}

export async function postAnnouncement(_prev: SocietyState, formData: FormData): Promise<SocietyState> {
  const societyId = String(formData.get("society_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!UUID.test(societyId)) return { error: GENERIC };
  if (title.length < 3 || title.length > 120) return { error: "Enter a title of 3 to 120 characters." };
  if (body.length < 1 || body.length > 4000) return { error: "Enter an announcement of 1 to 4000 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("post_society_announcement", {
    p_society_id: societyId,
    p_title: title,
    p_body: body,
  });
  if (error) {
    if (p0001Token(error) === "too_many_announcements") {
      return { error: "This society has posted 5 announcements in the last 24 hours. Try again later." };
    }
    if (error.code === "42501") return { error: "Only this society's admin can post announcements." };
    if (error.code === "23514") return { error: "Check the title and announcement length." };
    console.error("Post announcement failed:", error.message);
    return { error: GENERIC };
  }
  refresh(societyId);
  return { ok: true };
}

export async function createSociety(_prev: SocietyState, formData: FormData): Promise<SocietyState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const adminId = String(formData.get("admin_id") ?? "");
  if (name.length < 3 || name.length > 80) return { error: "Enter a name of 3 to 80 characters." };
  if (description.length > 2000) return { error: "The description can be at most 2000 characters." };
  if (!UUID.test(adminId)) return { error: "Choose a society admin." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "college_admin") return { error: "Only college admins can create societies." };
  const { data, error } = await me.db
    .from("societies")
    .insert({ name, description, admin_id: adminId })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { error: "A society with this name already exists." };
    if (error?.code === "42501") return { error: "Only college admins can create societies." };
    if (error?.code === "23514") return { error: "Check the name, and choose a society admin from this college." };
    console.error("Create society failed:", error?.message);
    return { error: GENERIC };
  }
  revalidatePath("/societies");
  redirect(`/societies/${data.id}`);
}
