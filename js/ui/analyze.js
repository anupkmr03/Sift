/**
 * Analyze: type some text and see the tokens a field (or an analyzer) turns it into, which is
 * what search actually matches against. "Show each step" lists what the tokenizer and every
 * filter did (the _analyze "explain" option).
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  let host; let built = false; let idxSel; let modeSel; let pickSel; let textIn; let stepsChk; let out; let token = 0;
  const BUILT_IN = ['standard', 'simple', 'whitespace', 'stop', 'keyword', 'pattern', 'english', 'french', 'german', 'hindi', 'spanish', 'fingerprint'];

  function build() {
    idxSel = U.el('select', { class: 'select', 'aria-label': 'Index', onchange: () => C.setIndex(idxSel.value) });
    modeSel = U.el('select', { class: 'select', 'aria-label': 'Analyze with', onchange: fillPick }, U.el('option', { value: 'field', text: 'A field\'s analyzer' }), U.el('option', { value: 'analyzer', text: 'An analyzer' }));
    pickSel = U.el('select', { class: 'select mono', 'aria-label': 'Field or analyzer' });
    textIn = U.el('textarea', { class: 'field an-text', rows: 4, spellcheck: 'false', placeholder: 'The Quick brown foxes jumped over Retry-Policy v2.1', 'aria-label': 'Text', onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } } });
    textIn.value = Sift.store.get('anText', 'The quick brown foxes jumped over RetryPolicy v2.1');
    stepsChk = U.el('input', { type: 'checkbox' });
    out = U.el('section', { class: 'glass an-out', 'aria-label': 'Tokens' });
    host.replaceChildren(U.el('div', { class: 'q-wrap' },
      U.el('div', { class: 'glass q-bar' }, idxSel, modeSel, pickSel,
        U.el('label', { class: 'check-line small' }, stepsChk, U.el('span', { text: 'Show each step' })),
        U.el('span', { class: 'spacer' }),
        U.el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Analyze', title: 'Ctrl+Enter', onclick: run })),
      U.el('section', { class: 'glass an-in' }, textIn),
      out));
    built = true;
  }

  async function fillPick() {
    const index = idxSel.value;
    if (modeSel.value === 'field') {
      const f = index ? await C.fields(index).catch(() => []) : [];
      const text = f.filter((x) => /text|search_as_you_type|match_only_text/.test(x.type));
      const kw = f.filter((x) => x.type === 'keyword');
      pickSel.replaceChildren(...[...text, ...kw].slice(0, 400).map((x) => U.el('option', { value: x.path, text: `${x.path}  (${x.type}${x.analyzer ? ', ' + x.analyzer : ''})` })));
      if (!pickSel.options.length) pickSel.append(U.el('option', { value: '', text: 'No text fields' }));
    } else {
      let custom = [];
      if (index) {
        const r = await C.req('GET', encodeURIComponent(index) + '/_settings/index.analysis*', null).catch(() => null);
        const s = r && r.json && Object.values(r.json)[0];
        const an = s && s.settings && s.settings.index && s.settings.index.analysis && s.settings.index.analysis.analyzer;
        custom = an ? Object.keys(an) : [];
      }
      pickSel.replaceChildren(...custom.map((a) => U.el('option', { value: a, text: a + '  (this index)' })), ...BUILT_IN.map((a) => U.el('option', { value: a, text: a })));
    }
  }

  async function run() {
    if (!C.current) return;
    const mine = ++token;
    Sift.store.set('anText', textIn.value);
    const body = { text: textIn.value, ...(modeSel.value === 'field' ? { field: pickSel.value } : { analyzer: pickSel.value }), ...(stepsChk.checked ? { explain: true } : {}) };
    const path = (idxSel.value && (modeSel.value === 'field' || pickSel.selectedOptions[0] && /this index/.test(pickSel.selectedOptions[0].text)) ? encodeURIComponent(idxSel.value) + '/' : '') + '_analyze';
    out.replaceChildren(U.el('p', { class: 'muted small', text: 'Analyzing…' }));
    try {
      const r = await C.req('POST', path, body);
      if (mine !== token) return;
      const err = C.esError(r);
      if (err) { out.replaceChildren(U.el('p', { class: 'res-error', text: err })); return; }
      const j = r.json;
      const tokens = (list) => U.el('div', { class: 'tok-list' }, ...list.map((t) => U.el('span', { class: 'tok', title: `position ${t.position} · characters ${t.start_offset}–${t.end_offset}${t.type ? ' · ' + t.type : ''}` }, U.el('span', { class: 'mono', text: t.token }), U.el('span', { class: 'tok-pos', text: String(t.position) }))));
      if (j.detail) {
        const d = j.detail;
        const steps = [];
        (d.charfilters || []).forEach((c) => steps.push(U.el('div', { class: 'an-step' }, U.el('h4', { class: 'section-label', text: 'char filter · ' + c.name }), U.el('p', { class: 'mono small', text: (c.filtered_text || []).join(' ') }))));
        if (d.tokenizer) steps.push(U.el('div', { class: 'an-step' }, U.el('h4', { class: 'section-label', text: 'tokenizer · ' + d.tokenizer.name }), tokens(d.tokenizer.tokens || [])));
        (d.tokenfilters || []).forEach((f) => steps.push(U.el('div', { class: 'an-step' }, U.el('h4', { class: 'section-label', text: 'filter · ' + f.name }), tokens(f.tokens || []))));
        if (d.analyzer) steps.push(U.el('div', { class: 'an-step' }, U.el('h4', { class: 'section-label', text: 'analyzer · ' + d.analyzer.name }), tokens(d.analyzer.tokens || [])));
        out.replaceChildren(...steps);
      } else out.replaceChildren(U.el('h4', { class: 'section-label', text: `${(j.tokens || []).length} tokens` }), tokens(j.tokens || []));
    } catch (e) { if (mine === token) out.replaceChildren(U.el('p', { class: 'res-error', text: C.clean(e) })); }
  }

  async function show() {
    if (!built) build();
    const list = C.indices.filter((i) => !i.index.startsWith('.') || i.index === C.index);
    idxSel.replaceChildren(U.el('option', { value: '', text: 'No index (built-in analyzers)' }), ...list.map((i) => U.el('option', { value: i.index, text: i.index, selected: i.index === C.index })));
    if (!list.length) modeSel.value = 'analyzer';
    await fillPick();
  }
  Sift.bus.on('conn:index', () => { if (built && !host.hidden) show(); });
  Sift.ui.analyze = { init: (h) => { host = h; }, show, hide() {}, run };
})();
