/**
 * Mapping: every field of the index (objects indented, multi-fields like title.keyword under
 * their parent) with its type and analyzer, a count per type (click to show only that type),
 * a filter, and the index's key settings (shards, replicas, refresh, custom analyzers).
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  let host; let built = false; let idxSel; let qIn; let listHost; let infoHost; let fields = []; let typeFilter = null; let token = 0;

  function build() {
    idxSel = U.el('select', { class: 'select', 'aria-label': 'Index', onchange: () => C.setIndex(idxSel.value) });
    qIn = U.el('input', { class: 'field mono', type: 'search', placeholder: 'Find a field', spellcheck: 'false', 'aria-label': 'Find a field', oninput: paint });
    listHost = U.el('div', { class: 'map-list' });
    infoHost = U.el('aside', { class: 'glass map-info', 'aria-label': 'Index settings' });
    host.replaceChildren(U.el('div', { class: 'q-wrap' },
      U.el('div', { class: 'glass q-bar' }, idxSel, U.el('div', { class: 'd-q' }, qIn)),
      U.el('div', { class: 'map-split' }, U.el('section', { class: 'glass map-main', 'aria-label': 'Fields' }, listHost), infoHost)));
    built = true;
  }

  function fillIndices() {
    const list = C.indices.filter((i) => !i.index.startsWith('.') || i.index === C.index);
    idxSel.replaceChildren(...list.map((i) => U.el('option', { value: i.index, text: i.index, selected: i.index === C.index })));
    if (!C.index && list[0]) idxSel.value = list[0].index;
  }

  const TYPE_CLASS = (t) => (/text|match_only/.test(t) ? 't-text' : /keyword|wildcard|constant/.test(t) ? 't-kw' : /long|integer|short|byte|double|float|scaled|unsigned/.test(t) ? 't-num' : /date/.test(t) ? 't-date' : /bool/.test(t) ? 't-bool' : /nested|object|flattened/.test(t) ? 't-obj' : /vector/.test(t) ? 't-vec' : 't-other');

  function paint() {
    const q = qIn.value.trim().toLowerCase();
    const counts = new Map();
    fields.forEach((f) => { if (!f.sub && !f.container) counts.set(f.type, (counts.get(f.type) || 0) + 1); });
    const chips = U.el('div', { class: 'map-types' }, U.el('span', { class: 'muted small', text: `${fields.filter((f) => !f.sub && !f.container).length} fields` }),
      ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => U.el('button', { type: 'button', class: 'type-chip ' + TYPE_CLASS(t) + (typeFilter === t ? ' is-on' : ''), 'aria-pressed': String(typeFilter === t), text: `${t} ${n}`, onclick: () => { typeFilter = typeFilter === t ? null : t; paint(); } })));
    const shown = fields.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!typeFilter || f.type === typeFilter));
    const rows = shown.slice(0, 3000).map((f) => {
      const depth = f.path.split('.').length - 1;
      const name = f.path.split('.').pop();
      return U.el('div', { class: 'map-row' + (f.sub ? ' is-sub' : ''), style: `--d:${depth}`, title: f.path },
        U.el('span', { class: 'map-name mono' }, depth ? U.el('span', { class: 'muted', text: f.path.slice(0, f.path.length - name.length) }) : null, name),
        U.el('span', { class: 'type-chip ' + TYPE_CLASS(f.type), text: f.type }),
        f.analyzer ? U.el('span', { class: 'muted small', text: 'analyzer: ' + f.analyzer }) : U.el('span'),
        U.el('button', { type: 'button', class: 'link-btn small map-copy', text: 'Copy', onclick: () => navigator.clipboard.writeText(f.path).then(() => Sift.toast('Copied ' + f.path)) }));
    });
    listHost.replaceChildren(chips, ...(rows.length ? rows : [U.el('p', { class: 'muted res-note', text: fields.length ? 'No field matches.' : 'This index has no mapped fields yet.' })]));
  }

  async function settings(index) {
    infoHost.replaceChildren(U.el('p', { class: 'muted small', text: 'Reading settings…' }));
    try {
      const r = await C.req('GET', encodeURIComponent(index) + '/_settings?flat_settings=false', null);
      const s = r.json && Object.values(r.json)[0] && Object.values(r.json)[0].settings && Object.values(r.json)[0].settings.index;
      if (!s) { infoHost.replaceChildren(U.el('p', { class: 'muted small', text: Sift.conn.esError(r) || 'No settings.' })); return; }
      const i = C.indices.find((x) => x.index === index);
      const kv = (k, v) => (v == null ? null : U.el('div', { class: 'kv small' }, U.el('span', { class: 'muted', text: k }), U.el('span', { class: 'mono', text: String(v) })));
      const an = s.analysis && s.analysis.analyzer ? Object.entries(s.analysis.analyzer) : [];
      infoHost.replaceChildren(...[
        U.el('h3', { class: 'section-label', text: 'Index' }),
        i ? kv('Documents', i.docs.toLocaleString()) : null, i ? kv('Size', U.fmtBytes(i.size)) : null, i ? kv('Health', i.health) : null,
        kv('Shards', s.number_of_shards), kv('Replicas', s.number_of_replicas), kv('Refresh', s.refresh_interval || '1s (default)'),
        s.creation_date ? kv('Created', new Date(Number(s.creation_date)).toLocaleString()) : null,
        kv('UUID', s.uuid),
        i && i.aliases.length ? kv('Aliases', i.aliases.join(', ')) : null,
        an.length ? U.el('h3', { class: 'section-label', text: `Custom analyzers · ${an.length}` }) : null,
        ...an.map(([n, a]) => U.el('div', { class: 'kv small' }, U.el('span', { class: 'mono', text: n }), U.el('span', { class: 'muted', text: [a.tokenizer, ...(a.filter || [])].filter(Boolean).join(' → ') }))),
      ].filter(Boolean));
    } catch (e) { infoHost.replaceChildren(U.el('p', { class: 'muted small', text: C.clean(e) })); }
  }

  async function show() {
    if (!built) build();
    fillIndices();
    const index = idxSel.value;
    if (!index) { listHost.replaceChildren(U.el('p', { class: 'muted res-note', text: C.current ? 'Pick an index.' : 'Add a cluster first.' })); infoHost.replaceChildren(); return; }
    const mine = ++token;
    listHost.replaceChildren(U.el('p', { class: 'muted res-note', text: 'Reading the mapping…' }));
    try { const f = await C.fields(index); if (mine !== token) return; fields = f; typeFilter = null; paint(); } catch (e) { listHost.replaceChildren(U.el('p', { class: 'res-error', text: C.clean(e) })); }
    settings(index);
  }

  Sift.bus.on('conn:index', () => { if (built && !host.hidden) show(); });
  Sift.ui.mapping = { init: (h) => { host = h; }, show, hide() {} };
})();
