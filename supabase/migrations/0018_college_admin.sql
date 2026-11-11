-- College admin: verify students, publish college announcements, moderate posts.
-- profiles.verified has no client update grant (Plan 1 grants only full_name,
-- bio, skills, and Plan 4 is_mentor); only set_student_verified writes it.

create function public.set_student_verified(p_profile_id uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_college uuid := public.current_college_id();
begin
  if auth.uid() is null or v_college is null or p_verified is null
     or coalesce(public.app_role_of_user() = 'college_admin', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  update public.profiles
  set verified = p_verified
  where id = p_profile_id and college_id = v_college and role = 'student';
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.set_student_verified(uuid, boolean) from public, anon;
grant execute on function public.set_student_verified(uuid, boolean) to authenticated;

create table public.college_announcements (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index college_announcements_college_idx on public.college_announcements (college_id, created_at desc);
create index college_announcements_author_idx on public.college_announcements (author_id);

alter table public.college_announcements enable row level security;
revoke all on public.college_announcements from anon, authenticated;
grant select, delete on public.college_announcements to authenticated;
grant insert (college_id, author_id, title, body) on public.college_announcements to authenticated;

create policy college_announcements_select on public.college_announcements
  for select to authenticated
  using (college_id = public.current_college_id());
create policy college_announcements_insert on public.college_announcements
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and author_id = auth.uid()
    and coalesce(public.app_role_of_user() = 'college_admin', false)
  );
create policy college_announcements_delete on public.college_announcements
  for delete to authenticated
  using (
    college_id = public.current_college_id()
    and coalesce(public.app_role_of_user() = 'college_admin', false)
  );

create function public.moderate_post(p_post_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_college uuid := public.current_college_id();
  v_post public.posts;
begin
  if auth.uid() is null or v_college is null
     or coalesce(public.app_role_of_user() = 'college_admin', false) is not true
     or p_action is null or p_action not in ('hide', 'dismiss') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_post from public.posts
  where id = p_post_id and college_id = v_college
  for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_action = 'hide' then
    update public.posts
    set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, auth.uid())
    where id = p_post_id;
    update public.post_reports set status = 'actioned'
    where post_id = p_post_id and status = 'open';
    if v_post.hidden_at is null then
      insert into public.notifications (user_id, college_id, kind, title, body, link)
      values (v_post.author_id, v_college, 'post_hidden', 'Your post was hidden',
              'A moderator hid your post. Only you and college admins can see it now.',
              '/feed/' || p_post_id::text);
    end if;
  else
    update public.post_reports set status = 'dismissed'
    where post_id = p_post_id and status = 'open';
  end if;
end;
$$;
revoke all on function public.moderate_post(uuid, text) from public, anon;
grant execute on function public.moderate_post(uuid, text) to authenticated;
