import type { AgentTool, ToolContext, ToolOutcome } from './types';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function resolveTool(
  name: string,
  tools: AgentTool[],
  ctx: ToolContext,
): { tool: AgentTool } | { error: string } {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  if (!tool.roles.includes(ctx.role)) {
    return { error: `Tool ${name} is not available for role ${ctx.role}` };
  }
  return { tool };
}

/**
 * Runs read tools immediately. Write tools are NEVER run here: they are
 * recorded as pending actions and only run via runApprovedAction.
 */
export async function executeToolCall(
  call: { name: string; input: unknown },
  tools: AgentTool[],
  ctx: ToolContext,
  runId: string,
): Promise<ToolOutcome> {
  const found = resolveTool(call.name, tools, ctx);
  if ('error' in found) return { status: 'error', message: found.error };
  const { tool } = found;

  const parsed = tool.input.safeParse(call.input);
  if (!parsed.success) {
    return { status: 'error', message: `Invalid input for ${tool.name}: ${parsed.error.message}` };
  }

  if (tool.kind === 'write') {
    const { data, error } = await ctx.db
      .from('agent_pending_actions')
      .insert({
        run_id: runId,
        student_id: ctx.userId,
        college_id: ctx.collegeId,
        tool_name: tool.name,
        input: parsed.data,
      })
      .select('id')
      .single();
    if (error || !data) {
      return { status: 'error', message: error?.message ?? 'Could not create pending action' };
    }
    return { status: 'pending_approval', actionId: data.id as string };
  }

  try {
    return { status: 'ok', result: await tool.run(parsed.data, ctx) };
  } catch (e) {
    return { status: 'error', message: errMsg(e) };
  }
}

/**
 * Runs a write tool after the student approved it. The approve_pending_action
 * RPC performs the atomic pending -> approved transition; if it fails, nothing runs.
 */
export async function runApprovedAction(
  actionId: string,
  tools: AgentTool[],
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { data: row, error } = await ctx.db.rpc('approve_pending_action', { p_id: actionId });
  if (error || !row) {
    return { status: 'error', message: error?.message ?? 'Action could not be approved' };
  }
  const action = (Array.isArray(row) ? row[0] : row) as { tool_name: string; input: unknown } | undefined;
  if (!action) return { status: 'error', message: 'Action could not be approved' };

  const finish = async (status: 'done' | 'failed', result: unknown) => {
    await ctx.db.rpc('finish_pending_action', {
      p_id: actionId,
      p_status: status,
      p_result: result,
    });
  };

  const found = resolveTool(action.tool_name, tools, ctx);
  if ('error' in found) {
    await finish('failed', { error: found.error });
    return { status: 'error', message: found.error };
  }
  const { tool } = found;

  const parsed = tool.input.safeParse(action.input);
  if (!parsed.success) {
    const message = `Invalid input for ${tool.name}: ${parsed.error.message}`;
    await finish('failed', { error: message });
    return { status: 'error', message };
  }

  try {
    const result = await tool.run(parsed.data, ctx);
    await finish('done', result);
    return { status: 'ok', result };
  } catch (e) {
    const message = errMsg(e);
    await finish('failed', { error: message });
    return { status: 'error', message };
  }
}
