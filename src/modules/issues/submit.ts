import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only. The `server-only` package is not installed, so guard at runtime:
// this module must never be bundled into, or run in, a browser.
if (typeof window !== 'undefined') {
  throw new Error('src/modules/issues/submit.ts is server-only');
}

/**
 * Service-role client for issue intake. This is the ONLY place app code may use
 * the service role: `submit_issue_report` is granted to service_role alone so a
 * signed-in student cannot send their own classification, embedding or merge
 * target. Callers must verify the student's session first and pass the verified
 * student id; never pass an id taken from a form or from the model.
 */
export function issueAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for issue reporting');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
