import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";

const PASSWORD = "e2e-password-123!";
const COLLEGE = "00000000-0000-0000-0000-00000000a001";

function uniqueStudent() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return { email: `agent${id}@demo-iot.edu`, name: `Ada ${id}` };
}

/** Signs up a new student on this page and returns their profile id. */
async function signUp(page: Page) {
  const { email, name } = uniqueStudent();
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  const { data, error } = await adminClient()
    .from("profiles")
    .select("id")
    .eq("full_name", name)
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedResult(studentId: string, subject: string) {
  const db = adminClient();
  const { data, error } = await db
    .from("subjects")
    .insert({ college_id: COLLEGE, code: `E2E${Date.now()}${Math.random()}`, name: subject, credits: 4 })
    .select("id")
    .single();
  if (error) throw error;
  const { error: resultError } = await db.from("subject_results").insert({
    student_id: studentId,
    college_id: COLLEGE,
    subject_id: data.id,
    semester: 3,
    marks: 81,
    grade_points: 9,
  });
  if (resultError) throw resultError;
}

async function planCount(studentId: string) {
  const { count, error } = await adminClient()
    .from("study_plans")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId);
  if (error) throw error;
  return count ?? 0;
}

async function ask(page: Page, message: string) {
  await page.getByLabel("Ask CampusCircle").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
}

// Scoped to the panel because Next's route announcer is also role="alert".
const panelAlert = (page: Page) =>
  page.getByRole("region", { name: "CampusCircle assistant" }).getByRole("alert");

const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });

const slip = (page: Page) => page.getByRole("region", { name: /Approval request/ });

async function askForPlan(page: Page) {
  await ask(page, "make me a revision plan");
  await expect(slip(page)).toBeVisible();
}

test("student asks about marks and sees trace and reply", async ({ page }) => {
  const id = await signUp(page);
  await seedResult(id, "Operating Systems");
  await ask(page, "How are my marks?");
  const trace = page.getByRole("list", { name: "What the assistant did" });
  await expect(trace.getByText("get_marks")).toBeVisible();
  await expect(trace.getByText("1 record")).toBeVisible();
  await expect(conversation(page).getByText("I read your marks.")).toBeVisible();
  await expect(page.getByRole("status").first()).toHaveText("I read your marks.");
  await trace.getByText("Show details").click();
  await expect(trace.getByText(/Operating Systems/)).toBeVisible();
});

test("tool results render as text, never as markup", async ({ page }) => {
  const id = await signUp(page);
  await seedResult(id, '<img src=x onerror="window.__pwned=1">');
  await ask(page, "my marks");
  const trace = page.getByRole("list", { name: "What the assistant did" });
  await trace.getByText("Show details").click();
  await expect(trace.getByText(/<img src=x/)).toBeVisible();
  await expect(trace.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});

test("study plan shows approval card and nothing is saved yet", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  await expect(slip(page).getByText("Save a study plan")).toBeVisible();
  await expect(slip(page).getByText("Semester revision plan")).toBeVisible();
  await expect(slip(page).getByText("Revise algorithms")).toBeVisible();
  await expect(slip(page).locator("time")).toHaveCount(3);
  await expect(page.getByRole("list", { name: "What the assistant did" }).getByText("create_study_plan")).toBeVisible();
  expect(await planCount(id)).toBe(0);
});

test("approve saves the plan and card shows done", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  await slip(page).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("region", { name: /Approval request/ }).getByText("Saved", { exact: true })).toBeVisible();
  await expect(slip(page).getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect(await planCount(id)).toBe(1);
});

test("double-click approve saves one plan", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  await slip(page).getByRole("button", { name: "Approve" }).dblclick();
  await expect(slip(page).getByText("Saved", { exact: true })).toBeVisible();
  expect(await planCount(id)).toBe(1);
});

test("both buttons are disabled while approval is in flight", async ({ page }) => {
  await signUp(page);
  await askForPlan(page);
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/approve", async (route) => {
    await held;
    await route.continue();
  });
  await slip(page).getByRole("button", { name: "Approve" }).click();
  await expect(slip(page).getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(slip(page).getByRole("button", { name: "Reject" })).toBeDisabled();
  release();
  await expect(slip(page).getByText("Saved", { exact: true })).toBeVisible();
});

test("reject marks card rejected and saves nothing", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  await slip(page).getByRole("button", { name: "Reject" }).click();
  await expect(slip(page).getByText("Rejected", { exact: true })).toBeVisible();
  expect(await planCount(id)).toBe(0);
});

test("a plan whose date passed before approval shows Failed with a plain reason", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  const { error } = await adminClient()
    .from("agent_pending_actions")
    .update({ input: { title: "Old plan", items: [{ due_on: "2020-01-01", task: "Too late" }] } })
    .eq("student_id", id);
  if (error) throw error;
  const approve = page.waitForResponse("**/approve");
  await slip(page).getByRole("button", { name: "Approve" }).click();
  const body = await (await approve).text();
  expect(body).toContain('"status":"failed"');
  expect(body).not.toMatch(/Invalid input|due_on/);
  await expect(slip(page).getByText("Failed", { exact: true })).toBeVisible();
  await expect(slip(page).getByText("This could not be saved. Ask again to start over.")).toBeVisible();
  await expect(slip(page).getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect(await planCount(id)).toBe(0);
});

test("an approval that did not start keeps the buttons, and trying again saves", async ({ page }) => {
  const id = await signUp(page);
  await askForPlan(page);
  await page.route("**/approve", (route) => route.fulfill({ status: 500, json: { error: "x" } }));
  await slip(page).getByRole("button", { name: "Approve" }).click();
  await expect(slip(page).getByRole("alert")).toHaveText("That request did not go through. Try again.");
  await page.unroute("**/approve");
  await slip(page).getByRole("button", { name: "Approve" }).click();
  await expect(slip(page).getByText("This plan is saved.")).toBeVisible();
  expect(await planCount(id)).toBe(1);
});

test("a saved action with an unrecorded result shows done and the warning", async ({ page }) => {
  await signUp(page);
  await askForPlan(page);
  // Card rendering only: the route's mapping is covered in tests/rls/agent-routes.test.ts.
  await page.route("**/approve", (route) =>
    route.fulfill({ json: { status: "done", result: {}, warning: "There is no need to ask again." } }),
  );
  await slip(page).getByRole("button", { name: "Approve" }).click();
  await expect(slip(page).getByText("This plan is saved.")).toBeVisible();
  await expect(slip(page).getByText("There is no need to ask again.")).toBeVisible();
  await expect(slip(page).getByText("Failed", { exact: true })).toHaveCount(0);
});

test("a model failure response holds no raw error text", async ({ page }) => {
  await signUp(page);
  const res = await page.request.post("/api/agent/runs", { data: { message: "please fail" } });
  expect(res.status()).toBe(502);
  expect(await res.text()).not.toContain("Scripted model failure");
});

test("the fresh start hint stays visible after a reply", async ({ page }) => {
  await signUp(page);
  const hint = page.getByText("Each message starts fresh");
  await expect(hint).toBeVisible();
  await ask(page, "hello");
  await expect(conversation(page).getByText("Scripted reply.")).toBeVisible();
  await expect(hint).toBeVisible();
});

test("an authority sees the panel because campus status is open to every role", async ({ page }) => {
  const id = await signUp(page);
  await expect(page.getByRole("region", { name: "CampusCircle assistant" })).toBeVisible();
  const { error } = await adminClient().from("profiles").update({ role: "authority" }).eq("id", id);
  if (error) throw error;
  await page.reload();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "CampusCircle assistant" })).toBeVisible();
});

test("empty message and message over 4000 characters are refused", async ({ page }) => {
  await signUp(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/agent/runs")) posts += 1;
  });
  await ask(page, "   ");
  await expect(panelAlert(page)).toContainText("Write a message first");
  await ask(page, "x".repeat(4001));
  await expect(panelAlert(page)).toContainText("4000");
  expect(posts).toBe(0);

  for (const data of [{ message: "   " }, { message: "x".repeat(4001) }, { message: 5 }, {}]) {
    const res = await page.request.post("/api/agent/runs", { data });
    expect(res.status()).toBe(400);
  }
  const malformed = await page.request.post("/api/agent/runs", {
    data: "{not json",
    headers: { "content-type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
  const atLimit = await page.request.post("/api/agent/runs", { data: { message: "x".repeat(4000) } });
  expect(atLimit.status()).toBe(200);
});

test("model failure shows a retry option", async ({ page }) => {
  await signUp(page);
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/agent/runs")) bodies.push(r.postData() ?? "");
  });
  const response = page.waitForResponse("**/api/agent/runs");
  await ask(page, "this will fail");
  const res = await response;
  expect(res.status()).toBe(502);
  const body = await res.json();
  expect(body).toMatchObject({ status: "failed", pendingActions: [] });
  expect(typeof body.runId).toBe("string");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toBe(bodies[0]);
  await expect(page.getByLabel("Ask CampusCircle")).toHaveValue("this will fail");
});

test("a network failure keeps the text and Retry recovers", async ({ page }) => {
  await signUp(page);
  let first = true;
  await page.route("**/api/agent/runs", (route) => {
    if (first) {
      first = false;
      return route.abort();
    }
    return route.continue();
  });
  await ask(page, "How are my marks?");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(conversation(page).getByText("I read your marks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("the daily run limit gives 429", async ({ page }) => {
  const id = await signUp(page);
  const { error } = await adminClient()
    .from("agent_runs")
    .insert(Array.from({ length: 30 }, () => ({ student_id: id, college_id: COLLEGE, message: "seed" })));
  if (error) throw error;
  const res = await page.request.post("/api/agent/runs", { data: { message: "hello" } });
  expect(res.status()).toBe(429);
  await ask(page, "hello");
  await expect(panelAlert(page)).toContainText("Try again tomorrow");
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("signed-out API calls get 401 JSON, not a redirect", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const id = "00000000-0000-4000-8000-000000000000";
  const calls = [
    ["/api/agent/runs", { message: "hi" }],
    [`/api/agent/actions/${id}/approve`, undefined],
    [`/api/agent/actions/${id}/reject`, undefined],
  ] as const;
  for (const [url, data] of calls) {
    const res = await request.post(url, { data, maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  }
  await request.dispose();
});

test("a malformed action id gives 400", async ({ page }) => {
  await signUp(page);
  expect((await page.request.post("/api/agent/actions/not-a-uuid/approve")).status()).toBe(400);
  expect((await page.request.post("/api/agent/actions/not-a-uuid/reject")).status()).toBe(400);
});

test("deciding twice gives 409", async ({ page }) => {
  await signUp(page);
  const res = await page.request.post("/api/agent/runs", { data: { message: "plan" } });
  const { pendingActions } = await res.json();
  expect(pendingActions[0]).toMatchObject({ tool_name: "create_study_plan", status: "pending" });
  const url = `/api/agent/actions/${pendingActions[0].id}`;
  const approved = await page.request.post(`${url}/approve`);
  expect(approved.status()).toBe(200);
  expect(await approved.json()).toMatchObject({ status: "done", result: { planId: expect.any(String) } });
  expect((await page.request.post(`${url}/approve`)).status()).toBe(409);
  expect((await page.request.post(`${url}/reject`)).status()).toBe(409);
});

async function secondStudent(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { context, page, id: await signUp(page) };
}

test("another student's action gives 409 and stays pending", async ({ page, browser, baseURL }) => {
  const owner = await signUp(page);
  const res = await page.request.post("/api/agent/runs", { data: { message: "plan" } });
  const actionId = (await res.json()).pendingActions[0].id as string;

  const other = await secondStudent(browser, baseURL);
  expect((await other.page.request.post(`/api/agent/actions/${actionId}/approve`)).status()).toBe(409);
  expect((await other.page.request.post(`/api/agent/actions/${actionId}/reject`)).status()).toBe(409);
  await other.context.close();

  const { data } = await adminClient()
    .from("agent_pending_actions")
    .select("status")
    .eq("id", actionId)
    .single();
  expect(data?.status).toBe("pending");
  expect(await planCount(owner)).toBe(0);
});

test("the panel fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page);
  await askForPlan(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
      timeout: 5000,
    })
    .toBeLessThanOrEqual(0);
  await expect(slip(page).getByRole("button", { name: "Approve" })).toBeInViewport({ ratio: 0 });
});
