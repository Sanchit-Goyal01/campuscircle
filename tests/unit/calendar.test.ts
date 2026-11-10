import { describe, expect, test } from "vitest";
import { monthGrid } from "../../src/modules/events/calendar";

describe("monthGrid", () => {
  test("monthGrid starts weeks on Monday and places an event on its local date", () => {
    // 2026-11-01 is a Sunday, so the first week starts Monday 2026-10-26.
    // 2026-11-10T20:00Z is 2026-11-11 01:30 in Asia/Kolkata.
    const weeks = monthGrid(2026, 11, [{ starts_at: "2026-11-10T20:00:00Z" }]);
    expect(weeks[0][0]).toMatchObject({ date: "2026-10-26", inMonth: false });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const days = weeks.flat();
    const hit = days.filter((d) => d.events.length > 0);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ date: "2026-11-11", day: 11, inMonth: true });
  });

  test("monthGrid handles a month starting on Sunday and February in a leap year", () => {
    const nov = monthGrid(2026, 11, []);
    expect(nov[0].map((d) => d.date)).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    expect(nov[0].filter((d) => d.inMonth)).toHaveLength(1);
    const feb = monthGrid(2028, 2, []);
    const inMonth = feb.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[28].date).toBe("2028-02-29");
    // 2028-02-01 is a Tuesday: Monday 2028-01-31 leads the first week.
    expect(feb[0][0].date).toBe("2028-01-31");
  });
});
