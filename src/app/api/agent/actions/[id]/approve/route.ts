import { approvalResponse, badActionId, isActionId, signedOut, unexpected } from '@/agent/api';
import { runApprovedAction } from '@/agent/executor';
import { getToolContext } from '@/lib/supabase/server';
import { allTools } from '@/modules';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();

    const { id } = await params;
    if (!isActionId(id)) return badActionId();

    return approvalResponse(await runApprovedAction(id, allTools, ctx));
  } catch (e) {
    return unexpected('POST /api/agent/actions/[id]/approve', e);
  }
}
