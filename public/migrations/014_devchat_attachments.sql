-- Devchat attachments — public storage bucket for screenshots people
-- paste into the chat box. Images get uploaded here, the public URL goes
-- into devchat_messages.metadata.images, and Claude reads them as vision
-- blocks via /api/devchat-respond.
--
-- Public bucket because Claude vision calls need a stable URL (no signed
-- URLs in vision payload). Workspace threat model is forgiving and the
-- attachment file paths are random uuids, not enumerable.

insert into storage.buckets (id, name, public)
values ('devchat-attachments', 'devchat-attachments', true)
on conflict (id) do update set public = true;

-- Anyone can read (public bucket).
drop policy if exists "devchat attachments public read"  on storage.objects;
create policy "devchat attachments public read"
  on storage.objects for select
  using (bucket_id = 'devchat-attachments');

-- Anyone can upload — including anon visitors on the public sequencer.
-- Same threat-model decision as the devchat tables themselves.
drop policy if exists "devchat attachments public insert" on storage.objects;
create policy "devchat attachments public insert"
  on storage.objects for insert
  with check (bucket_id = 'devchat-attachments');

-- Only signed-in users can delete attachments (cleanup is admin-side).
drop policy if exists "devchat attachments authed delete" on storage.objects;
create policy "devchat attachments authed delete"
  on storage.objects for delete
  using (bucket_id = 'devchat-attachments' and auth.uid() is not null);
