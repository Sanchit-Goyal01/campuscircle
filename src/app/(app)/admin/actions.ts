"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type AdminState = { error?: string; ok?: boolean };

const GENERIC = "Something went wrong. Try again.";
const NOT_ADMIN = "Only college admins can do this.";

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/announcements");
  revalidatePath("/");
}

export async function verifyStudent(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const id = String(formData.get("profile_id") ?? "");
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("set_student_verified", { p_profile_id: id, p_verified: true });
  if (error) {
    if (error.code === "42501") return { error: "This student could not be verified. Reload the page." };
    console.error("Verify student failed:", error.message);
    return { error: GENERIC };
  }
  refresh();
  revalidatePath("/people");
  return { ok: true };
}

export async function publishAnnouncement(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (title.length < 3 || title.length > 120) return { error: "Enter a title of 3 to 120 characters." };
  if (body.length < 1 || body.length > 4000) return { error: "Enter an announcement of 1 to 4000 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "college_admin") return { error: NOT_ADMIN };
  const { error } = await me.db
    .from("college_announcements")
    .insert({ college_id: me.profile.college_id, author_id: me.userId, title, body });
  if (error) {
    if (error.code === "42501") return { error: NOT_ADMIN };
    if (error.code === "23514") return { error: "Check the title and announcement length." };
    console.error("Publish announcement failed:", error.message);
    return { error: GENERIC };
  }
  refresh();
  return { ok: true };
}

export async function deleteAnnouncement(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const id = String(formData.get("announcement_id") ?? "");
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { data, error } = await me.db.from("college_announcements").delete().eq("id", id).select("id");
  if (error) {
    console.error("Delete announcement failed:", error.message);
    return { error: error.code === "42501" ? NOT_ADMIN : GENERIC };
  }
  if (!data || data.length === 0) {
    refresh();
    return { error: "This announcement was already removed or is not yours to remove." };
  }
  refresh();
  return { ok: true };
}

export async function moderatePost(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const id = String(formData.get("post_id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!UUID.test(id) || (action !== "hide" && action !== "dismiss")) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("moderate_post", { p_post_id: id, p_action: action });
  if (error) {
    if (error.code === "42501") return { error: "This post is not in your college, or you are not a college admin." };
    console.error("Moderate post failed:", error.message);
    return { error: GENERIC };
  }
  refresh();
  revalidatePath("/feed");
  return { ok: true };
}
