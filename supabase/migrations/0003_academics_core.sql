-- Academics core: subjects (college-wide, read-only to students) and
-- per-student results and study plans (owner-only).

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  code text not null,
  name text not null,
  credits numeric not null,
  unique (college_id, code)
);

create table public.subject_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  semester int not null,
  marks numeric,
  grade_points numeric
);
create index subject_results_student_id_idx on public.subject_results (student_id);
create index subject_results_subject_id_idx on public.subject_results (subject_id);

create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  title text not null,
  created_at timestamptz not null default now()
);
create index study_plans_student_id_idx on public.study_plans (student_id);

create table public.study_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  due_on date not null,
  task text not null,
  done boolean not null default false
);
create index study_plan_items_plan_id_idx on public.study_plan_items (plan_id);

alter table public.subjects enable row level security;
alter table public.subject_results enable row level security;
alter table public.study_plans enable row level security;
alter table public.study_plan_items enable row level security;

revoke all on public.subjects, public.subject_results, public.study_plans, public.study_plan_items
  from anon, authenticated;
grant select on public.subjects to authenticated;
grant select, delete on public.subject_results, public.study_plans, public.study_plan_items
  to authenticated;
grant insert (student_id, college_id, subject_id, semester, marks, grade_points)
  on public.subject_results to authenticated;
grant update (semester, marks, grade_points) on public.subject_results to authenticated;
grant insert (student_id, college_id, title) on public.study_plans to authenticated;
grant update (title) on public.study_plans to authenticated;
grant insert (plan_id, college_id, due_on, task, done) on public.study_plan_items to authenticated;
grant update (due_on, task, done) on public.study_plan_items to authenticated;

create policy subjects_select on public.subjects
  for select to authenticated using (college_id = (select public.current_college_id()));

create policy subject_results_select on public.subject_results
  for select to authenticated using (student_id = (select auth.uid()));
create policy subject_results_insert on public.subject_results
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
    and exists (
      select 1 from public.subjects s
      where s.id = subject_results.subject_id
        and s.college_id = (select public.current_college_id())
    )
  );
create policy subject_results_update on public.subject_results
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));
create policy subject_results_delete on public.subject_results
  for delete to authenticated using (student_id = (select auth.uid()));

create policy study_plans_select on public.study_plans
  for select to authenticated using (student_id = (select auth.uid()));
create policy study_plans_insert on public.study_plans
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
  );
create policy study_plans_update on public.study_plans
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));
create policy study_plans_delete on public.study_plans
  for delete to authenticated using (student_id = (select auth.uid()));

create policy study_plan_items_select on public.study_plan_items
  for select to authenticated
  using (exists (
    select 1 from public.study_plans p
    where p.id = study_plan_items.plan_id and p.student_id = (select auth.uid())
  ));
create policy study_plan_items_insert on public.study_plan_items
  for insert to authenticated
  with check (
    college_id = (select public.current_college_id())
    and exists (
      select 1 from public.study_plans p
      where p.id = study_plan_items.plan_id and p.student_id = (select auth.uid())
    )
  );
create policy study_plan_items_update on public.study_plan_items
  for update to authenticated
  using (exists (
    select 1 from public.study_plans p
    where p.id = study_plan_items.plan_id and p.student_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.study_plans p
    where p.id = study_plan_items.plan_id and p.student_id = (select auth.uid())
  ));
create policy study_plan_items_delete on public.study_plan_items
  for delete to authenticated
  using (exists (
    select 1 from public.study_plans p
    where p.id = study_plan_items.plan_id and p.student_id = (select auth.uid())
  ));
