import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`fd${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  return name;
}

const png = () =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 90, b: 20 } } })
    .png()
    .toBuffer();

test("student posts text with a photo, another student likes and comments", async ({ page, browser, baseURL }) => {
  const author = await signUp(page, "Poster");
  const text = `Robotics club meets tonight ${Date.now()}`;
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await expect(page).toHaveURL(/\/feed/);
  await page.getByLabel("What is happening?").fill(text);
  await page.getByLabel("Photo").setInputFiles({ name: "club.png", mimeType: "image/png", buffer: await png() });
  await page.getByRole("button", { name: "Post" }).click();
  const card = page.getByRole("article").filter({ hasText: text });
  await expect(card).toBeVisible({ timeout: 25_000 });
  await expect(card.getByText(author)).toBeVisible();
  await expect(card.getByRole("img")).toBeVisible();
  const { data } = await adminClient().from("posts").select("photo_path").eq("body", text).single();
  expect(data?.photo_path).toMatch(/\.jpg$/);

  const ctx = await browser.newContext({ baseURL });
  const rp = await ctx.newPage();
  const reader = await signUp(rp, "Reader");
  await rp.goto("/feed");
  const rcard = rp.getByRole("article").filter({ hasText: text });
  await expect(rcard).toBeVisible();
  await rcard.getByRole("button", { name: "Like" }).click();
  await expect(rcard.getByRole("button", { name: "Unlike" })).toBeVisible();
  await rcard.getByRole("link", { name: /Comments/ }).click();
  await expect(rp).toHaveURL(/\/feed\/[0-9a-f-]{36}$/);
  await rp.getByRole("textbox", { name: "Comment" }).fill("See you there!");
  await rp.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(rp.getByText("See you there!")).toBeVisible();
  await expect(rp.getByText(reader).first()).toBeVisible();

  await page.reload();
  const card2 = page.getByRole("article").filter({ hasText: text });
  await expect(card2.getByText("1 like")).toBeVisible();
  await expect(card2.getByRole("link", { name: "Comments (1)" })).toBeVisible();
  await ctx.close();
});

test("student reports a post and sees a confirmation", async ({ page, browser, baseURL }) => {
  await signUp(page, "Author");
  const text = `Selling nothing, just posting ${Date.now()}`;
  await page.goto("/feed");
  await page.getByLabel("What is happening?").fill(text);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("article").filter({ hasText: text })).toBeVisible({ timeout: 25_000 });

  const ctx = await browser.newContext({ baseURL });
  const rp = await ctx.newPage();
  await signUp(rp, "Reporter");
  await rp.goto("/feed");
  const card = rp.getByRole("article").filter({ hasText: text });
  await card.getByText("Report", { exact: true }).click();
  await card.getByLabel("Reason").fill("This looks like spam");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card.getByText("Report sent. A moderator will review it.")).toBeVisible();
  await card.getByLabel("Reason").fill("This looks like spam");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card.getByText("You already reported this post.")).toBeVisible();
  await ctx.close();
});

test("a long unbroken string in a post and a comment does not overflow the page at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page, "Longtext");
  const long = `Z${Date.now()}`.padEnd(300, "x");
  await page.goto("/feed");
  await page.getByLabel("What is happening?").fill(long);
  await page.getByRole("button", { name: "Post" }).click();
  const card = page.getByRole("article").filter({ hasText: long });
  await expect(card).toBeVisible({ timeout: 25_000 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect.poll(overflow, { timeout: 5000 }).toBeLessThanOrEqual(0);
  await card.getByRole("link", { name: /Comments/ }).click();
  await expect(page).toHaveURL(/\/feed\/[0-9a-f-]{36}$/);
  await page.getByRole("textbox", { name: "Comment" }).fill(long);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText(long)).toHaveCount(2);
  await expect.poll(overflow, { timeout: 5000 }).toBeLessThanOrEqual(0);
});
