(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cfg = window.FAMILY_VAULT_CONFIG || {};
  const validConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url || '') && /^(sb_publishable_|eyJ)/.test(cfg.publishableKey || '');
  const client = validConfig && window.supabase ? window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  const categoryLabels = { identity: 'Identity', education: 'Education', work: 'Work', finance: 'Finance', personal: 'Personal', other: 'Other' };
  const maxSize = 50 * 1024 * 1024;
  const state = { user: null, documents: [], access: false, admin: false, busy: false, reset: /(?:^|[&#?])type=(?:recovery|invite)(?:&|$)/.test(location.hash + location.search), generation: 0 };
  let toastTimer;

  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
  function setPage(showApp) { $('auth-page').classList.toggle('hidden', showApp); $('app-page').classList.toggle('hidden', !showApp); }
  function friendlyError(error, fallback) { console.error(fallback, error); return fallback; }
  function formatBytes(n) { if (!n) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
  function node(tag, cls, text) { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; }
  function button(text, cls, action) { const x = node('button', cls, text); x.type = 'button'; x.addEventListener('click', action); return x; }

  function renderDocuments() {
    const list = $('file-list'); list.replaceChildren();
    const q = $('search').value.trim().toLocaleLowerCase(); const category = $('filter').value;
    const docs = state.documents.filter(d => (!q || d.name.toLocaleLowerCase().includes(q)) && (category === 'all' || d.category === category));
    $('document-count').textContent = String(state.documents.length);
    $('total-size').textContent = formatBytes(state.documents.reduce((n, d) => n + Number(d.size_bytes || 0), 0));
    $('empty-state').classList.toggle('hidden', !state.access || docs.length > 0);
    $('empty-title').textContent = state.documents.length ? 'Nothing found just yet.' : 'A little space, just for you.';
    $('empty-copy').textContent = state.documents.length ? 'Try another search or category.' : 'Your documents will appear here. Add your first one to get started.';
    $('empty-upload').classList.toggle('hidden', state.documents.length > 0 || !state.access);
    for (const doc of docs) {
      const row = node('div', 'file-row');
      const ext = doc.name.includes('.') ? doc.name.split('.').pop().slice(0, 5).toUpperCase() : 'FILE';
      const icon = node('div', 'file-icon', ext); icon.setAttribute('aria-hidden', 'true'); row.append(icon);
      const name = node('div', 'file-name', doc.name); name.title = doc.name; row.append(name);
      row.append(node('div', 'file-category', categoryLabels[doc.category] || 'Other'));
      row.append(node('div', 'file-size', formatBytes(Number(doc.size_bytes))));
      row.append(node('div', 'file-date', new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(doc.created_at))));
      const actions = node('div', 'file-actions');
      actions.append(button('Download', '', () => download(doc)), button('Delete', 'delete-button', () => remove(doc))); row.append(actions); list.append(row);
    }
  }
  async function loadDocuments() {
    const generation = ++state.generation; $('loading').classList.remove('hidden'); $('empty-state').classList.add('hidden'); $('file-list').replaceChildren();
    try {
      const { data: status, error: accessError } = await client.rpc('vault_status');
      if (generation !== state.generation) return;
      if (status?.must_change_password) { state.reset = true; setPage(false); $('login-view').classList.add('hidden'); $('reset-view').classList.remove('hidden'); return; }
      if (accessError || status?.active !== true) {
        state.access = false; state.admin = false; state.documents = []; $('nav-members').classList.add('hidden'); $('mobile-nav-members').classList.add('hidden'); showPanel('documents'); $('access-warning').classList.remove('hidden'); $('open-upload').disabled = true;
        if (accessError) console.error('Could not verify vault membership', accessError); return;
      }
      state.access = true; state.admin = status.role === 'admin'; $('nav-members').classList.toggle('hidden', !state.admin); $('mobile-nav-members').classList.toggle('hidden', !state.admin); $('access-warning').classList.add('hidden'); $('open-upload').disabled = false;
      const { data, error } = await client.from('vault_documents').select('id,name,category,storage_path,size_bytes,content_type,created_at').order('created_at', { ascending: false });
      if (generation !== state.generation) return;
      if (error) throw error; state.documents = data || []; renderDocuments();
    } catch (error) { if (generation === state.generation) toast(friendlyError(error, 'Could not load your documents. Please try again.')); }
    finally { if (generation === state.generation) $('loading').classList.add('hidden'); }
  }
  async function download(doc) {
    if (!state.access) return;
    toast('Preparing your download…');
    const { data, error } = await client.storage.from('family-vault').download(doc.storage_path);
    if (error || !data) { toast(friendlyError(error, 'Could not download this document.')); return; }
    const url = URL.createObjectURL(data); const link = node('a'); link.href = url; link.download = doc.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function remove(doc) {
    if (!state.access || !window.confirm(`Permanently delete “${doc.name}”? This cannot be undone.`)) return;
    const { error: storageError } = await client.storage.from('family-vault').remove([doc.storage_path]);
    if (storageError) { toast(friendlyError(storageError, 'Could not delete this file.')); return; }
    const { error } = await client.from('vault_documents').delete().eq('id', doc.id);
    if (error) { toast(friendlyError(error, 'The file was removed, but its listing could not be cleared.')); return; }
    state.documents = state.documents.filter(d => d.id !== doc.id); renderDocuments(); toast('Document deleted.');
  }
  function showUpload() { if (!state.access || state.busy) return; $('upload-form').reset(); $('selected-file').textContent = 'Choose a file'; $('upload-error').textContent = ''; $('upload-dialog').showModal(); }
  function showPanel(name) {
    if (name === 'members' && !state.admin) return;
    const members = name === 'members'; $('documents-panel').classList.toggle('hidden', members); $('members-panel').classList.toggle('hidden', !members);
    $('nav-all').classList.toggle('active', !members); $('mobile-nav-all').classList.toggle('active', !members); $('nav-members').classList.toggle('active', members); $('mobile-nav-members').classList.toggle('active', members);
    document.querySelector('.breadcrumb-current').textContent = members ? 'Family members' : 'My documents';
  }
  function showPasswordChange() { if (!state.user) return; state.reset = true; setPage(false); $('login-view').classList.add('hidden'); $('reset-view').classList.remove('hidden'); }
  async function upload(event) {
    event.preventDefault(); if (state.busy || !state.user || !state.access) return;
    const file = $('file').files[0]; const errorEl = $('upload-error'); errorEl.textContent = '';
    if (!file) { errorEl.textContent = 'Choose a file first.'; return; }
    if (file.size > maxSize) { errorEl.textContent = 'Please choose a file no larger than 50 MB.'; return; }
    if (!crypto.randomUUID) { errorEl.textContent = 'Please open the secure website to upload files.'; return; }
    state.busy = true; $('upload-submit').disabled = true; $('upload-submit').textContent = 'Saving…';
    const path = `${state.user.id}/${crypto.randomUUID()}`;
    try {
      const { error: uploadError } = await client.storage.from('family-vault').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw uploadError;
      const { error: recordError } = await client.from('vault_documents').insert({ owner_id: state.user.id, name: file.name.slice(0, 180), storage_path: path, category: $('category').value, size_bytes: file.size, content_type: (file.type || 'application/octet-stream').slice(0, 128) });
      if (recordError) {
        const cleanup = await client.storage.from('family-vault').remove([path]);
        if (cleanup.error) console.error('Could not remove unlisted upload', cleanup.error);
        throw recordError;
      }
      $('upload-dialog').close(); toast('Your document has been saved.'); await loadDocuments();
    } catch (error) { errorEl.textContent = friendlyError(error, 'Could not save this document. Please try again.'); }
    finally { state.busy = false; $('upload-submit').disabled = false; $('upload-submit').textContent = 'Save document'; }
  }
  async function applySession(session) {
    state.generation++;
    if (!session || !session.user) { state.user = null; state.access = false; state.admin = false; state.reset = false; state.documents = []; $('login-view').classList.remove('hidden'); $('reset-view').classList.add('hidden'); $('nav-members').classList.add('hidden'); $('mobile-nav-members').classList.add('hidden'); setPage(false); return; }
    if (state.reset) { setPage(false); $('login-view').classList.add('hidden'); $('reset-view').classList.remove('hidden'); return; }
    state.user = session.user; $('user-email').textContent = session.user.email || 'Family member'; $('user-badge').querySelector('.avatar').textContent = (session.user.email || 'F')[0].toUpperCase(); setPage(true); await loadDocuments();
  }
  $('show-password').addEventListener('click', () => { const field = $('password'); field.type = field.type === 'password' ? 'text' : 'password'; $('show-password').textContent = field.type === 'password' ? 'Show' : 'Hide'; });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('auth-error').textContent = ''; if (!client) return;
    const email = $('email').value.trim(); const password = $('password').value;
    if (!email || !password) { $('auth-error').textContent = 'Enter your email and password.'; return; }
    $('sign-in').disabled = true;
    try { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error) { $('auth-error').textContent = 'Could not sign in. Check your email and password.'; return; } $('password').value = ''; await applySession(data.session); }
    catch (error) { $('auth-error').textContent = friendlyError(error, 'Could not sign in. Please try again.'); }
    finally { $('sign-in').disabled = false; }
  });
  $('forgot-password').addEventListener('click', async () => {
    if (!client) return; const email = $('email').value.trim();
    if (!email) { $('auth-error').textContent = 'Enter your email address first.'; $('email').focus(); return; }
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) { $('auth-error').textContent = 'Could not request a reset right now. Please contact the vault owner.'; return; }
    $('auth-error').textContent = ''; toast('If the account can receive mail, a reset link will be sent.');
  });
  $('reset-form').addEventListener('submit', async event => {
    event.preventDefault(); const password = $('new-password').value; const confirm = $('confirm-password').value;
    if (password.length < 12 || password !== confirm) { $('reset-error').textContent = 'Use at least 12 characters and make sure both passwords match.'; return; }
    const { error } = await client.auth.updateUser({ password }); if (error) { $('reset-error').textContent = 'Could not update the password. Please try again.'; return; }
    state.reset = false; $('reset-form').reset(); $('reset-view').classList.add('hidden'); $('login-view').classList.remove('hidden'); history.replaceState(null, '', location.pathname); const { data } = await client.auth.getSession(); await applySession(data.session); toast('Password saved.');
  });
  const signOut = async () => { if (!client) return; const { error } = await client.auth.signOut(); if (error) { toast('Could not sign out. Please try again.'); return; } await applySession(null); };
  $('sign-out').addEventListener('click', signOut); $('mobile-sign-out').addEventListener('click', signOut); $('reset-sign-out').addEventListener('click', signOut);
  $('nav-all').addEventListener('click', () => showPanel('documents')); $('mobile-nav-all').addEventListener('click', () => showPanel('documents')); $('nav-members').addEventListener('click', () => showPanel('members')); $('mobile-nav-members').addEventListener('click', () => showPanel('members')); $('change-password').addEventListener('click', showPasswordChange); $('mobile-change-password').addEventListener('click', showPasswordChange);
  $('member-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.admin || !state.access) return;
    const email = $('member-email').value.trim(); const password = $('member-password').value; $('member-error').textContent = '';
    if (!email || password.length < 12) { $('member-error').textContent = 'Enter an email and a temporary password of at least 12 characters.'; return; }
    $('create-member').disabled = true;
    try { const { error } = await client.functions.invoke('family-admin', { body: { email, password } }); if (error) throw error; $('member-form').reset(); toast('Family account created. Share the temporary password privately.'); }
    catch (error) { $('member-error').textContent = friendlyError(error, 'Could not create this account. Check the details and try again.'); }
    finally { $('create-member').disabled = false; }
  });
  $('open-upload').addEventListener('click', showUpload); $('empty-upload').addEventListener('click', showUpload); $('close-upload').addEventListener('click', () => $('upload-dialog').close()); $('cancel-upload').addEventListener('click', () => $('upload-dialog').close()); $('upload-form').addEventListener('submit', upload);
  $('file').addEventListener('change', () => { $('selected-file').textContent = $('file').files[0]?.name || 'Choose a file'; });
  $('search').addEventListener('input', renderDocuments); $('filter').addEventListener('change', renderDocuments);
  if (!client) { $('setup-notice').classList.remove('hidden'); $('sign-in').disabled = true; $('forgot-password').disabled = true; }
  else {
    client.auth.onAuthStateChange((event, session) => { if (event === 'PASSWORD_RECOVERY') state.reset = true; setTimeout(() => applySession(session), 0); });
    client.auth.getSession().then(({ data, error }) => { if (error) console.error('Session check failed', error); return applySession(data.session); });
  }
})();
