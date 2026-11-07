/**
 * Compare A/B: the Query tab's search, run on two clusters (or two indices) side by side.
 *
 *   Documents   total in each index, and how far apart they are
 *   Hits        how many match the query on each side
 *   Top N       how many of the top N are on both sides, which moved (↑ / ↓) and which are only on one
 *   Took        median of several runs on each side (server time)
 *   Mapping     fields whose type differs or that only one side has
 *   Only in A / B   top results missing from the other side, checked by _id: "missing" (not there at
 *               all, e.g. still in an indexing queue) or "ranked lower" (there, but outside its top N)
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  const J = Sift.json;
  const P = Sift.prefs;
  let host; let built = false; let sel = {}; let out; let busy = false; let last = null;

  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const LABEL_FIELDS = ['path', 'title', 'name', 'fileName', 'filePath', 'subject', 'url', 'message', 'description'];
  function label(h) {
    const s = h._source || {};
    const flat = Sift.ui.results.flat(s, '', {}, 0);
    const k = LABEL_FIELDS.find((f) => typeof flat[f] === 'string') || Object.keys(flat).find((f) => /(^|\.)(path|title|name)$/i.test(f) && typeof flat[f] === 'string');
    return k ? String(flat[k]) : h._id;
  }

  function build() {
    const connSel = (side) => U.el('select', { class: 'select', 'aria-label': `Cluster ${side}`, onchange: save });
    const idxIn = (side) => U.el('input', { class: 'field mono', type: 'text', list: 'cmpIdx' + side, spellcheck: 'false', 'aria-label': `Index ${side}`, placeholder: 'index or alias', onchange: save });
    sel = { aConn: connSel('A'), aIdx: idxIn('A'), bConn: connSel('B'), bIdx: idxIn('B'),
      top: U.el('select', { class: 'select', 'aria-label': 'Results to compare', onchange: () => P.set('compareTop', Number(sel.top.value)) }, ...[10, 20, 50, 100].map((n) => U.el('option', { value: n, text: `Top ${n}` }))),
      runs: U.el('select', { class: 'select', 'aria-label': 'Runs per side', onchange: () => P.set('compareRuns', Number(sel.runs.value)) }, ...[1, 3, 5].map((n) => U.el('option', { value: n, text: `${n} run${n > 1 ? 's' : ''}` }))) };
    sel.top.value = String(P.get('compareTop')); sel.runs.value = String(P.get('compareRuns'));
    const runBtn = U.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '▶ Run on both', onclick: run });
    sel.runBtn = runBtn;
    const side = (k, conn, idx) => U.el('div', { class: 'cmp-side' }, U.el('span', { class: 'cmp-letter cmp-' + k, text: k.toUpperCase() }), conn, idx, U.el('datalist', { id: 'cmpIdx' + k.toUpperCase() }));
    out = U.el('div', { class: 'cmp-out' });
    host.replaceChildren(U.el('div', { class: 'q-wrap' },
      U.el('div', { class: 'glass q-bar cmp-bar' },
        side('a', sel.aConn, sel.aIdx),
        U.el('button', { type: 'button', class: 'icon-btn icon-btn-xs', title: 'Swap A and B', 'aria-label': 'Swap A and B', text: '⇄', onclick: swap }),
        side('b', sel.bConn, sel.bIdx),
        sel.top, sel.runs, U.el('span', { class: 'spacer' }), runBtn),
      U.el('p', { class: 'cmp-hint muted small' }, 'Uses the search in the Query tab: ', U.el('span', { class: 'mono cmp-q' })),
      out));
    built = true;
  }

  function save() { Sift.store.set('cmp', JSON.stringify({ a: sel.aConn.value, ai: sel.aIdx.value, b: sel.bConn.value, bi: sel.bIdx.value })); fillIdx(); }
  function swap() { [sel.aConn.value, sel.bConn.value] = [sel.bConn.value, sel.aConn.value]; [sel.aIdx.value, sel.bIdx.value] = [sel.bIdx.value, sel.aIdx.value]; save(); }

  function fillConns() {
    let st = {}; try { st = JSON.parse(Sift.store.get('cmp', '{}')); } catch (e) { st = {}; }
    const opts = () => C.list.map((c) => U.el('option', { value: c.id, text: c.name + (c.readOnly ? ' (read-only)' : '') }));
    sel.aConn.replaceChildren(...opts()); sel.bConn.replaceChildren(...opts());
    const has = (id) => C.list.some((c) => c.id === id);
    sel.aConn.value = has(st.a) ? st.a : C.current ? C.current.id : C.list[0] ? C.list[0].id : '';
    sel.bConn.value = has(st.b) ? st.b : (C.list.find((c) => c.id !== sel.aConn.value) || C.list[0] || {}).id || '';
    const q = Sift.ui.query.request();
    const idx = q.path && !q.path.startsWith('_') ? q.path.split('/')[0] : C.index || '';
    sel.aIdx.value = st.ai || idx; sel.bIdx.value = st.bi || idx;
    fillIdx();
  }
  async function fillIdx() {
    for (const k of ['A', 'B']) {
      const id = sel[k.toLowerCase() + 'Conn'].value;
      const dl = host.querySelector('#cmpIdx' + k);
      if (!id || !dl) continue;
      const names = id === (C.current && C.current.id) ? C.indices.map((i) => i.index).concat(C.aliases.map((a) => a.alias)) : [];
      dl.replaceChildren(...[...new Set(names)].filter((n) => !n.startsWith('.')).slice(0, 300).map((n) => U.el('option', { value: n })));
    }
  }

  function queryBody() {
    const q = Sift.ui.query.request();
    const r = J.parse(q.body);
    if (!r.ok) throw new Error(`The Query tab's body isn't valid JSON (line ${r.line}: ${r.error}).`);
    const v = r.value && typeof r.value === 'object' ? { ...r.value } : {};
    delete v.profile; delete v.explain; delete v.aggs; delete v.aggregations; delete v.from; delete v.search_after;
    return v;
  }

  async function sideRun(connId, index, body, top, runs) {
    const path = encodeURIComponent(index).replace(/%2C/g, ',').replace(/%2A/g, '*');
    const one = async () => {
      const r = await C.req('POST', path + '/_search', { ...body, size: top, track_total_hits: true }, { id: connId });
      const err = C.esError(r); if (err) throw new Error(err);
      return r;
    };
    const first = await one();
    const took = [first.json.took]; const rt = [first.ms];
    for (let i = 1; i < runs; i++) { const r = await one(); took.push(r.json.took); rt.push(r.ms); }
    const docs = await C.req('GET', path + '/_count', null, { id: connId }).then((r) => (r.json && r.json.count != null ? r.json.count : null)).catch(() => null);
    const fields = await C.fields(index, { id: connId }).catch(() => []);
    const t = first.json.hits.total;
    return { hits: first.json.hits.hits, total: t == null ? null : typeof t === 'number' ? t : t.value, relation: t && t.relation, took: median(took), rt: median(rt), docs, fields };
  }

  /** Which of these ids does the other side have at all? */
  async function exists(connId, index, ids) {
    if (!ids.length) return new Set();
    const r = await C.req('POST', encodeURIComponent(index).replace(/%2C/g, ',') + '/_search', { query: { ids: { values: ids } }, size: ids.length, _source: false }, { id: connId });
    return new Set(((r.json && r.json.hits && r.json.hits.hits) || []).map((h) => h._id));
  }

  async function run() {
    if (busy) return;
    const a = { id: sel.aConn.value, index: sel.aIdx.value.trim() }; const b = { id: sel.bConn.value, index: sel.bIdx.value.trim() };
    if (!a.id || !b.id) { Sift.ui.connForm.add(); return; }
    if (!a.index || !b.index) { Sift.toast('Type the index (or alias) for both sides.'); return; }
    let body;
    try { body = queryBody(); } catch (e) { out.replaceChildren(U.el('p', { class: 'res-error', text: e.message })); return; }
    const top = Number(sel.top.value) || 20; const runs = Number(sel.runs.value) || 1;
    busy = true; sel.runBtn.disabled = true; sel.runBtn.textContent = 'Running…';
    out.replaceChildren(U.el('p', { class: 'muted res-note', text: `Running on both sides (${runs} run${runs > 1 ? 's' : ''} each)…` }));
    try {
      const [A, B] = await Promise.all([sideRun(a.id, a.index, body, top, runs), sideRun(b.id, b.index, body, top, runs)]);
      const posA = new Map(A.hits.map((h, i) => [h._id, i])); const posB = new Map(B.hits.map((h, i) => [h._id, i]));
      // Moves are judged among the results both sides have, so a missing document above doesn't make everything "move".
      const rel = (hits, other) => new Map(hits.filter((h) => other.has(h._id)).map((h, i) => [h._id, i]));
      const relA = rel(A.hits, posB); const relB = rel(B.hits, posA);
      const onlyA = A.hits.filter((h) => !posB.has(h._id)).map((h) => h._id);
      const onlyB = B.hits.filter((h) => !posA.has(h._id)).map((h) => h._id);
      const [inB, inA] = await Promise.all([exists(b.id, b.index, onlyA), exists(a.id, a.index, onlyB)]);
      const fa = new Map(A.fields.filter((f) => !f.sub && !f.container).map((f) => [f.path, f.type])); const fb = new Map(B.fields.filter((f) => !f.sub && !f.container).map((f) => [f.path, f.type]));
      const mapDiff = [...new Set([...fa.keys(), ...fb.keys()])].filter((k) => fa.get(k) !== fb.get(k)).sort().map((k) => ({ path: k, a: fa.get(k) || '—', b: fb.get(k) || '—' }));
      last = { a, b, A, B, posA, posB, relA, relB, onlyA, onlyB, inB, inA, mapDiff, top, runs, body };
      paint();
    } catch (e) { out.replaceChildren(U.el('p', { class: 'res-error', text: C.clean(e) })); }
    finally { busy = false; sel.runBtn.disabled = false; sel.runBtn.textContent = '▶ Run on both'; }
  }

  const name = (id) => (C.byId(id) || {}).name || '?';
  function paint() {
    const L = last; const { A, B } = L;
    const both = A.hits.filter((h) => L.posB.has(h._id)).length;
    const n = Math.max(A.hits.length, B.hits.length);
    const moved = A.hits.filter((h) => L.relB.has(h._id) && L.relB.get(h._id) !== L.relA.get(h._id)).length;
    const gap = A.docs != null && B.docs != null ? Math.abs(A.docs - B.docs) : null;
    const card = (k, big, small, warn) => U.el('div', { class: 'glass cmp-card' + (warn ? ' is-warn' : '') }, U.el('span', { class: 'section-label', text: k }), U.el('strong', { class: 'cmp-big', text: big }), U.el('span', { class: 'small cmp-small', text: small }));
    const cards = U.el('div', { class: 'cmp-cards' },
      card('Documents', gap == null ? '—' : gap === 0 ? 'Same' : `${gap.toLocaleString()} apart`, `A ${A.docs == null ? '—' : A.docs.toLocaleString()} · B ${B.docs == null ? '—' : B.docs.toLocaleString()}`, gap > 0),
      card('Hits for this query', `${fmtTotal(A)} · ${fmtTotal(B)}`, A.total === B.total ? 'The same on both' : `${Math.abs((A.total || 0) - (B.total || 0)).toLocaleString()} more on ${A.total > B.total ? 'A' : 'B'}`, A.total !== B.total),
      card(`Top ${L.top} overlap`, `${both} of ${n}`, `${moved} moved · ${L.onlyA.length} only in A · ${L.onlyB.length} only in B`, both < n),
      card('Took', `${fmtMs(A.took)} · ${fmtMs(B.took)}`, `server time, median of ${L.runs} run${L.runs > 1 ? 's' : ''} (round trip ${fmtMs(A.rt)} · ${fmtMs(B.rt)})`, false),
      card('Mapping', L.mapDiff.length ? `${L.mapDiff.length} field${L.mapDiff.length === 1 ? '' : 's'} differ${L.mapDiff.length === 1 ? 's' : ''}` : 'Same', L.mapDiff.length ? L.mapDiff.slice(0, 2).map((d) => `${d.path}: ${d.a} ≠ ${d.b}`).join(' · ') : 'Every field has the same type', L.mapDiff.length > 0));
    const list = (k, hits, mine, other, onlyIds, otherHas, relMine, relOther) => U.el('section', { class: 'glass cmp-list', 'aria-label': `Results on ${k.toUpperCase()}` },
      U.el('div', { class: 'pane-head small' }, U.el('span', { class: 'cmp-letter cmp-' + k, text: k.toUpperCase() }), U.el('strong', { text: name(L[k].id) }), U.el('span', { class: 'muted mono', text: L[k].index })),
      U.el('div', { class: 'cmp-rows' }, ...hits.map((h, i) => {
        const j = other.get(h._id);
        const only = j == null;
        const ri = relMine.get(h._id); const rj = relOther.get(h._id);
        const tag = only ? (otherHas.has(h._id) ? 'ranked lower' : 'missing') : rj === ri ? 'same' : rj < ri ? `↑ ${ri - rj}` : `↓ ${rj - ri}`;
        return U.el('div', { class: 'cmp-row' + (only ? (otherHas.has(h._id) ? ' is-lower' : ' is-only') : rj !== ri ? ' is-moved' : ''), title: `_id ${h._id}${only ? '' : ` · ${k === 'a' ? 'B' : 'A'} has it at ${j + 1}`}` },
          U.el('span', { class: 'muted mono', text: String(i + 1) }),
          U.el('span', { class: 'cmp-label mono', text: label(h) }),
          U.el('span', { class: 'mono small cmp-score', text: h._score == null ? '—' : Number(h._score).toFixed(2) }),
          U.el('span', { class: 'small cmp-tag', text: only ? `${tag} in ${k === 'a' ? 'B' : 'A'}` : tag }));
      })));
    const missingA = L.onlyA.filter((id) => !L.inB.has(id)); const missingB = L.onlyB.filter((id) => !L.inA.has(id));
    const missBox = (k, ids, otherK) => (ids.length ? U.el('section', { class: 'cmp-miss' },
      U.el('strong', { text: `${ids.length} top result${ids.length === 1 ? ' is' : 's are'} only in ${k}` }),
      U.el('span', { class: 'small', text: `Not in ${otherK} at all (checked by _id). If ${otherK} is fed from a queue, they may still be on their way.` }),
      U.el('span', { class: 'mono small cmp-ids', text: ids.slice(0, 6).join(', ') + (ids.length > 6 ? ` +${ids.length - 6}` : '') }),
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-xs', text: 'Copy IDs', onclick: () => navigator.clipboard.writeText(ids.join('\n')).then(() => Sift.toast(`Copied ${ids.length} IDs`)) }),
      U.el('button', { type: 'button', class: 'btn btn-ghost btn-xs', text: 'Check again', onclick: run })) : null);
    const mapBox = L.mapDiff.length ? U.el('details', { class: 'glass cmp-map' }, U.el('summary', { class: 'small', text: `Mapping differences · ${L.mapDiff.length}` }),
      U.el('div', { class: 'cmp-map-rows' }, ...L.mapDiff.slice(0, 300).map((d) => U.el('div', { class: 'kv small' }, U.el('span', { class: 'mono', text: d.path }), U.el('span', { class: 'mono' }, U.el('span', { class: 'cmp-letter-in cmp-a', text: 'A ' }), d.a, '  ', U.el('span', { class: 'cmp-letter-in cmp-b', text: 'B ' }), d.b))))) : null;
    out.replaceChildren(...[cards, missBox('A', missingA, 'B'), missBox('B', missingB, 'A'),
      U.el('div', { class: 'cmp-pair' }, list('a', A.hits, L.posA, L.posB, L.onlyA, L.inB, L.relA, L.relB), list('b', B.hits, L.posB, L.posA, L.onlyB, L.inA, L.relB, L.relA)), mapBox].filter(Boolean));
  }
  const fmtTotal = (x) => (x.total == null ? '—' : x.total.toLocaleString() + (x.relation === 'gte' ? '+' : ''));
  const fmtMs = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

  function show() {
    if (!built) build();
    fillConns();
    const q = Sift.ui.query.request();
    let summaryText = q.body.replace(/\s+/g, ' ').slice(0, 140);
    try { const v = queryBody(); summaryText = JSON.stringify(v.query || { match_all: {} }).slice(0, 160); } catch (e) { /* shown on run */ }
    host.querySelector('.cmp-q').textContent = summaryText;
    if (!last) out.replaceChildren(U.el('div', { class: 'glass res-empty muted' }, U.el('p', { text: C.list.length < 2 ? 'Add a second cluster (or pick two indices on one) to compare. Then press Run on both.' : 'Pick the two sides and press Run on both.' })));
  }

  Sift.bus.on('conn:list', () => { if (built && !host.hidden) fillConns(); });
  Sift.ui.compare = { init: (h) => { host = h; }, show, hide() {}, run };
})();
