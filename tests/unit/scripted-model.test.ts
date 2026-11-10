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

  test.each([
    ["which subjects are my WEAK ones", "get_weak_subjects", {}],
    ["find notes on normalization", "search_notes", { query: "normalization" }],
    ["any past papers?", "get_past_papers", {}],
    ["when is my next exam", "get_timetable", {}],
  ])('"%s" calls %s', async (message, name, input) => {
    const turn = await next([user(message)]);
    expect(turn.toolCalls.map((c) => c.name)).toEqual([name]);
    expect(turn.toolCalls[0].input).toEqual(input);
  });

  test("read keywords win over plan and marks, in a fixed order, but not over fail", async () => {
    const name = async (m: string) => (await next([user(m)])).toolCalls[0]?.name;
    expect(await name("plan from my weak marks")).toBe("get_weak_subjects");
    expect(await name("plan for exam marks")).toBe("get_timetable");
    expect(await name("notes and papers")).toBe("search_notes");
    expect(await name("papers and exam")).toBe("get_past_papers");
    await expect(next([user("weak, but fail")])).rejects.toThrow();
  });

  test('"plan" sends a valid create_study_plan input', async () => {
    const turn = await next([user("make me a plan")]);
    expect(turn.toolCalls[0].name).toBe("create_study_plan");
    expect(createStudyPlan.input.safeParse(turn.toolCalls[0].input).success).toBe(true);
  });

  test('"plan" dates start the day after today', async () => {
    const model = createScriptedModel(() => new Date("2026-11-06T19:00:00Z"));
    const turn = await model.next({ system: "", tools: [], messages: [user("a plan")] });
    const { items } = turn.toolCalls[0].input as { items: { due_on: string }[] };
    expect(items.map((i) => i.due_on)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
  });

  test("a lone submit_* tool is called with a valid payload, before every keyword but fail", async () => {
    const tool = (name: string) => [{ name, description: "", input_schema: {} }];
    const run = (name: string, m: string) =>
      createScriptedModel().next({ system: "", tools: tool(name), messages: [user(m)] });
    const answer = await run("submit_answer", "notes about my weak marks plan");
    expect(answer.toolCalls[0]).toMatchObject({ name: "submit_answer", input: { pages: [1] } });
    const quiz = (await run("submit_quiz", "quiz")).toolCalls[0].input as {
      questions: { options: string[]; answer_index: number; page: number }[];
    };
    expect(quiz.questions).toHaveLength(5);
    expect(quiz.questions.every((q) => q.options.length === 4 && q.answer_index >= 0 && q.answer_index <= 3 && q.page === 1)).toBe(true);
    expect((await run("submit_summary", "x")).toolCalls[0].name).toBe("submit_summary");
    await expect(run("submit_summary", "please fail")).rejects.toThrow();
    // Two tools, or a non-submit tool, do not take this path.
    const two = await createScriptedModel().next({
      system: "",
      tools: [...tool("submit_quiz"), ...tool("get_marks")],
      messages: [user("hello")],
    });
    expect(two.toolCalls).toEqual([]);
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
