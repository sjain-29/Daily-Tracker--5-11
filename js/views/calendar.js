// js/views/calendar.js — month / week / day calendar of deadlines, meetings and reminders.

import { h, clear, toDateStr, parseDate, addDays, addMonths, startOfWeek, startOfMonth, formatDate, formatTimeStr, formatClock, pad, isSameDay, add } from '../utils.js';
import { icon, segmented, emptyState, popMenu } from '../ui.js';
import { store } from '../store.js';
import { TASK_CATEGORIES, categoryColor } from '../constants.js';
import { isOverdue, isDone, sortMeetings } from '../task-logic.js';
import { taskRow } from '../components.js';
import { openTaskForm } from '../task-modal.js';
import { openMeetingForm, openMeetingDetails } from './notes.js';
import { viewSwitcher } from './tasks.js';

const MEETING_COLOR = '#e879f9';
const REMINDER_COLOR = '#f59e0b';

/** Everything that happens on each date, keyed 'YYYY-MM-DD'. */
function collect() {
  const map = new Map();
  const add = (date, item) => { if (!map.has(date)) map.set(date, []); map.get(date).push(item); };
  for (const t of store.list('tasks')) {
    if (t.archived || t.status === 'Cancelled') continue;
    if (t.endDate) add(t.endDate, { kind: 'task', t, time: t.dueTime || null, color: categoryColor(t.category) });
    if (t.reminderAt && !isDone(t)) {
      const d = new Date(t.reminderAt);
      add(toDateStr(d), { kind: 'reminder', t, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, color: REMINDER_COLOR });
    }
  }
  for (const m of sortMeetings(store.list('meetings'))) {
    if (m.archived) continue;
    add(m.date, { kind: 'meeting', m, time: m.startTime || null, color: MEETING_COLOR });
    if (m.followUpDate && !m.followUpDone) add(m.followUpDate, { kind: 'followup', m, time: null, color: MEETING_COLOR });
  }
  for (const list of map.values()) list.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return map;
}

function itemLabel(it) {
  if (it.kind === 'task') return it.t.title;
  if (it.kind === 'reminder') return `Reminder: ${it.t.title}`;
  if (it.kind === 'followup') return `Follow up: ${it.m.title}`;
  return it.m.title;
}

function openItem(it) {
  if (it.kind === 'task' || it.kind === 'reminder') openTaskForm({ task: store.task(it.t.id) || it.t });
  else openMeetingDetails(it.m.id);
}

function itemEl(it, now, { showTime = true } = {}) {
  const overdue = it.kind === 'task' && isOverdue(it.t, now);
  const done = it.kind === 'task' && isDone(it.t);
  const iconName = it.kind === 'meeting' ? 'users' : it.kind === 'reminder' ? 'bell-ring' : it.kind === 'followup' ? 'handshake' : null;
  return h('button', {
    class: `cal-item ${overdue ? 'overdue' : ''} ${done ? 'done' : ''}`, type: 'button', style: { '--c': it.color },
    title: `${itemLabel(it)}${it.time ? ` · ${formatTimeStr(it.time)}` : ''}${overdue ? ' · OVERDUE' : ''}`,
    onClick: (e) => { e.stopPropagation(); openItem(it); },
  }, iconName ? icon(iconName, { size: 11 }) : null, showTime && it.time ? h('span', { class: 'time' }, formatTimeStr(it.time)) : null, h('span', {}, itemLabel(it)));
}

function addMenu(anchor, date) {
  popMenu(anchor, [
    { heading: formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) },
    { label: 'Add task due this day', icon: 'square-pen', onClick: () => openTaskForm({ defaults: { endDate: date } }) },
    { label: 'Add meeting', icon: 'calendar-plus', onClick: () => openMeetingForm({ defaults: { date } }) },
  ], { align: 'start' });
}

const view = {
  title: 'Calendar',
  deps: ['tasks', 'meetings', 'tick', 'settings'],

  mount(root, route) {
    this.root = root;
    this.mode = ['month', 'week', 'day'].includes(route.query.get('view')) ? route.query.get('view') : (window.matchMedia('(max-width: 760px)').matches ? 'month' : 'month');
    this.cursor = parseDate(route.query.get('date')) || new Date();
    this.refresh();
  },

  go(delta) {
    this.cursor = this.mode === 'month' ? addMonths(startOfMonth(this.cursor), delta) : addDays(this.cursor, this.mode === 'week' ? 7 * delta : delta);
    this.refresh();
  },

  refresh() {
    if (!this.root) return;
    const now = new Date();
    const items = collect();
    const wso = store.settings.weekStartsOn ?? 1;
    clear(this.root);
    let title;
    if (this.mode === 'month') title = formatDate(this.cursor, { month: 'long', year: 'numeric' });
    else if (this.mode === 'week') { const s = startOfWeek(this.cursor, wso); title = `${formatDate(s, { day: 'numeric', month: 'short' })} – ${formatDate(addDays(s, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`; }
    else title = formatDate(this.cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    add(this.root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Calendar'), h('p', {}, 'Deadlines, meetings, reminders and follow-ups. Click a day to add a task.')),
        h('div', { class: 'page-actions' }, viewSwitcher('calendar'),
          h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openMeetingForm({ defaults: { date: toDateStr(this.cursor) } }) }, icon('calendar-plus', { size: 15 }), 'Meeting'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm({ defaults: { endDate: toDateStr(this.cursor) } }) }, icon('plus', { size: 16 }), 'Task'))),
      h('div', { class: 'cal-head' },
        h('h2', {}, title),
        h('div', { class: 'row' },
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Previous', onClick: () => this.go(-1) }, icon('chevron-left', { size: 16 })),
          h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { this.cursor = new Date(); this.refresh(); } }, 'Today'),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Next', onClick: () => this.go(1) }, icon('chevron-right', { size: 16 }))),
        h('span', { class: 'spacer' }),
        segmented([{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }], this.mode, (v) => { this.mode = v; this.refresh(); }, { size: 'sm', label: 'Calendar view' })),
      this.mode === 'month' ? this.month(items, now, wso) : this.mode === 'week' ? this.week(items, now, wso) : this.day(items, now),
      h('div', { class: 'cal-legend' },
        TASK_CATEGORIES.map((c) => h('span', { class: 'cat-tag' }, h('span', { class: 'dot', style: { background: c.color } }), c.name)),
        h('span', { class: 'cat-tag' }, icon('users', { size: 12 }), 'Meeting'),
        h('span', { class: 'cat-tag' }, icon('bell-ring', { size: 12 }), 'Reminder'),
        h('span', { class: 'cat-tag' }, h('span', { class: 'cal-load', style: 'display:inline-flex' }, '3+'), 'Busy day (3+ deadlines)')));
  },

  month(items, now, wso) {
    const first = startOfMonth(this.cursor);
    const gridStart = startOfWeek(first, wso);
    const grid = h('div', { class: 'cal-month', role: 'grid' });
    for (let i = 0; i < 7; i++) add(grid, h('div', { class: 'cal-dow', role: 'columnheader' }, formatDate(addDays(gridStart, i), { weekday: 'short' })));
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const key = toDateStr(d);
      const list = items.get(key) || [];
      const deadlines = list.filter((it) => it.kind === 'task' && !isDone(it.t));
      const hasOverdue = deadlines.some((it) => isOverdue(it.t, now));
      const busy = deadlines.length >= 3;
      const cell = h('div', {
        class: `cal-cell ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${isSameDay(d, now) ? 'today' : ''} ${busy ? 'busy' : ''}`, role: 'gridcell', tabindex: '0',
        'aria-label': `${formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${list.length} item${list.length === 1 ? '' : 's'}`,
        onClick: () => openTaskForm({ defaults: { endDate: key } }),
        onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTaskForm({ defaults: { endDate: key } }); },
      },
      h('div', { class: 'cal-cell-top' },
        h('button', { class: 'cal-date', type: 'button', title: 'Open day view', onClick: (e) => { e.stopPropagation(); this.cursor = d; this.mode = 'day'; this.refresh(); } }, String(d.getDate())),
        deadlines.length >= 2 || hasOverdue ? h('span', { class: `cal-load ${hasOverdue ? 'danger' : ''}`, title: `${deadlines.length} open deadline${deadlines.length === 1 ? '' : 's'}${hasOverdue ? ', some overdue' : ''}` }, `${deadlines.length} due`) : null),
      list.slice(0, 3).map((it) => itemEl(it, now)),
      list.length > 3 ? h('button', { class: 'cal-more', type: 'button', onClick: (e) => { e.stopPropagation(); this.cursor = d; this.mode = 'day'; this.refresh(); } }, `+${list.length - 3} more`) : null);
      add(grid, cell);
    }
    return grid;
  },

  week(items, now, wso) {
    const start = startOfWeek(this.cursor, wso);
    return h('div', { class: 'cal-week' }, Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const key = toDateStr(d);
      const list = items.get(key) || [];
      const deadlines = list.filter((it) => it.kind === 'task' && !isDone(it.t)).length;
      return h('section', { class: `card cal-week-day ${isSameDay(d, now) ? 'today' : ''}`, onClick: (e) => { if (e.target === e.currentTarget) addMenu(e.currentTarget, key); } },
        h('div', { class: 'wd', onClick: () => { this.cursor = d; this.mode = 'day'; this.refresh(); } },
          h('strong', {}, String(d.getDate())), h('span', {}, formatDate(d, { weekday: 'short' })), h('span', { class: 'spacer' }),
          deadlines >= 3 ? h('span', { class: 'cal-load', style: 'display:inline-flex' }, `${deadlines} due`) : null),
        list.map((it) => itemEl(it, now)),
        h('button', { class: 'k-add', type: 'button', style: 'margin:auto 0 0', onClick: (e) => { e.stopPropagation(); addMenu(e.currentTarget, key); } }, icon('plus', { size: 14 }), 'Add'));
    }));
  },

  day(items, now) {
    const key = toDateStr(this.cursor);
    const list = items.get(key) || [];
    const timed = list.filter((it) => it.time);
    const untimed = list.filter((it) => !it.time);
    const hours = [];
    const firstHour = Math.min(7, ...timed.map((it) => Number(it.time.slice(0, 2))));
    const lastHour = Math.max(21, ...timed.map((it) => Number(it.time.slice(0, 2))));
    for (let hr = firstHour; hr <= lastHour; hr++) {
      const slotItems = timed.filter((it) => Number(it.time.slice(0, 2)) === hr);
      const isNow = isSameDay(this.cursor, now) && now.getHours() === hr;
      const d = new Date(this.cursor); d.setHours(hr, 0, 0, 0);
      hours.push(h('div', { class: `hour-row ${isNow ? 'now' : ''}` },
        h('div', { class: 'h' }, formatClock(d)),
        h('div', { class: 'slot', onClick: (e) => { if (e.target === e.currentTarget) openMeetingForm({ defaults: { date: key, startTime: `${pad(hr)}:00`, endTime: `${pad(Math.min(23, hr + 1))}:00` } }); } },
          slotItems.map((it) => itemEl(it, now)))));
    }
    const dueTasks = untimed.filter((it) => it.kind === 'task').map((it) => store.task(it.t.id) || it.t);
    const others = untimed.filter((it) => it.kind !== 'task');
    return h('div', { class: 'cal-day' },
      h('section', { class: 'card hour-grid' }, h('div', { class: 'card-sub', style: 'margin-bottom:8px' }, 'Click an empty hour to schedule a meeting'), hours),
      h('div', { class: 'stack' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', { class: 'card-titles' }, h('h3', { class: 'card-title' }, 'Due this day'), h('p', { class: 'card-sub' }, `${dueTasks.length} task${dueTasks.length === 1 ? '' : 's'} without a set time`)),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Add task', onClick: () => openTaskForm({ defaults: { endDate: key } }) }, icon('plus', { size: 15 }))),
          dueTasks.length ? h('div', { class: 'task-list' }, dueTasks.map((t) => taskRow(t, { now }))) : emptyState({ iconName: 'calendar-check', title: 'No deadlines', text: 'Nothing due on this day.' })),
        others.length ? h('section', { class: 'card' }, h('h3', { class: 'card-title', style: 'margin-bottom:10px' }, 'Follow-ups'), h('div', { class: 'stack', style: 'gap:6px' }, others.map((it) => itemEl(it, now)))) : null));
  },
};

export default view;
