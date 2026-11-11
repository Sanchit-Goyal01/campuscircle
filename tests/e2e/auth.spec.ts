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

const CONFIRMED_NOTICE = "Your email is confirmed. Sign in to continue.";

test("a failed confirmation link lands on the confirmed notice, so the query survives the proxy", async ({ page }) => {
  await page.goto("/auth/confirm?code=bad");
  await expect(page).toHaveURL(/\/sign-in\?confirmed=1$/);
  await expect(page.getByText(CONFIRMED_NOTICE)).toBeVisible();
});

test("a bad token_hash lands on the confirmed notice", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=bad&type=signup");
  await expect(page.getByText(CONFIRMED_NOTICE)).toBeVisible();
});

test("the confirm path ignores a next param", async ({ page }) => {
  await page.goto("/auth/confirm?code=bad&next=https://example.com/");
  await expect(page).toHaveURL(/\/sign-in\?confirmed=1$/);
});

test("a confirm link with no code claims nothing", async ({ page }) => {
  await page.goto("/auth/confirm");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText(CONFIRMED_NOTICE)).toHaveCount(0);
});

test("the plain sign-in page shows no notice", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(CONFIRMED_NOTICE)).toHaveCount(0);
});

test("sign-up asks for the confirmation link to come back to /auth/confirm", async ({ page }) => {
  const signUpRequest = page.waitForRequest("**/auth/v1/signup*");
  await signUp(page, "Ada Redirect", `redirect${Date.now()}@demo-iot.edu`);
  const url = new URL((await signUpRequest).url());
  expect(url.searchParams.get("redirect_to")).toMatch(/\/auth\/confirm$/);
});
