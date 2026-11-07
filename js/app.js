/**
 * App shell: the tabs (Query, Documents, Mapping, Analyze, Compare A/B, Cluster), Settings,
 * the welcome screen when no cluster is saved yet, keyboard shortcuts, start-up.
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  const D = window.siftDesktop;
  const TABS = [['query', 'Query'], ['docs', 'Documents'], ['mapping', 'Mapping'], ['analyze', 'Analyze'], ['compare', 'Compare A/B'], ['cluster', 'Cluster']];
  const views = {};
  let current = null;

  function go(id) {
    if (!C.list.length && id !== 'settings') id = 'welcome';
    if (current === id) { if (views[id] && id !== 'query') views[id].show(); return; }
    if (current && views[current]) { views[current].hide(); U.$('#view-' + current).hidden = true; }
    current = id;
    U.$('#view-' + id).hidden = false;
    views[id].show();
    if (TABS.some(([t]) => t === id)) Sift.store.set('view', id);
    paintTabs();
    Sift.bus.emit('view:change', id);
  }

  function paintTabs() {
    const bar = U.$('#tabs');
    bar.hidden = !C.list.length;
    bar.replaceChildren(...TABS.map(([id, label], i) => U.el('button', { type: 'button', role: 'tab', class: 'tab' + (current === id ? ' is-on' : ''), 'aria-selected': String(current === id), title: `${label} (Ctrl+${i + 1})`, text: label, onclick: () => go(id) })),
      U.el('span', { class: 'spacer' }),
      C.current ? U.el('span', { class: 'tabs-idx muted small' }, 'Index: ', U.el('strong', { class: 'mono', text: C.index || 'none picked' })) : null);
  }

  function welcome() {
    const host = U.$('#view-welcome');
    host.replaceChildren(U.el('div', { class: 'welcome' },
      U.el('div', { class: 'glass welcome-card' },
        U.el('h1', { text: 'Sift' }),
        U.el('p', { class: 'muted', text: 'A workbench for Elasticsearch and OpenSearch: write queries with suggestions from your mappings, browse documents, check analyzers and cluster health, and compare two clusters side by side.' }),
        U.el('div', { class: 'row-gap' },
          U.el('button', { type: 'button', class: 'btn btn-primary', text: 'Add a cluster', onclick: () => Sift.ui.connForm.add() }),
          U.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Try localhost:9200', onclick: async () => {
            try { const s = await D.save({ name: 'localhost', url: 'http://localhost:9200', auth: 'none' }); await C.reload(); await C.select(s.id); } catch (e) { Sift.ui.dialog.alert('Couldn\'t add it', C.clean(e)); }
          } })),
        U.el('p', { class: 'muted small', text: 'Passwords and API keys stay encrypted on this PC. Mark production clusters read-only and Sift will only ever read from them.' }))));
  }

  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); }
  function onKey(e) {
    if (Sift.ui.dialog.isOpen()) return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const run = (fn) => { e.preventDefault(); fn(); };
    if (ctrl && k === ',') return run(() => go('settings'));
    if (ctrl && k === 'b') return run(() => document.documentElement.classList.toggle('side-hidden'));
    if (k === 'f5') return run(() => C.refresh().then(() => Sift.toast('Refreshed', 1200)));
    if (!C.list.length) return;
    if (ctrl && !e.shiftKey && /^[1-6]$/.test(k)) return run(() => go(TABS[Number(k) - 1][0]));
    if (ctrl && k === 's' && current === 'query') return run(() => Sift.ui.query.saveCurrent());
    if (ctrl && k === 'h') return run(() => Sift.ui.query.showHistory());
    if (ctrl && k === 'enter' && current === 'query' && !typing(e)) return run(() => Sift.ui.query.run());
    if (ctrl && k === 'enter' && current === 'compare') return run(() => Sift.ui.compare.run());
  }

  async function start() {
    if (!D) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Sift runs as a desktop app.</p>'; return; }
    document.documentElement.classList.add('has-titlebar');
    views.welcome = { show: welcome, hide() {} };
    ['query', 'docs', 'mapping', 'analyze', 'compare', 'cluster', 'settings'].forEach((id) => { views[id] = Sift.ui[id]; views[id].init(U.$('#view-' + id)); });
    Sift.ui.sidebar.init(U.$('#sidebar'));
    Sift.ui.status.init(U.$('#status'));
    document.addEventListener('keydown', onKey);
    Sift.bus.on('conn:list', () => { paintTabs(); if (!C.list.length) go('welcome'); else if (current === 'welcome') go(Sift.store.get('view', 'query')); });
    Sift.bus.on('conn:change', (c) => { U.$('#titleConn').textContent = c ? '· ' + c.name : ''; paintTabs(); });
    Sift.bus.on('conn:index', paintTabs);
    await C.start();
    go(C.list.length ? Sift.store.get('view', 'query') : 'welcome');
  }

  Sift.app = { go, view: () => current, start };
  start();
})();
