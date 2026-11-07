/**
 * The request-body editor: a textarea over a coloured copy of the same text (so typing stays a
 * plain textarea: undo, IME, selection), with line numbers, a JSON check, auto-indent, paired
 * brackets and quotes, and suggestions (Query DSL keywords, and the index's fields from its mapping).
 *
 *   const ed = Sift.ui.editor.create(host, { value, onRun, onChange, fields: async () => [{ path, type }], nd: () => bool })
 *   ed.get() / ed.set(text) / ed.format() / ed.focus() / ed.check()
 *
 * Keys: Ctrl+Enter run · Ctrl+Shift+F format · Tab / Shift+Tab indent · Ctrl+Space suggestions.
 */
(function () {
  const U = Sift.utils;
  const J = Sift.json;

  // Query DSL vocabulary, by where you are in the body.
  const TOP = ['query', 'aggs', 'size', 'from', 'sort', '_source', 'highlight', 'track_total_hits', 'post_filter', 'search_after', 'collapse', 'fields', 'runtime_mappings', 'timeout', 'explain', 'profile', 'min_score', 'knn', 'suggest', 'pit', 'stored_fields', 'docvalue_fields'];
  const CLAUSES = ['bool', 'match', 'match_phrase', 'match_phrase_prefix', 'multi_match', 'term', 'terms', 'range', 'exists', 'prefix', 'wildcard', 'regexp', 'fuzzy', 'ids', 'query_string', 'simple_query_string', 'nested', 'has_child', 'has_parent', 'function_score', 'constant_score', 'dis_max', 'boosting', 'match_all', 'match_none', 'script_score', 'geo_distance', 'more_like_this', 'knn'];
  const BOOL = ['must', 'filter', 'should', 'must_not', 'minimum_should_match', 'boost'];
  const AGG = ['terms', 'date_histogram', 'histogram', 'range', 'date_range', 'filters', 'filter', 'avg', 'sum', 'min', 'max', 'stats', 'extended_stats', 'cardinality', 'value_count', 'percentiles', 'top_hits', 'composite', 'nested', 'reverse_nested', 'significant_terms', 'missing', 'aggs'];
  const FIELD_QUERIES = new Set(['match', 'match_phrase', 'match_phrase_prefix', 'term', 'terms', 'range', 'prefix', 'wildcard', 'regexp', 'fuzzy', 'geo_distance', 'span_term']);
  const FIELD_VALUE_KEYS = new Set(['field', 'path', 'default_field']);
  const FIELD_ARRAY_KEYS = new Set(['_source', 'fields', 'docvalue_fields', 'stored_fields', 'includes', 'excludes']);
  const HL = ['fields', 'pre_tags', 'post_tags', 'fragment_size', 'number_of_fragments', 'type', 'require_field_match'];
  const MATCH_OPTS = ['query', 'operator', 'fuzziness', 'analyzer', 'boost', 'minimum_should_match', 'slop', 'zero_terms_query'];
  const RANGE_OPTS = ['gte', 'gt', 'lte', 'lt', 'format', 'time_zone', 'boost'];

  /** Where the caret is: inside a string (key or value), the keys above it, and the partial word. */
  function context(text, pos) {
    const stack = [];   // { type: '{' | '[', key }
    let key = null; let i = 0; let inStr = false; let strStart = 0; let lastStr = null; let expectKey = false;
    for (; i < pos; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') { inStr = false; lastStr = text.slice(strStart + 1, i); }
        continue;
      }
      if (ch === '"') { inStr = true; strStart = i; continue; }
      if (ch === ':') { key = lastStr; expectKey = false; continue; }
      if (ch === '{') { stack.push({ type: '{', key }); key = null; expectKey = true; continue; }
      if (ch === '[') { stack.push({ type: '[', key }); key = null; continue; }
      if (ch === '}' || ch === ']') { stack.pop(); key = null; continue; }
      if (ch === ',') { const top = stack[stack.length - 1]; key = top && top.type === '[' ? top.key : null; expectKey = !!top && top.type === '{'; }
    }
    if (!inStr) return null;
    const partial = text.slice(strStart + 1, pos);
    if (/["\n]/.test(partial)) return null;
    const top = stack[stack.length - 1];
    const isKey = !!top && top.type === '{' && expectKey && key == null;
    const chain = stack.map((s) => s.key);
    return { isKey, partial, start: strStart + 1, chain, parent: top ? top.key : null, inArray: !!top && top.type === '[', valueKey: isKey ? null : top && top.type === '[' ? top.key : key };
  }

  function vocab(ctx, fields) {
    const f = () => fields.filter((x) => !x.container || x.type === 'nested').map((x) => ({ label: x.path, hint: x.type }));
    const words = (list, hint) => list.map((w) => ({ label: w, hint }));
    const chain = ctx.chain.filter((k) => k != null);
    const parent = ctx.parent;
    const grand = chain[chain.length - 2];
    if (ctx.isKey) {
      if (!chain.length) return words(TOP, 'search');
      if (FIELD_QUERIES.has(parent)) return f();
      if (parent === 'highlight') return words(HL, 'highlight');
      if (grand === 'highlight' && parent === 'fields') return f();
      if (parent === 'sort' || (ctx.chain[ctx.chain.length - 1] == null && ctx.chain[ctx.chain.length - 2] === 'sort')) return f();
      if (parent === 'bool') return words(BOOL, 'bool');
      if (['query', 'filter', 'must', 'should', 'must_not', 'post_filter', 'positive', 'negative'].includes(parent) || (parent == null && ['must', 'should', 'filter', 'must_not'].includes(grand))) return words(CLAUSES, 'query');
      if (parent === 'aggs' || parent === 'aggregations') return [];
      if (grand === 'aggs' || grand === 'aggregations') return words(AGG, 'agg');
      if (FIELD_QUERIES.has(grand) && ['match', 'match_phrase', 'match_phrase_prefix'].includes(grand)) return words(MATCH_OPTS, grand);
      if (grand === 'range') return words(RANGE_OPTS, 'range');
      return [];
    }
    if (FIELD_VALUE_KEYS.has(ctx.valueKey) || (ctx.inArray && FIELD_ARRAY_KEYS.has(ctx.valueKey)) || (ctx.inArray && ctx.valueKey === 'sort') || ctx.valueKey === '_source' || (ctx.inArray && ctx.valueKey === 'fields')) return f();
    if (ctx.valueKey === 'operator') return words(['and', 'or'], 'operator');
    if (ctx.valueKey === 'order') return words(['asc', 'desc'], 'order');
    if (ctx.valueKey === 'calendar_interval') return words(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'], 'interval');
    return [];
  }

  function rank(items, q) {
    const s = q.toLowerCase();
    const scored = [];
    items.forEach((it) => {
      const l = it.label.toLowerCase();
      const at = l.indexOf(s);
      if (s && at < 0) return;
      scored.push({ it, w: at === 0 ? 0 : l.lastIndexOf('.' + s) >= 0 ? 1 : 2, len: l.length });
    });
    return scored.sort((a, b) => a.w - b.w || a.len - b.len || a.it.label.localeCompare(b.it.label)).slice(0, 40).map((x) => x.it);
  }

  function create(host, opts = {}) {
    const P = Sift.prefs;
    const gutter = U.el('div', { class: 'ed-gutter', 'aria-hidden': 'true' });
    const hl = U.el('pre', { class: 'ed-hl', 'aria-hidden': 'true' });
    const ta = U.el('textarea', { class: 'ed-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': opts.label || 'Request body', wrap: 'off' });
    const area = U.el('div', { class: 'ed-area' }, hl, ta);
    const pop = U.el('div', { class: 'ed-pop', role: 'listbox', hidden: true });
    const status = U.el('div', { class: 'ed-status small' });
    const root = U.el('div', { class: 'ed' }, U.el('div', { class: 'ed-body' }, gutter, area), pop, status);
    host.replaceChildren(root);
    ta.value = opts.value || '';
    let sugg = { items: [], at: 0, ctx: null };
    let lines = 0;

    const tab = () => ' '.repeat(Number(P.get('tabSize')) || 2);
    function applySize() { root.style.setProperty('--ed-size', (Number(P.get('editorSize')) || 13) + 'px'); }
    applySize();

    function paint() {
      const v = ta.value;
      hl.innerHTML = (v.length > 400000 ? J.esc(v) : J.html(v)) + '\n';
      const n = v.split('\n').length;
      if (n !== lines) { lines = n; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
      sync();
      check();
    }
    function sync() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; if (!pop.hidden) place(); }

    function check() {
      const v = ta.value;
      const nd = opts.nd && opts.nd();
      const r = nd ? J.parseNd(v) : J.parse(v);
      status.classList.toggle('is-bad', !r.ok);
      status.textContent = r.ok ? (r.empty ? 'No body' : nd ? 'Valid NDJSON' : 'Valid JSON') : `Line ${r.line || '?'}${r.col ? ', column ' + r.col : ''}: ${r.error}`;
      return r;
    }

    function set(text) { ta.value = text || ''; paint(); }
    function insert(text, selStart, selEnd) {
      ta.setRangeText(text, selStart, selEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    function format() {
      const r = J.parse(ta.value);
      if (!r.ok || r.empty) { if (!r.ok) Sift.toast(`Can't format: line ${r.line}: ${r.error}`); return false; }
      ta.focus(); ta.select();
      document.execCommand('insertText', false, J.pretty(r.value, Number(P.get('tabSize')) || 2));   // keeps undo
      paint();
      return true;
    }

    // ---------------- suggestions
    function caretXY() {
      const before = ta.value.slice(0, ta.selectionStart);
      const ls = before.split('\n');
      const cs = getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || 20;
      const cw = charW();
      return { x: parseFloat(cs.paddingLeft) + ls[ls.length - 1].length * cw - ta.scrollLeft, y: parseFloat(cs.paddingTop) + ls.length * lh - ta.scrollTop };
    }
    let cwCache = 0;
    function charW() {
      if (cwCache) return cwCache;
      const s = U.el('span', { text: 'MMMMMMMMMM', style: 'position:absolute;visibility:hidden;white-space:pre' });
      area.append(s);
      s.style.font = getComputedStyle(ta).font;
      cwCache = s.getBoundingClientRect().width / 10 || 7.8;
      s.remove();
      return cwCache;
    }
    function place() {
      const p = caretXY();
      const a = area.getBoundingClientRect(); const r = root.getBoundingClientRect();
      pop.style.left = Math.max(4, Math.min(p.x + (a.left - r.left), r.width - 300)) + 'px';
      pop.style.top = Math.min(p.y + (a.top - r.top) + 2, r.height - 60) + 'px';
    }
    function hide() { pop.hidden = true; sugg = { items: [], at: 0, ctx: null }; }
    async function suggest(force) {
      if (!P.get('autocomplete') && !force) return;
      const ctx = context(ta.value, ta.selectionStart);
      if (!ctx || (!force && !ctx.partial && !ctx.isKey && !ctx.valueKey)) { hide(); return; }
      let fields = [];
      try { fields = opts.fields ? await opts.fields() : []; } catch (e) { fields = []; }
      const now = context(ta.value, ta.selectionStart);
      if (!now || now.start !== ctx.start) { hide(); return; }
      const items = rank(vocab(now, fields), now.partial).filter((it) => it.label !== now.partial);
      if (!items.length) { hide(); return; }
      sugg = { items, at: 0, ctx: now };
      renderPop();
      pop.hidden = false;
      place();
    }
    function renderPop() {
      pop.replaceChildren(...sugg.items.slice(0, 12).map((it, i) => U.el('div', { class: 'ed-opt' + (i === sugg.at ? ' is-on' : ''), role: 'option', 'aria-selected': String(i === sugg.at), onmousedown: (e) => { e.preventDefault(); sugg.at = i; accept(); } },
        U.el('span', { class: 'mono', text: it.label }), U.el('span', { class: 'muted small', text: it.hint || '' }))),
      U.el('div', { class: 'ed-pop-foot muted small', text: sugg.items.some((x) => x.hint && !/search|query|bool|agg|highlight|range|operator|order|interval|match/.test(x.hint)) ? 'From the mapping · Tab to insert' : 'Tab to insert' }));
    }
    function accept() {
      const it = sugg.items[sugg.at];
      const ctx = sugg.ctx;
      if (!it || !ctx) return;
      const v = ta.value;
      let end = ta.selectionStart;
      while (end < v.length && /[^"\n]/.test(v[end])) end++;
      const closed = v[end] === '"';
      let text = it.label + '"';
      let tail = closed ? end + 1 : end;
      if (ctx.isKey && !/^\s*:/.test(v.slice(tail))) text += ': ';
      hide();
      ta.focus();
      ta.setSelectionRange(ctx.start, tail);
      document.execCommand('insertText', false, text);
      paint();
    }

    // ---------------- typing help
    const PAIRS = { '{': '}', '[': ']', '"': '"' };
    ta.addEventListener('keydown', (e) => {
      const v = ta.value; const s = ta.selectionStart; const en = ta.selectionEnd;
      if (!pop.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(12, sugg.items.length); sugg.at = (sugg.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderPop(); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); accept(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); hide(); if (opts.onRun) opts.onRun(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); format(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); suggest(true); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        if (s === en && !e.shiftKey) { document.execCommand('insertText', false, tab()); return; }
        const le = v.indexOf('\n', en); const blockEnd = le < 0 ? v.length : le;
        const block = v.slice(ls, blockEnd);
        const t = tab();
        const next = e.shiftKey ? block.replace(new RegExp('^ {1,' + t.length + '}', 'gm'), '') : block.replace(/^/gm, t);
        ta.setSelectionRange(ls, blockEnd);
        document.execCommand('insertText', false, next);
        ta.setSelectionRange(ls, ls + next.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const indent = /^ */.exec(v.slice(ls, s))[0];
        const prev = v.slice(0, s).trimEnd().slice(-1);
        const next = v.slice(en).trimStart()[0];
        const opens = prev === '{' || prev === '[';
        if (opens && (next === '}' || next === ']') && v.slice(s, en + 1).trim().length <= 1 && v.slice(en).match(/^\s*[}\]]/)) {
          const ws = /^\s*/.exec(v.slice(en))[0].length;
          ta.setSelectionRange(s, en + ws);
          document.execCommand('insertText', false, '\n' + indent + tab() + '\n' + indent);
          const c = s + 1 + indent.length + tab().length;
          ta.setSelectionRange(c, c);
        } else document.execCommand('insertText', false, '\n' + indent + (opens ? tab() : ''));
        return;
      }
      if (PAIRS[e.key] && s === en) {
        const after = v[s];
        if (e.key === '"' && after === '"') { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
        if (e.key === '"' && /[\w\\]/.test(v[s - 1] || '')) return;
        if (!after || /[\s,}\]:]/.test(after)) { e.preventDefault(); document.execCommand('insertText', false, e.key + PAIRS[e.key]); ta.setSelectionRange(s + 1, s + 1); return; }
      }
      if ((e.key === '}' || e.key === ']') && v[s] === e.key && s === en) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
      if (e.key === 'Backspace' && s === en && s > 0 && PAIRS[v[s - 1]] && v[s] === PAIRS[v[s - 1]]) { e.preventDefault(); ta.setSelectionRange(s - 1, s + 1); document.execCommand('delete'); }
    });
    ta.addEventListener('input', () => { paint(); if (opts.onChange) opts.onChange(ta.value); suggest(false); });
    ta.addEventListener('scroll', sync, { passive: true });
    ta.addEventListener('blur', () => setTimeout(hide, 120));
    ta.addEventListener('click', hide);
    Sift.bus.on('prefs:change', ({ key }) => { if (key === 'editorSize' || key === 'tabSize') { cwCache = 0; applySize(); paint(); } });
    paint();
    void insert;

    return { get: () => ta.value, set, format, focus: () => ta.focus(), check, textarea: ta, refresh: paint };
  }

  Sift.ui = Sift.ui || {};
  Sift.ui.editor = { create, context, vocab };
})();
