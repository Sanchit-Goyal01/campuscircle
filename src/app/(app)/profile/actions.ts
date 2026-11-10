"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";

export type ProfileState = { error?: string; ok?: boolean };

const GENERIC = "Could not save your profile. Try again.";
const LIMITS = "Use at most 20 skills of up to 40 characters each, and a bio of up to 500 characters.";

function parseSkills(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const name = String(formData.get("full_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const skills = parseSkills(String(formData.get("skills") ?? ""));
  const isMentor = formData.get("is_mentor") === "on";
  if (name.length < 1 || name.length > 100) return { error: "Enter your name, up to 100 characters." };
  if (bio.length > 500 || skills.length > 20 || skills.some((s) => s.length > 40)) return { error: LIMITS };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db
    .from("profiles")
    .update({ full_name: name, bio: bio === "" ? null : bio, skills, is_mentor: isMentor })
    .eq("id", me.userId);
  if (error) {
    if (error.code === "23514") return { error: LIMITS };
    if (error.code === "42501") return { error: "You can't change this profile." };
    console.error("Profile save failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath("/profile");
  revalidatePath("/people");
  return { ok: true };
}
