'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApprovalCard } from './ApprovalCard';
import { Trace } from './Trace';
import type { PendingAction, TraceStep } from './types';

const MAX_MESSAGE = 4000;

type Turn = {
  key: number;
  message: string;
  // failed offers Retry; refused does not, because resending would not help.
  phase: 'running' | 'answered' | 'failed' | 'refused';
  reply: string;
  steps: TraceStep[];
  actions: PendingAction[];
  retried?: boolean;
};

type RunBody = {
  reply?: string;
  error?: string;
  steps?: TraceStep[];
  pendingActions?: PendingAction[];
};

const FAILED_REPLY = 'Something went wrong while working on that.';

export function AgentPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const nextKey = useRef(0);
  const latest = useRef<HTMLLIElement>(null);

  useEffect(() => {
    latest.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);

  async function send(message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    const key = nextKey.current++;
    const update = (patch: Partial<Turn>) =>
      setTurns((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    setTurns((all) => [...all, { key, message, phase: 'running', reply: '', steps: [], actions: [] }]);

    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const body = (await res.json().catch(() => null)) as RunBody | null;
      const steps = body?.steps ?? [];
      const actions = body?.pendingActions ?? [];
      if (res.ok) {
        update({ phase: 'answered', reply: body?.reply ?? '', steps, actions });
        setDraft((current) => (current === message ? '' : current));
      } else if (res.status === 401) {
        update({ phase: 'refused', reply: 'Your session ended. Sign in again to continue.' });
      } else if (res.status === 400 || res.status === 429) {
        update({ phase: 'refused', reply: body?.error ?? FAILED_REPLY });
      } else {
        update({ phase: 'failed', reply: body?.reply ?? body?.error ?? FAILED_REPLY, steps, actions });
      }
    } catch {
      update({ phase: 'failed', reply: 'Could not reach CampusCircle. Check your connection.' });
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (draft.trim() === '') return setFormError('Write a message first.');
    if (draft.length > MAX_MESSAGE) {
      return setFormError(`Shorten your message to ${MAX_MESSAGE} characters or fewer.`);
    }
    setFormError('');
    void send(draft);
  }

  function retry(turn: Turn) {
    if (inFlight.current) return;
    setTurns((all) => all.map((t) => (t.key === turn.key ? { ...t, retried: true } : t)));
    void send(turn.message);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!inFlight.current) submit();
    }
  }

  const last = turns.at(-1);
  const announcement = last?.phase === 'running' ? 'Working on it.' : (last?.reply ?? '');

  return (
    <section aria-label="CampusCircle assistant" className="notebook">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {turns.length === 0 ? (
        <div className="notebook-empty">
          <p>
            Ask about your marks, or ask for a revision plan with dates. Anything that would change your
            account waits here for your approval.
          </p>
          <p className="notebook-hint">Each message starts fresh, so include everything I need in it.</p>
        </div>
      ) : (
        <ol className="turns" aria-label="Conversation">
          {turns.map((turn, i) => (
            <li key={turn.key} className="turn" ref={i === turns.length - 1 ? latest : undefined}>
              <p className="turn-message">{turn.message}</p>
              <div className="turn-margin">
                {turn.phase === 'running' ? (
                  <p className="turn-working">Working on it. This can take a minute.</p>
                ) : (
                  <Trace steps={turn.steps} />
                )}
              </div>
              <div className="turn-answer">
                {turn.phase === 'answered' && <p className="turn-reply">{turn.reply}</p>}
                {(turn.phase === 'failed' || turn.phase === 'refused') && (
                  <div role="alert" className="turn-failure">
                    <p>{turn.reply}</p>
                    {turn.phase === 'failed' && !turn.retried && (
                      <button
                        type="button"
                        className="btn btn-line"
                        disabled={running}
                        onClick={() => retry(turn)}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {turn.actions.map((action) => (
                  <ApprovalCard key={action.id} action={action} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form className="composer" onSubmit={submit} noValidate>
        <label htmlFor="agent-message" className="composer-label">
          Ask CampusCircle
        </label>
        <textarea
          id="agent-message"
          className="composer-input"
          rows={3}
          value={draft}
          aria-invalid={formError !== ''}
          aria-describedby={formError ? 'agent-message-error' : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setFormError('');
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-foot">
          {formError ? (
            <p id="agent-message-error" role="alert" className="composer-error">
              {formError}
            </p>
          ) : (
            <p className="composer-count" data-over={draft.length > MAX_MESSAGE || undefined}>
              {draft.length > MAX_MESSAGE - 500 ? `${draft.length} of ${MAX_MESSAGE} characters` : ''}
            </p>
          )}
          <button type="submit" className="btn btn-solid" disabled={running}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
