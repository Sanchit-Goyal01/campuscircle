"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { agentToday } from "@/lib/today";
import { UUID } from "@/modules/academics/http";

export type ItemState = { error?: string };

const GENERIC = "Could not update this item. Try again.";

export async function setItemDone(id: string, done: boolean): Promise<ItemState> {
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };

  // RLS limits updates to the student's own plan items; no row back means it is not theirs.
  const { data, error } = await me.db.from("study_plan_items").update({ done }).eq("id", id).select("id");
  if (error) {
    console.error("Could not update a study plan item");
    return { error: GENERIC };
  }
  if (!data?.length) return { error: "This item is no longer available." };
  revalidatePath("/academics/plans");
  return {};
}

export async function markItemMissed(id: string): Promise<ItemState> {
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };

  // The date comes from the server's agent timezone, never from the client.
  const { data, error } = await me.db.rpc("mark_item_missed", { p_item_id: id, p_today: agentToday() });
  if (error) {
    if (error.message.includes("item_done")) return { error: "This item is already done." };
    console.error("Could not reschedule a study plan item");
    return { error: GENERIC };
  }
  if (!data?.length) return { error: "This item is no longer available." };
  revalidatePath("/academics/plans");
  return {};
}
