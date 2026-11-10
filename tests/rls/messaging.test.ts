import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent, supabaseEnv } from "../helpers/supabase";
import { executeToolCall, runApprovedAction } from "../../src/agent/executor";
import type { ToolContext } from "../../src/agent/types";
import { allTools } from "../../src/modules";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let a: S;
let b: S;
let c: S;
let xB: S;

const ctxFor = (s: S, collegeId: string): ToolContext => ({ db: s.client, userId: s.id, collegeId, role: "student" });
const send = (s: S, to: string, body: string) => s.client.rpc("send_message", { p_recipient_id: to, p_body: body });

beforeAll(async () => {
  vi.stubEnv("AGENT_TEST_MODEL", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseEnv().url);
  collegeA = await createCollege(`Msg A ${run}`, `ma-${run}.edu`);
  await createCollege(`Msg B ${run}`, `mb-${run}.edu`);
  a = await createStudent(`a-${run}@ma-${run}.edu`);
  b = await createStudent(`b-${run}@ma-${run}.edu`);
  c = await createStudent(`c-${run}@ma-${run}.edu`);
  xB = await createStudent(`x-${run}@mb-${run}.edu`);
});
afterAll(() => vi.unstubAllEnvs());

describe("messaging", { timeout: 90_000 }, () => {
  test("two students exchange messages; a third same-college student reads nothing", async () => {
    const first = await send(a, b.id, "Hello B");
    expect(first.error).toBeNull();
    const convId = first.data as string;
    const reply = await send(b, a.id, "Hello A");
    expect(reply.error).toBeNull();
    expect(reply.data).toBe(convId);
    for (const s of [a, b]) {
      const { data } = await s.client.from("messages").select("body, sender_id").eq("conversation_id", convId).order("created_at");
      expect(data?.map((m) => m.body).sort()).toEqual(["Hello A", "Hello B"]);
      const conv = await s.client.from("conversations").select("id").eq("id", convId);
      expect(conv.data).toHaveLength(1);
    }
    expect((await c.client.from("messages").select("id").eq("conversation_id", convId)).data).toEqual([]);
    expect((await c.client.from("conversations").select("id")).data).toEqual([]);
    expect((await xB.client.from("messages").select("id")).data).toEqual([]);
    expect((await xB.client.from("conversations").select("id")).data).toEqual([]);
  });

  test("message to self, to college B, empty and 2001 characters are refused", async () => {
    expect((await send(a, a.id, "me")).error?.code).toBe("42501");
    expect((await send(a, xB.id, "hi")).error?.code).toBe("42501");
    expect((await send(xB, a.id, "hi")).error?.code).toBe("42501");
    expect((await send(a, crypto.randomUUID(), "hi")).error?.code).toBe("42501");
    expect((await send(a, b.id, "")).error?.code).toBe("23514");
    expect((await send(a, b.id, "   ")).error?.code).toBe("23514");
    const long = await send(a, b.id, "x".repeat(2001));
    expect(long.error?.code).toBe("23514");
    expect(long.error?.message).not.toMatch(/violates|constraint|char_length/i);
    expect((await send(a, b.id, "y".repeat(2000))).error).toBeNull();
    expect((await a.client.rpc("open_conversation", { p_other: a.id })).error?.code).toBe("42501");
    expect((await a.client.rpc("open_conversation", { p_other: xB.id })).error?.code).toBe("42501");
  });

  test("61st message in an hour is refused with too_many_messages", async () => {
    const s = await createStudent(`s-${run}@ma-${run}.edu`);
    const r = await createStudent(`r-${run}@ma-${run}.edu`);
    const first = await send(s, r.id, "m1");
    expect(first.error).toBeNull();
    const rows = Array.from({ length: 58 }, (_, i) => ({ conversation_id: first.data, college_id: collegeA, sender_id: s.id, body: `bulk ${i}` }));
    const ins = await adminClient().from("messages").insert(rows);
    expect(ins.error).toBeNull();
    expect((await send(s, r.id, "m60")).error).toBeNull();
    const over = await send(s, r.id, "m61");
    expect(over.error?.code).toBe("P0001");
    expect(over.error?.message).toBe("too_many_messages");
    // The cap is per sender: the recipient can still reply.
    expect((await send(r, s.id, "reply")).error).toBeNull();
  });

  test("open_conversation returns the same id for both directions", async () => {
    const p = await createStudent(`p-${run}@ma-${run}.edu`);
    const q = await createStudent(`q-${run}@ma-${run}.edu`);
    const one = await p.client.rpc("open_conversation", { p_other: q.id });
    const two = await q.client.rpc("open_conversation", { p_other: p.id });
    const again = await p.client.rpc("open_conversation", { p_other: q.id });
    expect(one.error).toBeNull();
    expect(two.data).toBe(one.data);
    expect(again.data).toBe(one.data);
    const sent = await send(q, p.id, "hi");
    expect(sent.data).toBe(one.data);
    const { data } = await adminClient().from("conversations").select("user_low, user_high").eq("id", one.data as string).single();
    expect(data!.user_low < data!.user_high).toBe(true);
  });

  test("student cannot insert messages or conversations directly", async () => {
    const conv = (await a.client.rpc("open_conversation", { p_other: b.id })).data as string;
    const m = await a.client.from("messages").insert({ conversation_id: conv, college_id: collegeA, sender_id: a.id, body: "forged" });
    expect(m.error?.code).toBe("42501");
    const cv = await a.client.from("conversations").insert({ college_id: collegeA, user_low: a.id, user_high: c.id });
    expect(cv.error?.code).toBe("42501");
    const up = await a.client.from("conversations").update({ low_read_at: null, last_message_at: null }).eq("id", conv);
    expect(up.error?.code).toBe("42501");
    const del = await a.client.from("messages").delete().eq("conversation_id", conv).select("id");
    expect(del.error?.code).toBe("42501");
    // Not a participant: the read marker call is refused.
    expect((await c.client.rpc("mark_conversation_read", { p_conversation_id: conv })).error?.code).toBe("42501");
  });

  test("unread count follows read markers and the last sender", async () => {
    const { unreadConversationCount } = await import("../../src/modules/messaging/queries");
    const u = await createStudent(`u-${run}@ma-${run}.edu`);
    const v = await createStudent(`v-${run}@ma-${run}.edu`);
    expect(await unreadConversationCount(v.client, v.id)).toBe(0);
    const conv = (await send(u, v.id, "ping")).data as string;
    expect(await unreadConversationCount(v.client, v.id)).toBe(1);
    expect(await unreadConversationCount(u.client, u.id)).toBe(0);
    expect((await v.client.rpc("mark_conversation_read", { p_conversation_id: conv })).error).toBeNull();
    expect(await unreadConversationCount(v.client, v.id)).toBe(0);
    await send(v, u.id, "pong");
    expect(await unreadConversationCount(u.client, u.id)).toBe(1);
    expect(await unreadConversationCount(v.client, v.id)).toBe(0);
  });

  test("realtime delivers a new message to its participants only", async () => {
    const e = await createStudent(`e-${run}@ma-${run}.edu`);
    const f = await createStudent(`f-${run}@ma-${run}.edu`);
    const g = await createStudent(`g-${run}@ma-${run}.edu`);
    const got: Record<string, string[]> = { f: [], c: [] };
    const listen = async (name: string, s: S) => {
      const { data } = await s.client.auth.getSession();
      s.client.realtime.setAuth(data.session!.access_token);
      await new Promise<void>((resolve, reject) => {
        s.client
          .channel(`t-${name}-${run}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => got[name].push((p.new as any).body))
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
          });
      });
    };
    await listen("f", f);
    await listen("c", c);
    // Right after a db reset Realtime can take a moment to start streaming, so keep sending until f hears one.
    for (let i = 0; i < 10 && got.f.length === 0; i++) {
      expect((await send(e, f.id, `live ${i}`)).error).toBeNull();
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(got.f.length).toBeGreaterThan(0);
    expect(got.f[0]).toMatch(/^live \d$/);
    await new Promise((r) => setTimeout(r, 1500));
    expect(got.c).toEqual([]);
    // Positive control: c is a participant elsewhere and hears that message on the same filterless subscription.
    expect((await send(g, c.id, "for c only")).error).toBeNull();
    await vi.waitFor(() => expect(got.c).toEqual(["for c only"]), { timeout: 10_000 });
    expect(got.f.every((b) => b.startsWith("live "))).toBe(true);
    await f.client.removeAllChannels();
    await c.client.removeAllChannels();
  });

  test("find_person with % or _ does not match everyone", async () => {
    const find = allTools.find((x) => x.name === "find_person")!;
    const ctx = ctxFor(a, collegeA);
    for (const name of ["%%", "__", "%_", `%${run}`]) {
      expect(await find.run({ name }, ctx)).toEqual([]);
    }
    const hit = (await find.run({ name: `B-${run}` }, ctx)) as any[];
    expect(hit.map((p) => p.person_id)).toEqual([b.id]);
  });

  test("send_message tool runs only after approval and the card shows the name, not the id", async () => {
    const t = await createStudent(`t-${run}@ma-${run}.edu`);
    const ctx = ctxFor(t, collegeA);
    const { data: runRow } = await t.client.from("agent_runs").insert({ student_id: t.id, college_id: collegeA, message: "hi" }).select("id").single();
    const tool = allTools.find((x) => x.name === "send_message")!;
    expect(tool.kind).toBe("write");
    const input = { recipient_id: b.id, body: "Sent through the agent" };
    const out = await executeToolCall({ name: "send_message", input }, allTools, ctx, runRow!.id);
    expect(out.status).toBe("pending_approval");
    const before = await adminClient().from("messages").select("id", { count: "exact", head: true }).eq("sender_id", t.id);
    expect(before.count).toBe(0);
    if (out.status !== "pending_approval") throw new Error("expected pending");

    const { describeAction } = await import("../../src/agent/display");
    const d = await describeAction(t.client, { tool_name: "send_message", input });
    expect(d).toEqual({ kind: "message", recipient: `b-${run}`, body: "Sent through the agent" });
    expect(JSON.stringify(d)).not.toContain(b.id);
    expect(await describeAction(t.client, { tool_name: "send_message", input: { recipient_id: xB.id, body: "x" } })).toMatchObject({ kind: "message", recipient: null });
    expect(await describeAction(t.client, { tool_name: "send_message", input: { recipient_id: "nope", body: "x" } })).toMatchObject({ recipient: null });

    const done = await runApprovedAction(out.actionId, allTools, ctx);
    expect(done.status).toBe("ok");
    const after = await adminClient().from("messages").select("body").eq("sender_id", t.id);
    expect(after.data?.map((m) => m.body)).toEqual(["Sent through the agent"]);

    // find_person: same college only, never self, no email.
    const find = allTools.find((x) => x.name === "find_person")!;
    const found = (await find.run({ name: `B-${run}` }, ctx)) as any[];
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0]).sort()).toEqual(["name", "person_id", "skills", "verified"]);
    expect(found[0].person_id).toBe(b.id);
    expect(await find.run({ name: `x-${run}` }, ctx)).toEqual([]);
    expect(((await find.run({ name: `t-${run}` }, ctx)) as any[]).map((p) => p.person_id)).not.toContain(t.id);
  });
});
