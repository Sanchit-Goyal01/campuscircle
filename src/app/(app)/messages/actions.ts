"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type MessageState = { error?: string; ok?: boolean };

const GENERIC = "Could not send your message. Try again.";

/** Finds or creates the conversation with another person in my college, then opens it. */
export async function openConversation(formData: FormData): Promise<void> {
  const other = String(formData.get("other_id") ?? "");
  const me = UUID.test(other) ? await getProfile() : null;
  let target = "/messages?notice=unavailable";
  if (me) {
    const { data, error } = await me.db.rpc("open_conversation", { p_other: other });
    if (error) {
      if (error.code !== "42501") console.error("Open conversation failed:", error.message);
    } else if (typeof data === "string" && UUID.test(data)) {
      target = `/messages/${data}`;
    }
  }
  redirect(target);
}

export async function sendMessageAction(_prev: MessageState, formData: FormData): Promise<MessageState> {
  const recipient = String(formData.get("recipient_id") ?? "");
  const conversation = String(formData.get("conversation_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!UUID.test(recipient)) return { error: GENERIC };
  if (body.length < 1 || body.length > 2000) return { error: "Write a message of 1 to 2000 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("send_message", { p_recipient_id: recipient, p_body: body });
  if (error) {
    if (error.code === "P0001" && error.message === "too_many_messages") {
      return { error: "You have sent too many messages this hour. Try again later." };
    }
    if (error.code === "42501") return { error: "You can't message this person." };
    if (error.code === "23514") return { error: "Write a message of 1 to 2000 characters." };
    console.error("Send message failed:", error.message);
    return { error: GENERIC };
  }
  if (UUID.test(conversation)) revalidatePath(`/messages/${conversation}`);
  revalidatePath("/messages");
  return { ok: true };
}

export async function markConversationRead(conversationId: string): Promise<void> {
  if (!UUID.test(conversationId)) return;
  const me = await getProfile();
  if (!me) return;
  const { error } = await me.db.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error && error.code !== "42501") console.error("Mark read failed:", error.message);
  // Refreshes the sidebar's unread count.
  revalidatePath("/", "layout");
}
