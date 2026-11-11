import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(`Marks ${id}`);
  await page.getByLabel("College email").fill(`marks${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Academics" }).click();
  await expect(page).toHaveURL(/\/academics$/);
}

async function addMarks(page: Page, semester: string, subject: string, marks: string) {
  await page.getByRole("combobox", { name: "Semester" }).selectOption(semester);
  await page.getByRole("combobox", { name: "Subject" }).selectOption({ label: subject });
  await page.getByRole("spinbutton", { name: "Marks" }).fill(marks);
  await page.getByRole("button", { name: "Save marks" }).click();
}

test("student adds marks and sees SGPA and CGPA", async ({ page }) => {
  await signUp(page);
  await expect(page.getByText("No marks yet. Add your first subject above.")).toBeVisible();
  await addMarks(page, "5", "DBMS", "85");
  await expect(page.getByText("SGPA: 9.00")).toBeVisible();
  await addMarks(page, "5", "Operating Systems", "62");
  const sem = page.getByRole("region", { name: "Semester 5" });
  await expect(sem.getByRole("cell", { name: "DBMS", exact: true })).toBeVisible();
  await expect(sem.getByText("SGPA: 8.00")).toBeVisible();
  await expect(page.getByText("CGPA: 8.00")).toBeVisible();
});

test("weak subject appears with its trend", async ({ page }) => {
  await signUp(page);
  await addMarks(page, "3", "Data Structures", "90");
  await expect(page.getByText("CGPA: 10.00")).toBeVisible();
  await addMarks(page, "4", "Data Structures", "50");
  await expect(page.getByText("CGPA: 8.00")).toBeVisible();
  await addMarks(page, "4", "DBMS", "95");
  const weak = page.getByRole("region", { name: "Weak subjects" });
  await expect(weak.getByText(/Data Structures.*trend declining/)).toBeVisible();
});

test("duplicate subject in a semester shows a message", async ({ page }) => {
  await signUp(page);
  await addMarks(page, "5", "DBMS", "85");
  await expect(page.getByText("SGPA: 9.00")).toBeVisible();
  await addMarks(page, "5", "DBMS", "70");
  await expect(page.getByRole("alert").filter({ hasText: "You already added this subject for this semester." })).toBeVisible();
});

test("marks 101 shows a range message", async ({ page }) => {
  await signUp(page);
  await addMarks(page, "5", "DBMS", "101");
  await expect(page.getByRole("alert").filter({ hasText: "Marks must be between 0 and 100." })).toBeVisible();
});

test("student deletes a result and SGPA updates", async ({ page }) => {
  await signUp(page);
  await addMarks(page, "5", "DBMS", "85");
  await expect(page.getByText("SGPA: 9.00")).toBeVisible();
  await addMarks(page, "5", "Operating Systems", "62");
  await expect(page.getByText("SGPA: 8.00")).toBeVisible();
  await page.getByRole("button", { name: "Delete Operating Systems semester 5" }).click();
  await expect(page.getByText("SGPA: 9.00")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Operating Systems" })).toHaveCount(0);
});
