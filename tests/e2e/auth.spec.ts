import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-123!";

function uniqueEmail(domain = "demo-iot.edu") {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return { email: `e2e${id}@${domain}`, name: `Ada ${id}` };
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("signed-out visitor is redirected to /sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test('sign-up with unlisted domain shows "Your college is not registered yet."', async ({
  page,
}) => {
  const { email, name } = uniqueEmail("unlisted-example.org");
  await signUp(page, name, email);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Your college is not registered yet.");
  await expect(page).toHaveURL(/\/sign-up$/);
});

test("student signs up, signs in, and sees the dashboard with their name", async ({
  page,
}) => {
  const { email, name } = uniqueEmail();
  await signUp(page, name, email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

  // sign out, then sign in again with the same credentials
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("College email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
});

test("sign-out returns to /sign-in", async ({ page }) => {
  const { email, name } = uniqueEmail();
  await signUp(page, name, email);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("sign out works again after signing back in in the same tab", async ({ page }) => {
  const { email, name } = uniqueEmail();
  await signUp(page, name, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("College email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeEnabled();
  await signOut.click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("after sign-out the page holds no previous student data", async ({ page }) => {
  const { email, name } = uniqueEmail();
  await signUp(page, name, email);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await page.content()).not.toContain(name);
  expect(await page.locator('input[type="password"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([""]);
  await page.goto("/sign-up");
  expect(await page.locator('input[type="password"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([""]);
  expect(await page.content()).not.toContain(PASSWORD);
});
