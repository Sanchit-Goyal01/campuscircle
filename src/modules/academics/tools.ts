import { z } from 'zod';
import type { AgentTool } from '../../agent/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, agentToday } from '../../lib/today';
import { edgeEmbedder, type Embedder } from './embed';
import { weakSubjects, type ResultRow } from './gpa';

const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'must be a real calendar date (YYYY-MM-DD)');

const nonEmpty = z.string().trim().min(1);

const getMarksInput = z.strictObject({ semester: z.number().int().optional() });

export const getMarks: AgentTool<z.infer<typeof getMarksInput>> = {
  name: 'get_marks',
  description:
    "Get the signed-in student's marks and grade points per subject, optionally for one semester.",
  kind: 'read',
  roles: ['student', 'society_admin'],
  input: getMarksInput,
  async run(input, ctx) {
    let q = ctx.db
      .from('subject_results')
      .select('semester, marks, grade_points, subjects(name)')
      .eq('student_id', ctx.userId);
    if (input.semester !== undefined) q = q.eq('semester', input.semester);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read marks: ${error.message}`);
    const rows = (data ?? []).map((r: any) => {
      const subj = Array.isArray(r.subjects) ? r.subjects[0] : r.subjects;
      return {
        semester: r.semester as number,
        subject: (subj?.name ?? '') as string,
        marks: r.marks as number | null,
        grade_points: r.grade_points as number | null,
      };
    });
    return rows.sort((a, b) => a.semester - b.semester || a.subject.localeCompare(b.subject));
  },
};

const planInput = (today: () => string) =>
  z.strictObject({
    title: nonEmpty,
    items: z
      .array(
        z.strictObject({
          due_on: realDate.refine((s) => s >= today(), {
            error: () => `due_on must be today (${today()}) or later`,
          }),
          task: nonEmpty,
        }),
      )
      .min(1)
      .max(60),
  });

/** `today` is checked at each parse, so approval also refuses a date that has since passed. */
export function createStudyPlanTool(
  today: () => string = () => agentToday(),
): AgentTool<z.infer<ReturnType<typeof planInput>>> {
  return {
    name: 'create_study_plan',
    description:
      'Create a study plan with a title and dated tasks for the signed-in student. Needs student approval.',
    kind: 'write',
    roles: ['student', 'society_admin'],
    input: planInput(today),
    async run(input, ctx) {
      const { data: plan, error } = await ctx.db
        .from('study_plans')
        .insert({ student_id: ctx.userId, college_id: ctx.collegeId, title: input.title })
        .select('id')
        .single();
      if (error || !plan) throw new Error(`Could not create plan: ${error?.message ?? 'no row returned'}`);
      const planId = plan.id as string;

      const { error: itemsError } = await ctx.db.from('study_plan_items').insert(
        input.items.map((i) => ({
          plan_id: planId,
          college_id: ctx.collegeId,
          due_on: i.due_on,
          task: i.task,
        })),
      );
      if (itemsError) {
        // No transaction: remove the plan so no partial plan is left behind.
        const { error: delError } = await ctx.db.from('study_plans').delete().eq('id', planId);
        const extra = delError ? ` (cleanup also failed: ${delError.message})` : '';
        throw new Error(`Could not save plan items: ${itemsError.message}${extra}`);
      }
      return { planId };
    },
  };
}

export const createStudyPlan = createStudyPlanTool();

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

export const getWeakSubjects: AgentTool<Record<string, never>> = {
  name: 'get_weak_subjects',
  description:
    "List the signed-in student's weak subjects: those whose latest marks are below their own average, weakest first, with a trend.",
  kind: 'read',
  roles: ['student', 'society_admin'],
  input: z.strictObject({}),
  async run(_input, ctx) {
    const { data, error } = await ctx.db
      .from('subject_results')
      .select('semester, marks, grade_points, subjects(name, credits)')
      .eq('student_id', ctx.userId);
    if (error) throw new Error(`Could not read marks: ${error.message}`);
    const rows: ResultRow[] = (data ?? []).map((r: any) => {
      const subj = one<any>(r.subjects);
      return {
        semester: r.semester,
        subject: subj?.name ?? '',
        credits: subj?.credits ?? 0,
        marks: r.marks,
        grade_points: r.grade_points,
      };
    });
    const graded = rows.filter((r) => r.marks !== null) as (ResultRow & { marks: number })[];
    const average =
      graded.length === 0
        ? null
        : Math.round((graded.reduce((s, r) => s + r.marks, 0) / graded.length) * 100) / 100;
    const subjects = weakSubjects(rows)
      .map(({ subject, semester, marks, trend }) => ({ subject, semester, marks, trend }))
      .sort((a, b) => a.marks - b.marks || a.subject.localeCompare(b.subject));
    return { average, subjects };
  },
};

/** Ids of the college's subjects whose code or name equals `text`, ignoring case. RLS limits rows to the college. */
async function subjectIds(db: SupabaseClient, text: string): Promise<string[]> {
  const { data, error } = await db.from('subjects').select('id, code, name');
  if (error) throw new Error(`Could not read subjects: ${error.message}`);
  const want = text.trim().toLowerCase();
  const rows = (data ?? []) as { id: string; code: string; name: string }[];
  const byCode = rows.filter((s) => s.code.toLowerCase() === want);
  return (byCode.length ? byCode : rows.filter((s) => s.name.toLowerCase() === want)).map((s) => s.id);
}

const searchNotesInput = z.strictObject({
  query: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).optional(),
});

const MAX_NOTE_RESULTS = 6;
const MAX_EXCERPT = 600;

export function createSearchNotesTool(
  embed: Embedder = edgeEmbedder,
): AgentTool<z.infer<typeof searchNotesInput>> {
  return {
    name: 'search_notes',
    description:
      "Search the college's study notes by meaning. The query is a natural-language question or topic. Returns excerpts with note title and page. Optionally limit to one subject by its exact code or name, for example 'CS301' or 'DBMS'.",
    kind: 'read',
    roles: ['student', 'society_admin'],
    input: searchNotesInput,
    async run(input, ctx) {
      let filters: (string | null)[] = [null];
      if (input.subject !== undefined) {
        const ids = await subjectIds(ctx.db, input.subject);
        if (ids.length === 0) return [];
        filters = ids;
      }
      const [vector] = await embed(ctx.db, [input.query]);
      if (!vector) throw new Error('Embedding failed: no vector returned');
      const hits: { note_id: string; title: string; page: number; content: string; similarity: number }[] = [];
      for (const filter of filters) {
        const { data, error } = await ctx.db.rpc('match_note_chunks', {
          query_embedding: JSON.stringify(vector),
          match_count: MAX_NOTE_RESULTS,
          filter_subject: filter,
        });
        if (error) throw new Error(`Could not search notes: ${error.message}`);
        hits.push(...(data ?? []));
      }
      return hits
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_NOTE_RESULTS)
        .map((h) => ({
          note_id: h.note_id,
          title: h.title,
          page: h.page,
          excerpt: h.content.slice(0, MAX_EXCERPT),
        }));
    },
  };
}

export const searchNotes = createSearchNotesTool();

const getPastPapersInput = z.strictObject({
  subject: z.string().trim().min(1).optional(),
  year: z.number().int().optional(),
});

export const getPastPapers: AgentTool<z.infer<typeof getPastPapersInput>> = {
  name: 'get_past_papers',
  description:
    "List the college's past exam papers, newest first, optionally for one subject and year. The subject must be an exact code or name, for example 'CS301' or 'DBMS'.",
  kind: 'read',
  roles: ['student', 'society_admin'],
  input: getPastPapersInput,
  async run(input, ctx) {
    let q = ctx.db
      .from('past_papers')
      .select('id, year, exam_type, subjects(name)')
      .order('year', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);
    if (input.subject !== undefined) {
      const ids = await subjectIds(ctx.db, input.subject);
      if (ids.length === 0) return [];
      q = q.in('subject_id', ids);
    }
    if (input.year !== undefined) q = q.eq('year', input.year);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read past papers: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      paper_id: r.id as string,
      subject: (one<any>(r.subjects)?.name ?? '') as string,
      year: r.year as number,
      exam_type: r.exam_type as string,
    }));
  },
};

const getTimetableInput = z
  .strictObject({ from: realDate.optional(), to: realDate.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { error: 'from must not be after to' });

const hhmm = (t: string | null) => (t === null ? null : t.slice(0, 5));
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const getTimetable: AgentTool<z.infer<typeof getTimetableInput>> = {
  name: 'get_timetable',
  description:
    "Get the signed-in student's weekly classes and exams. Weekly classes are always returned in full, whatever the date range. Only exams are filtered to the range (default: today to 30 days ahead); days_left is negative for exams already past. weekday is 1 = Monday to 7 = Sunday.",
  kind: 'read',
  roles: ['student', 'society_admin'],
  input: getTimetableInput,
  async run(input, ctx) {
    const today = agentToday();
    const from = input.from ?? today;
    const to = input.to ?? addDays(from, 30);
    const { data, error } = await ctx.db
      .from('timetable_entries')
      .select('kind, weekday, exam_date, start_time, end_time, location, subjects(name)')
      .eq('student_id', ctx.userId);
    if (error) throw new Error(`Could not read timetable: ${error.message}`);
    const rows = (data ?? []) as any[];
    const name = (r: any) => (one<any>(r.subjects)?.name ?? null) as string | null;
    const classes = rows
      .filter((r) => r.kind === 'class')
      .map((r) => ({
        weekday: r.weekday as number,
        start_time: hhmm(r.start_time) as string,
        end_time: hhmm(r.end_time),
        subject: name(r),
        location: (r.location ?? null) as string | null,
      }))
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    const exams = rows
      .filter((r) => r.kind === 'exam' && r.exam_date >= from && r.exam_date <= to)
      .map((r) => ({
        exam_date: r.exam_date as string,
        start_time: hhmm(r.start_time) as string,
        subject: name(r),
        location: (r.location ?? null) as string | null,
        days_left: daysBetween(today, r.exam_date),
      }))
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date) || a.start_time.localeCompare(b.start_time));
    return { classes, exams };
  },
};
