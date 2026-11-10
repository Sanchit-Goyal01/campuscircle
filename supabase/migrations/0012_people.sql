-- People: mentor flag, profile limits, and mentorship requests. Requests are
-- written only by the security definer RPCs below; clients can read their own.

alter table public.profiles add column is_mentor boolean not null default false;
grant update (is_mentor) on public.profiles to authenticated;

-- Skills: at most 20 items, each 1-40 characters, none null, blank or repeated
-- (case-insensitive).
create function public.skills_valid(p_skills text[])
returns boolean
language sql
immutable
as $$
  select p_skills is not null
    and coalesce(cardinality(p_skills), 0) <= 20
    and not exists (
      select 1 from unnest(p_skills) s
      where s is null or btrim(s) = '' or char_length(s) not between 1 and 40
    )
    and cardinality(array(select distinct lower(x) from unnest(p_skills) x))
        = coalesce(cardinality(p_skills), 0)
$$;

alter table public.profiles
  add constraint profiles_skills_limits check (public.skills_valid(skills)),
  add constraint profiles_bio_limit check (bio is null or char_length(bio) <= 500);

create table public.mentorship_requests (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  mentor_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 80),
  message text not null check (char_length(message) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (student_id <> mentor_id)
);
create unique index mentorship_requests_one_pending_idx
  on public.mentorship_requests (student_id, mentor_id) where status = 'pending';
create index mentorship_requests_college_id_idx on public.mentorship_requests (college_id);
create index mentorship_requests_mentor_idx on public.mentorship_requests (mentor_id);
create index mentorship_requests_student_idx on public.mentorship_requests (student_id);

alter table public.mentorship_requests enable row level security;
revoke all on public.mentorship_requests from anon, authenticated;
grant select on public.mentorship_requests to authenticated;

create policy mentorship_requests_select on public.mentorship_requests
  for select to authenticated
  using (college_id = public.current_college_id()
         and (student_id = auth.uid() or mentor_id = auth.uid()));

create function public.request_mentorship(p_mentor_id uuid, p_subject text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_subject text := btrim(p_subject);
  v_message text := btrim(p_message);
  v_name text;
  v_id uuid;
begin
  if v_uid is null or v_college is null
     or coalesce(v_role = 'student', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  -- One student's requests are counted one at a time, so the cap cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('mentorship:' || v_uid::text, 0));
  if p_mentor_id is null or p_mentor_id = v_uid
     or not exists (select 1 from public.profiles m
                    where m.id = p_mentor_id and m.college_id = v_college and m.is_mentor
                      and m.role = 'student') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_subject is null or char_length(v_subject) not between 1 and 80
     or v_message is null or char_length(v_message) not between 10 and 500 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;

  -- A declined request blocks a new one to the same mentor for 7 days.
  if exists (select 1 from public.mentorship_requests r
             where r.student_id = v_uid and r.mentor_id = p_mentor_id
               and r.status = 'declined' and r.decided_at > now() - interval '7 days') then
    raise exception 'declined_recently' using errcode = 'P0001';
  end if;

  -- At most 5 open requests at a time.
  if (select count(*) from public.mentorship_requests r
      where r.student_id = v_uid and r.status = 'pending') >= 5 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;

  -- The unique pending index raises 23505 on a second open request to the same mentor.
  insert into public.mentorship_requests (college_id, student_id, mentor_id, subject, message)
  values (v_college, v_uid, p_mentor_id, v_subject, v_message)
  returning id into v_id;

  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, college_id, kind, title, body, link)
  values (p_mentor_id, v_college, 'mentorship_request', 'New mentorship request',
          coalesce(nullif(v_name, ''), 'A student') || ' asked for help with ' || v_subject,
          '/mentorship');
  return v_id;
end;
$$;
revoke all on function public.request_mentorship(uuid, text, text) from public, anon;
grant execute on function public.request_mentorship(uuid, text, text) to authenticated;

create function public.decide_mentorship(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_req public.mentorship_requests;
  v_name text;
begin
  if v_uid is null or v_college is null or p_accept is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_req from public.mentorship_requests
  where id = p_request_id and college_id = v_college
    and mentor_id = v_uid and status = 'pending'
  for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.mentorship_requests
  set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
  where id = v_req.id;

  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, college_id, kind, title, body, link)
  values (v_req.student_id, v_college,
          case when p_accept then 'mentorship_accepted' else 'mentorship_declined' end,
          case when p_accept then 'Mentorship request accepted' else 'Mentorship request declined' end,
          coalesce(nullif(v_name, ''), 'Your mentor') ||
            case when p_accept then ' accepted' else ' declined' end ||
            ' your request about ' || v_req.subject,
          '/mentorship');
end;
$$;
revoke all on function public.decide_mentorship(uuid, boolean) from public, anon;
grant execute on function public.decide_mentorship(uuid, boolean) to authenticated;
