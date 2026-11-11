import { describe, expect, test } from "vitest";
import { toPlainText } from "@/agent/plain-text";

describe("toPlainText", () => {
  test("strips bold, headings, rules, code and links", () => {
    const md = "### Plan\n\n**Mentor:**\n- **Priya Sharma** – DBMS\n\n---\n\nUse `SELECT` and [notes](https://x.test).";
    expect(toPlainText(md)).toBe("Plan\n\nMentor:\n- Priya Sharma – DBMS\n\nUse SELECT and notes.");
  });

  test("removes ids, including the aside that holds them", () => {
    const text = "I queued it for your approval (action ID 65e29fb8-9388-4404-bbc4-c9d482e66a25). It is not done yet.";
    expect(toPlainText(text)).toBe("I queued it for your approval. It is not done yet.");
    expect(toPlainText("ref 65E29FB8-9388-4404-BBC4-C9D482E66A25 done")).toBe("ref  done");
  });

  test("turns star bullets into dashes and leaves plain text alone", () => {
    expect(toPlainText("* one\n* two")).toBe("- one\n- two");
    expect(toPlainText("Revise 2*3 joins on 12 Nov.")).toBe("Revise 2*3 joins on 12 Nov.");
  });
});
