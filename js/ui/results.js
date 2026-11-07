/**
 * Shows one response: a summary line (status, hits, took, shards, round trip, size), then
 *   Table    hits as rows (_score, _id, chosen _source fields, the highlighted match); click a row for the document
 *   JSON     the whole response, coloured (plain text when it's huge)
 *   Aggs     bucket aggregations as bars (click a bar to filter by it), metrics as numbers
 *   Profile  where the time went, per shard (when the search had "profile": true)
 * A hit's "_explanation" (search with "explain": true) shows as a tree in the document drawer.
 *
 *   Sift.ui.results.render(host, response, { onBucket(aggName, key), label })
 */
(function () {
  const U = Sift.utils;
  const J = Sift.json;
  const CFG = Sift.config;

  let state = null;   // { host, res, opts, tab, cols }

  const total = (h) => (h && h.total != null ? (typeof h.total === 'number' ? { value: h.total, relation: 'eq' } : h.total) : null);
  const esc = J.esc;
  /** Highlight fragments come with <em> tags from the server; escape everything, then turn only those into marks. */
  const frag = (s) => esc(String(s)).replace(/&lt;(\/?)em&gt;/g, (_, c) => (c ? '</mark>' : '<mark>'));

  function flat(obj, prefix, out, depth) {
    Object.entries(obj || {}).forEach(([k, v]) => {
      const p = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flat(v, p, out, depth + 1);
      else out[p] = v;
    });
    return out;
  }
  const cell = (v) => (v == null ? '' : Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

  function summary(res) {
    const j = res.json || {};
    const h = total(j.hits);
    const sh = j._shards;
    const bits = [
      U.el('span', { class: 'st-code ' + (res.status < 300 ? 'is-ok' : res.status < 500 ? 'is-warn' : 'is-bad'), text: String(res.status) }),
      h ? U.el('span', {}, U.el('strong', { text: h.value.toLocaleString() + (h.relation === 'gte' ? '+' : '') }), ` hit${h.value === 1 ? '' : 's'}`) : j.count != null ? U.el('span', {}, U.el('strong', { text: j.count.toLocaleString() }), ' documents') : null,
      j.took != null ? U.el('span', { class: 'muted', text: `took ${j.took} ms`, title: `Server time ${j.took} ms · round trip ${Math.round(res.ms)} ms · ${U.fmtBytes(res.size)}` }) : U.el('span', { class: 'muted', text: `${Math.round(res.ms)} ms · ${U.fmtBytes(res.size)}` }),
      sh ? U.el('span', { class: sh.failed ? 'c-bad' : 'muted', text: `${sh.successful} / ${sh.total} shards${sh.failed ? ` · ${sh.failed} failed` : ''}` }) : null,
      j.timed_out ? U.el('span', { class: 'c-bad', text: 'timed out' }) : null,
      res.truncated ? U.el('span', { class: 'c-bad', text: 'response cut at 64 MB' }) : null,
    ];
    return bits;
  }

  function tabsFor(res) {
    const j = res.json || {};
    const t = [];
    if (j.hits && Array.isArray(j.hits.hits)) t.push(['table', 'Table']);
    t.push(['json', 'JSON']);
    if (j.aggregations) t.push(['aggs', 'Aggs']);
    if (j.profile) t.push(['profile', 'Profile']);
    return t;
  }

  function render(host, res, opts = {}) {
    const keepTab = state && state.host === host ? state.tab : null;
    state = { host, res, opts, tab: null, cols: null };
    if (!res) { host.replaceChildren(U.el('div', { class: 'res-empty muted' }, U.el('p', { text: opts.empty || 'Run a request (Ctrl+Enter) to see the response here.' }))); return; }
    const tabs = tabsFor(res);
    state.tab = tabs.some(([k]) => k === keepTab) ? keepTab : (res.json && res.json.error) ? 'json' : tabs[0][0];
    if (opts.prefer && tabs.some(([k]) => k === opts.prefer)) state.tab = opts.prefer;
    draw();
  }

  function draw() {
    const { host, res } = state;
    const tabs = tabsFor(res);
    const err = Sift.conn.esError(res);
    const seg = U.el('div', { class: 'segmented seg-xs', role: 'tablist', 'aria-label': 'Result view' }, ...tabs.map(([k, l]) => U.el('button', { type: 'button', class: 'seg-btn seg-text', role: 'tab', 'aria-selected': String(state.tab === k), 'aria-pressed': String(state.tab === k), text: l, onclick: () => { state.tab = k; draw(); } })));
    const tools = U.el('span', { class: 'row-gap' },
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-xs', text: 'Copy', title: 'Copy the response as JSON', onclick: () => copy(res.json ? J.pretty(res.json) : res.text || '') }),
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-xs', text: 'Save…', title: 'Save the response, or the hits as CSV', onclick: saveMenu }));
    const bar = U.el('div', { class: 'res-bar small' }, ...summary(res), U.el('span', { class: 'spacer' }), seg, tools);
    const body = U.el('div', { class: 'res-body' });
    host.replaceChildren(...[bar, err ? U.el('div', { class: 'res-error small', text: err }) : null, body].filter(Boolean));
    if (state.tab === 'table') table(body);
    else if (state.tab === 'aggs') aggs(body);
    else if (state.tab === 'profile') profile(body);
    else json(body, res);
  }

  function copy(t) { navigator.clipboard.writeText(t).then(() => Sift.toast('Copied'), () => Sift.toast('Couldn\'t copy')); }

  function saveMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const j = state.res.json;
    const hits = j && j.hits && j.hits.hits;
    Sift.ui.menu.open(r.left, r.bottom + 4, [
      { label: 'Response as JSON…', onClick: () => window.siftDesktop.saveFile('response.json', j ? J.pretty(j) : state.res.text || '').then((p) => p && Sift.toast('Saved', 3000, { action: { label: 'Show', onClick: () => window.siftDesktop.showFile(p) } })) },
      ...(hits && hits.length ? [{ label: `Hits as CSV (${hits.length})…`, onClick: () => window.siftDesktop.saveFile('hits.csv', csv(hits)).then((p) => p && Sift.toast('Saved', 3000, { action: { label: 'Show', onClick: () => window.siftDesktop.showFile(p) } })) }] : []),
    ], 'Save');
  }
  function csv(hits) {
    const rows = hits.map((h) => ({ _index: h._index, _id: h._id, _score: h._score, ...flat(h._source, '', {}, 0) }));
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const q = (v) => { const s = cell(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
  }

  // ---------------- JSON
  function json(body, res) {
    const text = res.json ? J.pretty(res.json) : res.text || '';
    const pre = U.el('pre', { class: 'json-view' });
    if (text.length > CFG.JSON_HIGHLIGHT_MAX) pre.textContent = text; else pre.innerHTML = J.html(text);
    body.append(pre);
  }

  // ---------------- table
  function columns(hits) {
    if (state.cols) return state.cols;
    const counts = new Map();
    hits.slice(0, 50).forEach((h) => Object.keys(flat(h._source, '', {}, 0)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
    const order = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const saved = (() => { try { return JSON.parse(Sift.store.get('cols:' + (hits[0] && hits[0]._index), 'null')); } catch (e) { return null; } })();
    state.allCols = order;
    state.cols = saved && saved.every((c) => order.includes(c)) && saved.length ? saved : order.slice(0, Number(Sift.prefs.get('tableCols')) || 6);
    return state.cols;
  }
  function table(body) {
    const hits = state.res.json.hits.hits;
    if (!hits.length) { body.append(U.el('div', { class: 'res-empty muted', text: 'No hits.' })); return; }
    const cols = columns(hits);
    const anyHl = hits.some((h) => h.highlight);
    const anyIdx = new Set(hits.map((h) => h._index)).size > 1;
    const head = U.el('tr', {},
      U.el('th', { class: 'num', text: '_score' }), anyIdx ? U.el('th', { text: '_index' }) : null, U.el('th', { text: '_id' }),
      ...cols.map((c) => U.el('th', { text: c, title: c })),
      anyHl ? U.el('th', { text: 'match' }) : null,
      U.el('th', { class: 'th-cols' }, U.el('button', { type: 'button', class: 'icon-btn icon-btn-xs', title: 'Choose columns', 'aria-label': 'Choose columns', text: '⋯', onclick: colMenu })));
    const rows = hits.slice(0, CFG.MAX_TABLE_ROWS).map((h, i) => {
      const f = flat(h._source, '', {}, 0);
      const hl = h.highlight ? Object.values(h.highlight)[0] : null;
      const tr = U.el('tr', { tabindex: '0', onclick: () => drawer(h), onkeydown: (e) => { if (e.key === 'Enter') drawer(h); } },
        U.el('td', { class: 'num mono', text: h._score == null ? '—' : Number(h._score).toFixed(2) }),
        anyIdx ? U.el('td', { class: 'mono', text: h._index }) : null,
        U.el('td', { class: 'mono td-id', text: h._id, title: h._id }),
        ...cols.map((c) => { const v = cell(f[c]); return U.el('td', { text: v.length > 300 ? v.slice(0, 300) + '…' : v, title: v.length > 60 ? v.slice(0, 1000) : null }); }),
        anyHl ? U.el('td', { class: 'td-hl', html: hl ? frag(hl[0]) : '' }) : null,
        U.el('td'));
      tr.dataset.i = i;
      return tr;
    });
    body.append(...[U.el('div', { class: 'tbl-wrap' }, U.el('table', { class: 'tbl' }, U.el('thead', {}, head), U.el('tbody', {}, ...rows))),
      hits.length > CFG.MAX_TABLE_ROWS ? U.el('p', { class: 'muted small res-note', text: `First ${CFG.MAX_TABLE_ROWS} of ${hits.length} hits shown. JSON has all of them.` }) : null].filter(Boolean));
  }
  function colMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const hits = state.res.json.hits.hits;
    const idx = hits[0] && hits[0]._index;
    Sift.ui.menu.open(r.left - 200, r.bottom + 4, [
      ...state.allCols.slice(0, 60).map((c) => ({ label: (state.cols.includes(c) ? '✓ ' : '    ') + c, onClick: () => {
        state.cols = state.cols.includes(c) ? state.cols.filter((x) => x !== c) : [...state.cols, c];
        Sift.store.set('cols:' + idx, JSON.stringify(state.cols));
        draw();
      } })),
      { separator: true },
      { label: 'Reset columns', onClick: () => { Sift.store.set('cols:' + idx, ''); state.cols = null; draw(); } },
    ], 'Columns');
  }

  // ---------------- document drawer
  function drawer(h) {
    const doc = { _index: h._index, _id: h._id, _score: h._score, ...(h._routing ? { _routing: h._routing } : {}), _source: h._source, ...(h.fields ? { fields: h.fields } : {}), ...(h.sort ? { sort: h.sort } : {}) };
    const text = J.pretty(doc);
    const body = U.el('div', { class: 'stack' },
      h.highlight ? U.el('div', { class: 'drawer-hl' }, ...Object.entries(h.highlight).map(([f, frs]) => U.el('div', { class: 'small' }, U.el('span', { class: 'muted mono', text: f + ' ' }), U.el('span', { html: frs.map(frag).join(' … ') })))) : null,
      h._explanation ? U.el('details', { class: 'explain', open: true }, U.el('summary', { text: `Why the score is ${Number(h._explanation.value).toFixed(3)}` }), explainTree(h._explanation)) : null,
      U.el('pre', { class: 'json-view json-drawer', html: J.html(text) }));
    Sift.ui.dialog.open({ title: h._id, wide: true, body, actions: [
      { label: 'Copy JSON', onClick: () => { copy(text); return false; } },
      { label: 'Copy _id', onClick: () => { copy(h._id); return false; } },
      { label: 'Close', primary: true },
    ] });
  }
  function explainTree(x) {
    const node = U.el('div', { class: 'ex-node' }, U.el('span', { class: 'ex-val mono', text: Number(x.value).toFixed(3) }), U.el('span', { class: 'ex-desc small', text: x.description }));
    if (x.details && x.details.length) node.append(U.el('div', { class: 'ex-kids' }, ...x.details.map(explainTree)));
    return node;
  }

  // ---------------- aggregations
  function aggs(body) {
    const all = state.res.json.aggregations;
    Object.entries(all).forEach(([name, a]) => body.append(aggBlock(name, a, 0)));
  }
  function aggBlock(name, a, depth) {
    const box = U.el('section', { class: 'agg' + (depth ? ' agg-sub' : '') }, U.el('h4', { class: 'agg-name section-label', text: name }));
    const buckets = Array.isArray(a.buckets) ? a.buckets : a.buckets && typeof a.buckets === 'object' ? Object.entries(a.buckets).map(([k, v]) => ({ key: k, ...v })) : null;
    if (buckets) {
      const max = Math.max(1, ...buckets.map((b) => b.doc_count || 0));
      buckets.slice(0, 100).forEach((b) => {
        const label = b.key_as_string || (typeof b.key === 'object' ? JSON.stringify(b.key) : String(b.key));
        const row = U.el('button', { type: 'button', class: 'agg-row', title: state.opts.onBucket ? `Filter by ${label}` : label, onclick: () => state.opts.onBucket && state.opts.onBucket(name, b.key, b) },
          U.el('span', { class: 'agg-key', text: label }),
          U.el('span', { class: 'agg-bar' }, U.el('span', { style: `width:${((b.doc_count || 0) / max * 100).toFixed(1)}%` })),
          U.el('span', { class: 'agg-n mono', text: (b.doc_count || 0).toLocaleString() }));
        box.append(row);
        Object.entries(b).forEach(([k, v]) => { if (v && typeof v === 'object' && (v.value !== undefined || v.buckets)) box.append(U.el('div', { class: 'agg-nested' }, aggBlock(`${label} › ${k}`, v, depth + 1))); });
      });
      if (a.sum_other_doc_count) box.append(U.el('p', { class: 'muted small', text: `+ ${a.sum_other_doc_count.toLocaleString()} documents in other buckets` }));
    } else if (a.value !== undefined) box.append(U.el('div', { class: 'agg-metric' }, U.el('strong', { text: a.value_as_string || (a.value == null ? '—' : Number(a.value).toLocaleString(undefined, { maximumFractionDigits: 3 })) })));
    else if (a.values) box.append(...Object.entries(a.values).map(([k, v]) => U.el('div', { class: 'agg-kv small' }, U.el('span', { class: 'muted', text: k }), U.el('span', { class: 'mono', text: v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }) }))));
    else if (a.count !== undefined && a.avg !== undefined) box.append(...['count', 'min', 'max', 'avg', 'sum'].map((k) => U.el('div', { class: 'agg-kv small' }, U.el('span', { class: 'muted', text: k }), U.el('span', { class: 'mono', text: a[k] == null ? '—' : Number(a[k]).toLocaleString(undefined, { maximumFractionDigits: 3 }) }))));
    else if (a.doc_count !== undefined) { box.append(U.el('div', { class: 'agg-kv small' }, U.el('span', { class: 'muted', text: 'documents' }), U.el('span', { class: 'mono', text: a.doc_count.toLocaleString() }))); Object.entries(a).forEach(([k, v]) => { if (v && typeof v === 'object') box.append(aggBlock(k, v, depth + 1)); }); }
    else box.append(U.el('pre', { class: 'json-view json-small', html: J.html(J.pretty(a)) }));
    return box;
  }

  // ---------------- profile
  function profile(body) {
    const shards = state.res.json.profile.shards || [];
    const ms = (ns) => (ns / 1e6).toFixed(ns >= 1e7 ? 1 : 2) + ' ms';
    shards.forEach((s) => {
      const searches = s.searches || [];
      const q = searches.flatMap((x) => x.query || []);
      const totalNs = q.reduce((a, b) => a + (b.time_in_nanos || 0), 0) + searches.reduce((a, x) => a + ((x.collector || [])[0] || {}).time_in_nanos || 0, 0);
      const box = U.el('section', { class: 'prof' }, U.el('h4', { class: 'prof-shard small' }, U.el('span', { class: 'mono', text: s.id }), U.el('span', { class: 'muted', text: ' · ' + ms(totalNs) })));
      const walk = (n, d) => {
        box.append(U.el('div', { class: 'prof-row', style: `--d:${d}` },
          U.el('span', { class: 'prof-type mono small', text: n.type }),
          U.el('span', { class: 'prof-desc small', text: n.description, title: n.description }),
          U.el('span', { class: 'prof-bar' }, U.el('span', { style: `width:${Math.min(100, (n.time_in_nanos / Math.max(1, totalNs)) * 100).toFixed(1)}%` })),
          U.el('span', { class: 'prof-ms mono small', text: ms(n.time_in_nanos || 0) })));
        if (d < 6) (n.children || []).forEach((c) => walk(c, d + 1));
      };
      q.forEach((n) => walk(n, 0));
      searches.forEach((x) => (x.collector || []).forEach((c) => box.append(U.el('div', { class: 'prof-row prof-coll', style: '--d:0' }, U.el('span', { class: 'prof-type mono small', text: 'collector' }), U.el('span', { class: 'prof-desc small', text: c.name + ' · ' + c.reason }), U.el('span'), U.el('span', { class: 'prof-ms mono small', text: ms(c.time_in_nanos || 0) })))));
      (s.aggregations || []).forEach((a) => box.append(U.el('div', { class: 'prof-row', style: '--d:0' }, U.el('span', { class: 'prof-type mono small', text: 'agg' }), U.el('span', { class: 'prof-desc small', text: `${a.description} (${a.type})` }), U.el('span'), U.el('span', { class: 'prof-ms mono small', text: ms(a.time_in_nanos || 0) }))));
      body.append(box);
    });
  }

  Sift.ui.results = { render, frag, flat };
})();
