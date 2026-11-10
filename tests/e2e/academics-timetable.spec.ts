import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-123!";

async function signUpToTimetable(page: Page) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(`Timetable ${id}`);
  await page.getByLabel("College email").fill(`tt${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Timetable" }).click();
  await expect(page).toHaveURL(/\/academics\/timetable$/);
}

function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function addExam(page: Page, date: string, subject: string) {
  await page.getByRole("combobox", { name: "Type" }).selectOption("exam");
  await page.getByLabel("Exam date").fill(date);
  await page.getByRole("combobox", { name: "Subject" }).selectOption({ label: subject });
  await page.getByLabel("Start time").fill("10:00");
  await page.getByRole("button", { name: "Add entry" }).click();
}

test("student adds a Monday class and sees it in the weekly grid", async ({ page }) => {
  await signUpToTimetable(page);
  await page.getByRole("combobox", { name: "Weekday" }).selectOption("1");
  await page.getByRole("combobox", { name: "Subject" }).selectOption({ label: "DBMS" });
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("10:00");
  await page.getByLabel("Location").fill("Room 12");
  await page.getByRole("button", { name: "Add entry" }).click();
  const monday = page.getByRole("region", { name: "Weekly timetable" }).getByRole("cell", { name: "Monday" });
  await expect(monday.getByText("DBMS")).toBeVisible();
  await expect(monday.getByText("09:00 to 10:00")).toBeVisible();
  await expect(monday.getByText("Room 12")).toBeVisible();
});

test("student adds an exam and sees it under Upcoming exams with days left", async ({ page }) => {
  await signUpToTimetable(page);
  await addExam(page, isoDaysFromNow(30), "Operating Systems");
  const upcoming = page.getByRole("region", { name: "Upcoming exams" });
  await expect(upcoming.getByText(/Operating Systems/)).toBeVisible();
  // The page uses AGENT_TIMEZONE, which can be a day ahead of UTC, so allow 29 to 31.
  await expect(upcoming.getByText(/^(29|30|31) days left$/)).toBeVisible();
});

test("past exams are not listed as upcoming", async ({ page }) => {
  await signUpToTimetable(page);
  await addExam(page, isoDaysFromNow(-10), "DBMS");
  await expect(page.getByText("No upcoming exams.")).toBeVisible();
});
