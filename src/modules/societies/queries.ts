import type { SupabaseClient } from '@supabase/supabase-js';

export type MemberStatus = 'pending' | 'approved' | 'declined';

export type SocietyListItem = {
  id: string;
  name: string;
  description: string;
  members: number;
  myStatus: MemberStatus | null;
};

export type SocietyDetail = {
  id: string;
  name: string;
  description: string;
  adminId: string | null;
  adminName: string | null;
  members: number;
  myStatus: MemberStatus | null;
  announcements: { id: string; title: string; body: string; created_at: string }[];
  pending: { studentId: string; name: string; created_at: string }[];
};

const MAX_SOCIETIES = 100;

async function memberCount(db: SupabaseClient, societyId: string): Promise<number> {
  const { data, error } = await db.rpc('society_member_count', { p_society_id: societyId });
  if (error) throw new Error(`Could not count members: ${error.message}`);
  return (data as number) ?? 0;
}

async function myStatuses(db: SupabaseClient, userId: string): Promise<Map<string, MemberStatus>> {
  // RLS returns the caller's own rows (and, for an admin, their society's rows), so filter by student.
  const { data, error } = await db.from('society_members').select('society_id, status').eq('student_id', userId);
  if (error) throw new Error(`Could not load memberships: ${error.message}`);
  // A withdrawn request only exists as a cooldown marker; the UI treats it as no membership.
  return new Map(
    (data ?? []).filter((r) => r.status !== 'withdrawn').map((r) => [r.society_id as string, r.status as MemberStatus]),
  );
}

/** Societies of the caller's college (RLS), with approved member counts and the caller's own status. */
export async function listSocieties(db: SupabaseClient, userId: string): Promise<SocietyListItem[]> {
  const { data, error } = await db
    .from('societies')
    .select('id, name, description')
    .order('name', { ascending: true })
    .limit(MAX_SOCIETIES);
  if (error) throw new Error(`Could not load societies: ${error.message}`);
  const rows = (data ?? []) as { id: string; name: string; description: string }[];
  const [mine, counts] = await Promise.all([myStatuses(db, userId), Promise.all(rows.map((r) => memberCount(db, r.id)))]);
  return rows.map((r, i) => ({ ...r, members: counts[i], myStatus: mine.get(r.id) ?? null }));
}

/** One society, or null when it is not in the caller's college. Pending requests load only for its admin. */
export async function getSociety(db: SupabaseClient, userId: string, id: string): Promise<SocietyDetail | null> {
  const { data: s, error } = await db
    .from('societies')
    .select('id, name, description, admin_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load society: ${error.message}`);
  if (!s) return null;
  const isAdmin = s.admin_id === userId;

  const [members, mine, ann, adminProfile] = await Promise.all([
    memberCount(db, id),
    myStatuses(db, userId),
    db
      .from('society_announcements')
      .select('id, title, body, created_at')
      .eq('society_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    s.admin_id ? db.from('profiles').select('full_name').eq('id', s.admin_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (ann.error) throw new Error(`Could not load announcements: ${ann.error.message}`);

  let pending: SocietyDetail['pending'] = [];
  if (isAdmin) {
    const { data: reqs, error: re } = await db
      .from('society_members')
      .select('student_id, created_at')
      .eq('society_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100);
    if (re) throw new Error(`Could not load requests: ${re.message}`);
    const ids = (reqs ?? []).map((r) => r.student_id as string);
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: people } = await db.from('profiles').select('id, full_name').in('id', ids);
      for (const p of (people ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name || 'A student');
    }
    pending = (reqs ?? []).map((r) => ({
      studentId: r.student_id as string,
      name: names.get(r.student_id as string) ?? 'A student',
      created_at: r.created_at as string,
    }));
  }

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    adminId: s.admin_id,
    adminName: (adminProfile.data as { full_name: string } | null)?.full_name || null,
    members,
    myStatus: mine.get(id) ?? null,
    announcements: (ann.data ?? []) as SocietyDetail['announcements'],
    pending,
  };
}
