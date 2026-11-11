import { afterEach, describe, expect, test, vi } from "vitest";
import { createOpenAICompatModel, retryAfterMs, toChatMessages } from "@/agent/openai-compat";
import { getModelClient } from "@/agent/model";
import type { AgentMessage } from "@/agent/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const user = (content: string): AgentMessage => ({ role: "user", content });
const BASE = "https://api.example.test/v1";

function reply(message: Record<string, unknown>, finish_reason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason }] }), { status: 200 });
}

function fakeFetch(...responses: Response[]) {
  const fetch = vi.fn();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  return fetch;
}

const body = (fetch: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(fetch.mock.calls[call][1].body);
const make = (fetch: ReturnType<typeof vi.fn>, model = "m") =>
  createOpenAICompatModel({ provider: "Groq", baseUrl: BASE, apiKey: "k", model, fetch: fetch as never });

describe("toChatMessages", () => {
  test("maps system, user, assistant tool calls and tool results", () => {
    const messages: AgentMessage[] = [
      user("hi"),
      { role: "assistant", text: "checking", toolCalls: [{ id: "c1", name: "get_marks", input: { semester: 4 } }] },
      { role: "tool", results: [{ id: "c1", output: "<tool_data>[]</tool_data>", isError: false }] },
    ];
    expect(toChatMessages("sys", messages)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "checking",
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_marks", arguments: '{"semester":4}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: "<tool_data>[]</tool_data>" },
    ]);
  });

  test("an assistant turn with only tool calls sends null content", () => {
    const out = toChatMessages("s", [{ role: "assistant", text: "", toolCalls: [{ id: "c1", name: "t", input: {} }] }]);
    expect(out[1]).toMatchObject({ role: "assistant", content: null });
  });

  test("marks a failed tool result as an error", () => {
    const out = toChatMessages("s", [{ role: "tool", results: [{ id: "c1", output: "boom", isError: true }] }]);
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "Error: boom" });
  });
});

describe("createOpenAICompatModel", () => {
  test("sends tools, auth and the model, and parses text and tool calls", async () => {
    const fetch = fakeFetch(
      reply(
        { content: "ok", tool_calls: [{ id: "c9", type: "function", function: { name: "get_marks", arguments: '{"a":1}' } }] },
        "tool_calls",
      ),
    );
    const turn = await make(fetch, "llama-x").next({
      system: "s",
      messages: [user("hi")],
      tools: [{ name: "get_marks", description: "d", input_schema: { $schema: "x", type: "object", properties: {} } }],
    });
    expect(turn).toEqual({ text: "ok", toolCalls: [{ id: "c9", name: "get_marks", input: { a: 1 } }] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/chat/completions`);
    expect(init.headers.Authorization).toBe("Bearer k");
    const sent = body(fetch);
    expect(sent.model).toBe("llama-x");
    expect(sent.tools).toEqual([
      { type: "function", function: { name: "get_marks", description: "d", parameters: { type: "object", properties: {} } } },
    ]);
    expect(sent).not.toHaveProperty("tool_choice");
  });

  test("no tools sends no tools field", async () => {
    const fetch = fakeFetch(reply({ content: "ok" }));
    await make(fetch).next({ system: "s", messages: [user("hi")], tools: [] });
    expect(body(fetch)).not.toHaveProperty("tools");
  });

  test("a forced tool becomes a function tool_choice", async () => {
    const fetch = fakeFetch(reply({ content: "ok" }));
    await make(fetch).next({
      system: "s",
      messages: [user("hi")],
      tools: [{ name: "submit_answer", description: "d", input_schema: { type: "object" } }],
      toolChoice: { name: "submit_answer" },
    });
    expect(body(fetch).tool_choice).toEqual({ type: "function", function: { name: "submit_answer" } });
  });

  test("gives a tool call without an id a unique one and reads empty arguments as {}", async () => {
    const fetch = fakeFetch(
      reply(
        { tool_calls: [{ type: "function", function: { name: "a", arguments: "{}" } }, { type: "function", function: { name: "b", arguments: "" } }] },
        "tool_calls",
      ),
    );
    const turn = await make(fetch).next({ system: "s", messages: [user("hi")], tools: [] });
    expect(turn.toolCalls).toHaveLength(2);
    expect(turn.toolCalls[0].id).not.toBe(turn.toolCalls[1].id);
    expect(turn.toolCalls[1].input).toEqual({});
  });

  test("tool arguments that are not JSON are an error", async () => {
    const fetch = fakeFetch(reply({ tool_calls: [{ id: "c1", type: "function", function: { name: "a", arguments: "{oops" } }] }, "tool_calls"));
    await expect(make(fetch).next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(/invalid tool arguments/);
  });

  test("a cut-off reply is an error, not an answer", async () => {
    const fetch = fakeFetch(reply({ content: "half" }, "length"));
    await expect(make(fetch).next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(
      /before finishing \(length\)/,
    );
  });

  test("an empty reply is an error", async () => {
    const fetch = fakeFetch(reply({ content: "  " }));
    await expect(make(fetch).next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(/empty reply/);
  });

  test("an HTTP error gives the provider and status only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = fakeFetch(new Response('{"error":{"message":"secret detail"}}', { status: 401 }));
    const err = await make(fetch)
      .next({ system: "s", messages: [user("hi")], tools: [] })
      .catch((e: Error) => e);
    expect((err as Error).message).toBe("Groq API request failed (401)");
  });

  test("a network failure gives a clean message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(make(fetch).next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(
      "Groq API request failed (no response)",
    );
  });
});

describe("rate limits", () => {
  const limited = (retryAfter?: string) =>
    new Response('{"error":{}}', { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

  test("waits for Retry-After and tries again after a 429", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetch = fakeFetch(limited("3"), reply({ content: "ok" }));
    const model = createOpenAICompatModel({ provider: "Groq", baseUrl: BASE, apiKey: "k", model: "m", fetch: fetch as never, sleep });
    const turn = await model.next({ system: "s", messages: [user("hi")], tools: [] });
    expect(turn.text).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3250);
  });

  test("gives up after four retries with the 429 error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetch = fakeFetch(limited(), limited(), limited(), limited(), limited());
    const model = createOpenAICompatModel({ provider: "Groq", baseUrl: BASE, apiKey: "k", model: "m", fetch: fetch as never, sleep });
    await expect(model.next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow("Groq API request failed (429)");
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  test("other errors are not retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sleep = vi.fn();
    const fetch = fakeFetch(new Response("x", { status: 500 }));
    const model = createOpenAICompatModel({ provider: "Groq", baseUrl: BASE, apiKey: "k", model: "m", fetch: fetch as never, sleep });
    await expect(model.next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow("(500)");
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retryAfterMs falls back to 5 seconds and caps at 20", () => {
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs("soon")).toBe(5000);
    expect(retryAfterMs("1.5")).toBe(1750);
    expect(retryAfterMs("600")).toBe(20000);
  });
});

describe("provider selection", () => {
  test("AI_PROVIDER=groq without a key fails the run with a clear message", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "");
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(getModelClient().next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(
      "GROQ_API_KEY is not set",
    );
  });

  test("AI_PROVIDER=groq calls Groq with the agent and classifier models", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "");
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("GROQ_AGENT_MODEL", "big-model");
    vi.stubEnv("GROQ_CLASSIFIER_MODEL", "small-model");
    const fetch = fakeFetch(reply({ content: "ok" }), reply({ content: "ok" }));
    vi.stubGlobal("fetch", fetch);
    await getModelClient("agent").next({ system: "s", messages: [user("hi")], tools: [] });
    await getModelClient("classifier").next({ system: "s", messages: [user("hi")], tools: [] });
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(body(fetch, 0).model).toBe("big-model");
    expect(body(fetch, 1).model).toBe("small-model");
  });

  test("an unknown AI_PROVIDER fails the run", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "");
    vi.stubEnv("AI_PROVIDER", "nope");
    await expect(getModelClient().next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(
      /Unknown AI_PROVIDER/,
    );
  });

  test("without AI_PROVIDER the Claude path is used", async () => {
    vi.stubEnv("AGENT_TEST_MODEL", "");
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(getModelClient().next({ system: "s", messages: [user("hi")], tools: [] })).rejects.toThrow(
      "ANTHROPIC_API_KEY is not set",
    );
  });
});
