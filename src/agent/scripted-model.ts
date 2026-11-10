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

// Keywords checked in this order, after "fail" and the submit_* checks and before "plan" and "marks".
// The issue keywords come first so "my complaints" beats "complain" and "campus" beats "weak".
const READ_TOOLS: { keyword: string; tool: string; input: unknown; done: string }[] = [
  { keyword: 'my complaints', tool: 'get_my_complaints', input: {}, done: 'I checked your complaints.' },
  { keyword: 'campus', tool: 'get_campus_status', input: {}, done: 'I checked open issues on campus.' },
  {
    keyword: 'complain',
    tool: 'file_complaint',
    input: { location: 'Hostel Block A', description: 'The water cooler on the second floor is broken.' },
    done: 'I drafted a complaint. It is waiting for your approval.',
  },
  { keyword: 'weak', tool: 'get_weak_subjects', input: {}, done: 'I checked your weak subjects.' },
  { keyword: 'notes', tool: 'search_notes', input: { query: 'normalization' }, done: 'I searched the notes.' },
  { keyword: 'papers', tool: 'get_past_papers', input: {}, done: 'I found the past papers.' },
  { keyword: 'exam', tool: 'get_timetable', input: {}, done: 'I read your timetable.' },
];

const DEMO_FINAL =
  'I found your weak subjects, papers, notes, a mentor and a used textbook. Approve the study plan and the mentor request to go ahead.';
const DEMO_FINAL_NO_MENTOR =
  'I found your weak subjects, papers, notes and a used textbook. Approve the study plan to go ahead.';
const DEMO_READS: [string, unknown][] = [
  ['get_marks', {}],
  ['get_weak_subjects', {}],
  ['get_past_papers', { subject: 'DBMS' }],
  ['search_notes', { query: 'DBMS normalization' }],
  ['find_mentor', { subject: 'DBMS' }],
  ['search_listings', { query: 'database' }],
];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Multi-step demo: one tool per turn, each picked by whether its call is already in the conversation. */
function demoTurn(messages: AgentMessage[], now: Date): ModelTurn {
  const called = new Map<string, string>(); // tool name -> call id
  for (const m of messages) {
    if (m.role === 'assistant') for (const c of m.toolCalls) called.set(c.name, c.id);
  }
  for (const [name, input] of DEMO_READS) if (!called.has(name)) return call(name, input);
  if (!called.has('create_study_plan')) {
    const today = agentToday(now);
    return call('create_study_plan', {
      title: 'DBMS exam revision plan',
      items: [
        { due_on: addDays(today, 1), task: 'Revise DBMS normalization' },
        { due_on: addDays(today, 4), task: 'Practise DBMS past papers' },
        { due_on: addDays(today, 7), task: 'Revise SQL and transactions' },
        { due_on: addDays(today, 9), task: 'Take a DBMS mock test' },
      ],
    });
  }
  if (!called.has('request_mentorship')) {
    const id = called.get('find_mentor');
    const out = messages.flatMap((m) => (m.role === 'tool' ? m.results : [])).find((r) => r.id === id);
    // Only trust an id that sits in a "mentor_id" field of the find_mentor result.
    const mentorId = out && !out.isError ? out.output.match(new RegExp(`"mentor_id":"(${UUID_RE.source})"`, 'i'))?.[1] : undefined;
    if (mentorId) {
      return call('request_mentorship', {
        mentor_id: mentorId,
        subject: 'DBMS',
        message: 'I am weak in DBMS and my exam is in 10 days. Could you help me revise?',
      });
    }
  }
  return say(called.has('request_mentorship') ? DEMO_FINAL : DEMO_FINAL_NO_MENTOR);
}

const MESSAGE_RE = /^message ([^:]{2,80}):\s*(.+)$/i;

/** Find the person, then send to the first match; no match ends the run with plain text. */
function messageTurn(messages: AgentMessage[], name: string, body: string): ModelTurn {
  const called = new Map<string, string>(); // tool name -> call id
  for (const m of messages) {
    if (m.role === 'assistant') for (const c of m.toolCalls) called.set(c.name, c.id);
  }
  if (called.has('send_message')) return say('I drafted your message. It is waiting for your approval.');
  const id = called.get('find_person');
  if (!id) return call('find_person', { name });
  const out = messages.flatMap((m) => (m.role === 'tool' ? m.results : [])).find((r) => r.id === id);
  // Only trust an id that sits in a "person_id" field of the find_person result.
  const personId = out && !out.isError ? out.output.match(new RegExp(`"person_id":"(${UUID_RE.source})"`, 'i'))?.[1] : undefined;
  if (!personId) return say('I could not find anyone by that name.');
  return call('send_message', { recipient_id: personId, body });
}

/**
 * Test double for end-to-end runs. Picks its turn by keyword in the first user
 * message. Order matters and is fixed: "fail" throws, then a lone submit_* tool,
 * then a leading "message <name>: <text>", then my complaints, campus, complain, weak, notes, papers, exam, plan, marks. The first match wins.
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

      // "message <name>: <text>" (anchored at the start, original case) finds the person, then sends.
      const raw = messages.find((m) => m.role === 'user');
      const dm = (raw?.role === 'user' ? raw.content : '').trim().match(MESSAGE_RE);
      if (dm) return messageTurn(messages, dm[1].trim(), dm[2].trim());

      // The demo script runs before every keyword rule below.
      // Matches "exam in" and "exam is in", so the natural demo sentence works.
      if (/\bweak in\b/.test(message) && /\bexam (is )?in\b/.test(message)) return demoTurn(messages, now());

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
