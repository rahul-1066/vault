-- A private bucket plus account-level allowlist and per-user row isolation.
-- Apply only to the new dedicated vault project, after reviewing the Auth setup.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists private.vault_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  initial_password_hash text,
  added_at timestamptz not null default now()
);
revoke all on private.vault_members from public, anon, authenticated;

create or replace function private.is_vault_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from private.vault_members m join auth.users u on u.id = m.user_id where m.user_id = (select auth.uid()) and (m.initial_password_hash is null or m.initial_password_hash is distinct from u.encrypted_password)); $$;
revoke all on function private.is_vault_member() from public, anon;
grant execute on function private.is_vault_member() to authenticated;

create or replace function public.vault_status() returns jsonb
language sql stable security definer set search_path = ''
as $$ select coalesce((select jsonb_build_object('active', m.initial_password_hash is null or m.initial_password_hash is distinct from u.encrypted_password, 'role', m.role, 'must_change_password', m.initial_password_hash is not null and m.initial_password_hash is not distinct from u.encrypted_password) from private.vault_members m join auth.users u on u.id = m.user_id where m.user_id = (select auth.uid())), jsonb_build_object('active', false, 'role', null, 'must_change_password', false)); $$;
revoke all on function public.vault_status() from public, anon;
grant execute on function public.vault_status() to authenticated;

-- Called only by the server-side admin function after Auth creates a user.
create or replace function public.register_vault_member(target_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$ begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'Not permitted'; end if;
  insert into private.vault_members(user_id, role, initial_password_hash)
  select id, 'member', encrypted_password from auth.users where id = target_user_id;
  if not found then raise exception 'User does not exist'; end if;
end; $$;
revoke all on function public.register_vault_member(uuid) from public, anon, authenticated;
grant execute on function public.register_vault_member(uuid) to service_role;

create table if not exists public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  category text not null check (category in ('identity','education','work','finance','personal','other')),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  content_type text not null check (char_length(content_type) between 1 and 128),
  created_at timestamptz not null default now(),
  constraint owner_path check (split_part(storage_path, '/', 1) = owner_id::text and storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
create index if not exists vault_documents_owner_created on public.vault_documents(owner_id, created_at desc);
alter table public.vault_documents enable row level security;
revoke all on public.vault_documents from public, anon, authenticated;
grant select, insert, delete on public.vault_documents to authenticated;

drop policy if exists vault_docs_read on public.vault_documents;
create policy vault_docs_read on public.vault_documents for select to authenticated
using (owner_id = (select auth.uid()) and (select private.is_vault_member()));
drop policy if exists vault_docs_insert on public.vault_documents;
create policy vault_docs_insert on public.vault_documents for insert to authenticated
with check (owner_id = (select auth.uid()) and (select private.is_vault_member()));
drop policy if exists vault_docs_delete on public.vault_documents;
create policy vault_docs_delete on public.vault_documents for delete to authenticated
using (owner_id = (select auth.uid()) and (select private.is_vault_member()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('family-vault', 'family-vault', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists vault_objects_read on storage.objects;
create policy vault_objects_read on storage.objects for select to authenticated
using (bucket_id = 'family-vault' and (storage.foldername(name))[1] = (select auth.uid()::text) and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (select private.is_vault_member()));
drop policy if exists vault_objects_insert on storage.objects;
create policy vault_objects_insert on storage.objects for insert to authenticated
with check (bucket_id = 'family-vault' and (storage.foldername(name))[1] = (select auth.uid()::text) and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (select private.is_vault_member()));
drop policy if exists vault_objects_delete on storage.objects;
create policy vault_objects_delete on storage.objects for delete to authenticated
using (bucket_id = 'family-vault' and (storage.foldername(name))[1] = (select auth.uid()::text) and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (select private.is_vault_member()));
