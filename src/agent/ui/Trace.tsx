import { humanizeToolName, type TraceStep } from './types';

const TOOL_LABELS: Record<string, string> = {
  get_marks: 'Read your marks',
  create_study_plan: 'Drafted a study plan',
  get_weak_subjects: 'Checked your weak subjects',
  search_notes: 'Searched notes',
  get_past_papers: 'Found past papers',
  get_timetable: 'Read your timetable',
};

type Outcome = { status?: string; result?: unknown; message?: string };
type Payload = { id?: string; outcome?: Outcome; message?: string };

type Entry = { key: number; toolName: string | null; outcome: Outcome | null };

/** One entry per tool call, with its result folded in. A model failure has no call. */
function toEntries(steps: TraceStep[]): Entry[] {
  const entries: Entry[] = [];
  const byCallId = new Map<string, Entry>();
  for (const step of steps) {
    const payload = (step.payload ?? {}) as Payload;
    if (step.kind === 'tool_call') {
      const entry: Entry = { key: step.seq, toolName: step.tool_name, outcome: null };
      entries.push(entry);
      if (payload.id) byCallId.set(payload.id, entry);
      continue;
    }
    const outcome = payload.outcome ?? { status: 'error', message: payload.message };
    const call = payload.id ? byCallId.get(payload.id) : undefined;
    if (call) call.outcome = outcome;
    else entries.push({ key: step.seq, toolName: step.tool_name, outcome });
  }
  return entries;
}

function summarize({ toolName, outcome }: Entry): string {
  if (!toolName) return 'Could not get an answer from the model.';
  if (!outcome) return 'Did not finish.';
  if (outcome.status === 'pending_approval') return 'Waiting for your approval.';
  if (outcome.status === 'error') return outcome.message ?? 'This step failed.';
  if (Array.isArray(outcome.result)) {
    const n = outcome.result.length;
    return n === 0 ? 'Nothing found.' : `Found ${n} ${n === 1 ? 'record' : 'records'}.`;
  }
  return 'Done.';
}

/** The payload to offer behind "Show details", when there is more than the summary says. */
function details({ toolName, outcome }: Entry): string | null {
  if (!toolName || !outcome) return null;
  return outcome.status === 'ok' ? JSON.stringify(outcome.result ?? null, null, 2) : null;
}

/** Tool results are untrusted, so everything here renders as plain text. */
export function Trace({ steps }: { steps: TraceStep[] }) {
  const entries = toEntries(steps);
  if (entries.length === 0) return null;
  return (
    <ol aria-label="What the assistant did" className="trace">
      {entries.map((entry) => {
        const failed = !entry.toolName || entry.outcome?.status === 'error';
        const more = details(entry);
        return (
          <li key={entry.key} className="trace-step" data-failed={failed || undefined}>
            <p className="trace-title">
              {entry.toolName
                ? (TOOL_LABELS[entry.toolName] ?? humanizeToolName(entry.toolName))
                : 'Model request'}
            </p>
            {entry.toolName && <code className="trace-tool">{entry.toolName}</code>}
            <p>{summarize(entry)}</p>
            {more && (
              <details className="trace-details">
                <summary>Show details</summary>
                <pre>{more}</pre>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
