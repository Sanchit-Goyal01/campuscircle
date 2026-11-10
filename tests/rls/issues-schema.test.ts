import { beforeAll, describe, expect, test } from "vitest";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";

const run = Math.random().toString(36).slice(2, 8);
const dom = `iss-${run}.edu`;
const otherDom = `iso-${run}.edu`;
const pdf = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

type U = Awaited<ReturnType<typeof createStudent>>;
let collegeA: string;
let collegeB: string;
let dept: string;
let locA: string;
let issueA: string;
let issueB: string;
let reporter: U;
let mate: U;
let outsider: U;
let authority: U;
let admin: U;
let notifId: string;

beforeAll(async () => {
  const db = adminClient();
  collegeA = await createCollege(`Issues A ${run}`, dom);
  collegeB = await createCollege(`Issues B ${run}`, otherDom);
  const d = await db.from("departments").insert({ college_id: collegeA, name: "Maintenance" }).select("id").single();
  expect(d.error).toBeNull();
  dept = d.data!.id;

  reporter = await createStudent(`rep-${run}@${dom}`);
  mate = await createStudent(`mate-${run}@${dom}`);
  outsider = await createStudent(`out-${run}@${otherDom}`);
  authority = await createUserWithRole(`auth-${run}@${dom}`, "authority", { departmentName: "Maintenance" });
  admin = await createUserWithRole(`adm-${run}@${dom}`, "college_admin");

  const l = await db.from("locations").insert({ college_id: collegeA, name: "Library" }).select("id").single();
  expect(l.error).toBeNull();
  locA = l.data!.id;
  const lb = await db.from("locations").insert({ college_id: collegeB, name: "Hall" }).select("id").single();
  const i = await db
    .from("issues")
    .insert({ college_id: collegeA, location_id: locA, department_id: dept, title: "Leak", severity: "high", category: "water" })
    .select("id")
    .single();
  expect(i.error).toBeNull();
  issueA = i.data!.id;
  const ib = await db
    .from("issues")
    .insert({ college_id: collegeB, location_id: lb.data!.id, title: "Other" })
    .select("id")
    .single();
  issueB = ib.data!.id;

  const r = await db
    .from("issue_reports")
    .insert({ issue_id: issueA, college_id: collegeA, body: "tap leaking" })
    .select("id")
    .single();
  expect(r.error).toBeNull();
  await db.from("issue_reporters").insert({ issue_id: issueA, student_id: reporter.id, college_id: collegeA, first_report_id: r.data!.id });
  await db.from("issue_events").insert({ issue_id: issueA, college_id: collegeA, kind: "reported" });
  await db.from("issue_confirmations").insert({ issue_id: issueA, student_id: reporter.id, college_id: collegeA, round: 1, fixed: true });
  const n = await db
    .from("notifications")
    .insert([
      { user_id: reporter.id, college_id: collegeA, kind: "x", title: "Mine", body: "b" },
      { user_id: mate.id, college_id: collegeA, kind: "x", title: "Theirs", body: "b" },
    ])
    .select("id,user_id");
  expect(n.error).toBeNull();
  notifId = n.data!.find((x) => x.user_id === reporter.id)!.id;
});

const count = async (u: U, table: string) => {
  const { data, error } = await u.client.from(table).select("*");
  expect(error).toBeNull();
  return data!.length;
};

describe("issue schema", () => {
  test("default sla rules exist for a new college", async () => {
    const { data } = await adminClient().from("sla_rules").select("severity,deadline_minutes").eq("college_id", collegeB);
    const m = Object.fromEntries(data!.map((x) => [x.severity, x.deadline_minutes]));
    expect(data).toHaveLength(4);
    expect(m).toEqual({ critical: 1440, high: 2880, medium: 4320, low: 10080 });
  });

  test("student of college B cannot read college A issues, events, locations", async () => {
    for (const t of ["issues", "issue_events", "locations"]) {
      const { data } = await outsider.client.from(t).select("*").eq("college_id", collegeA);
      expect(data).toHaveLength(0);
    }
    const { data } = await outsider.client.from("issues").select("id");
    expect(data!.map((x) => x.id)).toEqual([issueB]);
  });

  test("authority cannot read issue_reporters or issue_confirmations", async () => {
    expect(await count(authority, "issue_reporters")).toBe(0);
    expect(await count(authority, "issue_confirmations")).toBe(0);
  });

  test("college admin cannot read issue_reporters", async () => {
    expect(await count(admin, "issue_reporters")).toBe(0);
  });

  test("reporter reads own reporter row and own issue's reports", async () => {
    expect(await count(reporter, "issue_reporters")).toBe(1);
    expect(await count(reporter, "issue_reports")).toBe(1);
  });

  test("other student of the same college cannot read issue_reports", async () => {
    expect(await count(mate, "issue_reports")).toBe(0);
  });

  test("authority reads issue_reports of their college", async () => {
    expect(await count(authority, "issue_reports")).toBe(1);
  });

  test("student cannot insert or update issues directly", async () => {
    const ins = await reporter.client
      .from("issues")
      .insert({ college_id: collegeA, location_id: locA, title: "Forged" });
    expect(ins.error?.code).toBe("42501");
    const upd = await reporter.client.from("issues").update({ title: "Hacked" }).eq("id", issueA);
    expect(upd.error?.code).toBe("42501");
  });

  test("user reads only own notifications and can set read_at only", async () => {
    const { data } = await reporter.client.from("notifications").select("*");
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Mine");
    const bad = await reporter.client.from("notifications").update({ title: "x" }).eq("id", notifId);
    expect(bad.error?.code).toBe("42501");
    const ok = await reporter.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notifId)
      .select("read_at");
    expect(ok.error).toBeNull();
    expect(ok.data![0].read_at).not.toBeNull();
  });

  test("college admin manages locations and sla minutes; student cannot", async () => {
    const add = await admin.client.from("locations").insert({ college_id: collegeA, name: "Gym" });
    expect(add.error).toBeNull();
    const stud = await reporter.client.from("locations").insert({ college_id: collegeA, name: "Pool" });
    expect(stud.error?.code).toBe("42501");
    const sla = await admin.client
      .from("sla_rules")
      .update({ deadline_minutes: 60 })
      .eq("college_id", collegeA)
      .eq("severity", "critical")
      .select();
    expect(sla.error).toBeNull();
    expect(sla.data).toHaveLength(1);
  });

  test("student uploads to own college folder; upload to another college folder is refused", async () => {
    const ok = await reporter.client.storage.from("issue-photos").upload(`${collegeA}/${issueA}/a.png`, pdf, { contentType: "image/png" });
    expect(ok.error).toBeNull();
    const bad = await reporter.client.storage.from("issue-photos").upload(`${collegeB}/${issueB}/a.png`, pdf, { contentType: "image/png" });
    expect(bad.error).not.toBeNull();
  });

  test("authority can download a photo; another student cannot", async () => {
    const path = `${collegeA}/${issueA}/b.png`;
    const up = await reporter.client.storage.from("issue-photos").upload(path, pdf, { contentType: "image/png" });
    expect(up.error).toBeNull();
    const a = await authority.client.storage.from("issue-photos").download(path);
    expect(a.error).toBeNull();
    const m = await mate.client.storage.from("issue-photos").download(path);
    expect(m.error).not.toBeNull();
  });
});
