/**
 * Elasticsearch / OpenSearch access (main process). The page never holds a password or API key:
 * connections are saved here (secrets encrypted with Windows' DPAPI via safeStorage) and every
 * request goes through `request()`, which adds the sign-in and enforces read-only connections.
 *
 *   Connection: { id, name, url, auth: 'none' | 'basic' | 'apikey', user, insecureTls, readOnly, hasSecret }
 *   list() / save(conn) / remove(id) / test(conn) / request(id, method, path, body, { timeout, reqId }) / cancel(reqId)
 *
 * A read-only connection allows GET / HEAD, and POST only to endpoints that read
 * (_search, _count, _msearch, _mget, _analyze, _explain, _validate, _field_caps, _termvectors…).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { safeStorage } = require('electron');

let file = null;
const running = new Map();   // reqId → http.ClientRequest
const MAX_BODY = 64 * 1024 * 1024;

function configure(userData) { file = path.join(userData, 'connections.json'); }

// ---------------- storage
function readAll() { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function writeAll(list) { fs.writeFileSync(file, JSON.stringify(list, null, 1)); }
const enc = (s) => (safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(s).toString('base64') } : { plain: s });
const dec = (v) => { if (!v) return ''; try { return v.enc ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v.plain || ''; } catch (e) { return ''; } };
const publicView = (c) => ({ id: c.id, name: c.name, url: c.url, auth: c.auth || 'none', user: c.user || '', insecureTls: !!c.insecureTls, readOnly: !!c.readOnly, hasSecret: !!c.secret });

function list() { return readAll().map(publicView); }

function cleanUrl(u) {
  let url;
  try { url = new URL(String(u || '').trim()); } catch (e) { throw new Error('Type the address, for example https://localhost:9200'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The address must start with http:// or https://');
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** Saves a connection. `secret` undefined keeps the saved one; '' removes it. */
function save(c) {
  const all = readAll();
  const id = c.id && all.some((x) => x.id === c.id) ? c.id : crypto.randomBytes(6).toString('hex');
  const old = all.find((x) => x.id === id) || {};
  const auth = ['none', 'basic', 'apikey'].includes(c.auth) ? c.auth : 'none';
  const next = {
    id, name: String(c.name || '').trim().slice(0, 80) || new URL(cleanUrl(c.url)).host, url: cleanUrl(c.url),
    auth, user: auth === 'basic' ? String(c.user || '').slice(0, 200) : '',
    insecureTls: !!c.insecureTls, readOnly: !!c.readOnly,
    secret: auth === 'none' ? null : c.secret === undefined ? old.secret || null : c.secret ? enc(String(c.secret)) : null,
  };
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) all[i] = next; else all.push(next);
  writeAll(all);
  return publicView(next);
}
function remove(id) { writeAll(readAll().filter((x) => x.id !== id)); return true; }
function reorder(ids) { const all = readAll(); const by = new Map(all.map((c) => [c.id, c])); writeAll([...ids.map((i) => by.get(i)).filter(Boolean), ...all.filter((c) => !ids.includes(c.id))]); return list(); }

// ---------------- read-only guard
const READ_POST = /(^|\/)(_search|_msearch|_count|_mget|_analyze|_explain|_validate\/query|_field_caps|_termvectors|_mtermvectors|_rank_eval|_search\/scroll|_search\/template|_msearch\/template|_render\/template|_eql\/search|_sql|_async_search|_pit)(\/|$)/;
function isRead(method, p) {
  const m = method.toUpperCase();
  const bare = p.split('?')[0];
  if (m === 'GET' || m === 'HEAD') return true;
  if (m === 'POST') return READ_POST.test(bare) && !/\/_delete_by_query|\/_update_by_query/.test(bare);
  if (m === 'DELETE') return /(^|\/)(_search\/scroll|_pit)(\/|$)/.test(bare);
  return false;
}

// ---------------- requests
function authHeader(c, secret) {
  if (c.auth === 'basic') return 'Basic ' + Buffer.from(`${c.user}:${secret}`).toString('base64');
  if (c.auth === 'apikey') return 'ApiKey ' + secret;
  return null;
}

function send(c, secret, method, p, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const m = String(method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'].includes(m)) { reject(new Error('Unknown method ' + m)); return; }
    let rel = String(p || '').trim();
    if (/^[a-z]+:\/\//i.test(rel)) { reject(new Error('Type only the path (e.g. my-index/_search); the address comes from the connection.')); return; }
    rel = rel.replace(/^\/+/, '');
    if (c.readOnly && !isRead(m, rel)) { reject(Object.assign(new Error(`"${c.name}" is read-only: ${m} /${rel.split('?')[0]} would change data. Edit the connection to allow writes.`), { readOnly: true })); return; }
    const base = new URL(c.url + '/');
    const target = new URL(rel, base);
    if (target.origin !== base.origin) { reject(new Error('That path leaves the cluster\'s address.')); return; }
    const lib = target.protocol === 'https:' ? https : http;
    const data = body == null || body === '' ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { Accept: 'application/json', 'User-Agent': 'Sift' };
    if (data) { headers['Content-Type'] = /_bulk|_msearch/.test(rel) ? 'application/x-ndjson' : 'application/json'; headers['Content-Length'] = data.length; }
    const a = authHeader(c, secret);
    if (a) headers.Authorization = a;
    const t0 = process.hrtime.bigint();
    const req = lib.request(target, { method: m, headers, rejectUnauthorized: !c.insecureTls, timeout: opts.timeout || 30000 }, (res) => {
      const chunks = []; let size = 0; let cut = false;
      res.on('data', (d) => { if (size + d.length > MAX_BODY) { cut = true; return; } chunks.push(d); size += d.length; });
      res.on('end', () => {
        if (opts.reqId) running.delete(opts.reqId);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (/json/i.test(res.headers['content-type'] || '') || /^\s*[[{]/.test(text)) { try { json = JSON.parse(text); } catch (e) { json = null; } }
        resolve({ status: res.statusCode, ms: Math.round(ms * 10) / 10, size, truncated: cut, json, text: json ? null : text.slice(0, 2 * 1024 * 1024), headers: { 'content-type': res.headers['content-type'] || '', 'x-elastic-product': res.headers['x-elastic-product'] || '', warning: res.headers.warning || '' } });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`No answer within ${Math.round((opts.timeout || 30000) / 1000)} s.`)));
    req.on('error', (e) => {
      if (opts.reqId) running.delete(opts.reqId);
      const msg = e.code === 'ECONNREFUSED' ? `Nothing is listening at ${base.host}. Is the cluster running?`
        : e.code === 'ENOTFOUND' ? `Can't find the server ${base.hostname}.`
        : /self.signed|unable to verify|certificate/i.test(e.message) ? 'The server\'s certificate isn\'t trusted. If it\'s your own dev cluster, edit the connection and allow self-signed certificates.'
        : e.message === 'socket hang up' && opts.cancelled ? 'Stopped.' : e.message;
      reject(new Error(msg));
    });
    if (opts.reqId) running.set(opts.reqId, req);
    if (data) req.write(data);
    req.end();
  });
}

function request(id, method, p, body, opts) {
  const c = readAll().find((x) => x.id === id);
  if (!c) return Promise.reject(new Error('That connection was removed.'));
  return send({ ...c, auth: c.auth || 'none' }, dec(c.secret), method, p, body, opts);
}

/** Tries a connection before it's saved (secret given in clear, or the saved one when editing). */
async function test(c) {
  const saved = c.id ? readAll().find((x) => x.id === c.id) : null;
  const secret = c.secret !== undefined ? c.secret : saved ? dec(saved.secret) : '';
  const conn = { name: c.name || 'cluster', url: cleanUrl(c.url), auth: c.auth || 'none', user: c.user || '', insecureTls: !!c.insecureTls, readOnly: true };
  const r = await send(conn, secret, 'GET', '/', null, { timeout: 10000 });
  if (r.status === 401 || r.status === 403) throw new Error(`Signed out (${r.status}): check the user name and password or API key.`);
  if (r.status >= 400) throw new Error(`The server answered ${r.status}.`);
  const v = r.json && r.json.version;
  return { name: r.json && (r.json.cluster_name || r.json.name), version: v && v.number, distribution: (v && v.distribution) || (r.headers['x-elastic-product'] ? 'elasticsearch' : 'elasticsearch'), ms: r.ms };
}

function cancel(reqId) { const r = running.get(reqId); if (r) { r.destroy(new Error('Stopped.')); running.delete(reqId); } return !!r; }

module.exports = { configure, list, save, remove, reorder, test, request, cancel, isRead };
