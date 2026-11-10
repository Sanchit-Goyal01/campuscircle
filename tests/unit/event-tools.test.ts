import { describe, expect, test } from "vitest";
import { registerForEvent } from "../../src/modules/events/tools";
import { requestMentorship } from "../../src/modules/people/tools";

describe("tool id inputs", () => {
  test("register_for_event accepts seed-style ids as well as v4 ids", () => {
    const ok = (id: string) => registerForEvent.input.safeParse({ event_id: id }).success;
    expect(ok("00000000-0000-0000-0000-0000000000e1")).toBe(true);
    expect(ok("00000000-0000-0000-0000-0000000000e2")).toBe(true);
    expect(ok(crypto.randomUUID())).toBe(true);
    expect(ok("not-a-uuid")).toBe(false);
    expect(ok("00000000-0000-0000-0000-0000000000e1 ")).toBe(false);
  });

  test("request_mentorship accepts seed-style mentor ids", () => {
    const r = requestMentorship.input.safeParse({
      mentor_id: "00000000-0000-0000-0000-0000000000a1",
      subject: "DBMS",
      message: "Could you help me with joins?",
    });
    expect(r.success).toBe(true);
  });
});
