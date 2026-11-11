import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`pe${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  return name;
}

test("student adds skills and turns on mentor flag", async ({ page }) => {
  const name = await signUp(page, "Skills");
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile/);
  await page.getByLabel("Skills").fill("Rust, Graph Theory");
  await page.getByLabel("Bio").fill("Likes graphs.");
  await page.getByLabel("I can mentor other students").check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  const { data } = await adminClient().from("profiles").select("skills, is_mentor, bio").eq("full_name", name).single();
  expect(data?.skills).toEqual(["Rust", "Graph Theory"]);
  expect(data?.is_mentor).toBe(true);
});

test("student finds a DBMS mentor, sends a request, mentor accepts", async ({ page, browser, baseURL }) => {
  const mentorName = await signUp(page, "Mentor");
  await page.goto("/profile");
  await page.getByLabel("Skills").fill("DBMS, SQL");
  await page.getByLabel("I can mentor other students").check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  const ctx = await browser.newContext({ baseURL });
  const sp = await ctx.newPage();
  await signUp(sp, "Learner");
  await sp.getByRole("link", { name: "People" }).click();
  await sp.getByLabel("Skill").fill("dbms");
  await sp.getByLabel("Mentors only").check();
  await sp.getByRole("button", { name: "Search" }).click();
  const card = sp.getByRole("listitem").filter({ hasText: mentorName });
  await expect(card).toBeVisible();
  await expect(sp.getByRole("listitem").filter({ hasText: "Priya Sharma" })).toBeVisible();
  await card.getByLabel("Subject").fill("DBMS");
  await card.getByLabel("Message").fill("Please help me with normalisation.");
  await card.getByRole("button", { name: "Request mentorship" }).click();
  await expect(card.getByText("Request pending")).toBeVisible();
  await sp.goto("/mentorship");
  await expect(sp.getByText("Pending")).toBeVisible();

  await page.goto("/mentorship");
  await expect(page.getByText("Please help me with normalisation.")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Accepted")).toBeVisible();
  await sp.reload();
  await expect(sp.getByText("Accepted")).toBeVisible();
  await ctx.close();
});
