import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";
import { reportedPosts } from "../../src/modules/admin/queries";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let admin: S;
let adminB: S;
let student: S;
let author: S;
let reporter: S;
let studentB: S;

beforeAll(async () => {
  await createCollege(`Adm A ${run}`, `ma-${run}.edu`);
  await createCollege(`Adm B ${run}`, `mb-${run}.edu`);
  admin = await createUserWithRole(`ad-${run}@ma-${run}.edu`, "college_admin");
  adminB = await createUserWithRole(`ab-${run}@mb-${run}.edu`, "college_admin");
  student = await createStudent(`st-${run}@ma-${run}.edu`);
  author = await createStudent(`au-${run}@ma-${run}.edu`);
  reporter = await createStudent(`rp-${run}@ma-${run}.edu`);
  studentB = await createStudent(`sb-${run}@mb-${run}.edu`);
});

const verified = async (id: string) =>
  (await adminClient().from("profiles").select("verified").eq("id", id).single()).data?.verified;
const mkPost = async (body: string) => (await author.client.rpc("create_post", { p_body: body })).data as string;

describe("college admin", { timeout: 60_000 }, () => {
  test("college admin verifies a student; a student cannot verify anyone or update verified directly", async () => {
    expect(await verified(student.id)).toBe(false);
    expect((await student.client.rpc("set_student_verified", { p_profile_id: author.id, p_verified: true })).error?.code).toBe("42501");
    expect((await student.client.rpc("set_student_verified", { p_profile_id: student.id, p_verified: true })).error?.code).toBe("42501");
    expect((await student.client.from("profiles").update({ verified: true }).eq("id", student.id)).error?.code).toBe("42501");
    expect(await verified(student.id)).toBe(false);
    expect((await admin.client.rpc("set_student_verified", { p_profile_id: student.id, p_verified: true })).error).toBeNull();
    expect(await verified(student.id)).toBe(true);
    expect((await admin.client.rpc("set_student_verified", { p_profile_id: student.id, p_verified: false })).error).toBeNull();
    expect(await verified(student.id)).toBe(false);
  });

  test("college admin of college B cannot verify or moderate college A", async () => {
    expect((await adminB.client.rpc("set_student_verified", { p_profile_id: student.id, p_verified: true })).error?.code).toBe("42501");
    expect(await verified(student.id)).toBe(false);
    const id = await mkPost(`b-attempt ${run}`);
    expect((await adminB.client.rpc("moderate_post", { p_post_id: id, p_action: "hide" })).error?.code).toBe("42501");
    expect((await student.client.rpc("moderate_post", { p_post_id: id, p_action: "hide" })).error?.code).toBe("42501");
    const { data } = await adminClient().from("posts").select("hidden_at").eq("id", id).single();
    expect(data?.hidden_at).toBeNull();
    expect((await adminB.client.from("college_announcements").insert({ title: "Nope", body: "x", author_id: adminB.id, college_id: (await adminClient().from("profiles").select("college_id").eq("id", student.id).single()).data!.college_id })).error).not.toBeNull();
  });

  test("hide marks reports actioned, hides the post and notifies the author", async () => {
    const id = await mkPost(`to hide ${run}`);
    expect((await reporter.client.rpc("report_post", { p_post_id: id, p_reason: "spam spam" })).error).toBeNull();
    expect((await student.client.rpc("report_post", { p_post_id: id, p_reason: "also spam" })).error).toBeNull();
    expect((await admin.client.rpc("moderate_post", { p_post_id: id, p_action: "bogus" })).error).not.toBeNull();
    expect((await admin.client.rpc("moderate_post", { p_post_id: id, p_action: "hide" })).error).toBeNull();
    const a = adminClient();
    const { data: p } = await a.from("posts").select("hidden_at, hidden_by").eq("id", id).single();
    expect(p?.hidden_at).not.toBeNull();
    expect(p?.hidden_by).toBe(admin.id);
    const { data: r } = await a.from("post_reports").select("status").eq("post_id", id);
    expect(r?.map((x) => x.status)).toEqual(["actioned", "actioned"]);
    const { data: n } = await a.from("notifications").select("link, kind").eq("user_id", author.id).eq("kind", "post_hidden");
    expect(n).toEqual([{ link: `/feed/${id}`, kind: "post_hidden" }]);
    // another student no longer sees it; the author and admin do
    expect((await reporter.client.from("posts").select("id").eq("id", id)).data).toEqual([]);
    expect((await author.client.from("posts").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await admin.client.from("posts").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await reportedPosts(admin.client)).some((x) => x.id === id)).toBe(false);
  });

  test("dismiss leaves the post visible and clears it from the queue", async () => {
    const id = await mkPost(`to dismiss ${run}`);
    expect((await reporter.client.rpc("report_post", { p_post_id: id, p_reason: "not nice" })).error).toBeNull();
    expect((await reportedPosts(admin.client)).some((x) => x.id === id)).toBe(true);
    expect((await admin.client.rpc("moderate_post", { p_post_id: id, p_action: "dismiss" })).error).toBeNull();
    const a = adminClient();
    expect((await a.from("posts").select("hidden_at").eq("id", id).single()).data?.hidden_at).toBeNull();
    expect((await a.from("post_reports").select("status").eq("post_id", id)).data).toEqual([{ status: "dismissed" }]);
    expect((await reporter.client.from("posts").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await reportedPosts(admin.client)).some((x) => x.id === id)).toBe(false);
  });

  test("reportedPosts exposes no reporter ids", async () => {
    const id = await mkPost(`queue ${run}`);
    await reporter.client.rpc("report_post", { p_post_id: id, p_reason: "rude words" });
    const rows = await reportedPosts(admin.client);
    const row = rows.find((x) => x.id === id);
    expect(row).toMatchObject({ body: `queue ${run}`, report_count: 1, reasons: ["rude words"] });
    expect(row?.author_name).toContain(`au-${run}`);
    const json = JSON.stringify(rows);
    expect(json).not.toContain(reporter.id);
    expect(json).not.toContain(`rp-${run}`);
    // other colleges see nothing
    expect((await reportedPosts(adminB.client)).some((x) => x.id === id)).toBe(false);
  });

  test("student cannot insert a college announcement", async () => {
    const { data: prof } = await adminClient().from("profiles").select("college_id").eq("id", student.id).single();
    const row = { college_id: prof!.college_id, author_id: student.id, title: "Hello all", body: "Body" };
    expect((await student.client.from("college_announcements").insert(row)).error?.code).toBe("42501");
    // admin: own author id only, and reads stay in the college
    expect((await admin.client.from("college_announcements").insert({ ...row, author_id: student.id })).error).not.toBeNull();
    expect((await admin.client.from("college_announcements").insert({ ...row, author_id: admin.id, title: "Hi" })).error).not.toBeNull();
    const ok = await admin.client.from("college_announcements").insert({ ...row, author_id: admin.id }).select("id").single();
    expect(ok.error).toBeNull();
    expect((await student.client.from("college_announcements").select("id").eq("id", ok.data!.id)).data).toHaveLength(1);
    expect((await studentB.client.from("college_announcements").select("id").eq("id", ok.data!.id)).data).toEqual([]);
    expect((await student.client.from("college_announcements").delete().eq("id", ok.data!.id).select("id")).data ?? []).toEqual([]);
    expect((await adminB.client.from("college_announcements").delete().eq("id", ok.data!.id).select("id")).data ?? []).toEqual([]);
    expect((await admin.client.from("college_announcements").delete().eq("id", ok.data!.id).select("id")).data).toHaveLength(1);
  });
});
