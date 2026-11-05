// js/views/settings.js — profile, appearance, focus, notifications, app/PWA, data export and security.

import { h, clear, downloadFile, toDateStr, storageRemove, add } from '../utils.js';
import { icon, segmented, toggleSwitch, toast } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { ACCENTS, WALLPAPERS, APP_VERSION, APP_NAME } from '../constants.js';
import { permissionState, requestPermission, notify, checkNow } from '../notifications.js';
import { chime } from '../timer.js';
import { canPromptInstall, promptInstall, isStandalone, isIOS, onInstallAvailabilityChange } from '../pwa.js';
import { sendReset, authErrorMessage } from '../auth.js';
import { appCheckEnabled, environment, firebaseConfig } from '../firebase.js';
import { signOut } from '../shared.js';

const SECTIONS = [
  ['profile', 'Profile', 'user'], ['appearance', 'Appearance', 'sun'], ['focus', 'Focus timer', 'timer'],
  ['notifications', 'Notifications', 'bell'], ['app', 'App & offline', 'smartphone'], ['data', 'Data', 'download'], ['security', 'Security', 'shield-check'],
];

const view = {
  title: 'Settings',
  deps: ['settings', 'profile', 'connection', 'sync'],

  mount(root) {
    this.root = root;
    this.unsubInstall = onInstallAvailabilityChange(() => this.refresh());
    this.refresh();
  },
  unmount() { this.unsubInstall?.(); },

  refresh(keys) {
    if (!this.root) return;
    // Don't rebuild while the user is typing in a text field.
    if (keys && this.root.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
    const y = window.scrollY;
    clear(this.root);
    const s = store.settings;
    const save = (patch) => db.saveSettings(patch);
    add(this.root, 
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', {}, 'Preferences sync to your account across devices.'))),
      h('div', { class: 'settings-layout' },
        h('nav', { class: 'card settings-nav', 'aria-label': 'Settings sections' }, SECTIONS.map(([id, label, ic]) => h('a', { href: `#/settings`, onClick: (e) => { e.preventDefault(); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon(ic, { size: 16 }), label))),
        h('div', {},
          this.profile(),
          section('appearance', 'Appearance', 'The whole app re-tints through its glass.',
            setting('Theme', 'Dark is the default; Auto follows your device.', segmented([{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'auto', label: 'Auto', icon: 'monitor' }], s.theme, (v) => save({ theme: v }), { size: 'sm', label: 'Theme' })),
            setting('Accent colour', ACCENTS.find((a) => a.key === s.accent)?.name, h('div', { class: 'swatches' }, ACCENTS.map((a) => h('button', { type: 'button', class: `swatch ${s.accent === a.key ? 'active' : ''}`, style: { background: a.color }, 'aria-label': a.name, title: a.name, onClick: () => save({ accent: a.key }) }, s.accent === a.key ? icon('check', { size: 14, strokeWidth: 3 }) : null)))),
            h('div', { class: 'setting', style: 'flex-direction:column;align-items:stretch' },
              h('div', { class: 'setting-text' }, h('strong', {}, 'Wallpaper'), h('span', {}, 'Soft colour behind the glass panels')),
              h('div', { class: 'wp-grid' }, WALLPAPERS.map((w) => h('button', { type: 'button', class: `wp-option ${s.wallpaper === w.key ? 'active' : ''}`, onClick: () => save({ wallpaper: w.key }) }, h('span', { class: 'wp-swatch', dataset: { wp: w.key } }), w.name)))),
            setting('Glass', 'Clear shows more of the wallpaper', segmented([{ value: 'clear', label: 'Clear' }, { value: 'tinted', label: 'Tinted' }], s.glass, (v) => save({ glass: v }), { size: 'sm', label: 'Glass' })),
            setting('Reduce transparency', 'Solid surfaces, no frost — smoother on older phones', toggleSwitch(s.reduceTransparency, (v) => save({ reduceTransparency: v }), { label: 'Reduce transparency' })),
            setting('Compact sidebar', 'Icon-only navigation on desktop', toggleSwitch(s.sidebarCollapsed, (v) => save({ sidebarCollapsed: v }), { label: 'Compact sidebar' })),
            setting('Week starts on', '', segmented([{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }], s.weekStartsOn, (v) => save({ weekStartsOn: v }), { size: 'sm' }))),
          section('focus', 'Focus timer', 'Pomodoro durations and sounds.',
            setting('Focus session', 'Minutes per focus block', stepper(s.focus.focusMin, 1, 180, 5, (v) => save({ focus: { focusMin: v } }))),
            setting('Short break', 'Minutes', stepper(s.focus.shortMin, 1, 60, 1, (v) => save({ focus: { shortMin: v } }))),
            setting('Long break', 'Minutes', stepper(s.focus.longMin, 1, 120, 5, (v) => save({ focus: { longMin: v } }))),
            setting('Long break every', 'Focus sessions per cycle', stepper(s.focus.longEvery, 2, 12, 1, (v) => save({ focus: { longEvery: v } }))),
            setting('Daily focus goal', 'Minutes — drives the violet ring on the dashboard', stepper(s.dailyFocusGoalMin, 15, 1440, 15, (v) => save({ dailyFocusGoalMin: v }))),
            setting('Sound', 'Chime when a session ends', h('div', { class: 'row' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => chime(true) }, icon('volume-2', { size: 14 }), 'Test'), toggleSwitch(s.focus.sound, (v) => save({ focus: { sound: v } }), { label: 'Sound' }))),
            setting('Auto-start breaks', 'Start the break automatically after a focus session', toggleSwitch(s.focus.autoStartBreaks, (v) => save({ focus: { autoStartBreaks: v } }), { label: 'Auto-start breaks' }))),
          this.notifications(),
          this.app(),
          section('data', 'Data', 'Your records live in Firebase under your account only.',
            setting('Export backup', 'All tasks, projects, meetings, notes and focus sessions as JSON', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => downloadFile(`flightdeck-backup-${toDateStr(new Date())}.json`, JSON.stringify(db.exportAll(), null, 2)) }, icon('download', { size: 15 }), 'Download JSON')),
            setting('Archive finished tasks', 'Completed or cancelled more than 7 days ago', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { const n = db.archiveCompletedOlderThan(7); toast(n ? `Archived ${n} task${n === 1 ? '' : 's'}` : 'Nothing to archive', { type: n ? 'success' : 'info' }); } }, icon('archive', { size: 15 }), 'Archive now'))),
          section('security', 'Security', null,
            h('div', { class: 'notice', style: 'margin:4px 0 8px' }, icon('shield-check', { size: 16 }), h('div', {},
              'Access is protected by Firebase Authentication and Realtime Database Security Rules: only your signed-in, authorised account can read or write ', h('code', {}, `/users/${store.uid}`), '. The API key in the app is a public identifier, not a password.')),
            setting('Password', 'We’ll email a secure reset link to your address', h('button', { class: 'btn btn-sm', type: 'button', onClick: async (e) => {
              const b = e.currentTarget; b.disabled = true;
              try { await sendReset(store.user.email); toast(`Reset link sent to ${store.user.email}`, { type: 'success' }); } catch (err) { toast(authErrorMessage(err), { type: 'error' }); } finally { b.disabled = false; }
            } }, icon('key-round', { size: 15 }), 'Send reset email')),
            setting('Sign out', 'Removes cached data from this device', h('button', { class: 'btn btn-sm danger-text', type: 'button', onClick: signOut }, icon('log-out', { size: 15 }), 'Sign out'))))));
    window.scrollTo({ top: y });
  },

  profile() {
    const name = h('input', { class: 'input', value: store.profile?.name || '', maxlength: 60, placeholder: 'Your name', 'aria-label': 'Display name', style: 'max-width:260px' });
    const saveName = () => { try { db.saveProfile({ name: name.value }); toast('Name updated', { type: 'success' }); name.blur(); } catch (e) { toast(e.message, { type: 'error' }); } };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
    return section('profile', 'Profile', 'Shown in the dashboard greeting.',
      setting('Display name', null, h('div', { class: 'row' }, name, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: saveName }, 'Save'))),
      setting('Email', 'Sign-in address (managed in Firebase Authentication)', h('span', { class: 'muted' }, store.user?.email || '')),
      setting('User UID', `Role: ${store.role || '—'}`, h('div', { class: 'row' }, h('span', { class: 'code-box' }, store.uid || ''), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Copy UID', onClick: () => navigator.clipboard?.writeText(store.uid).then(() => toast('UID copied', { type: 'success' })) }, icon('copy', { size: 14 })))));
  },

  notifications() {
    const s = store.settings.notifications;
    const perm = permissionState();
    const save = (patch) => db.saveSettings({ notifications: patch });
    const permText = { granted: 'Allowed in this browser', denied: 'Blocked — allow notifications for this site in your browser settings', default: 'Not yet requested', unsupported: 'This browser doesn’t support notifications' }[perm];
    const enable = async (on) => {
      if (on && perm !== 'granted') {
        const res = await requestPermission();
        if (res !== 'granted') { toast(res === 'unsupported' ? 'Notifications aren’t supported in this browser.' : 'Permission was not granted. In-app reminders will still appear while the app is open.', { type: 'warning', timeout: 7000 }); }
      }
      save({ enabled: on });
      if (on) setTimeout(checkNow, 500);
    };
    const sw = (key, label, sub) => setting(label, sub, toggleSwitch(s[key], (v) => save({ [key]: v }), { label }));
    return section('notifications', 'Notifications', null,
      setting('Browser notifications', permText, toggleSwitch(s.enabled && perm !== 'denied', enable, { label: 'Enable notifications' })),
      sw('dueToday', 'Tasks due today', 'One summary per day'),
      sw('upcoming', 'Approaching deadlines', 'When a deadline is within 24 hours'),
      sw('overdue', 'Overdue tasks', 'Once per task when it becomes overdue'),
      sw('reminders', 'Task reminders', 'At the reminder time you set on a task'),
      setting('Scheduled meetings', 'Minutes before the start time', h('div', { class: 'row' }, stepper(s.meetingLeadMin, 0, 120, 5, (v) => save({ meetingLeadMin: v })), toggleSwitch(s.meetings, (v) => save({ meetings: v }), { label: 'Meeting notifications' }))),
      sw('focus', 'Focus session completion', 'When a focus block or break ends'),
      setting('Test', null, h('button', { class: 'btn btn-sm', type: 'button', disabled: !(s.enabled && perm === 'granted'), onClick: () => notify(`${APP_NAME} test`, 'Notifications are working on this device.', { tag: 'test', always: true }) }, icon('bell-ring', { size: 15 }), 'Send test notification')),
      h('div', { class: 'notice warn', style: 'margin-top:8px' }, icon('info', { size: 16 }), h('div', {},
        h('strong', {}, 'How reliable are reminders? '),
        'Reminders are checked once a minute while the app is open (in a tab or as an installed app). Browsers don’t run this code when the app is fully closed, the phone is asleep or offline — so treat these as helpful nudges, not alarms. Each event notifies once per device. iPhone requires the app to be installed to the Home Screen (iOS 16.4+) for notifications.')));
  },

  app() {
    const pending = db.pendingChangeCount();
    let installControl;
    if (isStandalone()) installControl = h('span', { class: 'chip' }, icon('check', { size: 12 }), 'Installed');
    else if (canPromptInstall()) installControl = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: async () => { const r = await promptInstall(); if (r === 'accepted') toast('App installed', { type: 'success' }); } }, icon('download', { size: 15 }), 'Install app');
    else if (isIOS()) installControl = h('span', { class: 'muted sm' }, 'Safari → Share → Add to Home Screen');
    else installControl = h('span', { class: 'muted sm' }, 'Use your browser menu → Install app / Add to Home screen');
    return section('app', 'App & offline', null,
      setting('Install', 'Use it like a normal app on Android, iPhone or desktop', installControl),
      setting('Connection', store.connected ? 'Connected to Firebase Realtime Database' : 'Offline — changes are kept on this device and sync on reconnect', h('span', { class: `conn-pill ${store.connected ? '' : 'offline'}` }, h('span', { class: 'dot' }), store.connected ? 'Online' : 'Offline')),
      setting('Unsynced changes', pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to reach Firebase` : 'Everything is synced', h('span', { class: 'num' }, String(pending))),
      setting('App Check', appCheckEnabled ? 'Enabled (reCAPTCHA) — requests carry an attestation token' : 'Not configured — add a reCAPTCHA site key in js/firebase-config.js', h('span', { class: 'chip' }, appCheckEnabled ? 'On' : 'Off')),
      setting('Environment', `${environment} · project ${firebaseConfig.projectId}`, h('span', { class: 'faint xs' }, `v${APP_VERSION}`)),
      setting('Offline cache', 'Cached data lets the app open without a connection', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { storageRemove(`fd-cache-v1-${store.uid}`); toast('Offline cache cleared on this device', { type: 'success' }); } }, 'Clear cache')),
      h('div', { class: 'notice', style: 'margin-top:8px' }, icon('cloud-off', { size: 16 }), h('div', {},
        'Offline support: the app shell is cached by a service worker; your data is cached on this device after one online sign-in. Anything you create or change offline is saved in an on-device queue and synced automatically when the connection returns (last change wins).')));
  },
};

export default view;

function section(id, title, sub, ...content) {
  return h('section', { class: 'card settings-section', id: `set-${id}` },
    h('div', { class: 'card-head' }, h('div', { class: 'card-titles' }, h('h3', { class: 'card-title' }, title), sub ? h('p', { class: 'card-sub' }, sub) : null)),
    content);
}

function setting(title, sub, control) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting-text' }, h('strong', {}, title), sub ? h('span', {}, sub) : null),
    h('div', { class: 'setting-control' }, control));
}

function stepper(value, min, max, step, onChange) {
  const input = h('input', { type: 'number', inputmode: 'numeric', min, max, step, value, 'aria-label': 'Value',
    onChange: (e) => { const v = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))); e.target.value = v; onChange(v); } });
  const bump = (d) => { const v = Math.min(max, Math.max(min, Number(input.value) + d)); input.value = v; onChange(v); };
  return h('div', { class: 'num-stepper' },
    h('button', { class: 'icon-btn xs ghost', type: 'button', 'aria-label': 'Decrease', onClick: () => bump(-step) }, icon('minus', { size: 13 })),
    input,
    h('button', { class: 'icon-btn xs ghost', type: 'button', 'aria-label': 'Increase', onClick: () => bump(step) }, icon('plus', { size: 13 })));
}

