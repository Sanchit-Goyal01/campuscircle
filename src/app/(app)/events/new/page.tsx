import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { NewEventForm } from "./form";

async function NewEvent() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  if (me.profile.role !== "college_admin" && me.profile.role !== "society_admin") notFound();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">New event</h1>
      <p className="text-sm">Times are in Indian Standard Time.</p>
      <NewEventForm />
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
