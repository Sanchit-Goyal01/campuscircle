import { randomUUID } from 'node:crypto';
import type { AgentMessage, ModelClient, ModelTurn, ToolSpec } from './types';

/**
 * A model client for any provider with an OpenAI-style chat completions API
 * (Groq, OpenRouter, Cerebras, Mistral, ...). It speaks plain HTTP, so it needs
 * no SDK. One client per run, like the Claude client.
 */

const MAX_TOKENS = 8000;
// Finish reasons that mean the text and tool calls are complete.
const COMPLETE_STOPS: (string | null | undefined)[] = ['stop', 'tool_calls'];

type ChatToolCall = { id?: string; type?: string; function: { name: string; arguments?: string } };
type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toChatMessages(system: string, messages: AgentMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'tool') {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.output}` : r.output });
      }
    } else {
      const msg: ChatMessage = { role: 'assistant', content: m.text || null };
      if (m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }));
      }
      out.push(msg);
    }
  }
  return out;
}

function toChatTool({ input_schema, ...tool }: ToolSpec) {
  const { $schema: _dialect, ...parameters } = input_schema;
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
}

const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_WAIT_MS = 20_000;

/** Reads Retry-After (seconds); falls back to 5 seconds, capped so a run never hangs. */
export function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header);
  const ms = Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) + 250 : 5000;
  return Math.min(ms, MAX_WAIT_MS);
}

function parseArguments(raw: string | undefined, name: string): unknown {
  if (!raw || raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Model sent invalid tool arguments for ${name}`);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export function createOpenAICompatModel(deps: {
  /** Shown in errors and logs, e.g. "Groq". */
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}): ModelClient {
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fail = (status: number | string, detail: unknown) => {
    // The provider's own message goes to the log; this one is stored in the run's trace.
    console.error(`${deps.provider} API request failed`, status, detail);
    return new Error(`${deps.provider} API request failed (${status})`);
  };

  return {
    async next(args) {
      const request: Record<string, unknown> = {
        model: deps.model,
        max_tokens: MAX_TOKENS,
        messages: toChatMessages(args.system, args.messages),
      };
      if (args.tools.length > 0) request.tools = args.tools.map(toChatTool);
      if (args.toolChoice) request.tool_choice = { type: 'function', function: { name: args.toolChoice.name } };

      let res: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(`${deps.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          });
        } catch (e) {
          throw fail('no response', e instanceof Error ? e.message : e);
        }
        // Free tiers cap tokens per minute, so a 429 usually clears within seconds.
        if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
        const waitMs = retryAfterMs(res.headers.get('retry-after'));
        await res.body?.cancel().catch(() => {});
        await sleep(waitMs);
      }
      if (!res.ok) throw fail(res.status, await res.text().catch(() => ''));

      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason?: string | null }[];
      };
      const choice = data.choices?.[0];
      if (!COMPLETE_STOPS.includes(choice?.finish_reason)) {
        throw new Error(`Model stopped before finishing (${choice?.finish_reason ?? 'no reply'})`);
      }
      const text = choice?.message?.content ?? '';
      const toolCalls: ModelTurn['toolCalls'] = (choice?.message?.tool_calls ?? []).map((c) => ({
        id: c.id || `call_${randomUUID()}`,
        name: c.function.name,
        input: parseArguments(c.function.arguments, c.function.name),
      }));
      if (toolCalls.length === 0 && text.trim() === '') throw new Error('Model returned an empty reply');
      return { text, toolCalls };
    },
  };
}

/** Providers the app knows by name. Each reads its own key and model settings. */
export const OPENAI_COMPAT_PROVIDERS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    agentModelEnv: 'GROQ_AGENT_MODEL',
    classifierModelEnv: 'GROQ_CLASSIFIER_MODEL',
    defaultAgentModel: 'openai/gpt-oss-120b',
    defaultClassifierModel: 'openai/gpt-oss-20b',
  },
} as const;

export type OpenAICompatProvider = keyof typeof OPENAI_COMPAT_PROVIDERS;
