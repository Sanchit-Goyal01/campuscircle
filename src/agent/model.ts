import Anthropic from '@anthropic-ai/sdk';
import type { AgentMessage, ModelClient, ModelTurn, ToolSpec } from './types';

type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;
type ClaudeMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ClaudeBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ClaudeBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ClaudeTool = Anthropic.Beta.Messages.BetaTool;

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
// Lets the API retry a policy decline on Anthropic's default fallback model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Stops that mean the text and tool calls are complete. Anything else (max_tokens,
// refusal, ...) is cut short and must not read as a finished answer.
const COMPLETE_STOPS: (string | null)[] = ['end_turn', 'tool_use', 'stop_sequence'];

export function toModelTurn(response: Pick<ClaudeMessage, 'content' | 'stop_reason'>): ModelTurn {
  if (!COMPLETE_STOPS.includes(response.stop_reason)) {
    throw new Error(`Model stopped before finishing (${response.stop_reason})`);
  }
  let text = '';
  const toolCalls: ModelTurn['toolCalls'] = [];
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  if (toolCalls.length === 0 && text.trim() === '') throw new Error('Model returned an empty reply');
  return { text, toolCalls };
}

/**
 * `replays` holds the exact content of earlier responses, keyed by their first
 * tool call id. Thinking blocks must go back unmodified in a tool-use loop, and
 * AgentMessage does not carry them.
 */
export function toClaudeMessages(
  messages: AgentMessage[],
  replays: ReadonlyMap<string, ClaudeBlockParam[]> = new Map(),
): ClaudeMessageParam[] {
  return messages.map((m): ClaudeMessageParam => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.output,
          is_error: r.isError,
        })),
      };
    }
    const replay = m.toolCalls[0] && replays.get(m.toolCalls[0].id);
    if (replay) return { role: 'assistant', content: replay };
    const content: ClaudeBlockParam[] = m.toolCalls.map((c) => ({
      type: 'tool_use',
      id: c.id,
      name: c.name,
      input: c.input,
    }));
    if (m.text) content.unshift({ type: 'text', text: m.text });
    return { role: 'assistant', content };
  });
}

/** After a mid-response fallback, blocks from the declined attempt must not be echoed. */
function replayable(content: ClaudeBlock[]): ClaudeBlockParam[] {
  const boundary = content.findLastIndex((b) => b.type === 'fallback');
  const dropped = ['thinking', 'redacted_thinking', 'tool_use'];
  return content.filter((b, i) => i >= boundary || !dropped.includes(b.type)) as ClaudeBlockParam[];
}

function toClaudeTool({ input_schema, ...tool }: ToolSpec): ClaudeTool {
  const { $schema: _dialect, ...schema } = input_schema;
  return { ...tool, input_schema: schema as ClaudeTool['input_schema'] };
}

type CreateParams = Parameters<Anthropic['beta']['messages']['create']>[0];

/**
 * A forced tool_choice is incompatible with extended thinking, so a forced call
 * turns thinking off. Unforced agent calls keep the model default.
 */
export function buildRequest(
  deps: { model: string },
  args: { system: string; messages: AgentMessage[]; tools: ToolSpec[]; toolChoice?: { name: string } },
  replays: ReadonlyMap<string, ClaudeBlockParam[]>,
) {
  return {
    model: deps.model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'medium' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: args.system,
    messages: toClaudeMessages(args.messages, replays),
    tools: args.tools.map(toClaudeTool),
    ...(args.toolChoice
      ? { tool_choice: { type: 'tool', name: args.toolChoice.name }, thinking: { type: 'disabled' } }
      : {}),
  } as CreateParams & { stream?: false };
}

type MessagesClient = { beta: { messages: Pick<Anthropic['beta']['messages'], 'create'> } };

/** A client holds one run's replay state, so make a new one for each run. */
export function createClaudeModel(deps: { client: MessagesClient; model: string }): ModelClient {
  const replays = new Map<string, ClaudeBlockParam[]>();
  return {
    async next(args) {
      let response: ClaudeMessage;
      try {
        response = await deps.client.beta.messages.create(buildRequest(deps, args, replays));
      } catch (e) {
        if (!(e instanceof Anthropic.APIError)) throw e;
        // The API's own message goes to the log; this one is stored in the run's trace.
        console.error('Claude API request failed', e.status, e.message);
        throw new Error(`Claude API request failed (${e.status ?? 'no response'})`);
      }
      const turn = toModelTurn(response);
      if (turn.toolCalls[0]) replays.set(turn.toolCalls[0].id, replayable(response.content));
      return turn;
    },
  };
}

function realModel(): ModelClient {
  let claude: ModelClient | undefined;
  return {
    next(args) {
      // Checked per call so a missing key is a failed run, not a broken page.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY is not set'));
      claude ??= createClaudeModel({
        client: new Anthropic({ apiKey }),
        model: process.env.AGENT_MODEL || DEFAULT_MODEL,
      });
      return claude.next(args);
    },
  };
}

function scriptedModel(): ModelClient {
  return {
    async next(args) {
      // Loaded only on this path, so normal runs never touch the test double.
      const { createScriptedModel } = await import('./scripted-model');
      return createScriptedModel().next(args);
    },
  };
}

export function getModelClient(): ModelClient {
  if (process.env.AGENT_TEST_MODEL !== '1') return realModel();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AGENT_TEST_MODEL=1 is set in production: refusing the scripted model');
  }
  return scriptedModel();
}
