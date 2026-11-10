import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatWhen, registrationCount } from "@/modules/events/queries";
import { RegisterButton } from "./register-button";

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { data: e } = await me.db
    .from("events")
    .select("id, title, description, venue, starts_at, ends_at, capacity")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();
  const count = await registrationCount(me.db, id);
  const isStudent = me.profile.role === "student";
  let registered = false;
  if (isStudent) {
    const { data } = await me.db
      .from("event_registrations")
      .select("event_id")
      .eq("event_id", id)
      .eq("student_id", me.userId)
      .maybeSingle();
    registered = !!data;
  }
  const started = Date.parse(e.starts_at) <= Date.now();
  const full = e.capacity !== null && count >= e.capacity;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">{e.title}</h1>
      <p className="text-sm">
        {formatWhen(e.starts_at)} to {formatWhen(e.ends_at)} · {e.venue}
      </p>
      <p className="text-sm">
        {e.capacity === null ? `${count} registered` : `${count} of ${e.capacity} seats taken`}
      </p>
      {e.description && <p className="whitespace-pre-wrap">{e.description}</p>}
      {isStudent &&
        (registered ? (
          <RegisterButton eventId={e.id} registered />
        ) : started ? (
          <p>This event has already started.</p>
        ) : full ? (
          <p>This event is full.</p>
        ) : (
          <RegisterButton eventId={e.id} registered={false} />
        ))}
      <p>
        <Link href="/events" className="text-sm underline">
          Back to events
        </Link>
      </p>
    </div>
  );
}

export default function EventPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Detail params={props.params} />
    </Suspense>
  );
}
