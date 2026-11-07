// A small fake Elasticsearch 8 for Sift's tests: enough of _search (match_all, match, match_phrase,
// term, bool, query_string, ids, range), highlight, terms aggs, explain, profile, _count, _mapping,
// _settings, _analyze, _cat/*, _cluster/health. Two flavours: A, and B (basic auth, 2 docs missing,
// one field typed differently, slightly different scores).
const http = require('http');

function dataset(flavour) {
  const repos = ['Search.Indexer', 'Search.Common', 'Search.Crawler', 'Search.Docs', 'Search.Infra'];
  const docs = [];
  const phrases = ['retry policy', 'backoff', 'dead letter queue', 'service bus', 'bulk indexing'];
  for (let i = 0; i < 240; i++) {
    const repo = repos[i % repos.length];
    const ph = phrases[i % phrases.length];
    docs.push({ _id: 'doc-' + i, _source: {
      path: `src/${repo.split('.')[1]}/File${i}.cs`, repo: { name: repo, sizeKb: 100 + i }, branch: i % 7 ? 'main' : 'release',
      content: `// ${i} This module configures the ${ph} for Service Bus receivers. ${i % 3 ? 'retry policy' : 'jitter'} handling ${i}.`,
      indexedAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), lines: 50 + (i * 7) % 900,
    } });
  }
  if (flavour === 'B') { docs.splice(docs.findIndex((d) => d._id === 'doc-5'), 1); docs.splice(docs.findIndex((d) => d._id === 'doc-10'), 1); }
  return docs;
}

const MAPPING = (flavour) => ({ properties: {
  path: { type: 'keyword' }, branch: { type: 'keyword' },
  repo: { properties: { name: { type: 'keyword' }, sizeKb: { type: flavour === 'B' ? 'integer' : 'long' } } },
  content: { type: 'text', analyzer: 'code_analyzer', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
  indexedAt: { type: 'date' }, lines: { type: 'integer' },
} });

function get(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function matches(doc, q) {
  if (!q || q.match_all) return true;
  const s = doc._source;
  if (q.bool) {
    const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
    return arr(q.bool.must).every((c) => matches(doc, c)) && arr(q.bool.filter).every((c) => matches(doc, c)) && !arr(q.bool.must_not).some((c) => matches(doc, c)) && (arr(q.bool.should).length === 0 || arr(q.bool.must).length || arr(q.bool.filter).length || arr(q.bool.should).some((c) => matches(doc, c)));
  }
  const fv = (m) => { const [f, v] = Object.entries(m)[0]; return [f, typeof v === 'object' && v !== null && !Array.isArray(v) ? (v.query ?? v.value) : v]; };
  if (q.match || q.match_phrase) { const [f, v] = fv(q.match || q.match_phrase); return String(get(s, f.replace(/\.keyword$/, '')) || '').toLowerCase().includes(String(v).toLowerCase()); }
  if (q.term) { const [f, v] = fv(q.term); return String(get(s, f)) === String(v); }
  if (q.terms) { const [f, v] = Object.entries(q.terms)[0]; return v.map(String).includes(String(get(s, f))); }
  if (q.ids) return q.ids.values.includes(doc._id);
  if (q.range) { const [f, r] = Object.entries(q.range)[0]; const x = get(s, f); return (r.gte == null || x >= r.gte) && (r.lte == null || x <= r.lte) && (r.gt == null || x > r.gt) && (r.lt == null || x < r.lt); }
  if (q.query_string) return q.query_string.query.split(/\s+AND\s+/).every((part) => { const m = /^([\w.]+):(.+)$/.exec(part.trim()); return m ? String(get(s, m[1]) || '').toLowerCase().includes(m[2].replace(/"/g, '').toLowerCase()) : JSON.stringify(s).toLowerCase().includes(part.toLowerCase()); });
  return true;
}
function score(doc, q, flavour) {
  const text = JSON.stringify(q).match(/"(?:match|match_phrase)":\{"[^"]+":(?:"([^"]+)"|\{"query":"([^"]+)")/);
  const w = text ? (text[1] || text[2]).toLowerCase() : null;
  const n = Number(doc._id.split('-')[1]);
  let sc = w ? (doc._source.content.toLowerCase().split(w).length - 1) * 5 + (1000 - n) / 100 : 1;
  if (flavour === 'B' && (n === 15 || n === 20)) sc += 2.1;   // B ranks a couple of docs higher
  if (flavour === 'B' && n === 40) sc += 0.5;                  // …and moves one above its neighbours
  return Math.round(sc * 1000) / 1000;
}
function analyze(text) { const out = []; let pos = 0; String(text).replace(/[A-Za-z0-9]+/g, (m, off) => { out.push({ token: m.toLowerCase(), start_offset: off, end_offset: off + m.length, type: /^\d+$/.test(m) ? '<NUM>' : '<ALPHANUM>', position: pos++ }); return m; }); return out; }

function create(flavour, port) {
  const docs = dataset(flavour);
  const indices = { 'code-search-v12': docs, 'wiki-pages-v4': docs.slice(0, 30) };
  const aliases = [{ alias: 'code-search', index: 'code-search-v12' }];
  const resolve = (name) => (indices[name] ? name : (aliases.find((a) => a.alias === name) || {}).index);
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-elastic-product': 'Elasticsearch' }); res.end(JSON.stringify(obj)); };
      srv.log.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
      if (flavour === 'B' && req.headers.authorization !== 'Basic ' + Buffer.from('elastic:changeme').toString('base64')) return send(401, { error: { root_cause: [{ type: 'security_exception', reason: 'missing authentication credentials' }], type: 'security_exception', reason: 'missing authentication credentials' }, status: 401 });
      const u = new URL(req.url, 'http://x');
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      let json = null; try { json = body ? JSON.parse(body) : null; } catch (e) { return send(400, { error: { type: 'parse_exception', reason: 'request body is not valid JSON' }, status: 400 }); }
      const p0 = parts[0] || '';
      if (!parts.length) return send(200, { name: 'node-1', cluster_name: flavour === 'A' ? 'cluster-a' : 'cluster-b', version: { number: '8.13.2', distribution: undefined } });
      if (p0 === '_cluster' && parts[1] === 'health') return send(200, { cluster_name: 'c', status: flavour === 'A' ? 'yellow' : 'green', number_of_nodes: 3, number_of_data_nodes: 3, active_primary_shards: 12, active_shards: 23, relocating_shards: 0, initializing_shards: 0, unassigned_shards: flavour === 'A' ? 1 : 0, number_of_pending_tasks: 0 });
      if (p0 === '_cluster' && parts[1] === 'pending_tasks') return send(200, { tasks: [] });
      if (p0 === '_cat' && parts[1] === 'indices') return send(200, Object.entries(indices).map(([k, v]) => ({ index: k, health: k === 'wiki-pages-v4' && flavour === 'A' ? 'yellow' : 'green', status: 'open', 'docs.count': String(v.length * 5000000), 'store.size': String(v.length * 3e9), pri: '6', rep: '1' })).concat([{ index: '.security-7', health: 'green', status: 'open', 'docs.count': '40', 'store.size': '10000', pri: '1', rep: '0' }]));
      if (p0 === '_cat' && parts[1] === 'aliases') return send(200, aliases.map((a) => ({ ...a, is_write_index: '-' })));
      if (p0 === '_cat' && parts[1] === 'nodes') return send(200, [1, 2, 3].map((n) => ({ name: 'node-' + n, ip: '10.0.0.' + n, 'node.role': 'cdfhimrstw', master: n === 1 ? '*' : '-', 'heap.percent': String(40 + n * 7), 'ram.percent': '88', cpu: String(10 * n), load_1m: '0.4' + n, 'disk.used_percent': String(60 + n * 4), version: '8.13.2' })));
      if (p0 === '_cat' && parts[1] === 'shards') return send(200, [{ index: 'wiki-pages-v4', shard: '0', prirep: 'r', state: flavour === 'A' ? 'UNASSIGNED' : 'STARTED', 'unassigned.reason': flavour === 'A' ? 'NODE_LEFT' : null, node: null }, { index: 'code-search-v12', shard: '0', prirep: 'p', state: 'STARTED', node: 'node-1' }]);
      if (p0 === '_analyze' || parts[1] === '_analyze') {
        const toks = analyze(json && json.text);
        if (json && json.explain) return send(200, { detail: { custom_analyzer: true, charfilters: [], tokenizer: { name: 'standard', tokens: toks.map((t) => ({ ...t, token: t.token })) }, tokenfilters: [{ name: 'lowercase', tokens: toks }] } });
        return send(200, { tokens: toks });
      }
      const idxName = resolve(p0);
      if (req.method === 'PUT' && parts.length === 1) { indices[p0] = []; return send(200, { acknowledged: true, index: p0 }); }
      if (req.method === 'DELETE' && parts.length === 1) { if (!indices[p0]) return send(404, { error: { type: 'index_not_found_exception', reason: 'no such index [' + p0 + ']' }, status: 404 }); delete indices[p0]; return send(200, { acknowledged: true }); }
      if (!idxName) return send(404, { error: { root_cause: [{ type: 'index_not_found_exception', reason: `no such index [${p0}]` }], type: 'index_not_found_exception', reason: `no such index [${p0}]` }, status: 404 });
      const data = indices[idxName];
      if (parts[1] === '_mapping') return send(200, { [idxName]: { mappings: MAPPING(flavour) } });
      if (parts[1] === '_settings') return send(200, { [idxName]: { settings: { index: { number_of_shards: '6', number_of_replicas: '1', uuid: 'abc123', creation_date: '1793000000000', analysis: { analyzer: { code_analyzer: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'word_delimiter_graph'] } } } } } } });
      if (parts[1] === '_count') { const q = json && json.query; return send(200, { count: data.filter((d) => matches(d, q)).length * (q ? 1 : 5000000), _shards: { total: 6, successful: 6, failed: 0 } }); }
      if (parts[1] === '_search') {
        const q = (json && json.query) || { match_all: {} };
        let hits = data.filter((d) => matches(d, q)).map((d) => ({ _index: idxName, _id: d._id, _score: score(d, q, flavour), _source: d._source }));
        if (json && json.sort) { const [f, o] = Object.entries(json.sort[0])[0]; const dir = (o.order || o) === 'desc' ? -1 : 1; hits.sort((a, b) => (get(a._source, f) > get(b._source, f) ? dir : -dir)); hits.forEach((h) => { h._score = null; h.sort = [get(h._source, f)]; }); }
        else hits.sort((a, b) => b._score - a._score || a._id.localeCompare(b._id));
        const total = hits.length;
        const from = (json && json.from) || 0; const size = json && json.size != null ? json.size : 10;
        const pageHits = hits.slice(from, from + size).map((h) => {
          const out = { ...h };
          if (json && json.highlight) { const w = (JSON.stringify(q).match(/"(?:match|match_phrase)":\{"content":(?:"([^"]+)"|\{"query":"([^"]+)")/) || []).slice(1).find(Boolean); if (w) out.highlight = { content: [h._source.content.replace(new RegExp(w, 'gi'), (m) => `<em>${m}</em>`)] }; }
          if (json && json.explain) out._explanation = { value: h._score, description: 'sum of:', details: [{ value: h._score * 0.8, description: 'weight(content:retry in 0) [PerFieldSimilarity], result of:', details: [{ value: 2.2, description: 'idf, computed as log(1 + (N - n + 0.5) / (n + 0.5)) from:', details: [] }] }, { value: h._score * 0.2, description: 'weight(content:policy in 0)', details: [] }] };
          if (json && json._source === false) delete out._source;
          return out;
        });
        const resp = { took: flavour === 'A' ? 42 : 47, timed_out: false, _shards: { total: 6, successful: 6, skipped: 0, failed: 0 }, hits: { total: { value: total, relation: 'eq' }, max_score: pageHits[0] ? pageHits[0]._score : null, hits: pageHits } };
        if (json && json.aggs) { resp.aggregations = {}; Object.entries(json.aggs).forEach(([n, a]) => { if (a.terms) { const c = new Map(); hits.forEach((h) => { const v = get(h._source, a.terms.field); c.set(v, (c.get(v) || 0) + 1); }); resp.aggregations[n] = { doc_count_error_upper_bound: 0, sum_other_doc_count: 0, buckets: [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, a.terms.size || 10).map(([key, doc_count]) => ({ key, doc_count })) }; } else if (a.avg) resp.aggregations[n] = { value: hits.reduce((s, h) => s + (get(h._source, a.avg.field) || 0), 0) / Math.max(1, hits.length) }; }); }
        if (json && json.profile) resp.profile = { shards: [{ id: '[node-1][code-search-v12][0]', searches: [{ query: [{ type: 'BooleanQuery', description: 'content:"retry policy" #repo.name:Search.Indexer', time_in_nanos: 2400000, children: [{ type: 'PhraseQuery', description: 'content:"retry policy"', time_in_nanos: 1800000 }, { type: 'TermQuery', description: 'repo.name:Search.Indexer', time_in_nanos: 400000 }] }], collector: [{ name: 'QueryPhaseCollector', reason: 'search_query_phase', time_in_nanos: 300000 }] }], aggregations: [] }] };
        return send(200, resp);
      }
      if (parts[1] === '_doc' && req.method === 'GET') { const d = data.find((x) => x._id === parts[2]); return d ? send(200, { _index: idxName, _id: d._id, found: true, _source: d._source }) : send(404, { found: false }); }
      return send(400, { error: { type: 'illegal_argument_exception', reason: 'mock: unsupported ' + req.method + ' ' + u.pathname }, status: 400 });
    });
  });
  srv.log = [];
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
module.exports = { create };
if (require.main === module) { create('A', 19200); create('B', 19201); console.log('mock A :19200, B :19201'); }
