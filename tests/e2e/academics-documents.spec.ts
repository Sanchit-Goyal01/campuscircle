import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../helpers/supabase";
import { imageOnlyPdf, textPdf } from "../fixtures/pdf";

const PASSWORD = "e2e-password-123!";
const PDF = "application/pdf";
// Embedding runs on the real Edge Function, whose first call loads the model.
const UPLOADED = { timeout: 45_000 };

type User = { id: string; name: string };

async function signUp(page: Page, domain = "demo-iot.edu"): Promise<User> {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const name = `Docs ${id}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("College email").fill(`docs${id}@${domain}`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { id, name };
}

const buf = (bytes: Uint8Array) => Buffer.from(bytes);

async function uploadNote(page: Page, title: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/academics/notes");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("PDF file").setInputFiles(file);
  await page.getByRole("button", { name: "Upload note" }).click();
}

async function uploadPaper(page: Page, subject: string, year: string, examType: string, buffer: Buffer) {
  await page.goto("/academics/papers");
  await page.getByRole("combobox", { name: "Subject", exact: true }).selectOption({ label: subject });
  await page.getByRole("spinbutton", { name: "Year" }).fill(year);
  await page.getByRole("combobox", { name: "Exam type" }).selectOption(examType);
  await page.getByLabel("PDF file").setInputFiles({ name: "paper.pdf", mimeType: PDF, buffer });
  await page.getByRole("button", { name: "Upload paper" }).click();
}

test("student uploads a text PDF and sees it as Ready", async ({ page }) => {
  const user = await signUp(page);
  const title = `Normalisation ${user.id}`;
  const bytes = await textPdf([
    "Normalisation removes redundancy from relations. First normal form requires atomic values in every column.",
    "Second normal form removes partial dependencies on a composite key; third normal form removes transitive ones.",
  ]);
  await uploadNote(page, title, { name: "dbms.pdf", mimeType: PDF, buffer: buf(bytes) });
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible(UPLOADED);
  await expect(row.getByText("Ready", { exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible(); // page count
  await expect(row.getByText(user.name)).toBeVisible();
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("image-only PDF shows 'Not searchable (scanned PDF)'", async ({ page }) => {
  const user = await signUp(page);
  const title = `Scan ${user.id}`;
  await uploadNote(page, title, { name: "scan.pdf", mimeType: PDF, buffer: buf(await imageOnlyPdf(2)) });
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByText("Not searchable (scanned PDF)")).toBeVisible();
});

test("a .txt file renamed .pdf is refused with 'Only PDF files are allowed.'", async ({ page }) => {
  const user = await signUp(page);
  const title = `Fake ${user.id}`;
  await uploadNote(page, title, {
    name: "fake.pdf",
    mimeType: PDF,
    buffer: Buffer.from("this is plain text, not a PDF"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "Only PDF files are allowed." })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
});

test("student uploads a past paper and a classmate in the same college can download it", async ({ page, browser }) => {
  await signUp(page);
  const bytes = await textPdf(["Question one: define a transaction and list the ACID properties of a database."]);
  await uploadPaper(page, "DBMS", "2023", "midterm", buf(bytes));
  const row = page.getByRole("row").filter({ hasText: "DBMS" }).filter({ hasText: "2023" });
  await expect(row.first()).toBeVisible(UPLOADED);

  const mateContext = await browser.newContext();
  const matePage = await mateContext.newPage();
  await signUp(matePage);
  await matePage.goto("/academics/papers");
  const mateRow = matePage.getByRole("row").filter({ hasText: "DBMS" }).filter({ hasText: "2023" }).first();
  await expect(mateRow).toBeVisible();
  const href = await mateRow.getByRole("link", { name: "Download" }).getAttribute("href");
  expect(href).toMatch(/^\/api\/academics\/files\/papers\/[0-9a-f-]{36}$/);

  const redirect = await matePage.request.get(href!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const signed = redirect.headers()["location"];
  expect(signed).toContain("/storage/v1/object/sign/academics/");
  expect(signed).toContain("/papers/");
  const file = await matePage.request.get(signed);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await mateContext.close();
});

test("student of another college does not see the note or the paper", async ({ page, browser }) => {
  const user = await signUp(page);
  const title = `Private ${user.id}`;
  await uploadNote(page, title, {
    name: "n.pdf",
    mimeType: PDF,
    buffer: buf(await textPdf(["Deadlocks need mutual exclusion, hold and wait, no preemption and circular wait."])),
  });
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible(UPLOADED);
  const noteHref = await page.getByRole("link", { name: title, exact: true }).getAttribute("href");
  await uploadPaper(page, "DBMS", "2022", "endterm", buf(await textPdf(["Paper text for the other college check."])));
  const paperHref = await page
    .getByRole("row")
    .filter({ hasText: "2022" })
    .first()
    .getByRole("link", { name: "Download" })
    .getAttribute("href");

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signUp(other, "demo-arts.edu");
  await other.goto("/academics/notes");
  await expect(other.getByText("No notes yet.")).toBeVisible();
  await expect(other.getByText(title)).toHaveCount(0);
  await other.goto("/academics/papers");
  await expect(other.getByText("No past papers yet.")).toBeVisible();
  // Direct links answer 404 for the other college.
  expect((await other.request.get(noteHref!.replace("/academics/notes/", "/api/academics/files/notes/"), { maxRedirects: 0 })).status()).toBe(404);
  expect((await other.request.get(paperHref!, { maxRedirects: 0 })).status()).toBe(404);
  await otherContext.close();
});

test("uploader deletes a note; a classmate sees no delete button", async ({ page, browser }) => {
  const user = await signUp(page);
  const title = `Delete me ${user.id}`;
  await uploadNote(page, title, {
    name: "n.pdf",
    mimeType: PDF,
    buffer: buf(await textPdf(["Paging splits memory into fixed size frames and virtual memory into pages."])),
  });
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible(UPLOADED);

  const mateContext = await browser.newContext();
  const matePage = await mateContext.newPage();
  await signUp(matePage);
  await matePage.goto("/academics/notes");
  await expect(matePage.getByRole("row").filter({ hasText: title })).toBeVisible();
  await expect(matePage.getByRole("button", { name: `Delete ${title}` })).toHaveCount(0);
  await mateContext.close();

  const db = adminClient();
  const { data: note } = await db.from("notes").select("id, file_path").eq("title", title).single();
  expect(note).not.toBeNull();
  const [folder, name] = [note!.file_path.replace(/\/[^/]+$/, ""), note!.file_path.split("/").pop()];
  const stored = async () => (await db.storage.from("academics").list(folder)).data?.some((o) => o.name === name);
  expect(await stored()).toBe(true);

  await page.getByRole("button", { name: `Delete ${title}` }).click();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
  // The row and its Storage object are both gone.
  const { data: rows } = await db.from("notes").select("id").eq("id", note!.id);
  expect(rows).toEqual([]);
  expect(await stored()).toBe(false);
});
