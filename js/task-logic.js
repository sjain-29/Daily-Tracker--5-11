// js/task-logic.js — pure business rules: deadline flags, recurrence, filtering, sorting and statistics.
// Flags are ALWAYS computed from dates + status at render time; they are never stored in the database.

import {
  DAY_MS, parseDate, endOfDay, startOfDay, addDays, addMonths, toDateStr, diffDays,
  startOfWeek, endOfWeek, isValidTimeStr, clamp, pct,
} from './utils.js';
import { PRIORITIES, TASK_STATUSES } from './constants.js';

export const isOpen = (t) => !!t && t.status !== 'Completed' && t.status !== 'Cancelled';
export const isDone = (t) => !!t && t.status === 'Completed';

/** The moment a task becomes overdue: end date + due time, or the end of the end date. */
export function getDeadline(task) {
  const d = parseDate(task?.endDate);
  if (!d) return null;
  if (isValidTimeStr(task.dueTime)) {
    const [hh, mm] = task.dueTime.split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  return endOfDay(d);
}

/** Start of the task's start date (local midnight). */
export const getStart = (task) => parseDate(task?.startDate);

export const FLAGS = Object.freeze({
  OVERDUE: { key: 'OVERDUE', label: 'Overdue', tone: 'danger', icon: 'triangle-alert', rank: 1 },
  DELAYED: { key: 'DELAYED', label: 'Delayed', tone: 'danger-soft', icon: 'hourglass', rank: 2 },
  DUE_SOON: { key: 'DUE_SOON', label: 'Due soon', tone: 'orange', icon: 'alarm-clock', rank: 3 },
  NOT_STARTED: { key: 'NOT_STARTED', label: 'Not started', tone: 'warning', icon: 'circle-dashed', rank: 4 },
  UPCOMING: { key: 'UPCOMING', label: 'Upcoming', tone: 'subtle', icon: 'clock', rank: 5 },
});

/**
 * Compute warning flags for a task at time `now`.
 *  Rule 1 OVERDUE      deadline passed, status not Completed/Cancelled            (takes precedence)
 *  Rule 2 NOT_STARTED  start date reached but status still Not Started
 *  Rule 3 DUE_SOON     deadline within the next 24 hours
 *  Rule 4 UPCOMING     deadline within the next 3 days
 *  Rule 5 DELAYED      In Progress and deadline passed (shown alongside OVERDUE)
 * Completed and Cancelled tasks never receive flags. Result is sorted by precedence.
 */
export function computeFlags(task, now = new Date()) {
  if (!isOpen(task)) return [];
  const flags = [];
  const nowMs = +now;
  const deadline = getDeadline(task);
  if (deadline) {
    const remaining = deadline - nowMs;
    if (remaining < 0) {
      flags.push(FLAGS.OVERDUE);
      if (task.status === 'In Progress') flags.push(FLAGS.DELAYED);
    } else if (remaining <= DAY_MS) {
      flags.push(FLAGS.DUE_SOON);
    } else if (remaining <= 3 * DAY_MS || diffDays(deadline, now) <= 3) {
      // "within the next 3 days" counts calendar days, so a task due on the 3rd day ahead is included.
      flags.push(FLAGS.UPCOMING);
    }
  }
  const start = getStart(task);
  if (task.status === 'Not Started' && start && nowMs >= +start) flags.push(FLAGS.NOT_STARTED);
  return flags.sort((a, b) => a.rank - b.rank);
}

export const primaryFlag = (task, now) => computeFlags(task, now)[0] || null;
export const isOverdue = (task, now = new Date()) => {
  if (!isOpen(task)) return false;
  const d = getDeadline(task);
  return !!d && +d < +now;
};
export const hasFlag = (task, key, now) => computeFlags(task, now).some((f) => f.key === key);

/* ------------------------------------------------------------ Recurrence */

function stepper(rec) {
  const n = clamp(parseInt(rec.interval, 10) || 1, 1, 365);
  switch (rec.freq) {
    case 'daily': return (d) => addDays(d, 1);
    case 'weekdays': return (d) => { let x = addDays(d, 1); while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1); return x; };
    case 'weekly': return (d) => addDays(d, 7);
    case 'monthly': return (d) => addMonths(d, 1);
    case 'custom':
      if (rec.unit === 'week') return (d) => addDays(d, 7 * n);
      if (rec.unit === 'month') return (d) => addMonths(d, n);
      return (d) => addDays(d, n);
    default: return null;
  }
}

export function describeRecurrence(rec) {
  if (!rec || !rec.freq || rec.freq === 'none') return '';
  const n = parseInt(rec.interval, 10) || 1;
  switch (rec.freq) {
    case 'daily': return 'Daily';
    case 'weekdays': return 'Every weekday';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'custom': return `Every ${n} ${rec.unit || 'day'}${n === 1 ? '' : 's'}`;
    default: return '';
  }
}

/**
 * Dates for the next occurrence of a recurring task. The series advances until the next
 * deadline is today or later, so a late completion doesn't generate an already-overdue copy.
 * Returns null for non-recurring tasks.
 */
export function nextOccurrenceDates(task, now = new Date()) {
  const rec = task?.recurrence;
  const step = rec ? stepper(rec) : null;
  if (!step) return null;
  const today = startOfDay(now);
  const anchorStr = task.endDate || task.startDate || toDateStr(today);
  const anchor = parseDate(anchorStr) || today;

  let next = anchor, steps = 0;
  do { next = step(next); steps++; } while (next < today && steps < 5000);

  const out = {};
  if (task.endDate || !task.startDate) out.endDate = toDateStr(next);
  if (task.startDate) {
    if (task.endDate) {
      let st = parseDate(task.startDate);
      for (let i = 0; i < steps; i++) st = step(st);
      if (st > next) st = next;
      out.startDate = toDateStr(st);
    } else {
      out.startDate = toDateStr(next);
    }
  }
  if (task.reminderAt) {
    const r = new Date(task.reminderAt);
    r.setDate(r.getDate() + diffDays(next, anchor));
    out.reminderAt = r.getTime();
  }
  return out;
}

/* ------------------------------------------------- Search, filter, sort */

export function taskSearchText(task, project) {
  return [
    task.title, task.description, task.category, task.notes,
    project?.name, project?.code, ...(task.tags || []),
  ].filter(Boolean).join(' \u0001 ').toLowerCase();
}

export function matchesSearch(task, query, project) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = taskSearchText(task, project);
  return q.split(/\s+/).every((term) => hay.includes(term.replace(/^#/, '')));
}

/**
 * filters: { scope: 'open'|'completed'|'all', status:[], priority:[], category:[], projectId:[],
 *            from, to, flag: 'overdue'|'not-started'|'due-soon'|'due-today'|'this-week'|'', q, includeArchived }
 */
export function filterTasks(tasks, filters = {}, ctx = {}) {
  const now = ctx.now || new Date();
  const projects = ctx.projects || new Map();
  const todayS = toDateStr(now);
  const weekEnd = endOfWeek(now, ctx.weekStartsOn ?? 1);
  return tasks.filter((t) => {
    if (!filters.includeArchived && t.archived) return false;
    if (filters.scope === 'open' && !isOpen(t)) return false;
    if (filters.scope === 'completed' && !isDone(t)) return false;
    if (filters.status?.length && !filters.status.includes(t.status)) return false;
    if (filters.priority?.length && !filters.priority.includes(t.priority)) return false;
    if (filters.category?.length && !filters.category.includes(t.category)) return false;
    if (filters.projectId?.length) {
      const pid = t.projectId || '__none';
      if (!filters.projectId.includes(pid)) return false;
    }
    if (filters.from || filters.to) {
      if (!t.endDate) return false;
      if (filters.from && t.endDate < filters.from) return false;
      if (filters.to && t.endDate > filters.to) return false;
    }
    if (filters.flag) {
      const flags = computeFlags(t, now).map((f) => f.key);
      if (filters.flag === 'overdue' && !flags.includes('OVERDUE')) return false;
      if (filters.flag === 'not-started' && !flags.includes('NOT_STARTED')) return false;
      if (filters.flag === 'due-soon' && !flags.includes('DUE_SOON')) return false;
      if (filters.flag === 'delayed' && !flags.includes('DELAYED')) return false;
      if (filters.flag === 'attention' && !computeFlags(t, now).some((f) => f.rank <= 4)) return false;
      if (filters.flag === 'due-today' && !(isOpen(t) && t.endDate === todayS && !flags.includes('OVERDUE'))) return false;
      if (filters.flag === 'this-week') {
        const d = getDeadline(t);
        if (!(isOpen(t) && d && d >= now && d <= weekEnd)) return false;
      }
    }
    if (filters.q && !matchesSearch(t, filters.q, projects.get(t.projectId))) return false;
    return true;
  });
}

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p) => [p.name, p.rank]));
const STATUS_RANK = Object.fromEntries(TASK_STATUSES.map((s, i) => [s.name, i]));
const deadlineValue = (t) => { const d = getDeadline(t); return d ? +d : Number.POSITIVE_INFINITY; };

export function sortTasks(tasks, by = 'deadline', ctx = {}) {
  const projects = ctx.projects || new Map();
  const list = [...tasks];
  const byDeadline = (a, b) => deadlineValue(a) - deadlineValue(b);
  const byPriority = (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  const openFirst = (a, b) => Number(!isOpen(a)) - Number(!isOpen(b));
  const cmp = {
    deadline: (a, b) => openFirst(a, b) || byDeadline(a, b) || byPriority(a, b),
    priority: (a, b) => openFirst(a, b) || byPriority(a, b) || byDeadline(a, b),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    status: (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byDeadline(a, b),
    project: (a, b) => {
      const pa = projects.get(a.projectId)?.name || '￿', pb = projects.get(b.projectId)?.name || '￿';
      return pa.localeCompare(pb) || openFirst(a, b) || byDeadline(a, b);
    },
    title: (a, b) => a.title.localeCompare(b.title),
  }[by] || ((a, b) => byDeadline(a, b));
  return list.sort((a, b) => cmp(a, b) || String(a.id).localeCompare(String(b.id)));
}

/* ------------------------------------------------------------- Summary */

/** Tasks that belong to "today": overdue + due today (open) + completed today. */
export function todaysTasks(tasks, now = new Date()) {
  const today = toDateStr(now);
  return tasks.filter((t) => {
    if (t.archived || t.status === 'Cancelled') return false;
    if (isDone(t)) return t.completedAt && toDateStr(new Date(t.completedAt)) === today;
    return t.endDate === today || isOverdue(t, now);
  });
}

export function todayProgress(tasks, now = new Date()) {
  const list = todaysTasks(tasks, now);
  const done = list.filter(isDone).length;
  return { total: list.length, done, percent: pct(done, list.length) };
}

export function summaryCounts(tasks, now = new Date(), weekStartsOn = 1) {
  const active = tasks.filter((t) => !t.archived && t.status !== 'Cancelled');
  const today = toDateStr(now);
  const weekEnd = endOfWeek(now, weekStartsOn);
  const thisWeekStart = startOfWeek(now, weekStartsOn);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const inRange = (ms, a, b) => ms && ms >= +a && ms < +b;

  const counts = {
    total: active.length,
    completed: active.filter(isDone).length,
    inProgress: active.filter((t) => t.status === 'In Progress').length,
    pending: active.filter((t) => t.status === 'Not Started' || t.status === 'On Hold').length,
    overdue: 0, dueToday: 0, dueThisWeek: 0, notStarted: 0,
  };
  for (const t of active) {
    if (!isOpen(t)) continue;
    const flags = computeFlags(t, now).map((f) => f.key);
    const d = getDeadline(t);
    if (flags.includes('OVERDUE')) counts.overdue++;
    else {
      if (t.endDate === today) counts.dueToday++;
      if (d && d <= weekEnd) counts.dueThisWeek++;
    }
    if (flags.includes('NOT_STARTED')) counts.notStarted++;
  }
  // Week-over-week comparisons, based on recorded timestamps (includes archived history).
  const all = tasks.filter((t) => t.status !== 'Cancelled');
  counts.completedThisWeek = all.filter((t) => isDone(t) && inRange(t.completedAt, thisWeekStart, addDays(thisWeekStart, 7))).length;
  counts.completedLastWeek = all.filter((t) => isDone(t) && inRange(t.completedAt, lastWeekStart, thisWeekStart)).length;
  counts.createdThisWeek = all.filter((t) => inRange(t.createdAt, thisWeekStart, addDays(thisWeekStart, 7))).length;
  counts.createdLastWeek = all.filter((t) => inRange(t.createdAt, lastWeekStart, thisWeekStart)).length;
  counts.hasHistory = all.some((t) => t.createdAt && t.createdAt < +thisWeekStart);
  return counts;
}

export function projectStats(projectId, tasks, now = new Date()) {
  const list = tasks.filter((t) => t.projectId === projectId && t.status !== 'Cancelled');
  const completed = list.filter(isDone).length;
  const overdue = list.filter((t) => isOverdue(t, now)).length;
  return {
    total: list.length,
    completed,
    pending: list.length - completed,
    inProgress: list.filter((t) => t.status === 'In Progress').length,
    overdue,
    percent: pct(completed, list.length),
  };
}

/* ----------------------------------------------------------- Analytics */

/** Map of 'YYYY-MM-DD' -> count for the `days` days ending today (oldest first). */
export function dailySeries(items, getMs, days, now = new Date(), weight = () => 1) {
  const start = startOfDay(addDays(now, -(days - 1)));
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(toDateStr(addDays(start, i)));
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const it of items) {
    const ms = getMs(it);
    if (!ms || ms < +start) continue;
    const k = toDateStr(new Date(ms));
    if (k in map) map[k] += weight(it);
  }
  return { keys, values: keys.map((k) => map[k]) };
}

export function weeklySeries(items, getMs, weeks, now = new Date(), weekStartsOn = 1, weight = () => 1) {
  const thisWeek = startOfWeek(now, weekStartsOn);
  const starts = [];
  for (let i = weeks - 1; i >= 0; i--) starts.push(addDays(thisWeek, -7 * i));
  const values = starts.map(() => 0);
  const first = starts[0];
  for (const it of items) {
    const ms = getMs(it);
    if (!ms) continue;
    const idx = diffDays(startOfWeek(new Date(ms), weekStartsOn), first) / 7;
    if (idx >= 0 && idx < weeks) values[Math.round(idx)] += weight(it);
  }
  return { starts, values };
}

export function completionStats(tasks, fromMs = 0, toMs = Number.POSITIVE_INFINITY) {
  const done = tasks.filter((t) => isDone(t) && t.completedAt && t.completedAt >= fromMs && t.completedAt <= toMs);
  const withDeadline = done.filter((t) => getDeadline(t));
  const onTime = withDeadline.filter((t) => t.completedAt <= +getDeadline(t));
  const durations = done.map((t) => t.completedAt - (t.startedAt || t.createdAt)).filter((ms) => Number.isFinite(ms) && ms >= 0);
  return {
    completed: done.length,
    withDeadline: withDeadline.length,
    onTime: onTime.length,
    onTimeRate: withDeadline.length ? pct(onTime.length, withDeadline.length) : null,
    avgCompletionMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

export function focusMinutes(sessions, fromMs = 0, toMs = Number.POSITIVE_INFINITY) {
  return sessions
    .filter((s) => s.mode === 'focus' && s.startedAt >= fromMs && s.startedAt <= toMs)
    .reduce((sum, s) => sum + (s.actualSec || 0) / 60, 0);
}

export function countBy(items, keyFn) {
  const map = new Map();
  for (const it of items) { const k = keyFn(it); map.set(k, (map.get(k) || 0) + 1); }
  return map;
}

/* ------------------------------------------------------------- Meetings */

import { combineDateTime } from './utils.js';

export function meetingStart(m) { return m?.date ? combineDateTime(m.date, m.startTime || '00:00') : null; }
export function meetingEnd(m) {
  if (!m?.date) return null;
  if (m.endTime) return combineDateTime(m.date, m.endTime);
  if (m.startTime) { const s = combineDateTime(m.date, m.startTime); return new Date(+s + 30 * 60000); }
  return endOfDay(parseDate(m.date));
}
/** Meetings sorted by start time. */
export const sortMeetings = (list) => [...list].sort((a, b) => (+meetingStart(a) || 0) - (+meetingStart(b) || 0));
export function openActionItems(m) {
  return Object.entries(m?.actionItems || {}).map(([id, it]) => ({ id, ...it })).filter((it) => it && it.text);
}
