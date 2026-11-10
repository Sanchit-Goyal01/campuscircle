import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatWhen } from "@/modules/events/queries";
import { listConversations } from "@/modules/messaging/queries";

async function Conversations({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const sp = await searchParams;
  const notice = (Array.isArray(sp.notice) ? sp.notice[0] : sp.notice) === "unavailable";
  const rows = await listConversations(me.db, me.userId);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Messages</h1>
      {notice && <p role="alert">You can't message that person.</p>}
      {rows.length === 0 ? (
        <p>
          No messages yet. Find someone in{" "}
          <Link href="/people" className="underline">
            People
          </Link>{" "}
          and press Message.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id} className="border border-zinc-300 p-3 text-sm">
              <Link href={`/messages/${c.id}`} className="flex flex-col gap-1 underline-offset-2 hover:underline">
                <span className="font-medium">
                  {c.other_name}
                  {c.other_verified && <span className="ml-2 text-xs font-normal">Verified</span>}
                  {c.unread && <span className="ml-2 text-xs font-semibold">New</span>}
                </span>
                <span className="break-words">
                  {c.last_body === null ? "No messages yet." : `${c.last_sender_id === me.userId ? "You: " : ""}${c.last_body.slice(0, 120)}`}
                </span>
                {c.last_at && <span className="text-xs text-zinc-600">{formatWhen(c.last_at)} IST</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MessagesPage(props: { searchParams: Promise<{ notice?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Conversations searchParams={props.searchParams} />
    </Suspense>
  );
}
