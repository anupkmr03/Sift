/**
 * Query: method + path + JSON body on the left, the response on the right.
 *
 *   Run (Ctrl+Enter) · Stop · Format (Ctrl+Shift+F) · Profile / Explain (added to this run only)
 *   Copy as curl (sign-in masked) · History (every run, with status and time) · Save (Ctrl+S) to the sidebar
 *   Click a bar in Aggs to filter by that bucket (adds a term filter and runs again).
 * Requests that change data ask first (Settings), and read-only connections block them.
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  const J = Sift.json;
  const P = Sift.prefs;
  const D = window.siftDesktop;

  let host; let ed; let methodSel; let pathIn; let resHost; let runBtn; let profBtn; let explBtn; let built = false;
  let running = null;  // reqId
  let last = null;
  const flags = { profile: false, explain: false };

  const DEFAULT = { method: 'GET', path: '_search', body: '{\n  "query": {\n    "match_all": {}\n  },\n  "size": 20\n}' };
  function loadReq() { try { return { ...DEFAULT, ...JSON.parse(Sift.store.get('req', '{}')) }; } catch (e) { return { ...DEFAULT }; } }
  const saveReq = U.debounce(() => { if (built) Sift.store.set('req', JSON.stringify({ method: methodSel.value, path: pathIn.value, body: ed.get() })); }, 300);

  // ---------------- saved queries and history (localStorage)
  const readList = (k) => { try { const v = JSON.parse(Sift.store.get(k, '[]')); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saved = () => readList('saved');
  function writeSaved(list) { Sift.store.set('saved', JSON.stringify(list)); Sift.bus.emit('saved:change'); }
  function history() { return readList('history'); }
  function addHistory(entry) { const h = [entry, ...history()].slice(0, Number(P.get('historySize')) || 200); Sift.store.set('history', JSON.stringify(h)); }

  async function saveCurrent() {
    const name = await Sift.ui.dialog.prompt('Save query', { label: 'Name', value: guessName(), okLabel: 'Save' });
    if (!name) return;
    const list = saved();
    const same = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const item = { id: same ? same.id : Date.now().toString(36), name, method: methodSel.value, path: pathIn.value, body: ed.get(), t: Date.now() };
    writeSaved(same ? list.map((s) => (s.id === same.id ? item : s)) : [item, ...list]);
    Sift.toast(same ? `Updated "${name}"` : `Saved "${name}"`);
  }
  function guessName() {
    const r = J.parse(ed.get());
    const q = r.ok && r.value && r.value.query;
    const k = q && Object.keys(q)[0];
    return `${pathIn.value.split('/')[0] || 'all'} · ${k || methodSel.value}`;
  }
  async function renameSaved(id) {
    const s = saved().find((x) => x.id === id); if (!s) return;
    const name = await Sift.ui.dialog.prompt('Rename', { label: 'Name', value: s.name, okLabel: 'Rename' });
    if (name) writeSaved(saved().map((x) => (x.id === id ? { ...x, name } : x)));
  }
  function deleteSaved(id) {
    const before = saved();
    const s = before.find((x) => x.id === id);
    writeSaved(before.filter((x) => x.id !== id));
    Sift.toast(`Deleted "${s ? s.name : 'query'}"`, 5000, { action: { label: 'Undo', onClick: () => writeSaved(before) } });
  }
  function load(s) {
    ensure();
    methodSel.value = s.method || 'GET';
    pathIn.value = s.path || '';
    ed.set(s.body || '');
    saveReq();
  }

  // ---------------- index in the path
  function useIndex(name) {
    ensure();
    const p = pathIn.value.trim();
    const m = /^([^_/][^/]*)?(\/.*)?$/.exec(p);
    const rest = p.startsWith('_') ? '/' + p : m && m[2] ? m[2] : '/_search';
    pathIn.value = name + rest;
    saveReq();
  }
  /** The index (or pattern / alias) the path points at, for suggestions. */
  function pathIndex() {
    const p = pathIn.value.trim().replace(/^\/+/, '');
    if (!p || p.startsWith('_')) return C.index;
    return p.split('/')[0].split('?')[0];
  }

  // ---------------- run
  function bodyFor(run) {
    const raw = ed.get();
    const nd = J.isNd(pathIn.value);
    if (nd) { const c = J.parseNd(raw); if (!c.ok) throw new Error(`Line ${c.line}: ${c.error}`); return raw.endsWith('\n') ? raw : raw + '\n'; }
    const r = J.parse(raw);
    if (!r.ok) throw new Error(`Line ${r.line}${r.col ? ', column ' + r.col : ''}: ${r.error}`);
    if (r.empty) return null;
    if (run && /_search(\/|\?|$)/.test(pathIn.value) && r.value && typeof r.value === 'object' && !Array.isArray(r.value)) {
      const v = { ...r.value };
      if (flags.profile) v.profile = true;
      if (flags.explain) v.explain = true;
      return v;
    }
    return r.value;
  }

  async function run() {
    ensure();
    if (running) return;
    const method = methodSel.value;
    const path = pathIn.value.trim();
    let body;
    try { body = bodyFor(true); } catch (e) { Sift.results.error(resHost, 'The body isn\'t valid JSON. ' + e.message); ed.focus(); return; }
    if (!C.current) { Sift.ui.connForm.add(); return; }
    const isRead = await D.isRead(method, path.replace(/^\/+/, ''));
    if (!isRead && !C.current.readOnly && P.get('confirmWrites')) {
      const ok = await Sift.ui.dialog.confirm('This changes data', `${method} /${path.replace(/^\/+/, '')}\non ${C.current.name} (${C.current.url})\n\nRun it?`, `Run ${method}`);
      if (!ok) return;
    }
    const conn = C.current;
    setRunning(true);
    resHost.classList.add('is-busy');
    try {
      const res = await C.req(method, path, body, { onStart: (id) => { running = id; } });
      last = res;
      const j = res.json || {};
      const hits = j.hits && j.hits.total != null ? (typeof j.hits.total === 'number' ? j.hits.total : j.hits.total.value) : null;
      addHistory({ t: Date.now(), conn: conn.name, connId: conn.id, method, path, body: ed.get(), status: res.status, ms: res.ms, hits });
      Sift.ui.results.render(resHost, res, { onBucket, prefer: flags.profile && j.profile ? 'profile' : null });
      if (!isRead) C.refresh();
    } catch (e) {
      Sift.results.error(resHost, C.clean(e));
    } finally { setRunning(false); resHost.classList.remove('is-busy'); }
  }
  function setRunning(on) {
    if (!on) running = null;
    runBtn.textContent = on ? '■ Stop' : '▶ Run';
    runBtn.title = on ? 'Stop this request' : 'Run (Ctrl+Enter)';
    runBtn.classList.toggle('is-stop', on);
  }
  function stop() { if (running) C.cancel(running); }

  /** Clicking an aggregation bucket: add a term filter for it and run again. */
  function onBucket(aggName, key) {
    const r = J.parse(ed.get());
    if (!r.ok || !r.value) return;
    const v = r.value;
    const agg = (v.aggs || v.aggregations || {})[aggName];
    const field = agg && (agg.terms || agg.significant_terms || {}).field;
    if (!field) { Sift.toast('Filtering works for terms aggregations.'); return; }
    const q = v.query || { match_all: {} };
    const bool = q.bool ? { ...q.bool } : { must: [q] };
    const filt = Array.isArray(bool.filter) ? bool.filter.slice() : bool.filter ? [bool.filter] : [];
    filt.push({ term: { [field]: key } });
    bool.filter = filt;
    v.query = { bool };
    ed.set(J.pretty(v, Number(P.get('tabSize')) || 2));
    saveReq();
    Sift.toast(`Filtered to ${field} = ${key}`);
    run();
  }

  function curl() {
    const c = C.current; if (!c) return;
    let body = '';
    try { const b = bodyFor(false); body = b == null ? '' : typeof b === 'string' ? b : JSON.stringify(b, null, 2); } catch (e) { body = ed.get(); }
    const url = c.url + '/' + pathIn.value.trim().replace(/^\/+/, '');
    const parts = [`curl -X ${methodSel.value} "${url}"`];
    if (c.auth === 'basic') parts.push(`-u '${c.user}:PASSWORD'`);
    if (c.auth === 'apikey') parts.push(`-H 'Authorization: ApiKey YOUR_API_KEY'`);
    if (c.insecureTls) parts.push('-k');
    if (body) { parts.push(`-H 'Content-Type: application/${J.isNd(pathIn.value) ? 'x-ndjson' : 'json'}'`); parts.push(`-d '${body.replace(/'/g, "'\\''")}'`); }
    navigator.clipboard.writeText(parts.join(' \\\n  ')).then(() => Sift.toast('Copied as curl (password / key left out)'), () => Sift.toast('Couldn\'t copy'));
  }

  function showHistory() {
    const list = history();
    const q = U.el('input', { class: 'field', type: 'search', placeholder: 'Filter by path, body or cluster', spellcheck: 'false' });
    const box = U.el('div', { class: 'hist-list' });
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      const rows = list.filter((h) => !s || `${h.method} ${h.path} ${h.conn} ${h.body}`.toLowerCase().includes(s)).slice(0, 300);
      box.replaceChildren(...(rows.length ? rows.map((h) => U.el('button', { type: 'button', class: 'hist-row', onclick: () => { load(h); Sift.ui.dialog.close(); } },
        U.el('span', { class: 'st-code small ' + (h.status < 300 ? 'is-ok' : h.status < 500 ? 'is-warn' : 'is-bad'), text: String(h.status) }),
        U.el('span', { class: 'mono small hist-req', text: `${h.method} ${h.path}` }),
        U.el('span', { class: 'muted small', text: [h.hits != null ? `${h.hits.toLocaleString()} hits` : null, `${Math.round(h.ms)} ms`, h.conn, U.timeAgo(h.t)].filter(Boolean).join(' · ') }))) : [U.el('p', { class: 'muted', text: list.length ? 'Nothing matches.' : 'Nothing run yet.' })]));
    };
    q.addEventListener('input', paint);
    paint();
    Sift.ui.dialog.open({ title: `History · ${list.length}`, wide: true, body: U.el('div', { class: 'stack' }, q, box), actions: [
      { label: 'Clear history', danger: true, onClick: () => { Sift.store.set('history', '[]'); Sift.toast('History cleared'); } },
      { label: 'Close', primary: true },
    ] });
  }

  // ---------------- layout
  const ENDPOINTS = ['_search', '_count', '_mapping', '_settings', '_stats', '_analyze', '_explain/', '_validate/query?explain=true', '_doc/', '_msearch', '_bulk', '_cat/indices?v', '_cat/shards?v', '_cat/nodes?v', '_cat/aliases?v', '_cluster/health', '_cluster/settings', '_nodes/stats', '_tasks', '_alias'];
  function build() {
    const r = loadReq();
    methodSel = U.el('select', { class: 'select method-sel mono', 'aria-label': 'Method', onchange: saveReq }, ...['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].map((m) => U.el('option', { value: m, text: m, selected: r.method === m })));
    pathIn = U.el('input', { class: 'field mono path-in', type: 'text', value: r.path, list: 'qPaths', spellcheck: 'false', 'aria-label': 'Path', placeholder: 'my-index/_search', oninput: () => { saveReq(); if (ed) ed.check(); }, onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } } });
    const dl = U.el('datalist', { id: 'qPaths' });
    runBtn = U.el('button', { type: 'button', class: 'btn btn-primary btn-sm run-btn', text: '▶ Run', title: 'Run (Ctrl+Enter)', onclick: () => (running ? stop() : run()) });
    const toggle = (key, label, title) => { const b = U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false', text: label, title, onclick: () => { flags[key] = !flags[key]; b.setAttribute('aria-pressed', String(flags[key])); } }); return b; };
    profBtn = toggle('profile', 'Profile', 'Add "profile": true to this search: shows where the time goes');
    explBtn = toggle('explain', 'Explain', 'Add "explain": true: each hit tells why it scored what it did');
    const bar = U.el('div', { class: 'glass q-bar' },
      U.el('div', { class: 'q-req' }, methodSel, pathIn), dl,
      profBtn, explBtn,
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy as curl', onclick: curl }),
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'History', onclick: showHistory }),
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Save', title: 'Save to the sidebar (Ctrl+S)', onclick: saveCurrent }),
      runBtn);
    const edHost = U.el('div', { class: 'q-ed-host' });
    const edWrap = U.el('section', { class: 'glass q-ed', 'aria-label': 'Request body' },
      U.el('div', { class: 'pane-head small' }, U.el('strong', { text: 'Body' }), U.el('span', { class: 'muted', text: '· Query DSL' }), U.el('span', { class: 'spacer' }),
        U.el('button', { type: 'button', class: 'link-btn small', text: 'Format', title: 'Ctrl+Shift+F', onclick: () => ed.format() }),
        U.el('button', { type: 'button', class: 'link-btn small', text: 'Clear', onclick: () => { ed.set(''); saveReq(); ed.focus(); } })),
      edHost);
    resHost = U.el('section', { class: 'glass q-res', 'aria-label': 'Response' });
    const split = U.el('div', { class: 'resizer resizer-v', title: 'Drag to resize' });
    const grid = U.el('div', { class: 'q-split' }, edWrap, split, resHost);
    grid.style.setProperty('--q-left', (Number(P.get('splitQuery')) || 0.42) * 100 + '%');
    host.replaceChildren(U.el('div', { class: 'q-wrap' }, bar, grid));
    ed = Sift.ui.editor.create(edHost, { value: r.body, onRun: run, onChange: saveReq, fields: () => C.fields(pathIndex()), nd: () => J.isNd(pathIn.value) });
    Sift.ui.results.render(resHost, null);
    split.addEventListener('pointerdown', (e) => {
      const rect = grid.getBoundingClientRect();
      split.setPointerCapture(e.pointerId);
      const move = (ev) => { const f = U.clamp((ev.clientX - rect.left) / rect.width, 0.22, 0.75); grid.style.setProperty('--q-left', f * 100 + '%'); };
      const up = (ev) => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); P.set('splitQuery', U.clamp((ev.clientX - rect.left) / rect.width, 0.22, 0.75)); };
      split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
    });
    fillPaths();
    built = true;
  }
  function fillPaths() {
    const dl = host.querySelector('#qPaths');
    if (!dl) return;
    const idx = C.indices.filter((i) => !i.index.startsWith('.')).slice(0, 200);
    const al = [...new Set(C.aliases.map((a) => a.alias))].slice(0, 100);
    dl.replaceChildren(...[...ENDPOINTS, ...[...al, ...idx.map((i) => i.index)].flatMap((n) => [n + '/_search', n + '/_count', n + '/_mapping'])].map((v) => U.el('option', { value: v })));
  }
  function ensure() { if (!built) build(); }

  Sift.bus.on('conn:indices', () => { if (built) fillPaths(); });
  Sift.bus.on('conn:index', (name) => {
    if (!built || !name) return;
    const p = pathIn.value.trim();
    if (!p || p.startsWith('_search') || /^[^_/][^/]*\/_(search|count)\b/.test(p)) useIndex(name);
  });

  Sift.ui.query = {
    init: (h) => { host = h; },
    show() { ensure(); requestAnimationFrame(() => ed.focus()); },
    hide() {},
    run, stop, saved, saveCurrent, renameSaved, deleteSaved, load, useIndex, curl, showHistory,
    editor: () => (ensure(), ed),
    request: () => { ensure(); return { method: methodSel.value, path: pathIn.value.trim(), body: ed.get() }; },
    last: () => last,
  };

  /** Shared: an error in a results pane. */
  Sift.results = {
    error(h, text) {
      h.replaceChildren(U.el('div', { class: 'res-bar small' }, U.el('span', { class: 'st-code is-bad', text: 'Error' }), U.el('span', { class: 'spacer' })), U.el('div', { class: 'res-error', text }));
    },
  };
})();
