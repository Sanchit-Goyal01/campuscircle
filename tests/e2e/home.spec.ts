import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`ho${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  const { data, error } = await adminClient().from("profiles").select("id, college_id").eq("full_name", name).single();
  if (error) throw error;
  return { name, id: data.id as string, collegeId: data.college_id as string };
}

const LINK_ID = /\/([0-9a-f-]{36})$/;

test("home shows registered events, mentorship and listings with empty states", async ({ page }) => {
  const me = await signUp(page, "Home");
  const home = page.getByRole("region", { name: "Your shortcuts" });

  // Fresh student: three empty states, each pointing at the next step.
  await expect(home.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/events");
  await expect(home.getByRole("link", { name: "Find a mentor" })).toHaveAttribute("href", "/people");
  await expect(home.getByRole("link", { name: "List an item" })).toHaveAttribute("href", "/market/new");

  const admin = adminClient();
  const day = 86_400_000;
  const mk = async (title: string, offset: number) => {
    const { data, error } = await admin
      .from("events")
      .insert({
        college_id: me.collegeId, created_by: me.id, title, venue: "Hall 1",
        starts_at: new Date(Date.now() + offset).toISOString(),
        ends_at: new Date(Date.now() + offset + 3_600_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };
  const stamp = Date.now();
  const soon = await mk(`Soon event ${stamp}`, 2 * day);
  const later = await mk(`Later event ${stamp}`, 4 * day);
  await mk(`Unregistered event ${stamp}`, 3 * day);
  const past = await mk(`Past event ${stamp}`, -2 * day);
  // Started an hour ago and still running: it counts as upcoming.
  const running = await mk(`Running event ${stamp}`, -1_800_000);
  const { error: regErr } = await admin.from("event_registrations").insert(
    [soon, later, past, running].map((event_id) => ({ event_id, student_id: me.id, college_id: me.collegeId })),
  );
  if (regErr) throw regErr;

  const { data: listing, error: lErr } = await admin
    .from("listings")
    .insert({ college_id: me.collegeId, seller_id: me.id, title: `Soldering iron ${stamp}`, price_inr: 300, condition: "good" })
    .select("id")
    .single();
  if (lErr) throw lErr;
  const { error: sErr } = await admin
    .from("listings")
    .insert({ college_id: me.collegeId, seller_id: me.id, title: `Sold lamp ${stamp}`, price_inr: 100, condition: "good", status: "sold" });
  if (sErr) throw sErr;

  // A fresh mentor, so the test leaves no pending requests with a seeded person.
  const { data: made, error: uErr } = await admin.auth.admin.createUser({
    email: `mentor${stamp}@demo-iot.edu`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Mentor ${stamp}` },
  });
  if (uErr) throw uErr;
  const mentorId = made.user!.id;
  const row = (over: Record<string, unknown>) => ({
    college_id: me.collegeId, student_id: me.id, mentor_id: mentorId, subject: "DBMS", message: "Please help me with joins.", status: "pending", decided_at: null, ...over,
  });
  const { error: mErr } = await admin.from("mentorship_requests").insert([
    row({}),
    row({ student_id: mentorId, mentor_id: me.id, subject: "Rust", message: "Can you teach me Rust basics?" }),
    // Decided requests are not pending, so the home counts leave them out.
    row({ subject: "SQL", status: "accepted", decided_at: new Date().toISOString() }),
    row({ subject: "OS", status: "declined", decided_at: new Date().toISOString() }),
    row({ student_id: mentorId, mentor_id: me.id, subject: "Go", message: "Could you explain goroutines?", status: "accepted", decided_at: new Date().toISOString() }),
  ]);
  if (mErr) throw mErr;

  await page.reload();
  await expect(home.getByRole("link", { name: "Browse events" })).toHaveCount(0);
  await expect(home.getByRole("link", { name: "Find a mentor" })).toHaveCount(0);
  await expect(home.getByRole("link", { name: "List an item" })).toHaveCount(0);

  const events = home.getByRole("link", { name: new RegExp(`event ${stamp}`) });
  await expect(events).toHaveCount(3); // soonest first; finished and unregistered excluded
  await expect(events.nth(0)).toHaveText(`Running event ${stamp}`);
  await expect(events.nth(1)).toHaveText(`Soon event ${stamp}`);
  await expect(events.nth(1)).toHaveAttribute("href", `/events/${soon}`);
  await expect(events.nth(2)).toHaveAttribute("href", `/events/${later}`);
  await expect(home.getByRole("link", { name: new RegExp(`(Unregistered|Past) event ${stamp}`) })).toHaveCount(0);

  await expect(home.getByText("1 incoming, 1 outgoing")).toBeVisible();
  await expect(home.getByText("2 pending requests")).toBeVisible();
  await expect(home.getByRole("link", { name: "View requests" })).toHaveAttribute("href", "/mentorship");

  const item = home.getByRole("link", { name: `Soldering iron ${stamp}` });
  await expect(item).toHaveAttribute("href", `/market/${listing.id}`);
  await expect(home.getByRole("link", { name: /Sold lamp/ })).toHaveCount(0);
  expect((await item.getAttribute("href"))!).toMatch(LINK_ID);
});

test("staff see links to their pages and no student widgets", async ({ page }) => {
  const me = await signUp(page, "Staff");
  const { error } = await adminClient().from("profiles").update({ role: "authority" }).eq("id", me.id);
  if (error) throw error;
  await page.reload();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const staff = page.getByRole("region", { name: "Your pages" });
  await expect(staff.getByRole("link", { name: "Issue dashboard" })).toHaveAttribute("href", "/authority");
  await expect(page.getByRole("region", { name: "Your shortcuts" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse events" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Find a mentor" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "List an item" })).toHaveCount(0);
});
