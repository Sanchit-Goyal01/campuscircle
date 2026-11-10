"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type FeedState = { error?: string; ok?: boolean };

const GENERIC = "Something went wrong. Try again.";

export async function createPost(_prev: FeedState, formData: FormData): Promise<FeedState> {
  const body = String(formData.get("body") ?? "").trim();
  const photo = String(formData.get("photo_path") ?? "").trim();
  if (body.length < 1 || body.length > 2000) return { error: "Write a post of 1 to 2000 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (photo && !photo.startsWith(`${me.profile.college_id}/${me.userId}/`)) return { error: "The photo is not valid. Upload it again." };
  const { error } = await me.db.rpc("create_post", { p_body: body, p_photo_path: photo || null });
  if (error) {
    if (error.code === "P0001") return { error: "You have posted too many times today. Try again tomorrow." };
    if (error.code === "23514") return { error: "Check the post text and photo." };
    if (error.code === "42501") return { error: "You can't post to this feed." };
    console.error("Create post failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath("/feed");
  return { ok: true };
}

export async function toggleLike(formData: FormData): Promise<void> {
  const id = String(formData.get("post_id") ?? "");
  if (!UUID.test(id)) return;
  const me = await getProfile();
  if (!me) return;
  const { data, error } = await me.db.from("post_likes").delete().eq("post_id", id).eq("user_id", me.userId).select("post_id");
  if (error) {
    console.error("Unlike failed:", error.message);
    return;
  }
  if (!data || data.length === 0) {
    const ins = await me.db.from("post_likes").insert({ post_id: id });
    if (ins.error && ins.error.code !== "23505") console.error("Like failed:", ins.error.message);
  }
  revalidatePath("/feed");
  revalidatePath(`/feed/${id}`);
}

export async function reportPost(_prev: FeedState, formData: FormData): Promise<FeedState> {
  const id = String(formData.get("post_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(id)) return { error: GENERIC };
  if (reason.length < 3 || reason.length > 300) return { error: "Write a reason of 3 to 300 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("report_post", { p_post_id: id, p_reason: reason });
  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") return { error: "You can't report this post." };
    if (error.code === "23514") return { error: "Write a reason of 3 to 300 characters." };
    console.error("Report post failed:", error.message);
    return { error: GENERIC };
  }
  return { ok: true };
}

export async function addComment(_prev: FeedState, formData: FormData): Promise<FeedState> {
  const id = String(formData.get("post_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!UUID.test(id)) return { error: GENERIC };
  if (body.length < 1 || body.length > 1000) return { error: "Write a comment of 1 to 1000 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.from("post_comments").insert({ post_id: id, body });
  if (error) {
    if (error.code === "42501") return { error: "You can't comment on this post." };
    if (error.code === "23514") return { error: "Write a comment of 1 to 1000 characters." };
    console.error("Add comment failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath("/feed");
  revalidatePath(`/feed/${id}`);
  return { ok: true };
}

export async function deleteComment(formData: FormData): Promise<void> {
  const id = String(formData.get("comment_id") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!UUID.test(id) || !UUID.test(postId)) return;
  const me = await getProfile();
  if (!me) return;
  const { error } = await me.db.from("post_comments").delete().eq("id", id).eq("author_id", me.userId);
  if (error) console.error("Delete comment failed:", error.message);
  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
}

export async function deletePost(formData: FormData): Promise<void> {
  const id = String(formData.get("post_id") ?? "");
  if (!UUID.test(id)) return;
  const me = await getProfile();
  if (!me) return;
  const { data: row } = await me.db.from("posts").select("photo_path").eq("id", id).eq("author_id", me.userId).maybeSingle();
  const { data, error } = await me.db.from("posts").delete().eq("id", id).eq("author_id", me.userId).select("id");
  if (error || !data || data.length === 0) {
    console.error("Delete post failed:", error?.message);
    return;
  }
  if (row?.photo_path) await me.db.storage.from("post-photos").remove([row.photo_path as string]);
  revalidatePath("/feed");
  revalidatePath(`/feed/${id}`);
}
