// js/notifications.js — browser notifications for deadlines, reminders, meetings and focus sessions.
//
// Limitations (also explained in Settings): these checks run only while the app is open in a tab or
// as an installed app that is running. Browsers do not run this code when the app is closed or the
// device is offline/asleep. True background push would require Firebase Cloud Messaging plus a
// server-side sender (Cloud Functions on the Blaze plan) — see README "Background push".

import { store } from './store.js';
import { storageGet, storageSet, todayStr, combineDateTime, formatTimeStr, DAY_MS } from './utils.js';
import { computeFlags, isOpen, getDeadline } from './task-logic.js';

let interval = null;
let fallbackToast = null;

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const permissionState = () => (notificationsSupported() ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/**
 * Show a system notification (via the service worker when available — required on Android).
 * Returns true if shown. `always` skips the per-type setting check (caller already checked).
 */
export async function notify(title, body, { tag, url = './index.html#/dashboard', always = false, fallback = true } = {}) {
  const s = store.settings.notifications;
  if (!s.enabled && !always) return false;
  if (!s.enabled || permissionState() !== 'granted') {
    if (fallback && fallbackToast && !document.hidden) fallbackToast(`${title} — ${body}`);
    return false;
  }
  const options = { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/badge-72.png', data: { url }, renotify: false };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) { await reg.showNotification(title, options); return true; }
  } catch { /* fall through */ }
  try { new Notification(title, options); return true; } catch { return false; }
}

const logKey = () => `fd-notified-${store.uid}`;
function loadLog() { return storageGet(logKey(), {}) || {}; }
function saveLog(log) {
  const cutoff = Date.now() - 30 * DAY_MS;
  for (const [k, ts] of Object.entries(log)) if (ts < cutoff) delete log[k];
  storageSet(logKey(), log);
}

/** One pass over tasks and meetings. Each event notifies at most once per device. */
export function checkNow() {
  if (!store.uid || !store.role || !store.isLoaded()) return;
  const s = store.settings.notifications;
  if (!s.enabled) return;
  const now = new Date();
  const nowMs = +now;
  const today = todayStr(now);
  const log = loadLog();
  const fresh = (key) => { if (log[key]) return false; log[key] = nowMs; return true; };
  const tasks = store.list('tasks').filter((t) => !t.archived && isOpen(t));

  if (s.dueToday && now.getHours() >= 7 && fresh(`today:${today}`)) {
    const due = tasks.filter((t) => t.endDate === today && getDeadline(t) >= now);
    if (due.length) notify(`${due.length} task${due.length === 1 ? '' : 's'} due today`, due.slice(0, 3).map((t) => t.title).join(' · ') + (due.length > 3 ? ` +${due.length - 3} more` : ''), { tag: `today-${today}`, url: './index.html#/tasks?flag=due-today' });
  }

  const overdueNew = [], soonNew = [];
  for (const t of tasks) {
    const flags = computeFlags(t, now).map((f) => f.key);
    const stamp = `${t.endDate}${t.dueTime || ''}`;
    if (s.overdue && flags.includes('OVERDUE') && fresh(`overdue:${t.id}:${stamp}`)) overdueNew.push(t);
    else if (s.upcoming && flags.includes('DUE_SOON') && fresh(`soon:${t.id}:${stamp}`)) soonNew.push(t);
    if (s.reminders && t.reminderAt && t.reminderAt <= nowMs && t.reminderAt > nowMs - 12 * 3600000 && fresh(`rem:${t.id}:${t.reminderAt}`)) {
      notify(`Reminder: ${t.title}`, t.endDate ? `Deadline ${t.endDate}${t.dueTime ? ' ' + formatTimeStr(t.dueTime) : ''}` : 'Task reminder', { tag: `rem-${t.id}` });
    }
  }
  // Group bursts (e.g. first launch with many overdue tasks) into a single summary notification.
  const announce = (list, single, multi, tag, url) => {
    if (!list.length) return;
    if (list.length === 1) notify(`${single}: ${list[0].title}`, list[0].endDate ? `Deadline ${list[0].endDate}${list[0].dueTime ? ' ' + formatTimeStr(list[0].dueTime) : ''}` : '', { tag: `${tag}-${list[0].id}`, url });
    else notify(`${list.length} ${multi}`, list.slice(0, 3).map((t) => t.title).join(' · '), { tag: `${tag}-batch`, url });
  };
  announce(overdueNew, 'Overdue', 'tasks are overdue', 'overdue', './index.html#/tasks?flag=overdue');
  announce(soonNew, 'Due soon', 'tasks are due within 24 hours', 'soon', './index.html#/tasks?flag=due-soon');

  if (s.meetings) {
    const lead = (s.meetingLeadMin ?? 10) * 60000;
    for (const m of store.list('meetings')) {
      if (m.archived || m.date !== today || !m.startTime) continue;
      const startMs = +combineDateTime(m.date, m.startTime);
      if (startMs - nowMs <= lead && startMs - nowMs > -5 * 60000 && fresh(`mtg:${m.id}:${m.date}${m.startTime}`)) {
        const mins = Math.max(0, Math.round((startMs - nowMs) / 60000));
        notify(mins ? `Meeting in ${mins} min: ${m.title}` : `Meeting starting: ${m.title}`, [formatTimeStr(m.startTime), m.location].filter(Boolean).join(' · '), { tag: `mtg-${m.id}`, url: './index.html#/notes?tab=meetings' });
      }
    }
  }
  saveLog(log);
}

export function startReminderLoop({ onFallback } = {}) {
  fallbackToast = onFallback || null;
  stopReminderLoop();
  setTimeout(checkNow, 3000);
  interval = setInterval(checkNow, 60000);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopReminderLoop() {
  clearInterval(interval);
  interval = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() { if (!document.hidden) checkNow(); }
