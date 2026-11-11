import type { ApprovalOutcome } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isActionId = (id: string) => UUID.test(id);

export const INVALID_ACTION_STATE = 'invalid_action_state';

export const errorResponse = (status: number, error: string) => Response.json({ error }, { status });

export const signedOut = () => errorResponse(401, 'Sign in to continue.');
export const badActionId = () => errorResponse(400, 'That action id is not valid.');
export const actionClosed = () => errorResponse(409, 'This action can no longer be changed.');

// Plain text for the student. Tool and model errors can hold SQL, validation or
// configuration detail, which belongs in the log and the stored rows only.
const ACTION_FAILED = 'This could not be saved. Ask again to start over.';
const ACTION_UNRECORDED = 'This is saved, but it may still show as unfinished. There is no need to ask again.';
const STEP_FAILED = 'This step could not be completed.';

/** Logs the real cause and answers with a plain message: no stack or SQL text reaches the client. */
export function unexpected(route: string, e: unknown) {
  console.error(route, e);
  return errorResponse(500, 'Something went wrong. Please try again.');
}

export function approvalResponse(outcome: ApprovalOutcome): Response {
  switch (outcome.status) {
    case 'ok':
      return Response.json({ status: 'done', result: outcome.result });
    case 'ran_unrecorded':
      console.error('Approved action ran but was not recorded:', outcome.message);
      return Response.json({ status: 'done', result: outcome.result, warning: ACTION_UNRECORDED });
    case 'not_started':
      if (outcome.message === INVALID_ACTION_STATE) return actionClosed();
      return unexpected('Approved action did not start', outcome.message);
    case 'error':
      console.error('Approved action failed:', outcome.message);
      return Response.json({ status: 'failed', result: { error: ACTION_FAILED } });
  }
}

type StepPayload = { id?: unknown; outcome?: { status?: unknown } } | null;

/** The stored steps keep the real errors for the model and the log; the student gets plain text. */
export function toClientSteps<T extends { kind: string; payload: unknown }>(steps: T[]): T[] {
  return steps.map((step) => {
    const payload = step.payload as StepPayload;
    if (step.kind !== 'error' && payload?.outcome?.status !== 'error') return step;
    const outcome = { status: 'error', message: STEP_FAILED };
    return { ...step, payload: payload?.id ? { id: payload.id, outcome } : { outcome } };
  });
}
