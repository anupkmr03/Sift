/**
 * Settings: appearance, requests (timeout, confirm before changing data, history), editor
 * (font size, tab width, suggestions), results (table columns), Compare A/B, Cluster refresh,
 * connections, keyboard shortcuts, about.
 */
(function () {
  const U = Sift.utils;
  const P = Sift.prefs;
  const D = window.siftDesktop;
  let host;

  function row(label, hint, control) {
    return U.el('div', { class: 'set-row' },
      U.el('div', { class: 'set-text' }, U.el('span', { class: 'set-label', text: label }), hint ? U.el('span', { class: 'set-hint muted small', text: hint }) : null),
      control ? U.el('div', { class: 'set-ctl' }, control) : null);
  }
  function segmented(options, current, onPick) {
    return U.el('div', { class: 'segmented', role: 'group' }, ...Object.entries(options).map(([v, l]) => U.el('button', {
      type: 'button', class: 'seg-btn seg-text', 'aria-pressed': String(v) === String(current) ? 'true' : 'false', text: l, onclick: () => { onPick(v); render(); },
    })));
  }
  const pref = (key, options, num) => segmented(options, P.get(key), (v) => P.set(key, num ? Number(v) : v));
  function toggle(key) {
    const b = U.el('input', { type: 'checkbox', class: 'switch', checked: !!P.get(key), role: 'switch' });
    b.addEventListener('change', () => P.set(key, b.checked));
    return b;
  }
  function swatches() {
    const A = Sift.appearance;
    const cur = A.get('accent');
    return U.el('div', { class: 'swatches', role: 'radiogroup' }, ...Object.entries(A.ACCENTS).map(([k, a]) => U.el('button', {
      type: 'button', class: 'swatch', role: 'radio', title: a.label, 'aria-label': a.label, 'aria-checked': k === cur ? 'true' : 'false', style: `--swatch:${a.main}`,
      onclick: () => { A.set({ accent: k }); render(); },
    })));
  }
  const section = (title, ...rows) => U.el('section', { class: 'glass set-section' }, U.el('h3', { class: 'section-label', text: title }), ...rows);

  async function render() {
    const A = Sift.appearance;
    const info = await D.info().catch(() => ({}));
    const C = Sift.conn;
    const keys = [['Ctrl+Enter', 'Run'], ['Ctrl+Shift+F', 'Format the body'], ['Ctrl+Space', 'Suggestions'], ['Ctrl+S', 'Save the query'], ['Ctrl+H', 'History'], ['Ctrl+1 … 6', 'Query · Documents · Mapping · Analyze · Compare · Cluster'], ['Ctrl+,', 'Settings'], ['F5', 'Refresh indices'], ['Ctrl+B', 'Hide / show the sidebar'], ['Tab / Shift+Tab', 'Indent / outdent']];
    host.replaceChildren(
      U.el('div', { class: 'page-head' }, U.el('h1', { text: 'Settings' })),
      section('Appearance',
        row('Theme', 'Dark, light, or follow Windows', segmented(A.THEMES, A.get('theme'), (v) => A.set({ theme: v }))),
        row('Accent colour', null, swatches()),
        row('Background', null, segmented(A.BACKGROUNDS, A.get('bg'), (v) => A.set({ bg: v }))),
        row('Text & UI size', null, segmented(A.SIZES, A.get('size'), (v) => A.set({ size: v })))),
      section('Requests',
        row('Time limit', 'How long to wait for an answer', pref('timeout', { 10: '10 s', 30: '30 s', 60: '1 min', 300: '5 min' }, true)),
        row('Ask before changing data', 'PUT, DELETE and POST requests that write (on connections that aren\'t read-only) ask first', toggle('confirmWrites')),
        row('History', 'Requests kept in History (Ctrl+H)', pref('historySize', { 50: '50', 200: '200', 1000: '1,000' }, true))),
      section('Editor',
        row('Font size', null, pref('editorSize', { 12: '12', 13: '13', 14: '14', 16: '16' }, true)),
        row('Tab width', null, pref('tabSize', { 2: '2', 4: '4' }, true)),
        row('Suggestions while typing', 'Query DSL keywords, and the index\'s fields from its mapping. Ctrl+Space shows them any time', toggle('autocomplete'))),
      section('Results',
        row('Table columns', 'How many _source fields the table shows at first (pick others with ⋯ in the table)', pref('tableCols', { 4: '4', 6: '6', 10: '10' }, true))),
      section('Compare A/B',
        row('Results compared', null, pref('compareTop', { 10: 'Top 10', 20: 'Top 20', 50: 'Top 50', 100: 'Top 100' }, true)),
        row('Runs per side', 'Timing is the median of these runs', pref('compareRuns', { 1: '1', 3: '3', 5: '5' }, true))),
      section('Cluster',
        row('Refresh the Cluster tab', 'While it\'s open', pref('clusterRefresh', { 0: 'By hand', 10: 'Every 10 s', 30: 'Every 30 s' }, true))),
      section('Connections',
        row('Saved clusters', `${C.list.length} on this PC. Passwords and API keys are encrypted with Windows' own protection and never leave Sift except to that cluster.`, U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Add a cluster', onclick: () => Sift.ui.connForm.add() }))),
      section('Keyboard', U.el('div', { class: 'keys' }, ...keys.map(([k, l]) => U.el('div', { class: 'key-row' }, U.el('kbd', { text: k }), U.el('span', { class: 'muted', text: l }))))),
      section('About',
        row('Version', `Sift ${Sift.config.APP_VERSION}${info.electron ? ` (Electron ${info.electron})` : ''}`, null),
        row('Works with', 'Elasticsearch 7, 8 and 9, and OpenSearch 1 and 2, over HTTP or HTTPS', null)));
  }

  Sift.ui.settings = { init: (h) => { host = h; }, show: render, hide() {} };
})();
