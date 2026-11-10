import { addDays, agentToday } from '../lib/today';
import type { AgentMessage, ModelClient, ModelTurn } from './types';

const firstUserMessage = (messages: AgentMessage[]) => {
  const first = messages.find((m) => m.role === 'user');
  return first?.role === 'user' ? first.content.toLowerCase() : '';
};

const say = (text: string): ModelTurn => ({ text, toolCalls: [] });
const LETTERS = ['A', 'B', 'C', 'D'];
// Fixed valid inputs for study help's single submit_* tool. Every citation is page 1.
const SUBMIT_INPUTS: Record<string, unknown> = {
  submit_answer: { answer: 'Scripted answer: normalisation removes redundancy.', pages: [1] },
  submit_summary: { summary: 'Scripted summary of the note.', pages: [1] },
  submit_quiz: {
    questions: [0, 1, 2, 3, 0].map((answer_index, i) => ({
      question: `Scripted question ${i + 1}?`,
      options: LETTERS.map((l) => `Q${i + 1} option ${l}`),
      answer_index,
      page: 1,
    })),
  },
};

const call = (name: string, input: unknown): ModelTurn => ({
  text: '',
  toolCalls: [{ id: `scripted_${name}`, name, input }],
});

// Read-tool keywords, checked in this order, after "fail" and before "plan" and "marks".
const READ_TOOLS: { keyword: string; tool: string; input: unknown; done: string }[] = [
  { keyword: 'weak', tool: 'get_weak_subjects', input: {}, done: 'I checked your weak subjects.' },
  { keyword: 'notes', tool: 'search_notes', input: { query: 'normalization' }, done: 'I searched the notes.' },
  { keyword: 'papers', tool: 'get_past_papers', input: {}, done: 'I found the past papers.' },
  { keyword: 'exam', tool: 'get_timetable', input: {}, done: 'I read your timetable.' },
];

/**
 * Test double for end-to-end runs. Picks its turn by keyword in the first user
 * message. Order matters and is fixed: "fail" throws, then a lone submit_* tool,
 * then weak, notes, papers, exam, plan, marks. The first match wins.
 */
export function createScriptedModel(now: () => Date = () => new Date()): ModelClient {
  return {
    async next({ messages, tools, toolChoice }) {
      const message = firstUserMessage(messages);
      if (message.includes('fail')) throw new Error('Scripted model failure');

      // Issue intake forces one tool; the original-case text is needed for titles and ids.
      if (toolChoice?.name === 'submit_classification') {
        const fenced = message.match(/<report>([\s\S]*?)<\/report>/)?.[1] ?? message;
        if (fenced.includes('water')) {
          return call('submit_classification', {
            title: 'Water cooler not working',
            category: 'water',
            severity: 'high',
            department: 'Hostel',
          });
        }
        const raw = messages.find((m) => m.role === 'user');
        const content = raw?.role === 'user' ? raw.content : '';
        const report = content.match(/<report>([\s\S]*?)<\/report>/i)?.[1] ?? content;
        return call('submit_classification', {
          title: report.trim().slice(0, 60),
          category: 'other',
          severity: 'medium',
          department: 'Maintenance',
        });
      }
      if (toolChoice?.name === 'submit_match') {
        const at = message.lastIndexOf('\n<candidates>\ncandidates:');
        const after = at < 0 ? '' : message.slice(at);
        const id = after.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
        return call('submit_match', { issue_id: id ?? null });
      }
      if (toolChoice?.name === 'submit_insight') {
        return call('submit_insight', {
          hypothesis: 'Scripted hypothesis: shared plumbing on this floor.',
          confidence: 'medium',
        });
      }

      // Study help offers exactly one submit_* tool and expects it to be called.
      if (tools.length === 1 && tools[0].name.startsWith('submit_') && tools[0].name in SUBMIT_INPUTS) {
        return call(tools[0].name, SUBMIT_INPUTS[tools[0].name]);
      }

      // Tool results are in, so finish: returning another tool call would spin the loop.
      const read = READ_TOOLS.find((r) => message.includes(r.keyword));
      if (messages.at(-1)?.role === 'tool') {
        if (read) return say(read.done);
        return say(
          message.includes('plan')
            ? 'I drafted a study plan. It is waiting for your approval.'
            : 'I read your marks.',
        );
      }

      if (read) return call(read.tool, read.input);

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
