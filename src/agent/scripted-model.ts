import { addDays, agentToday } from '../lib/today';
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
export function createScriptedModel(now: () => Date = () => new Date()): ModelClient {
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

      if (message.includes('plan')) {
        const today = agentToday(now());
        return call('create_study_plan', {
          title: 'Semester revision plan',
          items: [
            { due_on: addDays(today, 1), task: 'Revise algorithms' },
            { due_on: addDays(today, 2), task: 'Practise past papers' },
            { due_on: addDays(today, 3), task: 'Take a mock test' },
          ],
        });
      }
      if (message.includes('marks')) return call('get_marks', {});
      return say('Scripted reply.');
    },
  };
}
