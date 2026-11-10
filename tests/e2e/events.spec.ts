import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`ev${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  return name;
}

// datetime-local value for an instant, as campus time (Asia/Kolkata), whatever the runner's zone.
const istParts = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return p;
};
const localInput = (d: Date) => {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

test("admin creates an event, student sees it in the calendar and registers, seat count goes up", async ({ page, browser, baseURL }) => {
  const name = await signUp(page, "Admin");
  const { error } = await adminClient().from("profiles").update({ role: "college_admin" }).eq("full_name", name);
  if (error) throw error;
  const title = `Robotics demo ${Date.now()}`;
  const start = new Date(Date.now() + 2 * 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  await page.goto("/events/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Venue").fill("Main Auditorium");
  await page.getByLabel("Starts").fill(localInput(start));
  await page.getByLabel("Ends").fill(localInput(end));
  await page.getByLabel("Capacity").fill("5");
  await page.getByLabel("Description").fill("Live line-follower demo.");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("0 of 5 seats taken")).toBeVisible();

  const ctx = await browser.newContext({ baseURL });
  const sp = await ctx.newPage();
  await signUp(sp, "Student");
  await sp.goto("/events/new");
  await expect(sp.getByText("This page could not be found")).toBeVisible();
  const month = `${istParts(start).year}-${istParts(start).month}`;
  await sp.goto(`/events?view=calendar&month=${month}`);
  await expect(sp.getByRole("heading", { name: "Events" })).toBeVisible();
  // Hand-typed bad month values fall back to the current month instead of failing.
  await sp.goto("/events?view=calendar&month=0001-01");
  await expect(sp.getByRole("heading", { name: "Events" })).toBeVisible();
  await sp.goto(`/events?view=calendar&month=${month}`);
  await sp.getByRole("link", { name: title }).click();
  await expect(sp.getByRole("heading", { name: title })).toBeVisible();
  await sp.getByRole("button", { name: "Register" }).click();
  await expect(sp.getByText("You are registered.")).toBeVisible();
  await expect(sp.getByText("1 of 5 seats taken")).toBeVisible();
  await sp.getByRole("button", { name: "Cancel registration" }).click();
  await expect(sp.getByText("0 of 5 seats taken")).toBeVisible();
  await sp.getByRole("button", { name: "Register" }).click();
  await expect(sp.getByText("1 of 5 seats taken")).toBeVisible();
  await ctx.close();
});
