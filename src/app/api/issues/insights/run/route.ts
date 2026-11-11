import { errorResponse, signedOut, unexpected } from '@/agent/api';
import { getModelClient } from '@/agent/model';
import { getToolContext } from '@/lib/supabase/server';
import { runRootCause } from '@/modules/issues/root-cause';

export async function POST() {
  try {
    const ctx = await getToolContext();
    if (!ctx) return signedOut();
    if (ctx.role !== 'authority' && ctx.role !== 'college_admin') {
      return errorResponse(403, 'Only authority or college admin can find patterns');
    }
    const result = await runRootCause(ctx.db, getModelClient('classifier'));
    return Response.json(result);
  } catch (e) {
    return unexpected('POST /api/issues/insights/run', e);
  }
}
