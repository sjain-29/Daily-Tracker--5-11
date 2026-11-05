// js/views/dashboard.js — the home screen: greeting, summary cards, rings, focus timer, today/upcoming, charts.

import { h, clear, greeting, formatLongDate, formatClock, formatTimeStr, formatHours, toDateStr, addDays, startOfWeek, pct, relativeDay, dayOfYear, combineDateTime, formatDate, add } from '../utils.js';
import { icon, emptyState, skeleton, segmented, selectEl, toast } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { MOTIVATION, PRIORITIES } from '../constants.js';
import {
  summaryCounts, todaysTasks, todayProgress, computeFlags, isOpen, isDone, sortTasks, getDeadline,
  dailySeries, meetingStart, meetingEnd, sortMeetings, isOverdue,
} from '../task-logic.js';
import { taskRow, activityRings, avatarStack, cardHead, progressBar } from '../components.js';
import { openTaskForm } from '../task-modal.js';
import { openProjectForm } from './projects.js';
import { openMeetingForm, openNoteForm, openMeetingDetails } from './notes.js';
import { openQuickStart } from '../quick-start.js';
import * as timer from '../timer.js';
import { chartGroup, palette, axes } from '../charts.js';
import { navigate } from '../shared.js';

const view = {
  title: 'Dashboard',
  deps: ['tasks', 'projects', 'meetings', 'focusSessions', 'settings', 'profile', 'tick', 'theme'],
  state: { upcomingTab: 'week', chartMode: 'week' },

  mount(root) {
    this.root = root;
    this.charts = chartGroup();
    this.render();
    this.clockTimer = setInterval(() => this.updateClock(), 10000);
    this.unsubTimer = timer.subscribeTimer((type, st) => this.focus?.update(st));
  },

  unmount() {
    clearInterval(this.clockTimer);
    this.unsubTimer?.();
    this.charts.destroyAll();
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
    this.charts.destroyAll();
    clear(root);
    if (!store.isLoaded()) { add(root, loadingSkeleton()); return; }

    const now = new Date();
    const tasks = store.list('tasks').filter((t) => !t.archived);
    const weekStartsOn = store.settings.weekStartsOn ?? 1;
    const c = summaryCounts(store.list('tasks'), now, weekStartsOn);
    const today = toDateStr(now);
    const meetingsToday = sortMeetings(store.list('meetings').filter((m) => !m.archived && m.date === today));
    const todays = todaysTasks(tasks, now);
    const prog = todayProgress(tasks, now);
    const openToday = todays.filter(isOpen).length;
    const meetingsLeft = meetingsToday.filter((m) => meetingEnd(m) > now).length;

    add(root, 
      header(now, openToday, meetingsLeft),
      quickActions(),
      !tasks.length && !store.list('projects').length ? welcomeCard() : null,
      h('div', { class: 'dash-grid' },
        statCards(c),
        alertRow(c),
        ringsCard(prog, meetingsToday, now),
        (this.focus = focusCard()).el,
        upNextCard(meetingsToday, tasks, now),
        todayCard(todays, now),
        this.upcomingCard(tasks, now),
        this.weekCard(tasks, now, weekStartsOn),
        this.projectsCard(tasks),
        this.mixCard(tasks, now)));
    // Runs after the chart microtasks queued above, so only the first render animates.
    queueMicrotask(() => this.charts.markRendered());
  },

  upcomingCard(tasks, now) {
    const open = tasks.filter(isOpen);
    const in7 = addDays(now, 7);
    const lists = {
      week: sortTasks(open.filter((t) => { const d = getDeadline(t); return d && d >= now && d <= in7 && t.endDate !== toDateStr(now); }), 'deadline'),
      deadlines: sortTasks(open.filter((t) => computeFlags(t, now).some((f) => f.key === 'DUE_SOON' || f.key === 'UPCOMING')), 'deadline'),
      followups: followUps(open, now),
      overdue: sortTasks(open.filter((t) => isOverdue(t, now)), 'deadline'),
    };
    const tabs = [['week', 'Next 7 days'], ['deadlines', 'Approaching'], ['followups', 'Follow-ups'], ['overdue', 'Overdue']];
    const body = h('div', { class: 'card-scroll' });
    const draw = () => {
      clear(body);
      const list = lists[this.state.upcomingTab];
      if (this.state.upcomingTab === 'followups') {
        if (!list.length) add(body, emptyState({ iconName: 'handshake', title: 'No pending follow-ups', text: 'Meeting follow-ups, tasks On Hold and tasks tagged “approval” or “follow-up” appear here.' }));
        for (const item of list) add(body, item.kind === 'task' ? taskRow(item.task, { now }) : followUpRow(item.meeting, now));
        return;
      }
      if (!list.length) add(body, emptyState({ iconName: this.state.upcomingTab === 'overdue' ? 'circle-check' : 'calendar-check', title: this.state.upcomingTab === 'overdue' ? 'Nothing overdue' : 'Nothing coming up', text: this.state.upcomingTab === 'overdue' ? 'Every open task is on schedule.' : 'No deadlines in this window.' }));
      list.slice(0, 30).forEach((t) => add(body, taskRow(t, { now })));
    };
    const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([key, label]) => h('button', {
      class: `tab ${this.state.upcomingTab === key ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(this.state.upcomingTab === key),
      onClick: (e) => { this.state.upcomingTab = key; tabBar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); draw(); },
    }, label, h('span', { class: 'count' }, String(lists[key].length)))));
    draw();
    return h('section', { class: 'card d-upcoming' }, cardHead('Upcoming', 'Deadlines, follow-ups and approvals'), tabBar, body);
  },

  weekCard(tasks, now, weekStartsOn) {
    const all = store.list('tasks');
    const p = palette();
    const canvas = h('canvas', { 'aria-label': 'Tasks completed per day' });
    const box = h('div', { class: 'chart-box' }, canvas);
    const weekStart = startOfWeek(now, weekStartsOn);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const doneThisWeek = all.filter((t) => isDone(t) && t.completedAt >= +weekStart).length;
    const buildCharts = () => {
      if (this.state.chartMode === 'week') {
        const counts = days.map((d) => all.filter((t) => isDone(t) && t.completedAt && toDateStr(new Date(t.completedAt)) === toDateStr(d)).length);
        this.charts.add(canvas, {
          type: 'bar',
          data: { labels: days.map((d) => formatDate(d, { weekday: 'short' })), datasets: [{ label: 'Completed', data: counts, backgroundColor: days.map((d) => (toDateStr(d) === toDateStr(now) ? p.accent : `rgba(${p.accentRgb}, .35)`)), borderRadius: 8, maxBarThickness: 34 }] },
          options: { scales: axes() },
        });
      } else {
        const done = dailySeries(all.filter(isDone), (t) => t.completedAt, 14, now);
        const created = dailySeries(all, (t) => t.createdAt, 14, now);
        this.charts.add(canvas, {
          type: 'line',
          data: {
            labels: done.keys.map((k) => formatDate(k, { day: 'numeric', month: 'short' })),
            datasets: [
              { label: 'Completed', data: done.values, borderColor: p.accent, backgroundColor: `rgba(${p.accentRgb}, .15)`, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
              { label: 'Created', data: created.values, borderColor: p.accent2, borderDash: [4, 4], tension: 0.35, pointRadius: 0, borderWidth: 1.5 },
            ],
          },
          options: { scales: axes(), plugins: { legend: { display: true, position: 'bottom' } } },
        });
      }
    };
    queueMicrotask(buildCharts);
    const seg = segmented([{ value: 'week', label: 'Week' }, { value: 'trend', label: '14 days' }], this.state.chartMode, (v) => { this.state.chartMode = v; this.render(); }, { size: 'sm', label: 'Chart range' });
    return h('section', { class: 'card d-week' },
      cardHead('This week', `${doneThisWeek} finished so far`, seg), box);
  },

  projectsCard(tasks) {
    const p = palette();
    const counts = new Map();
    for (const t of tasks) {
      if (t.status === 'Cancelled') continue;
      const key = t.projectId && store.project(t.projectId) ? t.projectId : '__none';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const rows = [...counts.entries()].map(([id, n]) => {
      const proj = store.project(id);
      return { id, n, name: proj ? proj.name : 'No project', color: proj ? proj.color : p.faint };
    }).sort((a, b) => b.n - a.n);
    const total = rows.reduce((s, r) => s + r.n, 0);
    if (!total) {
      return h('section', { class: 'card d-projects' }, cardHead('By project', 'Where your work is going'),
        emptyState({ iconName: 'folder-kanban', title: 'No tasks yet', text: 'Distribution appears once tasks are assigned to projects.' }));
    }
    const canvas = h('canvas', { 'aria-label': 'Tasks by project' });
    queueMicrotask(() => this.charts.add(canvas, {
      type: 'doughnut',
      data: { labels: rows.map((r) => r.name), datasets: [{ data: rows.map((r) => r.n), backgroundColor: rows.map((r) => r.color), borderWidth: 0, spacing: 3, borderRadius: 6, hoverOffset: 4 }] },
      options: { cutout: '76%', interaction: { mode: 'nearest', intersect: true } },
    }));
    return h('section', { class: 'card d-projects' },
      cardHead('By project', 'Work distribution across projects'),
      h('div', { class: 'rings-card-body', style: 'align-items:flex-start' },
        h('div', { class: 'ring', style: 'width:132px;height:132px' }, h('div', { class: 'chart-box', style: 'position:absolute;inset:0;height:auto' }, canvas),
          h('div', { class: 'rings-center' }, h('strong', {}, String(total)), h('span', {}, 'tasks'))),
        h('div', { class: 'legend-list', style: 'margin-top:0;flex:1;min-width:0' },
          rows.slice(0, 6).map((r) => h('div', { class: 'legend-item', style: 'cursor:pointer', onClick: () => r.id !== '__none' && navigate(`#/projects/${r.id}`) },
            h('span', { class: 'dot', style: { background: r.color } }), h('span', { class: 'name' }, r.name),
            h('span', { class: 'v' }, String(r.n)), h('span', { class: 'p' }, `${pct(r.n, total)}%`))))));
  },

  mixCard(tasks, now) {
    const p = palette();
    const active = tasks.filter((t) => t.status !== 'Cancelled');
    const done = active.filter(isDone).length;
    const overdue = active.filter((t) => isOverdue(t, now)).length;
    const inProg = active.filter((t) => t.status === 'In Progress' && !isOverdue(t, now)).length;
    const pending = active.length - done - overdue - inProg;
    const canvas = h('canvas', { 'aria-label': 'Completed versus pending' });
    if (active.length) {
      queueMicrotask(() => this.charts.add(canvas, {
        type: 'doughnut',
        data: { labels: ['Completed', 'In progress', 'Pending', 'Overdue'], datasets: [{ data: [done, inProg, pending, overdue], backgroundColor: [p.success, p.accent, 'rgba(148,163,184,.55)', p.danger], borderWidth: 0, spacing: 2, borderRadius: 4 }] },
        options: { cutout: '70%', interaction: { mode: 'nearest', intersect: true } },
      }));
    }
    const open = active.filter(isOpen);
    const prioRows = PRIORITIES.map((pr) => ({ ...pr, n: open.filter((t) => t.priority === pr.name).length }));
    const maxN = Math.max(1, ...prioRows.map((r) => r.n));
    return h('section', { class: 'card d-mix' },
      cardHead('Completed vs pending', `${pct(done, active.length)}% of all tasks done`),
      active.length ? h('div', { class: 'row', style: 'gap:14px;align-items:center' },
        h('div', { class: 'ring', style: 'width:96px;height:96px' }, h('div', { class: 'chart-box', style: 'position:absolute;inset:0;height:auto' }, canvas),
          h('div', { class: 'rings-center' }, h('strong', { style: 'font-size:18px' }, `${pct(done, active.length)}%`))),
        h('div', { class: 'legend-list', style: 'margin:0;flex:1' },
          [['Completed', done, p.success], ['In progress', inProg, p.accent], ['Pending', pending, 'rgba(148,163,184,.8)'], ['Overdue', overdue, p.danger]].map(([l, n, col]) =>
            h('div', { class: 'legend-item' }, h('span', { class: 'dot', style: { background: col } }), h('span', { class: 'name' }, l), h('span', { class: 'v' }, String(n))))))
        : emptyState({ iconName: 'chart-pie', title: 'No data yet' }),
      h('div', { class: 'stack', style: 'gap:8px;margin-top:16px' },
        h('div', { class: 'field-label' }, 'Open tasks by priority'),
        prioRows.map((r) => h('div', { class: 'row', style: 'gap:8px;font-size:12px' },
          h('span', { style: 'width:58px', class: 'muted' }, r.name),
          h('div', { style: 'flex:1' }, progressBar((r.n / maxN) * 100, r.color, { thin: true })),
          h('span', { class: 'num', style: 'width:22px;text-align:right' }, String(r.n))))));
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
      h('div', { class: 'date-line' }, formatLongDate(now), h('span', { class: 'faint' }, '·'),
        h('span', {}, `${meetingsLeft} meeting${meetingsLeft === 1 ? '' : 's'} and ${openToday} task${openToday === 1 ? '' : 's'} left today`)),
      h('p', { class: 'motivation' }, MOTIVATION[dayOfYear(now) % MOTIVATION.length])),
    h('div', { class: 'dash-clock' },
      h('div', { class: 'time', dataset: { clock: '1' } }, formatClock(now)),
      next ? h('div', { class: 'next' }, h('button', { class: 'next-pill', type: 'button', onClick: () => openMeetingDetails(next.id) }, icon('clock', { size: 14 }),
        `Next: ${next.date === toDateStr(now) ? formatTimeStr(next.startTime) : relativeDay(next.date, now)} · ${next.title}`)) : null));
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

function quickActions() {
  return h('div', { class: 'quick-actions' },
    h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 16 }), 'Add Task'),
    h('button', { class: 'btn', type: 'button', onClick: () => openProjectForm() }, icon('folder-plus', { size: 16 }), 'Add Project'),
    h('button', { class: 'btn', type: 'button', onClick: () => openNoteForm() }, icon('sticky-note', { size: 16 }), 'Add Note'),
    h('button', { class: 'btn', type: 'button', onClick: () => openMeetingForm() }, icon('calendar-plus', { size: 16 }), 'Add Meeting'),
    h('button', { class: 'btn', type: 'button', onClick: () => { timer.setMode('focus'); timer.start(); document.getElementById('focus-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, icon('timer', { size: 16 }), 'Start Focus Session'));
}

function welcomeCard() {
  return h('section', { class: 'card', style: 'margin-bottom:16px' },
    h('div', { class: 'row wrap', style: 'gap:16px' },
      h('div', { class: 'empty-icon', style: 'margin:0' }, icon('rocket', { size: 24 })),
      h('div', { style: 'flex:1;min-width:220px' },
        h('h3', {}, 'Welcome to your flight deck'),
        h('p', { class: 'muted', style: 'margin-top:4px' }, 'Add your first task or project — or start from optional templates for EW/EM drone programmes and daily routines.')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 16 }), 'Create a task'),
        h('button', { class: 'btn', type: 'button', onClick: openQuickStart }, icon('sparkles', { size: 16 }), 'Quick start'))));
}

function trend(cur, prev, hasHistory, label) {
  if (!hasHistory) return h('span', {}, 'Comparison appears after your first full week');
  const diff = cur - prev;
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return h('span', { class: 'row', style: 'gap:6px' },
    h('span', { class: `trend ${cls}` }, icon(diff > 0 ? 'trending-up' : diff < 0 ? 'trending-down' : 'minus', { size: 13 }), `${diff > 0 ? '+' : ''}${diff}`),
    h('span', {}, label));
}

function statCards(c) {
  const card = (title, iconName, rgb, value, pctValue, foot, onClick) => h('button', { class: 'card stat-card d-stat interactive', type: 'button', style: { '--c': rgb, textAlign: 'left', color: 'inherit', font: 'inherit' }, onClick },
    h('div', { class: 'stat-top' }, h('span', { class: 'stat-icon' }, icon(iconName, { size: 17 })), title),
    h('div', { class: 'stat-value' }, h('strong', {}, String(value)), pctValue !== null ? h('span', { class: 'pct' }, `${pctValue}%`) : null),
    pctValue !== null ? progressBar(pctValue, `rgb(${rgb})`, { thin: true }) : null,
    h('div', { class: 'stat-foot' }, foot));
  return [
    card('Total Tasks', 'layers', '148, 163, 184', c.total, null, trend(c.createdThisWeek, c.createdLastWeek, c.hasHistory, 'created vs last week'), () => navigate('#/tasks?scope=all')),
    card('Completed', 'circle-check', '34, 197, 94', c.completed, pct(c.completed, c.total), trend(c.completedThisWeek, c.completedLastWeek, c.hasHistory, 'done vs last week'), () => navigate('#/tasks?scope=completed')),
    card('In Progress', 'loader-circle', '59, 130, 246', c.inProgress, pct(c.inProgress, c.total), h('span', {}, `${c.dueThisWeek} open task${c.dueThisWeek === 1 ? '' : 's'} due this week`), () => navigate('#/tasks?status=In%20Progress')),
    card('Pending', 'hourglass', '245, 158, 11', c.pending, pct(c.pending, c.total), h('span', {}, 'Not started or on hold'), () => navigate('#/tasks?status=Not%20Started,On%20Hold')),
  ];
}

function alertRow(c) {
  const chip = (label, sub, n, iconName, rgb, hash) => h('button', { class: `alert-chip ${n ? 'hot' : ''}`, type: 'button', style: { '--c': rgb }, onClick: () => navigate(hash) },
    h('span', { class: 'ai' }, icon(iconName, { size: 17 })),
    h('div', {}, h('strong', {}, String(n)), h('span', {}, label), sub ? h('div', { class: 'faint xs' }, sub) : null));
  return h('div', { class: 'alert-row d-alerts' },
    chip('Overdue', null, c.overdue, 'triangle-alert', '239, 68, 68', '#/tasks?flag=overdue'),
    chip('Due today', null, c.dueToday, 'alarm-clock', '251, 146, 60', '#/tasks?flag=due-today'),
    chip('Due this week', null, c.dueThisWeek, 'calendar-clock', '59, 130, 246', '#/tasks?flag=this-week'),
    chip('Not started', 'start date reached', c.notStarted, 'circle-dashed', '245, 158, 11', '#/tasks?flag=not-started'));
}

function ringsCard(prog, meetingsToday, now) {
  const p = palette();
  const focus = timer.todayFocus(now);
  const goal = store.settings.dailyFocusGoalMin || 120;
  const mDone = meetingsToday.filter((m) => meetingEnd(m) <= now).length;
  const rings = [
    { value: prog.total ? prog.done / prog.total : 0, color: p.accent },
    { value: goal ? focus.minutes / goal : 0, color: p.accent2 },
    { value: meetingsToday.length ? mDone / meetingsToday.length : 0, color: p.success },
  ];
  return h('section', { class: 'card d-rings' },
    cardHead("Today's progress", 'Close your rings'),
    h('div', { class: 'rings-card-body' },
      activityRings(rings, { size: 150, stroke: 13, center: h('div', {}, h('strong', {}, `${prog.percent}%`), h('span', {}, 'tasks done')) }),
      h('div', { class: 'ring-legend' },
        legend('Tasks', `${prog.done}`, `/${prog.total}`, p.accent),
        legend('Focus', formatHours(focus.minutes), `/${formatHours(goal)}`, p.accent2),
        legend('Meetings', `${mDone}`, `/${meetingsToday.length}`, p.success))),
    h('div', { class: 'rings-caption' }, icon('circle-check', { size: 14 }), prog.total ? `${prog.done} of ${prog.total} tasks completed today` : 'No tasks due today — plan something or enjoy deep work'));
}

function legend(label, val, of, color) {
  return h('div', { class: 'ring-legend-item', style: { '--c': color } },
    h('div', {}, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, val, h('small', {}, of))));
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
    agenda.length ? h('div', { class: 'agenda' }, agenda.slice(0, 6).map((a) => {
      const past = a.at < now;
      if (a.kind === 'meeting') return h('div', { class: `agenda-item ${past ? 'past' : ''}`, style: { '--c': 'var(--accent-2)' }, onClick: () => openMeetingDetails(a.m.id) }, h('span', { class: 't' }, a.m.title), h('span', { class: 'time' }, formatTimeStr(a.m.startTime) || 'All day'));
      return h('div', { class: `agenda-item ${past ? 'past' : ''}`, style: { '--c': a.kind === 'reminder' ? 'var(--warning)' : 'var(--accent)' }, onClick: () => import('../task-modal.js').then((m) => m.openTaskDetails(a.t.id)) },
        icon(a.kind === 'reminder' ? 'bell-ring' : 'flag', { size: 13 }), h('span', { class: 't' }, a.t.title), h('span', { class: 'time' }, formatClock(a.at)));
    })) : null,
    !hero && !agenda.length ? emptyState({ iconName: 'calendar-check', title: 'Nothing scheduled', text: 'No meetings or timed deadlines today — a good day for deep work.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openMeetingForm() }, icon('plus', { size: 15 }), 'Add meeting') }) : null);
}

function todayCard(todays, now) {
  const sorted = [...todays].sort((a, b) => {
    const ra = isDone(a) ? 2 : isOverdue(a, now) ? 0 : 1, rb = isDone(b) ? 2 : isOverdue(b, now) ? 0 : 1;
    return ra - rb || (getDeadline(a) || 0) - (getDeadline(b) || 0);
  });
  const open = sorted.filter(isOpen).length;
  return h('section', { class: 'card d-today' },
    cardHead("Today's tasks", `Due today and overdue · ${open} open, ${sorted.length - open} done`,
      [h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => navigate('#/tasks') }, 'All tasks'),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Add task due today', onClick: () => openTaskForm({ defaults: { endDate: toDateStr(now) } }) }, icon('plus', { size: 16 }))]),
    sorted.length
      ? h('div', { class: 'task-list card-scroll' }, sorted.map((t) => taskRow(t, { now })))
      : emptyState({ iconName: 'circle-check', title: 'All clear for today', text: 'Nothing due today and nothing overdue.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openTaskForm({ defaults: { endDate: toDateStr(now) } }) }, icon('plus', { size: 15 }), 'Add a task for today') }));
}

function followUps(open, now) {
  const items = [];
  for (const m of store.list('meetings')) {
    if (m.archived || !m.followUpDate || m.followUpDone) continue;
    const days = (new Date(m.followUpDate) - now) / 86400000;
    if (days <= 7) items.push({ kind: 'meeting', meeting: m, sort: m.followUpDate });
  }
  for (const t of open) {
    const tagged = (t.tags || []).some((tag) => /follow|approv|waiting|sign-?off/i.test(tag));
    if (tagged || t.status === 'On Hold') items.push({ kind: 'task', task: t, sort: t.endDate || '9999' });
  }
  return items.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
}

function followUpRow(m, now) {
  const overdue = m.followUpDate < toDateStr(now);
  return h('div', { class: 'task-row', role: 'button', tabindex: '0', onClick: () => openMeetingDetails(m.id) },
    h('span', { class: 'check', style: 'border-style:dashed' }),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-title-line' }, h('span', { class: 'task-title' }, `Follow up: ${m.title}`)),
      h('div', { class: 'task-meta' }, h('span', { class: 'cat-tag' }, icon('users', { size: 12 }), 'Meeting follow-up'),
        h('span', { class: `due ${overdue ? 'is-overdue' : ''}` }, icon('calendar', { size: 12 }), relativeDay(m.followUpDate, now)))),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: (e) => { e.stopPropagation(); db.patchMeeting(m.id, { followUpDone: true }); toast('Follow-up marked done', { type: 'success' }); } }, 'Done'));
}

/* ---------------------------------------------------------------- Focus card */

function focusCard() {
  const p = palette();
  const size = 168, stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
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
  const adjust = h('div', { class: 'dur-adjust' });
  const openTasks = sortTasks(store.list('tasks').filter((t) => !t.archived && isOpen(t)), 'deadline').slice(0, 40);
  const taskSel = selectEl([{ value: '', label: 'Working on… (optional)' }, ...openTasks.map((t) => ({ value: t.id, label: t.title.slice(0, 60) }))], timer.getState().taskId || '', {
    class: 'input input-sm timer-task', 'aria-label': 'Task for this focus session', onChange: (e) => timer.setTask(e.target.value),
  });
  const soundBtn = h('button', { class: 'icon-btn sm ghost', type: 'button', onClick: () => db.saveSettings({ focus: { sound: !store.settings.focus.sound } }) });

  const el = h('section', { class: 'card d-focus', id: 'focus-card' },
    cardHead('Focus', 'Pomodoro timer', soundBtn),
    h('div', { class: 'timer-body' }, modeWrap, ringEl, controls, adjust, taskSel, meta));

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
    clear(adjust);
    if (st.status === 'idle') {
      const key = timer.durationKeyForMode(st.mode);
      const cur = store.settings.focus[key];
      add(adjust, 
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Shorter', onClick: () => db.saveSettings({ focus: { [key]: Math.max(1, cur - 5) } }) }, icon('minus', { size: 14 })),
        h('span', { class: 'muted sm', style: 'min-width:64px;text-align:center' }, `${cur} min`),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Longer', onClick: () => db.saveSettings({ focus: { [key]: Math.min(180, cur + 5) } }) }, icon('plus', { size: 14 })));
    }
    const today = timer.todayFocus();
    const longEvery = store.settings.focus.longEvery || 4;
    add(clear(meta), 
      h('span', {}, 'Sessions today ', h('strong', {}, String(today.sessions))),
      h('span', {}, 'Cycle ', h('strong', {}, `${(st.cycle % longEvery)}/${longEvery}`)),
      h('span', {}, 'Focus today ', h('strong', {}, formatHours(today.minutes))));
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
      Array.from({ length: 4 }, () => h('div', { class: 'skeleton d-stat', style: 'height:118px' })),
      h('div', { class: 'skeleton d-rings', style: 'height:260px' }), h('div', { class: 'skeleton d-focus', style: 'height:260px' }), h('div', { class: 'skeleton d-upnext', style: 'height:260px' }),
      h('div', { class: 'skeleton d-today', style: 'height:300px' }), h('div', { class: 'skeleton d-upcoming', style: 'height:300px' })),
    skeleton(0));
}
