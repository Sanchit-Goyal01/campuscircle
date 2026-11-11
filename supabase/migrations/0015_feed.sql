-- Feed: posts with optional photo, comments, likes and reports. Posts and
-- reports are written only through the security definer RPCs below.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  photo_path text,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A photo must live in the author's own folder: one filename segment.
  constraint posts_photo_path_owner check (
    photo_path is null
    or (photo_path like college_id::text || '/' || author_id::text || '/%'
        and substr(photo_path, char_length(college_id::text || '/' || author_id::text || '/') + 1)
            ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
  )
);
create index posts_college_created_idx on public.posts (college_id, created_at desc);
create index posts_author_idx on public.posts (author_id);

alter table public.posts enable row level security;
revoke all on public.posts from anon, authenticated;
grant select, delete on public.posts to authenticated;

create policy posts_select on public.posts
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and (
      hidden_at is null
      or author_id = auth.uid()
      or coalesce(public.app_role_of_user() = 'college_admin', false)
    )
  );
create policy posts_delete on public.posts
  for delete to authenticated
  using (college_id = public.current_college_id() and author_id = auth.uid());

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);
create index post_comments_author_idx on public.post_comments (author_id);
create index post_comments_college_idx on public.post_comments (college_id);

alter table public.post_comments enable row level security;
revoke all on public.post_comments from anon, authenticated;
grant select, delete on public.post_comments to authenticated;
grant insert (post_id, body) on public.post_comments to authenticated;

-- The subselect on posts runs under the reader's RLS, so comments follow the
-- post's visibility.
create policy post_comments_select on public.post_comments
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and exists (select 1 from public.posts p where p.id = post_id)
  );
create policy post_comments_insert on public.post_comments
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.hidden_at is null)
  );
create policy post_comments_delete on public.post_comments
  for delete to authenticated
  using (college_id = public.current_college_id() and author_id = auth.uid());

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);
create index post_likes_college_idx on public.post_likes (college_id);

alter table public.post_likes enable row level security;
revoke all on public.post_likes from anon, authenticated;
grant select, delete on public.post_likes to authenticated;
grant insert (post_id) on public.post_likes to authenticated;

create policy post_likes_select on public.post_likes
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and exists (select 1 from public.posts p where p.id = post_id)
  );
create policy post_likes_insert on public.post_likes
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.hidden_at is null)
  );
create policy post_likes_delete on public.post_likes
  for delete to authenticated
  using (college_id = public.current_college_id() and user_id = auth.uid());

create table public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);
create index post_reports_college_idx on public.post_reports (college_id, status);
create index post_reports_reporter_idx on public.post_reports (reporter_id);
create index post_reports_post_idx on public.post_reports (post_id, status);

alter table public.post_reports enable row level security;
revoke all on public.post_reports from anon, authenticated;
grant select on public.post_reports to authenticated;

-- Reporters see only their own rows. College admins get no direct read, so a
-- reporter's identity cannot reach them through the API; they use
-- reported_posts_queue(), which returns no reporter column.
create policy post_reports_select on public.post_reports
  for select to authenticated
  using (
    college_id = public.current_college_id()
    and reporter_id = auth.uid()
  );

create function public.reported_posts_queue(p_limit int default 50)
returns table (post_id uuid, report_count bigint, reasons text[], first_reported_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_college uuid := public.current_college_id();
begin
  if auth.uid() is null or v_college is null
     or coalesce(public.app_role_of_user() = 'college_admin', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return query
    select r.post_id, count(*)::bigint, array_agg(r.reason order by r.created_at),
           min(r.created_at)
    from public.post_reports r
    where r.college_id = v_college and r.status = 'open'
    group by r.post_id
    order by min(r.created_at), r.post_id
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
revoke all on function public.reported_posts_queue(int) from public, anon;
grant execute on function public.reported_posts_queue(int) to authenticated;

create index posts_photo_path_idx on public.posts (photo_path) where photo_path is not null;

-- Storage: private jpeg-only bucket, <college_id>/<author_id>/<uuid>.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

create policy post_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );
-- Readable by the uploader, or when a post the reader may see (posts RLS:
-- same college, not hidden unless author/admin) uses the photo. Photos of
-- hidden posts and unattached uploads stay private to their owner.
create policy post_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (select 1 from public.posts p where p.photo_path = objects.name)
    )
  );
create policy post_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );

-- Rolling log for the 20-posts-per-24h limit (deleting a post does not reset it).
create table public.post_create_log (
  author_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index post_create_log_author_idx on public.post_create_log (author_id, created_at);
alter table public.post_create_log enable row level security;
revoke all on public.post_create_log from anon, authenticated;

create function public.create_post(p_body text, p_photo_path text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_uid is null or v_college is null
     or coalesce(public.app_role_of_user() is not null, false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 2000 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_post:' || v_uid::text, 0));
  if (select count(*) from public.post_create_log
      where author_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_posts' using errcode = 'P0001';
  end if;

  -- The photo_path check constraint refuses paths outside the author's folder.
  insert into public.posts (college_id, author_id, body, photo_path)
  values (v_college, v_uid, v_body, nullif(btrim(p_photo_path), ''))
  returning id into v_id;
  insert into public.post_create_log (author_id, college_id) values (v_uid, v_college);
  return v_id;
end;
$$;
revoke all on function public.create_post(text, text) from public, anon;
grant execute on function public.create_post(text, text) to authenticated;

create function public.report_post(p_post_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_reason text := btrim(p_reason);
  v_post public.posts;
begin
  if v_uid is null or v_college is null
     or coalesce(public.app_role_of_user() is not null, false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_post from public.posts
  where id = p_post_id and college_id = v_college and hidden_at is null;
  if not found or v_post.author_id = v_uid then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 300 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;
  if exists (select 1 from public.post_reports
             where post_id = p_post_id and reporter_id = v_uid) then
    raise exception 'already_reported' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report_post:' || v_uid::text, 0));
  if (select count(*) from public.post_reports
      where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_reports' using errcode = 'P0001';
  end if;
  insert into public.post_reports (post_id, college_id, reporter_id, reason)
  values (p_post_id, v_college, v_uid, v_reason);
end;
$$;
revoke all on function public.report_post(uuid, text) from public, anon;
grant execute on function public.report_post(uuid, text) to authenticated;
