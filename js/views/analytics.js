// js/views/analytics.js — productivity analytics computed from the user's real Firebase records.

import { h, clear, toDateStr, addDays, startOfDay, startOfWeek, startOfMonth, formatDate, formatDurationMs, formatHours, downloadFile, csvCell, timeAgo, DAY_MS, add } from '../utils.js';
import { icon, segmented, emptyState, skeleton } from '../ui.js';
import { store } from '../store.js';
import { TASK_CATEGORIES, PRIORITIES, TASK_STATUSES } from '../constants.js';
import { isDone, isOpen, isOverdue, completionStats, focusMinutes, dailySeries, weeklySeries, computeFlags } from '../task-logic.js';
import { cardHead, progressBar } from '../components.js';
import { chartGroup, palette, axes } from '../charts.js';
import { openTaskDetails } from '../task-modal.js';

const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };

const view = {
  title: 'Analytics',
  deps: ['tasks', 'projects', 'focusSessions', 'theme'],
  range: '30d',

  mount(root) { this.root = root; this.charts = chartGroup(); this.refresh(); },
  unmount() { this.charts.destroyAll(); },

  refresh() {
    if (!this.root) return;
    this.charts.destroyAll();
    clear(this.root);
    const now = new Date();
    const all = store.list('tasks');
    const sessions = store.list('focusSessions');
    const days = RANGES[this.range];
    const firstRecord = Math.min(Date.now(), ...all.map((t) => t.createdAt || Date.now()), ...sessions.map((s) => s.startedAt || Date.now()));
    const spanDays = days || Math.max(7, Math.min(365, Math.ceil((Date.now() - firstRecord) / DAY_MS) + 1));
    const from = +startOfDay(addDays(now, -(spanDays - 1)));

    add(this.root, h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Analytics'), h('p', {}, 'How your work went — calculated live from your tasks and focus sessions.')),
      h('div', { class: 'page-actions' },
        segmented([{ value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: '90d', label: '90D' }, { value: 'all', label: 'All' }], this.range, (v) => { this.range = v; this.refresh(); }, { size: 'sm', label: 'Range' }),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: exportCsv }, icon('download', { size: 15 }), 'Export CSV'))));

    if (!store.isLoaded()) { add(this.root, skeleton(5, { height: 120 })); return; }
    if (!all.length && !sessions.length) {
      add(this.root, h('div', { class: 'card' }, emptyState({ iconName: 'chart-line', title: 'No data yet', text: 'Analytics appear as you create and complete tasks and log focus sessions. Nothing here is sample data.' })));
      return;
    }

    const p = palette();
    const wso = store.settings.weekStartsOn ?? 1;
    const doneAt = (fromMs) => all.filter((t) => isDone(t) && t.completedAt >= fromMs).length;
    const open = all.filter((t) => isOpen(t) && !t.archived);
    const range = completionStats(all, from);
    const focusMin = focusMinutes(sessions, from);

    const kpi = (label, value, sub, tone) => h('div', { class: `mini-stat ${tone || ''}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'faint xs', style: 'margin-top:2px' }, sub) : null);
    const kpis = h('div', { class: 'an-kpis' },
      kpi('Completed today', String(doneAt(+startOfDay(now)))),
      kpi('This week', String(doneAt(+startOfWeek(now, wso)))),
      kpi('This month', String(doneAt(+startOfMonth(now)))),
      kpi('Pending', String(open.length), `${open.filter((t) => t.status === 'In Progress').length} in progress`),
      kpi('Overdue', String(open.filter((t) => isOverdue(t, now)).length), null, open.some((t) => isOverdue(t, now)) ? 'danger' : ''),
      kpi('Focus hours', formatHours(focusMin), `${this.range === 'all' ? 'all time' : `last ${spanDays} days`}`));

    // Trend chart
    const trendCanvas = h('canvas', { 'aria-label': 'Completion trend' });
    const weekly = spanDays > 120;
    const doneSeries = weekly ? weeklySeries(all.filter(isDone), (t) => t.completedAt, Math.ceil(spanDays / 7), now, wso) : dailySeries(all.filter(isDone), (t) => t.completedAt, spanDays, now);
    const createdSeries = weekly ? weeklySeries(all, (t) => t.createdAt, Math.ceil(spanDays / 7), now, wso) : dailySeries(all, (t) => t.createdAt, spanDays, now);
    const labels = weekly ? doneSeries.starts.map((d) => formatDate(d, { day: 'numeric', month: 'short' })) : doneSeries.keys.map((k) => formatDate(k, spanDays <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }));
    const totalDone = doneSeries.values.reduce((a, b) => a + b, 0);

    // Weekly bar (12 weeks)
    const weeksCanvas = h('canvas', { 'aria-label': 'Weekly completions' });
    const w12 = weeklySeries(all.filter(isDone), (t) => t.completedAt, 12, now, wso);

    // Category & project productivity (tasks touched in range or still open)
    const inScope = all.filter((t) => t.status !== 'Cancelled' && ((t.completedAt && t.completedAt >= from) || (isOpen(t) && !t.archived) || (t.createdAt >= from)));
    const catRows = TASK_CATEGORIES.map((c) => ({ name: c.name, color: c.color, done: inScope.filter((t) => t.category === c.name && isDone(t)).length, open: inScope.filter((t) => t.category === c.name && isOpen(t)).length })).filter((r) => r.done + r.open > 0);
    const catCanvas = h('canvas', { 'aria-label': 'Productivity by category' });
    const projKey = (t) => (store.project(t.projectId) ? t.projectId : '__none');
    const projRows = [...new Set(inScope.map(projKey))].map((id) => {
      const proj = store.project(id);
      const list = inScope.filter((t) => projKey(t) === id);
      return { name: proj ? proj.name : 'No project', color: proj ? proj.color : '#94a3b8', done: list.filter(isDone).length, open: list.filter(isOpen).length };
    }).filter((r) => r.done + r.open > 0).sort((a, b) => (b.done + b.open) - (a.done + a.open)).slice(0, 10);
    const projCanvas = h('canvas', { 'aria-label': 'Productivity by project' });

    const prioCanvas = h('canvas', { 'aria-label': 'Priority distribution' });
    const prioCounts = PRIORITIES.map((pr) => inScope.filter((t) => t.priority === pr.name).length);
    const statusCanvas = h('canvas', { 'aria-label': 'Status distribution' });
    const statusCounts = TASK_STATUSES.filter((s) => s.name !== 'Cancelled').map((s) => ({ ...s, n: inScope.filter((t) => t.status === s.name).length }));

    const focusCanvas = h('canvas', { 'aria-label': 'Focus hours per day' });
    const focusDays = Math.min(spanDays, 60);
    const focusSeries = dailySeries(sessions.filter((s) => s.mode === 'focus'), (s) => s.startedAt, focusDays, now, (s) => (s.actualSec || 0) / 3600);

    const slowest = open.filter((t) => t.createdAt).sort((a, b) => (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt)).slice(0, 5);

    add(this.root, h('div', { class: 'an-grid' },
      kpis,
      h('section', { class: 'card an-two-thirds' }, cardHead('Completion trend', `${totalDone} completed ${this.range === 'all' ? 'in total' : `in the last ${spanDays} days`}${weekly ? ' · weekly' : ' · daily'}`), h('div', { class: 'chart-box tall' }, trendCanvas)),
      h('section', { class: 'card an-third' },
        cardHead('On time', 'Completed on or before the deadline'),
        h('div', { class: 'big-number' }, range.onTimeRate === null ? '—' : `${range.onTimeRate}`, range.onTimeRate === null ? null : h('small', {}, '%')),
        progressBar(range.onTimeRate || 0, (range.onTimeRate ?? 0) >= 80 ? p.success : (range.onTimeRate ?? 0) >= 50 ? p.warning : p.danger),
        h('div', { class: 'row wrap faint xs', style: 'gap:12px;margin-top:8px' },
          h('span', {}, `${range.onTime} on time`), h('span', {}, `${range.withDeadline - range.onTime} late`), h('span', {}, `${range.completed - range.withDeadline} without deadline`)),
        h('div', { class: 'stack', style: 'gap:4px;margin-top:16px' },
          h('div', { class: 'field-label' }, 'Average completion time'),
          h('div', { style: 'font-size:22px;font-weight:650' }, range.avgCompletionMs ? formatDurationMs(range.avgCompletionMs) : '—'),
          h('div', { class: 'faint xs' }, 'From start (or creation) to completion')),
        h('div', { class: 'stack', style: 'gap:2px;margin-top:16px' },
          h('div', { class: 'field-label' }, 'Oldest open tasks'),
          slowest.length ? slowest.map((t) => h('button', { class: 'agenda-item', type: 'button', style: 'border:0;background:none;color:inherit;text-align:left;width:100%', onClick: () => openTaskDetails(t.id) },
            h('span', { class: 't' }, t.title), h('span', { class: 'time' }, timeAgo(t.startedAt || t.createdAt)))) : h('p', { class: 'faint sm' }, 'No open tasks.'))),
      h('section', { class: 'card an-half' }, cardHead('Weekly completions', 'Last 12 weeks'), h('div', { class: 'chart-box' }, weeksCanvas)),
      h('section', { class: 'card an-half' }, cardHead('Focus hours', `Per day · last ${focusDays} days · ${formatHours(focusSeries.values.reduce((a, b) => a + b, 0) * 60)} total`), h('div', { class: 'chart-box' }, focusCanvas)),
      h('section', { class: 'card an-half' }, cardHead('Productivity by category', 'Completed vs open'), catRows.length ? h('div', { class: 'chart-box', style: { height: `${Math.max(180, catRows.length * 30 + 40)}px` } }, catCanvas) : emptyState({ iconName: 'chart-column', title: 'No tasks in range' })),
      h('section', { class: 'card an-half' }, cardHead('Productivity by project', 'Completed vs open · top 10'), projRows.length ? h('div', { class: 'chart-box', style: { height: `${Math.max(180, projRows.length * 30 + 40)}px` } }, projCanvas) : emptyState({ iconName: 'folder-kanban', title: 'No tasks in range' })),
      h('section', { class: 'card an-third' }, cardHead('Priority distribution', 'Tasks in range'), h('div', { class: 'chart-box' }, prioCanvas)),
      h('section', { class: 'card an-third' }, cardHead('Completed vs pending', 'By status'), h('div', { class: 'chart-box' }, statusCanvas)),
      h('section', { class: 'card an-third' }, cardHead('Flags right now', 'Live warnings on open tasks'), flagSummary(open, now))));

    const C = this.charts;
    C.add(trendCanvas, {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Completed', data: doneSeries.values, borderColor: p.accent, backgroundColor: `rgba(${p.accentRgb}, .14)`, fill: true, tension: 0.35, borderWidth: 2, pointRadius: spanDays <= 31 ? 2 : 0, pointHoverRadius: 4 },
        { label: 'Created', data: createdSeries.values, borderColor: p.accent2, borderDash: [5, 4], tension: 0.35, borderWidth: 1.5, pointRadius: 0 },
      ] },
      options: { scales: axes(), plugins: { legend: { display: true, position: 'bottom' } } },
    });
    C.add(weeksCanvas, {
      type: 'bar',
      data: { labels: w12.starts.map((d) => formatDate(d, { day: 'numeric', month: 'short' })), datasets: [{ label: 'Completed', data: w12.values, backgroundColor: w12.values.map((_, i) => (i === w12.values.length - 1 ? p.accent : `rgba(${p.accentRgb}, .4)`)), borderRadius: 7, maxBarThickness: 30 }] },
      options: { scales: axes() },
    });
    C.add(focusCanvas, {
      type: 'bar',
      data: { labels: focusSeries.keys.map((k) => formatDate(k, { day: 'numeric', month: 'short' })), datasets: [{ label: 'Focus hours', data: focusSeries.values.map((v) => Math.round(v * 10) / 10), backgroundColor: p.accent2, borderRadius: 5, maxBarThickness: 22 }] },
      options: { scales: axes({ yPrecision: 1 }) },
    });
    if (catRows.length) C.add(catCanvas, {
      type: 'bar',
      data: { labels: catRows.map((r) => r.name), datasets: [
        { label: 'Completed', data: catRows.map((r) => r.done), backgroundColor: catRows.map((r) => r.color), borderRadius: 5, maxBarThickness: 18 },
        { label: 'Open', data: catRows.map((r) => r.open), backgroundColor: 'rgba(148,163,184,.3)', borderRadius: 5, maxBarThickness: 18 },
      ] },
      options: { indexAxis: 'y', scales: axes({ horizontal: true, stacked: true }), plugins: { legend: { display: true, position: 'bottom' } } },
    });
    if (projRows.length) C.add(projCanvas, {
      type: 'bar',
      data: { labels: projRows.map((r) => (r.name.length > 26 ? r.name.slice(0, 25) + '…' : r.name)), datasets: [
        { label: 'Completed', data: projRows.map((r) => r.done), backgroundColor: projRows.map((r) => r.color), borderRadius: 5, maxBarThickness: 18 },
        { label: 'Open', data: projRows.map((r) => r.open), backgroundColor: 'rgba(148,163,184,.3)', borderRadius: 5, maxBarThickness: 18 },
      ] },
      options: { indexAxis: 'y', scales: axes({ horizontal: true, stacked: true }), plugins: { legend: { display: true, position: 'bottom' } } },
    });
    C.add(prioCanvas, {
      type: 'doughnut',
      data: { labels: PRIORITIES.map((x) => x.name), datasets: [{ data: prioCounts, backgroundColor: PRIORITIES.map((x) => x.color), borderWidth: 0, spacing: 2, borderRadius: 4 }] },
      options: { cutout: '64%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: true, position: 'right' } } },
    });
    C.add(statusCanvas, {
      type: 'doughnut',
      data: { labels: statusCounts.map((x) => x.name), datasets: [{ data: statusCounts.map((x) => x.n), backgroundColor: statusCounts.map((x) => x.color), borderWidth: 0, spacing: 2, borderRadius: 4 }] },
      options: { cutout: '64%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: true, position: 'right' } } },
    });
    queueMicrotask(() => C.markRendered());
  },
};

export default view;

function flagSummary(open, now) {
  const counts = { OVERDUE: 0, DELAYED: 0, DUE_SOON: 0, NOT_STARTED: 0, UPCOMING: 0 };
  for (const t of open) for (const f of computeFlags(t, now)) counts[f.key]++;
  const rows = [['OVERDUE', 'Overdue', 'var(--danger)', 'overdue'], ['DELAYED', 'Delayed (in progress, past deadline)', '#f87171', 'delayed'], ['DUE_SOON', 'Due within 24 h', 'var(--orange)', 'due-soon'], ['NOT_STARTED', 'Start date passed, not started', 'var(--warning)', 'not-started'], ['UPCOMING', 'Due within 3 days', 'var(--text-3)', '']];
  const max = Math.max(1, ...Object.values(counts));
  return h('div', { class: 'stack', style: 'gap:10px' }, rows.map(([k, label, color, flag]) => h('a', { href: flag ? `#/tasks?flag=${flag}` : '#/tasks', class: 'stack', style: 'gap:4px;color:inherit;text-decoration:none' },
    h('div', { class: 'row', style: 'justify-content:space-between;font-size:12.5px' }, h('span', { class: 'muted' }, label), h('strong', { class: 'num' }, String(counts[k]))),
    progressBar((counts[k] / max) * 100, color, { thin: true }))));
}

function exportCsv() {
  const cols = ['title', 'status', 'priority', 'category', 'project', 'startDate', 'endDate', 'dueTime', 'progress', 'tags', 'createdAt', 'completedAt', 'archived'];
  const rows = store.list('tasks').map((t) => [
    t.title, t.status, t.priority, t.category, store.project(t.projectId)?.name || '', t.startDate || '', t.endDate || '', t.dueTime || '', t.progress ?? '',
    (t.tags || []).join('; '), t.createdAt ? new Date(t.createdAt).toISOString() : '', t.completedAt ? new Date(t.completedAt).toISOString() : '', t.archived ? 'yes' : '',
  ]);
  const csv = [cols, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  downloadFile(`tasks-${toDateStr(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
}

