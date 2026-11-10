import { describe, expect, test } from "vitest";
import { createScriptedModel } from "@/agent/scripted-model";
import type { AgentMessage, ToolContext } from "@/agent/types";
import { findPerson, sendMessage } from "@/modules/messaging/tools";

const PERSON = "00000000-0000-0000-0000-0000000000b2";

/** A chainable stand-in for the query builder that records every call. */
function fakeDb() {
  const calls: [string, unknown[]][] = [];
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return builder;
        };
      },
    },
  );
  return { db: builder, calls };
}
const ctx = (db: unknown): ToolContext => ({ db: db as any, userId: PERSON, collegeId: PERSON, role: "student" });

describe("find_person", () => {
  test("find_person escapes % and _", async () => {
    const { db, calls } = fakeDb();
    await findPerson.run({ name: "50%_off\\x" }, ctx(db));
    const like = calls.find(([m]) => m === "ilike");
    expect(like).toBeDefined();
    expect(like![1]).toEqual(["full_name", "%50\\%\\_off\\\\x%"]);
  });

  test("find_person strips PostgREST's * alias, and a name of only * matches nothing", async () => {
    const { db, calls } = fakeDb();
    await findPerson.run({ name: "pr*ya" }, ctx(db));
    expect(calls.find(([m]) => m === "ilike")![1]).toEqual(["full_name", "%prya%"]);
    const again = fakeDb();
    expect(await findPerson.run({ name: "**" }, ctx(again.db))).toEqual([]);
    expect(again.calls.find(([m]) => m === "ilike")).toBeUndefined();
  });

  test("name must be 2 to 80 characters; ids use the shared pattern", () => {
    expect(findPerson.input.safeParse({ name: "a" }).success).toBe(false);
    expect(findPerson.input.safeParse({ name: "a".repeat(81) }).success).toBe(false);
    expect(findPerson.input.safeParse({ name: "Priya" }).success).toBe(true);
    expect(sendMessage.input.safeParse({ recipient_id: PERSON, body: "hi" }).success).toBe(true);
    expect(sendMessage.input.safeParse({ recipient_id: "nope", body: "hi" }).success).toBe(false);
    expect(sendMessage.input.safeParse({ recipient_id: PERSON, body: "" }).success).toBe(false);
    expect(sendMessage.input.safeParse({ recipient_id: PERSON, body: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("scripted message rule", () => {
  const user = (content: string): AgentMessage => ({ role: "user", content });
  const model = createScriptedModel();
  const step = (messages: AgentMessage[]) => model.next({ system: "", tools: [], messages });
  const toolTurn = (name: string, output: string): AgentMessage[] => [
    { role: "assistant", text: "", toolCalls: [{ id: `scripted_${name}`, name, input: {} }] } as AgentMessage,
    { role: "tool", results: [{ id: `scripted_${name}`, output, isError: false }] } as AgentMessage,
  ];

  test("scripted message rule calls find_person then send_message and stops on no match", async () => {
    const first = await step([user("Message Asha Rao: See you at 5, ok?")]);
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0].name).toBe("find_person");
    expect(first.toolCalls[0].input).toEqual({ name: "Asha Rao" });

    const found = `<tool_data>[{"person_id":"${PERSON}","name":"Asha Rao","skills":[],"verified":false}]</tool_data>`;
    const second = await step([user("Message Asha Rao: See you at 5, ok?"), ...toolTurn("find_person", found)]);
    expect(second.toolCalls[0].name).toBe("send_message");
    expect(second.toolCalls[0].input).toEqual({ recipient_id: PERSON, body: "See you at 5, ok?" });

    const third = await step([
      user("Message Asha Rao: See you at 5, ok?"),
      ...toolTurn("find_person", found),
      ...toolTurn("send_message", "<tool_data>Action queued</tool_data>"),
    ]);
    expect(third.toolCalls).toEqual([]);
    expect(third.text).toMatch(/approval/i);

    const none = await step([user("message Nobody Here: hi"), ...toolTurn("find_person", "<tool_data>[]</tool_data>")]);
    expect(none.toolCalls).toEqual([]);
    expect(none.text).toBe("I could not find anyone by that name.");
  });

  test("the message rule only fires at the start and does not shadow other rules", async () => {
    const name = async (m: string) => (await step([user(m)])).toolCalls[0]?.name;
    expect(await name("please message Asha: hi")).not.toBe("find_person");
    expect(await name("how are my marks")).toBe("get_marks");
    expect(await name("I'm weak in DBMS and my exam is in 10 days.")).toBe("get_marks");
    expect(await name("message")).not.toBe("find_person");
  });

  test("a message whose text contains 'fail' is not shadowed by the fail rule", async () => {
    const turn = await step([user("message Priya: I failed the quiz")]);
    expect(turn.toolCalls[0]?.name).toBe("find_person");
    await expect(step([user("please fail")])).rejects.toThrow();
  });
});
