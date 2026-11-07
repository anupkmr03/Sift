/**
 * Connections on the page side: the saved list, the current one, its cluster facts, and requests.
 *
 *   Sift.conn.list / current / select(id) / reload()
 *   Sift.conn.req(method, path, body, { id, timeout, quiet }) → { status, ms, json, text, size }
 *   Sift.conn.info       { name, version, distribution } of the current cluster
 *   Sift.conn.indices    [{ index, health, status, docs, size, pri, rep }] (+ aliases on each)
 *   Sift.conn.fields(index)  → [{ path, type }] from the mapping (cached)
 *   Sift.conn.index / setIndex(name)   the index picked in the sidebar
 *
 * Events: conn:list, conn:change, conn:indices, conn:index, conn:health
 */
(function () {
  const D = window.siftDesktop;
  const bus = Sift.bus;
  const C = {
    list: [], current: null, info: null, health: null, indices: [], aliases: [], index: null,
    mappingCache: new Map(), loading: false, error: null,
  };
  let reqSeq = 0;

  const byId = (id) => C.list.find((c) => c.id === id) || null;

  async function reload() {
    C.list = await D.list();
    bus.emit('conn:list');
    if (C.current && !byId(C.current.id)) { C.current = null; select(null); }
    else if (C.current) C.current = byId(C.current.id);
    return C.list;
  }

  async function select(id) {
    const c = id ? byId(id) : null;
    C.current = c; C.info = null; C.health = null; C.indices = []; C.aliases = []; C.mappingCache.clear(); C.error = null;
    C.index = c ? Sift.store.get('index:' + c.id, '') || null : null;
    Sift.store.set('lastConn', c ? c.id : '');
    bus.emit('conn:change', c);
    if (c) await refresh();
  }

  /** One request to the current (or a given) connection. */
  async function req(method, path, body, opts = {}) {
    const id = opts.id || (C.current && C.current.id);
    if (!id) throw new Error('Add or pick a cluster first.');
    const reqId = opts.reqId || 'r' + (++reqSeq);
    if (opts.onStart) opts.onStart(reqId);
    return D.request(id, method, path, body, { timeout: (opts.timeout || Sift.prefs.get('timeout')) * 1000, reqId });
  }
  const cancel = (reqId) => D.cancel(reqId);
  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  /** An Elasticsearch error body → one readable line. */
  function esError(r) {
    if (!r || !r.json || !r.json.error) return r && r.status >= 400 ? `The server answered ${r.status}` : null;
    const e = r.json.error;
    if (typeof e === 'string') return e;
    const root = (e.root_cause && e.root_cause[0]) || e;
    return `${root.type || e.type}: ${root.reason || e.reason || ''}`.trim();
  }

  /** Cluster facts + index list (and aliases). */
  async function refresh() {
    const c = C.current;
    if (!c) return;
    C.loading = true; bus.emit('conn:indices');
    try {
      const [root, health, idx, al] = await Promise.all([
        req('GET', '/', null, { timeout: 15 }),
        req('GET', '_cluster/health', null, { timeout: 15 }).catch(() => null),
        req('GET', '_cat/indices?format=json&bytes=b&h=index,health,status,docs.count,store.size,pri,rep&s=index', null, { timeout: 30 }),
        req('GET', '_cat/aliases?format=json&h=alias,index,is_write_index', null, { timeout: 30 }).catch(() => null),
      ]);
      if (C.current !== c) return;
      if (root.status === 401 || root.status === 403) throw new Error(`Signed out (${root.status}). Edit the connection to check the user name and password or API key.`);
      const v = root.json && root.json.version;
      C.info = { name: root.json && root.json.cluster_name, version: v && v.number, distribution: v && v.distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch' };
      C.health = health && health.json && !health.json.error ? health.json : null;
      C.aliases = al && Array.isArray(al.json) ? al.json : [];
      C.indices = (Array.isArray(idx.json) ? idx.json : []).map((i) => ({
        index: i.index, health: i.health, status: i.status, docs: Number(i['docs.count']) || 0, size: Number(i['store.size']) || 0, pri: i.pri, rep: i.rep,
        aliases: C.aliases.filter((a) => a.index === i.index).map((a) => a.alias),
      }));
      C.error = idx.status >= 400 ? esError(idx) : null;
      D.setTitle(`${c.name} — Sift`);
    } catch (e) {
      if (C.current === c) C.error = clean(e);
    } finally {
      if (C.current === c) { C.loading = false; bus.emit('conn:indices'); bus.emit('conn:health'); }
    }
  }

  async function refreshHealth() {
    if (!C.current) return;
    const c = C.current;
    const r = await req('GET', '_cluster/health', null, { timeout: 10 }).catch(() => null);
    if (C.current !== c) return;
    C.health = r && r.json && !r.json.error ? r.json : C.health;
    bus.emit('conn:health');
  }

  function setIndex(name) {
    C.index = name || null;
    if (C.current) Sift.store.set('index:' + C.current.id, name || '');
    bus.emit('conn:index', C.index);
  }

  /** Flattened mapping: [{ path, type, analyzer?, sub: bool }], merged across the indices a pattern / alias covers. */
  async function fields(index, opts = {}) {
    const target = index || C.index;
    if (!target || !C.current) return [];
    const key = (opts.id || C.current.id) + '|' + target;
    if (C.mappingCache.has(key)) return C.mappingCache.get(key);
    const p = (async () => {
      const r = await req('GET', encodeURIComponent(target).replace(/%2C/g, ',').replace(/%2A/g, '*') + '/_mapping', null, { id: opts.id, timeout: 30 });
      if (!r.json || r.status >= 400) return [];
      const out = new Map();
      const walk = (props, prefix) => Object.entries(props || {}).forEach(([k, v]) => {
        const p2 = prefix ? prefix + '.' + k : k;
        if (v.properties) { out.set(p2, { path: p2, type: v.type === 'nested' ? 'nested' : 'object', container: true }); walk(v.properties, p2); return; }
        out.set(p2, { path: p2, type: v.type || 'object', analyzer: v.analyzer || null });
        if (v.fields) Object.entries(v.fields).forEach(([sk, sv]) => out.set(p2 + '.' + sk, { path: p2 + '.' + sk, type: sv.type, sub: true, analyzer: sv.analyzer || null }));
      });
      Object.values(r.json).forEach((m) => {
        const mp = m.mappings || {};
        const props = mp.properties || (Object.values(mp)[0] || {}).properties;   // 6.x typed mappings
        walk(props, '');
      });
      return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
    })();
    C.mappingCache.set(key, p);
    return p.catch((e) => { C.mappingCache.delete(key); throw e; });
  }

  async function start() {
    await reload();
    const last = Sift.store.get('lastConn', '');
    await select(byId(last) ? last : (C.list[0] && C.list[0].id) || null);
  }

  Sift.conn = Object.assign(C, { reload, select, req, cancel, clean, esError, refresh, refreshHealth, setIndex, fields, start, byId });
})();
