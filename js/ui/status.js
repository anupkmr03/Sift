/**
 * Status bar: cluster health (and unassigned shards), nodes, the highest heap and disk use
 * across nodes, version, sign-in, read-only. Heap and disk refresh every 60 s while Sift is focused.
 */
(function () {
  const U = Sift.utils;
  const C = Sift.conn;
  let host; let usage = null; let timer = 0;

  async function poll() {
    if (!C.current || !document.hasFocus()) return;
    const c = C.current;
    const r = await C.req('GET', '_cat/nodes?format=json&h=heap.percent,disk.used_percent', null, { timeout: 10 }).catch(() => null);
    if (C.current !== c) return;
    const rows = r && Array.isArray(r.json) ? r.json : null;
    usage = rows && rows.length ? { heap: Math.max(...rows.map((x) => Number(x['heap.percent']) || 0)), disk: Math.max(...rows.map((x) => Number(x['disk.used_percent']) || 0)) } : null;
    render();
  }

  function render() {
    if (!host) return;
    const c = C.current;
    if (!c) { host.replaceChildren(U.el('span', { class: 'muted', text: 'No cluster' })); return; }
    const h = C.health;
    host.replaceChildren(...[
      U.el('span', { class: 'st-item' }, Sift.fmt.dot(h && h.status), h ? `${h.status}${h.unassigned_shards ? ` · ${h.unassigned_shards} unassigned shard${h.unassigned_shards === 1 ? '' : 's'}` : ''}` : C.error ? 'not connected' : '…'),
      h ? U.el('span', { class: 'st-item muted', text: `${h.number_of_nodes} node${h.number_of_nodes === 1 ? '' : 's'}` }) : null,
      usage ? U.el('span', { class: 'st-item ' + (usage.heap >= 85 ? 'c-bad' : 'muted'), text: `heap ${usage.heap}%` }) : null,
      usage ? U.el('span', { class: 'st-item ' + (usage.disk >= 85 ? 'c-bad' : 'muted'), text: `disk ${usage.disk}%` }) : null,
      U.el('span', { class: 'spacer' }),
      c.readOnly ? U.el('span', { class: 'ro-badge', text: 'read-only' }) : null,
      U.el('span', { class: 'st-item muted', text: [C.info ? `${C.info.distribution} ${C.info.version || ''}` : null, c.auth === 'basic' ? 'user + password' : c.auth === 'apikey' ? 'API key' : 'no sign-in', /^https/.test(c.url) ? 'TLS' : 'HTTP'].filter(Boolean).join(' · ') }),
    ].filter(Boolean));
  }

  Sift.bus.on('conn:change', () => { usage = null; render(); setTimeout(poll, 1500); });
  ['conn:health', 'conn:indices'].forEach((e) => Sift.bus.on(e, render));
  Sift.ui.status = { init: (h) => { host = h; render(); clearInterval(timer); timer = setInterval(poll, 60000); }, render, poll };
})();
