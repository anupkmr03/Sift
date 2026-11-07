/**
 * Documents: page through an index (newest first when it has a date field), filter with a
 * query-string search ("status:active AND user:anup"), sort by any sortable field.
 * Rows open the full document. Uses from / size, so it stops at 10,000 (Elasticsearch's default window).
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  const CFG = Sift.config;
  let host; let built = false; let idxSel; let qIn; let sortSel; let resHost; let pager; let from = 0; let lastTotal = 0; let token = 0;

  const SORTABLE = /^(keyword|long|integer|short|byte|double|float|half_float|scaled_float|date|date_nanos|boolean|ip|unsigned_long|constant_keyword|version|wildcard)$/;

  function build() {
    idxSel = U.el('select', { class: 'select', 'aria-label': 'Index', onchange: () => { C.setIndex(idxSel.value); } });
    qIn = U.el('input', { class: 'field mono', type: 'search', placeholder: 'Filter: status:active AND user:anup   (Lucene query string)', spellcheck: 'false', 'aria-label': 'Filter', onkeydown: (e) => { if (e.key === 'Enter') { from = 0; load(); } } });
    sortSel = U.el('select', { class: 'select', 'aria-label': 'Sort', onchange: () => { from = 0; load(); } });
    pager = U.el('div', { class: 'pager small' });
    resHost = U.el('section', { class: 'glass d-res', 'aria-label': 'Documents' });
    host.replaceChildren(U.el('div', { class: 'q-wrap' },
      U.el('div', { class: 'glass q-bar' }, idxSel, U.el('div', { class: 'd-q' }, qIn),
        sortSel,
        U.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Search', onclick: () => { from = 0; load(); } }), pager),
      resHost));
    built = true;
  }

  async function fillSorts() {
    const fields = await C.fields(idxSel.value).catch(() => []);
    const opts = [['', 'Best match / index order']];
    const date = fields.find((f) => /^date/.test(f.type) && /(^|\.)(@?timestamp|created|createdAt|updated|indexedAt|date|time)/i.test(f.path)) || fields.find((f) => /^date/.test(f.type));
    if (date) opts.push([date.path + ':desc', `${date.path} · newest first`], [date.path + ':asc', `${date.path} · oldest first`]);
    fields.filter((f) => SORTABLE.test(f.type) && f !== date).slice(0, 80).forEach((f) => opts.push([f.path + ':asc', `${f.path} ↑`], [f.path + ':desc', `${f.path} ↓`]));
    // Keep your sort on the same index; a newly picked index starts newest first (when it has a date).
    const keep = sortSel.dataset.index === idxSel.value ? sortSel.value : null;
    sortSel.replaceChildren(...opts.map(([v, l]) => U.el('option', { value: v, text: l })));
    sortSel.value = keep != null && opts.some(([v]) => v === keep) ? keep : date ? date.path + ':desc' : '';
    sortSel.dataset.index = idxSel.value;
  }

  function fillIndices() {
    const list = C.indices.filter((i) => !i.index.startsWith('.') || i.index === C.index);
    idxSel.replaceChildren(...(list.length ? list.map((i) => U.el('option', { value: i.index, text: `${i.index}  ·  ${Sift.fmt.short(i.docs)}`, selected: i.index === C.index })) : [U.el('option', { value: '', text: 'No indices' })]));
    if (!C.index && list[0]) idxSel.value = list[0].index;
  }

  async function load() {
    if (!C.current || !idxSel.value) { Sift.ui.results.render(resHost, null, { empty: C.current ? 'Pick an index.' : 'Add a cluster first.' }); return; }
    const mine = ++token;
    const q = qIn.value.trim();
    const size = CFG.DOCS_PAGE;
    const body = { query: q ? { query_string: { query: q, default_operator: 'AND' } } : { match_all: {} }, from, size, track_total_hits: true };
    if (sortSel.value) { const [f, d] = sortSel.value.split(':'); body.sort = [{ [f]: { order: d, unmapped_type: 'keyword' } }]; }
    resHost.classList.add('is-busy');
    try {
      const res = await C.req('POST', encodeURIComponent(idxSel.value) + '/_search', body);
      if (mine !== token) return;
      const t = res.json && res.json.hits && res.json.hits.total;
      lastTotal = t == null ? 0 : typeof t === 'number' ? t : t.value;
      Sift.ui.results.render(resHost, res, {});
      paintPager();
    } catch (e) { if (mine === token) Sift.results.error(resHost, C.clean(e)); } finally { resHost.classList.remove('is-busy'); }
  }

  function paintPager() {
    const size = CFG.DOCS_PAGE;
    const end = Math.min(from + size, lastTotal);
    const cap = Math.min(lastTotal, CFG.MAX_FROM);
    pager.replaceChildren(
      U.el('span', { class: 'muted', text: lastTotal ? `${(from + 1).toLocaleString()}–${end.toLocaleString()} of ${lastTotal.toLocaleString()}` : 'No documents' }),
      U.el('button', { type: 'button', class: 'icon-btn icon-btn-xs', 'aria-label': 'Previous page', title: 'Previous page', text: '‹', disabled: from === 0, onclick: () => { from = Math.max(0, from - size); load(); } }),
      U.el('button', { type: 'button', class: 'icon-btn icon-btn-xs', 'aria-label': 'Next page', title: from + size >= cap && lastTotal > CFG.MAX_FROM ? 'Pages past 10,000 need a narrower filter' : 'Next page', text: '›', disabled: from + size >= cap, onclick: () => { from += size; load(); } }));
  }

  async function show() {
    if (!built) build();
    fillIndices();
    await fillSorts();
    from = 0;
    load();
  }

  Sift.bus.on('conn:index', () => { if (built && !host.hidden) show(); });
  Sift.bus.on('conn:indices', () => { if (built && !host.hidden) fillIndices(); });
  Sift.ui.docs = { init: (h) => { host = h; }, show, hide() {}, reload: load };
})();
