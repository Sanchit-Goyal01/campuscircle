import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function signUp(page: Page, label: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `${label} ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`ms${id}@demo-iot.edu`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  return { name, id };
}

test("student A messages student B from People; B sees it live without reload", async ({ page, browser, baseURL }) => {
  const b = await signUp(page, "Receiver");
  const skill = `chat${b.id}`;
  const { error } = await adminClient().from("profiles").update({ skills: [skill] }).eq("full_name", b.name);
  expect(error).toBeNull();

  const ctxA = await browser.newContext({ baseURL });
  const pa = await ctxA.newPage();
  const a = await signUp(pa, "Sender");
  await pa.getByRole("link", { name: "People" }).click();
  await pa.getByLabel("Skill").fill(skill);
  await pa.getByRole("button", { name: "Search" }).click();
  const card = pa.getByRole("listitem").filter({ hasText: b.name });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Message" }).click();
  await expect(pa).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
  await expect(pa.getByRole("heading", { name: b.name })).toBeVisible();

  // B opens the same thread (it exists, and B is a participant) and waits.
  const threadUrl = pa.url();
  await page.goto(threadUrl);
  await expect(page.getByRole("heading", { name: a.name })).toBeVisible();
  await expect(page.getByText("No messages yet.")).toBeVisible();

  await pa.getByLabel("Message").fill("Hello from A, live");
  await pa.getByRole("button", { name: "Send" }).click();
  await expect(pa.getByText("Hello from A, live")).toBeVisible();
  // No reload on B's side: the message arrives through Realtime.
  await expect(page.getByText("Hello from A, live")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Message").fill("Reply from B");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(pa.getByText("Reply from B")).toBeVisible({ timeout: 15_000 });

  // The list shows the other person and a preview.
  await pa.goto("/messages");
  const row = pa.getByRole("listitem").filter({ hasText: b.name });
  await expect(row).toContainText("Reply from B");
  // A third user cannot open the thread.
  const ctxC = await browser.newContext({ baseURL });
  const pc = await ctxC.newPage();
  await signUp(pc, "Outsider");
  await pc.goto(threadUrl);
  await expect(pc.getByText("This conversation is not available.")).toBeVisible();
  await expect(pc.getByText("Hello from A, live")).toHaveCount(0);
  await ctxA.close();
  await ctxC.close();
});

test("agent: \"message <B name>: hello\" shows an approval card with B's name; approving delivers the message", async ({ page, browser, baseURL }) => {
  const b = await signUp(page, "Agentrecipient");
  const ctxA = await browser.newContext({ baseURL });
  const pa = await ctxA.newPage();
  const a = await signUp(pa, "Agentsender");

  await pa.getByLabel("Ask CampusCircle").fill(`message ${b.name}: hello from the agent`);
  await pa.getByRole("button", { name: "Send" }).click();
  const card = pa.getByRole("region", { name: /Approval request/ });
  await expect(card).toHaveCount(1, { timeout: 45_000 });
  await expect(card).toContainText(`Send a message to ${b.name}`);
  await expect(card).toContainText("hello from the agent");
  await expect(card).not.toContainText(UUID_IN_TEXT);
  await expect(card).not.toContainText("recipient_id");
  const sent = await adminClient().from("messages").select("id", { count: "exact", head: true }).eq("body", "hello from the agent");
  expect(sent.count).toBe(0);
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("This action is done.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/messages");
  // One unread conversation shows in the sidebar until the thread is opened.
  await expect(page.getByRole("link", { name: "Messages (1)" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: a.name });
  await expect(row).toContainText("hello from the agent");
  await row.getByRole("link").first().click();
  await expect(page.getByText("hello from the agent")).toBeVisible();
  await expect(page.getByRole("link", { name: "Messages", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Messages (1)" })).toHaveCount(0);

  // No match: the agent says so and queues nothing.
  await pa.goto("/");
  await pa.getByLabel("Ask CampusCircle").fill("message Nobody Qwxz Existing: hi");
  await pa.getByRole("button", { name: "Send" }).click();
  await expect(pa.locator(".turn-reply").getByText("I could not find anyone by that name.")).toBeVisible({ timeout: 45_000 });
  await ctxA.close();
});
