/**
 * Sift — an Elasticsearch / OpenSearch workbench, desktop app (Electron main process).
 *
 *   es.js   saved connections (secrets encrypted) and every HTTP request to a cluster
 *   here    window, IPC, files (export results, open links)
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const appProtocol = require('./protocol');
const es = require('./es');

const APP_ROOT = path.join(__dirname, '..');
const TITLEBAR_HEIGHT = 36;
appProtocol.registerPrivileged();

let win = null;
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => showWindow());

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadWindowState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1400, height: 900 }; } }
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch (e) { /* not fatal */ }
}

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    x: state.x, y: state.y, width: state.width || 1400, height: state.height || 900,
    minWidth: 980, minHeight: 620,
    backgroundColor: '#0a0d1c',
    title: 'Sift',
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e9edff', height: TITLEBAR_HEIGHT },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.control && input.shift && key === 'r') { win.webContents.reload(); event.preventDefault(); }
    else if (key === 'f11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    else if (key === 'f12' || (input.control && input.shift && key === 'i')) { win.webContents.toggleDevTools(); event.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('sift://app/')) event.preventDefault(); });
  ['resize', 'move', 'close'].forEach((ev) => win.on(ev, saveWindowState));
  win.on('closed', () => { win = null; });
  win.loadURL('sift://app/index.html');
}
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const msg = (e) => String((e && e.message) || e);

function registerIpc() {
  ipcMain.handle('es:list', () => es.list());
  ipcMain.handle('es:save', (_e, c) => { try { return es.save(c || {}); } catch (e) { throw new Error(msg(e)); } });
  ipcMain.handle('es:remove', (_e, id) => es.remove(String(id)));
  ipcMain.handle('es:reorder', (_e, ids) => es.reorder(Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.handle('es:test', async (_e, c) => { try { return await es.test(c || {}); } catch (e) { throw new Error(msg(e)); } });
  ipcMain.handle('es:request', async (_e, id, method, p, body, opts) => {
    try { return await es.request(String(id), String(method || 'GET'), String(p || ''), body, { timeout: Math.min(600000, Math.max(1000, Number(opts && opts.timeout) || 30000)), reqId: opts && opts.reqId ? String(opts.reqId) : null }); } catch (e) { throw new Error(msg(e)); }
  });
  ipcMain.handle('es:cancel', (_e, reqId) => es.cancel(String(reqId)));
  ipcMain.handle('es:is-read', (_e, method, p) => es.isRead(String(method), String(p)));

  ipcMain.handle('file:save', async (_e, name, text) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: String(name || 'results.json'), filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'CSV', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }] });
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, String(text ?? ''));
    return res.filePath;
  });
  ipcMain.handle('file:show', (_e, p) => { if (typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(p); return true; });
  ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, data: app.getPath('userData') }));
  ipcMain.handle('window:titlebar', (_e, color) => {
    if (!win || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return false;
    try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: color, height: TITLEBAR_HEIGHT }); } catch (e) { return false; }
    return true;
  });
  ipcMain.handle('window:title', (_e, t) => { if (win && typeof t === 'string') win.setTitle(t.slice(0, 200)); return true; });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.sift.workbench');
  Menu.setApplicationMenu(null);
  es.configure(app.getPath('userData'));
  appProtocol.register(APP_ROOT);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
