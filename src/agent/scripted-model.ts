import type { AgentMessage, ModelClient, ModelTurn } from './types';

const firstUserMessage = (messages: AgentMessage[]) => {
  const first = messages.find((m) => m.role === 'user');
  return first?.role === 'user' ? first.content.toLowerCase() : '';
};

const say = (text: string): ModelTurn => ({ text, toolCalls: [] });
const call = (name: string, input: unknown): ModelTurn => ({
  text: '',
  toolCalls: [{ id: `scripted_${name}`, name, input }],
});

/** Test double for end-to-end runs. Picks its turn by keyword in the first user message. */
export function createScriptedModel(): ModelClient {
  return {
    async next({ messages }) {
      const message = firstUserMessage(messages);
      if (message.includes('fail')) throw new Error('Scripted model failure');

      // Tool results are in, so finish: returning another tool call would spin the loop.
      if (messages.at(-1)?.role === 'tool') {
        return say(
          message.includes('plan')
            ? 'I drafted a study plan. It is waiting for your approval.'
            : 'I read your marks.',
        );
      }

      // Passes input validation but Postgres has no year 0, so saving really fails.
      if (message.includes('unsaveable')) {
        return call('create_study_plan', {
          title: 'Unsaveable plan',
          items: [{ due_on: '0000-01-01', task: 'Cannot be stored' }],
        });
      }
      if (message.includes('plan')) {
        return call('create_study_plan', {
          title: 'Semester revision plan',
          items: [
            { due_on: '2026-12-01', task: 'Revise algorithms' },
            { due_on: '2026-12-02', task: 'Practise past papers' },
            { due_on: '2026-12-03', task: 'Take a mock test' },
          ],
        });
      }
      if (message.includes('marks')) return call('get_marks', {});
      return say('Scripted reply.');
    },
  };
}
