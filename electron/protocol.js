/**
 * The sift:// protocol (main process): serves the app's own files from sift://app/…
 * (one origin, so the page gets its own storage). Nothing outside the app folder is served.
 */
const { protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'sift';

function registerPrivileged() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

const text = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

function register(appRoot) {
  const root = path.resolve(appRoot);
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return text(404, 'Not found');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (e) { return text(400, 'Bad path'); }
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = path.normalize(path.join(root, pathname));
    if (file !== root && !file.startsWith(root + path.sep)) return text(403, 'Forbidden');
    return net.fetch(pathToFileURL(file).toString());
  });
}

module.exports = { registerPrivileged, register, SCHEME };
