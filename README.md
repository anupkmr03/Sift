# Sift

An offline Elasticsearch / OpenSearch workbench for Windows.

## Build

```
npm install
npm run dist        # → dist/Sift-Setup-1.0.0.exe and dist/Sift-Portable-1.0.0.exe
npm start           # run from source
```

## Features

1. **Connections**: any number of clusters (address, no sign-in / user + password / API key, self-signed
   certificates allowed per connection). **Read-only** connections only ever send reads: GET / HEAD, and POST to
   _search, _count, _msearch, _mget, _analyze, _explain, _validate, _field_caps, _termvectors (enforced in the main
   process; the page can't get round it). Passwords and keys are encrypted with Windows' DPAPI and never reach the page.
2. **Sidebar**: the cluster (health, version, nodes), its indices with health, document count, size and aliases
   (system indices hidden unless ticked), saved queries, all connections.
3. **Query** (Ctrl+1): method + path + body. The editor colours JSON, checks it as you type (line and column of
   the mistake), auto-indents, pairs brackets and quotes, and **suggests** Query DSL keywords for where you are and the
   index's fields from its mapping (Tab inserts). Run (Ctrl+Enter) / Stop, Format (Ctrl+Shift+F), Profile and Explain for
   one run, Copy as curl (password masked), History (Ctrl+H), Save (Ctrl+S). Writes ask first (Settings).
4. **Results**: status, hits, took, shards. Table (choose columns, highlighted matches, click a row for the full
   document and, with Explain, why it scored what it did), JSON, Aggs (bars; click one to filter by it), Profile
   (where the time went per shard). Save as JSON or the hits as CSV.
5. **Documents** (Ctrl+2): page through an index newest first, filter with a query string, sort by any field.
6. **Mapping** (Ctrl+3): every field with type and analyzer, counts per type, filter; shards, replicas, refresh,
   custom analyzers.
7. **Analyze** (Ctrl+4): the tokens a field or analyzer makes from your text, optionally step by step.
8. **Compare A/B** (Ctrl+5): the Query tab's search on two clusters (or indices): document counts and the gap,
   hits on each, top-N overlap with real reorders marked ↑ / ↓, timing (median of N runs), mapping differences, and
   top results only on one side checked by _id ("missing" vs "ranked lower"), with Copy IDs.
9. **Cluster** (Ctrl+6): health, nodes (heap, RAM, CPU, load, disk), shards not started with the reason, biggest
   indices. Status bar: health, nodes, highest heap and disk use.

## Code map

- `electron/es.js`: saved connections, the HTTP client (Node http/https, TLS option, 64 MB cap, cancel), read-only rules.
- `electron/main.js`, `preload.js` (`window.siftDesktop`), `protocol.js` (`sift://app/`).
- `js/conn.js`: current cluster, indices, aliases, mapping cache (`Sift.conn.fields(index)`), requests.
- `js/json.js`: JSON colouring, parse with line / column, NDJSON.
- `js/ui/editor.js`: the body editor and its suggestions. `results.js`: response views. `query.js`, `docs.js`,
  `mapping.js`, `analyze.js`, `compare.js`, `cluster.js`, `settings.js`, `sidebar.js`, `connform.js`, `status.js`.
- Shared with Graft: `utils.js`, `ui/menu.js`, `ui/dialog.js`, `ui/appearance.js`, `ui/icons.js`, `css/*` base files.

## Notes

- Tested against a mock Elasticsearch 8 (see CONTEXT.md); not yet against a real cluster.
- Documents paging uses from / size, so it stops at 10,000 (the default max_result_window); narrow the filter for more.
