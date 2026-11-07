/**
 * Cluster: health at a glance (status, nodes, shards, unassigned, pending tasks), every node
 * (role, heap, RAM, CPU, load, disk), shards that aren't started (with the reason), and the
 * biggest indices. Refresh by hand, or every N seconds (Settings).
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  let host; let timer = 0; let token = 0;

  const pctBar = (v, warn = 75, bad = 90) => { const n = Number(v); return U.el('span', { class: 'pct' + (n >= bad ? ' is-bad' : n >= warn ? ' is-warn' : '') }, U.el('span', { class: 'pct-bar' }, U.el('span', { style: `width:${isFinite(n) ? Math.min(100, n) : 0}%` })), U.el('span', { class: 'mono small', text: isFinite(n) ? n + '%' : '—' })); };

  async function load() {
    if (!C.current) { host.replaceChildren(U.el('div', { class: 'glass res-empty muted', text: 'Add a cluster first.' })); return; }
    const mine = ++token;
    const q = (p) => C.req('GET', p, null, { timeout: 20 }).then((r) => (r.status < 400 ? r.json : null)).catch(() => null);
    const [h, nodes, shards, tasks] = await Promise.all([
      q('_cluster/health'),
      q('_cat/nodes?format=json&h=name,ip,node.role,master,heap.percent,ram.percent,cpu,load_1m,disk.used_percent,version&s=name'),
      q('_cat/shards?format=json&h=index,shard,prirep,state,unassigned.reason,node,docs,store&bytes=b'),
      q('_cluster/pending_tasks'),
    ]);
    if (mine !== token || host.hidden) return;
    const status = h ? h.status : 'unknown';
    const card = (k, v, cls) => U.el('div', { class: 'glass cl-card' + (cls ? ' ' + cls : '') }, U.el('span', { class: 'section-label', text: k }), U.el('strong', { class: 'cl-big', text: v }));
    const notStarted = (shards || []).filter((s) => s.state !== 'STARTED');
    const top = C.indices.slice().sort((a, b) => b.size - a.size).slice(0, 10);
    host.replaceChildren(...[
      U.el('div', { class: 'page-head row-gap' }, U.el('h1', { text: C.current.name }), U.el('span', { class: 'muted', text: C.info ? `${C.info.distribution} ${C.info.version || ''}` : '' }), U.el('span', { class: 'spacer' }),
        U.el('span', { class: 'muted small', text: 'Updated ' + new Date().toLocaleTimeString() }),
        U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Refresh', onclick: load })),
      U.el('div', { class: 'cl-cards' },
        card('Status', status, 'h-card h-' + status),
        card('Nodes', h ? `${h.number_of_nodes} (${h.number_of_data_nodes} data)` : '—'),
        card('Active shards', h ? `${h.active_shards.toLocaleString()} · ${h.active_primary_shards.toLocaleString()} primary` : '—'),
        card('Unassigned', h ? String(h.unassigned_shards) : '—', h && h.unassigned_shards ? 'is-warn' : ''),
        card('Relocating · initializing', h ? `${h.relocating_shards} · ${h.initializing_shards}` : '—'),
        card('Pending tasks', tasks && tasks.tasks ? String(tasks.tasks.length) : h ? String(h.number_of_pending_tasks) : '—')),
      U.el('section', { class: 'glass cl-sec' }, U.el('h3', { class: 'section-label', text: `Nodes · ${(nodes || []).length}` }),
        nodes ? U.el('div', { class: 'tbl-wrap' }, U.el('table', { class: 'tbl' },
          U.el('thead', {}, U.el('tr', {}, ...['Name', 'IP', 'Role', 'Heap', 'RAM', 'CPU', 'Load 1m', 'Disk', 'Version'].map((t) => U.el('th', { text: t })))),
          U.el('tbody', {}, ...nodes.map((n) => U.el('tr', {},
            U.el('td', {}, n.master === '*' ? U.el('span', { class: 'master', title: 'Elected master', text: '★ ' }) : null, n.name),
            U.el('td', { class: 'mono', text: n.ip }), U.el('td', { class: 'mono', text: n['node.role'] }),
            U.el('td', {}, pctBar(n['heap.percent'], 75, 90)), U.el('td', {}, pctBar(n['ram.percent'], 90, 97)), U.el('td', {}, pctBar(n.cpu, 70, 90)),
            U.el('td', { class: 'mono', text: n.load_1m || '—' }), U.el('td', {}, pctBar(n['disk.used_percent'], 80, 90)), U.el('td', { class: 'mono', text: n.version || '' })))))) : U.el('p', { class: 'muted small', text: 'Node details need the monitor privilege.' })),
      U.el('section', { class: 'glass cl-sec' }, U.el('h3', { class: 'section-label', text: `Shards not started · ${notStarted.length}` }),
        notStarted.length ? U.el('div', { class: 'tbl-wrap' }, U.el('table', { class: 'tbl' },
          U.el('thead', {}, U.el('tr', {}, ...['Index', 'Shard', 'Type', 'State', 'Reason', 'Node'].map((t) => U.el('th', { text: t })))),
          U.el('tbody', {}, ...notStarted.slice(0, 300).map((s) => U.el('tr', {}, U.el('td', { class: 'mono', text: s.index }), U.el('td', { class: 'mono', text: s.shard }), U.el('td', { text: s.prirep === 'p' ? 'primary' : 'replica' }), U.el('td', { class: s.state === 'UNASSIGNED' ? 'c-bad' : '', text: s.state }), U.el('td', { class: 'mono', text: s['unassigned.reason'] || '' }), U.el('td', { class: 'mono', text: s.node || '' })))))) : U.el('p', { class: 'muted small', text: shards ? 'Every shard is started.' : 'Shard details need the monitor privilege.' })),
      U.el('section', { class: 'glass cl-sec' }, U.el('h3', { class: 'section-label', text: 'Biggest indices' }),
        U.el('div', { class: 'tbl-wrap' }, U.el('table', { class: 'tbl' },
          U.el('thead', {}, U.el('tr', {}, ...['Index', 'Health', 'Documents', 'Size', 'Primary · replica'].map((t) => U.el('th', { text: t })))),
          U.el('tbody', {}, ...top.map((i) => U.el('tr', { tabindex: '0', onclick: () => { C.setIndex(i.index); Sift.app.go('mapping'); } }, U.el('td', { class: 'mono', text: i.index }), U.el('td', {}, Sift.fmt.dot(i.health), ' ', i.health || ''), U.el('td', { class: 'mono', text: i.docs.toLocaleString() }), U.el('td', { class: 'mono', text: U.fmtBytes(i.size) }), U.el('td', { class: 'mono', text: `${i.pri} · ${i.rep}` }))))))),
    ]);
    C.health = h || C.health; Sift.bus.emit('conn:health');
  }

  function schedule() {
    clearInterval(timer);
    const s = Number(Sift.prefs.get('clusterRefresh')) || 0;
    if (s > 0) timer = setInterval(() => { if (!host.hidden && document.hasFocus()) load(); }, s * 1000);
  }
  Sift.bus.on('prefs:change', ({ key }) => { if (key === 'clusterRefresh') schedule(); });
  Sift.bus.on('conn:change', () => { if (host && !host.hidden) load(); });
  Sift.ui.cluster = { init: (h) => { host = h; }, show() { load(); schedule(); }, hide() { clearInterval(timer); }, load };
})();
