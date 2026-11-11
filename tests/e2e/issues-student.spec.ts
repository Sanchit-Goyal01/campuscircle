import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createUserWithRole } from "../helpers/roles";
import { adminClient } from "../helpers/supabase";

// Filing a report classifies and embeds the text, which can take a while on a cold dev server.
const slow = expect.configure({ timeout: 25_000 });
const PASSWORD = "e2e-password-123!";
const COLLEGE = "00000000-0000-0000-0000-00000000a001";
const REPORT = "The water cooler on the second floor corridor is leaking all over the floor.";
const WARNING =
  "Your name is never shown to staff. Details like your room number can still identify you. A short title of your report is shown to all students on the campus status page, so put names and room numbers in the description only; staff alone read the description.";

const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();

async function signUp(page: Page) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `Issues ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`is${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  const { data, error } = await adminClient().from("profiles").select("id").eq("full_name", name).single();
  if (error) throw error;
  return data.id as string;
}

async function report(page: Page, withPhoto = false) {
  await page.goto("/issues");
  await page.getByLabel("Location").selectOption({ label: "Hostel Block A" });
  await page.getByLabel("What is the problem?").fill(REPORT);
  if (withPhoto) {
    await page.getByLabel("Photos").setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: await png() });
  }
  await page.getByRole("button", { name: "Send report" }).click();
}

test.beforeEach(async () => {
  // Start each test with no issues so merges only see this test's reports.
  const { error } = await adminClient().from("issues").delete().eq("college_id", COLLEGE);
  if (error) throw error;
});

test("student reports a water problem with a photo and sees it routed to Hostel", async ({ page }) => {
  await signUp(page);
  await report(page, true);
  await slow(page.getByText("Report received. It has been sent to the Hostel team.")).toBeVisible();
  const { data } = await adminClient().from("issue_reports").select("photo_paths").eq("college_id", COLLEGE).single();
  expect(data?.photo_paths).toHaveLength(1);
  await expect(page.getByRole("link", { name: /Water cooler not working/ })).toBeVisible();
});

test("second student's similar report merges and shows 2 reporters", async ({ page, browser, baseURL }) => {
  await signUp(page);
  await report(page);
  await slow(page.getByText("Report received. It has been sent to the Hostel team.")).toBeVisible();

  const ctx = await browser.newContext({ baseURL });
  const second = await ctx.newPage();
  await signUp(second);
  await report(second);
  await slow(second.getByText("Added to an existing report. 2 students have reported this.")).toBeVisible();
  await ctx.close();
});

test("resolved_pending shows vote buttons to a reporter and records the vote", async ({ page }) => {
  await signUp(page);
  await report(page);
  await slow(page.getByText("Report received.")).toBeVisible();

  const admin = adminClient();
  const { data: issue, error: issueError } = await admin.from("issues").select("id").eq("college_id", COLLEGE).single();
  if (issueError) throw issueError;
  const authority = await createUserWithRole(`auth${Date.now()}@demo-iot.edu`, "authority", {
    departmentName: "Hostel",
  });
  for (const to of ["in_progress", "resolved_pending"]) {
    const { error } = await authority.client.rpc("transition_issue", { p_issue: issue!.id, p_to: to });
    if (error) throw error;
  }

  await page.goto(`/issues/${issue!.id}`);
  await expect(page.getByText("Waiting for your confirmation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yes, it's fixed" }).click();
  await expect(page.getByText("Your vote was recorded.")).toBeVisible();
  const { data: votes } = await admin.from("issue_confirmations").select("fixed").eq("issue_id", issue!.id);
  expect(votes).toEqual([{ fixed: true }]);
});

test("notifications page lists report_received and marks it read", async ({ page }) => {
  await signUp(page);
  await report(page);
  await slow(page.getByText("Report received.")).toBeVisible();
  await page.goto("/notifications");
  const item = page.getByRole("listitem").filter({ hasText: "We received your report" });
  await expect(item).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Notifications \(1\)/ })).toBeVisible();
  await item.getByRole("button", { name: "Mark as read" }).click();
  await expect(item.getByText("Read", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
});

test("identity warning is visible on the form", async ({ page }) => {
  await signUp(page);
  await page.goto("/issues");
  await expect(page.getByText(WARNING)).toBeVisible();
});

test("campus status page shows the issue under Hostel Block A", async ({ page }) => {
  await signUp(page);
  await report(page);
  await slow(page.getByText("Report received.")).toBeVisible();
  await page.goto("/issues/status");
  const group = page.getByRole("region", { name: "Hostel Block A" });
  await expect(group.getByText("Water cooler not working")).toBeVisible();
  await expect(group.getByText("high", { exact: true })).toBeVisible();
});

test("a failed submit keeps the typed text and shows the rate limit message", async ({ page }) => {
  const id = await signUp(page);
  const { error } = await adminClient()
    .from("issue_report_log")
    .insert(Array.from({ length: 5 }, () => ({ student_id: id })));
  if (error) throw error;
  await report(page);
  await slow(page.getByText("You have filed 5 reports in the last 24 hours. Try again later.")).toBeVisible();
  await expect(page.getByLabel("What is the problem?")).toHaveValue(REPORT);
  await expect(page.getByLabel("Location")).not.toHaveValue("");
});

test("a student who did not report sees no vote buttons, and an unknown issue is 404", async ({ page, browser, baseURL }) => {
  await signUp(page);
  await report(page);
  await slow(page.getByText("Report received.")).toBeVisible();
  const admin = adminClient();
  const { data: issue, error: issueError } = await admin.from("issues").select("id").eq("college_id", COLLEGE).single();
  if (issueError) throw issueError;
  const authority = await createUserWithRole(`auth${Date.now()}@demo-iot.edu`, "authority", { departmentName: "Hostel" });
  for (const to of ["in_progress", "resolved_pending"]) {
    const { error } = await authority.client.rpc("transition_issue", { p_issue: issue.id, p_to: to });
    if (error) throw error;
  }

  const ctx = await browser.newContext({ baseURL });
  const other = await ctx.newPage();
  await signUp(other);
  await other.goto(`/issues/${issue.id}`);
  await expect(other.getByText("Waiting for your confirmation", { exact: true })).toBeVisible();
  await expect(other.getByRole("button", { name: "Yes, it's fixed" })).toHaveCount(0);
  // The 404 streams inside Suspense, so the HTTP status is already 200; check the rendered page.
  await other.goto("/issues/00000000-0000-4000-8000-000000000000");
  await expect(other.getByText("This page could not be found.")).toBeVisible();
  await expect(other.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await ctx.close();
});
