// js/views/projects.js — project list, project detail page and project form.

import { h, clear, formatDate, parseDate, diffDays, clamp, todayStr, add } from '../utils.js';
import { icon, emptyState, skeleton, segmented, selectEl, openModal, field, toast, popMenu, confirmDialog } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { PROJECT_CATEGORIES, PROJECT_STATUSES, PRIORITIES, PROJECT_COLORS, LIMITS, projectStatusInfo, TASK_CATEGORIES } from '../constants.js';
import { projectStats, sortTasks, isOpen, isDone } from '../task-logic.js';
import { ring, taskRow, priorityBadge } from '../components.js';
import { openTaskForm } from '../task-modal.js';
import { navigate } from '../shared.js';
import { openQuickStart } from '../quick-start.js';

const CATEGORY_ICON = {
  'EW Drone': 'radar', 'EM Drone': 'zap', 'R&D': 'flask-conical', 'Product Development (NPD)': 'rocket', 'Hardware Integration': 'cpu',
  'Software Development': 'hash', 'Testing & Validation': 'target', 'Documentation & Compliance': 'file-check', Procurement: 'inbox',
  'Office Work': 'briefcase', Personal: 'user', Other: 'layers',
};

function statusBadge(status) {
  const s = projectStatusInfo(status);
  return h('span', { class: 'status-pill', style: { background: `color-mix(in srgb, ${s.color} 16%, transparent)`, color: s.color } }, h('span', { class: 'dot', style: { background: s.color } }), s.name);
}

/** Start → target bar with a "today" marker. */
function projectTimeline(p, now = new Date()) {
  const start = parseDate(p.startDate), end = parseDate(p.targetDate);
  if (!start || !end) return h('div', { class: 'project-timeline' }, h('div', { class: 'row faint xs' }, p.targetDate ? `Target ${formatDate(p.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No target date set'));
  const total = Math.max(1, diffDays(end, start));
  const elapsed = clamp(diffDays(now, start) / total, 0, 1);
  const left = diffDays(end, now);
  const late = left < 0 && p.status !== 'Completed' && p.status !== 'Cancelled';
  return h('div', { class: 'project-timeline' },
    h('div', { class: 'row' }, h('span', {}, formatDate(p.startDate)),
      h('span', { class: late ? 'danger-text' : '' }, p.status === 'Completed' ? 'Completed' : late ? `${Math.abs(left)} days past target` : left === 0 ? 'Target is today' : `${left} days left`),
      h('span', {}, formatDate(p.targetDate))),
    h('div', { class: 'ptl-track', style: { '--c': late ? 'var(--danger)' : p.color } },
      h('div', { class: 'ptl-fill', style: { width: `${elapsed * 100}%` } }),
      elapsed > 0 && elapsed < 1 ? h('div', { class: 'ptl-today', style: { left: `calc(${elapsed * 100}% - 1px)` }, title: 'Today' }) : null));
}

function projectMenu(anchor, p) {
  popMenu(anchor, [
    { label: 'Open', icon: 'eye', onClick: () => navigate(`#/projects/${p.id}`) },
    { label: 'Edit', icon: 'pencil', onClick: () => openProjectForm({ project: p }) },
    { label: 'Add task', icon: 'plus', onClick: () => openTaskForm({ defaults: { projectId: p.id, category: guessCategory(p.category) } }) },
    { label: 'Status', icon: 'flag', children: PROJECT_STATUSES.map((s) => ({ label: s.name, swatch: s.color, checked: p.status === s.name, onClick: () => db.updateProject(p.id, { status: s.name }) })) },
    { separator: true },
    { label: p.archived ? 'Restore from archive' : 'Archive', icon: 'archive', onClick: () => { db.archiveProject(p.id, !p.archived); toast(p.archived ? 'Project restored' : 'Project archived', { type: 'success' }); } },
    { label: 'Delete…', icon: 'trash-2', danger: true, onClick: () => confirmDeleteProject(p) },
  ]);
}

export async function confirmDeleteProject(p) {
  const n = store.list('tasks').filter((t) => t.projectId === p.id).length;
  const res = await confirmDialog({
    title: 'Delete project permanently?',
    message: `“${p.name}” will be deleted. ${n ? `It has ${n} task${n === 1 ? '' : 's'}.` : ''} This can’t be undone — consider archiving instead.`,
    confirmText: 'Delete project', danger: true,
    checkbox: n ? { label: `Also delete its ${n} task${n === 1 ? '' : 's'} (otherwise they’re kept without a project)`, checked: false } : null,
  });
  if (!res) return false;
  db.deleteProject(p.id, { deleteTasks: !!res.checked });
  toast('Project deleted', { type: 'success' });
  if (location.hash.startsWith(`#/projects/${p.id}`)) navigate('#/projects');
  return true;
}

function guessCategory(projectCategory) {
  if (TASK_CATEGORIES.some((c) => c.name === projectCategory)) return projectCategory;
  return { 'Documentation & Compliance': 'Documentation', 'Product Development (NPD)': 'R&D' }[projectCategory] || 'R&D';
}

function projectCard(p, now) {
  const st = projectStats(p.id, store.list('tasks'), now);
  return h('article', { class: 'card interactive project-card', tabindex: '0', onClick: () => navigate(`#/projects/${p.id}`), onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && navigate(`#/projects/${p.id}`) },
    h('div', { class: 'project-card-top' },
      h('div', { class: 'project-icon', style: { background: p.color } }, icon(CATEGORY_ICON[p.category] || 'folder', { size: 19 })),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'project-name' }, p.name),
        h('div', { class: 'project-code' }, [p.code, p.category].filter(Boolean).join(' · '))),
      ring(st.percent, { size: 52, stroke: 6, color: p.color, label: `${st.percent}%` })),
    h('div', { class: 'row wrap', style: 'gap:8px' }, statusBadge(p.status), priorityBadge(p.priority), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'Project actions', onClick: (e) => { e.stopPropagation(); projectMenu(e.currentTarget, p); } }, icon('ellipsis', { size: 16 }))),
    h('div', { class: 'project-stats' },
      h('div', {}, h('strong', {}, String(st.total)), h('span', {}, 'Total')),
      h('div', {}, h('strong', {}, String(st.completed)), h('span', {}, 'Done')),
      h('div', {}, h('strong', {}, String(st.pending)), h('span', {}, 'Pending')),
      h('div', { class: st.overdue ? 'danger' : '' }, h('strong', {}, String(st.overdue)), h('span', {}, 'Overdue'))),
    projectTimeline(p, now));
}

const view = {
  title: 'Projects',
  deps: ['projects', 'tasks', 'tick'],
  scope: 'active',

  mount(root, route) {
    this.root = root;
    this.id = route.params[0] || null;
    this.taskScope = 'open';
    this.refresh();
  },

  refresh() {
    if (!this.root) return;
    clear(this.root);
    if (this.id) return this.renderDetail();
    const now = new Date();
    const all = store.list('projects');
    const list = all.filter((p) => (this.scope === 'active' ? !p.archived && p.status !== 'Completed' && p.status !== 'Cancelled'
      : this.scope === 'completed' ? p.status === 'Completed' && !p.archived : !p.archived))
      .sort((a, b) => (PRIORITIES.findIndex((x) => x.name === a.priority) - PRIORITIES.findIndex((x) => x.name === b.priority)) || a.name.localeCompare(b.name));
    add(this.root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Projects'), h('p', {}, 'Long-running R&D programmes. Completion is calculated from each project’s tasks.')),
        h('div', { class: 'page-actions' },
          segmented([{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }], this.scope, (v) => { this.scope = v; this.refresh(); }, { size: 'sm', label: 'Project filter' }),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openProjectForm() }, icon('plus', { size: 16 }), 'New project'))));
    if (!store.isLoaded()) { add(this.root, skeleton(3, { height: 200 })); return; }
    if (!list.length) {
      add(this.root, h('div', { class: 'card' }, all.filter((p) => !p.archived).length
        ? emptyState({ iconName: 'folder-kanban', title: 'No projects in this view', text: 'Try another filter.' })
        : emptyState({ iconName: 'folder-kanban', title: 'No projects yet', text: 'Create projects such as “EW Drone Prototype Development” to group related tasks and track completion.',
          action: h('div', { class: 'row wrap', style: 'justify-content:center' },
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openProjectForm() }, icon('plus', { size: 15 }), 'New project'),
            h('button', { class: 'btn btn-sm', type: 'button', onClick: openQuickStart }, icon('sparkles', { size: 15 }), 'Suggested projects')) })));
      return;
    }
    add(this.root, h('div', { class: 'project-grid' }, list.map((p) => projectCard(p, now))));
  },

  renderDetail() {
    const p = store.project(this.id);
    const now = new Date();
    if (!p) {
      add(this.root, h('div', { class: 'card' }, store.isLoaded()
        ? emptyState({ iconName: 'folder', title: 'Project not found', text: 'It may have been deleted.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => navigate('#/projects') }, 'Back to projects') })
        : skeleton(4)));
      return;
    }
    const tasks = store.list('tasks').filter((t) => t.projectId === p.id);
    const st = projectStats(p.id, store.list('tasks'), now);
    const shown = sortTasks(tasks.filter((t) => (this.taskScope === 'open' ? isOpen(t) && !t.archived : this.taskScope === 'completed' ? isDone(t) : true)), 'deadline');
    const daysLeft = p.targetDate ? diffDays(parseDate(p.targetDate), now) : null;
    add(this.root, 
      h('div', { class: 'page-head' },
        h('div', {},
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin:-6px 0 8px -10px', onClick: () => navigate('#/projects') }, icon('arrow-left', { size: 15 }), 'Projects'),
          h('div', { class: 'row', style: 'gap:12px' },
            h('div', { class: 'project-icon', style: { background: p.color } }, icon(CATEGORY_ICON[p.category] || 'folder', { size: 19 })),
            h('div', {}, h('h1', {}, p.name), h('p', {}, [p.code, p.category].filter(Boolean).join(' · '))))),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openProjectForm({ project: p }) }, icon('pencil', { size: 15 }), 'Edit'),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'More project actions', onClick: (e) => projectMenu(e.currentTarget, p) }, icon('ellipsis', { size: 16 })),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openTaskForm({ defaults: { projectId: p.id, category: guessCategory(p.category) } }) }, icon('plus', { size: 16 }), 'Add task'))),
      h('section', { class: 'card', style: 'margin-bottom:16px' },
        h('div', { class: 'project-hero' },
          ring(st.percent, { size: 120, stroke: 11, color: p.color, label: h('span', { style: 'font-size:24px' }, `${st.percent}%`) }),
          h('div', { class: 'stack' },
            h('div', { class: 'row wrap' }, statusBadge(p.status), priorityBadge(p.priority), p.archived ? h('span', { class: 'chip' }, 'Archived') : null),
            h('dl', { class: 'kv', style: 'margin:0' },
              kv('Total tasks', st.total), kv('Completed', st.completed), kv('Pending', st.pending), kv('Overdue', st.overdue),
              kv('Start', p.startDate ? formatDate(p.startDate, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
              kv('Target', p.targetDate ? formatDate(p.targetDate, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
              kv('Time left', daysLeft === null ? '—' : daysLeft < 0 ? `${-daysLeft} days late` : `${daysLeft} days`)),
            projectTimeline(p, now))),
        p.description ? h('div', { style: 'margin-top:16px' }, h('div', { class: 'field-label' }, 'Description'), h('p', { class: 'prewrap muted', style: 'margin-top:4px' }, p.description)) : null,
        p.notes ? h('div', { style: 'margin-top:12px' }, h('div', { class: 'field-label' }, 'Notes'), h('p', { class: 'prewrap muted', style: 'margin-top:4px' }, p.notes)) : null),
      h('section', { class: 'card list-card', style: 'padding:12px 6px 6px' },
        h('div', { class: 'card-head', style: 'padding:0 10px' },
          h('div', { class: 'card-titles' }, h('h3', { class: 'card-title' }, 'Tasks'), h('p', { class: 'card-sub' }, `${shown.length} shown`)),
          segmented([{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }], this.taskScope, (v) => { this.taskScope = v; this.refresh(); }, { size: 'sm' })),
        shown.length ? h('div', { class: 'task-list' }, shown.map((t) => taskRow(t, { now, showProject: false, showStatus: true, showCategory: true })))
          : emptyState({ iconName: 'list-todo', title: this.taskScope === 'open' ? 'No open tasks' : 'No tasks here', text: 'Add tasks to this project to track its progress.', action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openTaskForm({ defaults: { projectId: p.id, category: guessCategory(p.category) } }) }, icon('plus', { size: 15 }), 'Add task') })));
  },
};

function kv(k, v) { return h('div', {}, h('dt', {}, k), h('dd', {}, String(v))); }

export default view;

/* ---------------------------------------------------------------- Form */

export function openProjectForm({ project = null } = {}) {
  const editing = !!project;
  const p = editing ? project : { status: 'Active', priority: 'Medium', category: 'R&D', color: PROJECT_COLORS[store.list('projects').length % PROJECT_COLORS.length], startDate: todayStr() };
  let color = p.color;
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const name = h('input', { class: 'input input-lg', value: p.name || '', maxlength: LIMITS.name, placeholder: 'e.g. EW Drone Prototype Development', autofocus: true });
  const code = h('input', { class: 'input', value: p.code || '', maxlength: LIMITS.code, placeholder: 'EW-PROTO', style: 'text-transform:uppercase' });
  const description = h('textarea', { class: 'input', rows: 3, maxlength: LIMITS.description, placeholder: 'Scope, objectives, key deliverables' }, p.description || '');
  const category = selectEl(PROJECT_CATEGORIES, p.category);
  const status = selectEl(PROJECT_STATUSES.map((s) => s.name), p.status);
  const priority = selectEl(PRIORITIES.map((x) => x.name), p.priority);
  const start = h('input', { class: 'input', type: 'date', value: p.startDate || '' });
  const target = h('input', { class: 'input', type: 'date', value: p.targetDate || '' });
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: LIMITS.notes, placeholder: 'Vendors, risks, decisions…' }, p.notes || '');
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Project colour' });
  const drawSwatches = () => {
    clear(swatches);
    PROJECT_COLORS.forEach((c) => add(swatches, h('button', { type: 'button', class: `swatch ${c === color ? 'active' : ''}`, style: { background: c }, role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, onClick: () => { color = c; drawSwatches(); } }, c === color ? icon('check', { size: 14, strokeWidth: 3 }) : null)));
  };
  drawSwatches();
  const save = () => {
    err.hidden = true;
    try {
      const data = { name: name.value, code: code.value, description: description.value, category: category.value, status: status.value, priority: priority.value, startDate: start.value, targetDate: target.value, notes: notes.value, color };
      if (editing) { db.updateProject(project.id, data); toast('Project saved', { type: 'success' }); }
      else { const id = db.createProject(data); toast('Project created', { type: 'success', action: { label: 'Open', fn: () => navigate(`#/projects/${id}`) } }); }
      m.close();
    } catch (e) {
      err.textContent = e instanceof db.ValidationError ? e.message : `Couldn’t save: ${e.message}`;
      err.hidden = false;
    }
  };
  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } },
    err,
    h('div', { class: 'form-row' }, field('Project name', name, { required: true, className: 'span-2' }), field('Project code', code)),
    field('Description', description),
    h('div', { class: 'form-row three' }, field('Category', category), field('Status', status), field('Priority', priority)),
    h('div', { class: 'form-row' }, field('Start date', start), field('Target completion', target)),
    field('Colour', swatches),
    field('Notes', notes),
    h('button', { type: 'submit', hidden: true }));
  const m = openModal({
    title: editing ? 'Edit project' : 'New project', size: 'lg', body: form,
    footer: [
      editing ? h('button', { class: 'btn btn-ghost danger-text', type: 'button', onClick: async () => { if (await confirmDeleteProject(project)) m.close(); } }, icon('trash-2', { size: 16 }), 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, editing ? 'Save changes' : 'Create project'),
    ],
  });
}

