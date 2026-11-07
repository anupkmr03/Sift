/**
 * Preload: the small, safe bridge between the page and the desktop side (window.siftDesktop).
 * Secrets go in (save / test) but never come back out.
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('siftDesktop', {
  list: () => ipcRenderer.invoke('es:list'),
  save: (c) => ipcRenderer.invoke('es:save', c),
  remove: (id) => ipcRenderer.invoke('es:remove', id),
  reorder: (ids) => ipcRenderer.invoke('es:reorder', ids),
  test: (c) => ipcRenderer.invoke('es:test', c),
  request: (id, method, path, body, opts) => ipcRenderer.invoke('es:request', id, method, path, body, opts),
  cancel: (reqId) => ipcRenderer.invoke('es:cancel', reqId),
  isRead: (method, path) => ipcRenderer.invoke('es:is-read', method, path),
  saveFile: (name, text) => ipcRenderer.invoke('file:save', name, text),
  showFile: (p) => ipcRenderer.invoke('file:show', p),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),
  info: () => ipcRenderer.invoke('app:info'),
  setTitle: (t) => ipcRenderer.invoke('window:title', t),
  setZoom: (factor) => { const f = Number(factor); if (f >= 0.5 && f <= 2) webFrame.setZoomFactor(f); },
  setTitleBarSymbols: (color) => ipcRenderer.invoke('window:titlebar', color),
  titleBarHeight: 36,
  platform: process.platform,
});
