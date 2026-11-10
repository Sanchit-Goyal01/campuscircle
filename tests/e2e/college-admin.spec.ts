import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string, role?: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`ca${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  if (role) {
    const { error } = await adminClient().from("profiles").update({ role }).eq("full_name", name);
    if (error) throw error;
    await page.reload();
  }
  return name;
}

test("admin verifies a student and the badge appears in People", async ({ page, browser, baseURL }) => {
  const dean = await signUp(page, "Dean", "college_admin");
  void dean;
  const ctx = await browser.newContext({ baseURL });
  const sp = await ctx.newPage();
  const name = await signUp(sp, "Verifee");
  const ctx2 = await browser.newContext({ baseURL });
  const op = await ctx2.newPage();
  await signUp(op, "Watcher");

  // A student cannot use the admin page.
  await sp.goto("/admin");
  await expect(sp.getByText("This page is for college admins.")).toBeVisible();

  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByLabel("Student name").fill(name);
  await page.getByRole("button", { name: "Search students" }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0, { timeout: 25_000 });

  // The people list is capped, so narrow it with a skill only this student has.
  const skill = `badge${Date.now()}`;
  const { error } = await adminClient().from("profiles").update({ skills: [skill] }).eq("full_name", name);
  if (error) throw error;
  await op.goto(`/people?skill=${skill}`);
  const card = op.getByRole("listitem").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText("Verified")).toBeVisible();
  await ctx.close();
  await ctx2.close();
});

test("admin publishes an announcement and a student sees it on the home page", async ({ page, browser, baseURL }) => {
  await signUp(page, "Dean", "college_admin");
  const ctx = await browser.newContext({ baseURL });
  const sp = await ctx.newPage();
  await signUp(sp, "Reader");

  const title = `Library hours ${Date.now()}`;
  const text = `The library stays open until 10 pm this week. ${title}`;
  await page.goto("/admin");
  const form = page.getByRole("region", { name: "Announcements" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Announcement").fill(text);
  await form.getByRole("button", { name: "Publish" }).click();
  await expect(form.getByRole("listitem").filter({ hasText: title })).toBeVisible({ timeout: 25_000 });

  await sp.goto("/");
  await expect(sp.getByRole("region", { name: "College announcements" }).getByText(title)).toBeVisible();
  await sp.getByRole("link", { name: "Announcements", exact: true }).click();
  await expect(sp).toHaveURL(/\/announcements$/);
  await expect(sp.getByRole("heading", { name: title })).toBeVisible();
  await expect(sp.getByText(text)).toBeVisible();

  await form.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Delete" }).click();
  await expect(form.getByRole("listitem").filter({ hasText: title })).toHaveCount(0, { timeout: 25_000 });
  await ctx.close();
});

test("student reports a post; admin hides it; another student no longer sees it", async ({ page, browser, baseURL }) => {
  const author = await signUp(page, "Author");
  const text = `Questionable post ${Date.now()}`;
  await page.goto("/feed");
  await page.getByLabel("What is happening?").fill(text);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("article").filter({ hasText: text })).toBeVisible({ timeout: 25_000 });

  const rctx = await browser.newContext({ baseURL });
  const rp = await rctx.newPage();
  await signUp(rp, "Reporter");
  await rp.goto("/feed");
  const card = rp.getByRole("article").filter({ hasText: text });
  await card.getByText("Report", { exact: true }).click();
  await card.getByLabel("Reason").fill("This looks like spam");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card.getByText("Report sent. A moderator will review it.")).toBeVisible();

  const actx = await browser.newContext({ baseURL });
  const ap = await actx.newPage();
  await signUp(ap, "Dean", "college_admin");
  await ap.goto("/admin");
  const queue = ap.getByRole("region", { name: "Reported posts" });
  const item = queue.getByRole("listitem").filter({ hasText: text });
  await expect(item).toBeVisible();
  await expect(item).toContainText(author);
  await expect(item).toContainText("This looks like spam");
  await expect(item).toContainText("1 report");
  await item.getByRole("button", { name: "Hide" }).click();
  await expect(queue.getByRole("listitem").filter({ hasText: text })).toHaveCount(0, { timeout: 25_000 });

  await rp.goto("/feed");
  await expect(rp.getByText(text)).toHaveCount(0);
  await page.goto("/feed");
  await expect(page.getByRole("article").filter({ hasText: text })).toContainText("Hidden by a moderator");
  await page.goto("/notifications");
  await expect(page.getByText(/hidden/i).first()).toBeVisible();
  await rctx.close();
  await actx.close();
});
