-- Campus Issues lifecycle: intake, transitions, triage, closure votes, the
-- deadline job, and metrics. These security definer RPCs are the only write
-- path to the issue tables. Student identity is never written to events or
-- notification text; reporters are reached only by notifications inserted here.

-- Rolling log for the 5-reports-per-24h limit. issue_reports has no reporter
-- column (reporter privacy), so the counter lives here. No client access.
create table public.issue_report_log (
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index issue_report_log_student_idx on public.issue_report_log (student_id, created_at);
alter table public.issue_report_log enable row level security;
revoke all on public.issue_report_log from anon, authenticated;

-- Internal: now + the college's SLA for a severity (null when severity is null).
create function public.issue_due_at(p_college uuid, p_severity public.issue_severity, p_base timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select p_base + make_interval(mins => s.deadline_minutes)
  from public.sla_rules s
  where s.college_id = p_college and s.severity = p_severity
$$;
revoke all on function public.issue_due_at(uuid, public.issue_severity, timestamptz)
  from public, anon, authenticated;

-- Merge candidates: same college and location, last 14 days, still active.
-- Security invoker: RLS keeps results inside the caller's college.
create function public.match_open_issues(
  p_location uuid,
  p_embedding extensions.vector(384),
  p_limit int default 5
)
returns table (id uuid, title text, similarity float)
language sql
stable
security invoker
set search_path = public, extensions
set hnsw.iterative_scan = 'relaxed_order'
as $$
  select i.id, i.title, (1 - (i.embedding <=> p_embedding))::float as similarity
  from public.issues i
  where i.college_id = (select public.current_college_id())
    and i.location_id = p_location
    and i.created_at > now() - interval '14 days'
    and i.status in ('open', 'assigned', 'in_progress')
    and i.embedding is not null
    and p_embedding is not null
  order by i.embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 5)
$$;
revoke all on function public.match_open_issues(uuid, extensions.vector, int) from public, anon;
grant execute on function public.match_open_issues(uuid, extensions.vector, int) to authenticated;

create function public.submit_issue_report(
  p_location uuid,
  p_body text,
  p_photo_paths text[],
  p_classification jsonb,
  p_embedding extensions.vector(384),
  p_merge_issue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_path text;
  v_title text;
  v_category text;
  v_severity public.issue_severity;
  v_dept uuid;
  v_triage boolean;
  v_issue public.issues;
  v_report uuid;
  v_merged boolean := false;
  v_new_reporter boolean := false;
begin
  if v_uid is null or v_college is null or v_role is distinct from 'student' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not exists (select 1 from public.locations l where l.id = p_location and l.college_id = v_college) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_body is null or char_length(p_body) not between 10 and 2000 then
    raise exception 'invalid_report' using errcode = '23514';
  end if;
  if coalesce(array_length(v_photos, 1), 0) > 3 then
    raise exception 'invalid_report' using errcode = '23514';
  end if;
  foreach v_path in array v_photos loop
    if v_path is null or position('..' in v_path) > 0
       or left(v_path, length(v_college::text) + 1) <> v_college::text || '/'
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'issue-photos' and o.name = v_path
                        and o.owner_id = v_uid::text) then
      raise exception 'insufficient_privilege' using errcode = '42501';
    end if;
  end loop;

  -- Serialise a student's own reports so the limit cannot be raced.
  perform pg_advisory_xact_lock(hashtext('issue_report:' || v_uid::text));
  if (select count(*) from public.issue_report_log
      where student_id = v_uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.issue_report_log (student_id) values (v_uid);

  -- Classification: any unknown part is treated as null.
  if p_classification is not null and jsonb_typeof(p_classification) = 'object' then
    v_title := nullif(btrim(p_classification ->> 'title'), '');
    v_category := p_classification ->> 'category';
    if v_category is null or v_category not in
       ('water', 'electricity', 'internet', 'sanitation', 'furniture', 'safety', 'other') then
      v_category := null;
    end if;
    if (p_classification ->> 'severity') in ('critical', 'high', 'medium', 'low') then
      v_severity := (p_classification ->> 'severity')::public.issue_severity;
    end if;
    select d.id into v_dept from public.departments d
    where d.college_id = v_college
      and lower(d.name) = lower(btrim(coalesce(p_classification ->> 'department', '')));
  end if;
  v_triage := v_dept is null or v_severity is null;
  if not v_triage and v_title is null then
    select initcap(coalesce(v_category, 'general')) || ' issue at ' || l.name
      into v_title from public.locations l where l.id = p_location;
  end if;

  if p_merge_issue_id is not null then
    select * into v_issue from public.issues i
    where i.id = p_merge_issue_id
      and i.college_id = v_college
      and i.location_id = p_location
      and i.created_at > now() - interval '14 days'
      and i.status in ('open', 'assigned', 'in_progress')
    for update;
    v_merged := found;
  end if;

  if v_merged then
    insert into public.issue_reports (issue_id, college_id, body, photo_paths)
    values (v_issue.id, v_college, p_body, v_photos)
    returning id into v_report;

    insert into public.issue_reporters (issue_id, student_id, college_id, first_report_id)
    values (v_issue.id, v_uid, v_college, v_report)
    on conflict do nothing;
    v_new_reporter := found;

    if v_new_reporter then
      update public.issues set report_count = report_count + 1, updated_at = now()
      where id = v_issue.id returning * into v_issue;
      insert into public.issue_events (issue_id, college_id, kind, actor_role, actor_id)
      values (v_issue.id, v_college, 'merged', 'student', null);
    end if;
  else
    insert into public.issues (college_id, location_id, department_id, category, severity,
                               title, needs_triage, due_at, embedding)
    values (v_college, p_location, v_dept, v_category, v_severity,
            coalesce(left(v_title, 200), 'Untriaged report'),
            v_triage,
            case when v_triage then null
                 else public.issue_due_at(v_college, v_severity, now()) end,
            p_embedding)
    returning * into v_issue;

    insert into public.issue_reports (issue_id, college_id, body, photo_paths)
    values (v_issue.id, v_college, p_body, v_photos)
    returning id into v_report;
    insert into public.issue_reporters (issue_id, student_id, college_id, first_report_id)
    values (v_issue.id, v_uid, v_college, v_report);
    insert into public.issue_events (issue_id, college_id, kind, actor_role, actor_id)
    values (v_issue.id, v_college, 'reported', 'student', null);
  end if;

  -- Staff: the department's authorities, or the college admins when untriaged.
  insert into public.notifications (user_id, college_id, kind, title, body, link)
  select p.id, v_college,
         case when v_merged then 'issue_merged' else 'issue_new' end,
         case when v_issue.needs_triage then 'Report needs triage'
              when v_merged then 'Another report on an issue'
              else 'New issue reported' end,
         v_issue.title,
         '/issues/' || v_issue.id
  from public.profiles p
  where p.college_id = v_college
    and ((v_issue.needs_triage and p.role = 'college_admin')
         or (not v_issue.needs_triage and p.role = 'authority'
             and p.department_id = v_issue.department_id));

  insert into public.notifications (user_id, college_id, kind, title, body, link)
  values (v_uid, v_college, 'report_received', 'Report received',
          'We received your report: ' || v_issue.title, '/issues/' || v_issue.id);

  return jsonb_build_object('issue_id', v_issue.id, 'merged', v_merged,
                            'needs_triage', v_issue.needs_triage);
end;
$$;
revoke all on function public.submit_issue_report(uuid, text, text[], jsonb, extensions.vector, uuid) from public, anon;
grant execute on function public.submit_issue_report(uuid, text, text[], jsonb, extensions.vector, uuid) to authenticated;

create function public.transition_issue(
  p_issue uuid,
  p_to public.issue_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_dept uuid;
  v_issue public.issues;
begin
  if v_uid is null or v_college is null
     or coalesce(v_role in ('authority', 'college_admin'), false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_issue from public.issues
  where id = p_issue and college_id = v_college for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_issue.needs_triage then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_role = 'authority' then
    select department_id into v_dept from public.profiles where id = v_uid;
    if v_issue.department_id is null or v_dept is distinct from v_issue.department_id then
      raise exception 'insufficient_privilege' using errcode = '42501';
    end if;
  end if;
  if not ((v_issue.status = 'open' and p_to = 'assigned')
       or (v_issue.status in ('open', 'assigned') and p_to = 'in_progress')
       or (v_issue.status in ('assigned', 'in_progress') and p_to = 'resolved_pending')) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_to = 'resolved_pending' then
    update public.issues
    set status = p_to, resolved_pending_at = now(),
        confirmation_round = confirmation_round + 1, updated_at = now()
    where id = p_issue;
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select r.student_id, v_college, 'confirm_fix', 'Was this fixed?',
           'Staff marked "' || v_issue.title || '" as fixed. Please confirm.',
           '/issues/' || p_issue
    from public.issue_reporters r where r.issue_id = p_issue;
  else
    update public.issues set status = p_to, updated_at = now() where id = p_issue;
  end if;

  insert into public.issue_events (issue_id, college_id, kind, from_status, to_status,
                                   actor_role, actor_id, note)
  values (p_issue, v_college, 'status_changed', v_issue.status, p_to, v_role, v_uid, p_note);
end;
$$;
revoke all on function public.transition_issue(uuid, public.issue_status, text) from public, anon;
grant execute on function public.transition_issue(uuid, public.issue_status, text) to authenticated;

create function public.triage_issue(
  p_issue uuid,
  p_department uuid,
  p_category text,
  p_severity public.issue_severity,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_issue public.issues;
begin
  if v_uid is null or v_college is null
     or public.app_role_of_user() is distinct from 'college_admin' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_issue from public.issues
  where id = p_issue and college_id = v_college for update;
  if not found or not v_issue.needs_triage
     or v_issue.status not in ('open', 'assigned', 'in_progress')
     or not exists (select 1 from public.departments d
                    where d.id = p_department and d.college_id = v_college) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_title is null or btrim(p_title) = '' or p_severity is null
     or p_category is null or p_category not in
       ('water', 'electricity', 'internet', 'sanitation', 'furniture', 'safety', 'other') then
    raise exception 'invalid_triage' using errcode = '23514';
  end if;

  update public.issues
  set department_id = p_department, category = p_category, severity = p_severity,
      title = left(btrim(p_title), 200), needs_triage = false,
      due_at = public.issue_due_at(v_college, p_severity, now()), updated_at = now()
  where id = p_issue;

  insert into public.issue_events (issue_id, college_id, kind, actor_role, actor_id)
  values (p_issue, v_college, 'triaged', 'college_admin', v_uid);

  insert into public.notifications (user_id, college_id, kind, title, body, link)
  select p.id, v_college, 'issue_new', 'New issue assigned to your department',
         left(btrim(p_title), 200), '/issues/' || p_issue
  from public.profiles p
  where p.college_id = v_college and p.role = 'authority' and p.department_id = p_department;
end;
$$;
revoke all on function public.triage_issue(uuid, uuid, text, public.issue_severity, text) from public, anon;
grant execute on function public.triage_issue(uuid, uuid, text, public.issue_severity, text) to authenticated;

-- Internal closure rule. Returns true when the issue changed.
create function public.tally_issue_closure(p_issue uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.issues;
  v_fixed int;
  v_not_fixed int;
begin
  select * into v_issue from public.issues where id = p_issue for update;
  if not found or v_issue.status <> 'resolved_pending' then
    return false;
  end if;
  select count(*) filter (where fixed), count(*) filter (where not fixed)
    into v_fixed, v_not_fixed
  from public.issue_confirmations
  where issue_id = p_issue and round = v_issue.confirmation_round;

  if v_fixed + v_not_fixed = 0 then
    if v_issue.resolved_pending_at is null
       or p_now < v_issue.resolved_pending_at + interval '72 hours' then
      return false;
    end if;
    update public.issues
    set status = 'closed_unverified', closed_at = p_now, updated_at = p_now
    where id = p_issue;
    insert into public.issue_events (issue_id, college_id, kind, from_status, to_status)
    values (p_issue, v_issue.college_id, 'closed_unverified', 'resolved_pending', 'closed_unverified');
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select r.student_id, v_issue.college_id, 'issue_closed', 'Issue closed',
           '"' || v_issue.title || '" was closed without confirmation.', '/issues/' || p_issue
    from public.issue_reporters r where r.issue_id = p_issue;
  elsif v_fixed > v_not_fixed then
    update public.issues
    set status = 'closed', closed_at = p_now, updated_at = p_now
    where id = p_issue;
    insert into public.issue_events (issue_id, college_id, kind, from_status, to_status, actor_role)
    values (p_issue, v_issue.college_id, 'vote_closed', 'resolved_pending', 'closed', 'student');
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select r.student_id, v_issue.college_id, 'issue_closed', 'Issue closed',
           '"' || v_issue.title || '" was confirmed fixed.', '/issues/' || p_issue
    from public.issue_reporters r where r.issue_id = p_issue;
  else
    update public.issues
    set status = 'in_progress', escalation_level = 0,
        due_at = public.issue_due_at(v_issue.college_id, v_issue.severity, p_now),
        updated_at = p_now
    where id = p_issue;
    insert into public.issue_events (issue_id, college_id, kind, from_status, to_status, actor_role)
    values (p_issue, v_issue.college_id, 'vote_reopened', 'resolved_pending', 'in_progress', 'student');
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select r.student_id, v_issue.college_id, 'issue_reopened', 'Issue reopened',
           '"' || v_issue.title || '" was reopened because it was not fixed.', '/issues/' || p_issue
    from public.issue_reporters r where r.issue_id = p_issue;
    -- Staff learn it was reopened, with no vote detail.
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select p.id, v_issue.college_id, 'issue_reopened', 'Issue reopened',
           '"' || v_issue.title || '" was reported as not fixed.', '/issues/' || p_issue
    from public.profiles p
    where p.college_id = v_issue.college_id and p.role = 'authority'
      and p.department_id = v_issue.department_id;
  end if;
  return true;
end;
$$;
revoke all on function public.tally_issue_closure(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_issue_closure(uuid, timestamptz) to service_role;

create function public.confirm_issue_fix(p_issue uuid, p_fixed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_issue public.issues;
  v_reporters int;
  v_votes int;
begin
  if v_uid is null or v_college is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_issue from public.issues
  where id = p_issue and college_id = v_college for update;
  if not found or not exists (
    select 1 from public.issue_reporters r where r.issue_id = p_issue and r.student_id = v_uid
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_issue.status <> 'resolved_pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  insert into public.issue_confirmations (issue_id, student_id, college_id, round, fixed)
  values (p_issue, v_uid, v_college, v_issue.confirmation_round, p_fixed)
  on conflict (issue_id, student_id, round)
  do update set fixed = excluded.fixed, created_at = now();

  select count(*) into v_reporters from public.issue_reporters where issue_id = p_issue;
  select count(*) into v_votes from public.issue_confirmations
  where issue_id = p_issue and round = v_issue.confirmation_round;
  if v_votes >= v_reporters then
    perform public.tally_issue_closure(p_issue, now());
  end if;
end;
$$;
revoke all on function public.confirm_issue_fix(uuid, boolean) from public, anon;
grant execute on function public.confirm_issue_fix(uuid, boolean) to authenticated;

create function public.run_issue_jobs(
  p_now timestamptz default now(),
  p_college uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.issues;
  v_level smallint;
  v_escalated int := 0;
  v_tallied int := 0;
  v_id uuid;
begin
  for v_issue in
    select * from public.issues i
    where i.status in ('open', 'assigned', 'in_progress')
      and i.due_at < p_now and i.escalation_level < 2
      and (p_college is null or i.college_id = p_college)
    order by i.due_at
    for update
  loop
    v_level := v_issue.escalation_level + 1;
    update public.issues
    set escalation_level = v_level,
        due_at = public.issue_due_at(v_issue.college_id, v_issue.severity, p_now),
        updated_at = p_now
    where id = v_issue.id;
    insert into public.issue_events (issue_id, college_id, kind, note)
    values (v_issue.id, v_issue.college_id, 'escalated', 'level ' || v_level);
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    select p.id, v_issue.college_id, 'issue_escalated', 'Issue past its deadline',
           v_issue.title, '/issues/' || v_issue.id
    from public.profiles p
    where p.college_id = v_issue.college_id
      and ((v_level = 1 and p.role = 'authority' and p.is_department_head
            and p.department_id = v_issue.department_id)
           or (v_level = 2 and p.role = 'college_admin'));
    v_escalated := v_escalated + 1;
  end loop;

  for v_id in
    select i.id from public.issues i
    where i.status = 'resolved_pending'
      and i.resolved_pending_at <= p_now - interval '72 hours'
      and (p_college is null or i.college_id = p_college)
  loop
    if public.tally_issue_closure(v_id, p_now) then
      v_tallied := v_tallied + 1;
    end if;
  end loop;

  return jsonb_build_object('escalated', v_escalated, 'tallied', v_tallied);
end;
$$;
revoke all on function public.run_issue_jobs(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.run_issue_jobs(timestamptz, uuid) to service_role;

create function public.run_issue_jobs_for_my_college()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_college_id() is null
     or public.app_role_of_user() is distinct from 'college_admin' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return public.run_issue_jobs(now(), public.current_college_id());
end;
$$;
revoke all on function public.run_issue_jobs_for_my_college() from public, anon;
grant execute on function public.run_issue_jobs_for_my_college() to authenticated;

create function public.issue_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_college uuid := public.current_college_id();
  v_closed int;
  v_unverified int;
begin
  if v_college is null
     or coalesce(public.app_role_of_user() in ('authority', 'college_admin'), false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select count(*) filter (where status = 'closed'),
         count(*) filter (where status = 'closed_unverified')
    into v_closed, v_unverified
  from public.issues where college_id = v_college;

  return jsonb_build_object(
    'median_resolution_hours',
      (select round((percentile_cont(0.5) within group (
                order by extract(epoch from (closed_at - created_at)) / 3600.0))::numeric, 2)
       from public.issues
       where college_id = v_college and status = 'closed' and closed_at is not null),
    'deadline_misses',
      (select count(*) from public.issue_events
       where college_id = v_college and kind = 'escalated'),
    'verified_closure_rate',
      case when v_closed + v_unverified = 0 then null
           else round(v_closed::numeric / (v_closed + v_unverified), 4) end,
    'open',
      (select count(*) from public.issues
       where college_id = v_college
         and status in ('open', 'assigned', 'in_progress', 'resolved_pending'))
  );
end;
$$;
revoke all on function public.issue_metrics() from public, anon;
grant execute on function public.issue_metrics() to authenticated;

-- All four deadlines in one statement, so a bad value or a refusal changes nothing.
-- Security invoker: the sla_rules column grant and admin policy still apply.
create function public.update_sla_rules(p_minutes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sev text;
  v_val text;
  v_updated int;
begin
  if public.current_college_id() is null
     or coalesce(public.app_role_of_user() = 'college_admin', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_minutes is null or jsonb_typeof(p_minutes) <> 'object' then
    raise exception 'invalid_sla' using errcode = '23514';
  end if;
  foreach v_sev in array array['critical', 'high', 'medium', 'low'] loop
    v_val := p_minutes ->> v_sev;
    if coalesce(jsonb_typeof(p_minutes -> v_sev), '') <> 'number' or v_val !~ '^[0-9]+$'
       or v_val::bigint not between 1 and 2000000 then
      raise exception 'invalid_sla' using errcode = '23514';
    end if;
  end loop;

  update public.sla_rules s
  set deadline_minutes = (p_minutes ->> s.severity::text)::int
  where s.college_id = public.current_college_id();
  get diagnostics v_updated = row_count;
  if v_updated <> 4 then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.update_sla_rules(jsonb) from public, anon;
grant execute on function public.update_sla_rules(jsonb) to authenticated;

-- Deadline job every 15 minutes. Guarded so a stack without pg_cron still migrates.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('issue-jobs', '*/15 * * * *', 'select public.run_issue_jobs()');
  else
    raise notice 'pg_cron unavailable: issue-jobs not scheduled';
  end if;
end;
$$;
