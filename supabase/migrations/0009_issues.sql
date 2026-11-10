-- Campus Issues: locations, SLA rules, issues, reporter-private reports,
-- events, confirmations, notifications, and the issue-photos bucket.
-- Writes to issue tables go through security definer RPCs (later migration);
-- authenticated gets select only here.

create type public.issue_status as enum
  ('open', 'assigned', 'in_progress', 'resolved_pending', 'closed', 'closed_unverified');
create type public.issue_severity as enum ('critical', 'high', 'medium', 'low');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  name text not null,
  unique (college_id, name)
);

create table public.sla_rules (
  college_id uuid not null references public.colleges (id) on delete cascade,
  severity public.issue_severity not null,
  deadline_minutes int not null check (deadline_minutes > 0),
  primary key (college_id, severity)
);

create function public.seed_default_sla_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sla_rules (college_id, severity, deadline_minutes) values
    (new.id, 'critical', 1440),
    (new.id, 'high', 2880),
    (new.id, 'medium', 4320),
    (new.id, 'low', 10080)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_default_sla_rules() from public, anon, authenticated;

create trigger colleges_default_sla_rules
  after insert on public.colleges
  for each row execute function public.seed_default_sla_rules();

-- Colleges that already exist.
insert into public.sla_rules (college_id, severity, deadline_minutes)
select c.id, v.severity, v.minutes
from public.colleges c
cross join (values
  ('critical'::public.issue_severity, 1440),
  ('high'::public.issue_severity, 2880),
  ('medium'::public.issue_severity, 4320),
  ('low'::public.issue_severity, 10080)
) as v (severity, minutes)
on conflict do nothing;

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  department_id uuid references public.departments (id),
  category text check (category in
    ('water', 'electricity', 'internet', 'sanitation', 'furniture', 'safety', 'other')),
  severity public.issue_severity,
  title text not null,
  status public.issue_status not null default 'open',
  report_count int not null default 1,
  escalation_level smallint not null default 0 check (escalation_level between 0 and 2),
  due_at timestamptz,
  needs_triage boolean not null default false,
  resolved_pending_at timestamptz,
  confirmation_round int not null default 0,
  closed_at timestamptz,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index issues_college_status_idx on public.issues (college_id, status);
create index issues_location_id_idx on public.issues (location_id);
create index issues_department_id_idx on public.issues (department_id);

-- No reporter column: who reported lives only in issue_reporters.
create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  body text not null,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index issue_reports_issue_id_idx on public.issue_reports (issue_id);
create index issue_reports_college_id_idx on public.issue_reports (college_id);

create table public.issue_reporters (
  issue_id uuid not null references public.issues (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  first_report_id uuid references public.issue_reports (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (issue_id, student_id)
);
create index issue_reporters_student_id_idx on public.issue_reporters (student_id);
create index issue_reporters_college_id_idx on public.issue_reporters (college_id);
create index issue_reporters_first_report_id_idx on public.issue_reporters (first_report_id);

create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  kind text not null check (kind in
    ('reported', 'merged', 'status_changed', 'triaged', 'escalated',
     'vote_closed', 'vote_reopened', 'closed_unverified')),
  from_status public.issue_status,
  to_status public.issue_status,
  actor_role public.app_role,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now(),
  -- Student identity must never be written to the event log.
  constraint issue_events_no_student_actor check (actor_role is distinct from 'student' or actor_id is null)
);
create index issue_events_issue_id_idx on public.issue_events (issue_id);
create index issue_events_college_id_idx on public.issue_events (college_id);

create table public.issue_confirmations (
  issue_id uuid not null references public.issues (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  round int not null,
  fixed boolean not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, student_id, round)
);
create index issue_confirmations_student_id_idx on public.issue_confirmations (student_id);
create index issue_confirmations_college_id_idx on public.issue_confirmations (college_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_id_idx on public.notifications (user_id);
create index notifications_college_id_idx on public.notifications (college_id);

alter table public.locations enable row level security;
alter table public.sla_rules enable row level security;
alter table public.issues enable row level security;
alter table public.issue_reports enable row level security;
alter table public.issue_reporters enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_confirmations enable row level security;
alter table public.notifications enable row level security;

revoke all on public.locations, public.sla_rules, public.issues, public.issue_reports,
  public.issue_reporters, public.issue_events, public.issue_confirmations,
  public.notifications from anon, authenticated;
grant select on public.locations, public.sla_rules, public.issues, public.issue_reports,
  public.issue_reporters, public.issue_events, public.issue_confirmations,
  public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- College admin config: gated by policy below.
grant insert (college_id, name), delete on public.locations to authenticated;
grant update (name) on public.locations to authenticated;
grant update (deadline_minutes) on public.sla_rules to authenticated;

create policy locations_select on public.locations
  for select to authenticated using (college_id = (select public.current_college_id()));
create policy sla_rules_select on public.sla_rules
  for select to authenticated using (college_id = (select public.current_college_id()));
create policy issues_select on public.issues
  for select to authenticated using (college_id = (select public.current_college_id()));
create policy issue_events_select on public.issue_events
  for select to authenticated using (college_id = (select public.current_college_id()));

-- Report text and photo paths are staff-only. Students never read issue_reports,
-- not even their own: a reporter branch would let co-reporters of a merged issue
-- read each other's text.
create policy issue_reports_select on public.issue_reports
  for select to authenticated
  using (
    college_id = (select public.current_college_id())
    and (select public.app_role_of_user()) in ('authority', 'college_admin')
  );

create policy issue_reporters_select on public.issue_reporters
  for select to authenticated using (student_id = (select auth.uid()));
create policy issue_confirmations_select on public.issue_confirmations
  for select to authenticated using (student_id = (select auth.uid()));

create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy locations_admin_insert on public.locations
  for insert to authenticated
  with check (
    college_id = (select public.current_college_id())
    and (select public.app_role_of_user()) = 'college_admin'
  );
create policy locations_admin_update on public.locations
  for update to authenticated
  using (
    college_id = (select public.current_college_id())
    and (select public.app_role_of_user()) = 'college_admin'
  )
  with check (college_id = (select public.current_college_id()));
create policy locations_admin_delete on public.locations
  for delete to authenticated
  using (
    college_id = (select public.current_college_id())
    and (select public.app_role_of_user()) = 'college_admin'
  );
create policy sla_rules_admin_update on public.sla_rules
  for update to authenticated
  using (
    college_id = (select public.current_college_id())
    and (select public.app_role_of_user()) = 'college_admin'
  )
  with check (college_id = (select public.current_college_id()));

-- Storage: private bucket for report photos, <college_id>/<issue or draft>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy issue_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'issue-photos'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and (select public.app_role_of_user()) = 'student'
    and owner_id = (select auth.uid())::text
  );
-- Students read only their own uploads; staff read their college's folder.
create policy issue_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'issue-photos'
    and (
      owner_id = (select auth.uid())::text
      or (
        (storage.foldername(name))[1] = (select public.current_college_id())::text
        and (select public.app_role_of_user()) in ('authority', 'college_admin')
      )
    )
  );
