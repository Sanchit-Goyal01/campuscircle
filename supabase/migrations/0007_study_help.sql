-- Study help on notes: one row per request, used for the per-student daily limit.
-- Owner-only and insert-only; rows are written through claim_study_help.

create table public.study_help_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  -- set null, not cascade: deleting a note must not hand the student their quota back.
  note_id uuid references public.notes (id) on delete set null,
  mode text not null check (mode in ('ask', 'summary', 'quiz')),
  created_at timestamptz not null default now()
);
create index study_help_requests_student_day_idx
  on public.study_help_requests (student_id, created_at);
create index study_help_requests_college_id_idx on public.study_help_requests (college_id);
create index study_help_requests_note_id_idx on public.study_help_requests (note_id);

alter table public.study_help_requests enable row level security;
revoke all on public.study_help_requests from anon, authenticated;
grant select on public.study_help_requests to authenticated;
grant insert (student_id, college_id, note_id, mode) on public.study_help_requests to authenticated;

create policy study_help_requests_select on public.study_help_requests
  for select to authenticated using (student_id = (select auth.uid()));
-- The note subquery runs under the caller's RLS, so it must be a note of their college.
create policy study_help_requests_insert on public.study_help_requests
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
    and exists (select 1 from public.notes n where n.id = study_help_requests.note_id)
  );

-- Counts today's requests (in p_tz) and records a new one when under p_limit,
-- in one transaction. The per-student advisory lock serialises parallel calls,
-- so two requests cannot both see "limit - 1" and both insert.
-- Security invoker: the insert policy above applies.
create function public.claim_study_help(p_note_id uuid, p_mode text, p_tz text, p_limit int)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day date := (now() at time zone p_tz)::date;
  v_used int;
begin
  perform pg_advisory_xact_lock(hashtextextended('study_help:' || (select auth.uid())::text, 0));
  select count(*) into v_used
  from public.study_help_requests r
  where r.student_id = (select auth.uid())
    and r.created_at >= (v_day::timestamp at time zone p_tz)
    and r.created_at < ((v_day + 1)::timestamp at time zone p_tz);
  if v_used >= p_limit then
    return false;
  end if;
  insert into public.study_help_requests (student_id, college_id, note_id, mode)
  values ((select auth.uid()), (select public.current_college_id()), p_note_id, p_mode);
  return true;
end
$$;
revoke all on function public.claim_study_help(uuid, text, text, int) from public, anon;
grant execute on function public.claim_study_help(uuid, text, text, int) to authenticated;
