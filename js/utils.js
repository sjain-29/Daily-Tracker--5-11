// js/utils.js — safe DOM building, date maths and formatting helpers.
// Nothing in this file touches Firebase or application state.

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ DOM */

/**
 * Hyperscript-style element builder.
 * Strings passed as children are ALWAYS inserted as text nodes (never parsed as HTML),
 * which is how the whole app renders user-generated content without XSS risk.
 *   h('button', { class: 'btn', onClick: fn }, 'Save')
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props, false);
  appendChildren(el, children);
  return el;
}

/** Same as h() but creates SVG elements. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  appendChildren(el, children);
  return el;
}

function applyProps(el, props, isSvg) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'innerHTML' || key === 'outerHTML') throw new Error('Unsafe HTML insertion is not allowed');
    if (key === 'class' || key === 'className') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else for (const [k, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        el.style.setProperty(k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v));
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v != null) el.dataset[k] = v;
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      el.textContent = value;
    } else if (!isSvg && (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled' || key === 'htmlFor' || key === 'indeterminate')) {
      el[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  appendChildren(el, children);
  return el;
}

/** Null-safe append (native Element.append turns null into the text "null"). */
export function add(el, ...children) {
  appendChildren(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------------------------------------------------------- Dates */

export const DAY_MS = 86400000;
export const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date -> 'YYYY-MM-DD' (no timezone shifting). */
export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date at local midnight, or null. */
export function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const todayStr = (now = new Date()) => toDateStr(now);
export const isValidDateStr = (str) => !!parseDate(str);
export const isValidTimeStr = (str) => typeof str === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(str);

export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function addMonths(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), lastDay));
  return x;
}
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function startOfWeek(d, weekStartsOn = 1) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() - weekStartsOn + 7) % 7));
}
export function endOfWeek(d, weekStartsOn = 1) { return endOfDay(addDays(startOfWeek(d, weekStartsOn), 6)); }
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d) { return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
/** Whole calendar days from b to a (a - b). */
export function diffDays(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS); }
export function isSameDay(a, b) { return a && b && toDateStr(a) === toDateStr(b); }

/** 'YYYY-MM-DD' + 'HH:MM' -> Date */
export function combineDateTime(dateStr, timeStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  if (isValidTimeStr(timeStr)) { const [hh, mm] = timeStr.split(':').map(Number); d.setHours(hh, mm, 0, 0); }
  return d;
}

/** datetime-local input value <-> epoch ms */
export function toDateTimeLocal(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromDateTimeLocal(str) {
  if (!str) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(str);
  if (!m) return null;
  const d = combineDateTime(m[1], m[2]);
  return d ? d.getTime() : null;
}

/* ----------------------------------------------------------- Formatting */

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(undefined, opts));
  return fmtCache.get(key);
}

export function formatDate(input, opts = { day: 'numeric', month: 'short' }) {
  const d = typeof input === 'string' ? parseDate(input) : input instanceof Date ? input : input ? new Date(input) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return fmt(opts).format(d);
}

export function formatLongDate(d = new Date()) {
  return formatDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTimeStr(timeStr) {
  if (!isValidTimeStr(timeStr)) return '';
  const [hh, mm] = timeStr.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatClock(d = new Date()) {
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatDateTime(ms) {
  if (!ms) return '';
  return fmt({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

/** Human label for a due date relative to today: Today, Tomorrow, Yesterday, Mon, 12 Nov. */
export function relativeDay(dateStr, now = new Date()) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const diff = diffDays(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return formatDate(d, { weekday: 'short' });
  if (d.getFullYear() !== now.getFullYear()) return formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return formatDate(d, { day: 'numeric', month: 'short' });
}

export function formatMinutes(min) {
  const m = Math.round(min || 0);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60), rem = m % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function formatHours(min, digits = 1) {
  const hrs = (min || 0) / 60;
  return `${hrs >= 10 ? Math.round(hrs) : hrs.toFixed(digits).replace(/\.0$/, '')}h`;
}

export function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (hours < 48) return `${hours.toFixed(1).replace(/\.0$/, '')}h`;
  return `${(hours / 24).toFixed(1).replace(/\.0$/, '')}d`;
}

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return '';
  const sec = Math.round((now - ms) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(new Date(ms));
}

export function greeting(d = new Date()) {
  const hr = d.getHours();
  if (hr < 5) return 'Good night';
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

export const plural = (n, word, pluralWord) => `${n} ${n === 1 ? word : (pluralWord || word + 's')}`;
export const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/* ------------------------------------------------------- Input hygiene */

/** Trim, strip control characters (except newlines/tabs) and enforce a max length. */
export function cleanText(value, max = 500, { multiline = false } = {}) {
  if (value === undefined || value === null) return '';
  let str = String(value);
  str = str.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '');
  str = multiline ? str.replace(/\r\n?/g, '\n').trim() : str.replace(/\s+/g, ' ').trim();
  return str.slice(0, max);
}

/** "a, b ,#c" -> ['a','b','c'] (unique, trimmed, limited) */
export function parseTags(input, { max = 20, maxLen = 40 } = {}) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  for (const raw of list) {
    const tag = cleanText(String(raw).trim().replace(/^#+/, ''), maxLen);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined);
  if (typeof value === 'object') return Object.values(value).filter((v) => v !== null && v !== undefined);
  return [];
}

/* --------------------------------------------------------------- Misc */

export function debounce(fn, wait = 200) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(value) {
  let str = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(str)) str = "'" + str; // neutralise spreadsheet formula injection
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function storageGet(key, fallback = null, area = 'local') {
  try {
    const raw = (area === 'session' ? sessionStorage : localStorage).getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function storageSet(key, value, area = 'local') {
  try { (area === 'session' ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function storageRemove(key, area = 'local') {
  try { (area === 'session' ? sessionStorage : localStorage).removeItem(key); } catch { /* ignore */ }
}

export function isTouchDevice() {
  return window.matchMedia?.('(hover: none), (pointer: coarse)').matches;
}

export function dayOfYear(d = new Date()) {
  return Math.floor((startOfDay(d) - new Date(d.getFullYear(), 0, 0)) / DAY_MS);
}
