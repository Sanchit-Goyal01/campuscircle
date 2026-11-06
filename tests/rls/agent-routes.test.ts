import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { adminClient, createCollege, createStudent, invalidTokenClient } from "../helpers/supabase";
import type { ModelClient, ToolContext } from "../../src/agent/types";

// Runs the real route handlers against the real database. Only the cookie session is replaced.
const session = vi.hoisted(() => ({
  ctx: null as ToolContext | null,
  model: null as ModelClient | null,
}));
vi.mock("@/lib/supabase/server", () => ({ getToolContext: async () => session.ctx }));
vi.mock("@/agent/model", async (importActual) => {
  const actual = await importActual<typeof import("../../src/agent/model")>();
  return { ...actual, getModelClient: () => session.model ?? actual.getModelClient() };
});

import { POST as approve } from "../../src/app/api/agent/actions/[id]/approve/route";
import { POST as runs } from "../../src/app/api/agent/runs/route";
import { executeToolCall } from "../../src/agent/executor";
import { allTools } from "../../src/modules";

const tag = Math.random().toString(36).slice(2, 8);
const dom = `ar-${tag}.edu`;
let college: string;
let student: { id: string; client: SupabaseClient };

const ctxWith = (db: SupabaseClient): ToolContext => ({
  db,
  userId: student.id,
  collegeId: college,
  role: "student",
});

const goodPlan = { title: "Exam prep", items: [{ due_on: "2026-12-01", task: "Revise" }] };
const badPlan = { title: "Exam prep", items: [{ due_on: "0000-01-01", task: "Revise" }] };

async function pendingAction(input: unknown) {
  const { data, error } = await student.client
    .from("agent_runs")
    .insert({ student_id: student.id, college_id: college, message: "hi" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const out = await executeToolCall({ name: "create_study_plan", input }, allTools, ctxWith(student.client), data!.id);
  if (out.status !== "pending_approval") throw new Error("expected pending");
  return out.actionId;
}

const callApprove = (id: string) =>
  approve(new Request(`http://test/api/agent/actions/${id}/approve`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

const callRuns = (message: string) =>
  runs(new Request("http://test/api/agent/runs", { method: "POST", body: JSON.stringify({ message }) }));

async function actionRow(id: string) {
  const { data, error } = await adminClient()
    .from("agent_pending_actions")
    .select("status, result")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function planCount() {
  const { count, error } = await adminClient()
    .from("study_plans")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student.id);
  expect(error).toBeNull();
  return count!;
}

beforeAll(async () => {
  college = await createCollege(`Routes College ${tag}`, dom);
  student = await createStudent(`s-${tag}@${dom}`);
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  session.ctx = ctxWith(student.client);
  session.model = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("approve", () => {
  test("an approve RPC error is 500, the row stays pending, and a retry saves", async () => {
    const id = await pendingAction(goodPlan);
    const before = await planCount();
    session.ctx = ctxWith(invalidTokenClient());

    const res = await callApprove(id);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/JWT|token/i);
    expect((await actionRow(id)).status).toBe("pending");

    session.ctx = ctxWith(student.client);
    const retry = await callApprove(id);
    expect((await retry.json()).status).toBe("done");
    expect(await planCount()).toBe(before + 1);
  });

  test("a saved plan whose result was not recorded is done with a warning", async () => {
    const id = await pendingAction(goodPlan);
    const before = await planCount();
    const finishFails = new Proxy(student.client, {
      get(target, key, receiver) {
        if (key !== "rpc") return Reflect.get(target, key, receiver);
        return (name: string, args: Record<string, unknown>) =>
          name === "finish_pending_action"
            ? Promise.resolve({ data: null, error: { message: "raw finish failure" } })
            : target.rpc(name, args);
      },
    });
    session.ctx = ctxWith(finishFails);

    const res = await callApprove(id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("raw finish failure");
    const body = JSON.parse(text);
    expect(body.status).toBe("done");
    expect(body.result.planId).toEqual(expect.any(String));
    expect(body.warning).toEqual(expect.any(String));
    expect(await planCount()).toBe(before + 1);
    expect((await actionRow(id)).status).toBe("approved");
  });

  test("a real database failure is failed with a plain reason; the row keeps the real error", async () => {
    const id = await pendingAction(badPlan);
    const before = await planCount();

    const res = await callApprove(id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/Could not save plan items|date\/time|out of range/);
    expect(JSON.parse(text).status).toBe("failed");

    const row = await actionRow(id);
    expect(row.status).toBe("failed");
    expect(JSON.stringify(row.result)).toContain("Could not save plan items");
    expect(await planCount()).toBe(before);
  });
});

describe("runs", () => {
  test("a missing API key gives 502 and the body does not name the variable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AGENT_TEST_MODEL", "");
    const res = await callRuns("hello");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("ANTHROPIC_API_KEY");

    const { data } = await adminClient()
      .from("agent_steps")
      .select("payload")
      .eq("run_id", JSON.parse(text).runId)
      .eq("kind", "error")
      .single();
    expect(JSON.stringify(data!.payload)).toContain("ANTHROPIC_API_KEY");
  });

  test("a tool error reaches the model unchanged but not the response body", async () => {
    let toolOutput = "";
    session.model = {
      async next({ messages }) {
        const last = messages.at(-1);
        if (last?.role === "tool") {
          toolOutput = last.results[0].output;
          return { text: "That did not work.", toolCalls: [] };
        }
        return { text: "", toolCalls: [{ id: "c1", name: "create_study_plan", input: { title: 5 } }] };
      },
    };
    const res = await callRuns("hello");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("Invalid input for");
    expect(toolOutput).toContain("Invalid input for create_study_plan");
  });
});
