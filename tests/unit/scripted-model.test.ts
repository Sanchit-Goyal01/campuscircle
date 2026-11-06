import { describe, expect, test } from "vitest";
import { createScriptedModel } from "@/agent/scripted-model";
import type { AgentMessage } from "@/agent/types";
import { createStudyPlan } from "@/modules/academics/tools";

const next = (messages: AgentMessage[]) =>
  createScriptedModel().next({ system: "", tools: [], messages });
const user = (content: string): AgentMessage => ({ role: "user", content });

describe("scripted model", () => {
  test('"marks" calls get_marks', async () => {
    const turn = await next([user("How are my MARKS?")]);
    expect(turn.toolCalls.map((c) => c.name)).toEqual(["get_marks"]);
  });

  test('"plan" sends a valid create_study_plan input', async () => {
    const turn = await next([user("make me a plan")]);
    expect(turn.toolCalls[0].name).toBe("create_study_plan");
    expect(createStudyPlan.input.safeParse(turn.toolCalls[0].input).success).toBe(true);
  });

  test('"unsaveable" sends input that passes validation but a date Postgres refuses', async () => {
    const turn = await next([user("an unsaveable plan")]);
    expect(createStudyPlan.input.safeParse(turn.toolCalls[0].input).success).toBe(true);
    expect(JSON.stringify(turn.toolCalls[0].input)).toContain("0000-01-01");
  });

  test('"fail" throws', async () => {
    await expect(next([user("please fail")])).rejects.toThrow();
  });

  test("other messages get plain text with no tool calls", async () => {
    const turn = await next([user("hello")]);
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).not.toBe("");
  });

  test("after tool results it ends with text, so the loop cannot spin", async () => {
    const turn = await next([
      user("my marks"),
      { role: "assistant", text: "", toolCalls: [{ id: "x", name: "get_marks", input: {} }] },
      { role: "tool", results: [{ id: "x", output: "[]", isError: false }] },
    ]);
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).not.toBe("");
  });
});
