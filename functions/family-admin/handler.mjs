/** Server-side only. The privileged service key must never reach browser code. */
export function createAdminHandler({ createClient, projectUrl, anonKey, serviceRoleKey, allowedOrigin }) {
  const headers = origin => ({
    'Access-Control-Allow-Origin': origin === allowedOrigin ? allowedOrigin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  });
  const reply = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
  return async req => {
    const origin = req.headers.get('origin') ?? '';
    if (!allowedOrigin || origin !== allowedOrigin) return reply(403, { error: 'Origin not allowed' }, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' }, origin);
    if (!projectUrl || !anonKey || !serviceRoleKey) return reply(503, { error: 'Service not configured' }, origin);
    const authorization = req.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in required' }, origin);
    const userClient = createClient(projectUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await userClient.auth.getUser();
    if (identityError || !identity?.user) return reply(401, { error: 'Sign in required' }, origin);
    const { data: status, error: statusError } = await userClient.rpc('vault_status');
    if (statusError || !status || status.active !== true || status.role !== 'admin') return reply(403, { error: 'Administrator access required' }, origin);
    let input;
    try { input = await req.json(); } catch { return reply(400, { error: 'Invalid request' }, origin); }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) return reply(400, { error: 'Invalid email or password' }, origin);
    const admin = createClient(projectUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created?.user) return reply(400, { error: 'Unable to create account' }, origin);
    const { error: membershipError } = await admin.rpc('register_vault_member', { target_user_id: created.user.id });
    if (membershipError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply(500, { error: 'Unable to finish creating account' }, origin);
    }
    return reply(201, { created: true }, origin);
  };
}
