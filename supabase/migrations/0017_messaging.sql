-- One-to-one messaging. A conversation is stored once per pair as
-- (user_low, user_high) with user_low < user_high. Clients read their own
-- conversations and messages; every write goes through the security definer
-- functions below. messages joins the supabase_realtime publication, and its
-- select policy is a plain participant check so Realtime can evaluate it.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  user_low uuid not null references public.profiles (id) on delete cascade,
  user_high uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  low_read_at timestamptz,
  high_read_at timestamptz,
  constraint conversations_ordered check (user_low < user_high),
  constraint conversations_pair_unique unique (user_low, user_high)
);
create index conversations_high_idx on public.conversations (user_high);
create index conversations_college_idx on public.conversations (college_id);

alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

create policy conversations_select on public.conversations
  for select to authenticated
  using (auth.uid() in (user_low, user_high));

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_sender_idx on public.messages (sender_id, created_at);
create index messages_college_idx on public.messages (college_id);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

-- The subselect runs under the reader's RLS on conversations (participants only).
create policy messages_select on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

alter publication supabase_realtime add table public.messages;

-- Finds or creates the pair's conversation. Internal: only the functions below call it.
create function public._conversation_for(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_low uuid;
  v_high uuid;
  v_id uuid;
begin
  if v_uid is null or v_college is null
     or coalesce(public.app_role_of_user() is not null, false) is not true
     or p_other is null or p_other = v_uid
     or not exists (select 1 from public.profiles where id = p_other and college_id = v_college) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_uid < p_other then v_low := v_uid; v_high := p_other; else v_low := p_other; v_high := v_uid; end if;
  insert into public.conversations (college_id, user_low, user_high)
  values (v_college, v_low, v_high)
  on conflict (user_low, user_high) do nothing;
  select id into v_id from public.conversations where user_low = v_low and user_high = v_high;
  return v_id;
end;
$$;
revoke all on function public._conversation_for(uuid) from public, anon, authenticated;

create function public.open_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._conversation_for(p_other);
end;
$$;
revoke all on function public.open_conversation(uuid) from public, anon;
grant execute on function public.open_conversation(uuid) to authenticated;

-- Sends a message and returns the conversation id. Capped at 60 per sender per
-- hour; the messages table itself is the log, since clients cannot delete rows.
create function public.send_message(p_recipient_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(p_body);
  v_conv uuid;
begin
  v_conv := public._conversation_for(p_recipient_id);
  if v_body is null or char_length(v_body) not between 1 and 2000 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('send_message:' || v_uid::text, 0));
  if (select count(*) from public.messages
      where sender_id = v_uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too_many_messages' using errcode = 'P0001';
  end if;

  insert into public.messages (conversation_id, college_id, sender_id, body)
  values (v_conv, public.current_college_id(), v_uid, v_body);
  update public.conversations
  set last_message_at = now(),
      low_read_at = case when user_low = v_uid then now() else low_read_at end,
      high_read_at = case when user_high = v_uid then now() else high_read_at end
  where id = v_conv;
  return v_conv;
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null or coalesce(public.app_role_of_user() is not null, false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  update public.conversations
  set low_read_at = case when user_low = v_uid then now() else low_read_at end,
      high_read_at = case when user_high = v_uid then now() else high_read_at end
  where id = p_conversation_id and v_uid in (user_low, user_high);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
