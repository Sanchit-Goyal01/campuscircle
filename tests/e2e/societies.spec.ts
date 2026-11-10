import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string, role?: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`so${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  if (role) {
    const { error } = await adminClient().from("profiles").update({ role }).eq("full_name", name);
    if (error) throw error;
  }
  return name;
}

test("college admin creates a society; student requests to join; society admin accepts and posts an announcement; student sees it", async ({ page, browser, baseURL }) => {
  const caName = await signUp(page, "Dean", "college_admin");
  const ctxA = await browser.newContext({ baseURL });
  const ap = await ctxA.newPage();
  const adminName = await signUp(ap, "Lead", "society_admin");
  const ctxS = await browser.newContext({ baseURL });
  const sp = await ctxS.newPage();
  const studentName = await signUp(sp, "Joiner");

  // A student cannot open the create page.
  await sp.goto("/societies/new");
  await expect(sp.getByText("This page could not be found")).toBeVisible();

  const society = `Robotics ${Date.now()}`;
  await page.goto("/societies");
  await page.getByRole("link", { name: "Create a society" }).click();
  await page.getByLabel("Name").fill(society);
  await page.getByLabel("Description").fill("We build robots on weekends.");
  await page.getByLabel("Society admin").selectOption({ label: adminName });
  await page.getByRole("button", { name: "Create society" }).click();
  await expect(page).toHaveURL(/\/societies\/[0-9a-f-]{36}$/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: society })).toBeVisible();
  await expect(page.getByText(`Admin: ${adminName}`)).toBeVisible();
  void caName;

  await sp.goto("/societies");
  const row = sp.getByRole("listitem").filter({ hasText: society });
  await expect(row).toContainText("0 members");
  await row.getByRole("link", { name: society }).click();
  await sp.getByRole("button", { name: "Request to join" }).click();
  await expect(sp.getByText("Request pending")).toBeVisible();

  await ap.goto("/societies");
  await ap.getByRole("link", { name: society }).click();
  const req = ap.getByRole("listitem").filter({ hasText: studentName });
  await expect(req).toBeVisible();
  await req.getByRole("button", { name: "Accept" }).click();
  await expect(ap.getByRole("listitem").filter({ hasText: studentName })).toHaveCount(0);
  await ap.getByLabel("Title").fill("First meeting");
  await ap.getByLabel("Announcement", { exact: true }).fill("We meet Friday at 5 in the lab.");
  await ap.getByRole("button", { name: "Post announcement" }).click();
  await expect(ap.getByText("We meet Friday at 5 in the lab.")).toBeVisible({ timeout: 25_000 });

  await sp.reload();
  await expect(sp.getByText("You are a member")).toBeVisible();
  await expect(sp.getByText("First meeting")).toBeVisible();
  await expect(sp.getByText("We meet Friday at 5 in the lab.")).toBeVisible();
  await sp.goto("/notifications");
  await expect(sp.getByText(/First meeting/)).toBeVisible();
  await ctxA.close();
  await ctxS.close();
});
