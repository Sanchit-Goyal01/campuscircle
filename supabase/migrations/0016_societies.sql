-- Societies: created by a college admin, who names a society_admin as the
-- admin. Join requests and announcements are written only by the security
-- definer RPCs below. Events gain an optional society.

create table public.societies (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  name text not null check (char_length(name) between 3 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  admin_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index societies_college_name_idx on public.societies (college_id, lower(name));
create index societies_admin_idx on public.societies (admin_id);

-- The admin must be a society_admin of the same college, on insert and whenever
-- admin_id changes. 23514 so the app can show a clear message.
create function public.societies_check_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.admin_id is not null and not exists (
       select 1 from public.profiles p
       where p.id = new.admin_id and p.college_id = new.college_id
         and p.role = 'society_admin') then
    raise exception 'invalid_admin' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.societies_check_admin() from public, anon, authenticated;
create trigger societies_check_admin
  before insert or update of admin_id on public.societies
  for each row execute function public.societies_check_admin();

alter table public.societies enable row level security;
revoke all on public.societies from anon, authenticated;
grant select on public.societies to authenticated;
-- college_id comes from its default, never from the client.
grant insert (name, description, admin_id) on public.societies to authenticated;
grant update (name, description, admin_id) on public.societies to authenticated;

create policy societies_select on public.societies
  for select to authenticated
  using (college_id = public.current_college_id());
create policy societies_insert on public.societies
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and coalesce((select public.app_role_of_user()) = 'college_admin', false)
  );
create policy societies_update on public.societies
  for update to authenticated
  using (
    college_id = public.current_college_id()
    and coalesce((select public.app_role_of_user()) = 'college_admin', false)
  )
  with check (
    college_id = public.current_college_id()
    and coalesce((select public.app_role_of_user()) = 'college_admin', false)
  );

create table public.society_members (
  society_id uuid not null references public.societies (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (society_id, student_id)
);
create index society_members_student_idx on public.society_members (student_id);
create index society_members_college_idx on public.society_members (college_id);

alter table public.society_members enable row level security;
revoke all on public.society_members from anon, authenticated;
grant select on public.society_members to authenticated;

create policy society_members_select on public.society_members
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and (
      student_id = auth.uid()
      or exists (select 1 from public.societies s
                 where s.id = society_members.society_id and s.admin_id = auth.uid())
    )
  );

create table public.society_announcements (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index society_announcements_society_idx on public.society_announcements (society_id, created_at desc);
create index society_announcements_college_idx on public.society_announcements (college_id);
create index society_announcements_author_idx on public.society_announcements (author_id);

alter table public.society_announcements enable row level security;
revoke all on public.society_announcements from anon, authenticated;
grant select on public.society_announcements to authenticated;
create policy society_announcements_select on public.society_announcements
  for select to authenticated
  using (college_id = public.current_college_id());

-- Everyone in the college may see how many approved members a society has.
create function public.society_member_count(p_society_id uuid)
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
     or not exists (select 1 from public.societies
                    where id = p_society_id and college_id = v_college) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return (select count(*)::int from public.society_members
          where society_id = p_society_id and status = 'approved');
end;
$$;
revoke all on function public.society_member_count(uuid) from public, anon;
grant execute on function public.society_member_count(uuid) to authenticated;

create function public.request_to_join(p_society_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_soc public.societies;
  v_row public.society_members;
  v_name text;
begin
  if v_uid is null or v_college is null
     or coalesce(v_role = 'student', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_soc from public.societies
  where id = p_society_id and college_id = v_college;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  -- One student's requests to one society are handled one at a time.
  perform pg_advisory_xact_lock(hashtextextended('society:' || p_society_id::text || v_uid::text, 0));

  select * into v_row from public.society_members
  where society_id = p_society_id and student_id = v_uid for update;
  if found then
    if v_row.status in ('pending', 'approved') then
      raise exception 'already_requested' using errcode = 'P0001';
    end if;
    if v_row.status = 'withdrawn' and v_row.decided_at > now() - interval '24 hours' then
      raise exception 'withdrew_recently' using errcode = 'P0001';
    end if;
    if v_row.status = 'declined' and v_row.decided_at > now() - interval '7 days' then
      raise exception 'declined_recently' using errcode = 'P0001';
    end if;
    update public.society_members
    set status = 'pending', decided_at = null, created_at = now()
    where society_id = p_society_id and student_id = v_uid;
  else
    insert into public.society_members (society_id, student_id, college_id)
    values (p_society_id, v_uid, v_college);
  end if;

  if v_soc.admin_id is not null then
    select full_name into v_name from public.profiles where id = v_uid;
    insert into public.notifications (user_id, college_id, kind, title, body, link)
    values (v_soc.admin_id, v_college, 'society_join_request', 'New join request',
            coalesce(nullif(v_name, ''), 'A student') || ' asked to join ' || v_soc.name,
            '/societies/' || p_society_id::text);
  end if;
end;
$$;
revoke all on function public.request_to_join(uuid) from public, anon;
grant execute on function public.request_to_join(uuid) to authenticated;

create function public.decide_join(p_society_id uuid, p_student_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_soc public.societies;
begin
  if v_uid is null or v_college is null or p_accept is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_soc from public.societies
  where id = p_society_id and college_id = v_college and admin_id = v_uid;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  perform 1 from public.society_members
  where society_id = p_society_id and student_id = p_student_id
    and college_id = v_college and status = 'pending'
  for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.society_members
  set status = case when p_accept then 'approved' else 'declined' end, decided_at = now()
  where society_id = p_society_id and student_id = p_student_id;

  insert into public.notifications (user_id, college_id, kind, title, body, link)
  values (p_student_id, v_college,
          case when p_accept then 'society_join_accepted' else 'society_join_declined' end,
          case when p_accept then 'Join request accepted' else 'Join request declined' end,
          'Your request to join ' || v_soc.name ||
            case when p_accept then ' was accepted' else ' was declined' end,
          '/societies/' || p_society_id::text);
end;
$$;
revoke all on function public.decide_join(uuid, uuid, boolean) from public, anon;
grant execute on function public.decide_join(uuid, uuid, boolean) to authenticated;

-- Leaving removes an approved row. Withdrawing a pending request keeps the row
-- as 'withdrawn' (a 24-hour cooldown against notification loops), and a
-- declined row stays so that leaving cannot skip the 7-day wait.
create function public.leave_society(p_society_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.current_college_id() is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  delete from public.society_members
  where society_id = p_society_id and student_id = v_uid
    and college_id = public.current_college_id()
    and status = 'approved';
  update public.society_members
  set status = 'withdrawn', decided_at = now()
  where society_id = p_society_id and student_id = v_uid
    and college_id = public.current_college_id()
    and status = 'pending';
end;
$$;
revoke all on function public.leave_society(uuid) from public, anon;
grant execute on function public.leave_society(uuid) to authenticated;

create function public.post_society_announcement(p_society_id uuid, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_soc public.societies;
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_uid is null or v_college is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_soc from public.societies
  where id = p_society_id and college_id = v_college and admin_id = v_uid;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 120
     or v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;

  -- At most 5 announcements per society per 24 hours (each fans out to every member).
  perform pg_advisory_xact_lock(hashtextextended('society_announce:' || p_society_id::text, 0));
  if (select count(*) from public.society_announcements
      where society_id = p_society_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too_many_announcements' using errcode = 'P0001';
  end if;

  insert into public.society_announcements (society_id, college_id, author_id, title, body)
  values (p_society_id, v_college, v_uid, v_title, v_body)
  returning id into v_id;

  insert into public.notifications (user_id, college_id, kind, title, body, link)
  select m.student_id, v_college, 'society_announcement',
         'New announcement from ' || v_soc.name, v_title, '/societies/' || p_society_id::text
  from public.society_members m
  where m.society_id = p_society_id and m.status = 'approved';
  return v_id;
end;
$$;
revoke all on function public.post_society_announcement(uuid, text, text) from public, anon;
grant execute on function public.post_society_announcement(uuid, text, text) to authenticated;

-- Events: an optional hosting society. A society admin must name one they
-- admin; a college admin may name any society of the college, or none.
alter table public.events
  add column society_id uuid references public.societies (id) on delete set null;
create index events_society_idx on public.events (society_id);
grant insert (society_id) on public.events to authenticated;
grant update (society_id) on public.events to authenticated;

create function public.event_society_allowed(p_society_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select case (select public.app_role_of_user())
    when 'college_admin' then
      p_society_id is null
      or exists (select 1 from public.societies s
                 where s.id = p_society_id and s.college_id = public.current_college_id())
    when 'society_admin' then
      p_society_id is not null
      and exists (select 1 from public.societies s
                  where s.id = p_society_id and s.college_id = public.current_college_id()
                    and s.admin_id = auth.uid())
    else false
  end
$$;
revoke all on function public.event_society_allowed(uuid) from public, anon;
grant execute on function public.event_society_allowed(uuid) to authenticated;

drop policy events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and created_by = auth.uid()
    and coalesce((select public.app_role_of_user()) in ('college_admin', 'society_admin'), false)
    and coalesce(public.event_society_allowed(society_id), false)
  );

drop policy events_update on public.events;
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
    and coalesce(public.event_society_allowed(society_id), false)
  );
