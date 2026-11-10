"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type MarketState = { error?: string; ok?: boolean };

const GENERIC = "Something went wrong. Try again.";
const CONDITIONS = ["new", "like_new", "good", "fair"];

export async function createListing(_prev: MarketState, formData: FormData): Promise<MarketState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const condition = String(formData.get("condition") ?? "");
  const photo = String(formData.get("photo_path") ?? "").trim();
  if (title.length < 3 || title.length > 120) return { error: "Enter a title of 3 to 120 characters." };
  if (description.length > 2000) return { error: "The description can be at most 2000 characters." };
  if (!/^\d{1,7}$/.test(priceRaw) || Number(priceRaw) > 1_000_000) return { error: "Enter a whole-rupee price from 0 to 1,000,000." };
  if (!CONDITIONS.includes(condition)) return { error: "Choose a condition." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "student") return { error: "Only students can list items." };
  if (photo && !photo.startsWith(`${me.profile.college_id}/${me.userId}/`)) return { error: "The photo is not valid. Upload it again." };
  const { data, error } = await me.db
    .from("listings")
    .insert({ title, description, price_inr: Number(priceRaw), condition, photo_path: photo || null })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "42501") return { error: "You can't list items." };
    if (error?.code === "23514") return { error: "Check the title, price and photo." };
    console.error("Create listing failed:", error?.message);
    return { error: GENERIC };
  }
  revalidatePath("/market");
  redirect(`/market/${data.id}`);
}

export async function contactSeller(_prev: MarketState, formData: FormData): Promise<MarketState> {
  const id = String(formData.get("listing_id") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  if (!UUID.test(id)) return { error: GENERIC };
  if (message.length < 10 || message.length > 500) return { error: "Write a message of 10 to 500 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("contact_seller", { p_listing_id: id, p_message: message });
  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") return { error: "You can't contact the seller of this item." };
    if (error.code === "23514") return { error: "Write a message of 10 to 500 characters." };
    console.error("Contact seller failed:", error.message);
    return { error: GENERIC };
  }
  return { ok: true };
}

export async function markSold(formData: FormData): Promise<void> {
  const id = String(formData.get("listing_id") ?? "");
  if (!UUID.test(id)) return;
  const me = await getProfile();
  if (!me) return;
  const { error } = await me.db.from("listings").update({ status: "sold" }).eq("id", id).eq("seller_id", me.userId);
  if (error) console.error("Mark sold failed:", error.message);
  revalidatePath("/market");
  revalidatePath(`/market/${id}`);
}

export async function deleteListing(formData: FormData): Promise<void> {
  const id = String(formData.get("listing_id") ?? "");
  if (!UUID.test(id)) return;
  const me = await getProfile();
  if (!me) return;
  const { data: row } = await me.db.from("listings").select("photo_path").eq("id", id).eq("seller_id", me.userId).maybeSingle();
  const { error } = await me.db.from("listings").delete().eq("id", id).eq("seller_id", me.userId);
  if (error) {
    console.error("Delete listing failed:", error.message);
    return;
  }
  if (row?.photo_path) await me.db.storage.from("listing-photos").remove([row.photo_path as string]);
  revalidatePath("/market");
  redirect("/market");
}
