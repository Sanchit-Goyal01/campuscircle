-- Events: college events with full-text search, registrations that only the
-- register_for_event RPC can create (row lock enforces capacity), and a
-- same-college registration count.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  venue text not null check (char_length(venue) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int check (capacity between 1 and 10000),
  created_by uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  search tsvector generated always as
    (to_tsvector('simple', title || ' ' || description || ' ' || venue)) stored,
  created_at timestamptz not null default now(),
  constraint events_ends_after_start check (ends_at > starts_at)
);
create index events_search_idx on public.events using gin (search);
create index events_college_start_idx on public.events (college_id, starts_at);
create index events_created_by_idx on public.events (created_by);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
-- college_id and created_by come from their defaults, never from the client.
grant insert (title, description, venue, starts_at, ends_at, capacity) on public.events to authenticated;
grant update (title, description, venue, starts_at, ends_at, capacity) on public.events to authenticated;
grant delete on public.events to authenticated;

create policy events_select on public.events
  for select to authenticated
  using (college_id = public.current_college_id());

create policy events_insert on public.events
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and created_by = auth.uid()
    and coalesce((select public.app_role_of_user()) in ('college_admin', 'society_admin'), false)
  );

-- A college admin manages every event in the college; a society admin only
-- the events they created.
create policy events_update on public.events
  for update to authenticated
  using (
    college_id = public.current_college_id()
    and coalesce(
      (select public.app_role_of_user()) = 'college_admin'
      or ((select public.app_role_of_user()) = 'society_admin' and created_by = auth.uid()),
      false)
  )
  with check (
    college_id = public.current_college_id()
    and coalesce(
      (select public.app_role_of_user()) = 'college_admin'
      or ((select public.app_role_of_user()) = 'society_admin' and created_by = auth.uid()),
      false)
  );

create policy events_delete on public.events
  for delete to authenticated
  using (
    college_id = public.current_college_id()
    and coalesce(
      (select public.app_role_of_user()) = 'college_admin'
      or ((select public.app_role_of_user()) = 'society_admin' and created_by = auth.uid()),
      false)
  );

create table public.event_registrations (
  event_id uuid not null references public.events (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, student_id)
);
create index event_registrations_student_idx on public.event_registrations (student_id);
create index event_registrations_college_idx on public.event_registrations (college_id);

alter table public.event_registrations enable row level security;
revoke all on public.event_registrations from anon, authenticated;
-- No client insert: register_for_event owns that.
grant select, delete on public.event_registrations to authenticated;

create policy event_registrations_select on public.event_registrations
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and (
      student_id = auth.uid()
      or coalesce((select public.app_role_of_user()) in ('college_admin', 'society_admin'), false)
    )
  );

create policy event_registrations_delete on public.event_registrations
  for delete to authenticated
  using (college_id = public.current_college_id() and student_id = auth.uid());

create function public.register_for_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_event public.events;
begin
  if v_uid is null or v_college is null
     or coalesce(v_role = 'student', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- The row lock serialises registrations for one event, so the capacity
  -- count below cannot be raced.
  select * into v_event from public.events
  where id = p_event_id and college_id = v_college
  for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if exists (select 1 from public.event_registrations
             where event_id = p_event_id and student_id = v_uid) then
    return 'already_registered';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'This event has already started.' using errcode = 'P0001';
  end if;
  if v_event.capacity is not null
     and (select count(*) from public.event_registrations
          where event_id = p_event_id) >= v_event.capacity then
    raise exception 'This event is full.' using errcode = 'P0001';
  end if;

  insert into public.event_registrations (event_id, student_id, college_id)
  values (p_event_id, v_uid, v_college);
  return 'registered';
end;
$$;
revoke all on function public.register_for_event(uuid) from public, anon;
grant execute on function public.register_for_event(uuid) to authenticated;

-- Students cannot read other people's registrations, but everyone in the
-- college may see how many seats are taken.
create function public.event_registration_count(p_event_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_college uuid := public.current_college_id();
begin
  if auth.uid() is null or v_college is null
     or not exists (select 1 from public.events
                    where id = p_event_id and college_id = v_college) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return (select count(*)::int from public.event_registrations where event_id = p_event_id);
end;
$$;
revoke all on function public.event_registration_count(uuid) from public, anon;
grant execute on function public.event_registration_count(uuid) to authenticated;
