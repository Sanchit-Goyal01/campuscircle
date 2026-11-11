"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type DecideState = { error?: string; ok?: boolean };

const GENERIC = "Something went wrong. Try again.";

export async function decideMentorship(requestId: string, accept: boolean): Promise<DecideState> {
  if (!UUID.test(requestId)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("decide_mentorship", { p_request_id: requestId, p_accept: accept });
  if (error) {
    if (error.code === "42501") return { error: "This request was already decided or is not yours to decide." };
    console.error("Mentorship decision failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath("/mentorship");
  return { ok: true };
}
