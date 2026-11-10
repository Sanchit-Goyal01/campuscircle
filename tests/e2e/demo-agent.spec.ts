import { expect, test } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";
const COLLEGE = "00000000-0000-0000-0000-00000000a001";

// No password user lives in seed.sql, so this creates the demo student: college a001
// (demo-iot.edu), weak in DBMS (50 against 90 in Data Structures).
async function createDemoStudent(page: import("@playwright/test").Page) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `Demo ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`demo${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

  const db = adminClient();
  const { data: profile, error } = await db.from("profiles").select("id, college_id").eq("full_name", name).single();
  if (error) throw error;
  expect(profile.college_id).toBe(COLLEGE);
  // Other specs leave DBMS mentors behind; find_mentor returns the first match, so the
  // demo needs the seeded mentor to be the only one.
  const { data: priya, error: pe } = await db
    .from("profiles")
    .select("id")
    .eq("college_id", COLLEGE)
    .eq("full_name", "Priya Sharma")
    .single();
  if (pe) throw pe;
  const { error: me } = await db.from("profiles").update({ is_mentor: false }).eq("college_id", COLLEGE).neq("id", priya.id);
  if (me) throw me;
  const { data: subjects, error: se } = await db
    .from("subjects")
    .select("id, name")
    .eq("college_id", COLLEGE)
    .in("name", ["DBMS", "Data Structures"]);
  if (se) throw se;
  const subjectId = (n: string) => subjects!.find((s) => s.name === n)!.id as string;
  const { error: re } = await db.from("subject_results").insert([
    { student_id: profile.id, college_id: COLLEGE, subject_id: subjectId("Data Structures"), semester: 4, marks: 90 },
    { student_id: profile.id, college_id: COLLEGE, subject_id: subjectId("DBMS"), semester: 4, marks: 50 },
  ]);
  if (re) throw re;
}

test("demo: weak in DBMS, exam in 10 days -> tools, two approvals, plan and mentor request", async ({ page }) => {
  await createDemoStudent(page);

  await page.getByLabel("Ask CampusCircle").fill("I'm weak in DBMS and my exam is in 10 days.");
  await page.getByRole("button", { name: "Send" }).click();

  const trace = page.getByRole("list", { name: "What the assistant did" });
  for (const tool of [
    "get_marks",
    "get_weak_subjects",
    "get_past_papers",
    "search_notes",
    "find_mentor",
    "search_listings",
    "create_study_plan",
    "request_mentorship",
  ]) {
    await expect(trace.locator("code.trace-tool", { hasText: new RegExp(`^${tool}$`) })).toBeVisible({ timeout: 45_000 });
  }
  await expect(page.locator(".turn-reply").getByText(/Approve the study plan and the mentor request to go ahead\./)).toBeVisible();

  const slips = page.getByRole("region", { name: /Approval request/ });
  await expect(slips).toHaveCount(2);
  const plan = slips.filter({ hasText: "DBMS exam revision plan" });
  const mentor = slips.filter({ hasText: "Priya Sharma" });
  await expect(mentor).toHaveCount(1);
  await expect(mentor.getByRole("heading", { name: "Ask a mentor for help" })).toBeVisible();
  await expect(mentor).toContainText("I am weak in DBMS and my exam is in 10 days. Could you help me revise?");
  // The card names the mentor; it never shows a raw id.
  await expect(mentor).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await expect(mentor).not.toContainText("mentor_id");
  await plan.getByRole("button", { name: "Approve" }).click();
  await expect(plan.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
  await mentor.getByRole("button", { name: "Approve" }).click();
  await expect(mentor.getByText("This action is done.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/academics/plans");
  const saved = page.getByRole("region", { name: "DBMS exam revision plan" });
  await expect(saved.getByText(/Revise DBMS normalization/)).toBeVisible();

  await page.goto("/mentorship");
  const outgoing = page.getByRole("region", { name: "Your requests" });
  const row = outgoing.getByRole("listitem").filter({ hasText: "Priya Sharma" });
  await expect(row).toContainText("DBMS");
  await expect(row).toContainText("I am weak in DBMS and my exam is in 10 days. Could you help me revise?");
});
