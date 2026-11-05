// js/app.js — application bootstrap: auth guard, shell (sidebar/topbar/bottom nav), router, global actions.

import { configured, auth } from './firebase.js';
import { requireAuth, watchSession, rememberedDevice } from './auth.js';
import { store } from './store.js';
import * as db from './database.js';
import { h, clear, debounce, storageGet, add, toDateStr } from './utils.js';
import { icon, toast, popMenu, closeAllModals, hasOpenModal, closeMenu } from './ui.js';
import { ui, session, signOut, parseHash } from './shared.js';
import { applyAppearance } from './theme.js';
import { APP_NAME } from './constants.js';
import { computeFlags, isOpen, meetingStart, meetingEnd } from './task-logic.js';
import { openTaskForm, openTaskDetails } from './task-modal.js';
import { initTimer, subscribeTimer, getState as timerState, formatRemaining, MODES } from './timer.js';
import { startReminderLoop, stopReminderLoop } from './notifications.js';
import { registerServiceWorker } from './pwa.js';
import { openQuickStart } from './quick-start.js';

import dashboard from './views/dashboard.js';
import tasks from './views/tasks.js';
import projects from './views/projects.js';
import calendar from './views/calendar.js';
import kanban from './views/kanban.js';
import timeline from './views/timeline.js';
import analytics from './views/analytics.js';
import notes, { openMeetingForm, openNoteForm } from './views/notes.js';
import archive from './views/archive.js';
import settings from './views/settings.js';
import { openProjectForm } from './views/projects.js';

const VIEWS = { dashboard, tasks, projects, calendar, kanban, timeline, analytics, notes, archive, settings };

const NAV = [
  { section: 'Workspace' },
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { id: 'tasks', label: 'My Tasks', icon: 'list-checks', badge: 'overdue' },
  { id: 'projects', label: 'Projects', icon: 'folder-kanban' },
  { section: 'Views' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days' },
  { id: 'kanban', label: 'Kanban Board', icon: 'square-kanban' },
  { id: 'timeline', label: 'Timeline', icon: 'chart-gantt' },
  { section: 'Review' },
  { id: 'analytics', label: 'Analytics', icon: 'chart-line' },
  { id: 'notes', label: 'Notes & Meetings', icon: 'notebook-pen' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
];

let root, appEl, viewEl, titleEl, connPill, focusPill, bellBtn, searchInput, searchWrap, bottomNav;
let current = { name: null, view: null };
let shellReady = false;
let roleTimeout = null;
const baseTitle = APP_NAME;

/* ================================================================ Boot */

async function boot() {
  root = document.getElementById('root');
  if (!configured) { location.replace('login.html'); return; }
  const user = await requireAuth();
  registerServiceWorker({ onUpdate: (apply) => toast('A new version of the app is available.', { type: 'info', timeout: 0, action: { label: 'Reload', fn: apply } }) });

  db.startSync(user, {
    remember: rememberedDevice(),
    onRoleChange: handleRole,
    onPermissionDenied: handlePermissionDenied,
    onWriteError: (err, label) => {
      const msg = db.isPermissionError(err) ? 'You no longer have permission to save changes.' : (err?.message || 'Unknown error');
      toast(`Couldn’t save ${label}: ${msg}`, { type: 'error', timeout: 7000 });
    },
  });

  watchSession(() => { if (!session.signingOut) sessionEnded('expired'); });

  // If we can't confirm authorisation (e.g. first launch while offline), explain instead of spinning forever.
  roleTimeout = setTimeout(() => {
    if (store.role === undefined) showOfflineFirstRun();
  }, 15000);

  store.subscribe(onStoreChange);
  setInterval(() => store.changed('tick'), 30000); // keeps flags, clocks and countdowns current
  window.addEventListener('online', () => store.changed('connection'));
  window.addEventListener('offline', () => store.changed('connection'));
}

function handleRole(role) {
  clearTimeout(roleTimeout);
  if (role) {
    if (!shellReady) {
      buildShell();
      shellReady = true;
      initTimer();
      startReminderLoop({ onFallback: (msg) => toast(msg, { type: 'info', timeout: 8000 }) });
      window.addEventListener('hashchange', route);
      route();
      hideSplash();
    }
  } else {
    if (shellReady) { shellReady = false; stopReminderLoop(); }
    showNotAuthorised();
  }
}

function handlePermissionDenied() {
  if (!auth.currentUser) sessionEnded('expired');
  // Otherwise the roles listener decides (access revoked -> "not authorised" screen).
}

function sessionEnded(reason) {
  db.stopSync({ clearLocal: reason !== 'expired' });
  location.replace(`login.html?reason=${reason}`);
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (s) { s.classList.add('hide'); setTimeout(() => s.remove(), 400); }
}

/* ================================================================ Shell */

function buildShell() {
  clear(root);
  const navItems = NAV.map((item) => item.section
    ? h('div', { class: 'nav-section' }, item.section)
    : h('a', { class: 'nav-item', href: `#/${item.id}`, dataset: { route: item.id }, title: item.label },
      icon(item.icon, { size: 19 }), h('span', { class: 'nav-label' }, item.label),
      item.badge ? h('span', { class: 'nav-badge', dataset: { badge: item.badge }, hidden: true }) : null,
      item.badge ? h('span', { class: 'dot-badge', dataset: { dotBadge: item.badge }, hidden: true }) : null));

  const userBlock = h('div', { class: 'sidebar-user' },
    h('span', { class: 'avatar-lg', id: 'sb-avatar' }, '?'),
    h('div', { class: 'sidebar-user-text' }, h('strong', { id: 'sb-name' }, ''), h('span', {}, store.user?.email || '')));

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Main navigation' },
    h('div', { class: 'sidebar-brand' },
      h('div', { class: 'brand-mark sm' }, icon('send', { size: 17 })),
      h('div', { class: 'sidebar-brand-text' }, h('strong', {}, APP_NAME), h('span', {}, 'Productivity dashboard'))),
    h('nav', { class: 'nav' }, navItems),
    h('div', { class: 'sidebar-foot' },
      h('a', { class: 'nav-item', href: '#/settings', dataset: { route: 'settings' }, title: 'Settings' }, icon('settings', { size: 19 }), h('span', { class: 'nav-label' }, 'Settings')),
      h('button', { class: 'nav-item collapse-toggle', type: 'button', style: 'background:none;border:0;width:100%', title: 'Collapse sidebar', onClick: toggleSidebar },
        icon('panel-left-close', { size: 19 }), h('span', { class: 'nav-label' }, 'Collapse')),
      userBlock));

  searchInput = h('input', {
    type: 'search', placeholder: 'Search tasks, projects, tags…', 'aria-label': 'Search tasks', autocomplete: 'off', enterkeyhint: 'search',
    onInput: debounce((e) => setSearch(e.target.value), 180),
    onKeydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; setSearch(''); e.target.blur(); searchWrap.classList.remove('open'); } },
    onBlur: () => { if (!searchInput.value) searchWrap.classList.remove('open'); },
  });
  searchWrap = h('div', { class: 'search', role: 'search' }, icon('search', { size: 16 }), searchInput, h('kbd', {}, '/'));
  titleEl = h('h1', { class: 'topbar-title' }, '');
  connPill = h('span', { class: 'conn-pill', role: 'status', 'aria-live': 'polite' });
  focusPill = h('button', { class: 'focus-pill', type: 'button', hidden: true, onClick: () => { location.hash = '#/dashboard'; setTimeout(() => document.getElementById('focus-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); } });
  bellBtn = h('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Alerts', title: 'Alerts', onClick: (e) => openAlerts(e.currentTarget) }, icon('bell', { size: 18 }));

  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn ghost menu-toggle', type: 'button', 'aria-label': 'Open menu', onClick: () => appEl.classList.add('drawer-open') }, icon('menu')),
    titleEl,
    searchWrap,
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Search', style: 'display:none', dataset: { mobileSearch: '1' }, onClick: () => { searchWrap.classList.add('open'); searchInput.focus(); } }, icon('search')),
      connPill, focusPill, bellBtn,
      h('button', { class: 'icon-btn ghost hide-sm', type: 'button', 'aria-label': 'Toggle light/dark theme', title: 'Toggle theme', onClick: toggleTheme }, icon('sun', { size: 18 })),
      h('button', { class: 'btn btn-primary btn-sm hide-sm', type: 'button', onClick: (e) => openNewMenu(e.currentTarget) }, icon('plus', { size: 16 }), 'New'),
      h('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Account menu', onClick: (e) => openAccountMenu(e.currentTarget) }, h('span', { class: 'avatar-lg', id: 'tb-avatar', style: 'width:30px;height:30px;font-size:11px' }, '?'))));

  viewEl = h('main', { class: 'view', id: 'view', tabindex: '-1' });

  bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Quick navigation' },
    h('a', { href: '#/dashboard', dataset: { route: 'dashboard' } }, icon('layout-dashboard', { size: 21 }), 'Home'),
    h('a', { href: '#/tasks', dataset: { route: 'tasks' } }, icon('list-checks', { size: 21 }), 'Tasks', h('span', { class: 'bn-badge', dataset: { bnBadge: 'overdue' }, hidden: true })),
    h('button', { type: 'button', class: 'fab', 'aria-label': 'Create new', onClick: (e) => openNewMenu(e.currentTarget, 'start') }, icon('plus', { size: 24 })),
    h('a', { href: '#/calendar', dataset: { route: 'calendar' } }, icon('calendar-days', { size: 21 }), 'Calendar'),
    h('button', { type: 'button', onClick: () => appEl.classList.add('drawer-open') }, icon('menu', { size: 21 }), 'More'));

  appEl = h('div', { class: `app ${store.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}` },
    sidebar, h('div', { class: 'drawer-scrim', onClick: () => appEl.classList.remove('drawer-open') }),
    h('div', { class: 'main' }, topbar, viewEl), bottomNav);
  root.appendChild(appEl);

  // Close the mobile drawer after navigating.
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a.nav-item')) appEl.classList.remove('drawer-open'); });
  // Show the mobile search button only on small screens.
  const mq = window.matchMedia('(max-width: 760px)');
  const syncMobile = () => { root.querySelector('[data-mobile-search]').style.display = mq.matches ? '' : 'none'; };
  mq.addEventListener?.('change', syncMobile); syncMobile();

  subscribeTimer(updateFocusPill);
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('themechange', () => current.view?.refresh?.(new Set(['theme'])));
  updateChrome(new Set(['all']));
}

function toggleSidebar() {
  const collapsed = !appEl.classList.contains('sidebar-collapsed');
  appEl.classList.toggle('sidebar-collapsed', collapsed);
  db.saveSettings({ sidebarCollapsed: collapsed });
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  db.saveSettings({ theme: isDark ? 'light' : 'dark' });
}

function openNewMenu(anchor, align = 'end') {
  popMenu(anchor, [
    { label: 'New task', icon: 'square-pen', onClick: () => openTaskForm() },
    { label: 'New project', icon: 'folder-plus', onClick: () => openProjectForm() },
    { label: 'New note', icon: 'sticky-note', onClick: () => openNoteForm() },
    { label: 'New meeting', icon: 'calendar-plus', onClick: () => openMeetingForm() },
    { separator: true },
    { label: 'Start focus session', icon: 'timer', onClick: () => startFocusFromAnywhere() },
    { label: 'Quick start templates…', icon: 'sparkles', onClick: () => openQuickStart() },
  ], { align });
}

async function startFocusFromAnywhere() {
  const { start, getState, setMode } = await import('./timer.js');
  if (getState().mode !== 'focus' && getState().status === 'idle') setMode('focus');
  start();
  toast('Focus session started', { type: 'success', timeout: 2500 });
}

function openAccountMenu(anchor) {
  popMenu(anchor, [
    { heading: store.user?.email || '' },
    { label: 'Settings', icon: 'settings', onClick: () => { location.hash = '#/settings'; } },
    { label: 'Theme: ' + (document.documentElement.dataset.theme === 'dark' ? 'Dark' : 'Light'), icon: 'sun', onClick: toggleTheme },
    { label: 'Archive', icon: 'archive', onClick: () => { location.hash = '#/archive'; } },
    { separator: true },
    { label: 'Sign out', icon: 'log-out', danger: true, onClick: signOut },
  ]);
}

function openAlerts(anchor) {
  const now = new Date();
  const items = [];
  const open = store.list('tasks').filter((t) => !t.archived && isOpen(t));
  const withFlags = open.map((t) => ({ t, f: computeFlags(t, now)[0] })).filter((x) => x.f && x.f.rank <= 4).sort((a, b) => a.f.rank - b.f.rank);
  for (const { t, f } of withFlags.slice(0, 10)) items.push({ label: `${f.label}: ${t.title}`, icon: f.icon, onClick: () => openTaskDetails(t.id) });
  if (!items.length) items.push({ label: 'No alerts — you’re on track', icon: 'circle-check', disabled: true });
  else if (withFlags.length > 10) items.push({ separator: true }, { label: `View all ${withFlags.length} flagged tasks`, icon: 'list-checks', onClick: () => { location.hash = '#/tasks?flag=attention'; } });
  popMenu(anchor, items);
}

function setSearch(value) {
  ui.search = value;
  if (value && !['tasks', 'kanban'].includes(current.name)) { location.hash = '#/tasks'; return; }
  ui.searchListeners.forEach((fn) => fn(value));
}

function focusSearch() {
  searchWrap.classList.add('open');
  searchInput.focus();
  searchInput.select();
}

function onGlobalKey(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || hasOpenModal()) return;
  if (e.key === '/') { e.preventDefault(); focusSearch(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskForm(); }
}

/* ================================================================ Chrome updates */

/**
 * Everything on screen that depends on the clock (dates, deadline flags, meeting states).
 * A periodic 'tick' only re-renders the current view when this signature changes, so the UI
 * isn't rebuilt under the user's pointer every 30 seconds.
 */
let lastTimeSig = '';
function timeSignature(now = new Date()) {
  const today = toDateStr(now);
  const parts = [today, greetingBucket(now)];
  for (const t of store.list('tasks')) {
    if (t.archived || !isOpen(t)) continue;
    const f = computeFlags(t, now);
    if (f.length) parts.push(`${t.id}:${f.map((x) => x.key).join(',')}`);
    if (t.reminderAt && t.reminderAt <= +now && toDateStr(new Date(t.reminderAt)) === today) parts.push(`r:${t.id}`);
  }
  for (const m of store.list('meetings')) {
    if (m.archived || m.date !== today) continue;
    parts.push(`${m.id}:${meetingStart(m) <= now ? 1 : 0}${meetingEnd(m) <= now ? 1 : 0}`);
  }
  return parts.join('|');
}
const greetingBucket = (d) => { const hr = d.getHours(); return hr < 5 ? 0 : hr < 12 ? 1 : hr < 17 ? 2 : 3; };

function onStoreChange(keys) {
  if (!shellReady) return;
  const sig = timeSignature();
  if (keys.size === 1 && keys.has('tick')) {
    if (sig === lastTimeSig) { updateConnection(); return; }
  }
  lastTimeSig = sig;
  updateChrome(keys);
  if (current.view?.refresh) {
    const relevant = current.view.deps ? [...keys].some((k) => current.view.deps.includes(k) || k === 'cache') : true;
    if (relevant) current.view.refresh(keys);
  }
}

function updateChrome(keys) {
  if (keys.has('settings') || keys.has('all') || keys.has('cache')) {
    applyAppearance(store.settings);
    appEl?.classList.toggle('sidebar-collapsed', !!store.settings.sidebarCollapsed);
  }
  if (keys.has('profile') || keys.has('all') || keys.has('cache')) {
    const name = store.displayName();
    const ini = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
    const sb = document.getElementById('sb-name'); if (sb) sb.textContent = name;
    for (const id of ['sb-avatar', 'tb-avatar']) { const el = document.getElementById(id); if (el) el.textContent = ini; }
  }
  if (keys.has('tasks') || keys.has('tick') || keys.has('all') || keys.has('cache')) {
    const now = new Date();
    const open = store.list('tasks').filter((t) => !t.archived && isOpen(t));
    const overdue = open.filter((t) => computeFlags(t, now)[0]?.key === 'OVERDUE').length;
    const attention = open.filter((t) => { const f = computeFlags(t, now)[0]; return f && f.rank <= 4; }).length;
    root.querySelectorAll('[data-badge="overdue"], [data-bn-badge="overdue"]').forEach((el) => { el.textContent = String(overdue); el.hidden = !overdue; });
    root.querySelectorAll('[data-dot-badge="overdue"]').forEach((el) => { el.hidden = !overdue; });
    add(clear(bellBtn), icon('bell', { size: 18 }), attention ? h('span', { class: 'badge-dot' }, attention > 9 ? '9+' : String(attention)) : null);
  }
  if (keys.has('connection') || keys.has('sync') || keys.has('all') || keys.has('tick')) updateConnection();
}

function updateConnection() {
  const pending = db.pendingChangeCount();
  const online = store.connected && navigator.onLine !== false;
  connPill.className = `conn-pill ${online ? (pending ? 'syncing' : '') : 'offline'}`;
  const label = online ? (pending ? `Syncing ${pending}…` : 'Synced') : (pending ? `Offline · ${pending} saved on device` : 'Offline');
  add(clear(connPill), h('span', { class: 'dot' }), h('span', { class: 'label' }, label));
  connPill.title = online
    ? 'Connected to Firebase — changes sync in real time.'
    : 'No connection to Firebase. Changes you make are saved on this device and sync automatically when you reconnect.';
}

function updateFocusPill(type, st) {
  if (!focusPill) return;
  const active = st.status !== 'idle';
  focusPill.hidden = !active;
  if (active) {
    focusPill.classList.toggle('paused', st.status === 'paused');
    add(clear(focusPill), h('span', { class: 'pulse-dot' }), `${formatRemaining(st.remaining)}`, h('span', { class: 'muted xs hide-sm' }, st.status === 'paused' ? 'Paused' : MODES[st.mode].verb));
    document.title = `${formatRemaining(st.remaining)} · ${MODES[st.mode].label} — ${baseTitle}`;
  } else {
    document.title = `${current.view?.title || 'Dashboard'} — ${baseTitle}`;
  }
  // `st` is the state of the session that just ended.
  if (type === 'complete') toast(st.mode === 'focus' ? 'Focus session complete — time for a break.' : 'Break finished — ready to focus?', { type: 'success', timeout: 6000 });
}

/* ================================================================ Router */

function route() {
  closeMenu();
  closeAllModals();
  const r = parseHash();
  const view = VIEWS[r.name] || VIEWS.dashboard;
  const name = VIEWS[r.name] ? r.name : 'dashboard';
  try { current.view?.unmount?.(); } catch (err) { console.error(err); }
  current = { name, view };
  clear(viewEl);
  viewEl.classList.remove('view-enter'); void viewEl.offsetWidth; viewEl.classList.add('view-enter');
  titleEl.textContent = view.title;
  if (timerState().status === 'idle') document.title = `${view.title} — ${baseTitle}`;
  root.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  root.querySelectorAll('.nav-item[data-route]').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (name !== 'tasks' && name !== 'kanban' && ui.search) { ui.search = ''; searchInput.value = ''; }
  try {
    view.mount(viewEl, r);
  } catch (err) {
    console.error(err);
    viewEl.appendChild(h('div', { class: 'card' }, h('h3', {}, 'Something went wrong'), h('p', { class: 'muted' }, String(err.message || err))));
  }
  window.scrollTo({ top: 0 });
}

/* ================================================================ Full-page states */

function showNotAuthorised() {
  hideSplash();
  const uid = store.uid || auth.currentUser?.uid || '';
  clear(root).appendChild(h('div', { class: 'center-page' },
    h('div', { class: 'card center-card' },
      h('div', { class: 'empty-icon', style: 'margin:0' }, icon('lock', { size: 24 })),
      h('h1', {}, 'Account not authorised yet'),
      h('p', { class: 'muted' }, `You’re signed in as ${store.user?.email || auth.currentUser?.email || 'this user'}, but this account hasn’t been granted access. An administrator grants access in the Firebase console — users can’t grant it to themselves.`),
      h('ol', {},
        h('li', {}, 'Firebase Console → Realtime Database → Data.'),
        h('li', {}, 'Add a child named “roles” at the root (if missing).'),
        h('li', {}, 'Inside it, add your User UID (below) as the key with the value "owner".'),
        h('li', {}, 'Come back and press “Check again”.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Your User UID'), h('div', { class: 'code-box' }, uid)),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => location.reload() }, icon('refresh-cw', { size: 16 }), 'Check again'),
        h('button', { class: 'btn', type: 'button', onClick: () => navigator.clipboard?.writeText(uid).then(() => toast('UID copied', { type: 'success' })) }, icon('copy', { size: 16 }), 'Copy UID'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: signOut }, icon('log-out', { size: 16 }), 'Sign out')))));
}

function showOfflineFirstRun() {
  if (shellReady) return;
  hideSplash();
  clear(root).appendChild(h('div', { class: 'center-page' },
    h('div', { class: 'card center-card' },
      h('div', { class: 'empty-icon', style: 'margin:0' }, icon('cloud-off', { size: 24 })),
      h('h1', {}, 'Can’t reach Firebase'),
      h('p', { class: 'muted' }, navigator.onLine === false
        ? 'You appear to be offline. The app needs to connect once on this device before it can open offline.'
        : 'The database isn’t responding. Check your connection, the database URL in js/firebase-config.js, and App Check enforcement settings.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => location.reload() }, icon('refresh-cw', { size: 16 }), 'Try again'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: signOut }, icon('log-out', { size: 16 }), 'Sign out')))));
}

// Apply cached appearance immediately (before Firebase settings arrive).
applyAppearance(storageGet('fd-appearance', {}) || {});
boot().catch((err) => {
  console.error(err);
  hideSplash();
  clear(document.getElementById('root')).appendChild(h('div', { class: 'center-page' }, h('div', { class: 'card center-card' }, h('h1', {}, 'The app failed to start'), h('p', { class: 'muted' }, String(err.message || err)), h('button', { class: 'btn btn-primary', type: 'button', onClick: () => location.reload() }, 'Reload'))));
});

