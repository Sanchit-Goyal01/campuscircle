'use client';

import { useRef, useState } from 'react';
import { humanizeToolName, type PendingAction } from './types';

const TOOL_LABELS: Record<string, string> = {
  create_study_plan: 'Save a study plan',
  request_mentorship: 'Ask a mentor for help',
  register_for_event: 'Register for an event',
};

type Plan = { title: string; items: { due_on: string; task: string }[] };

function asPlan(action: PendingAction): Plan | null {
  if (action.tool_name !== 'create_study_plan') return null;
  const plan = action.input as Partial<Plan> | null;
  const valid =
    typeof plan?.title === 'string' &&
    Array.isArray(plan.items) &&
    plan.items.every((i) => typeof i?.due_on === 'string' && typeof i?.task === 'string');
  return valid ? (plan as Plan) : null;
}

const formatDate = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

function reasonFrom(result: unknown): string {
  const error = (result as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : 'The action could not be completed.';
}

type Decision =
  | { state: 'pending' }
  | { state: 'done'; warning?: string }
  | { state: 'rejected' }
  | { state: 'failed'; reason: string }
  | { state: 'stale' };

export function ApprovalCard({ action }: { action: PendingAction }) {
  const [decision, setDecision] = useState<Decision>({ state: 'pending' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  const plan = asPlan(action);
  const label = TOOL_LABELS[action.tool_name] ?? humanizeToolName(action.tool_name);

  async function decide(verb: 'approve' | 'reject') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch(`/api/agent/actions/${action.id}/${verb}`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        result?: unknown;
        warning?: string;
      } | null;
      if (res.ok && body?.status === 'done') setDecision({ state: 'done', warning: body.warning });
      else if (res.ok && body?.status === 'rejected') setDecision({ state: 'rejected' });
      else if (res.ok && body?.status === 'failed') {
        setDecision({ state: 'failed', reason: reasonFrom(body.result) });
      } else if (res.status === 409) setDecision({ state: 'stale' });
      else if (res.status === 401) setNotice('Your session ended. Sign in again to decide.');
      else setNotice('That request did not go through. Try again.');
    } catch {
      setNotice('Could not reach CampusCircle. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const outcome = {
    pending: null,
    done: { stamp: plan ? 'Saved' : 'Done', text: plan ? 'This plan is saved.' : 'This action is done.' },
    rejected: { stamp: 'Rejected', text: 'Nothing was saved.' },
    failed: {
      stamp: 'Failed',
      text: decision.state === 'failed' ? decision.reason : '',
    },
    stale: { stamp: 'Closed', text: 'This request was already decided, so nothing changed here.' },
  }[decision.state];

  return (
    <section aria-label={`Approval request: ${label}`} className="slip" data-state={decision.state}>
      <h3 className="slip-label">{label}</h3>
      {plan ? (
        <>
          <p className="slip-title">{plan.title}</p>
          <ul className="slip-items">
            {plan.items.map((item, i) => (
              <li key={i}>
                <time dateTime={item.due_on}>{formatDate(item.due_on)}</time>
                <span>{item.task}</span>
              </li>
            ))}
          </ul>
        </>
      ) : action.display?.kind === 'mentorship' ? (
        <>
          <p className="slip-title">{action.display.mentor ?? 'A mentor we could not find'}</p>
          <p className="slip-note">Subject: {action.display.subject}</p>
          <p>{action.display.message}</p>
        </>
      ) : action.display?.kind === 'event' ? (
        <>
          <p className="slip-title">{action.display.title ?? 'An event we could not find'}</p>
          {action.display.when && (
            <p className="slip-note">
              {action.display.when}
              {action.display.venue ? ` · ${action.display.venue}` : ''}
            </p>
          )}
        </>
      ) : (
        <pre className="slip-json">{JSON.stringify(action.input, null, 2)}</pre>
      )}

      <div role="status">
        {outcome && (
          <div className="slip-outcome">
            <p className="stamp">{outcome.stamp}</p>
            <p className="slip-note">{outcome.text}</p>
          </div>
        )}
        {decision.state === 'done' && decision.warning && <p className="slip-notice">{decision.warning}</p>}
      </div>

      {decision.state === 'pending' && (
        <>
          <p className="slip-note">Nothing is saved until you approve.</p>
          {notice && (
            <p role="alert" className="slip-notice">
              {notice}
            </p>
          )}
          <div className="slip-actions">
            <button type="button" className="btn btn-solid" disabled={busy} onClick={() => decide('approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => decide('reject')}>
              Reject
            </button>
          </div>
        </>
      )}
    </section>
  );
}
