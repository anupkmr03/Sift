/**
 * Small glass context menu.
 *   Sift.ui.menu.open(x, y, [
 *     { label: 'Play', onClick },
 *     { separator: true },
 *     { label: 'Delete', danger: true, onClick },
 *   ])
 * Closes on outside click, Esc, scroll or resize. Arrow keys move between items.
 */
(function () {
  const U = Sift.utils;
  let root = null;
  let returnFocus = null;

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }

  function onOutside(e) { if (root && !root.contains(e.target)) close(); }

  function onKey(e) {
    const items = [...root.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Tab') { close(); }
  }

  function open(x, y, items, title) {
    close();
    returnFocus = document.activeElement;
    root = U.el('div', { class: 'glass menu', role: 'menu', 'aria-label': title || 'Actions' });
    if (title) root.append(U.el('div', { class: 'menu-title', text: title }));
    items.forEach((item) => {
      if (item.separator) { root.append(U.el('div', { class: 'menu-sep', role: 'separator' })); return; }
      root.append(U.el('button', {
        type: 'button', role: 'menuitem',
        class: 'menu-item' + (item.danger ? ' is-danger' : ''),
        onclick: () => { close(); item.onClick(); },
      },
      U.el('span', { text: item.label }),
      item.hint ? U.el('span', { class: 'menu-hint', text: item.hint }) : null));
    });
    root.addEventListener('keydown', onKey);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(root);

    // Keep inside the window.
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    root.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    const minTop = document.documentElement.classList.contains('has-titlebar') ? 44 : 8; // stay below the title bar
    root.style.top = Math.max(minTop, Math.min(y, window.innerHeight - h - 8)) + 'px';
    const first = root.querySelector('button');
    if (first) first.focus();

    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
    });
  }

  Sift.ui = Sift.ui || {};
  Sift.ui.menu = { open, close, isOpen: () => !!root };
})();
