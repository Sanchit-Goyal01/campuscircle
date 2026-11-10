-- Marketplace: listings with full-text search, the listing-photos bucket, and
-- contact_seller (notification + per-buyer rate limit through a private log).

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null default public.current_college_id()
    references public.colleges (id) on delete cascade,
  seller_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  price_inr int not null check (price_inr between 0 and 1000000),
  condition text not null check (condition in ('new', 'like_new', 'good', 'fair')),
  status text not null default 'available' check (status in ('available', 'sold')),
  photo_path text,
  search tsvector generated always as
    (to_tsvector('simple', title || ' ' || description)) stored,
  created_at timestamptz not null default now(),
  -- A photo must live in the seller's own folder: one filename segment, no
  -- slashes or dots-only names after the prefix.
  constraint listings_photo_path_owner check (
    photo_path is null
    or (photo_path like college_id::text || '/' || seller_id::text || '/%'
        and substr(photo_path, char_length(college_id::text || '/' || seller_id::text || '/') + 1)
            ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
  )
);
create index listings_search_idx on public.listings using gin (search);
create index listings_college_id_idx on public.listings (college_id, created_at desc);
create index listings_seller_id_idx on public.listings (seller_id);

alter table public.listings enable row level security;
revoke all on public.listings from anon, authenticated;
grant select on public.listings to authenticated;
-- college_id and seller_id come from their defaults, never from the client.
grant insert (title, description, price_inr, condition, photo_path) on public.listings to authenticated;
grant update (title, description, price_inr, condition, status, photo_path) on public.listings to authenticated;
grant delete on public.listings to authenticated;

create policy listings_select on public.listings
  for select to authenticated
  using (college_id = public.current_college_id());

create policy listings_insert on public.listings
  for insert to authenticated
  with check (
    college_id = public.current_college_id()
    and seller_id = auth.uid()
    and public.app_role_of_user() = 'student'
  );

create policy listings_update on public.listings
  for update to authenticated
  using (college_id = public.current_college_id() and seller_id = auth.uid())
  with check (college_id = public.current_college_id() and seller_id = auth.uid());

create policy listings_delete on public.listings
  for delete to authenticated
  using (college_id = public.current_college_id() and seller_id = auth.uid());

-- Storage: private jpeg-only bucket, <college_id>/<seller_id>/<uuid>.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

create policy listing_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.app_role_of_user()) = 'student'
    and owner_id = (select auth.uid())::text
  );
create policy listing_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
  );
-- Sellers may remove their own photos (cleanup when a listing is deleted).
create policy listing_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );

-- Rolling log for the 10-contacts-per-24h limit. No client access.
create table public.listing_contact_log (
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index listing_contact_log_buyer_idx on public.listing_contact_log (buyer_id, created_at);
alter table public.listing_contact_log enable row level security;
revoke all on public.listing_contact_log from anon, authenticated;

create function public.contact_seller(p_listing_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_college uuid := public.current_college_id();
  v_role public.app_role := public.app_role_of_user();
  v_message text := btrim(p_message);
  v_listing public.listings;
  v_name text;
begin
  if v_uid is null or v_college is null
     or coalesce(v_role = 'student', false) is not true then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into v_listing from public.listings
  where id = p_listing_id and college_id = v_college;
  if not found or v_listing.seller_id = v_uid then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_listing.status <> 'available' then
    raise exception 'This item has already been sold.' using errcode = 'P0001';
  end if;
  if v_message is null or char_length(v_message) not between 10 and 500 then
    raise exception 'invalid_request' using errcode = '23514';
  end if;

  -- Serialise a buyer's own contacts so the limit cannot be raced.
  perform pg_advisory_xact_lock(hashtext('contact_seller:' || v_uid::text));
  if (select count(*) from public.listing_contact_log
      where buyer_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have contacted sellers too many times today. Try again tomorrow.'
      using errcode = 'P0001';
  end if;
  insert into public.listing_contact_log (buyer_id) values (v_uid);

  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, college_id, kind, title, body, link)
  values (v_listing.seller_id, v_college, 'listing_contact',
          'Someone is interested in ' || left(v_listing.title, 80),
          coalesce(nullif(v_name, ''), 'A student') || ': ' || v_message,
          '/market/' || v_listing.id::text);
end;
$$;
revoke all on function public.contact_seller(uuid, text) from public, anon;
grant execute on function public.contact_seller(uuid, text) to authenticated;
