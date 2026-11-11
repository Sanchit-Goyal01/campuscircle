import type { SupabaseClient } from '@supabase/supabase-js';

export type Message = { id: string; sender_id: string; body: string; created_at: string };

export type ConversationSummary = {
  id: string;
  other_id: string;
  other_name: string;
  other_verified: boolean;
  last_body: string | null;
  last_at: string | null;
  last_sender_id: string | null;
  unread: boolean;
};

const MAX_CONVERSATIONS = 50;
export const MAX_THREAD = 200;

type Row = {
  id: string;
  user_low: string;
  user_high: string;
  last_message_at: string | null;
  low_read_at: string | null;
  high_read_at: string | null;
};

/** True when the newest message is later than my read marker (before checking who sent it). */
const pastMarker = (c: Row, me: string) => {
  if (!c.last_message_at) return false;
  const mark = c.user_low === me ? c.low_read_at : c.high_read_at;
  return !mark || Date.parse(mark) < Date.parse(c.last_message_at);
};

const isUnread = (c: Row, me: string, lastSender: string | null) => lastSender !== me && pastMarker(c, me);

async function lastMessage(db: SupabaseClient, conversationId: string) {
  const { data, error } = await db
    .from('messages')
    .select('sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return (data?.[0] as { sender_id: string; body: string; created_at: string } | undefined) ?? null;
}

async function myConversations(db: SupabaseClient, me: string) {
  const { data, error } = await db
    .from('conversations')
    .select('id, user_low, user_high, last_message_at, low_read_at, high_read_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(MAX_CONVERSATIONS);
  if (error) throw new Error(`Could not load conversations: ${error.message}`);
  // RLS already limits rows to mine; the filter keeps the rule visible here.
  return ((data ?? []) as Row[]).filter((c) => c.user_low === me || c.user_high === me);
}

/** Conversations whose newest message arrived after my read marker and was not sent by me. */
export async function unreadConversationCount(db: SupabaseClient, userId?: string): Promise<number> {
  // Runs in the layout: a failure here must never break the page.
  try {
    let me = userId;
    if (!me) {
      const { data } = await db.auth.getUser();
      me = data.user?.id;
    }
    if (!me) return 0;
    const marked = (await myConversations(db, me)).filter((c) => pastMarker(c, me));
    const last = await Promise.all(marked.map((c) => lastMessage(db, c.id)));
    return marked.filter((c, i) => isUnread(c, me, last[i]?.sender_id ?? null)).length;
  } catch (e) {
    console.error('Unread message count failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** My conversations, newest activity first, with the other person's name and the last message. */
export async function listConversations(db: SupabaseClient, me: string): Promise<ConversationSummary[]> {
  // A conversation nobody has written in yet stays out of the list; its opener reaches it by redirect.
  const rows = (await myConversations(db, me)).filter((c) => c.last_message_at !== null);
  if (rows.length === 0) return [];
  const otherId = (c: Row) => (c.user_low === me ? c.user_high : c.user_low);
  const { data: profs, error } = await db
    .from('profiles')
    .select('id, full_name, verified')
    .in('id', rows.map(otherId));
  if (error) throw new Error(`Could not load people: ${error.message}`);
  const byId = new Map(((profs ?? []) as any[]).map((p) => [p.id as string, p]));
  const last = await Promise.all(rows.map((c) => lastMessage(db, c.id)));
  return rows.map((c, i) => {
    const p = byId.get(otherId(c));
    return {
      id: c.id,
      other_id: otherId(c),
      other_name: (p?.full_name || 'A student') as string,
      other_verified: p?.verified === true,
      last_body: last[i]?.body ?? null,
      last_at: last[i]?.created_at ?? null,
      last_sender_id: last[i]?.sender_id ?? null,
      unread: isUnread(c, me, last[i]?.sender_id ?? null),
    };
  });
}

/** One conversation I belong to, with its newest messages oldest first. Null when it is not mine. */
export async function getConversation(db: SupabaseClient, me: string, id: string) {
  const { data: c, error } = await db
    .from('conversations')
    .select('id, user_low, user_high')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  if (!c || (c.user_low !== me && c.user_high !== me)) return null;
  const otherId = (c.user_low === me ? c.user_high : c.user_low) as string;
  const [{ data: p }, { data: msgs, error: me2 }] = await Promise.all([
    db.from('profiles').select('full_name, verified').eq('id', otherId).maybeSingle(),
    db
      .from('messages')
      .select('id, sender_id, body, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(MAX_THREAD),
  ]);
  if (me2) throw new Error(`Could not load messages: ${me2.message}`);
  return {
    id: c.id as string,
    other_id: otherId,
    other_name: ((p?.full_name as string | undefined) || 'A student') as string,
    other_verified: p?.verified === true,
    messages: ((msgs ?? []) as Message[]).reverse(),
    truncated: (msgs ?? []).length >= MAX_THREAD,
  };
}
