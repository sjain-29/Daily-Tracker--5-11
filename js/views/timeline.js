// js/views/timeline.js — Gantt-style timeline of projects and tasks.

import { h, clear, toDateStr, parseDate, addDays, diffDays, startOfWeek, formatDate, startOfDay, add } from '../utils.js';
import { icon, segmented, emptyState, toggleSwitch } from '../ui.js';
import { store } from '../store.js';
import { projectCategoryColor, categoryColor, statusInfo } from '../constants.js';
import { computeFlags, isDone, projectStats, sortTasks } from '../task-logic.js';
import { openTaskDetails, openTaskForm } from '../task-modal.js';
import { navigate } from '../shared.js';
import { viewSwitcher } from './tasks.js';

const RANGES = { '2w': { days: 14, dw: 46 }, '1m': { days: 35, dw: 30 }, '3m': { days: 91, dw: 14 } };

const view = {
  title: 'Timeline',
  deps: ['tasks', 'projects', 'tick'],

  mount(root) {
    this.root = root;
    this.range = window.matchMedia('(max-width: 760px)').matches ? '2w' : '1m';
    this.start = addDays(startOfWeek(new Date(), store.settings.weekStartsOn ?? 1), -7);
    this.showDone = false;
    this.project = '';
    this.refresh();
  },

  shift(dir) {
    const { days } = RANGES[this.range];
    this.start = addDays(this.start, dir * Math.round(days / 2));
    this.refresh();
  },

  refresh() {
    if (!this.root) return;
    const now = new Date();
    const { days, dw } = RANGES[this.range];
    const rangeStart = startOfDay(this.start);
    const rangeEnd = addDays(rangeStart, days - 1);
    clear(this.root);

    const projSel = h('select', { class: 'input input-sm', style: 'width:auto;max-width:220px', 'aria-label': 'Project', onChange: (e) => { this.project = e.target.value; this.refresh(); } },
      h('option', { value: '' }, 'All projects'), store.activeProjects().map((p) => h('option', { value: p.id, selected: this.project === p.id }, p.name)));

    add(this.root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Timeline'), h('p', {}, 'See what runs in parallel and which deadlines are approaching. Red striped bars are delayed or overdue.')),
        h('div', { class: 'page-actions' }, viewSwitcher('timeline'))),
      h('div', { class: 'toolbar' },
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Earlier', onClick: () => this.shift(-1) }, icon('chevron-left', { size: 16 })),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { this.start = addDays(startOfWeek(now, store.settings.weekStartsOn ?? 1), -7); this.refresh(); } }, 'Today'),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Later', onClick: () => this.shift(1) }, icon('chevron-right', { size: 16 })),
        h('span', { class: 'muted sm' }, `${formatDate(rangeStart, { day: 'numeric', month: 'short' })} – ${formatDate(rangeEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`),
        h('span', { class: 'spacer' }),
        projSel,
        h('label', { class: 'row sm muted', style: 'gap:8px' }, toggleSwitch(this.showDone, (v) => { this.showDone = v; this.refresh(); }, { label: 'Show completed' }), 'Completed'),
        segmented([{ value: '2w', label: '2W' }, { value: '1m', label: '1M' }, { value: '3m', label: '3M' }], this.range, (v) => { this.range = v; this.refresh(); }, { size: 'sm', label: 'Range' })));

    const inRange = (s, e) => s <= rangeEnd && e >= rangeStart;
    const tasks = store.list('tasks').filter((t) => !t.archived && t.status !== 'Cancelled' && (t.startDate || t.endDate) && (this.showDone || !isDone(t)) && (!this.project || t.projectId === this.project));
    const groups = new Map();
    for (const t of tasks) {
      const s = parseDate(t.startDate || t.endDate), e = parseDate(t.endDate || t.startDate);
      if (!inRange(s, e)) continue;
      const key = store.project(t.projectId) ? t.projectId : '__none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    // Projects with dates in range should appear even without tasks in range.
    for (const p of store.activeProjects()) {
      if (this.project && p.id !== this.project) continue;
      const s = parseDate(p.startDate), e = parseDate(p.targetDate);
      if (s && e && inRange(s, e) && !groups.has(p.id)) groups.set(p.id, []);
    }
    if (!groups.size) {
      add(this.root, h('div', { class: 'card' }, emptyState({ iconName: 'chart-gantt', title: 'Nothing scheduled in this period',
        text: 'Tasks need a start date and/or deadline to appear here. Try another range or show completed tasks.',
        action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 15 }), 'New task') })));
      return;
    }

    const width = days * dw;
    const dayCells = () => h('div', { class: 'tl-days' }, Array.from({ length: days }, (_, i) => {
      const d = addDays(rangeStart, i);
      const wk = d.getDay() === 0 || d.getDay() === 6;
      return h('div', { class: `tl-day ${wk ? 'weekend' : ''} ${toDateStr(d) === toDateStr(now) ? 'today' : ''} ${d.getDate() === 1 ? 'month-start' : ''}`, style: { '--dw': `${dw}px` } },
        dw >= 24 || d.getDay() === 1 ? h('strong', {}, String(d.getDate())) : null,
        dw >= 24 ? formatDate(d, { weekday: 'narrow' }) : d.getDate() <= 7 && d.getDay() === 1 ? formatDate(d, { month: 'short' }) : '');
    }));
    const bg = () => h('div', { class: 'tl-grid-bg' }, Array.from({ length: days }, (_, i) => {
      const d = addDays(rangeStart, i);
      return h('div', { class: `tl-day ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''} ${d.getDate() === 1 ? 'month-start' : ''}`, style: { '--dw': `${dw}px` } });
    }));
    const todayOffset = diffDays(now, rangeStart);
    const todayLine = () => (todayOffset >= 0 && todayOffset < days ? h('div', { class: 'tl-today-line', style: { left: `${todayOffset * dw + dw / 2}px` } }) : null);
    const barGeom = (s, e) => {
      const a = Math.max(0, diffDays(s, rangeStart));
      const b = Math.min(days - 1, diffDays(e, rangeStart));
      return { left: a * dw + 2, width: Math.max(dw - 4, (b - a + 1) * dw - 4) };
    };

    const grid = h('div', { class: 'tl', style: { gridTemplateColumns: `var(--tl-label, 260px) ${width}px` } },
      h('div', { class: 'tl-label tl-head' }, 'Project / task'),
      h('div', { class: 'tl-head', style: { width: `${width}px` } }, dayCells()));

    const order = [...groups.keys()].sort((a, b) => (a === '__none') - (b === '__none') || (store.project(a)?.name || '').localeCompare(store.project(b)?.name || ''));
    const categoriesUsed = new Map();
    for (const key of order) {
      const p = store.project(key);
      const color = p ? projectCategoryColor(p.category) : '#94a3b8';
      if (p) categoriesUsed.set(p.category, color);
      const st = p ? projectStats(p.id, store.list('tasks'), now) : null;
      add(grid, h('div', { class: 'tl-label group', onClick: p ? () => navigate(`#/projects/${p.id}`) : null, style: p ? 'cursor:pointer' : '' },
        h('span', { class: 'dot', style: { background: p ? p.color : color } }), h('span', { class: 'name' }, p ? p.name : 'No project'), st ? h('span', { class: 'faint xs', style: 'margin-left:auto' }, `${st.percent}%`) : null));
      const groupRow = h('div', { class: 'tl-row group', style: { width: `${width}px` } }, bg(), todayLine());
      if (p && p.startDate && p.targetDate) {
        const s = parseDate(p.startDate), e = parseDate(p.targetDate);
        if (inRange(s, e)) {
          const g = barGeom(s, e);
          const late = e < startOfDay(now) && p.status !== 'Completed';
          add(groupRow, h('div', { class: `tl-bar project ${late ? 'delayed' : ''}`, style: { left: `${g.left}px`, width: `${g.width}px`, '--c': color }, title: `${p.name}: ${p.startDate} → ${p.targetDate} (${st.percent}% complete)`, onClick: () => navigate(`#/projects/${p.id}`) },
            h('div', { class: 'fill', style: { width: `${st.percent}%` } })));
        }
      }
      add(grid, groupRow);
      for (const t of sortTasks(groups.get(key), 'deadline').sort((a, b) => (a.startDate || a.endDate).localeCompare(b.startDate || b.endDate))) {
        const s = parseDate(t.startDate || t.endDate), e = parseDate(t.endDate || t.startDate);
        const flags = computeFlags(t, now).map((f) => f.key);
        const delayed = flags.includes('OVERDUE') || flags.includes('DELAYED');
        const progress = t.progress ?? (isDone(t) ? 100 : 0);
        const g = barGeom(s, e);
        const barColor = p ? color : categoryColor(t.category);
        if (!p) categoriesUsed.set(t.category, barColor);
        add(grid, h('div', { class: 'tl-label', onClick: () => openTaskDetails(t.id), title: t.title },
          h('span', { class: 'dot', style: { background: statusInfo(t.status).color } }), h('span', { class: 'name' }, t.title),
          delayed ? h('span', { class: 'flag flag-danger flag-sm', style: 'margin-left:auto' }, flags.includes('DELAYED') ? 'DELAYED' : 'OVERDUE') : null));
        add(grid, h('div', { class: 'tl-row', style: { width: `${width}px` } }, bg(), todayLine(),
          s.getTime() === e.getTime() && !t.startDate
            ? h('div', { class: 'tl-milestone', style: { left: `${g.left + dw / 2 - 9}px`, '--c': delayed ? 'var(--danger)' : barColor }, title: `${t.title} — deadline ${t.endDate}`, onClick: () => openTaskDetails(t.id) })
            : h('div', { class: `tl-bar ${delayed ? 'delayed' : ''} ${isDone(t) ? 'done' : ''}`, style: { left: `${g.left}px`, width: `${g.width}px`, '--c': barColor },
              title: `${t.title}\n${t.startDate || '—'} → ${t.endDate || '—'} · ${t.status} · ${progress}%${delayed ? ' · DELAYED' : ''}`, onClick: () => openTaskDetails(t.id) },
            h('div', { class: 'fill', style: { width: `${progress}%` } }), g.width > 60 ? h('span', { class: 'lbl' }, t.title) : null)));
      }
    }
    add(this.root, h('div', { class: 'tl-wrap' }, grid),
      h('div', { class: 'cal-legend' },
        [...categoriesUsed.entries()].map(([name, c]) => h('span', { class: 'cat-tag' }, h('span', { class: 'dot', style: { background: c } }), name)),
        h('span', { class: 'cat-tag' }, h('span', { class: 'tl-milestone', style: 'position:static;display:inline-block;width:9px;height:9px;--c:#94a3b8' }), 'Deadline only'),
        h('span', { class: 'cat-tag' }, h('span', { class: 'dot', style: 'background:var(--danger)' }), 'Today line')));
    // Scroll so today is visible.
    requestAnimationFrame(() => {
      const wrap = this.root.querySelector('.tl-wrap');
      if (wrap && todayOffset > 4) wrap.scrollLeft = Math.max(0, todayOffset * dw - 3 * dw);
    });
  },
};

export default view;
