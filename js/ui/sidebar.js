/**
 * Sidebar: the current cluster (switch / add / edit), its indices (filter, health, size, aliases;
 * click to use one, right-click for more), saved queries and every saved connection.
 * System indices (starting with ".") are hidden unless "Show system indices" is ticked.
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  let host; let filter = '';
  const folded = new Set(JSON.parse(Sift.store.get('folded', '[]')));

  const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));
  const dot = (h) => U.el('span', { class: 'hdot h-' + (h || 'none'), title: h ? `Health: ${h}` : 'Health unknown' });
  Sift.fmt = { short, dot };

  function section(id, title, count, items, extra) {
    const isFolded = folded.has(id);
    return U.el('section', { class: 'side-sec' + (isFolded ? ' is-folded' : '') },
      U.el('div', { class: 'side-sec-head' },
        U.el('button', { type: 'button', class: 'section-fold section-label', 'aria-expanded': String(!isFolded), onclick: () => { if (folded.has(id)) folded.delete(id); else folded.add(id); Sift.store.set('folded', JSON.stringify([...folded])); render(); } },
          U.el('span', { html: Sift.icon('chevron') }), title, count != null ? U.el('span', { class: 'side-count', text: count }) : null),
        extra || null),
      isFolded ? null : U.el('div', { class: 'side-list' }, ...items));
  }

  function connMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const others = C.list.filter((c) => !C.current || c.id !== C.current.id);
    Sift.ui.menu.open(r.left, r.bottom + 6, [
      ...others.map((c) => ({ label: c.name, hint: c.readOnly ? 'read-only' : new URL(c.url).host, onClick: () => C.select(c.id) })),
      ...(others.length ? [{ separator: true }] : []),
      { label: 'Add a cluster…', onClick: () => Sift.ui.connForm.add() },
      ...(C.current ? [{ label: 'Edit this connection…', onClick: () => Sift.ui.connForm.edit(C.current) }, { label: 'Refresh indices', hint: 'F5', onClick: () => C.refresh() }] : []),
    ], 'Clusters');
  }

  function indexMenu(e, i) {
    Sift.ui.menu.open(e.clientX, e.clientY, [
      { label: 'Query this index', onClick: () => { C.setIndex(i.index); Sift.ui.query.useIndex(i.index); Sift.app.go('query'); } },
      { label: 'Browse documents', onClick: () => { C.setIndex(i.index); Sift.app.go('docs'); } },
      { label: 'Mapping', onClick: () => { C.setIndex(i.index); Sift.app.go('mapping'); } },
      { label: 'Analyze text', onClick: () => { C.setIndex(i.index); Sift.app.go('analyze'); } },
      { separator: true },
      { label: 'Copy name', onClick: () => copy(i.index) },
      ...i.aliases.map((a) => ({ label: `Copy alias "${a}"`, onClick: () => copy(a) })),
    ], i.index);
  }
  function copy(t) { navigator.clipboard.writeText(t).then(() => Sift.toast('Copied ' + t), () => Sift.toast('Couldn\'t copy')); }

  function render() {
    if (!host) return;
    const nodes = [];
    const cur = C.current;
    const health = C.health && C.health.status;
    nodes.push(U.el('button', { type: 'button', class: 'conn-pick', onclick: connMenu, title: cur ? cur.url : 'Add a cluster' },
      cur ? dot(health) : U.el('span', { class: 'hdot h-none' }),
      U.el('span', { class: 'conn-pick-text' },
        U.el('strong', { text: cur ? cur.name : 'No cluster' }),
        U.el('span', { class: 'muted small', text: cur ? (C.info ? `${C.info.distribution} ${C.info.version || ''}${C.health ? ` · ${C.health.number_of_nodes} node${C.health.number_of_nodes === 1 ? '' : 's'} · ${health}` : ''}` : C.loading ? 'Connecting…' : C.error ? 'Not connected' : '') : 'Add one to start' })),
      cur && cur.readOnly ? U.el('span', { class: 'ro-badge', text: 'read-only', title: 'Only reads are sent to this cluster' }) : null,
      U.el('span', { html: Sift.icon('chevron') })));

    const scroll = U.el('div', { class: 'side-scroll' });
    if (cur) {
      const showSys = Sift.store.get('showSystem', '0') === '1';
      const all = C.indices.filter((i) => showSys || !i.index.startsWith('.'));
      const q = filter.toLowerCase();
      const shown = all.filter((i) => !q || i.index.toLowerCase().includes(q) || i.aliases.some((a) => a.toLowerCase().includes(q)));
      const items = [];
      if (C.error) items.push(U.el('p', { class: 'side-note is-bad small', text: C.error }));
      else if (C.loading && !C.indices.length) items.push(U.el('p', { class: 'side-note muted small', text: 'Reading indices…' }));
      if (all.length > 8) items.push(U.el('input', { class: 'side-filter', type: 'search', placeholder: 'Filter indices', value: filter, spellcheck: 'false', 'aria-label': 'Filter indices', oninput: (e) => { filter = e.target.value; render(); const f = host.querySelector('.side-filter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }));
      shown.slice(0, 500).forEach((i) => items.push(U.el('button', { type: 'button', class: 'idx' + (C.index === i.index ? ' is-active' : ''), title: `${i.index}\n${i.docs.toLocaleString()} documents · ${U.fmtBytes(i.size)} · ${i.pri} primary, ${i.rep} replica${i.aliases.length ? '\nAliases: ' + i.aliases.join(', ') : ''}${i.status === 'close' ? '\nClosed' : ''}`, onclick: () => { C.setIndex(i.index); }, ondblclick: () => { Sift.ui.query.useIndex(i.index); Sift.app.go('query'); }, oncontextmenu: (e) => { e.preventDefault(); indexMenu(e, i); } },
        dot(i.health),
        U.el('span', { class: 'idx-name' }, U.el('span', { class: 'idx-title', text: i.index }), i.aliases.length ? U.el('span', { class: 'idx-alias muted small', text: 'alias: ' + i.aliases.join(', ') }) : null),
        U.el('span', { class: 'idx-docs mono small', text: i.status === 'close' ? 'closed' : short(i.docs) }))));
      if (shown.length > 500) items.push(U.el('p', { class: 'side-note muted small', text: `${shown.length - 500} more — filter to find them` }));
      if (!C.loading && !C.error && !shown.length) items.push(U.el('p', { class: 'side-note muted small', text: q ? 'No index matches.' : 'No indices yet.' }));
      const sysToggle = U.el('label', { class: 'side-check small muted', title: 'Indices whose names start with a dot' }, U.el('input', { type: 'checkbox', checked: showSys, onchange: (e) => { Sift.store.set('showSystem', e.target.checked ? '1' : '0'); render(); } }), 'System');
      scroll.append(section('indices', 'Indices', all.length || null, items, sysToggle));
    }

    const saved = Sift.ui.query ? Sift.ui.query.saved() : [];
    scroll.append(section('saved', 'Saved queries', saved.length || null, saved.length ? saved.map((s) => U.el('button', { type: 'button', class: 'side-item', title: `${s.method} ${s.path}`, onclick: () => { Sift.ui.query.load(s); Sift.app.go('query'); }, oncontextmenu: (e) => { e.preventDefault(); Sift.ui.menu.open(e.clientX, e.clientY, [{ label: 'Open', onClick: () => { Sift.ui.query.load(s); Sift.app.go('query'); } }, { label: 'Rename…', onClick: () => Sift.ui.query.renameSaved(s.id) }, { separator: true }, { label: 'Delete', danger: true, onClick: () => Sift.ui.query.deleteSaved(s.id) }], s.name); } },
      U.el('span', { class: 'side-method mono', text: s.method }), U.el('span', { class: 'side-label', text: s.name }))) : [U.el('p', { class: 'side-note muted small', text: 'Ctrl+S in the query editor saves one here.' })]));

    scroll.append(section('conns', 'Connections', C.list.length || null, [
      ...C.list.map((c) => U.el('button', { type: 'button', class: 'side-item' + (cur && cur.id === c.id ? ' is-active' : ''), title: c.url, onclick: () => { if (!cur || cur.id !== c.id) C.select(c.id); }, oncontextmenu: (e) => { e.preventDefault(); Sift.ui.menu.open(e.clientX, e.clientY, [{ label: 'Edit…', onClick: () => Sift.ui.connForm.edit(c) }, { label: 'Copy address', onClick: () => copy(c.url) }, { separator: true }, { label: 'Remove…', danger: true, onClick: () => Sift.ui.connForm.remove(c) }], c.name); } },
        U.el('span', { class: 'side-label', text: c.name }), c.readOnly ? U.el('span', { class: 'ro-badge', text: 'read-only' }) : null)),
      U.el('button', { type: 'button', class: 'side-item side-add', onclick: () => Sift.ui.connForm.add() }, U.el('span', { html: Sift.icon('plus') }), U.el('span', { class: 'side-label', text: 'Add a cluster' })),
    ]));
    nodes.push(scroll);
    nodes.push(U.el('div', { class: 'side-foot' }, U.el('button', { type: 'button', class: 'side-item' + (Sift.app && Sift.app.view() === 'settings' ? ' is-active' : ''), onclick: () => Sift.app.go('settings') }, U.el('span', { html: Sift.icon('settings') }), U.el('span', { class: 'side-label', text: 'Settings' }))));
    const keep = host.querySelector('.side-scroll');
    const top = keep ? keep.scrollTop : 0;
    host.replaceChildren(...nodes);
    const sc = host.querySelector('.side-scroll');
    if (sc) sc.scrollTop = top;
  }

  ['conn:list', 'conn:change', 'conn:indices', 'conn:index', 'conn:health', 'saved:change', 'view:change'].forEach((ev) => Sift.bus.on(ev, render));
  Sift.ui.sidebar = { init: (h) => { host = h; render(); }, render };
})();
