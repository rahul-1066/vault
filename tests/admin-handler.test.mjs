import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../functions/family-admin/handler.mjs';

const origin = 'https://example.github.io';
function harness(options = {}) {
  const calls = [];
  const user = {
    auth: { getUser: async () => options.badUser ? { data: {}, error: new Error('unauthenticated') } : { data: { user: { id: 'admin-id' } }, error: null } },
    rpc: async () => ({ data: options.status ?? { role: 'admin', active: true }, error: options.badStatus ? new Error('failure') : null })
  };
  const admin = {
    auth: { admin: {
      createUser: async input => { calls.push(['create', input.email, input.email_confirm]); return options.createError ? { data: {}, error: new Error('duplicate') } : { data: { user: { id: 'new-id' } }, error: null }; },
      deleteUser: async id => { calls.push(['delete', id]); return { error: null }; }
    } },
    rpc: async (name, params) => { calls.push(['register', name, params.target_user_id]); return { error: options.membershipError ? new Error('failure') : null }; }
  };
  const createClient = (_url, key) => key === 'anon' ? user : admin;
  return { calls, handle: createAdminHandler({ createClient, projectUrl: 'https://example.supabase.co', anonKey: 'anon', serviceRoleKey: 'privileged', allowedOrigin: origin }) };
}
const request = (body, opts={}) => new Request('https://api.example/functions/v1/family-admin', {
  method: opts.method ?? 'POST', headers: { origin: opts.origin ?? origin, ...(opts.noAuth ? {} : { authorization: 'Bearer valid-token' }), 'content-type': 'application/json' },
  ...(opts.method === 'OPTIONS' || opts.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});
const valid = { email: 'member@example.test', password: 'temporary-password-123' };

test('rejects calls from other origins', async () => { const {handle,calls}=harness(); const res=await handle(request(valid,{origin:'https://evil.test'})); assert.equal(res.status,403); assert.equal(calls.length,0); });
test('answers only permitted preflight', async () => { const {handle}=harness(); const res=await handle(request(null,{method:'OPTIONS'})); assert.equal(res.status,204); assert.equal(res.headers.get('access-control-allow-origin'),origin); });
test('rejects missing and invalid authentication', async () => { assert.equal((await harness().handle(request(valid,{noAuth:true}))).status,401); assert.equal((await harness({badUser:true}).handle(request(valid))).status,401); });
test('rejects ordinary or inactive members', async () => { for (const status of [{role:'member',active:true},{role:'admin',active:false}]) { const {handle,calls}=harness({status}); assert.equal((await handle(request(valid))).status,403); assert.equal(calls.length,0); } });
test('rejects malformed requests before account creation', async () => { const {handle,calls}=harness(); assert.equal((await handle(request('{'))).status,400); assert.equal((await handle(request({email:'x',password:'short'}))).status,400); assert.equal(calls.length,0); });
test('creates an account and registers membership for an active admin', async () => { const {handle,calls}=harness(); const res=await handle(request(valid)); assert.equal(res.status,201); assert.deepEqual(await res.json(),{created:true}); assert.deepEqual(calls,[['create','member@example.test',true],['register','register_vault_member','new-id']]); });
test('cleans up a new account if membership registration fails', async () => { const {handle,calls}=harness({membershipError:true}); assert.equal((await handle(request(valid))).status,500); assert.deepEqual(calls.at(-1),['delete','new-id']); });
