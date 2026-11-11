-- Tenancy: colleges, departments, profiles, with RLS.

create type public.app_role as enum ('student', 'society_admin', 'authority', 'college_admin');

create table public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text not null unique,
  constraint colleges_email_domain_lowercase check (email_domain = lower(email_domain))
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  name text not null
);
create index departments_college_id_idx on public.departments (college_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  full_name text not null default '',
  role public.app_role not null default 'student',
  department_id uuid references public.departments (id),
  is_department_head boolean not null default false,
  bio text,
  skills text[] not null default '{}',
  verified boolean not null default false
);
create index profiles_college_id_idx on public.profiles (college_id);

-- Tenant helpers. security definer so they read profiles without RLS
-- (a profiles policy calling them would otherwise recurse).
create function public.current_college_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select college_id from public.profiles where id = auth.uid()
$$;

create function public.app_role_of_user()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_college_id() from public, anon;
revoke all on function public.app_role_of_user() from public, anon;
grant execute on function public.current_college_id() to authenticated;
grant execute on function public.app_role_of_user() to authenticated;

-- Sign-up: derive college from the email domain, never from client input.
-- Unlisted domains are refused at insert. A profile exists only for a confirmed
-- email: created at insert when already confirmed, otherwise when
-- email_confirmed_at goes from null to not null.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_college uuid;
begin
  select id into v_college
  from public.colleges
  where email_domain = lower(split_part(new.email, '@', 2));

  if v_college is null then
    raise exception 'college_not_registered';
  end if;

  if new.email_confirmed_at is null then
    return new;
  end if;

  insert into public.profiles (id, college_id, full_name)
  values (new.id, v_college, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only ever fired by the triggers below; nobody calls it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user();

alter table public.colleges enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;

-- Supabase grants broad default privileges; strip them, then grant the minimum.
-- anon gets nothing: sign-up goes through auth and the security definer trigger.
revoke all on public.colleges, public.departments, public.profiles from anon, authenticated;
grant select on public.colleges, public.departments, public.profiles to authenticated;
-- Column grants (not RLS) stop role / college_id changes.
grant update (full_name, bio, skills) on public.profiles to authenticated;

create policy colleges_select on public.colleges
  for select to authenticated using (true);

create policy departments_select on public.departments
  for select to authenticated using (college_id = public.current_college_id());

create policy profiles_select on public.profiles
  for select to authenticated using (college_id = public.current_college_id());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
