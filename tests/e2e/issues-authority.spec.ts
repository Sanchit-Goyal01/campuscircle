import { expect, test, type Page } from "@playwright/test";
import { createUserWithRole } from "../helpers/roles";
import { adminClient, TEST_PASSWORD } from "../helpers/supabase";

const COLLEGE = "00000000-0000-0000-0000-00000000a001";
const BODY = "The water cooler on the second floor corridor is leaking all over the floor.";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("College email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function newUser(role: "authority" | "college_admin" | "student", departmentName?: string, head?: boolean) {
  const email = `au${Date.now()}${Math.floor(Math.random() * 1e6)}@demo-iot.edu`;
  await createUserWithRole(email, role, { departmentName, head });
  return email;
}

/** Inserts an issue straight through the service role so these tests do not depend on the classifier. */
async function seedIssue(opts: {
  title?: string;
  department?: string | null;
  severity?: "critical" | "high" | "medium" | "low" | null;
  needsTriage?: boolean;
  location?: string;
  photoPath?: string;
}) {
  const admin = adminClient();
  const { data: loc } = await admin
    .from("locations")
    .select("id")
    .eq("college_id", COLLEGE)
    .eq("name", opts.location ?? "Hostel Block A")
    .single();
  let deptId: string | null = null;
  if (opts.department) {
    const { data: d } = await admin
      .from("departments")
      .select("id")
      .eq("college_id", COLLEGE)
      .eq("name", opts.department)
      .single();
    deptId = d!.id;
  }
  const severity = opts.severity === undefined ? "high" : opts.severity;
  const { data: issue, error } = await admin
    .from("issues")
    .insert({
      college_id: COLLEGE,
      location_id: loc!.id,
      department_id: deptId,
      category: opts.needsTriage ? null : "water",
      severity,
      title: opts.title ?? "Water cooler not working",
      needs_triage: !!opts.needsTriage,
      due_at: opts.needsTriage ? null : new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  await admin
    .from("issue_reports")
    .insert({ issue_id: issue.id, college_id: COLLEGE, body: BODY, photo_paths: opts.photoPath ? [opts.photoPath] : [] });
  await admin.from("issue_events").insert({ issue_id: issue.id, college_id: COLLEGE, kind: "reported", actor_role: "student" });
  return issue.id as string;
}

test.beforeEach(async () => {
  const admin = adminClient();
  const { error } = await admin.from("issues").delete().eq("college_id", COLLEGE);
  if (error) throw error;
  await admin.from("root_cause_insights").delete().eq("college_id", COLLEGE);
  // Other tests change SLA minutes; restore defaults.
  for (const [severity, m] of [["critical", 1440], ["high", 2880], ["medium", 4320], ["low", 10080]] as const) {
    await admin.from("sla_rules").update({ deadline_minutes: m }).eq("college_id", COLLEGE).eq("severity", severity);
  }
});

test("hostel authority sees the queue and moves an issue to in_progress then resolved_pending", async ({ page }) => {
  const id = await seedIssue({ department: "Hostel" });
  await signIn(page, await newUser("authority", "Hostel"));
  await page.goto("/authority");
  await expect(page.getByRole("link", { name: "Water cooler not working" })).toBeVisible();
  await page.getByRole("link", { name: "Water cooler not working" }).click();
  await expect(page).toHaveURL(new RegExp(`/authority/${id}`));
  await expect(page.getByText(BODY)).toBeVisible();
  await page.getByRole("button", { name: "Mark In progress" }).click();
  await expect(page.getByRole("button", { name: "Mark Resolved" })).toBeVisible();
  await page.getByRole("button", { name: "Mark Resolved" }).click();
  await expect(page.getByRole("button", { name: /^Mark / })).toHaveCount(0);
  const { data } = await adminClient().from("issues").select("status").eq("id", id).single();
  expect(data?.status).toBe("resolved_pending");
});

test("filter by severity narrows the queue", async ({ page }) => {
  await seedIssue({ title: "Broken hostel tap", department: "Hostel", severity: "high" });
  await seedIssue({ title: "Flickering corridor bulb", department: "Hostel", severity: "low" });
  await signIn(page, await newUser("authority", "Hostel"));
  await page.goto("/authority");
  await expect(page.getByRole("link", { name: "Broken hostel tap" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Flickering corridor bulb" })).toBeVisible();
  await page.getByLabel("Severity").selectOption("high");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/severity=high/);
  await expect(page.getByRole("link", { name: "Broken hostel tap" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Flickering corridor bulb" })).toHaveCount(0);
});

test("IT authority sees the Hostel issue but gets an error on transition", async ({ page }) => {
  const id = await seedIssue({ department: "Hostel" });
  await signIn(page, await newUser("authority", "IT Services"));
  await page.goto(`/authority/${id}`);
  await expect(page.getByText(BODY)).toBeVisible();
  await page.getByRole("button", { name: "Mark In progress" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "You can't change this issue." })).toBeVisible();
  const { data } = await adminClient().from("issues").select("status").eq("id", id).single();
  expect(data?.status).toBe("open");
});

test("admin triages an untriaged report to Maintenance", async ({ page }) => {
  const id = await seedIssue({ title: "Untriaged report", needsTriage: true, severity: null });
  await signIn(page, await newUser("college_admin"));
  await page.goto("/authority");
  const form = page.getByRole("region", { name: "Needs triage" });
  await expect(form.getByText("Untriaged report")).toBeVisible();
  await form.getByLabel("Department").selectOption({ label: "Maintenance" });
  await form.getByLabel("Category").selectOption("water");
  await form.getByLabel("Severity").selectOption("high");
  await form.getByLabel("Title").fill("Leaking pipe in corridor");
  await form.getByRole("button", { name: "Route issue" }).click();
  await expect(page.getByRole("link", { name: "Leaking pipe in corridor" })).toBeVisible();
  const { data } = await adminClient()
    .from("issues")
    .select("needs_triage, departments(name)")
    .eq("id", id)
    .single();
  expect(data?.needs_triage).toBe(false);
  expect((data?.departments as unknown as { name: string }).name).toBe("Maintenance");
});

test("admin sets high deadline to 1 minute, waits, runs the check, sees level 1", async ({ page }) => {
  const id = await seedIssue({ title: "Late issue", department: "Hostel", severity: "high" });
  await signIn(page, await newUser("college_admin"));
  await page.goto("/authority");
  await page.getByLabel("High (minutes)").fill("1");
  await page.getByRole("button", { name: "Save deadlines" }).click();
  await expect(page.getByText("Deadlines saved.")).toBeVisible();
  // Stand in for the wait: push the deadline into the past instead of sleeping 60 s.
  const { error } = await adminClient()
    .from("issues")
    .update({ due_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", id);
  if (error) throw error;
  await page.getByRole("button", { name: "Run deadline check now" }).click();
  await expect(page.getByText("Escalated 1, tallied 0.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Late issue" });
  await expect(row.getByRole("cell", { name: "Level 1" })).toBeVisible();
});

test("metric tiles render \"No data yet\" on an empty college", async ({ page }) => {
  await signIn(page, await newUser("college_admin"));
  await page.goto("/authority");
  await expect(page.getByText("No data yet")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Open issues", exact: true })).toBeVisible();
});

test("student gets 404 on /authority", async ({ page }) => {
  await signIn(page, await newUser("student"));
  // The page streams inside Suspense, so the status is already 200 when notFound() renders.
  await page.goto("/authority");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authority dashboard" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
});

test("authority does not see the admin-only sections", async ({ page }) => {
  await signIn(page, await newUser("authority", "Hostel"));
  await page.goto("/authority");
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs triage" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deadlines" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run deadline check now" })).toHaveCount(0);
});

test("Find patterns shows a Hypothesis card that can be accepted", async ({ page }) => {
  const ids = [
    await seedIssue({ title: "Tap leaking one", department: "Hostel" }),
    await seedIssue({ title: "Tap leaking two", department: "Hostel" }),
    await seedIssue({ title: "Tap leaking three", department: "Hostel" }),
  ];
  await signIn(page, await newUser("authority", "Hostel"));
  await page.goto("/authority");
  await page.getByRole("button", { name: "Find patterns" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "Hypothesis" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Hostel Block A")).toBeVisible();
  await expect(card.getByRole("link", { name: "Tap leaking one" })).toHaveAttribute("href", `/authority/${ids[0]}`);
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByText("Accepted")).toBeVisible();
  const { data } = await adminClient().from("root_cause_insights").select("status, decided_by").eq("college_id", COLLEGE);
  expect(data).toHaveLength(1);
  expect(data![0].status).toBe("accepted");
  expect(data![0].decided_by).not.toBeNull();
});
