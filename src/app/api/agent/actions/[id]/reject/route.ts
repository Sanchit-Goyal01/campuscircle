import { INVALID_ACTION_STATE, actionClosed, badActionId, isActionId, signedOut, unexpected } from '@/agent/api';
import { getToolContext } from '@/lib/supabase/server';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const { id } = await params;
    if (!isActionId(id)) return badActionId();

    const { error } = await ctx.db.rpc('reject_pending_action', { p_id: id });
    if (error?.message === INVALID_ACTION_STATE) return actionClosed();
    if (error) throw new Error(`Could not reject action: ${error.message}`);
    return Response.json({ status: 'rejected' });
  } catch (e) {
    return unexpected('POST /api/agent/actions/[id]/reject', e);
  }
}
