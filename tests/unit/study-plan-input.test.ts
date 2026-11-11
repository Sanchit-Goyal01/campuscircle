import { describe, expect, test } from 'vitest';
import { createStudyPlanTool } from '@/modules/academics/tools';

const input = createStudyPlanTool(() => '2026-11-07').input;
const plan = (due_on: string) => ({ title: 'Exams', items: [{ due_on, task: 'Revise' }] });

describe('create_study_plan due_on', () => {
  test('today and later are accepted', () => {
    expect(input.safeParse(plan('2026-11-07')).success).toBe(true);
    expect(input.safeParse(plan('2026-11-08')).success).toBe(true);
  });

  test('a date before today is refused with a message that names today', () => {
    const parsed = input.safeParse(plan('2026-11-06'));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.message).toContain('today (2026-11-07) or later');
  });
});
