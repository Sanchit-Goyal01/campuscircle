import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`mk${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  return name;
}

const png = () =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 90, b: 200 } } })
    .png()
    .toBuffer();

test("student lists an item with a photo, another student finds it and contacts the seller, seller sees a notification", async ({ page, browser, baseURL }) => {
  const seller = await signUp(page, "Seller");
  const title = `Drafting table ${Date.now()}`;
  await page.getByRole("link", { name: "Marketplace" }).click();
  await expect(page).toHaveURL(/\/market/);
  await page.getByRole("link", { name: "List an item" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Foldable aluminium drafting table, barely used.");
  await page.getByLabel("Price").fill("1200");
  await page.getByLabel("Condition").selectOption("like_new");
  await page.getByLabel("Photo").setInputFiles({ name: "table.png", mimeType: "image/png", buffer: await png() });
  await page.getByRole("button", { name: "List item" }).click();
  await expect(page).toHaveURL(/\/market\/[0-9a-f-]{36}$/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("₹1,200", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`Sold by ${seller}`))).toBeVisible();
  await expect(page.getByRole("img", { name: title })).toBeVisible();
  const { data } = await adminClient().from("listings").select("photo_path").eq("title", title).single();
  expect(data?.photo_path).toMatch(/\.jpg$/);

  const ctx = await browser.newContext({ baseURL });
  const bp = await ctx.newPage();
  const buyer = await signUp(bp, "Buyer");
  await bp.getByRole("link", { name: "Marketplace" }).click();
  await bp.getByLabel("Search").fill("drafting");
  await bp.getByRole("button", { name: "Search" }).click();
  await bp.getByRole("link", { name: new RegExp(title) }).first().click();
  await bp.getByLabel("Message").fill("Is the drafting table still available?");
  await bp.getByRole("button", { name: "Contact seller" }).click();
  await expect(bp.getByText("Message sent to the seller.")).toBeVisible();

  await page.goto("/notifications");
  await expect(page.getByText(new RegExp(`${buyer}.*still available`))).toBeVisible();
  await ctx.close();
});
