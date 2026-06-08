-- jobradar: storage bucket for resume uploads
--
-- Apply after 01_resumes.sql. Creates a private bucket named "resumes" and
-- locks reads/writes to the uploader: the first segment of each object's
-- path must equal the caller's auth.uid()::text (e.g. "<uuid>/<filename>.pdf").
--
-- Idempotent: bucket insert uses `on conflict do nothing`, policies are
-- dropped before being recreated.

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security policies on storage.objects
--
-- storage.foldername(name) returns the array of path segments. We require
-- segments[1] (the top-level folder) to equal the user's UUID.
-- ---------------------------------------------------------------------------

drop policy if exists "resumes bucket: owner read" on storage.objects;
create policy "resumes bucket: owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "resumes bucket: owner upload" on storage.objects;
create policy "resumes bucket: owner upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "resumes bucket: owner update" on storage.objects;
create policy "resumes bucket: owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "resumes bucket: owner delete" on storage.objects;
create policy "resumes bucket: owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
