import { z } from 'zod';
import type { AgentTool } from '../../agent/types';

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

const planInput = z.strictObject({
  title: nonEmpty,
  items: z.array(z.strictObject({ due_on: realDate, task: nonEmpty })).min(1).max(60),
});

export const createStudyPlan: AgentTool<z.infer<typeof planInput>> = {
  name: 'create_study_plan',
  description:
    'Create a study plan with a title and dated tasks for the signed-in student. Needs student approval.',
  kind: 'write',
  roles: ['student', 'society_admin'],
  input: planInput,
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
