-- Marking a plan item missed: it moves to tomorrow and the plan's later,
-- not-done items shift one day, so the plan keeps its order.
-- Security invoker: the study_plan_items RLS policies limit this to the plan's owner,
-- so another student's item is simply not visible and nothing changes.
-- Returns no rows for an item that is not yet due. Raises 'item_done' when the item is already done. One function call is one
-- transaction, so a failure changes nothing.

create function public.mark_item_missed(p_item_id uuid, p_today date)
returns setof public.study_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.study_plan_items;
begin
  select * into v_item from public.study_plan_items where id = p_item_id for update;
  if not found then
    return;
  end if;
  if v_item.done then
    raise exception 'item_done' using errcode = 'P0001';
  end if;
  -- Only an item that is due can be missed. This also makes a repeat call (double
  -- submit, stale tab) a no-op: after the first call the item is due tomorrow.
  if v_item.due_on > p_today then
    return;
  end if;

  return query
  with shifted as (
    update public.study_plan_items
    set due_on = due_on + 1
    where plan_id = v_item.plan_id
      and id <> v_item.id
      and not done
      and due_on >= p_today + 1
    returning *
  ),
  moved as (
    update public.study_plan_items
    set due_on = p_today + 1
    where id = v_item.id
    returning *
  )
  select * from moved
  union all
  select * from shifted;
end;
$$;

revoke all on function public.mark_item_missed(uuid, date) from public, anon;
grant execute on function public.mark_item_missed(uuid, date) to authenticated;
