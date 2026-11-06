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

/** How an approved action ended. Only `error` means it was tried and did not work. */
export type ApprovalOutcome =
  | { status: 'ok'; result: unknown }
  // The tool ran and its change stands, but the action row could not be updated.
  | { status: 'ran_unrecorded'; result: unknown; message: string }
  // The tool never ran. Unless the state is invalid, the row is still pending.
  | { status: 'not_started'; message: string }
  | { status: 'error'; message: string };

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string; toolCalls: { id: string; name: string; input: unknown }[] }
  | { role: 'tool'; results: { id: string; output: string; isError: boolean }[] };

export type ModelTurn = { text: string; toolCalls: { id: string; name: string; input: unknown }[] };

export interface ModelClient {
  next(args: { system: string; messages: AgentMessage[]; tools: ToolSpec[] }): Promise<ModelTurn>;
}
