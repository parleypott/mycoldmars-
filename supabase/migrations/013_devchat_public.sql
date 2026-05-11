-- Devchat is open to anonymous visitors too — Sam (or anyone on the
-- public sequencer route) needs to be able to flag bugs without first
-- creating an account. Workspace threat model is forgiving (small crew,
-- one creator, no PII), so we relax the RLS instead of building a
-- separate anonymous-id column.
--
-- This drops the auth.uid()-required policies from migration 012 and
-- replaces them with anon-allowed read/insert. Updates and deletes
-- still require a real session (signed-in admins manage status, no
-- accidental wipe by a passing visitor).

drop policy if exists devchat_threads_all  on devchat_threads;
drop policy if exists devchat_messages_all on devchat_messages;

-- Threads: anyone can read + create. Only signed-in can update/delete.
create policy devchat_threads_read on devchat_threads
  for select using (true);
create policy devchat_threads_insert on devchat_threads
  for insert with check (true);
create policy devchat_threads_update on devchat_threads
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy devchat_threads_delete on devchat_threads
  for delete using (auth.uid() is not null);

-- Messages: anyone can read + post. Updates/deletes signed-in only.
create policy devchat_messages_read on devchat_messages
  for select using (true);
create policy devchat_messages_insert on devchat_messages
  for insert with check (true);
create policy devchat_messages_update on devchat_messages
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy devchat_messages_delete on devchat_messages
  for delete using (auth.uid() is not null);
