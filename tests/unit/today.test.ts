import { afterEach, describe, expect, test, vi } from 'vitest';
import { addDays, agentTimezone, agentToday, todayIn } from '@/lib/today';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('todayIn', () => {
  test('uses the date in the timezone, not in UTC', () => {
    const now = new Date('2026-11-06T19:00:00Z');
    expect(todayIn('UTC', now)).toBe('2026-11-06');
    expect(todayIn('Asia/Kolkata', now)).toBe('2026-11-07');
  });
});

describe('agentTimezone', () => {
  test('defaults to Asia/Kolkata', () => {
    vi.stubEnv('AGENT_TIMEZONE', '');
    expect(agentTimezone()).toBe('Asia/Kolkata');
  });

  test('reads AGENT_TIMEZONE', () => {
    vi.stubEnv('AGENT_TIMEZONE', 'Europe/London');
    expect(agentTimezone()).toBe('Europe/London');
    expect(agentToday(new Date('2026-11-06T19:00:00Z'))).toBe('2026-11-06');
  });

  test('a timezone that does not exist falls back to the default and is logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('AGENT_TIMEZONE', 'Mars/Olympus');
    expect(agentTimezone()).toBe('Asia/Kolkata');
    expect(logged).toHaveBeenCalled();
  });
});

describe('addDays', () => {
  test('crosses month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 2)).toBe('2027-01-02');
    expect(addDays('2026-11-07', -1)).toBe('2026-11-06');
  });
});
