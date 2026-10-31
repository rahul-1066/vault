const { PGlite } = require('@electric-sql/pglite');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  alice: '00000000-0000-4000-8000-000000000002',
  bob: '00000000-0000-4000-8000-000000000003',
  stranger: '00000000-0000-4000-8000-000000000004',
  newMember: '00000000-0000-4000-8000-000000000005'
};

async function main() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table storage.buckets(id text primary key, name text not null, public boolean not null, file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  await db.exec(await readFile('database/vault.sql', 'utf8'));
  const q = async (text, params=[]) => db.query(text, params);
  async function assume(role, id='') { await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id, role]); await db.exec(`set role ${role}`); }
  async function blocked(text, params, label) { let didFail=false; try { await q(text,params); } catch { didFail=true; } assert.equal(didFail,true,label); }

  for (const [name, id] of Object.entries(ids)) await q('insert into auth.users(id, encrypted_password) values ($1,$2)',[id, `${name}-hash`]);
  await q("insert into private.vault_members(user_id,role,initial_password_hash) values ($1,'admin',null),($2,'member','alice-hash'),($3,'member',null)",[ids.admin,ids.alice,ids.bob]);
  const bucket = await q("select public from storage.buckets where id='family-vault'"); assert.equal(bucket.rows[0].public,false, 'bucket must be private');

  await assume('anon');
  await blocked('select * from public.vault_documents', [], 'anonymous must not list documents');
  await blocked("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.alice}/${ids.newMember}`],'anonymous must not write objects');

  await assume('authenticated',ids.alice);
  let status=(await q('select public.vault_status() as status')).rows[0].status;
  assert.equal(status.must_change_password,true); assert.equal(status.active,false);
  await blocked("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.alice}/${ids.newMember}`],'temporary password must not permit file access');
  await blocked('select * from private.vault_members',[], 'member list must be private');
  await blocked('select public.register_vault_member($1)',[ids.stranger], 'member must not register users');

  await db.exec('reset role'); await q('update auth.users set encrypted_password=$1 where id=$2',['alice-changed-hash',ids.alice]);
  await assume('authenticated',ids.alice);
  status=(await q('select public.vault_status() as status')).rows[0].status;
  assert.equal(status.active,true); assert.equal(status.must_change_password,false);
  await q("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.alice}/${ids.newMember}`]);
  await q("insert into public.vault_documents(owner_id,name,category,storage_path,size_bytes,content_type) values($1,'document.pdf','personal',$2,1,'application/pdf')",[ids.alice,`${ids.alice}/${ids.newMember}`]);
  await blocked("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.alice}/../${ids.bob}`],'unexpected object paths must be rejected');
  assert.equal((await q('select * from public.vault_documents')).rows.length,1,'owner can list own document');

  await assume('authenticated',ids.bob);
  assert.equal((await q('select * from public.vault_documents')).rows.length,0,'another member cannot list documents');
  assert.equal((await q('select * from storage.objects')).rows.length,0,'another member cannot read objects');
  assert.equal((await q("delete from storage.objects where name=$1 returning name",[`${ids.alice}/${ids.newMember}`])).rows.length,0,'another member cannot delete objects');
  await blocked("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.alice}/${ids.admin}`],'another member cannot upload into another directory');
  await blocked("insert into public.vault_documents(owner_id,name,category,storage_path,size_bytes,content_type) values($1,'x','other',$2,1,'text/plain')",[ids.alice,`${ids.alice}/${ids.admin}`],'another member cannot impersonate owner');
  await q("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.bob}/${ids.admin}`]);

  await assume('authenticated',ids.stranger);
  status=(await q('select public.vault_status() as status')).rows[0].status;
  assert.equal(status.active,false,'unapproved account must be inactive');
  await blocked("insert into storage.objects(bucket_id,name) values ('family-vault',$1)",[`${ids.stranger}/${ids.admin}`],'unapproved account cannot store documents');

  await assume('service_role'); await q('select public.register_vault_member($1)',[ids.newMember]);
  await assume('authenticated',ids.newMember); status=(await q('select public.vault_status() as status')).rows[0].status;
  assert.equal(status.must_change_password,true,'new member must replace temporary password');
  console.log('PASS: private bucket, access grants, membership gate, password change, user isolation, and admin registration');
  await db.close();
}
main().catch(err => { console.error(err); process.exitCode=1; });
