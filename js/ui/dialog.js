/**
 * Glass modal dialog.
 *   const d = Sift.ui.dialog.open({
 *     title: 'Rename', body: someNode,
 *     actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => true }],
 *   });
 * An action's onClick returning false keeps the dialog open. Enter in a single-line
 * input runs the primary action; Esc or a click outside cancels.
 */
(function () {
  const U = Sift.utils;
  let current = null;

  function close() {
    if (!current) return;
    const { overlay, returnFocus, onClose } = current;
    current = null;
    overlay.remove();
    if (onClose) onClose();
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  function open({ title, body, actions, onClose, wide }) {
    close();
    const titleId = 'dlg-' + Date.now();
    const footer = U.el('div', { class: 'dialog-actions' });
    let primary = null;

    (actions || [{ label: 'Close', primary: true }]).forEach((a) => {
      const btn = U.el('button', {
        type: 'button',
        class: 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-ghost btn-danger' : 'btn-ghost'),
        text: a.label,
        onclick: () => {
          const keep = a.onClick ? a.onClick() === false : false;
          if (!keep) close();
        },
      });
      if (a.primary) primary = btn;
      footer.append(btn);
    });

    const box = U.el('div', { class: 'glass dialog' + (wide ? ' dialog-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      U.el('h2', { id: titleId, class: 'dialog-title', text: title }),
      U.el('div', { class: 'dialog-body' }, body),
      footer);
    const overlay = U.el('div', { class: 'dialog-overlay' }, box);

    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep player / library shortcuts quiet while typing
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])') && !e.target.dataset.noSubmit && primary) {
        e.preventDefault();
        primary.click();
      }
    });

    current = { overlay, returnFocus: document.activeElement, onClose };
    document.body.append(overlay);
    const focusTarget = box.querySelector('[autofocus], input, textarea, select') || primary;
    if (focusTarget) focusTarget.focus();
    return { close, root: box };
  }

  /** Text prompt. Resolves with the trimmed value, or null if cancelled. */
  function prompt(title, { label, value, placeholder, okLabel } = {}) {
    return new Promise((resolve) => {
      let result = null;
      const input = U.el('input', { class: 'field', type: 'text', value: value || '', placeholder: placeholder || '', 'aria-label': label || title });
      open({
        title,
        body: U.el('div', { class: 'stack' }, label ? U.el('label', { class: 'muted small', text: label }) : null, input),
        actions: [
          { label: 'Cancel' },
          { label: okLabel || 'Save', primary: true, onClick: () => {
            if (!input.value.trim()) { input.focus(); return false; }
            result = input.value.trim();
            return true;
          } },
        ],
        onClose: () => resolve(result),
      });
      input.select();
    });
  }

  /** Yes/no confirmation. Resolves true or false. */
  function confirm(title, message, okLabel) {
    return new Promise((resolve) => {
      let ok = false;
      open({
        title,
        body: U.el('p', { class: 'dialog-text', text: message }),
        actions: [{ label: 'Cancel' }, { label: okLabel || 'OK', primary: true, onClick: () => { ok = true; } }],
        onClose: () => resolve(ok),
      });
    });
  }

  Sift.ui = Sift.ui || {};
  /** A message with just an OK button. */
  function alert(title, message) {
    return new Promise((resolve) => {
      open({
        title,
        body: Sift.utils.el('p', { class: 'dialog-text', style: 'white-space:pre-line', text: message }),
        actions: [{ label: 'OK', primary: true }],
        onClose: () => resolve(),
      });
    });
  }

  Sift.ui.dialog = { open, close, prompt, confirm, alert, isOpen: () => !!current };
})();
