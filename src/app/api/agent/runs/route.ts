import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { DailyLimitError, assertWithinDailyLimit } from '@/agent/limits';
import { runAgent } from '@/agent/loop';
import { getModelClient } from '@/agent/model';
import type { ToolContext } from '@/agent/types';
import { getToolContext } from '@/lib/supabase/server';
import { allTools } from '@/modules';

// One run can make many model calls, up to the loop's 12 tool calls.
export const maxDuration = 300;

const MAX_MESSAGE = 4000;
const DEFAULT_DAILY_LIMIT = 30;

function dailyLimit(): number {
  const limit = Number(process.env.AGENT_DAILY_RUN_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT;
}

/** Returns the trimmed message, or null when the body is not a valid request. */
async function readMessage(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message !== 'string' || message.length > MAX_MESSAGE) return null;
  return message.trim() || null;
}

async function readRun(ctx: ToolContext, runId: string) {
  const [steps, actions] = await Promise.all([
    ctx.db.from('agent_steps').select('seq, kind, tool_name, payload').eq('run_id', runId).order('seq'),
    ctx.db
      .from('agent_pending_actions')
      .select('id, tool_name, input, status')
      .eq('run_id', runId)
      .order('created_at'),
  ]);
  if (steps.error) throw new Error(`Could not read steps: ${steps.error.message}`);
  if (actions.error) throw new Error(`Could not read pending actions: ${actions.error.message}`);
  return { steps: steps.data, pendingActions: actions.data };
}

export async function POST(request: Request) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const message = await readMessage(request);
    if (message === null) {
      return errorResponse(400, `Send a message of 1 to ${MAX_MESSAGE} characters.`);
    }

    await assertWithinDailyLimit(ctx, dailyLimit());

    const run = await runAgent({ message, tools: allTools, ctx, model: getModelClient() });
    const body = { ...run, ...(await readRun(ctx, run.runId)) };
    return Response.json(body, { status: run.status === 'failed' ? 502 : 200 });
  } catch (e) {
    if (e instanceof DailyLimitError) {
      return errorResponse(429, `You have used all ${e.limit} requests for today. Try again tomorrow.`);
    }
    return unexpected('POST /api/agent/runs', e);
  }
}
