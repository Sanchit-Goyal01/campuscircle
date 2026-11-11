import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen } from "@/modules/events/queries";
import { loadAnnouncements } from "@/modules/admin/queries";

async function Announcements() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { items, failed } = await loadAnnouncements(me.db, 100);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Announcements</h1>
      {failed ? (
        <p>Announcements could not be loaded right now.</p>
      ) : items.length === 0 ? (
        <p>No announcements yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
              <h2 className="text-lg font-semibold">{a.title}</h2>
              <div>{formatWhen(a.created_at)} IST</div>
              <p className="whitespace-pre-wrap">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Announcements />
    </Suspense>
  );
}
