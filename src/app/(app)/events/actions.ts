"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type EventState = { error?: string; ok?: boolean; message?: string };

const GENERIC = "Something went wrong. Try again.";
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** `datetime-local` values are campus time (Asia/Kolkata). */
function parseLocal(v: string): string | null {
  if (!LOCAL.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createEvent(_prev: EventState, formData: FormData): Promise<EventState> {
  const title = String(formData.get("title") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const starts = parseLocal(String(formData.get("starts_at") ?? ""));
  const ends = parseLocal(String(formData.get("ends_at") ?? ""));
  if (title.length < 3 || title.length > 120) return { error: "Enter a title of 3 to 120 characters." };
  if (venue.length < 1 || venue.length > 120) return { error: "Enter a venue of up to 120 characters." };
  if (description.length > 4000) return { error: "The description can be at most 4000 characters." };
  if (!starts || !ends) return { error: "Choose a start and end date and time." };
  if (Date.parse(ends) <= Date.parse(starts)) return { error: "The event must end after it starts." };
  let capacity: number | null = null;
  if (capacityRaw) {
    if (!/^\d{1,5}$/.test(capacityRaw) || Number(capacityRaw) < 1 || Number(capacityRaw) > 10000) {
      return { error: "Capacity must be a whole number from 1 to 10000, or empty for no limit." };
    }
    capacity = Number(capacityRaw);
  }
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "college_admin" && me.profile.role !== "society_admin") {
    return { error: "Only college and society admins can create events." };
  }
  const { data, error } = await me.db
    .from("events")
    .insert({ title, venue, description, starts_at: starts, ends_at: ends, capacity })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "42501") return { error: "You can't create events." };
    if (error?.code === "23514") return { error: "Check the title, venue, times and capacity." };
    console.error("Create event failed:", error?.message);
    return { error: GENERIC };
  }
  revalidatePath("/events");
  redirect(`/events/${data.id}`);
}

export async function registerForEvent(_prev: EventState, formData: FormData): Promise<EventState> {
  const id = String(formData.get("event_id") ?? "");
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { data, error } = await me.db.rpc("register_for_event", { p_event_id: id });
  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") return { error: "You can't register for this event." };
    console.error("Register for event failed:", error.message);
    return { error: GENERIC };
  }
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  return { ok: true, message: data === "already_registered" ? "You were already registered." : "You are registered." };
}

export async function cancelRegistration(_prev: EventState, formData: FormData): Promise<EventState> {
  const id = String(formData.get("event_id") ?? "");
  if (!UUID.test(id)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db
    .from("event_registrations")
    .delete()
    .eq("event_id", id)
    .eq("student_id", me.userId);
  if (error) {
    console.error("Cancel registration failed:", error.message);
    return { error: "Could not cancel your registration. Try again." };
  }
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  return { ok: true, message: "Your registration was cancelled." };
}
