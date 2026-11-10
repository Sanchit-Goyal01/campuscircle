-- Documents: study notes (with embedded chunks) and past papers, shared within
-- a college. Files live in the private `academics` storage bucket under
-- <college_id>/<notes|papers>/<uuid>.pdf.

create extension if not exists vector with schema extensions;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  title text not null,
  file_path text not null,
  page_count int,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'not_searchable', 'failed')),
  created_at timestamptz not null default now()
);
create index notes_college_id_idx on public.notes (college_id);
create index notes_uploaded_by_idx on public.notes (uploaded_by);
create index notes_subject_id_idx on public.notes (subject_id);

create table public.note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  page int not null,
  seq int not null,
  content text not null,
  embedding extensions.vector(384) not null
);
create index note_chunks_note_id_idx on public.note_chunks (note_id);
create index note_chunks_college_id_idx on public.note_chunks (college_id);
create index note_chunks_embedding_idx on public.note_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.past_papers (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  exam_type text not null check (exam_type in ('midterm', 'endterm', 'quiz', 'other')),
  file_path text not null,
  created_at timestamptz not null default now()
);
create index past_papers_college_id_idx on public.past_papers (college_id);
create index past_papers_uploaded_by_idx on public.past_papers (uploaded_by);
create index past_papers_subject_id_idx on public.past_papers (subject_id);

alter table public.notes enable row level security;
alter table public.note_chunks enable row level security;
alter table public.past_papers enable row level security;

revoke all on public.notes, public.note_chunks, public.past_papers from anon, authenticated;
grant select on public.notes, public.note_chunks, public.past_papers to authenticated;
grant delete on public.notes, public.past_papers to authenticated;
grant insert (college_id, uploaded_by, subject_id, title, file_path)
  on public.notes to authenticated;
grant update (status, page_count) on public.notes to authenticated;
grant insert (note_id, college_id, page, seq, content, embedding)
  on public.note_chunks to authenticated;
grant insert (college_id, uploaded_by, subject_id, year, exam_type, file_path)
  on public.past_papers to authenticated;

-- Select: open within the college.
create policy notes_select on public.notes
  for select to authenticated using (college_id = (select public.current_college_id()));
create policy note_chunks_select on public.note_chunks
  for select to authenticated using (college_id = (select public.current_college_id()));
create policy past_papers_select on public.past_papers
  for select to authenticated using (college_id = (select public.current_college_id()));

-- Insert: own rows in own college, pointing at own college's folder and subjects.
create policy notes_insert on public.notes
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and college_id = (select public.current_college_id())
    and file_path like college_id::text || '/notes/%'
    and (
      subject_id is null
      or exists (
        select 1 from public.subjects s
        where s.id = notes.subject_id
          and s.college_id = (select public.current_college_id())
      )
    )
  );
create policy note_chunks_insert on public.note_chunks
  for insert to authenticated
  with check (
    college_id = (select public.current_college_id())
    and exists (
      select 1 from public.notes n
      where n.id = note_chunks.note_id
        and n.uploaded_by = (select auth.uid())
        and n.college_id = note_chunks.college_id
    )
  );
create policy past_papers_insert on public.past_papers
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and college_id = (select public.current_college_id())
    and file_path like college_id::text || '/papers/%'
    and exists (
      select 1 from public.subjects s
      where s.id = past_papers.subject_id
        and s.college_id = (select public.current_college_id())
    )
  );

-- Update (status, page_count) and delete: uploader only.
create policy notes_update on public.notes
  for update to authenticated
  using (uploaded_by = (select auth.uid()))
  with check (uploaded_by = (select auth.uid()));
create policy notes_delete on public.notes
  for delete to authenticated using (uploaded_by = (select auth.uid()));
create policy past_papers_delete on public.past_papers
  for delete to authenticated using (uploaded_by = (select auth.uid()));

-- Semantic search. Security invoker: RLS on notes and note_chunks applies, so
-- results never leave the caller's college.
create function public.match_note_chunks(
  query_embedding extensions.vector(384),
  match_count int default 8,
  filter_subject uuid default null,
  filter_note uuid default null
)
returns table (note_id uuid, title text, page int, content text, similarity float)
language sql
stable
security invoker
set search_path = public, extensions
-- HNSW yields only ~ef_search candidates before RLS, status and filters apply;
-- iterative scan keeps scanning until enough rows survive them.
set hnsw.iterative_scan = 'relaxed_order'
as $$
  select c.note_id, n.title, c.page, c.content,
         (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.note_chunks c
  join public.notes n on n.id = c.note_id
  where n.status = 'ready'
    and (filter_subject is null or n.subject_id = filter_subject)
    and (filter_note is null or c.note_id = filter_note)
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50)
$$;
revoke all on function public.match_note_chunks(extensions.vector, int, uuid, uuid) from public, anon;
grant execute on function public.match_note_chunks(extensions.vector, int, uuid, uuid) to authenticated;

-- Inserts all of a note's chunks in one statement, so a bad row leaves none.
-- Security invoker: the note_chunks insert policy applies to every row.
create function public.insert_note_chunks(p_note_id uuid, p_chunks jsonb)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
  insert into public.note_chunks (note_id, college_id, page, seq, content, embedding)
  select p_note_id, (select public.current_college_id()),
         (c->>'page')::int, (c->>'seq')::int, c->>'content',
         (c->>'embedding')::extensions.vector(384)
  from jsonb_array_elements(p_chunks) as c
$$;
revoke all on function public.insert_note_chunks(uuid, jsonb) from public, anon;
grant execute on function public.insert_note_chunks(uuid, jsonb) to authenticated;

-- Storage: private bucket, PDF only, 20 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academics', 'academics', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

create policy academics_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'academics'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
  );
create policy academics_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'academics'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and owner_id = (select auth.uid())::text
  );
create policy academics_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'academics'
    and (storage.foldername(name))[1] = (select public.current_college_id())::text
    and owner_id = (select auth.uid())::text
  );
