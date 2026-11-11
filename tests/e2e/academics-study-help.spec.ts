import { expect, test, type Page } from "@playwright/test";
import { imageOnlyPdf, textPdf } from "../fixtures/pdf";

const PASSWORD = "e2e-password-123!";
const PDF = "application/pdf";
// Embedding runs on the real Edge Function, whose first call loads the model.
const UPLOADED = { timeout: 45_000 };

async function signUp(page: Page, domain = "demo-iot.edu") {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(`Help ${id}`);
  await page.getByLabel("College email").fill(`help${id}@${domain}`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  return id;
}

/** Uploads a note and opens its page. The scripted model treats any text with "fail" as an error, so fixtures avoid it. */
async function openNote(page: Page, title: string, buffer: Buffer, status: string) {
  await page.goto("/academics/notes");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("PDF file").setInputFiles({ name: "n.pdf", mimeType: PDF, buffer });
  await page.getByRole("button", { name: "Upload note" }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByText(status, { exact: true })).toBeVisible(UPLOADED);
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

const textNote = async () =>
  Buffer.from(
    await textPdf([
      "Normalisation removes redundancy from relations. First normal form requires atomic values in every column.",
    ]),
  );

test('student asks a question and sees the answer with a "Page 1" citation', async ({ page }) => {
  const id = await signUp(page);
  await openNote(page, `Ask ${id}`, await textNote(), "Ready");
  await page.getByLabel("Your question").fill("What does normalisation remove?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const result = page.getByLabel("Study help result");
  await expect(result.getByText("normalisation removes redundancy")).toBeVisible();
  const link = result.getByRole("link", { name: "Page 1" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/api\/academics\/files\/notes\/[0-9a-f-]{36}#page=1$/);
});

test("student gets a summary", async ({ page }) => {
  const id = await signUp(page);
  await openNote(page, `Sum ${id}`, await textNote(), "Ready");
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByLabel("Study help result").getByText("Scripted summary of the note.")).toBeVisible();
});

test("student generates a quiz, picks answers, and sees the score", async ({ page }) => {
  const id = await signUp(page);
  await openNote(page, `Quiz ${id}`, await textNote(), "Ready");
  await page.getByRole("button", { name: "Quiz me" }).click();
  await expect(page.getByRole("group")).toHaveCount(5);
  // Scripted correct options are A, B, C, D, A. Get the first three right and the last two wrong.
  for (const [q, letter] of [[1, "A"], [2, "B"], [3, "C"], [4, "A"], [5, "B"]] as const) {
    await page.getByLabel(`Q${q} option ${letter}`).check();
  }
  await page.getByRole("button", { name: "Check answers" }).click();
  await expect(page.getByRole("status")).toHaveText("Score: 3 / 5");
  await expect(page.getByText("Not quite. The answer is: Q4 option D.")).toBeVisible();
});

test('scanned note shows "This PDF has no text we can read." and no help buttons', async ({ page }) => {
  const id = await signUp(page);
  await openNote(page, `Scan ${id}`, Buffer.from(await imageOnlyPdf(2)), "Not searchable (scanned PDF)");
  await expect(page.getByText("This PDF has no text we can read.")).toBeVisible();
  for (const name of ["Ask", "Summarise", "Quiz me"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  // The API refuses it too.
  const noteId = page.url().split("/").pop()!;
  const res = await page.request.post(`/api/academics/notes/${noteId}/help`, { data: { mode: "summary" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("This PDF has no text we can read.");
});

test("help route: 401 signed out, 400 bad input, 404 for a note of another college", async ({ page, browser }) => {
  const id = await signUp(page);
  await openNote(page, `Api ${id}`, await textNote(), "Ready");
  const noteId = page.url().split("/").pop()!;
  const url = `/api/academics/notes/${noteId}/help`;
  expect((await page.request.post(url, { data: { mode: "ask" } })).status()).toBe(400); // no question
  expect((await page.request.post(url, { data: { mode: "essay" } })).status()).toBe(400);

  const anon = await browser.newContext();
  expect((await anon.request.post(new URL(url, page.url()).href, { data: { mode: "summary" } })).status()).toBe(401);
  await anon.close();

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signUp(other, "demo-arts.edu");
  const res = await other.request.post(new URL(url, page.url()).href, { data: { mode: "summary" } });
  expect(res.status()).toBe(404);
  await otherContext.close();
});
