// js/views/kanban.js — Kanban board with drag-and-drop (mouse) and a move menu (touch/keyboard).

import { h, clear, debounce, DAY_MS, add } from '../utils.js';
import { icon, skeleton, selectEl } from '../ui.js';
import { store } from '../store.js';
import { KANBAN_COLUMNS, PRIORITIES, statusInfo } from '../constants.js';
import { filterTasks, sortTasks } from '../task-logic.js';
import { taskCard } from '../components.js';
import { openTaskForm, changeStatus } from '../task-modal.js';
import { ui } from '../shared.js';
import { viewSwitcher } from './tasks.js';

const view = {
  title: 'Kanban Board',
  deps: ['tasks', 'projects', 'tick'],

  mount(root) {
    this.root = root;
    this.project = '';
    this.priority = '';
    this.q = ui.search || '';
    this.showAllDone = false;
    this.board = h('div', { class: 'kanban', 'aria-label': 'Kanban board' });
    const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Filter cards', value: this.q, 'aria-label': 'Filter cards',
      onInput: debounce((e) => { this.q = e.target.value; this.refresh(); }, 150) });
    this.searchListener = (v) => { this.q = v; search.value = v; this.refresh(); };
    ui.searchListeners.add(this.searchListener);
    this.projectSel = h('select', { class: 'input input-sm', style: 'width:auto;max-width:220px', 'aria-label': 'Project', onChange: (e) => { this.project = e.target.value; this.refresh(); } });
    add(root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Kanban Board'), h('p', {}, 'Drag cards between columns to change status. On touch screens use the ⋯ menu.')),
        h('div', { class: 'page-actions' }, viewSwitcher('kanban'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm() }, icon('plus', { size: 16 }), 'New task'))),
      h('div', { class: 'toolbar' },
        h('div', { class: 'search-inline' }, icon('search', { size: 15 }), search),
        this.projectSel,
        selectEl([{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p.name, label: p.name }))], '', { class: 'input input-sm', style: 'width:auto', 'aria-label': 'Priority', onChange: (e) => { this.priority = e.target.value; this.refresh(); } }),
        h('span', { class: 'faint xs' }, 'Cancelled tasks are hidden.')),
      this.board);
    this.refresh();
  },

  unmount() { ui.searchListeners.delete(this.searchListener); },

  refresh() {
    if (!this.root) return;
    // Project filter options (keep selection)
    add(clear(this.projectSel), h('option', { value: '' }, 'All projects'), h('option', { value: '__none', selected: this.project === '__none' }, 'No project'),
      ...store.activeProjects().map((p) => h('option', { value: p.id, selected: this.project === p.id }, p.name)));
    clear(this.board);
    if (!store.isLoaded()) { KANBAN_COLUMNS.forEach(() => add(this.board, h('div', { class: 'k-col' }, skeleton(3, { height: 90 })))); return; }
    const now = new Date();
    const tasks = filterTasks(store.list('tasks'), {
      scope: 'all', q: this.q, projectId: this.project ? [this.project] : [], priority: this.priority ? [this.priority] : [],
    }, { now, projects: store.projects });
    for (const col of KANBAN_COLUMNS) add(this.board, this.column(col, tasks, now));
  },

  column(status, tasks, now) {
    let items = tasks.filter((t) => t.status === status);
    let hiddenDone = 0;
    if (status === 'Completed') {
      items = [...items].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      if (!this.showAllDone) {
        const recent = items.filter((t) => (t.completedAt || 0) > Date.now() - 14 * DAY_MS);
        hiddenDone = items.length - recent.length;
        items = recent;
      }
    } else items = sortTasks(items, 'priority');
    const info = statusInfo(status);
    const body = h('div', { class: 'k-col-body', dataset: { status } },
      items.length ? items.map((t) => taskCard(t, { now })) : h('div', { class: 'k-empty' }, status === 'Completed' ? 'Drop here to complete' : 'No tasks'));
    if (hiddenDone) add(body, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { this.showAllDone = true; this.refresh(); } }, `Show ${hiddenDone} older`));
    const col = h('section', { class: 'k-col', dataset: { status }, 'aria-label': `${status} column` },
      h('div', { class: 'k-col-head' }, h('span', { class: 'dot', style: { background: info.color } }), h('h3', {}, status),
        h('span', { class: 'count' }, String(tasks.filter((t) => t.status === status).length)), h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn xs ghost', type: 'button', 'aria-label': `Add task to ${status}`, onClick: () => openTaskForm({ defaults: { status, projectId: this.project && this.project !== '__none' ? this.project : undefined } }) }, icon('plus', { size: 15 }))),
      body,
      h('button', { class: 'k-add', type: 'button', onClick: () => openTaskForm({ defaults: { status, projectId: this.project && this.project !== '__none' ? this.project : undefined } }) }, icon('plus', { size: 14 }), 'Add task'));
    wireDnD(col, status);
    return col;
  },
};

export default view;

/* Native HTML5 drag and drop for mouse/trackpad users. */
let draggingId = null;
function wireDnD(col, status) {
  col.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.k-card');
    if (!card) return;
    draggingId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingId);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  col.addEventListener('dragend', (e) => {
    e.target.closest('.k-card')?.classList.remove('dragging');
    document.querySelectorAll('.k-col.drag-over').forEach((c) => c.classList.remove('drag-over'));
    draggingId = null;
  });
  col.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drag-over');
  });
  col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
  col.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    const task = store.task(id);
    if (!task || task.status === status) return;
    changeStatus(task, status);
  });
}

