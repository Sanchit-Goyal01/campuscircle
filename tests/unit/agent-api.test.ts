import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { approvalResponse, toClientSteps } from '@/agent/api';

const RAW = 'insert violates check constraint "study_plan_items_due_on"';

describe('approvalResponse', () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logged.mockRestore();
  });

  test('ok is done with the result', async () => {
    const res = approvalResponse({ status: 'ok', result: { planId: 'p1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', result: { planId: 'p1' } });
  });

  test('invalid_action_state is 409', () => {
    const res = approvalResponse({ status: 'not_started', message: 'invalid_action_state' });
    expect(res.status).toBe(409);
  });

  test('not started for any other reason is 500 with a plain message', async () => {
    const res = approvalResponse({ status: 'not_started', message: RAW });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('constraint');
    expect(logged).toHaveBeenCalled();
  });

  test('ran but unrecorded is done with a warning and the result', async () => {
    const res = approvalResponse({ status: 'ran_unrecorded', result: { planId: 'p1' }, message: RAW });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('constraint');
    expect(JSON.parse(text)).toEqual({
      status: 'done',
      result: { planId: 'p1' },
      warning: expect.stringContaining('no need to ask again'),
    });
    expect(logged).toHaveBeenCalled();
  });

  test('a tool failure is failed with a plain reason', async () => {
    const res = approvalResponse({ status: 'error', message: `Could not save plan items: ${RAW}` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/constraint|Could not save plan items/);
    expect(JSON.parse(text)).toEqual({ status: 'failed', result: { error: expect.any(String) } });
    expect(logged).toHaveBeenCalled();
  });
});

describe('toClientSteps', () => {
  test('a model failure step loses its raw message', () => {
    const steps = [{ seq: 1, kind: 'error', tool_name: null, payload: { message: 'ANTHROPIC_API_KEY is not set' } }];
    expect(JSON.stringify(toClientSteps(steps))).not.toContain('ANTHROPIC_API_KEY');
  });

  test('a tool error keeps its call id and status, and loses its raw message', () => {
    const steps = [
      {
        seq: 2,
        kind: 'error',
        tool_name: 'get_marks',
        payload: { id: 'c1', outcome: { status: 'error', message: `Could not read marks: ${RAW}` } },
      },
    ];
    const [step] = toClientSteps(steps);
    expect(JSON.stringify(step)).not.toMatch(/constraint|Could not read marks/);
    expect(step.payload).toEqual({ id: 'c1', outcome: { status: 'error', message: expect.any(String) } });
  });

  test('an error outcome under another step kind is filtered too', () => {
    const steps = [{ seq: 3, kind: 'tool_result', tool_name: 't', payload: { outcome: { status: 'error', message: RAW } } }];
    expect(JSON.stringify(toClientSteps(steps))).not.toContain('constraint');
  });

  test('calls and successful results pass through untouched', () => {
    const steps = [
      { seq: 1, kind: 'tool_call', tool_name: 'get_marks', payload: { id: 'c1', input: {} } },
      { seq: 2, kind: 'tool_result', tool_name: 'get_marks', payload: { id: 'c1', outcome: { status: 'ok', result: [{ error: 'a subject' }] } } },
      { seq: 3, kind: 'approval_requested', tool_name: 't', payload: { id: 'c2', outcome: { status: 'pending_approval', actionId: 'a1' } } },
    ];
    expect(toClientSteps(steps)).toEqual(steps);
  });
});
