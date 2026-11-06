import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

export type Role = 'student' | 'society_admin' | 'authority' | 'college_admin';

export type ToolContext = {
  db: SupabaseClient;
  userId: string;
  collegeId: string;
  role: Role;
};

export type AgentTool<I = any> = {
  name: string;
  description: string;
  kind: 'read' | 'write';
  roles: Role[];
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<unknown>;
};

export type ToolOutcome =
  | { status: 'ok'; result: unknown }
  | { status: 'pending_approval'; actionId: string }
  | { status: 'error'; message: string };
