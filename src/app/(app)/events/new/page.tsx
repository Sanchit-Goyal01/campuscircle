import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { NewEventForm } from "./form";

async function NewEvent() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  if (me.profile.role !== "college_admin" && me.profile.role !== "society_admin") notFound();
  const isSociety = me.profile.role === "society_admin";
  // RLS limits societies to this college; a society admin sees only their own.
  let q = me.db.from("societies").select("id, name").order("name", { ascending: true }).limit(100);
  if (isSociety) q = q.eq("admin_id", me.userId);
  const { data: socs, error } = await q;
  if (error) {
    console.error("Could not load societies:", error.message);
    throw new Error("Could not load societies.");
  }
  const societies = (socs ?? []) as { id: string; name: string }[];
  if (isSociety && societies.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <h1 className="font-slab text-3xl font-bold">New event</h1>
        <p>You do not admin a society yet, so you cannot create events. Ask your college admin to assign you one.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">New event</h1>
      <p className="text-sm">Times are in Indian Standard Time.</p>
      <NewEventForm societies={societies} required={isSociety} />
      <p>
        <Link href="/events" className="text-sm underline">
          Back to events
        </Link>
      </p>
    </div>
  );
}

export default function NewEventPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <NewEvent />
    </Suspense>
  );
}
