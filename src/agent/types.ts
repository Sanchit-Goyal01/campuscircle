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

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string; toolCalls: { id: string; name: string; input: unknown }[] }
  | { role: 'tool'; results: { id: string; output: string; isError: boolean }[] };

export type ModelTurn = { text: string; toolCalls: { id: string; name: string; input: unknown }[] };

export interface ModelClient {
  next(args: { system: string; messages: AgentMessage[]; tools: ToolSpec[] }): Promise<ModelTurn>;
}
