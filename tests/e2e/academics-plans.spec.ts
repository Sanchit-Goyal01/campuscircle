import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";
const COLLEGE = "00000000-0000-0000-0000-00000000a001";

async function signUp(page: Page) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `Plans ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`pl${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  const { data, error } = await adminClient().from("profiles").select("id").eq("full_name", name).single();
  if (error) throw error;
  return data.id as string;
}

const isoDaysFromNow = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function seedPlan(studentId: string, items: { due_on: string; task: string }[]) {
  const db = adminClient();
  const { data, error } = await db
    .from("study_plans")
    .insert({ student_id: studentId, college_id: COLLEGE, title: "Seeded plan" })
    .select("id")
    .single();
  if (error) throw error;
  const { error: itemError } = await db
    .from("study_plan_items")
    .insert(items.map((i) => ({ ...i, plan_id: data.id, college_id: COLLEGE })));
  if (itemError) throw itemError;
}

const itemRow = (page: Page, task: string) => page.getByRole("listitem").filter({ hasText: task });

test("plan approved through the agent appears on the plans page", async ({ page }) => {
  await signUp(page);
  await page.getByLabel("Ask CampusCircle").fill("make me a revision plan");
  await page.getByRole("button", { name: "Send" }).click();
  const slip = page.getByRole("region", { name: /Approval request/ });
  await slip.getByRole("button", { name: "Approve" }).click();
  await expect(slip.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Study plans" }).click();
  await expect(page).toHaveURL(/\/academics\/plans$/);
  const plan = page.getByRole("region", { name: "Semester revision plan" });
  await expect(plan.getByText(/Revise algorithms/)).toBeVisible();
  await expect(plan.getByText(/Practise past papers/)).toBeVisible();
  await expect(plan.getByText(/Take a mock test/)).toBeVisible();
});

test("student ticks an item done", async ({ page }) => {
  const id = await signUp(page);
  await seedPlan(id, [
    { due_on: isoDaysFromNow(2), task: "Read chapter 4" },
    { due_on: isoDaysFromNow(3), task: "Solve exercises" },
  ]);
  await page.goto("/academics/plans");
  await page.getByRole("button", { name: "Mark done: Read chapter 4" }).click();
  await expect(page.getByRole("button", { name: "Mark not done: Read chapter 4" })).toBeVisible();
  await expect(itemRow(page, "Read chapter 4").locator("strong", { hasText: "Done" })).toBeVisible();
  await expect(itemRow(page, "Solve exercises").locator("strong", { hasText: "Done" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Mark not done: Read chapter 4" })).toBeVisible();
});

test("student marks an item missed and sees new dates", async ({ page }) => {
  const id = await signUp(page);
  const later = isoDaysFromNow(6);
  const old = isoDaysFromNow(-3);
  await seedPlan(id, [
    { due_on: old, task: "Missed chapter" },
    { due_on: later, task: "Later chapter" },
  ]);
  await page.goto("/academics/plans");
  await expect(itemRow(page, "Missed chapter").getByText("Overdue")).toBeVisible();
  await page.getByRole("button", { name: "Mark missed: Missed chapter" }).click();

  // The page uses AGENT_TIMEZONE, which can be a day ahead of UTC, so tomorrow is +1 or +2.
  const missed = itemRow(page, "Missed chapter");
  await expect(missed.getByText(new RegExp(`due (${isoDaysFromNow(1)}|${isoDaysFromNow(2)})`))).toBeVisible();
  await expect(missed.getByText("Overdue")).toHaveCount(0);
  await expect(itemRow(page, "Later chapter").getByText(new RegExp(`due ${isoDaysFromNow(7)}`))).toBeVisible();
});
