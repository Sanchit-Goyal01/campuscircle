import { expect, test } from "@playwright/test";

const PASSWORD = "e2e-password-123!";

test("agent drafts a complaint, the student approves, and it appears under My reports", async ({ page }) => {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `Complainer ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`ia${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

  await page.getByLabel("Ask CampusCircle").fill("I want to complain about the hostel");
  await page.getByRole("button", { name: "Send" }).click();
  const slip = page.getByRole("region", { name: /Approval request/ });
  await slip.getByRole("button", { name: "Approve" }).click();
  await expect(slip.getByText("This action is done.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/issues");
  const mine = page.getByRole("region", { name: "My reports" });
  await expect(mine.getByRole("link", { name: "Water cooler not working" })).toBeVisible();
  await expect(mine.getByText(/Hostel Block A/)).toBeVisible();
});
