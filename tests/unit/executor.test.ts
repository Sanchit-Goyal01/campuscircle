import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { executeToolCall, runApprovedAction } from '@/agent/executor';
import type { AgentTool, Role, ToolContext } from '@/agent/types';

function makeDb(opts: { approveRow?: any; approveError?: any; finishError?: any } = {}) {
  const insert = vi.fn();
  const rpc = vi.fn(async (name: string, _args: any) => {
    if (name === 'approve_pending_action') {
      if (opts.approveError) return { data: null, error: opts.approveError };
      return {
        data: opts.approveRow ?? null,
        error: null,
      };
    }
    if (name === 'finish_pending_action' && opts.finishError) {
      return { data: null, error: opts.finishError };
    }
    return { data: null, error: null };
  });
  const from = vi.fn((_table: string) => ({
    insert: (row: any) => {
      insert(row);
      return {
        select: () => ({
          single: async () => ({ data: { id: 'action-1' }, error: null }),
        }),
      };
    },
  }));
  return { db: { from, rpc } as any, insert, rpc, from };
}

const ctxFor = (db: any, role: Role = 'student'): ToolContext => ({
  db,
  userId: 'u1',
  collegeId: 'c1',
  role,
});

function tool(over: Partial<AgentTool> = {}): AgentTool & { run: ReturnType<typeof vi.fn> } {
  return {
    name: 't',
    description: 'd',
    kind: 'read',
    roles: ['student'],
    input: z.object({ n: z.number() }),
    run: vi.fn(async () => ({ hello: 'world' })),
    ...over,
  } as any;
}

describe('executeToolCall', () => {
  test('read tool runs and returns ok', async () => {
    const { db } = makeDb();
    const t = tool();
    const out = await executeToolCall({ name: 't', input: { n: 1 } }, [t], ctxFor(db), 'run1');
    expect(out).toEqual({ status: 'ok', result: { hello: 'world' } });
    expect(t.run).toHaveBeenCalledOnce();
  });

  test('write tool does not run; creates pending action', async () => {
    const { db, insert } = makeDb();
    const t = tool({ kind: 'write' });
    const out = await executeToolCall({ name: 't', input: { n: 1 } }, [t], ctxFor(db), 'run1');
    expect(out).toEqual({ status: 'pending_approval', actionId: 'action-1' });
    expect(t.run).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      run_id: 'run1',
      student_id: 'u1',
      college_id: 'c1',
      tool_name: 't',
      input: { n: 1 },
    });
  });

  test('unknown tool returns error, does not throw', async () => {
    const { db } = makeDb();
    const out = await executeToolCall({ name: 'nope', input: {} }, [tool()], ctxFor(db), 'r');
    expect(out.status).toBe('error');
    expect((out as any).message).toContain('nope');
  });

  test('invalid input returns error, tool does not run', async () => {
    const { db } = makeDb();
    const t = tool();
    const out = await executeToolCall({ name: 't', input: { n: 'x' } }, [t], ctxFor(db), 'r');
    expect(out.status).toBe('error');
    expect((out as any).message.length).toBeGreaterThan(0);
    expect(t.run).not.toHaveBeenCalled();
  });

  test('tool not allowed for role returns error', async () => {
    const { db, insert } = makeDb();
    const t = tool({ roles: ['authority'], kind: 'write' });
    const out = await executeToolCall({ name: 't', input: { n: 1 } }, [t], ctxFor(db), 'r');
    expect(out.status).toBe('error');
    expect(t.run).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test('tool that throws returns error', async () => {
    const { db } = makeDb();
    const t = tool({ run: vi.fn(async () => { throw new Error('boom'); }) });
    const out = await executeToolCall({ name: 't', input: { n: 1 } }, [t], ctxFor(db), 'r');
    expect(out).toEqual({ status: 'error', message: 'boom' });
  });
});

describe('runApprovedAction', () => {
  const row = { id: 'a1', tool_name: 't', input: { n: 2 }, status: 'approved' };

  test('runs the tool and finishes as done', async () => {
    const { db, rpc } = makeDb({ approveRow: row });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({ status: 'ok', result: { hello: 'world' } });
    expect(t.run).toHaveBeenCalledWith({ n: 2 }, expect.anything());
    expect(rpc).toHaveBeenCalledWith('approve_pending_action', { p_id: 'a1' });
    expect(rpc).toHaveBeenCalledWith('finish_pending_action', {
      p_id: 'a1',
      p_status: 'done',
      p_result: { hello: 'world' },
    });
  });

  test('finishes as failed when tool throws', async () => {
    const { db, rpc } = makeDb({ approveRow: row });
    const t = tool({ kind: 'write', run: vi.fn(async () => { throw new Error('boom'); }) });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({ status: 'error', message: 'boom' });
    expect(rpc).toHaveBeenCalledWith('finish_pending_action', {
      p_id: 'a1',
      p_status: 'failed',
      p_result: { error: 'boom' },
    });
  });

  test('does not run when approve RPC fails', async () => {
    const { db, rpc } = makeDb({ approveError: { message: 'invalid_action_state' } });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({ status: 'not_started', message: 'invalid_action_state' });
    expect(t.run).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('finish_pending_action', expect.anything());
  });

  test('a transport error on the approve RPC is not_started, not a failed action', async () => {
    const { db, rpc } = makeDb({ approveError: { message: 'JWT expired' } });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({ status: 'not_started', message: 'JWT expired' });
    expect(t.run).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('finish_pending_action', expect.anything());
  });

  test('an approve RPC that returns no row is not_started', async () => {
    const { db } = makeDb({ approveRow: null });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out.status).toBe('not_started');
    expect(t.run).not.toHaveBeenCalled();
  });

  test('role check applies; tool does not run and action is marked failed', async () => {
    const { db, rpc } = makeDb({ approveRow: row });
    const t = tool({ kind: 'write', roles: ['authority'] });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out.status).toBe('error');
    expect(t.run).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('finish_pending_action', expect.objectContaining({ p_status: 'failed' }));
  });

  test('re-validates stored input before running', async () => {
    const { db } = makeDb({ approveRow: { ...row, input: { n: 'bad' } } });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out.status).toBe('error');
    expect(t.run).not.toHaveBeenCalled();
  });

  test('void tool result is recorded as null', async () => {
    const { db, rpc } = makeDb({ approveRow: row });
    const t = tool({ kind: 'write', run: vi.fn(async () => undefined) });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({ status: 'ok', result: undefined });
    expect(rpc).toHaveBeenCalledWith('finish_pending_action', {
      p_id: 'a1',
      p_status: 'done',
      p_result: null,
    });
  });

  test('finish failure after success is ran_unrecorded with the result, and is not re-finished as failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, rpc } = makeDb({ approveRow: row, finishError: { message: 'rpc down' } });
    const t = tool({ kind: 'write' });
    const out = await runApprovedAction('a1', [t], ctxFor(db));
    expect(out).toEqual({
      status: 'ran_unrecorded',
      result: { hello: 'world' },
      message: expect.stringContaining('ran but its result was not recorded'),
    });
    expect(t.run).toHaveBeenCalledOnce();
    const finishCalls = rpc.mock.calls.filter((c) => c[0] === 'finish_pending_action');
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0][1].p_status).toBe('done');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
