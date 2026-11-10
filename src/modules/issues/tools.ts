import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelClient } from '../../agent/model';
import type { AgentTool } from '../../agent/types';
import { edgeEmbedder } from '../academics/embed';
import { fileIssueReport } from './intake';
import { issueAdminDb } from './submit';

const RATE_LIMITED = 'You have filed 5 reports in the last 24 hours. Try again later.';
const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'resolved_pending'];
const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** The college's locations (RLS limits rows to it), sorted by name. */
async function collegeLocations(db: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from('locations').select('id, name').order('name');
  if (error) throw new Error(`Could not read locations: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

const unknownLocation = (locs: { name: string }[]) =>
  new Error(`Unknown location. Known locations: ${locs.map((l) => l.name).join(', ')}`);

const findLocation = <L extends { name: string }>(locs: L[], name: string): L | undefined => {
  const want = name.trim().toLowerCase();
  return locs.find((l) => l.name.trim().toLowerCase() === want);
};

const complaintInput = z.strictObject({
  location: z.string().trim().min(1),
  description: z.string().min(10).max(2000),
});

export const fileComplaint: AgentTool<z.infer<typeof complaintInput>> = {
  name: 'file_complaint',
  description:
    'File a campus issue report (complaint) for the signed-in student at a named campus location. Needs student approval.',
  kind: 'write',
  roles: ['student'],
  input: complaintInput,
  async run(input, ctx) {
    // ctx comes from the student's own session; the model never supplies an id.
    if (ctx.role !== 'student') throw new Error('Only students can file reports.');
    const locs = await collegeLocations(ctx.db);
    const loc = findLocation(locs, input.location);
    if (!loc) throw unknownLocation(locs);
    try {
      return await fileIssueReport({
        db: ctx.db,
        admin: issueAdminDb(),
        studentId: ctx.userId,
        input: { location_id: loc.id, body: input.description, photo_paths: [] },
        classifier: getModelClient('classifier'),
        matcher: getModelClient(),
        embedder: edgeEmbedder,
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.message === 'rate_limited') throw new Error(RATE_LIMITED);
      if (err.code === '42501') throw new Error('Only students can file reports.');
      throw e;
    }
  },
};

export const getMyComplaints: AgentTool<Record<string, never>> = {
  name: 'get_my_complaints',
  description:
    "List the signed-in student's campus issue reports, newest first, with status, number of reporters, due date and latest event.",
  kind: 'read',
  roles: ['student'],
  input: z.strictObject({}),
  async run(_input, ctx) {
    // issue_reporters is visible only to its own student, so this is the caller's issues.
    const { data, error } = await ctx.db
      .from('issue_reporters')
      .select('issues(id, title, status, report_count, due_at, created_at, locations(name))')
      .eq('student_id', ctx.userId);
    if (error) throw new Error(`Could not read complaints: ${error.message}`);
    const issues = ((data ?? []) as any[])
      .map((r) => one<any>(r.issues))
      .filter(Boolean)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 20);
    if (issues.length === 0) return [];

    // Newest event per issue: one small query each (at most 20), never the full log.
    const latest = await Promise.all(
      issues.map((i) =>
        ctx.db
          .from('issue_events')
          .select('kind, created_at')
          .eq('issue_id', i.id)
          .order('created_at', { ascending: false })
          .limit(1),
      ),
    );
    const last = new Map<string, { kind: string; at: string }>();
    latest.forEach((res, idx) => {
      if (res.error) throw new Error(`Could not read complaint events: ${res.error.message}`);
      const e = (res.data ?? [])[0] as { kind: string; created_at: string } | undefined;
      if (e) last.set(issues[idx].id, { kind: e.kind, at: e.created_at });
    });
    return issues.map((i) => ({
      id: i.id as string,
      title: i.title as string,
      location: (one<any>(i.locations)?.name ?? '') as string,
      status: i.status as string,
      report_count: i.report_count as number,
      due_at: (i.due_at ?? null) as string | null,
      last_event: last.get(i.id) ?? null,
    }));
  },
};

const statusInput = z.strictObject({ location: z.string().trim().min(1).optional() });
const STATUS_CAP = 200;

export const getCampusStatus: AgentTool<z.infer<typeof statusInput>> = {
  name: 'get_campus_status',
  description:
    'List open campus issues in the signed-in user\'s college, grouped by location, optionally for one location. Returns at most the 200 newest issues; `truncated` is true when there are more. Includes no personal information.',
  kind: 'read',
  roles: ['student', 'society_admin', 'authority', 'college_admin'],
  input: statusInput,
  async run(input, ctx) {
    let locationId: string | undefined;
    if (input.location !== undefined) {
      const locs = await collegeLocations(ctx.db);
      const loc = findLocation(locs, input.location);
      if (!loc) throw unknownLocation(locs);
      locationId = loc.id;
    }
    let q = ctx.db
      .from('issues')
      .select('title, category, severity, status, report_count, created_at, locations(name)')
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(STATUS_CAP + 1);
    if (locationId) q = q.eq('location_id', locationId);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read campus issues: ${error.message}`);
    const rows = (data ?? []) as any[];
    const truncated = rows.length > STATUS_CAP;
    const groups = new Map<string, unknown[]>();
    for (const r of rows.slice(0, STATUS_CAP)) {
      const name = (one<any>(r.locations)?.name ?? 'Unknown') as string;
      const list = groups.get(name) ?? [];
      list.push({
        title: r.title,
        category: r.category,
        severity: r.severity,
        status: r.status,
        report_count: r.report_count,
      });
      groups.set(name, list);
    }
    const locations = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([location, issues]) => ({ location, issues }));
    return { truncated, locations };
  },
};
