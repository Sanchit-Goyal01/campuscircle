-- Agent: runs, steps and pending actions. Every write the agent proposes is a
-- pending action that changes state only through the security-definer functions.

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  message text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'stopped_limit', 'failed')),
  reply text,
  created_at timestamptz not null default now()
);
create index agent_runs_student_id_idx on public.agent_runs (student_id);

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  seq int not null,
  kind text not null
    check (kind in ('tool_call', 'tool_result', 'approval_requested', 'error')),
  tool_name text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index agent_steps_run_id_idx on public.agent_steps (run_id);

create table public.agent_pending_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  tool_name text not null,
  input jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now()
);
create index agent_pending_actions_run_id_idx on public.agent_pending_actions (run_id);
create index agent_pending_actions_student_id_idx on public.agent_pending_actions (student_id);

alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_pending_actions enable row level security;

-- Supabase grants broad default privileges; strip them, then grant the minimum.
revoke all on public.agent_runs, public.agent_steps, public.agent_pending_actions
  from anon, authenticated;
grant select on public.agent_runs, public.agent_steps, public.agent_pending_actions
  to authenticated;
grant insert (student_id, college_id, message) on public.agent_runs to authenticated;
grant update (status, reply) on public.agent_runs to authenticated;
grant insert (run_id, college_id, seq, kind, tool_name, payload)
  on public.agent_steps to authenticated;
grant insert (run_id, student_id, college_id, tool_name, input)
  on public.agent_pending_actions to authenticated;

create policy agent_runs_select on public.agent_runs
  for select to authenticated using (student_id = (select auth.uid()));
create policy agent_runs_insert on public.agent_runs
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
  );
create policy agent_runs_update on public.agent_runs
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy agent_steps_select on public.agent_steps
  for select to authenticated
  using (exists (
    select 1 from public.agent_runs r
    where r.id = agent_steps.run_id and r.student_id = (select auth.uid())
  ));
create policy agent_steps_insert on public.agent_steps
  for insert to authenticated
  with check (
    college_id = (select public.current_college_id())
    and exists (
      select 1 from public.agent_runs r
      where r.id = agent_steps.run_id and r.student_id = (select auth.uid())
    )
  );

create policy agent_pending_actions_select on public.agent_pending_actions
  for select to authenticated using (student_id = (select auth.uid()));
create policy agent_pending_actions_insert on public.agent_pending_actions
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
    and exists (
      select 1 from public.agent_runs r
      where r.id = agent_pending_actions.run_id and r.student_id = (select auth.uid())
    )
  );

-- State transitions. Each matches on student_id = auth.uid() and the expected
-- current status in one UPDATE, so concurrent double-calls cannot both win.
create function public.approve_pending_action(p_id uuid)
returns public.agent_pending_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agent_pending_actions;
begin
  update public.agent_pending_actions
  set status = 'approved'
  where id = p_id and student_id = auth.uid() and status = 'pending'
  returning * into r;
  if not found then
    raise exception 'invalid_action_state';
  end if;
  return r;
end;
$$;

create function public.reject_pending_action(p_id uuid)
returns public.agent_pending_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agent_pending_actions;
begin
  update public.agent_pending_actions
  set status = 'rejected'
  where id = p_id and student_id = auth.uid() and status = 'pending'
  returning * into r;
  if not found then
    raise exception 'invalid_action_state';
  end if;
  return r;
end;
$$;

create function public.finish_pending_action(p_id uuid, p_status text, p_result jsonb)
returns public.agent_pending_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agent_pending_actions;
begin
  if p_status is null or p_status not in ('done', 'failed') then
    raise exception 'invalid_action_state';
  end if;
  update public.agent_pending_actions
  set status = p_status, result = p_result
  where id = p_id and student_id = auth.uid() and status = 'approved'
  returning * into r;
  if not found then
    raise exception 'invalid_action_state';
  end if;
  return r;
end;
$$;

revoke all on function public.approve_pending_action(uuid) from public, anon;
revoke all on function public.reject_pending_action(uuid) from public, anon;
revoke all on function public.finish_pending_action(uuid, text, jsonb) from public, anon;
grant execute on function public.approve_pending_action(uuid) to authenticated;
grant execute on function public.reject_pending_action(uuid) to authenticated;
grant execute on function public.finish_pending_action(uuid, text, jsonb) to authenticated;
