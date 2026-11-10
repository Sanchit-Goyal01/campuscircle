"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { formatWhen } from "@/modules/events/queries";
import type { Message } from "@/modules/messaging/queries";
import { markConversationRead, sendMessageAction, type MessageState } from "../actions";

const merge = (current: Message[], incoming: Message[]) => {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
};

export function Thread({
  conversationId,
  meId,
  otherId,
  otherName,
  initial,
}: {
  conversationId: string;
  meId: string;
  otherId: string;
  otherName: string;
  initial: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [state, dispatch, pending] = useActionState<MessageState, FormData>(sendMessageAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The server refreshes `initial` after a send; keep whatever Realtime already delivered.
  useEffect(() => setMessages((cur) => merge(cur, initial)), [initial]);

  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId]);

  useEffect(() => {
    const db = getBrowserClient();
    let cancelled = false;
    let channel: ReturnType<typeof db.channel> | null = null;
    (async () => {
      // Realtime applies RLS with the token on its socket, so give it the user's token first.
      const { data } = await db.auth.getSession();
      if (data.session) db.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = db
        .channel(`conversation:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const m = payload.new as Message;
            if (!m?.id) return;
            setMessages((cur) => merge(cur, [{ id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at }]));
            if (m.sender_id !== meId) void markConversationRead(conversationId);
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [conversationId, meId]);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <p className="text-sm">No messages yet.</p>
      ) : (
        <ol aria-label="Conversation" className="flex flex-col gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] border border-zinc-300 p-2 text-sm ${m.sender_id === meId ? "self-end" : "self-start"}`}
            >
              <p className="text-xs text-zinc-600">
                {m.sender_id === meId ? "You" : otherName} · {formatWhen(m.created_at)} IST
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
      <form ref={formRef} action={dispatch} className="flex flex-col gap-2">
        <input type="hidden" name="recipient_id" value={otherId} />
        <input type="hidden" name="conversation_id" value={conversationId} />
        <label className="flex flex-col text-sm">
          Message
          <textarea name="body" rows={3} maxLength={2000} required className="border border-zinc-400 px-2 py-1" />
        </label>
        <div>
          <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
            {pending ? "Sending..." : "Send"}
          </button>
        </div>
        {state.error && (
          <p role="alert" className="text-sm">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
