/**
 * Small helpers shared by every module: formatting, DOM building,
 * an event bus, localStorage wrapper and toasts.
 */
(function () {
  const C = Sift.config;

  const utils = {
    $(selector, root) {
      return (root || document).querySelector(selector);
    },

    /** el('div', { class: 'x', text: 'hi', onclick: fn }, child1, child2) */
    el(tag, attrs, ...children) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value; // only used with static, trusted markup
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      }
      for (const child of children) {
        if (child == null || child === false) continue;
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
      }
      return node;
    },

    fmtTime(seconds) {
      if (!isFinite(seconds) || seconds < 0) return '--:--';
      const s = Math.floor(seconds);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    },

    fmtBytes(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let n = bytes;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return (n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
    },

    timeAgo(ts) {
      if (!ts) return '';
      const sec = (Date.now() - ts) / 1000;
      const day = 86400;
      const fmt = (n, unit) => {
        const v = Math.max(1, Math.floor(n));
        return `${v} ${unit}${v > 1 ? 's' : ''} ago`;
      };
      if (sec < 60) return 'just now';
      if (sec < 3600) return fmt(sec / 60, 'minute');
      if (sec < day) return fmt(sec / 3600, 'hour');
      if (sec < 7 * day) return fmt(sec / day, 'day');
      if (sec < 30 * day) return fmt(sec / (7 * day), 'week');
      if (sec < 365 * day) return fmt(sec / (30 * day), 'month');
      return fmt(sec / (365 * day), 'year');
    },

    extension(name) {
      const i = name.lastIndexOf('.');
      return i === -1 ? '' : name.slice(i + 1).toLowerCase();
    },

    /** "November 2025" */
    monthLabel(ts) {
      return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    },

    /** "Mon, 3 Nov 2025" (the year is left out for this year) */
    dayLabel(ts) {
      const d = new Date(ts);
      const opts = { weekday: 'short', day: 'numeric', month: 'short' };
      if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
      return d.toLocaleDateString(undefined, opts);
    },

    /** "3 Nov 2025, 6:42 pm" */
    dateTime(ts) {
      return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    },

    debounce(fn, ms) {
      let t;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    clamp(n, min, max) {
      return Math.min(max, Math.max(min, n));
    },
  };

  /** Tiny publish/subscribe bus so modules don't import each other directly. */
  const bus = {
    handlers: {},
    on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); },
    emit(event, data) { (this.handlers[event] || []).forEach((fn) => fn(data)); },
  };

  /** localStorage that never throws (private mode, blocked storage, etc.). */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(C.STORAGE_PREFIX + key);
        return v == null ? fallback : v;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(C.STORAGE_PREFIX + key, String(value)); } catch (e) { /* ignore */ }
    },
  };

  /**
   * Short message at the bottom. `opts.action` = { label, onClick } adds a button
   * (e.g. Undo); `opts.onExpire` runs if the toast times out without the button being used.
   * Returns { close }.
   */
  function toast(message, ms = 3200, opts = {}) {
    const host = utils.$('#toasts');
    if (!host) return { close() {} };
    const node = utils.el('div', { class: 'toast' + (opts.action ? ' has-action' : ''), role: 'status' }, utils.el('span', { text: message }));
    let done = false;
    const close = () => { if (!done) { done = true; clearTimeout(timer); node.remove(); } };
    if (opts.action) {
      node.append(utils.el('button', {
        type: 'button', class: 'toast-action', text: opts.action.label,
        onclick: () => { close(); opts.action.onClick(); },
      }));
    }
    host.append(node);
    const timer = setTimeout(() => {
      if (done) return;
      close();
      if (opts.onExpire) opts.onExpire();
    }, ms);
    return { close };
  }

  Sift.utils = utils;
  Sift.bus = bus;
  Sift.store = store;
  Sift.toast = toast;
})();
