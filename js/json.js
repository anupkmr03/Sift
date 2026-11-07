/**
 * JSON helpers: syntax colouring (one pass, escapes everything), pretty printing, parse with a
 * readable error (line and column), and NDJSON for _bulk / _msearch.
 *
 *   Sift.json.html(text)         → HTML with <span class="j-key|j-str|j-num|j-lit|j-pun">
 *   Sift.json.parse(text)        → { ok, value } | { ok: false, error, line, col }
 *   Sift.json.pretty(value, tab) → string
 *   Sift.json.isNd(path)         → true for _bulk / _msearch bodies (one JSON per line)
 */
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TOKEN = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])|(\/\/[^\n]*)/g;

  function html(text) {
    let out = '';
    let last = 0;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
      if (m.index > last) out += esc(text.slice(last, m.index));
      if (m[1] != null) out += m[2] != null ? `<span class="j-key">${esc(m[1])}</span>${esc(m[2])}` : `<span class="j-str">${esc(m[1])}</span>`;
      else if (m[3] != null) out += `<span class="j-num">${m[3]}</span>`;
      else if (m[4] != null) out += `<span class="j-lit">${m[4]}</span>`;
      else if (m[5] != null) out += `<span class="j-pun">${m[5]}</span>`;
      else out += `<span class="j-com">${esc(m[6])}</span>`;
      last = TOKEN.lastIndex;
      if (m[0] === '') TOKEN.lastIndex++;
    }
    return out + esc(text.slice(last));
  }

  function where(text, pos) {
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    return { line, col: pos - before.lastIndexOf('\n') };
  }

  function parse(text) {
    const t = String(text || '');
    if (!t.trim()) return { ok: true, value: null, empty: true };
    try { return { ok: true, value: JSON.parse(t) }; } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const lc = /line (\d+) column (\d+)/.exec(e.message);
      const at = m ? where(t, Number(m[1])) : lc ? { line: Number(lc[1]), col: Number(lc[2]) } : { line: null, col: null };
      const reason = e.message.replace(/ in JSON at position \d+.*$/, '').replace(/\s*\(line \d+ column \d+\)/, '').replace(/^JSON\.parse: /, '');
      return { ok: false, error: reason, ...at };
    }
  }

  const pretty = (v, tab) => JSON.stringify(v, null, tab || 2);
  const isNd = (p) => /(^|\/)(_bulk|_msearch)(\/|\?|$)/.test(String(p || '').split('?')[0]) || /(^|\/)_msearch\/template/.test(p || '');

  /** NDJSON: every non-empty line must be JSON. */
  function parseNd(text) {
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { JSON.parse(lines[i]); } catch (e) { return { ok: false, error: e.message.replace(/ in JSON at position \d+.*$/, ''), line: i + 1, col: 1 }; }
    }
    return { ok: true };
  }

  Sift.json = { html, parse, parseNd, pretty, isNd, esc };
})();
