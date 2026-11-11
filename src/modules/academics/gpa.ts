export type ResultRow = {
  semester: number;
  subject: string;
  credits: number;
  marks: number | null;
  grade_points: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function weighted(rows: ResultRow[]): { gpa: number; credits: number } | null {
  let points = 0;
  let credits = 0;
  for (const r of rows) {
    if (r.grade_points === null) continue;
    points += r.credits * r.grade_points;
    credits += r.credits;
  }
  return credits === 0 ? null : { gpa: round2(points / credits), credits };
}

export function sgpaBySemester(rows: ResultRow[]): { semester: number; sgpa: number; credits: number }[] {
  const semesters = [...new Set(rows.map((r) => r.semester))].sort((a, b) => a - b);
  const out: { semester: number; sgpa: number; credits: number }[] = [];
  for (const semester of semesters) {
    const w = weighted(rows.filter((r) => r.semester === semester));
    if (w) out.push({ semester, sgpa: w.gpa, credits: w.credits });
  }
  return out;
}

export function cgpa(rows: ResultRow[]): number | null {
  return weighted(rows)?.gpa ?? null;
}

export function weakSubjects(rows: ResultRow[]): {
  subject: string;
  semester: number;
  marks: number;
  average: number;
  trend: "improving" | "declining" | "steady" | "one_result";
}[] {
  const graded = rows.filter((r): r is ResultRow & { marks: number } => r.marks !== null);
  if (graded.length === 0) return [];
  const average = graded.reduce((s, r) => s + r.marks, 0) / graded.length;

  const bySubject = new Map<string, (ResultRow & { marks: number })[]>();
  for (const r of graded) bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r]);

  const out: ReturnType<typeof weakSubjects> = [];
  for (const [subject, list] of bySubject) {
    const sorted = [...list].sort((a, b) => a.semester - b.semester);
    const latest = sorted[sorted.length - 1];
    if (latest.marks >= average) continue;
    let trend: "improving" | "declining" | "steady" | "one_result" = "one_result";
    if (sorted.length >= 2) {
      const diff = latest.marks - sorted[sorted.length - 2].marks;
      trend = diff >= 5 ? "improving" : diff <= -5 ? "declining" : "steady";
    }
    out.push({ subject, semester: latest.semester, marks: latest.marks, average: round2(average), trend });
  }
  // Weakest first (marks ascending, then name) so the page and get_weak_subjects agree.
  return out.sort((a, b) => a.marks - b.marks || a.subject.localeCompare(b.subject));
}
