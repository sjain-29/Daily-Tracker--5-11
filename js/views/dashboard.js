// js/views/dashboard.js — a calm home screen: greeting, four key numbers, today's tasks, schedule, focus timer
// and what's coming up. Charts and detailed statistics live on the Analytics page.

import { h, clear, greeting, formatLongDate, formatClock, formatTimeStr, formatHours, toDateStr, addDays, relativeDay, combineDateTime, add } from '../utils.js';
import { icon, emptyState, segmented } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { summaryCounts, todaysTasks, todayProgress, isOpen, isDone, sortTasks, getDeadline, meetingStart, meetingEnd, sortMeetings, isOverdue } from '../task-logic.js';
import { taskRow, avatarStack, cardHead, ring } from '../components.js';
import { openTaskForm } from '../task-modal.js';
import { openMeetingForm, openMeetingDetails } from './notes.js';
import { openQuickStart } from '../quick-start.js';
import * as timer from '../timer.js';
import { palette } from '../charts.js';
import { navigate } from '../shared.js';

const view = {
  title: 'Dashboard',
  deps: ['tasks', 'projects', 'meetings', 'focusSessions', 'settings', 'profile', 'tick', 'theme'],

  mount(root) {
    this.root = root;
    this.render();
    this.clockTimer = setInterval(() => this.updateClock(), 10000);
    this.unsubTimer = timer.subscribeTimer((type, st) => this.focus?.update(st));
  },

  unmount() {
    clearInterval(this.clockTimer);
    this.unsubTimer?.();
  },

  refresh() { this.render(); },

  updateClock() {
    const now = new Date();
    const el = this.root?.querySelector('[data-clock]');
    if (el) el.textContent = formatClock(now);
    this.root?.querySelectorAll('[data-countdown]').forEach((node) => { node.lastChild.textContent = countdownLabel(Number(node.dataset.countdown), node.dataset.date, now); });
  },

  render() {
    const root = this.root;
    clear(root);
    if (!store.isLoaded()) { add(root, loadingSkeleton()); return; }

    const now = new Date();
    const tasks = store.list('tasks').filter((t) => !t.archived);
    const c = summaryCounts(store.list('tasks'), now, store.settings.weekStartsOn ?? 1);
    const today = toDateStr(now);
    const meetingsToday = sortMeetings(store.list('meetings').filter((m) => !m.archived && m.date === today));
    const todays = todaysTasks(tasks, now);
    const prog = todayProgress(tasks, now);
    const openToday = todays.filter(isOpen).length;
    const meetingsLeft = meetingsToday.filter((m) => meetingEnd(m) > now).length;

    add(root,
      header(now, openToday, meetingsLeft),
      statStrip(c, prog),
      !tasks.length && !store.list('projects').length ? welcomeCard() : null,
      h('div', { class: 'dash-grid' },
        todayCard(todays, prog, now),
        upNextCard(meetingsToday, tasks, now),
        (this.focus = focusCard()).el,
        comingUpCard(tasks, now)));
  },
};

export default view;

/* ---------------------------------------------------------------- Sections */

function header(now, openToday, meetingsLeft) {
  const first = store.displayName().split(/\s+/)[0];
  const next = nextMeeting(now);
  return h('div', { class: 'dash-header' },
    h('div', { class: 'dash-greeting' },
      h('h1', {}, `${greeting(now)}, ${first}!`),
      h('div', { class: 'date-line' },
        h('span', {}, formatLongDate(now)), h('span', { class: 'sep' }, '·'),
        h('span', { class: 'num', dataset: { clock: '1' } }, formatClock(now)), h('span', { class: 'sep' }, '·'),
        h('span', {}, `${openToday} task${openToday === 1 ? '' : 's'} and ${meetingsLeft} meeting${meetingsLeft === 1 ? '' : 's'} left today`))),
    h('div', { class: 'dash-actions quick-actions' },
      next ? h('button', { class: 'next-pill', type: 'button', onClick: () => openMeetingDetails(next.id), title: next.title }, icon('calendar-clock', { size: 14 }),
        `Next: ${next.date === toDateStr(now) ? formatTimeStr(next.startTime) : relativeDay(next.date, now)}`) : null,
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 15 }), 'New task')));
}

/** Four numbers that matter today; each opens the matching filtered task list. */
function statStrip(c, prog) {
  const tile = (label, iconName, value, tone, hash, hot, of) => h('button', { class: `stat-tile tone-${tone} ${hot ? 'hot' : ''}`, type: 'button', onClick: () => navigate(hash), title: label },
    h('span', { class: 'st-label' }, icon(iconName, { size: 12 }), label),
    h('span', { class: 'st-value' }, String(value), of ? h('small', {}, of) : null));
  return h('div', { class: 'stat-strip-dash simple' },
    tile('Done today', 'circle-check', prog.done, 'green', '#/tasks?scope=completed', false, `/${prog.total}`),
    tile('Due today', 'alarm-clock', c.dueToday, 'orange', '#/tasks?flag=due-today', c.dueToday > 0),
    tile('Overdue', 'triangle-alert', c.overdue, 'red', '#/tasks?flag=overdue', c.overdue > 0),
    tile('In progress', 'loader-circle', c.inProgress, 'blue', '#/tasks?status=In%20Progress'));
}

function welcomeCard() {
  return h('section', { class: 'card', style: 'margin-bottom:16px' },
    h('div', { class: 'row wrap', style: 'gap:16px' },
      h('div', { class: 'empty-icon', style: 'margin:0' }, icon('rocket', { size: 24 })),
      h('div', { style: 'flex:1;min-width:220px' },
        h('h3', {}, 'Welcome'),
        h('p', { class: 'muted', style: 'margin-top:4px' }, 'Add your first task — or start from ready-made R&D projects and daily routines.')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 16 }), 'Add a task'),
        h('button', { class: 'btn', type: 'button', onClick: openQuickStart }, icon('sparkles', { size: 16 }), 'Quick start'))));
}

function todayCard(todays, prog, now) {
  const sorted = [...todays].sort((a, b) => {
    const ra = isDone(a) ? 2 : isOverdue(a, now) ? 0 : 1, rb = isDone(b) ? 2 : isOverdue(b, now) ? 0 : 1;
    return ra - rb || (getDeadline(a) || 0) - (getDeadline(b) || 0);
  });
  return h('section', { class: 'card d-today' },
    cardHead('My tasks', prog.total ? `${prog.done} of ${prog.total} done today` : 'Due today and overdue',
      [ring(prog.percent, { size: 40, stroke: 4, color: 'var(--accent)', label: h('span', { style: 'font-size:10.5px' }, `${prog.percent}%`) }),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Add task due today', onClick: () => openTaskForm({ defaults: { endDate: toDateStr(now) } }) }, icon('plus', { size: 16 }))]),
    sorted.length
      ? h('div', { class: 'task-list card-scroll' }, sorted.map((t) => taskRow(t, { now })))
      : emptyState({ iconName: 'circle-check', title: 'All clear for today', text: 'Nothing due today and nothing overdue.' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:8px', onClick: () => navigate('#/tasks') }, 'All tasks', icon('arrow-right', { size: 14 })));
}

/** Open tasks with a deadline in the next 7 days (after today). */
function comingUpCard(tasks, now) {
  const in7 = addDays(now, 7);
  const list = sortTasks(tasks.filter((t) => { const d = getDeadline(t); return isOpen(t) && d && d > now && d <= in7 && t.endDate !== toDateStr(now); }), 'deadline');
  return h('section', { class: 'card d-upcoming' },
    cardHead('Coming up', 'Deadlines in the next 7 days'),
    list.length
      ? h('div', { class: 'task-list card-scroll' }, list.slice(0, 8).map((t) => taskRow(t, { now })))
      : emptyState({ iconName: 'calendar-check', title: 'Nothing due this week', text: 'No deadlines in the next 7 days.' }));
}

function countdownLabel(startMs, date, now) {
  if (date !== toDateStr(now)) return relativeDay(date, now);
  const mins = Math.round((startMs - now) / 60000);
  if (mins <= 0) return 'Happening now';
  return mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function nextMeeting(now) {
  return sortMeetings(store.list('meetings').filter((m) => !m.archived && m.startTime && meetingStart(m) > now))[0] || null;
}

function upNextCard(meetingsToday, tasks, now) {
  const upcoming = meetingsToday.filter((m) => meetingEnd(m) > now);
  const hero = upcoming[0] || nextMeeting(now);
  const timedTasks = tasks.filter((t) => isOpen(t) && t.endDate === toDateStr(now) && t.dueTime)
    .map((t) => ({ kind: 'task', t, at: combineDateTime(t.endDate, t.dueTime) }));
  const reminders = tasks.filter((t) => isOpen(t) && t.reminderAt && toDateStr(new Date(t.reminderAt)) === toDateStr(now))
    .map((t) => ({ kind: 'reminder', t, at: new Date(t.reminderAt) }));
  const agenda = [
    ...meetingsToday.filter((m) => m !== hero).map((m) => ({ kind: 'meeting', m, at: meetingStart(m) })),
    ...timedTasks, ...reminders,
  ].sort((a, b) => a.at - b.at);

  let heroEl = null;
  if (hero) {
    const start = meetingStart(hero);
    heroEl = h('div', { class: 'upnext-hero', role: 'button', tabindex: '0', onClick: () => openMeetingDetails(hero.id), onKeydown: (e) => e.key === 'Enter' && openMeetingDetails(hero.id) },
      h('div', { class: 'when', dataset: { countdown: String(+start), date: hero.date } }, icon('clock', { size: 13 }), h('span', {}, countdownLabel(+start, hero.date, now))),
      h('div', { class: 'what' }, hero.title),
      h('div', { class: 'meta' },
        hero.startTime ? h('span', {}, `${formatTimeStr(hero.startTime)}${hero.endTime ? ` – ${formatTimeStr(hero.endTime)}` : ''}`) : null,
        hero.location ? h('span', { class: 'row', style: 'gap:4px' }, icon('map-pin', { size: 12 }), hero.location) : null,
        hero.participants?.length ? avatarStack(hero.participants) : null));
  }
  return h('section', { class: 'card d-upnext' },
    cardHead('Up next', "Today's schedule", h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => navigate(`#/calendar?view=day&date=${toDateStr(now)}`) }, 'Calendar')),
    heroEl,
    agenda.length ? h('div', { class: 'agenda' }, agenda.slice(0, 4).map((a) => {
      const past = a.at < now;
      if (a.kind === 'meeting') return h('div', { class: `agenda-item ${past ? 'past' : ''}`, style: { '--c': 'var(--accent-2)' }, onClick: () => openMeetingDetails(a.m.id) }, h('span', { class: 't' }, a.m.title), h('span', { class: 'time' }, formatTimeStr(a.m.startTime) || 'All day'));
      return h('div', { class: `agenda-item ${past ? 'past' : ''}`, style: { '--c': a.kind === 'reminder' ? 'var(--warning)' : 'var(--accent)' }, onClick: () => import('../task-modal.js').then((m) => m.openTaskDetails(a.t.id)) },
        icon(a.kind === 'reminder' ? 'bell-ring' : 'flag', { size: 13 }), h('span', { class: 't' }, a.t.title), h('span', { class: 'time' }, formatClock(a.at)));
    })) : null,
    !hero && !agenda.length ? emptyState({ iconName: 'calendar-check', title: 'Nothing scheduled', text: 'No meetings or timed deadlines today — a good day for deep work.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openMeetingForm() }, icon('plus', { size: 15 }), 'Add meeting') }) : null);
}

/* ---------------------------------------------------------------- Focus card */

function focusCard() {
  const p = palette();
  const size = 150, stroke = 9, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const timeEl = h('span', { class: 'timer-time' }, '25:00');
  const stateEl = h('span', { class: 'timer-state' }, 'Ready');
  const ringEl = h('div', { class: 'ring timer-ring', style: { width: `${size}px`, height: `${size}px` } });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('width', size); svg.setAttribute('height', size);
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ring-track)', 'stroke-width': stroke })) track.setAttribute(k, v);
  for (const [k, v] of Object.entries({ cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', transform: `rotate(-90 ${size / 2} ${size / 2})` })) arc.setAttribute(k, v);
  add(svg, track, arc);
  add(ringEl, svg, h('div', { class: 'ring-label' }, timeEl, stateEl));

  const controls = h('div', { class: 'timer-controls' });
  const meta = h('div', { class: 'timer-meta' });
  const modeWrap = h('div');
  const soundBtn = h('button', { class: 'icon-btn sm ghost', type: 'button', onClick: () => db.saveSettings({ focus: { sound: !store.settings.focus.sound } }) });

  const el = h('section', { class: 'card d-focus', id: 'focus-card' },
    cardHead('Focus timer', 'Durations can be changed in Settings', soundBtn),
    h('div', { class: 'timer-body' }, modeWrap, ringEl, controls, meta));

  let lastMode = null, lastStatus = null;
  function update(st = timer.getState()) {
    const modeColor = st.mode === 'focus' ? p.accent : st.mode === 'short' ? p.success : p.accent2;
    arc.setAttribute('stroke', modeColor);
    arc.setAttribute('stroke-dasharray', `${Math.max(0.001, (st.status === 'idle' ? 1 : 1 - st.progress) * circ)} ${circ}`);
    timeEl.textContent = timer.formatRemaining(st.remaining);
    stateEl.textContent = st.status === 'running' ? timer.MODES[st.mode].verb : st.status === 'paused' ? 'Paused' : `${Math.round(st.total / 60)}-minute ${st.mode === 'focus' ? 'block' : 'break'}`;
    add(clear(soundBtn), icon(store.settings.focus.sound ? 'volume-2' : 'volume-x', { size: 16 }));
    soundBtn.setAttribute('aria-label', store.settings.focus.sound ? 'Mute timer sound' : 'Unmute timer sound');
    if (st.mode === lastMode && st.status === lastStatus) return; // only text changed
    lastMode = st.mode; lastStatus = st.status;
    add(clear(modeWrap), segmented([{ value: 'focus', label: 'Focus' }, { value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }], st.mode, (v) => timer.setMode(v), { size: 'sm', label: 'Timer mode' }));
    clear(controls);
    if (st.status === 'running') add(controls, btn('pause', 'Pause', timer.pause), btn('square', 'End', timer.endEarly, 'btn-ghost'));
    else if (st.status === 'paused') add(controls, btn('play', 'Resume', timer.start, 'btn-primary'), btn('rotate-ccw', 'Reset', timer.reset, 'btn-ghost'), btn('square', 'End', timer.endEarly, 'btn-ghost'));
    else add(controls, btn('play', st.mode === 'focus' ? 'Start focus' : 'Start break', timer.start, 'btn-primary'));
    const today = timer.todayFocus();
    const longEvery = store.settings.focus.longEvery || 4;
    add(clear(meta), 
      h('span', {}, 'Sessions ', h('strong', {}, String(today.sessions))),
      h('span', {}, 'Cycle ', h('strong', {}, `${(st.cycle % longEvery)}/${longEvery}`)),
      h('span', {}, 'Today ', h('strong', {}, formatHours(today.minutes))));
  }
  update();
  return { el, update };
}

function btn(iconName, label, fn, cls = '') {
  return h('button', { class: `btn btn-sm ${cls}`, type: 'button', onClick: () => fn() }, icon(iconName, { size: 15 }), label);
}

function loadingSkeleton() {
  return h('div', { class: 'stack' },
    h('div', { class: 'skeleton', style: 'height:64px;max-width:420px' }),
    h('div', { class: 'dash-grid' },
      h('div', { class: 'skeleton d-today', style: 'height:300px' }), h('div', { class: 'skeleton d-upnext', style: 'height:300px' }),
      h('div', { class: 'skeleton d-focus', style: 'height:280px' }), h('div', { class: 'skeleton d-upcoming', style: 'height:280px' })));
}
