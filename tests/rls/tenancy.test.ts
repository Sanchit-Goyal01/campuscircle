import { beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createCollege,
  createStudent,
  TEST_PASSWORD,
} from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const domA = `a-${run}.edu`;
const domB = `b-${run}.edu`;
let collegeA: string;
let collegeB: string;

beforeAll(async () => {
  collegeA = await createCollege(`College A ${run}`, domA);
  collegeB = await createCollege(`College B ${run}`, domB);
});

describe("tenancy", () => {
  test("student reads profiles in own college only", async () => {
    const a = await createStudent(`a1-${run}@${domA}`);
    const a2 = await createStudent(`a2-${run}@${domA}`);
    const b = await createStudent(`b1-${run}@${domB}`);
    const { data, error } = await a.client.from("profiles").select("id, college_id");
    expect(error).toBeNull();
    const ids = data!.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(a2.id);
    expect(ids).not.toContain(b.id);
    expect(data!.every((r) => r.college_id === collegeA)).toBe(true);
  });

  test("signup with unlisted domain is refused", async () => {
    const email = `x-${run}@unlisted-${run}.edu`;
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: TEST_PASSWORD,
    });
    expect(error).not.toBeNull();
    console.log("unlisted signup error:", error?.status, error?.code, error?.message);
    expect(data.user).toBeNull();
    const admin = adminClient();
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const found = users.users.find((u) => u.email === email);
    expect(found).toBeUndefined();
    const { data: rows } = await admin.from("profiles").select("id").eq("full_name", email);
    expect(rows).toEqual([]);
  });

  test("signup domain match ignores case", async () => {
    const email = `Ana-${run}@${domA.toUpperCase()}`;
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    const { data: prof } = await adminClient()
      .from("profiles")
      .select("college_id")
      .eq("id", data.user!.id)
      .single();
    expect(prof!.college_id).toBe(collegeA);
  });

  test("student cannot change own role", async () => {
    const s = await createStudent(`r-${run}@${domA}`);
    const { error } = await s.client
      .from("profiles")
      .update({ role: "college_admin" })
      .eq("id", s.id);
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("profiles").select("role").eq("id", s.id).single();
    expect(data!.role).toBe("student");
  });

  test("student cannot change own college_id", async () => {
    const s = await createStudent(`c-${run}@${domA}`);
    const { error } = await s.client
      .from("profiles")
      .update({ college_id: collegeB })
      .eq("id", s.id);
    expect(error).not.toBeNull();
    const { data } = await adminClient()
      .from("profiles")
      .select("college_id")
      .eq("id", s.id)
      .single();
    expect(data!.college_id).toBe(collegeA);
  });

  test("student can update own bio and skills", async () => {
    const s = await createStudent(`u-${run}@${domA}`);
    const { data, error } = await s.client
      .from("profiles")
      .update({ bio: "hello", skills: ["sql", "ts"] })
      .eq("id", s.id)
      .select("bio, skills");
    expect(error).toBeNull();
    expect(data).toEqual([{ bio: "hello", skills: ["sql", "ts"] }]);
  });

  test("student cannot update another profile", async () => {
    const s = await createStudent(`o1-${run}@${domA}`);
    const other = await createStudent(`o2-${run}@${domA}`);
    const { data, error } = await s.client
      .from("profiles")
      .update({ bio: "pwned" })
      .eq("id", other.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: row } = await adminClient()
      .from("profiles")
      .select("bio")
      .eq("id", other.id)
      .single();
    expect(row!.bio).not.toBe("pwned");
  });
});
