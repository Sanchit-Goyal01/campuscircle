import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen } from "../issues/labels";
import { ReadButton } from "./read-button";

type Note = { id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };

async function Notifications() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  // RLS limits this to the signed-in user's own notifications.
  const { data, error } = await me.db
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Could not load notifications:", error.message);
    throw new Error("Could not load notifications.");
  }
  const notes = (data ?? []) as Note[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Notifications</h1>
      {notes.length === 0 ? (
        <p>No notifications yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
              <div className="font-medium">{n.title}</div>
              <div>{n.body}</div>
              <div>{formatWhen(n.created_at)}</div>
              <div className="flex flex-wrap items-center gap-3">
                {n.link?.startsWith("/") && !n.link.startsWith("//") && (
                  <Link href={n.link} className="underline">
                    View
                  </Link>
                )}
                {n.read_at ? <span>Read</span> : <ReadButton id={n.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Notifications />
    </Suspense>
  );
}
