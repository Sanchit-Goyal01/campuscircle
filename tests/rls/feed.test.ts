import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserWithRole } from "../helpers/roles";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let author: S;
let reader: S;
let studentB: S;
let spammer: S;
let admin: S;

beforeAll(async () => {
  collegeA = await createCollege(`Feed A ${run}`, `fa-${run}.edu`);
  await createCollege(`Feed B ${run}`, `fb-${run}.edu`);
  author = await createStudent(`au-${run}@fa-${run}.edu`);
  reader = await createStudent(`re-${run}@fa-${run}.edu`);
  spammer = await createStudent(`sp-${run}@fa-${run}.edu`);
  studentB = await createStudent(`sb-${run}@fb-${run}.edu`);
  admin = await createUserWithRole(`ad-${run}@fa-${run}.edu`, "college_admin");
});
afterAll(() => undefined);

const post = async (s: S, body: string, path: string | null = null) =>
  s.client.rpc("create_post", { p_body: body, p_photo_path: path });

describe("feed", { timeout: 60_000 }, () => {
  test("student creates a post and a college B student cannot read it", async () => {
    const r = await post(author, "Hello campus");
    expect(r.error).toBeNull();
    const id = r.data as string;
    const mine = await reader.client.from("posts").select("id, college_id, author_id").eq("id", id);
    expect(mine.data).toEqual([{ id, college_id: collegeA, author_id: author.id }]);
    expect((await studentB.client.from("posts").select("id").eq("id", id)).data).toEqual([]);
    expect((await studentB.client.from("posts").select("id")).data?.some((p) => p.id === id)).toBe(false);
    // comments and likes stay inside the college
    const c = await reader.client.from("post_comments").insert({ post_id: id, body: "Nice" });
    expect(c.error).toBeNull();
    expect((await studentB.client.from("post_comments").insert({ post_id: id, body: "Hi" })).error).not.toBeNull();
    expect((await studentB.client.from("post_comments").select("id").eq("post_id", id)).data).toEqual([]);
    expect((await studentB.client.from("post_likes").insert({ post_id: id })).error).not.toBeNull();
    // likes: own row only, once
    expect((await reader.client.from("post_likes").insert({ post_id: id })).error).toBeNull();
    expect((await reader.client.from("post_likes").insert({ post_id: id })).error).not.toBeNull();
    expect((await reader.client.from("post_likes").insert({ post_id: id, user_id: author.id })).error?.code).toBe("42501");
    // delete: only the author
    expect((await reader.client.from("posts").delete().eq("id", id).select("id")).data).toEqual([]);
    expect((await author.client.from("posts").delete().eq("id", id).select("id")).data).toHaveLength(1);
  });

  test("21st post in 24 hours is refused with too_many_posts", async () => {
    for (let i = 0; i < 20; i++) expect((await post(spammer, `post ${i}`)).error).toBeNull();
    const r = await post(spammer, "one too many");
    expect(r.error?.code).toBe("P0001");
    expect(r.error?.message).toBe("too_many_posts");
  });

  test("student cannot insert into posts directly or set hidden_at", async () => {
    const ins = await author.client
      .from("posts")
      .insert({ college_id: collegeA, author_id: author.id, body: "direct" });
    expect(ins.error?.code).toBe("42501");
    const id = (await post(author, "to hide")).data as string;
    const upd = await author.client.from("posts").update({ hidden_at: new Date().toISOString() }).eq("id", id);
    expect(upd.error?.code).toBe("42501");
    expect((await post(author, "")).error?.code).toBe("23514");
    expect((await post(author, "x".repeat(2001))).error?.code).toBe("23514");
  });

  test("hidden post is invisible to another student but visible to its author and a college admin", async () => {
    const id = (await post(author, "hide me")).data as string;
    const upd = await adminClient().from("posts").update({ hidden_at: new Date().toISOString() }).eq("id", id);
    expect(upd.error).toBeNull();
    expect((await reader.client.from("posts").select("id").eq("id", id)).data).toEqual([]);
    expect((await author.client.from("posts").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await admin.client.from("posts").select("id").eq("id", id)).data).toHaveLength(1);
    // a hidden post cannot be liked or reported by others
    expect((await reader.client.from("post_likes").insert({ post_id: id })).error).not.toBeNull();
    expect((await reader.client.rpc("report_post", { p_post_id: id, p_reason: "spam spam" })).error?.code).toBe("42501");
  });

  test("comments on a hidden post are invisible to other students", async () => {
    const id = (await post(author, "soon hidden")).data as string;
    expect((await reader.client.from("post_comments").insert({ post_id: id, body: "first" })).error).toBeNull();
    await adminClient().from("posts").update({ hidden_at: new Date().toISOString() }).eq("id", id);
    expect((await reader.client.from("post_comments").select("id").eq("post_id", id)).data).toEqual([]);
    expect((await author.client.from("post_comments").select("id").eq("post_id", id)).data).toHaveLength(1);
    expect((await reader.client.from("post_comments").insert({ post_id: id, body: "again" })).error).not.toBeNull();
  });

  test("student cannot report own post; second report is refused", async () => {
    const id = (await post(author, "report target")).data as string;
    expect((await author.client.rpc("report_post", { p_post_id: id, p_reason: "my own" })).error?.code).toBe("42501");
    expect((await reader.client.rpc("report_post", { p_post_id: id, p_reason: "spam spam" })).error).toBeNull();
    const dup = await reader.client.rpc("report_post", { p_post_id: id, p_reason: "spam again" });
    expect(dup.error?.code).toBe("P0001");
    expect(dup.error?.message).toBe("already_reported");
    expect((await studentB.client.rpc("report_post", { p_post_id: id, p_reason: "spam spam" })).error?.code).toBe("42501");
    expect((await reader.client.rpc("report_post", { p_post_id: id, p_reason: "x" })).error).not.toBeNull();
  });

  test("a student can report at most 20 posts per 24 hours", async () => {
    const reporter2 = await createStudent(`rc-${run}@fa-${run}.edu`);
    const writer = await createStudent(`wr-${run}@fa-${run}.edu`);
    const rows = Array.from({ length: 21 }, (_, i) => ({ college_id: collegeA, author_id: writer.id, body: `cap ${run} ${i}` }));
    const { data, error } = await adminClient().from("posts").insert(rows).select("id");
    expect(error).toBeNull();
    const ids = data!.map((r) => r.id as string);
    for (const id of ids.slice(0, 20)) {
      expect((await reporter2.client.rpc("report_post", { p_post_id: id, p_reason: "report me" })).error).toBeNull();
    }
    const over = await reporter2.client.rpc("report_post", { p_post_id: ids[20], p_reason: "report me" });
    expect(over.error?.code).toBe("P0001");
    expect(over.error?.message).toBe("too_many_reports");
    // Another student is not affected.
    expect((await reader.client.rpc("report_post", { p_post_id: ids[20], p_reason: "report me" })).error).toBeNull();
  });

  test("reporter sees own report; another student does not", async () => {
    const id = (await post(author, "reported post")).data as string;
    await reader.client.rpc("report_post", { p_post_id: id, p_reason: "offensive" });
    expect((await reader.client.from("post_reports").select("reason").eq("post_id", id)).data).toEqual([{ reason: "offensive" }]);
    expect((await spammer.client.from("post_reports").select("id").eq("post_id", id)).data).toEqual([]);
    expect((await author.client.from("post_reports").select("id").eq("post_id", id)).data).toEqual([]);
    // Admins have no direct read of reports (reporter identity); they use reported_posts_queue.
    expect((await admin.client.from("post_reports").select("id").eq("post_id", id)).data ?? []).toEqual([]);
    expect(((await admin.client.rpc("reported_posts_queue", {})).data as any[]).some((r) => r.post_id === id)).toBe(true);
    expect((await reader.client.from("post_reports").update({ status: "dismissed" }).eq("post_id", id)).error?.code).toBe("42501");
    expect((await reader.client.from("post_reports").insert({ post_id: id, reason: "abc" })).error?.code).toBe("42501");
  });

  test("photo_path outside the author prefix or with .. is refused", async () => {
    const mine = `${collegeA}/${author.id}`;
    expect((await post(author, "ok photo", `${mine}/${crypto.randomUUID()}.jpg`)).error).toBeNull();
    for (const bad of [
      `${collegeA}/${reader.id}/a.jpg`,
      `${mine}/../x.jpg`,
      `${mine}/..`,
      `${mine}/a/b.jpg`,
      `${mine}/`,
      "elsewhere/a.jpg",
    ]) {
      expect((await post(author, "bad photo", bad)).error?.code, bad).toBe("23514");
    }
  });

  test("post photos: hidden-post and unattached photos are unreadable to other students", async () => {
    const bytes = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    const up = async (name: string) => {
      const path = `${collegeA}/${author.id}/${name}.jpg`;
      const r = await author.client.storage.from("post-photos").upload(path, bytes, { contentType: "image/jpeg" });
      expect(r.error).toBeNull();
      return path;
    };
    const attached = await up(crypto.randomUUID());
    const hiddenPath = await up(crypto.randomUUID());
    const loose = await up(crypto.randomUUID());
    const shown = (await post(author, "with photo", attached)).data as string;
    const hid = (await post(author, "hidden photo", hiddenPath)).data as string;
    expect(shown).toBeTruthy();
    await adminClient().from("posts").update({ hidden_at: new Date().toISOString() }).eq("id", hid);
    const bucket = (s: S) => s.client.storage.from("post-photos");
    // attached to a visible post: same college reads it
    expect((await bucket(reader).download(attached)).error).toBeNull();
    // hidden post's photo: not for another student, still for its author
    expect((await bucket(reader).createSignedUrl(hiddenPath, 60)).error).not.toBeNull();
    expect((await bucket(reader).download(hiddenPath)).error).not.toBeNull();
    expect((await bucket(author).download(hiddenPath)).error).toBeNull();
    // uploaded but never attached: owner only
    expect((await bucket(reader).download(loose)).error).not.toBeNull();
    expect((await bucket(reader).createSignedUrl(loose, 60)).error).not.toBeNull();
    expect((await bucket(author).download(loose)).error).toBeNull();
    // other college never
    expect((await bucket(studentB).download(attached)).error).not.toBeNull();
  });
});
