-- Root-cause insights: model-proposed hypotheses about repeated issues at one
-- place. Authority and college admins of the same college only; students never
-- see them. Written with the caller's own session, so RLS is the gate.

create table public.root_cause_insights (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  category text not null check (category in
    ('water', 'electricity', 'internet', 'sanitation', 'furniture', 'safety', 'other')),
  hypothesis text not null check (char_length(hypothesis) between 10 and 400),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  evidence_issue_ids uuid[] not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index root_cause_insights_college_idx on public.root_cause_insights (college_id, created_at desc);
create index root_cause_insights_location_idx on public.root_cause_insights (location_id);
create index root_cause_insights_decided_by_idx on public.root_cause_insights (decided_by);

-- One open proposal per place and category; also stops concurrent runs doubling up.
create unique index root_cause_insights_one_proposed_idx
  on public.root_cause_insights (college_id, location_id, category)
  where status = 'proposed';

alter table public.root_cause_insights enable row level security;
revoke all on public.root_cause_insights from anon, authenticated;
grant select on public.root_cause_insights to authenticated;
grant insert (location_id, category, hypothesis, confidence, evidence_issue_ids, status)
  on public.root_cause_insights to authenticated;
grant update (status, decided_by) on public.root_cause_insights to authenticated;

create policy root_cause_insights_select on public.root_cause_insights
  for select to authenticated
  using (
    college_id = (select public.current_college_id())
    and coalesce((select public.app_role_of_user()) in ('authority', 'college_admin'), false)
  );

create policy root_cause_insights_insert on public.root_cause_insights
  for insert to authenticated
  with check (
    college_id = (select public.current_college_id())
    and coalesce((select public.app_role_of_user()) in ('authority', 'college_admin'), false)
    and status = 'proposed'
    and decided_by is null
    and exists (select 1 from public.locations l where l.id = location_id)
    and cardinality(evidence_issue_ids) > 0
    and not exists (
      select 1 from unnest(evidence_issue_ids) as e (id)
      where not exists (
        select 1 from public.issues i
        where i.id = e.id and i.college_id = (select public.current_college_id())
      )
    )
  );

create policy root_cause_insights_update on public.root_cause_insights
  for update to authenticated
  using (
    college_id = (select public.current_college_id())
    and coalesce((select public.app_role_of_user()) in ('authority', 'college_admin'), false)
  )
  with check (
    college_id = (select public.current_college_id())
    and coalesce((select public.app_role_of_user()) in ('authority', 'college_admin'), false)
    and status in ('accepted', 'dismissed')
    and decided_by = (select auth.uid())
  );

-- Repeated issues: 3 or more in the same place and category in the last 60
-- days, any status (a closed issue that keeps coming back is the signal).
-- Skips places that already have a proposed or accepted insight from the last
-- 30 days. Security invoker: RLS keeps rows inside the caller's college.
create function public.root_cause_groups()
returns table (location_id uuid, location text, category text, issue_ids uuid[], titles text[])
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if coalesce(public.app_role_of_user() in ('authority', 'college_admin'), false) is not true then
    raise exception 'Only authority or college admin can find patterns' using errcode = '42501';
  end if;
  return query
    select i.location_id, l.name, i.category,
           array_agg(i.id order by i.created_at desc),
           array_agg(i.title order by i.created_at desc)
    from public.issues i
    join public.locations l on l.id = i.location_id
    where i.college_id = public.current_college_id()
      and i.category is not null
      and i.created_at > now() - interval '60 days'
    group by i.location_id, l.name, i.category
    having count(*) >= 3
       and not exists (
         select 1 from public.root_cause_insights r
         where r.college_id = public.current_college_id()
           and r.location_id = i.location_id
           and r.category = i.category
           and r.status in ('proposed', 'accepted')
           and r.created_at > now() - interval '30 days'
       )
    order by count(*) desc, l.name, i.category
    limit 20;
end;
$$;
revoke all on function public.root_cause_groups() from public, anon;
grant execute on function public.root_cause_groups() to authenticated;
