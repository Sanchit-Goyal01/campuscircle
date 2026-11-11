import type { ToolContext } from './types';

export class DailyLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Daily agent run limit of ${limit} reached. Try again tomorrow.`);
    this.name = 'DailyLimitError';
  }
}

/** Throws DailyLimitError when the student already has `limit` runs since 00:00 UTC. */
export async function assertWithinDailyLimit(ctx: ToolContext, limit: number): Promise<void> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await ctx.db
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', ctx.userId)
    .gte('created_at', start.toISOString());
  if (error) throw new Error(`Could not check daily run limit: ${error.message}`);
  if ((count ?? 0) >= limit) throw new DailyLimitError(limit);
}
