import { afterEach, describe, expect, test, vi } from "vitest";
import { createClaudeModel, getModelClient, toClaudeMessages, toModelTurn } from "@/agent/model";
import type { AgentMessage, ModelClient } from "@/agent/types";

afterEach(() => vi.unstubAllEnvs());

const args = (message: string, extra: AgentMessage[] = []) => ({
  system: "s",
  tools: [],
  messages: [{ role: "user", content: message } as AgentMessage, ...extra],
});

function fakeClient(...responses: unknown[]) {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { create, client: { beta: { messages: { create } } } };
}

describe("getModelClient", () => {
  test("getModelClient refuses the scripted model when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_TEST_MODEL", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "not-a-real-key");
    expect(() => getModelClient()).toThrow(/scripted model/i);
  });

  test("returns the scripted model when AGENT_TEST_MODEL=1 outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AGENT_TEST_MODEL", "1");
    const turn = await getModelClient().next(args("show my marks"));
    expect(turn.toolCalls.map((c) => c.name)).toEqual(["get_marks"]);
  });

  test("a missing ANTHROPIC_API_KEY fails when the model is called, not when it is built", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const model: ModelClient = getModelClient();
    await expect(model.next(args("hi"))).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("adapter", () => {
  test("adapter maps a Claude response to ModelTurn", () => {
    const turn = toModelTurn({
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "x" },
        { type: "text", text: "Let me " },
        { type: "text", text: "check." },
        { type: "tool_use", id: "t1", name: "get_marks", input: { semester: 2 } },
      ],
    } as never);
    expect(turn).toEqual({
      text: "Let me check.",
      toolCalls: [{ id: "t1", name: "get_marks", input: { semester: 2 } }],
    });
  });

  test.each(["max_tokens", "refusal", "model_context_window_exceeded", "pause_turn"])(
    "a %s stop is a failure, not a finished answer",
    (stop_reason) => {
      expect(() =>
        toModelTurn({ stop_reason, content: [{ type: "text", text: "Partial ans" }] } as never),
      ).toThrow();
    },
  );

  test("an end_turn with no text and no tool calls is a failure", () => {
    expect(() => toModelTurn({ stop_reason: "end_turn", content: [] } as never)).toThrow();
  });

  test("maps tool calls and puts every result of one turn in one user message", () => {
    const mapped = toClaudeMessages([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        text: "Checking.",
        toolCalls: [
          { id: "a", name: "get_marks", input: {} },
          { id: "b", name: "create_study_plan", input: { title: "T" } },
        ],
      },
      {
        role: "tool",
        results: [
          { id: "a", output: "ok", isError: false },
          { id: "b", output: "bad", isError: true },
        ],
      },
    ]);
    expect(mapped).toEqual([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "a", name: "get_marks", input: {} },
          { type: "tool_use", id: "b", name: "create_study_plan", input: { title: "T" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "ok", is_error: false },
          { type: "tool_result", tool_use_id: "b", content: "bad", is_error: true },
        ],
      },
    ]);
  });

  test("omits an empty text block from an assistant turn", () => {
    const mapped = toClaudeMessages([
      { role: "assistant", text: "", toolCalls: [{ id: "a", name: "get_marks", input: {} }] },
    ]);
    expect(mapped).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "get_marks", input: {} }] },
    ]);
  });

  test("sends the configured model, drops $schema from tools, and never forces a tool", async () => {
    const { client, create } = fakeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done" }],
    });
    const model = createClaudeModel({ client: client as never, model: "claude-test" });
    const turn = await model.next({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "get_marks",
          description: "d",
          input_schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
        },
      ],
    });
    expect(turn).toEqual({ text: "Done", toolCalls: [] });
    const sent = create.mock.calls[0][0];
    expect(sent.model).toBe("claude-test");
    expect(sent.system).toBe("sys");
    expect(sent.tools).toEqual([
      { name: "get_marks", description: "d", input_schema: { type: "object" } },
    ]);
    expect(sent.tool_choice).toBeUndefined();
    expect(sent.thinking).toBeUndefined();
  });

  test("replays the assistant turn unchanged, thinking blocks included", async () => {
    const content = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "t1", name: "get_marks", input: {} },
    ];
    const { client, create } = fakeClient(
      { stop_reason: "tool_use", content },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
    );
    const model = createClaudeModel({ client: client as never, model: "m" });
    const first = await model.next(args("marks"));
    await model.next(
      args("marks", [
        { role: "assistant", text: first.text, toolCalls: first.toolCalls },
        { role: "tool", results: [{ id: "t1", output: "[]", isError: false }] },
      ]),
    );
    expect(create.mock.calls[1][0].messages[1]).toEqual({ role: "assistant", content });
  });

  test("after a fallback, replay leaves out thinking and tool_use from before the switch", async () => {
    const content = [
      { type: "thinking", thinking: "", signature: "old" },
      { type: "text", text: "Partial" },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "tool_use", id: "t1", name: "get_marks", input: {} },
    ];
    const { client, create } = fakeClient(
      { stop_reason: "tool_use", content },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
    );
    const model = createClaudeModel({ client: client as never, model: "m" });
    const first = await model.next(args("marks"));
    await model.next(
      args("marks", [
        { role: "assistant", text: first.text, toolCalls: first.toolCalls },
        { role: "tool", results: [{ id: "t1", output: "[]", isError: false }] },
      ]),
    );
    expect(create.mock.calls[1][0].messages[1].content).toEqual(content.slice(1));
  });
});
