// js/ui.js — generic UI primitives: icons, toasts, modals, confirm dialogs, menus, empty/loading states.

import { ICONS } from './icons.js';
import { h, s, clear } from './utils.js';

/* --------------------------------------------------------------- Icons */

export function icon(name, { size = 18, className = '', strokeWidth = 2 } = {}) {
  const nodes = ICONS[name] || ICONS.circle;
  return s('svg', {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size,
    fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', class: `icon ${className}`.trim(), 'aria-hidden': 'true', focusable: 'false',
  }, nodes.map(([tag, attrs]) => s(tag, attrs)));
}

/* -------------------------------------------------------------- Toasts */

let toastStack = null;
export function toast(message, { type = 'info', action = null, timeout = 4000 } = {}) {
  if (!toastStack) {
    toastStack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastStack);
  }
  const iconName = { success: 'circle-check', error: 'circle-alert', warning: 'triangle-alert', info: 'info' }[type] || 'info';
  const el = h('div', { class: `toast toast-${type}` },
    icon(iconName, { size: 18 }),
    h('span', { class: 'toast-msg' }, message),
    action ? h('button', { class: 'toast-action', type: 'button', onClick: () => { action.fn(); dismiss(); } }, action.label) : null,
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onClick: () => dismiss() }, icon('x', { size: 14 })),
  );
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  toastStack.appendChild(el);
  while (toastStack.children.length > 4) toastStack.firstChild.remove();
  if (timeout) timer = setTimeout(dismiss, action ? Math.max(timeout, 6000) : timeout);
  return dismiss;
}

/* -------------------------------------------------------------- Modals */

const openModals = [];

/**
 * openModal({ title, subtitle, body: Node, footer: Node[], size: 'sm'|'md'|'lg'|'drawer', onClose })
 * Returns { close, el, body }.
 */
export function openModal({ title, subtitle, body, footer, size = 'md', onClose, dismissible = true, className = '' }) {
  const previouslyFocused = document.activeElement;
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const panel = h('div', {
    class: `modal modal-${size} ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1',
  },
  h('div', { class: 'modal-head' },
    h('div', { class: 'modal-titles' },
      h('h2', { id: titleId, class: 'modal-title' }, title || ''),
      subtitle ? h('p', { class: 'modal-subtitle' }, subtitle) : null),
    dismissible ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x')) : null),
  bodyEl,
  footer ? h('div', { class: 'modal-foot' }, footer) : null);
  const backdrop = h('div', { class: `modal-backdrop ${size === 'drawer' ? 'is-drawer' : ''}` }, panel);
  let closed = false;

  function close(result) {
    if (closed) return;
    closed = true;
    backdrop.classList.add('leaving');
    document.removeEventListener('keydown', onKey, true);
    const idx = openModals.indexOf(api);
    if (idx >= 0) openModals.splice(idx, 1);
    setTimeout(() => backdrop.remove(), 180);
    if (!openModals.length) document.body.classList.remove('modal-open');
    onClose?.(result);
    if (previouslyFocused && previouslyFocused.focus) setTimeout(() => previouslyFocused.focus(), 0);
  }
  function onKey(e) {
    if (openModals[openModals.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(panel, e);
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const api = { close, el: panel, body: bodyEl, backdrop };
  openModals.push(api);
  requestAnimationFrame(() => {
    const first = panel.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
    (first || panel).focus({ preventScroll: true });
  });
  return api;
}

function trapFocus(container, e) {
  const items = [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export const closeAllModals = () => [...openModals].reverse().forEach((m) => m.close());
export const hasOpenModal = () => openModals.length > 0;

/**
 * confirmDialog({ title, message, confirmText, danger, checkbox: { label, checked } })
 * Resolves to false, or true / { checked } when confirmed.
 */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, checkbox = null }) {
  return new Promise((resolve) => {
    let result = false;
    const cb = checkbox ? h('input', { type: 'checkbox', checked: !!checkbox.checked }) : null;
    const confirmBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => { result = checkbox ? { checked: cb.checked } : true; modal.close(); } }, confirmText);
    const modal = openModal({
      title, size: 'sm',
      body: h('div', { class: 'confirm-body' },
        message ? h('p', {}, message) : null,
        cb ? h('label', { class: 'check-row' }, cb, h('span', {}, checkbox.label)) : null),
      footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, cancelText), confirmBtn],
      onClose: () => resolve(result),
    });
    setTimeout(() => confirmBtn.focus(), 30);
  });
}

/* --------------------------------------------------------------- Menus */

let openMenuEl = null;

/**
 * Popover menu anchored to an element.
 * items: [{ label, icon, onClick, danger, checked, disabled, children: [...] } | { separator: true } | { heading }]
 */
export function popMenu(anchor, items, { align = 'end' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  const render = (list, back) => {
    clear(menu);
    if (back) menu.appendChild(h('button', { class: 'menu-item menu-back', type: 'button', onClick: (e) => { e.stopPropagation(); render(items); } }, icon('chevron-left', { size: 16 }), h('span', {}, back)));
    for (const it of list) {
      if (!it) continue;
      if (it.separator) { menu.appendChild(h('div', { class: 'menu-sep' })); continue; }
      if (it.heading) { menu.appendChild(h('div', { class: 'menu-heading' }, it.heading)); continue; }
      menu.appendChild(h('button', {
        class: `menu-item ${it.danger ? 'is-danger' : ''} ${it.checked ? 'is-checked' : ''}`, type: 'button', role: 'menuitem', disabled: !!it.disabled,
        onClick: (e) => {
          e.stopPropagation();
          if (it.children) { render(it.children, it.label); return; }
          closeMenu();
          it.onClick?.();
        },
      },
      it.swatch ? h('span', { class: 'menu-swatch', style: { background: it.swatch } }) : it.icon ? icon(it.icon, { size: 16 }) : h('span', { class: 'menu-icon-space' }),
      h('span', { class: 'menu-label' }, it.label),
      it.checked ? icon('check', { size: 15, className: 'menu-check' }) : null,
      it.children ? icon('chevron-right', { size: 15, className: 'menu-chev' }) : null));
    }
    position();
  };
  const position = () => {
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 200;
    let left = align === 'end' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  document.body.appendChild(menu);
  openMenuEl = menu;
  menuOpenedAt = performance.now();
  render(items);
  // Listeners are tracked and removed in closeMenu() so a stale one can never close a later menu.
  setTimeout(() => {
    if (openMenuEl !== menu) return;
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escClose, true);
    window.addEventListener('resize', onViewportChange);
    document.addEventListener('scroll', onViewportChange, true);
  }, 0);
  menu.querySelector('.menu-item')?.focus({ preventScroll: true });
  return menu;
}

let menuOpenedAt = 0;
function outside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
function escClose(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }
function onViewportChange(e) {
  // Ignore the scroll that browsers dispatch right after scrolling the trigger into view, and scrolling inside the menu.
  if (performance.now() - menuOpenedAt < 250) return;
  if (e && e.target instanceof Node && openMenuEl?.contains(e.target)) return;
  closeMenu();
}
export function closeMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', escClose, true);
  window.removeEventListener('resize', onViewportChange);
  document.removeEventListener('scroll', onViewportChange, true);
}

/* -------------------------------------------------------- Small widgets */

export function emptyState({ iconName = 'inbox', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, { size: 26 })),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    action || null);
}

export function skeleton(rows = 4, { height = 44 } = {}) {
  return h('div', { class: 'skeleton-list', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: rows }, (_, i) => h('div', { class: 'skeleton', style: { height: `${height}px`, opacity: String(1 - i * 0.15) } })));
}

/** Segmented control: options [{ value, label, icon }] */
export function segmented(options, value, onChange, { size = '', label = '' } = {}) {
  const wrap = h('div', { class: `segmented ${size}`, role: 'radiogroup', 'aria-label': label });
  const draw = (current) => {
    clear(wrap);
    for (const o of options) {
      wrap.appendChild(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(o.value === current), class: o.value === current ? 'active' : '',
        title: o.title || o.label,
        onClick: () => { if (o.value !== current) { draw(o.value); onChange(o.value); } },
      }, o.icon ? icon(o.icon, { size: 15 }) : null, o.label ? h('span', {}, o.label) : null));
    }
  };
  draw(value);
  return wrap;
}

export function toggleSwitch(checked, onChange, { label = '' } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label, onChange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })));
}

export function field(label, control, { hint, required, className = '' } = {}) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  if (!control.id && control.tagName && ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) control.id = id;
  return h('div', { class: `field ${className}` },
    h('label', { class: 'field-label', htmlFor: control.id || id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function selectEl(options, value, props = {}) {
  return h('select', { class: 'input', ...props },
    options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      return h('option', { value: opt.value, selected: opt.value === value, disabled: opt.disabled }, opt.label);
    }));
}

export function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    if (busyText) button.textContent = busyText;
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}
