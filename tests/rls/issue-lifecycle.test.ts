import { beforeAll, describe, expect, test } from "vitest";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";
import { createUserWithRole } from "../helpers/roles";

const run = Math.random().toString(36).slice(2, 8);
const dom = `lc-${run}.edu`;
const otherDom = `lo-${run}.edu`;
const metDom = `lm-${run}.edu`;

type U = Awaited<ReturnType<typeof createStudent>>;
let collegeA: string;
let collegeB: string;
let locA: string;
let locA2: string;
let locB: string;
let hostelDept: string;
let authHostel: U;
let head: U;
let authIT: U;
let admin: U;
let s1: U;
let s2: U;
let s3: U;
let n = 0;

const emb = (x = 0.1) => `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : x * (i % 3))).join(",")}]`;
const body = "The tap in the hostel corridor is leaking badly.";
const cls = (severity = "high", department = "Hostel") => ({
  title: "Leaking tap",
  category: "water",
  severity,
  department,
});

async function report(u: U, loc: string, classification: unknown = cls(), merge: string | null = null, text = body) {
  return u.client.rpc("submit_issue_report", {
    p_location: loc,
    p_body: text,
    p_photo_paths: [],
    p_classification: classification,
    p_embedding: emb(),
    p_merge_issue_id: merge,
  });
}
async function newStudent(): Promise<U> {
  return createStudent(`st${n++}-${run}@${dom}`);
}
async function issueOf(id: string) {
  const { data, error } = await adminClient().from("issues").select("*").eq("id", id).single();
  expect(error).toBeNull();
  return data!;
}
async function notifs(userId: string, kind: string, issueId: string) {
  const { data } = await adminClient()
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("link", `/issues/${issueId}`);
  return data ?? [];
}
/** An in_progress Hostel issue reported by `count` fresh students. */
async function makeIssue(count: number) {
  const students: U[] = [];
  let issueId = "";
  for (let i = 0; i < count; i++) {
    const s = await newStudent();
    students.push(s);
    const r = await report(s, locA, cls(), issueId || null);
    expect(r.error).toBeNull();
    issueId = r.data.issue_id;
  }
  return { issueId, students };
}
async function vote(u: U, issueId: string, fixed: boolean) {
  const r = await u.client.rpc("confirm_issue_fix", { p_issue: issueId, p_fixed: fixed });
  expect(r.error).toBeNull();
}
async function resolvePending(issueId: string) {
  const a = await authHostel.client.rpc("transition_issue", { p_issue: issueId, p_to: "in_progress" });
  expect(a.error).toBeNull();
  const b = await authHostel.client.rpc("transition_issue", { p_issue: issueId, p_to: "resolved_pending" });
  expect(b.error).toBeNull();
}

beforeAll(async () => {
  const db = adminClient();
  collegeA = await createCollege(`Lifecycle A ${run}`, dom);
  collegeB = await createCollege(`Lifecycle B ${run}`, otherDom);
  const d = await db
    .from("departments")
    .insert([
      { college_id: collegeA, name: "Hostel" },
      { college_id: collegeA, name: "IT Services" },
    ])
    .select("id, name");
  expect(d.error).toBeNull();
  hostelDept = d.data!.find((x) => x.name === "Hostel")!.id;
  const l = await db
    .from("locations")
    .insert([
      { college_id: collegeA, name: "Block A" },
      { college_id: collegeA, name: "Block B" },
      { college_id: collegeB, name: "Hall" },
    ])
    .select("id, name, college_id");
  expect(l.error).toBeNull();
  locA = l.data!.find((x) => x.name === "Block A")!.id;
  locA2 = l.data!.find((x) => x.name === "Block B")!.id;
  locB = l.data!.find((x) => x.college_id === collegeB)!.id;

  authHostel = await createUserWithRole(`ah-${run}@${dom}`, "authority", { departmentName: "Hostel" });
  head = await createUserWithRole(`hd-${run}@${dom}`, "authority", { departmentName: "Hostel", head: true });
  authIT = await createUserWithRole(`ai-${run}@${dom}`, "authority", { departmentName: "IT Services" });
  admin = await createUserWithRole(`ad-${run}@${dom}`, "college_admin");
  s1 = await newStudent();
  s2 = await newStudent();
  s3 = await newStudent();
});

describe("intake", () => {
  test("new report creates an issue with due_at from severity", async () => {
    const r = await report(s1, locA);
    expect(r.error).toBeNull();
    expect(r.data.merged).toBe(false);
    expect(r.data.needs_triage).toBe(false);
    const i = await issueOf(r.data.issue_id);
    const expected = Date.now() + 2880 * 60_000;
    expect(Math.abs(new Date(i.due_at).getTime() - expected)).toBeLessThan(5000);
    expect(i.department_id).toBe(hostelDept);
    const rec = await notifs(s1.id, "report_received", i.id);
    expect(rec).toHaveLength(1);
    expect((await notifs(authHostel.id, "issue_new", i.id))).toHaveLength(1);
    expect((await notifs(authIT.id, "issue_new", i.id))).toHaveLength(0);
  });

  test("merge raises report_count once per student", async () => {
    const a = await newStudent();
    const b = await newStudent();
    const first = await report(a, locA);
    const id = first.data.issue_id;
    expect((await report(a, locA, cls(), id)).data.merged).toBe(true);
    expect((await report(b, locA, cls(), id)).data.merged).toBe(true);
    expect((await issueOf(id)).report_count).toBe(2);
    const reps = await adminClient().from("issue_reports").select("id").eq("issue_id", id);
    expect(reps.data).toHaveLength(3);
    const ev = await adminClient().from("issue_events").select("kind").eq("issue_id", id).eq("kind", "merged");
    expect(ev.data).toHaveLength(1);
  });

  test("merge into a closed, other-location, other-college or 15-day-old issue creates a new issue", async () => {
    const db = adminClient();
    const base = (await report(await newStudent(), locA)).data.issue_id;
    const student = await newStudent();

    await db.from("issues").update({ status: "closed" }).eq("id", base);
    const closed = await report(student, locA, cls(), base);
    expect(closed.data.merged).toBe(false);
    expect(closed.data.issue_id).not.toBe(base);

    const open = (await report(await newStudent(), locA)).data.issue_id;
    const otherLoc = await report(student, locA2, cls(), open);
    expect(otherLoc.data.merged).toBe(false);

    const otherCollege = (await report(await createStudent(`ob-${n++}-${run}@${otherDom}`), locB)).data.issue_id;
    const cross = await report(student, locA, cls(), otherCollege);
    expect(cross.data.merged).toBe(false);
    expect((await issueOf(otherCollege)).report_count).toBe(1);

    const old = (await report(await newStudent(), locA)).data.issue_id;
    await db
      .from("issues")
      .update({ created_at: new Date(Date.now() - 15 * 86_400_000).toISOString() })
      .eq("id", old);
    const aged = await report(student, locA, cls(), old);
    expect(aged.data.merged).toBe(false);
  });

  test("null classification goes to the manual queue and notifies admins", async () => {
    const r = await report(await newStudent(), locA, null);
    expect(r.error).toBeNull();
    expect(r.data.needs_triage).toBe(true);
    const i = await issueOf(r.data.issue_id);
    expect(i.title).toBe("Untriaged report");
    expect(i.due_at).toBeNull();
    expect(i.department_id).toBeNull();
    expect(await notifs(admin.id, "issue_new", i.id)).toHaveLength(1);
    expect(await notifs(authHostel.id, "issue_new", i.id)).toHaveLength(0);
  });

  test("unknown department is treated as null", async () => {
    const r = await report(await newStudent(), locA, cls("high", "Nonexistent"));
    expect(r.data.needs_triage).toBe(true);
  });

  test("sixth report in 24 hours is rate_limited", async () => {
    const s = await newStudent();
    for (let i = 0; i < 5; i++) expect((await report(s, locA, cls())).error).toBeNull();
    const sixth = await report(s, locA, cls());
    expect(sixth.error?.message).toContain("rate_limited");
  });

  test("body of 9 characters is refused", async () => {
    const r = await report(await newStudent(), locA, cls(), null, "123456789");
    expect(r.error?.message).toContain("invalid_report");
    expect(r.error?.code).toBe("23514");
  });

  test("photo paths: traversal, wrong prefix, foreign and unknown paths are refused; own upload accepted", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const owner = await newStudent();
    const other = await newStudent();
    const mine = `${collegeA}/draft-${run}/mine.png`;
    const theirs = `${collegeA}/draft-${run}/theirs.png`;
    expect((await owner.client.storage.from("issue-photos").upload(mine, png, { contentType: "image/png" })).error).toBeNull();
    expect((await other.client.storage.from("issue-photos").upload(theirs, png, { contentType: "image/png" })).error).toBeNull();
    const submit = (u: U, paths: string[]) =>
      u.client.rpc("submit_issue_report", {
        p_location: locA, p_body: body, p_photo_paths: paths, p_classification: cls(),
        p_embedding: emb(), p_merge_issue_id: null,
      });
    for (const bad of [
      `${collegeB}/x/y.jpg`,
      `${collegeA}/../x`,
      `${collegeA}x/..`,
      `${collegeA}x/draft/mine.png`,
      `${collegeA}0/draft/mine.png`,
      `${collegeA}/draft-${run}/missing.png`,
      theirs,
    ]) {
      expect((await submit(owner, [bad])).error?.code).toBe("42501");
    }
    const ok = await submit(owner, [mine]);
    expect(ok.error).toBeNull();
  });

  test("classification without a title falls back to category and location", async () => {
    const r = await report(await newStudent(), locA, { category: "water", severity: "high", department: "Hostel" });
    expect(r.data.needs_triage).toBe(false);
    expect((await issueOf(r.data.issue_id)).title).toBe("Water issue at Block A");
  });

  test("report from an authority is refused", async () => {
    const r = await report(authHostel, locA);
    expect(r.error?.code).toBe("42501");
  });

  test("match_open_issues returns candidates from the callers location only", async () => {
    const s = await newStudent();
    const fresh = await adminClient().from("locations").insert({ college_id: collegeA, name: `Fresh ${run}` }).select("id").single();
    const loc = fresh.data!.id;
    const id = (await report(s, loc)).data.issue_id;
    const m = await s.client.rpc("match_open_issues", { p_location: loc, p_embedding: emb(), p_limit: 5 });
    expect(m.error).toBeNull();
    expect(m.data.map((x: { id: string }) => x.id)).toContain(id);
    const empty = await adminClient().from("locations").insert({ college_id: collegeA, name: `Empty ${run}` }).select("id").single();
    const other = await s.client.rpc("match_open_issues", { p_location: empty.data!.id, p_embedding: emb(), p_limit: 5 });
    expect(other.data).toHaveLength(0);
  });
});

describe("transitions", () => {
  test("IT authority cannot transition a Hostel issue", async () => {
    const { issueId } = await makeIssue(1);
    const r = await authIT.client.rpc("transition_issue", { p_issue: issueId, p_to: "in_progress" });
    expect(r.error?.code).toBe("42501");
  });

  test("authority cannot set closed", async () => {
    const { issueId } = await makeIssue(1);
    const r = await authHostel.client.rpc("transition_issue", { p_issue: issueId, p_to: "closed" });
    expect(r.error?.code).toBe("42501");
  });

  test("open to resolved_pending is refused", async () => {
    const { issueId } = await makeIssue(1);
    const r = await authHostel.client.rpc("transition_issue", { p_issue: issueId, p_to: "resolved_pending" });
    expect(r.error?.code).toBe("42501");
  });

  test("student cannot transition", async () => {
    const { issueId, students } = await makeIssue(1);
    const r = await students[0].client.rpc("transition_issue", { p_issue: issueId, p_to: "in_progress" });
    expect(r.error?.code).toBe("42501");
  });

  test("resolved_pending notifies every reporter", async () => {
    const { issueId, students } = await makeIssue(2);
    await resolvePending(issueId);
    const i = await issueOf(issueId);
    expect(i.status).toBe("resolved_pending");
    expect(i.confirmation_round).toBe(1);
    expect(i.resolved_pending_at).not.toBeNull();
    for (const s of students) expect(await notifs(s.id, "confirm_fix", issueId)).toHaveLength(1);
  });

  test("triage_issue refused on a triaged issue; transition refused while untriaged", async () => {
    const triaged = (await makeIssue(1)).issueId;
    const again = await admin.client.rpc("triage_issue", {
      p_issue: triaged, p_department: hostelDept, p_category: "water", p_severity: "low", p_title: "x",
    });
    expect(again.error?.code).toBe("42501");
    const untriaged = (await report(await newStudent(), locA, null)).data.issue_id;
    const t = await admin.client.rpc("transition_issue", { p_issue: untriaged, p_to: "in_progress" });
    expect(t.error?.code).toBe("42501");
  });

  test("admin can triage and the department is notified", async () => {
    const r = await report(await newStudent(), locA, null);
    const id = r.data.issue_id;
    const bad = await authHostel.client.rpc("triage_issue", {
      p_issue: id, p_department: hostelDept, p_category: "water", p_severity: "low", p_title: "x",
    });
    expect(bad.error?.code).toBe("42501");
    const ok = await admin.client.rpc("triage_issue", {
      p_issue: id, p_department: hostelDept, p_category: "water", p_severity: "low", p_title: "Tap",
    });
    expect(ok.error).toBeNull();
    const i = await issueOf(id);
    expect(i.needs_triage).toBe(false);
    expect(Math.abs(new Date(i.due_at).getTime() - (Date.now() + 10080 * 60_000))).toBeLessThan(5000);
    expect(await notifs(authHostel.id, "issue_new", id)).toHaveLength(1);
  });
});

describe("votes", () => {
  test("non-reporter vote is refused", async () => {
    const { issueId } = await makeIssue(1);
    await resolvePending(issueId);
    const r = await (await newStudent()).client.rpc("confirm_issue_fix", { p_issue: issueId, p_fixed: true });
    expect(r.error?.code).toBe("42501");
  });

  test("second vote replaces the first", async () => {
    const { issueId, students } = await makeIssue(2);
    await resolvePending(issueId);
    await vote(students[0], issueId, false);
    await vote(students[0], issueId, true);
    const v = await adminClient().from("issue_confirmations").select("fixed").eq("issue_id", issueId);
    expect(v.data).toEqual([{ fixed: true }]);
    expect((await issueOf(issueId)).status).toBe("resolved_pending");
  });

  test("2 fixed vs 1 not fixed closes", async () => {
    const { issueId, students } = await makeIssue(3);
    await resolvePending(issueId);
    await vote(students[0], issueId, true);
    await vote(students[1], issueId, false);
    expect((await issueOf(issueId)).status).toBe("resolved_pending");
    await vote(students[2], issueId, true);
    const i = await issueOf(issueId);
    expect(i.status).toBe("closed");
    expect(i.closed_at).not.toBeNull();
    expect(await notifs(students[0].id, "issue_closed", issueId)).toHaveLength(1);
  });

  test("1 fixed vs 1 not fixed reopens to in_progress with a fresh due_at", async () => {
    const { issueId, students } = await makeIssue(2);
    await resolvePending(issueId);
    await adminClient().from("issues").update({ escalation_level: 1 }).eq("id", issueId);
    await vote(students[0], issueId, true);
    await vote(students[1], issueId, false);
    const i = await issueOf(issueId);
    expect(i.status).toBe("in_progress");
    expect(i.escalation_level).toBe(0);
    expect(Math.abs(new Date(i.due_at).getTime() - (Date.now() + 2880 * 60_000))).toBeLessThan(5000);
    expect(await notifs(students[0].id, "issue_reopened", issueId)).toHaveLength(1);
  });

  test("no votes after 72h gives closed_unverified; at 71h nothing changes", async () => {
    const { issueId } = await makeIssue(1);
    await resolvePending(issueId);
    const at = new Date((await issueOf(issueId)).resolved_pending_at).getTime();
    const db = adminClient();
    const early = await db.rpc("tally_issue_closure", { p_issue: issueId, p_now: new Date(at + 71 * 3600_000).toISOString() });
    expect(early.error).toBeNull();
    expect((await issueOf(issueId)).status).toBe("resolved_pending");
    const late = await db.rpc("tally_issue_closure", { p_issue: issueId, p_now: new Date(at + 73 * 3600_000).toISOString() });
    expect(late.error).toBeNull();
    const i = await issueOf(issueId);
    expect(i.status).toBe("closed_unverified");
    expect(i.closed_at).not.toBeNull();
  });

  test("tally_issue_closure and run_issue_jobs are not callable by clients", async () => {
    const a = await s1.client.rpc("tally_issue_closure", { p_issue: locA, p_now: new Date().toISOString() });
    expect(a.error).not.toBeNull();
    const b = await admin.client.rpc("run_issue_jobs", {});
    expect(b.error).not.toBeNull();
  });
});

describe("jobs and metrics", () => {
  test("missed deadline escalates 0 to 1 to 2 and stops", async () => {
    const { issueId } = await makeIssue(1);
    const db = adminClient();
    const t = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const levels: number[] = [];
    for (const h of [100, 200, 300]) {
      const r = await db.rpc("run_issue_jobs", { p_now: t(h), p_college: collegeA });
      expect(r.error).toBeNull();
      levels.push((await issueOf(issueId)).escalation_level);
    }
    expect(levels).toEqual([1, 2, 2]);
    expect(await notifs(head.id, "issue_escalated", issueId)).toHaveLength(1);
    expect(await notifs(admin.id, "issue_escalated", issueId)).toHaveLength(1);
    const ev = await db.from("issue_events").select("id").eq("issue_id", issueId).eq("kind", "escalated");
    expect(ev.data).toHaveLength(2);
  });

  test("job tallies resolved_pending issues older than 72h", async () => {
    const { issueId } = await makeIssue(1);
    await resolvePending(issueId);
    const r = await adminClient().rpc("run_issue_jobs", {
      p_now: new Date(Date.now() + 80 * 3600_000).toISOString(),
      p_college: collegeA,
    });
    expect(r.data.tallied).toBeGreaterThanOrEqual(1);
    expect((await issueOf(issueId)).status).toBe("closed_unverified");
  });

  test("run_issue_jobs_for_my_college refused for students and authorities", async () => {
    expect((await s1.client.rpc("run_issue_jobs_for_my_college")).error?.code).toBe("42501");
    expect((await authHostel.client.rpc("run_issue_jobs_for_my_college")).error?.code).toBe("42501");
    const ok = await admin.client.rpc("run_issue_jobs_for_my_college");
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveProperty("escalated");
  });

  test("issue_metrics returns the rate from closed and closed_unverified counts", async () => {
    const db = adminClient();
    const colM = await createCollege(`Lifecycle M ${run}`, metDom);
    const mAdmin = await createUserWithRole(`ma-${run}@${metDom}`, "college_admin");
    const loc = await db.from("locations").insert({ college_id: colM, name: "Lab" }).select("id").single();
    const mk = (status: string, extra: Record<string, unknown> = {}) => ({
      college_id: colM, location_id: loc.data!.id, title: "t", status, ...extra,
    });
    const created = new Date(Date.now() - 10 * 3600_000).toISOString();
    const closedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
    const ins = await db
      .from("issues")
      .insert([
        mk("closed", { created_at: created, closed_at: closedAt }),
        mk("closed", { created_at: created, closed_at: closedAt }),
        mk("closed", { created_at: created, closed_at: closedAt }),
        mk("closed_unverified", { created_at: created, closed_at: closedAt }),
        mk("open", { created_at: new Date().toISOString(), closed_at: null }),
      ])
      .select("id");
    expect(ins.error).toBeNull();
    await db.from("issue_events").insert([
      { issue_id: ins.data![0].id, college_id: colM, kind: "escalated" },
      { issue_id: ins.data![0].id, college_id: colM, kind: "escalated" },
    ]);
    const m = await mAdmin.client.rpc("issue_metrics");
    expect(m.error).toBeNull();
    expect(Number(m.data.verified_closure_rate)).toBeCloseTo(0.75, 3);
    expect(m.data.deadline_misses).toBe(2);
    expect(m.data.open).toBe(1);
    expect(Number(m.data.median_resolution_hours)).toBeCloseTo(4, 1);
    expect((await s1.client.rpc("issue_metrics")).error?.code).toBe("42501");
  });
});

describe("anonymity", () => {
  test("no event, report or notification visible to the authority carries a student id", async () => {
    const { issueId, students } = await makeIssue(2);
    await resolvePending(issueId);
    await vote(students[0], issueId, true);
    await vote(students[1], issueId, false);
    const ids = [s1.id, s2.id, s3.id, ...students.map((s) => s.id)];
    const c = authHostel.client;
    for (const table of ["issue_events", "issue_reports", "issues", "notifications", "issue_reporters", "issue_confirmations"]) {
      const { data, error } = await c.from(table).select("*");
      expect(error).toBeNull();
      const text = JSON.stringify(data);
      for (const id of ids) expect(text).not.toContain(id);
    }
    const ev = await adminClient().from("issue_events").select("actor_role, actor_id").eq("actor_role", "student");
    for (const e of ev.data ?? []) expect(e.actor_id).toBeNull();
    // Notification text for staff never names students either.
    const staff = await adminClient().from("notifications").select("title, body").eq("user_id", authHostel.id);
    expect(JSON.stringify(staff.data)).not.toMatch(/@/);
  });
});
