import { beforeAll, describe, expect, test } from "vitest";
import { createScriptedModel } from "@/agent/scripted-model";
import { edgeEmbedder } from "@/modules/academics/embed";
import { fileIssueReport } from "@/modules/issues/intake";
import { adminClient, createCollege, createStudent } from "../helpers/supabase";

const run = Math.random().toString(36).slice(2, 8);
const dom = `in-${run}.edu`;
type U = Awaited<ReturnType<typeof createStudent>>;
let hostel: string;
let library: string;
let s1: U;
let s2: U;
let s3: U;
let s4: U;

const model = createScriptedModel();
const file = (u: U, location_id: string, body: string) =>
  fileIssueReport({
    db: u.client,
    input: { location_id, body, photo_paths: [] },
    classifier: model,
    matcher: model,
    embedder: edgeEmbedder,
  });
const issue = async (id: string) =>
  (await adminClient().from("issues").select("*").eq("id", id).single()).data!;

beforeAll(async () => {
  const admin = adminClient();
  const college = await createCollege(`Intake College ${run}`, dom);
  const loc = await admin
    .from("locations")
    .insert([
      { college_id: college, name: "Hostel Block A" },
      { college_id: college, name: "Library" },
    ])
    .select("id, name");
  expect(loc.error).toBeNull();
  hostel = loc.data!.find((l) => l.name === "Hostel Block A")!.id;
  library = loc.data!.find((l) => l.name === "Library")!.id;
  const d = await admin
    .from("departments")
    .insert(["Hostel", "Maintenance", "IT Services"].map((name) => ({ college_id: college, name })));
  expect(d.error).toBeNull();
  [s1, s2, s3, s4] = await Promise.all([1, 2, 3, 4].map((i) => createStudent(`s${i}-${run}@${dom}`)));
});

// The first embedding call cold-starts the Edge Function.
describe("issue intake", { timeout: 60_000 }, () => {
  test("two water reports at Hostel Block A from different students merge", async () => {
    const text = "The water cooler on the second floor is not working at all.";
    const first = await file(s1, hostel, text);
    expect(first.merged).toBe(false);
    expect(first.needs_triage).toBe(false);
    const second = await file(s2, hostel, text);
    expect(second.merged).toBe(true);
    expect(second.issue_id).toBe(first.issue_id);
    expect((await issue(first.issue_id)).report_count).toBe(2);
  });

  test("report containing fail is stored with needs_triage", async () => {
    const r = await file(s3, hostel, "The projector will fail every time we turn it on.");
    expect(r.needs_triage).toBe(true);
    expect((await issue(r.issue_id)).needs_triage).toBe(true);
  });

  test("same text at Library does not merge with Hostel Block A", async () => {
    const text = "The water cooler near the entrance is not working today.";
    const a = await file(s4, hostel, text);
    const b = await file(s4, library, text);
    expect(b.issue_id).not.toBe(a.issue_id);
    expect(b.merged).toBe(false);
  });
});
