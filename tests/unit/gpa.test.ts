import { describe, expect, test } from "vitest";
import { cgpa, sgpaBySemester, weakSubjects, type ResultRow } from "../../src/modules/academics/gpa";

const row = (
  semester: number,
  subject: string,
  credits: number,
  marks: number | null,
  grade_points: number | null,
): ResultRow => ({ semester, subject, credits, marks, grade_points });

describe("gpa", () => {
  test("sgpa weights grade points by credits", () => {
    expect(sgpaBySemester([row(1, "A", 4, 90, 9), row(1, "B", 2, 60, 6)])).toEqual([
      { semester: 1, sgpa: 8, credits: 6 },
    ]);
  });

  test("sgpa skips rows with null grade points", () => {
    expect(sgpaBySemester([row(1, "A", 4, 90, 9), row(1, "B", 2, null, null)])).toEqual([
      { semester: 1, sgpa: 9, credits: 4 },
    ]);
  });

  test("cgpa covers all semesters", () => {
    const rows = [row(1, "A", 4, 90, 9), row(1, "B", 2, 60, 6), row(2, "C", 4, 70, 7)];
    expect(cgpa(rows)).toBe(7.6);
  });

  test("cgpa is null with no graded rows", () => {
    expect(cgpa([])).toBeNull();
    expect(cgpa([row(1, "A", 4, null, null)])).toBeNull();
  });

  test("weak subjects are below the student average", () => {
    const rows = [row(1, "A", 4, 90, 10), row(1, "B", 4, 80, 9), row(1, "C", 4, 40, 4)];
    const weak = weakSubjects(rows);
    expect(weak).toHaveLength(1);
    expect(weak[0]).toMatchObject({ subject: "C", semester: 1, marks: 40, average: 70 });
  });

  test("weak subjects are sorted weakest first, ties by name", () => {
    const rows = [
      row(1, "Z", 3, 50, 6), row(1, "B", 3, 40, 4), row(1, "A", 3, 40, 4), row(1, "Top", 3, 100, 10),
      row(1, "Top2", 3, 100, 10), row(1, "Top3", 3, 100, 10),
    ];
    expect(weakSubjects(rows).map((w) => w.subject)).toEqual(["A", "B", "Z"]);
  });

  test("trend uses the latest two results", () => {
    const declining = weakSubjects([
      row(1, "X", 3, 50, 6),
      row(2, "X", 3, 40, 4),
      row(1, "Y", 3, 90, 10),
      row(2, "Y", 3, 90, 10),
    ]);
    expect(declining.find((w) => w.subject === "X")!.trend).toBe("declining");
    const improving = weakSubjects([
      row(1, "X", 3, 40, 4),
      row(2, "X", 3, 46, 5),
      row(1, "Y", 3, 90, 10),
      row(2, "Y", 3, 90, 10),
    ]);
    expect(improving.find((w) => w.subject === "X")!.trend).toBe("improving");
    const single = weakSubjects([row(1, "X", 3, 40, 4), row(1, "Y", 3, 90, 10)]);
    expect(single.find((w) => w.subject === "X")!.trend).toBe("one_result");
  });
});
