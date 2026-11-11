-- Timetable: weekly classes and dated exams, owner-only.
-- weekday is ISO: 1 = Monday ... 7 = Sunday.

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  college_id uuid not null references public.colleges (id),
  subject_id uuid references public.subjects (id) on delete set null,
  kind text not null check (kind in ('class', 'exam')),
  weekday int check (weekday between 1 and 7),
  exam_date date,
  start_time time not null,
  end_time time,
  location text,
  created_at timestamptz not null default now(),
  constraint timetable_kind_fields check (
    (kind = 'class' and weekday is not null and exam_date is null)
    or (kind = 'exam' and exam_date is not null and weekday is null)
  )
);
create index timetable_entries_student_id_idx on public.timetable_entries (student_id);
create index timetable_entries_subject_id_idx on public.timetable_entries (subject_id);

alter table public.timetable_entries enable row level security;
revoke all on public.timetable_entries from anon, authenticated;
grant select, delete on public.timetable_entries to authenticated;
grant insert (student_id, college_id, subject_id, kind, weekday, exam_date, start_time, end_time, location)
  on public.timetable_entries to authenticated;

create policy timetable_entries_select on public.timetable_entries
  for select to authenticated using (student_id = (select auth.uid()));
create policy timetable_entries_insert on public.timetable_entries
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and college_id = (select public.current_college_id())
    and (
      subject_id is null
      or exists (
        select 1 from public.subjects s
        where s.id = timetable_entries.subject_id
          and s.college_id = (select public.current_college_id())
      )
    )
  );
create policy timetable_entries_delete on public.timetable_entries
  for delete to authenticated using (student_id = (select auth.uid()));
