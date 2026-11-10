import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";
import type { ToolContext } from "../../src/agent/types";

const session = vi.hoisted(() => ({ ctx: null as ToolContext | null }));
vi.mock("@/lib/supabase/server", () => ({ getToolContext: async () => session.ctx }));

import { POST } from "../../src/app/api/issues/photos/route";

const tag = Math.random().toString(36).slice(2, 8);
const dom = `ip-${tag}.edu`;
let college: string;
let student: { id: string; client: SupabaseClient };
let authority: { id: string; client: SupabaseClient };

const jpegWithExif = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#abc" } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } })
    .toBuffer();

const upload = (parts: { data: BlobPart; type: string; name?: string }[]) => {
  const form = new FormData();
  parts.forEach((p, i) => form.append("photos", new File([p.data], p.name ?? `p${i}`, { type: p.type })));
  return POST(new Request("http://test/api/issues/photos", { method: "POST", body: form }));
};

function deepContains(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}

beforeAll(async () => {
  college = await createCollege(`Photos College ${tag}`, dom);
  const dept = await adminClient().from("departments").insert({ college_id: college, name: "Hostel" });
  expect(dept.error).toBeNull();
  student = await createStudent(`s-${tag}@${dom}`);
  authority = await createUserWithRole(`a-${tag}@${dom}`, "authority", { departmentName: "Hostel" });
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  session.ctx = { db: student.client, userId: student.id, collegeId: college, role: "student" };
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/issues/photos", () => {
  test("uploaded photo is stored without EXIF under the college folder", async () => {
    const res = await upload([{ data: new Uint8Array(await jpegWithExif()), type: "image/jpeg" }]);
    expect(res.status).toBe(200);
    const { paths } = (await res.json()) as { paths: string[] };
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(new RegExp(`^${college}/[0-9a-f-]{36}\\.jpg$`));

    const { data, error } = await student.client.storage.from("issue-photos").download(paths[0]);
    expect(error).toBeNull();
    const meta = await sharp(Buffer.from(await data!.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  test("fourth photo is refused", async () => {
    const img = new Uint8Array(await jpegWithExif());
    const res = await upload(Array.from({ length: 4 }, () => ({ data: img, type: "image/jpeg" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("At most 3 photos");
  });

  test("text/plain is refused", async () => {
    const res = await upload([{ data: "hello", type: "text/plain" }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Photos must be JPEG, PNG or WebP");
  });

  test("an undecodable image is refused and nothing is stored", async () => {
    const res = await upload([{ data: "not really a jpeg", type: "image/jpeg" }]);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });

  test("signed out is 401", async () => {
    session.ctx = null;
    expect((await upload([{ data: "x", type: "image/jpeg" }])).status).toBe(401);
  });

  test("an authority of the college can list and inspect photos without seeing the uploader id", async () => {
    const res = await upload([{ data: new Uint8Array(await jpegWithExif()), type: "image/jpeg" }]);
    const { paths } = (await res.json()) as { paths: string[] };

    const listed = await authority.client.storage.from("issue-photos").list(college);
    expect(listed.error).toBeNull();
    expect(listed.data!.length).toBeGreaterThan(0);
    expect(deepContains(listed.data, student.id)).toBe(false);

    const info = await authority.client.storage.from("issue-photos").info(paths[0]);
    expect(info.error).toBeNull();
    expect(info.data).toBeTruthy();
    expect(deepContains(info.data, student.id)).toBe(false);

  });
});
