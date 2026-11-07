/**
 * Add / edit a cluster connection: name, address, sign-in (none, user + password, API key),
 * self-signed certificates, read-only. "Test" tries it before saving.
 * The password / key goes to the desktop side and is never shown again (leave it empty to keep it).
 */
(function () {
  const U = Sift.utils;
  const D = window.siftDesktop;

  function open(existing) {
    const c = existing || { name: '', url: 'http://localhost:9200', auth: 'none', user: '', insecureTls: false, readOnly: false };
    const field = (label, input, hint) => U.el('label', { class: 'stack-tight' }, U.el('span', { class: 'muted small', text: label }), input, hint ? U.el('span', { class: 'muted small', text: hint }) : null);
    const name = U.el('input', { class: 'field', type: 'text', value: c.name, placeholder: 'dev-cluster', spellcheck: 'false' });
    const url = U.el('input', { class: 'field mono', type: 'text', value: c.url, placeholder: 'https://localhost:9200', spellcheck: 'false' });
    const auth = U.el('select', { class: 'select' }, ...[['none', 'No sign-in'], ['basic', 'User name and password'], ['apikey', 'API key']].map(([v, l]) => U.el('option', { value: v, text: l, selected: c.auth === v })));
    const user = U.el('input', { class: 'field', type: 'text', value: c.user, placeholder: 'elastic', spellcheck: 'false', autocomplete: 'off' });
    const secret = U.el('input', { class: 'field mono', type: 'password', placeholder: c.hasSecret ? 'Saved — leave empty to keep it' : '', autocomplete: 'new-password' });
    const userRow = field('User name', user);
    const secretRow = field('Password', secret);
    const insecure = U.el('input', { type: 'checkbox', checked: !!c.insecureTls });
    const ro = U.el('input', { type: 'checkbox', checked: !!c.readOnly });
    const result = U.el('p', { class: 'small conn-test', 'aria-live': 'polite' });
    const showAuth = () => {
      userRow.hidden = auth.value !== 'basic';
      secretRow.hidden = auth.value === 'none';
      secretRow.querySelector('span').textContent = auth.value === 'apikey' ? 'API key (the base64 "encoded" value)' : 'Password';
    };
    auth.addEventListener('change', showAuth);
    showAuth();
    const values = () => ({ id: c.id, name: name.value.trim(), url: url.value.trim(), auth: auth.value, user: user.value.trim(), insecureTls: insecure.checked, readOnly: ro.checked, ...(secret.value ? { secret: secret.value } : c.id ? {} : { secret: '' }) });

    const test = U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Test', onclick: async () => {
      result.className = 'small conn-test'; result.textContent = 'Connecting…';
      try {
        const r = await D.test(values());
        result.classList.add('is-ok');
        result.textContent = `Connected to ${r.name || 'the cluster'} · ${r.distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'} ${r.version || ''} · ${Math.round(r.ms)} ms`;
        if (!name.value.trim() && r.name) name.value = r.name;
      } catch (e) { result.classList.add('is-bad'); result.textContent = Sift.conn.clean(e); }
    } });

    const body = U.el('div', { class: 'stack form' },
      field('Name', name),
      field('Address', url, 'Include the port, for example https://my-cluster.example.com:9243'),
      field('Sign-in', auth), userRow, secretRow,
      U.el('label', { class: 'check-line' }, ro, U.el('span', {}, 'Read-only', U.el('span', { class: 'muted small block', text: 'Only searches and reads are sent. Anything that would change data is blocked. Use it for production.' }))),
      U.el('label', { class: 'check-line' }, insecure, U.el('span', {}, 'Allow self-signed certificates', U.el('span', { class: 'muted small block', text: 'For local or dev clusters with their own certificate. Leave off for real servers.' }))),
      U.el('div', { class: 'row-gap' }, test, result));

    return new Promise((resolve) => {
      let pending = false;
      Sift.ui.dialog.open({
        title: existing ? 'Edit connection' : 'Add a cluster', body,
        actions: [
          ...(existing ? [{ label: 'Remove', danger: true, onClick: () => { pending = true; setTimeout(() => removeConn(existing).then((r) => resolve(r ? 'removed' : null))); return true; } }] : []),
          { label: 'Cancel' },
          { label: existing ? 'Save' : 'Add', primary: true, onClick: () => {
            if (!url.value.trim()) { url.focus(); return false; }
            pending = true;
            D.save(values()).then(async (s) => { await Sift.conn.reload(); resolve(s); }).catch((e) => { Sift.ui.dialog.alert('Couldn\'t save', Sift.conn.clean(e)); resolve(null); });
            return true;
          } },
        ],
        onClose: () => { if (!pending) resolve(null); },
      });
    });
  }

  async function removeConn(c) {
    const ok = await Sift.ui.dialog.confirm('Remove connection?', `"${c.name}" (${c.url}) and its saved sign-in are removed from this PC. Saved queries stay.`, 'Remove');
    if (!ok) return false;
    await D.remove(c.id);
    await Sift.conn.reload();
    if (Sift.conn.current == null || Sift.conn.current.id === c.id) await Sift.conn.select(Sift.conn.list[0] ? Sift.conn.list[0].id : null);
    return true;
  }

  async function add() {
    const s = await open(null);
    if (s && s.id) await Sift.conn.select(s.id);
  }
  async function edit(c) {
    const s = await open(c);
    if (s && s.id && Sift.conn.current && Sift.conn.current.id === s.id) await Sift.conn.select(s.id);
  }

  Sift.ui.connForm = { open, add, edit, remove: removeConn };
})();
