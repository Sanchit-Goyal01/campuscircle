-- Grade scales per college, grade points derived from marks, result constraints,
-- and college_admin management of subjects.

create table public.grade_scales (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  min_marks numeric not null,
  grade text not null,
  grade_points numeric not null,
  unique (college_id, min_marks)
);

alter table public.grade_scales enable row level security;
revoke all on public.grade_scales from anon, authenticated;
grant select on public.grade_scales to authenticated;
create policy grade_scales_select on public.grade_scales
  for select to authenticated using (college_id = (select public.current_college_id()));

create function public.seed_default_grade_scale(p_college_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.grade_scales (college_id, min_marks, grade, grade_points) values
    (p_college_id, 90, 'O', 10), (p_college_id, 80, 'A+', 9), (p_college_id, 70, 'A', 8),
    (p_college_id, 60, 'B+', 7), (p_college_id, 50, 'B', 6), (p_college_id, 45, 'C', 5),
    (p_college_id, 40, 'P', 4), (p_college_id, 0, 'F', 0)
  on conflict (college_id, min_marks) do nothing
$$;
revoke all on function public.seed_default_grade_scale(uuid) from public, anon, authenticated;

create function public.colleges_default_grade_scale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_grade_scale(new.id);
  return new;
end
$$;
revoke all on function public.colleges_default_grade_scale() from public, anon, authenticated;

create trigger colleges_default_grade_scale
  after insert on public.colleges
  for each row execute function public.colleges_default_grade_scale();

select public.seed_default_grade_scale(id) from public.colleges;

-- grade_points always comes from the scale, never from the client.
create function public.set_grade_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.marks is null then
    new.grade_points := null;
  else
    new.grade_points := (
      select gs.grade_points from public.grade_scales gs
      where gs.college_id = new.college_id and gs.min_marks <= new.marks
      order by gs.min_marks desc
      limit 1
    );
  end if;
  return new;
end
$$;
revoke all on function public.set_grade_points() from public, anon, authenticated;

create trigger set_grade_points
  before insert or update on public.subject_results
  for each row execute function public.set_grade_points();

revoke insert (grade_points), update (grade_points) on public.subject_results from authenticated;

alter table public.subject_results
  add constraint subject_results_marks_range check (marks between 0 and 100),
  add constraint subject_results_unique_per_semester unique (student_id, subject_id, semester);

grant insert (college_id, code, name, credits) on public.subjects to authenticated;
grant update (code, name, credits) on public.subjects to authenticated;

create policy subjects_admin_insert on public.subjects
  for insert to authenticated
  with check (
    (select public.app_role_of_user()) = 'college_admin'
    and college_id = (select public.current_college_id())
  );
create policy subjects_admin_update on public.subjects
  for update to authenticated
  using (
    (select public.app_role_of_user()) = 'college_admin'
    and college_id = (select public.current_college_id())
  )
  with check (
    (select public.app_role_of_user()) = 'college_admin'
    and college_id = (select public.current_college_id())
  );
