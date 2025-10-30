-- Create storage bucket
insert into storage.buckets (id, name, public)
values ('private-media', 'private-media', false)
on conflict (id) do nothing;

-- RLS for storage
create policy "owner_upload_own_files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'private-media' 
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "owner_read_own_files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'private-media' 
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "owner_delete_own_files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'private-media' 
  and auth.uid()::text = (storage.foldername(name))[1]
);