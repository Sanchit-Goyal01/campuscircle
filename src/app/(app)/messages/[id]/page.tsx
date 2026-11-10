import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { getConversation } from "@/modules/messaging/queries";
import { Thread } from "./thread";

async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const conv = UUID.test(id) ? await getConversation(me.db, me.userId, id) : null;
  if (!conv) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-slab text-3xl font-bold">Messages</h1>
        <p>This conversation is not available.</p>
        <p>
          <Link href="/messages" className="text-sm underline">
            Back to messages
          </Link>
        </p>
      </div>
    );
  }
  // Opening the thread marks it read; the sidebar count catches up on the next refresh.
  await me.db.rpc("mark_conversation_read", { p_conversation_id: conv.id });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">
        {conv.other_name}
        {conv.other_verified && <span className="ml-2 text-sm font-normal">Verified</span>}
      </h1>
      <Thread conversationId={conv.id} meId={me.userId} otherId={conv.other_id} otherName={conv.other_name} initial={conv.messages} />
      <p>
        <Link href="/messages" className="text-sm underline">
          Back to messages
        </Link>
      </p>
    </div>
  );
}

export default function ConversationPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Conversation params={props.params} />
    </Suspense>
  );
}
