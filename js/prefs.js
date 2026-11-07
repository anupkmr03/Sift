/**
 * User preferences from Settings (localStorage). Sift.prefs.get(key) / set(key, value) → 'prefs:change'.
 */
(function () {
  const store = Sift.store;
  const DEFAULTS = {
    timeout: 30,            // seconds before a request gives up
    confirmWrites: true,    // ask before PUT / DELETE / POST that changes data (on connections that allow it)
    historySize: 200,       // requests kept in History
    editorSize: 13,         // editor font size (px)
    tabSize: 2,
    autocomplete: true,     // field and keyword suggestions while typing
    compareRuns: 3,         // runs per cluster for the timing (median)
    compareTop: 20,         // results compared in Compare A/B
    tableCols: 6,           // _source fields shown as table columns
    clusterRefresh: 0,      // seconds; 0 = only when you press Refresh
    splitQuery: 0.42,       // editor share of the width
  };
  function get(key) {
    const raw = store.get('pref.' + key, null);
    if (raw == null) return DEFAULTS[key];
    try { return JSON.parse(raw); } catch (e) { return DEFAULTS[key]; }
  }
  function set(key, value) {
    if (!(key in DEFAULTS)) return;
    store.set('pref.' + key, JSON.stringify(value));
    Sift.bus.emit('prefs:change', { key, value });
  }
  Sift.prefs = { get, set, DEFAULTS };
})();
