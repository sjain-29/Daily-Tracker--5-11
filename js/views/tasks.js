// js/views/tasks.js — My Tasks: list view with search, sorting, filtering and grouping.

import { h, clear, toDateStr, addDays, endOfWeek, storageGet, storageSet, formatDate, debounce, add } from '../utils.js';
import { icon, emptyState, skeleton, segmented, selectEl, openModal, field } from '../ui.js';
import { store } from '../store.js';
import { TASK_STATUSES, PRIORITIES, TASK_CATEGORIES } from '../constants.js';
import { filterTasks, sortTasks, isDone, isOverdue, getDeadline, summaryCounts } from '../task-logic.js';
import { taskRow } from '../components.js';
import { openTaskForm } from '../task-modal.js';
import { ui, navigate } from '../shared.js';

const PREF_KEY = 'fd-tasks-view';
const FLAG_OPTIONS = [
  { value: 'overdue', label: 'Overdue' }, { value: 'not-started', label: 'Not started' }, { value: 'due-soon', label: 'Due soon' },
  { value: 'due-today', label: 'Due today' }, { value: 'this-week', label: 'Due this week' }, { value: 'delayed', label: 'Delayed' },
  { value: 'attention', label: 'Needs attention' },
];

export function viewSwitcher(active) {
  return segmented([
    { value: 'tasks', label: 'List', icon: 'list' },
    { value: 'kanban', label: 'Board', icon: 'square-kanban' },
    { value: 'calendar', label: 'Calendar', icon: 'calendar-days' },
    { value: 'timeline', label: 'Timeline', icon: 'chart-gantt' },
  ], active, (v) => navigate(`#/${v}`), { size: 'sm', label: 'Task view' });
}

const view = {
  title: 'My Tasks',
  deps: ['tasks', 'projects', 'tick', 'settings'],

  mount(root, route) {
    this.root = root;
    const saved = storageGet(PREF_KEY, {}, 'session') || {};
    const q = route.query;
    const list = (k) => (q.get(k) ? q.get(k).split(',').filter(Boolean) : null);
    const fromQuery = ['scope', 'status', 'priority', 'category', 'project', 'flag', 'from', 'to'].some((k) => q.has(k));
    this.f = fromQuery ? {
      scope: q.get('scope') || (q.get('status') || q.get('flag') ? 'all' : 'open'),
      status: list('status') || [], priority: list('priority') || [], category: list('category') || [],
      projectId: list('project') || [], flag: q.get('flag') || '', from: q.get('from') || '', to: q.get('to') || '',
    } : { scope: 'open', status: [], priority: [], category: [], projectId: [], flag: '', from: '', to: '', ...(saved.f || {}) };
    if (this.f.flag && !q.get('scope')) this.f.scope = 'open';
    this.sort = saved.sort || 'deadline';
    this.group = saved.group || 'due';
    this.q = ui.search || q.get('q') || '';

    this.listEl = h('div', { class: 'list-body' });
    this.statsEl = h('div', { class: 'stat-strip' });
    this.chipsEl = h('div', { class: 'chip-row', style: 'margin-bottom:12px' });
    this.filterBtn = h('button', { class: 'btn btn-sm', type: 'button', onClick: () => this.openFilters() });
    const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search titles, descriptions, projects, tags', value: this.q, 'aria-label': 'Search tasks',
      onInput: debounce((e) => { this.q = e.target.value; this.refresh(); }, 150) });
    this.searchListener = (v) => { this.q = v; search.value = v; this.refresh(); };
    ui.searchListeners.add(this.searchListener);

    add(root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'My Tasks'), h('p', {}, 'Everything on your plate — office, R&D and personal.')),
        h('div', { class: 'page-actions' }, viewSwitcher('tasks'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 16 }), 'New task'))),
      this.statsEl,
      h('div', { class: 'toolbar' },
        h('div', { class: 'search-inline' }, icon('search', { size: 15 }), search),
        segmented([{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }], this.f.scope, (v) => { this.f.scope = v; this.save(); this.refresh(); }, { size: 'sm', label: 'Scope' }),
        this.filterBtn,
        h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'faint sm' }, 'Sort'),
          selectEl([{ value: 'deadline', label: 'Deadline' }, { value: 'priority', label: 'Priority' }, { value: 'created', label: 'Newest' }, { value: 'status', label: 'Status' }, { value: 'project', label: 'Project' }, { value: 'title', label: 'Title A–Z' }], this.sort,
            { class: 'input input-sm', style: 'width:auto', 'aria-label': 'Sort by', onChange: (e) => { this.sort = e.target.value; this.save(); this.refresh(); } })),
        h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'faint sm' }, 'Group'),
          selectEl([{ value: 'due', label: 'Due date' }, { value: 'project', label: 'Project' }, { value: 'status', label: 'Status' }, { value: 'none', label: 'None' }], this.group,
            { class: 'input input-sm', style: 'width:auto', 'aria-label': 'Group by', onChange: (e) => { this.group = e.target.value; this.save(); this.refresh(); } }))),
      this.chipsEl,
      h('section', { class: 'card list-card', style: 'padding:6px' }, this.listEl));
    this.refresh();
  },

  unmount() { ui.searchListeners.delete(this.searchListener); },

  save() { storageSet(PREF_KEY, { f: this.f, sort: this.sort, group: this.group }, 'session'); },

  activeFilterCount() {
    const f = this.f;
    return f.status.length + f.priority.length + f.category.length + f.projectId.length + (f.flag ? 1 : 0) + (f.from || f.to ? 1 : 0);
  },

  refresh() {
    if (!this.root) return;
    const now = new Date();
    const all = store.list('tasks');
    const c = summaryCounts(all, now, store.settings.weekStartsOn ?? 1);
    add(clear(this.statsEl), 
      stat('Open', c.total - c.completed), stat('Due this week', c.dueThisWeek + c.overdue),
      stat('Overdue', c.overdue, c.overdue ? 'danger' : ''), stat('Done this week', c.completedThisWeek));

    const n = this.activeFilterCount();
    add(clear(this.filterBtn), icon('funnel', { size: 15 }), 'Filters', n ? h('span', { class: 'count chip', style: 'height:18px;padding:0 6px;margin-left:2px' }, String(n)) : null);
    this.renderChips();

    if (!store.isLoaded()) { add(clear(this.listEl), skeleton(6)); return; }
    const filtered = filterTasks(all, { ...this.f, q: this.q }, { now, projects: store.projects, weekStartsOn: store.settings.weekStartsOn });
    const sorted = sortTasks(filtered, this.sort, { projects: store.projects });
    clear(this.listEl);
    if (!sorted.length) {
      const anyTasks = all.some((t) => !t.archived);
      add(this.listEl, anyTasks
        ? emptyState({ iconName: 'search', title: 'No matching tasks', text: 'Try clearing the search or filters.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => this.clearFilters() }, 'Clear filters') })
        : emptyState({ iconName: 'list-todo', title: 'No tasks yet', text: 'Create your first task — press N anywhere to add one quickly.', action: h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 15 }), 'New task') }));
      return;
    }
    const groups = groupTasks(sorted, this.group, now);
    for (const g of groups) {
      if (this.group !== 'none') add(this.listEl, h('div', { class: 'group-label' }, g.color ? h('span', { class: 'dot', style: { background: g.color } }) : null, g.label, h('span', { class: 'count' }, `· ${g.items.length}`)));
      add(this.listEl, h('div', { class: 'task-list' }, g.items.map((t) => taskRow(t, { now, showStatus: true }))));
    }
  },

  renderChips() {
    const f = this.f;
    const chips = [];
    const remove = (fn) => () => { fn(); this.save(); this.refresh(); };
    const flagLabel = FLAG_OPTIONS.find((o) => o.value === f.flag)?.label;
    if (f.flag) chips.push([`Flag: ${flagLabel}`, remove(() => { f.flag = ''; })]);
    f.status.forEach((s) => chips.push([`Status: ${s}`, remove(() => { f.status = f.status.filter((x) => x !== s); })]));
    f.priority.forEach((s) => chips.push([`Priority: ${s}`, remove(() => { f.priority = f.priority.filter((x) => x !== s); })]));
    f.category.forEach((s) => chips.push([s, remove(() => { f.category = f.category.filter((x) => x !== s); })]));
    f.projectId.forEach((id) => chips.push([`Project: ${id === '__none' ? 'None' : store.project(id)?.name || 'Unknown'}`, remove(() => { f.projectId = f.projectId.filter((x) => x !== id); })]));
    if (f.from || f.to) chips.push([`Due ${f.from ? formatDate(f.from) : '…'} – ${f.to ? formatDate(f.to) : '…'}`, remove(() => { f.from = ''; f.to = ''; })]);
    clear(this.chipsEl);
    this.chipsEl.hidden = !chips.length;
    for (const [label, fn] of chips) add(this.chipsEl, h('button', { class: 'chip-btn active', type: 'button', onClick: fn, title: 'Remove filter' }, label, ' ', icon('x', { size: 12 })));
    if (chips.length > 1) add(this.chipsEl, h('button', { class: 'chip-btn', type: 'button', onClick: () => this.clearFilters() }, 'Clear all'));
  },

  clearFilters() {
    this.f = { scope: this.f.scope, status: [], priority: [], category: [], projectId: [], flag: '', from: '', to: '' };
    this.q = '';
    ui.search = '';
    this.save();
    if (location.hash.includes('?')) navigate('#/tasks'); else this.refresh();
  },

  openFilters() {
    const draft = structuredClone(this.f);
    const group = (title, options, key) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, title),
      h('div', { class: 'chip-row' }, options.map((o) => {
        const val = typeof o === 'string' ? o : o.value, label = typeof o === 'string' ? o : o.label;
        const b = h('button', { class: `chip-btn ${draft[key].includes(val) ? 'active' : ''}`, type: 'button', onClick: () => {
          draft[key] = draft[key].includes(val) ? draft[key].filter((x) => x !== val) : [...draft[key], val];
          b.classList.toggle('active');
        } }, label);
        return b;
      })));
    const flagSel = selectEl([{ value: '', label: 'Any' }, ...FLAG_OPTIONS], draft.flag);
    const from = h('input', { class: 'input', type: 'date', value: draft.from });
    const to = h('input', { class: 'input', type: 'date', value: draft.to });
    const quickRange = (label, a, b) => h('button', { class: 'chip-btn', type: 'button', onClick: () => { from.value = a; to.value = b; } }, label);
    const now = new Date();
    const body = h('div', { class: 'stack' },
      group('Status', TASK_STATUSES.map((s) => s.name), 'status'),
      group('Priority', PRIORITIES.map((p) => p.name), 'priority'),
      group('Category', TASK_CATEGORIES.map((c) => c.name), 'category'),
      group('Project', [{ value: '__none', label: 'No project' }, ...store.activeProjects().map((p) => ({ value: p.id, label: p.name }))], 'projectId'),
      field('Warning flag', flagSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Deadline between'),
        h('div', { class: 'chip-row', style: 'margin-bottom:6px' },
          quickRange('This week', toDateStr(now), toDateStr(endOfWeek(now, store.settings.weekStartsOn ?? 1))),
          quickRange('Next 7 days', toDateStr(now), toDateStr(addDays(now, 7))),
          quickRange('Next 30 days', toDateStr(now), toDateStr(addDays(now, 30))),
          quickRange('Any time', '', '')),
        h('div', { class: 'form-row' }, from, to)));
    const m = openModal({
      title: 'Filter tasks', size: 'md', body,
      footer: [
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { this.clearFilters(); m.close(); } }, 'Clear all'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => {
          this.f = { ...draft, flag: flagSel.value, from: from.value, to: to.value };
          if (this.f.status.length && this.f.scope !== 'all') this.f.scope = 'all';
          this.save(); this.refresh(); m.close();
        } }, 'Apply filters'),
      ],
    });
  },
};

export default view;

function stat(label, value, cls = '') {
  return h('div', { class: `mini-stat ${cls}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)));
}

function groupTasks(tasks, mode, now) {
  if (mode === 'none') return [{ label: 'All', items: tasks }];
  const map = new Map();
  const add = (key, label, t, order, color) => {
    if (!map.has(key)) map.set(key, { label, items: [], order, color });
    map.get(key).items.push(t);
  };
  const today = toDateStr(now);
  const weekEnd = endOfWeek(now, store.settings.weekStartsOn ?? 1);
  for (const t of tasks) {
    if (mode === 'due') {
      if (isDone(t)) add('done', 'Completed', t, 9);
      else if (t.status === 'Cancelled') add('cancelled', 'Cancelled', t, 10);
      else if (isOverdue(t, now)) add('overdue', 'Overdue', t, 0, 'var(--danger)');
      else if (t.endDate === today) add('today', 'Today', t, 1, 'var(--orange)');
      else if (t.endDate === toDateStr(addDays(now, 1))) add('tomorrow', 'Tomorrow', t, 2);
      else if (getDeadline(t) && getDeadline(t) <= weekEnd) add('week', 'Later this week', t, 3);
      else if (t.endDate) add('later', 'Later', t, 4);
      else add('nodate', 'No deadline', t, 5);
    } else if (mode === 'project') {
      const p = store.project(t.projectId);
      add(p ? p.id : '__none', p ? p.name : 'No project', t, p ? 0 : 1, p?.color);
    } else if (mode === 'status') {
      const idx = TASK_STATUSES.findIndex((s) => s.name === t.status);
      add(t.status, t.status, t, idx, TASK_STATUSES[idx]?.color);
    }
  }
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

