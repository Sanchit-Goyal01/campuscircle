import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let collegeB: string;
let cAdmin: S;
let adminX: S;
let adminY: S;
let student: S;
let other: S;
let studentB: S;
let adminB: S;
let socX: string;
let socY: string;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const newEvent = (over: Record<string, unknown> = {}) => ({
  title: `Society event ${run}`,
  description: "",
  venue: "Hall",
  starts_at: inDays(5),
  ends_at: inDays(5.1),
  ...over,
});
const notes = async (userId: string, kind: string) => {
  const { data } = await adminClient().from("notifications").select("link, body").eq("user_id", userId).eq("kind", kind);
  return data ?? [];
};

beforeAll(async () => {
  collegeA = await createCollege(`Soc A ${run}`, `sa-${run}.edu`);
  collegeB = await createCollege(`Soc B ${run}`, `sb-${run}.edu`);
  cAdmin = await createUserWithRole(`ca-${run}@sa-${run}.edu`, "college_admin");
  adminX = await createUserWithRole(`ax-${run}@sa-${run}.edu`, "society_admin");
  adminY = await createUserWithRole(`ay-${run}@sa-${run}.edu`, "society_admin");
  student = await createStudent(`s-${run}@sa-${run}.edu`);
  other = await createStudent(`o-${run}@sa-${run}.edu`);
  studentB = await createStudent(`sb-${run}@sb-${run}.edu`);
  adminB = await createUserWithRole(`ab-${run}@sb-${run}.edu`, "society_admin");
});

describe("societies", { timeout: 60_000 }, () => {
  test("college admin creates a society with a society_admin as admin; a student admin is refused", async () => {
    const mk = (name: string, admin_id: string | null, c = cAdmin) =>
      c.client.from("societies").insert({ name, description: "About us", admin_id }).select("id, college_id").single();
    const x = await mk(`Chess ${run}`, adminX.id);
    expect(x.error).toBeNull();
    expect(x.data?.college_id).toBe(collegeA);
    socX = x.data!.id;
    const y = await mk(`Drama ${run}`, adminY.id);
    expect(y.error).toBeNull();
    socY = y.data!.id;
    expect((await mk(`Bad ${run}`, student.id)).error?.code).toBe("23514");
    expect((await mk(`Bad2 ${run}`, adminB.id)).error?.code).toBe("23514");
    expect((await mk(`chess ${run}`, adminX.id)).error?.code).toBe("23505");
    expect((await mk("ab", adminX.id)).error?.code).toBe("23514");
    expect((await mk(`Nope ${run}`, adminX.id, student as S)).error?.code).toBe("42501");
    expect((await mk(`Nope ${run}`, adminX.id, adminX)).error?.code).toBe("42501");
    // Changing the admin to a student is refused; to another society_admin is fine.
    expect((await cAdmin.client.from("societies").update({ admin_id: student.id }).eq("id", socX).select("id")).error?.code).toBe("23514");
    expect((await cAdmin.client.from("societies").update({ description: "New" }).eq("id", socX).select("id")).data).toHaveLength(1);
    // Others cannot update.
    expect((await adminX.client.from("societies").update({ description: "Mine" }).eq("id", socX).select("id")).data ?? []).toEqual([]);
    expect((await student.client.from("societies").update({ name: "Hijack" }).eq("id", socX).select("id")).data ?? []).toEqual([]);
    const { data } = await adminClient().from("societies").select("name, description").eq("id", socX).single();
    expect(data).toEqual({ name: `Chess ${run}`, description: "New" });
    // Direct deletes are not allowed.
    expect((await cAdmin.client.from("societies").delete().eq("id", socX).select("id")).data ?? []).toEqual([]);
  });

  test("student requests to join, admin accepts, student is notified", async () => {
    const r = await student.client.rpc("request_to_join", { p_society_id: socX });
    expect(r.error).toBeNull();
    const n = await notes(adminX.id, "society_join_request");
    expect(n).toHaveLength(1);
    expect(n[0].link).toBe(`/societies/${socX}`);
    // The student sees their own row, the admin sees it, another student does not.
    expect((await student.client.from("society_members").select("status").eq("society_id", socX)).data).toEqual([{ status: "pending" }]);
    expect((await adminX.client.from("society_members").select("status").eq("society_id", socX)).data).toEqual([{ status: "pending" }]);
    expect((await other.client.from("society_members").select("status").eq("society_id", socX)).data ?? []).toEqual([]);
    // Pending does not count as a member.
    expect((await other.client.rpc("society_member_count", { p_society_id: socX })).data).toBe(0);
    // A student cannot decide their own request, and clients cannot write.
    expect((await student.client.rpc("decide_join", { p_society_id: socX, p_student_id: student.id, p_accept: true })).error?.code).toBe("42501");
    expect((await student.client.from("society_members").update({ status: "approved" }).eq("society_id", socX).select("status")).data ?? []).toEqual([]);
    expect((await student.client.from("society_members").insert({ society_id: socX, student_id: other.id, college_id: collegeA })).error).not.toBeNull();
    const d = await adminX.client.rpc("decide_join", { p_society_id: socX, p_student_id: student.id, p_accept: true });
    expect(d.error).toBeNull();
    const acc = await notes(student.id, "society_join_accepted");
    expect(acc).toHaveLength(1);
    expect(acc[0].link).toBe(`/societies/${socX}`);
    expect((await other.client.rpc("society_member_count", { p_society_id: socX })).data).toBe(1);
    // Already decided.
    expect((await adminX.client.rpc("decide_join", { p_society_id: socX, p_student_id: student.id, p_accept: false })).error?.code).toBe("42501");
  });

  test("admin of society X cannot decide requests or announce for society Y", async () => {
    expect((await other.client.rpc("request_to_join", { p_society_id: socY })).error).toBeNull();
    expect((await adminX.client.rpc("decide_join", { p_society_id: socY, p_student_id: other.id, p_accept: true })).error?.code).toBe("42501");
    expect((await adminX.client.rpc("post_society_announcement", { p_society_id: socY, p_title: "Hello all", p_body: "Body" })).error?.code).toBe("42501");
    expect((await student.client.rpc("post_society_announcement", { p_society_id: socX, p_title: "Hello all", p_body: "Body" })).error?.code).toBe("42501");
    expect((await adminX.client.from("society_announcements").insert({ society_id: socY, title: "Hello all", body: "Body", author_id: adminX.id })).error).not.toBeNull();
    expect((await adminX.client.from("society_members").select("status").eq("society_id", socY)).data ?? []).toEqual([]);
    const { data } = await adminClient().from("society_members").select("status").eq("society_id", socY).eq("student_id", other.id).single();
    expect(data?.status).toBe("pending");
    // The right admin declines.
    expect((await adminY.client.rpc("decide_join", { p_society_id: socY, p_student_id: other.id, p_accept: false })).error).toBeNull();
    expect(await notes(other.id, "society_join_declined")).toHaveLength(1);
  });

  test("second request while pending is refused; request within 7 days of decline is refused", async () => {
    const msg = async (s: S, id: string) => (await s.client.rpc("request_to_join", { p_society_id: id })).error;
    expect((await msg(student, socX))?.message).toBe("already_requested"); // approved
    expect((await msg(student, socX))?.code).toBe("P0001");
    const third = await createStudent(`t-${run}@sa-${run}.edu`);
    expect(await msg(third, socY)).toBeNull();
    const dup = await msg(third, socY);
    expect(dup?.code).toBe("P0001");
    expect(dup?.message).toBe("already_requested");
    expect((await adminY.client.rpc("decide_join", { p_society_id: socY, p_student_id: third.id, p_accept: false })).error).toBeNull();
    const re = await msg(third, socY);
    expect(re?.code).toBe("P0001");
    expect(re?.message).toBe("declined_recently");
    // After 7 days the declined row resets to pending.
    await adminClient().from("society_members").update({ decided_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("society_id", socY).eq("student_id", third.id);
    expect(await msg(third, socY)).toBeNull();
    const { data } = await adminClient().from("society_members").select("status, decided_at").eq("society_id", socY).eq("student_id", third.id).single();
    expect(data).toEqual({ status: "pending", decided_at: null });
    // Leaving a declined request does not clear the cooldown.
    expect((await other.client.rpc("leave_society", { p_society_id: socY })).error).toBeNull();
    expect((await msg(other, socY))?.message).toBe("declined_recently");
    // Roles other than student, other colleges and unknown societies are refused.
    expect((await msg(adminX as S, socY))?.code).toBe("42501");
    expect((await msg(studentB, socY))?.code).toBe("42501");
    expect((await student.client.rpc("request_to_join", { p_society_id: "00000000-0000-0000-0000-000000000000" })).error?.code).toBe("42501");
  });

  test("leaving removes a pending or approved membership", async () => {
    expect((await student.client.rpc("leave_society", { p_society_id: socX })).error).toBeNull();
    expect((await student.client.from("society_members").select("status").eq("society_id", socX)).data ?? []).toEqual([]);
    expect((await other.client.rpc("society_member_count", { p_society_id: socX })).data).toBe(0);
  });

  test("announcement notifies approved members only", async () => {
    const m1 = await createStudent(`m1-${run}@sa-${run}.edu`);
    const m2 = await createStudent(`m2-${run}@sa-${run}.edu`); // pending
    const m3 = await createStudent(`m3-${run}@sa-${run}.edu`); // declined
    for (const m of [m1, m2, m3]) expect((await m.client.rpc("request_to_join", { p_society_id: socX })).error).toBeNull();
    expect((await adminX.client.rpc("decide_join", { p_society_id: socX, p_student_id: m1.id, p_accept: true })).error).toBeNull();
    expect((await adminX.client.rpc("decide_join", { p_society_id: socX, p_student_id: m3.id, p_accept: false })).error).toBeNull();
    const bad = (p_title: string, p_body: string) => adminX.client.rpc("post_society_announcement", { p_society_id: socX, p_title, p_body });
    expect((await bad("ab", "Body")).error?.code).toBe("23514");
    expect((await bad("Title ok", "")).error?.code).toBe("23514");
    expect((await bad("T".repeat(121), "Body")).error?.code).toBe("23514");
    expect((await bad("Title ok", "b".repeat(4001))).error?.code).toBe("23514");
    const ok = await bad("Meeting on Friday", "Bring your boards.");
    expect(ok.error).toBeNull();
    expect(typeof ok.data).toBe("string");
    for (const [u, count] of [[m1, 1], [m2, 0], [m3, 0], [other, 0]] as const) {
      expect(await notes(u.id, "society_announcement")).toHaveLength(count);
    }
    expect((await notes(m1.id, "society_announcement"))[0].link).toBe(`/societies/${socX}`);
    // Everyone in the college can read it; clients cannot write.
    expect((await other.client.from("society_announcements").select("title").eq("society_id", socX)).data).toEqual([{ title: "Meeting on Friday" }]);
    expect((await other.client.from("society_announcements").delete().eq("society_id", socX).select("id")).data ?? []).toEqual([]);
  });

  test("college B cannot see college A societies, members or announcements", async () => {
    for (const s of [studentB, adminB]) {
      expect((await s.client.from("societies").select("id")).data ?? []).toEqual([]);
      expect((await s.client.from("society_members").select("society_id")).data ?? []).toEqual([]);
      expect((await s.client.from("society_announcements").select("id")).data ?? []).toEqual([]);
      expect((await s.client.rpc("society_member_count", { p_society_id: socX })).error?.code).toBe("42501");
      expect((await s.client.rpc("decide_join", { p_society_id: socX, p_student_id: student.id, p_accept: true })).error?.code).toBe("42501");
      expect((await s.client.rpc("post_society_announcement", { p_society_id: socX, p_title: "Hello all", p_body: "Body" })).error?.code).toBe("42501");
    }
    const { data } = await adminClient().from("societies").select("id").eq("college_id", collegeB);
    expect(data).toEqual([]);
  });

  test("society admin cannot create an event for a society they do not admin", async () => {
    const ins = (c: S, society_id: string | null) => c.client.from("events").insert(newEvent({ society_id })).select("id, society_id").single();
    expect((await ins(adminX, socY)).error?.code).toBe("42501");
    expect((await ins(adminX, null)).error?.code).toBe("42501");
    expect((await ins(adminB, socX)).error?.code).toBe("42501");
    const mine = await ins(adminX, socX);
    expect(mine.error).toBeNull();
    expect(mine.data?.society_id).toBe(socX);
    // Cannot re-point their event to another society, or clear it.
    expect((await adminX.client.from("events").update({ society_id: socY }).eq("id", mine.data!.id).select("id")).error?.code).toBe("42501");
    expect((await adminX.client.from("events").update({ society_id: null }).eq("id", mine.data!.id).select("id")).error?.code).toBe("42501");
    // College admin may use any society of the college, or none.
    expect((await ins(cAdmin, socY)).error).toBeNull();
    expect((await ins(cAdmin, null)).error).toBeNull();
    expect((await cAdmin.client.from("events").update({ society_id: socY }).eq("id", mine.data!.id).select("id")).data).toHaveLength(1);
    // But not a society of another college (not visible, so refused).
    const bSoc = await adminClient().from("societies").insert({ college_id: collegeB, name: `BSoc ${run}`, admin_id: adminB.id }).select("id").single();
    expect(bSoc.error).toBeNull();
    expect((await ins(cAdmin, bSoc.data!.id)).error?.code).toBe("42501");
  });
});
