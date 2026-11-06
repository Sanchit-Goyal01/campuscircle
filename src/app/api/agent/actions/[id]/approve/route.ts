import { INVALID_ACTION_STATE, actionClosed, badActionId, isActionId, signedOut, unexpected } from '@/agent/api';
import { runApprovedAction } from '@/agent/executor';
import { getToolContext } from '@/lib/supabase/server';
import { allTools } from '@/modules';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const { id } = await params;
    if (!isActionId(id)) return badActionId();

    const outcome = await runApprovedAction(id, allTools, ctx);
    if (outcome.status === 'ok') return Response.json({ status: 'done', result: outcome.result });
    if (outcome.status === 'error' && outcome.message === INVALID_ACTION_STATE) return actionClosed();
    const reason = outcome.status === 'error' ? outcome.message : 'The action did not run.';
    return Response.json({ status: 'failed', result: { error: reason } });
  } catch (e) {
    return unexpected('POST /api/agent/actions/[id]/approve', e);
  }
}
