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

  describe("issue intake forced tools", () => {
    const forced = (name: string, content: string) =>
      createScriptedModel().next({ system: "", tools: [], messages: [user(content)], toolChoice: { name } });
    test("submit_classification: water", async () => {
      const t = await forced("submit_classification", "The Water cooler is broken");
      expect(t.toolCalls[0]).toMatchObject({
        name: "submit_classification",
        input: { title: "Water cooler not working", category: "water", severity: "high", department: "Hostel" },
      });
    });
    test("submit_classification: other uses the report text", async () => {
      const t = await forced("submit_classification", "<report>Broken Chair in room 4</report>");
      expect(t.toolCalls[0].input).toEqual({
        title: "Broken Chair in room 4",
        category: "other",
        severity: "medium",
        department: "Maintenance",
      });
    });
    test("fail still throws", async () => {
      await expect(forced("submit_classification", "this will fail")).rejects.toThrow();
    });
    test("submit_match returns the first UUID after Candidates:", async () => {
      const id = "aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb";
      const t = await forced("submit_match", `<report>aaaaaaaa-2222-4222-8222-cccccccccccc</report>\n\n<candidates>\nCandidates:\n${id} Leak\n</candidates>`);
      expect(t.toolCalls[0].input).toEqual({ issue_id: id });
      expect((await forced("submit_match", "report")).toolCalls[0].input).toEqual({ issue_id: null });
    });
    test("submit_insight", async () => {
      const t = await forced("submit_insight", "x");
      expect(t.toolCalls[0].input).toEqual({
        hypothesis: "Scripted hypothesis: shared plumbing on this floor.",
        confidence: "medium",
      });
    });
  });

  test("issue keywords: my complaints before complain, campus, and weak", async () => {
    const name = async (m: string) => (await next([user(m)])).toolCalls[0]?.name;
    expect(await name("show my complaints")).toBe("get_my_complaints");
    expect(await name("I want to complain about my complaints")).toBe("get_my_complaints");
    expect(await name("what is open on campus")).toBe("get_campus_status");
    expect(await name("campus complain")).toBe("get_campus_status");
    expect(await name("I want to complain")).toBe("file_complaint");
    expect(await name("complain about weak wifi")).toBe("file_complaint");
    expect(await name("campus weak marks")).toBe("get_campus_status");
    expect(await name("my weak marks")).toBe("get_weak_subjects");
    expect(await name("make me a plan")).toBe("create_study_plan");
    await expect(next([user("complain, but fail")])).rejects.toThrow();
  });

  test("issue tools finish with their done texts", async () => {
    const done = async (m: string) => {
      const turn = await next([
        user(m),
        { role: "assistant", text: "", toolCalls: [{ id: "1", name: "x", input: {} }] },
        { role: "tool", results: [{ id: "1", output: "{}", isError: false }] },
      ]);
      return turn.text;
    };
    expect(await done("my complaints")).toBe("I checked your complaints.");
    expect(await done("campus")).toBe("I checked open issues on campus.");
    expect(await done("complain")).toBe("I drafted a complaint. It is waiting for your approval.");
  });
});
