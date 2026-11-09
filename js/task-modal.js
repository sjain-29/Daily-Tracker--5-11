// js/task-modal.js — task create/edit form, detail drawer, quick actions and the shared task menu.

import { h, clear, todayStr, toDateTimeLocal, fromDateTimeLocal, formatDate, formatDateTime, formatTimeStr, formatMinutes, timeAgo, add } from './utils.js';
import { icon, openModal, confirmDialog, toast, popMenu, field, selectEl, segmented } from './ui.js';
import { TASK_CATEGORIES, PRIORITIES, TASK_STATUSES, RECURRENCE_OPTIONS, LIMITS } from './constants.js';
import { store } from './store.js';
import * as db from './database.js';
import { computeFlags, describeRecurrence, isDone } from './task-logic.js';
import { flagChip, statusPill, priorityBadge, projectChip, categoryTag } from './components.js';

/* ------------------------------------------------------------ Actions */

export function toggleComplete(task) {
  const current = store.task(task.id) || task;
  try {
    if (isDone(current)) {
      const res = db.reopenTask(current.id);
      toast(`Reopened “${current.title}”`, { type: 'info', action: { label: 'Undo', fn: () => db.undoTaskChange(current.id, res.before, res.spawnedId) } });
    } else {
      const res = db.completeTask(current.id);
      const extra = res.spawnedId ? ' · next occurrence scheduled' : '';
      toast(`Done: ${current.title}${extra}`, { type: 'success', action: { label: 'Undo', fn: () => db.undoTaskChange(current.id, res.before, res.spawnedId) } });
    }
  } catch (err) { showError(err); }
}

export function changeStatus(task, status) {
  try {
    const res = db.setTaskStatus(task.id, status);
    if (status === 'Completed' && res.spawnedId) toast('Completed — next occurrence scheduled', { type: 'success' });
    else toast(`Status → ${status}`, { type: 'success', timeout: 2000 });
  } catch (err) { showError(err); }
}

export async function confirmDeleteTask(task) {
  const ok = await confirmDialog({
    title: 'Delete task permanently?',
    message: `“${task.title}” will be removed from every device. This can’t be undone. Tip: use Archive to hide it instead.`,
    confirmText: 'Delete permanently', danger: true,
  });
  if (!ok) return false;
  db.deleteTask(task.id);
  toast('Task deleted', { type: 'success' });
  return true;
}

export function duplicate(task) {
  try {
    const id = db.duplicateTask(task.id);
    toast('Task duplicated', { type: 'success', action: { label: 'Open', fn: () => openTaskDetails(id) } });
  } catch (err) { showError(err); }
}

export function archiveToggle(task) {
  db.archiveTask(task.id, !task.archived);
  toast(task.archived ? 'Task restored' : 'Task archived', { type: 'success', action: task.archived ? null : { label: 'Undo', fn: () => db.archiveTask(task.id, false) } });
}

function showError(err) {
  toast(err instanceof db.ValidationError ? err.message : `Couldn’t save: ${err.message || err}`, { type: 'error' });
}

/** The “⋯” menu used everywhere a task appears. Includes mobile-friendly status changes. */
export function taskMenu(anchor, task) {
  const t = store.task(task.id) || task;
  popMenu(anchor, [
    { label: 'View details', icon: 'eye', onClick: () => openTaskDetails(t.id) },
    { label: 'Edit', icon: 'pencil', onClick: () => openTaskForm({ task: t }) },
    { label: isDone(t) ? 'Reopen' : 'Mark complete', icon: isDone(t) ? 'rotate-ccw' : 'circle-check', onClick: () => toggleComplete(t) },
    { separator: true },
    { label: 'Move to / status', icon: 'square-kanban', children: TASK_STATUSES.map((st) => ({ label: st.name, swatch: st.color, checked: t.status === st.name, onClick: () => t.status !== st.name && changeStatus(t, st.name) })) },
    { label: 'Priority', icon: 'flag', children: PRIORITIES.map((p) => ({ label: p.name, swatch: p.color, checked: t.priority === p.name, onClick: () => { db.updateTask(t.id, { priority: p.name }); toast(`Priority → ${p.name}`, { type: 'success', timeout: 2000 }); } })) },
    { label: 'Change deadline…', icon: 'calendar-clock', onClick: () => quickDeadline(t) },
    { label: 'Add note…', icon: 'notebook-pen', onClick: () => quickNote(t) },
    { separator: true },
    { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(t) },
    { label: t.archived ? 'Restore from archive' : 'Archive', icon: 'archive', onClick: () => archiveToggle(t) },
    { label: 'Delete…', icon: 'trash-2', danger: true, onClick: () => confirmDeleteTask(t) },
  ]);
}

export function quickDeadline(task) {
  const date = h('input', { class: 'input', type: 'date', value: task.endDate || '' });
  const time = h('input', { class: 'input', type: 'time', value: task.dueTime || '' });
  const quick = (days) => { const d = new Date(); d.setDate(d.getDate() + days); date.value = todayStr(d); };
  const save = () => {
    try {
      db.updateTask(task.id, { endDate: date.value || null, dueTime: date.value ? (time.value || null) : null });
      toast(date.value ? `Deadline → ${formatDate(date.value, { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Deadline removed', { type: 'success' });
      m.close();
    } catch (err) { showError(err); }
  };
  const m = openModal({
    title: 'Change deadline', subtitle: task.title, size: 'sm',
    body: h('div', { class: 'stack' },
      h('div', { class: 'chip-row' },
        [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, d]) => h('button', { class: 'chip-btn', type: 'button', onClick: () => quick(d) }, l)),
        h('button', { class: 'chip-btn', type: 'button', onClick: () => { date.value = ''; time.value = ''; } }, 'No deadline')),
      h('div', { class: 'form-row' }, field('Deadline', date), field('Due time (optional)', time))),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save')],
  });
}

export function quickNote(task) {
  const ta = h('textarea', { class: 'input', rows: 4, maxlength: 2000, placeholder: 'Observation, decision, blocker…' });
  const save = () => {
    if (!ta.value.trim()) { ta.focus(); return; }
    db.appendTaskNote(task.id, ta.value);
    toast('Note added', { type: 'success' });
    m.close();
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
  const m = openModal({
    title: 'Add note', subtitle: task.title, size: 'sm', body: ta,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Add note')],
  });
}

/* ------------------------------------------------------------ Task form */

/**
 * openTaskForm({ task }) to edit, or openTaskForm({ defaults: { endDate, status, projectId, ... } }) to create.
 */
export function openTaskForm({ task = null, defaults = {} } = {}) {
  const editing = !!task;
  const t = editing ? { ...task } : { status: 'Not Started', priority: 'Medium', category: 'Office Work', ...defaults };
  const projects = store.activeProjects();
  if (t.projectId && !projects.some((p) => p.id === t.projectId) && store.project(t.projectId)) projects.push(store.project(t.projectId));

  let priority = t.priority || 'Medium';
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const title = h('input', { class: 'input input-lg', type: 'text', value: t.title || '', maxlength: LIMITS.title, placeholder: 'What needs to be done?', required: true, autofocus: true, autocomplete: 'off' });
  const description = h('textarea', { class: 'input', rows: 2, maxlength: LIMITS.description, placeholder: 'Details, acceptance criteria, links…' }, t.description || '');
  const project = selectEl([{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))], t.projectId || '');
  const category = selectEl(TASK_CATEGORIES.map((c) => c.name), t.category);
  const status = selectEl(TASK_STATUSES.map((st) => st.name), t.status);
  const prioritySeg = segmented(PRIORITIES.map((p) => ({ value: p.name, label: p.name })), priority, (v) => { priority = v; }, { size: 'sm', label: 'Priority' });
  const startDate = h('input', { class: 'input', type: 'date', value: t.startDate || '' });
  const endDate = h('input', { class: 'input', type: 'date', value: t.endDate || '' });
  const dueTime = h('input', { class: 'input', type: 'time', value: t.dueTime || '' });
  const estH = h('input', { class: 'input', type: 'number', min: 0, max: 1600, step: 1, inputmode: 'numeric', placeholder: '0', value: t.estimatedMinutes ? Math.floor(t.estimatedMinutes / 60) : '' });
  const estM = h('input', { class: 'input', type: 'number', min: 0, max: 59, step: 5, inputmode: 'numeric', placeholder: '0', value: t.estimatedMinutes ? t.estimatedMinutes % 60 : '' });
  const progressOut = h('output', { class: 'range-out' }, t.progress != null ? `${t.progress}%` : '—');
  const progress = h('input', { class: 'range', type: 'range', min: 0, max: 100, step: 5, value: t.progress ?? 0, onInput: () => { progressOut.textContent = `${progress.value}%`; progress.dataset.touched = '1'; } });
  const tags = h('input', { class: 'input', type: 'text', value: (t.tags || []).join(', '), placeholder: 'e.g. EW, flight-test, vendor', maxlength: 600 });
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: LIMITS.notes, placeholder: 'Working notes' }, t.notes || '');
  const recFreq = selectEl(RECURRENCE_OPTIONS.map((o) => ({ value: o.key, label: o.name })), t.recurrence?.freq || 'none');
  const recInterval = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: t.recurrence?.interval || 2, inputmode: 'numeric' });
  const recUnit = selectEl([{ value: 'day', label: 'days' }, { value: 'week', label: 'weeks' }, { value: 'month', label: 'months' }], t.recurrence?.unit || 'day');
  const customRow = h('div', { class: 'form-row custom-rec', hidden: recFreq.value !== 'custom' },
    field('Every', recInterval), field('Unit', recUnit));
  recFreq.addEventListener('change', () => { customRow.hidden = recFreq.value !== 'custom'; });
  const reminder = h('input', { class: 'input', type: 'datetime-local', value: toDateTimeLocal(t.reminderAt) });

  // Simple by default: title, project, deadline and priority. Everything else sits under "More options",
  // which opens automatically when editing a task that already uses any of those fields.
  const hasExtras = !!(t.description || t.startDate || t.dueTime || t.estimatedMinutes || t.progress != null || t.tags?.length || t.notes
    || t.recurrence || t.reminderAt || (editing && t.status !== 'Not Started') || (editing && t.category && t.category !== 'Office Work'));
  const more = h('details', { class: 'more-options', open: hasExtras || undefined },
    h('summary', {}, icon('sliders-horizontal', { size: 15 }), 'More options', h('span', { class: 'muted xs' }, 'details, status, dates, repeat, reminder')),
    h('div', { class: 'stack' },
      field('Description', description),
      h('div', { class: 'form-row' }, field('Category', category), field('Status', status)),
      h('div', { class: 'form-row' }, field('Start date', startDate), field('Due time', dueTime)),
      h('div', { class: 'form-row' }, field('Repeat', recFreq, { hint: 'The next one is created when you complete this one.' }), field('Reminder', reminder)),
      customRow,
      field('Tags', tags, { hint: 'Separate with commas' }),
      h('div', { class: 'form-row' },
        field('Estimated duration', h('div', { class: 'duration-input' }, estH, h('span', { class: 'muted' }, 'h'), estM, h('span', { class: 'muted' }, 'm'))),
        field('Progress', h('div', { class: 'range-wrap' }, progress, progressOut))),
      field('Notes', notes)));

  const form = h('form', { class: 'task-form stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } },
    err,
    field('Task title', title, { required: true }),
    h('div', { class: 'form-row' }, field('Project', project), field('Deadline', endDate)),
    field('Priority', prioritySeg),
    more,
    h('button', { type: 'submit', hidden: true }));
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });

  function collect() {
    const est = (parseInt(estH.value, 10) || 0) * 60 + (parseInt(estM.value, 10) || 0);
    const rec = recFreq.value === 'none' ? null : { freq: recFreq.value, interval: recFreq.value === 'custom' ? recInterval.value : 1, unit: recUnit.value };
    return {
      title: title.value, description: description.value, projectId: project.value || null, category: category.value,
      priority, status: status.value, startDate: startDate.value || null, endDate: endDate.value || null,
      dueTime: dueTime.value || null, estimatedMinutes: est || null,
      progress: progress.dataset.touched || t.progress != null ? Number(progress.value) : null,
      tags: tags.value, notes: notes.value, recurrence: rec, reminderAt: fromDateTimeLocal(reminder.value),
    };
  }

  function save() {
    err.hidden = true;
    title.classList.remove('invalid');
    const data = collect();
    try {
      if (!data.title.trim()) { title.classList.add('invalid'); throw new db.ValidationError('Task title is required.'); }
      if (editing) {
        const res = db.updateTask(task.id, data);
        toast(res.spawnedId ? 'Task saved — next occurrence scheduled' : 'Task saved', { type: 'success' });
      } else {
        const id = db.createTask({ ...data, meetingId: defaults.meetingId });
        toast('Task created', { type: 'success', action: { label: 'Open', fn: () => openTaskDetails(id) } });
      }
      modal.close('saved');
    } catch (e) {
      err.textContent = e instanceof db.ValidationError ? e.message : `Couldn’t save: ${e.message}`;
      err.hidden = false;
      err.scrollIntoView?.({ block: 'nearest' });
    }
  }

  const footer = [
    editing ? h('button', { class: 'btn btn-ghost danger-text', type: 'button', onClick: async () => { if (await confirmDeleteTask(task)) modal.close(); } }, icon('trash-2', { size: 16 }), 'Delete') : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, 'Cancel'),
    h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, editing ? 'Save changes' : 'Create task'),
  ];
  const modal = openModal({ title: editing ? 'Edit task' : 'New task', size: 'md', body: form, footer, className: 'task-modal' });
  return modal;
}

/* ------------------------------------------------------------ Details drawer */

export function openTaskDetails(id) {
  const container = h('div', { class: 'task-details' });
  // Created once so a half-written note survives live re-renders.
  const noteInput = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Add a note… (Ctrl/⌘ + Enter)' });
  let unsub = null;
  const modal = openModal({
    title: 'Task details', size: 'drawer', body: container,
    onClose: () => unsub && unsub(),
  });
  const render = () => {
    const t = store.task(id);
    if (!t) { clear(container).appendChild(h('p', { class: 'muted' }, 'This task no longer exists.')); return; }
    const now = new Date();
    const project = store.project(t.projectId);
    const flags = computeFlags(t, now);
    const addNote = () => { if (noteInput.value.trim()) { db.appendTaskNote(t.id, noteInput.value); noteInput.value = ''; toast('Note added', { type: 'success', timeout: 2000 }); } };
    noteInput.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); };

    const statusSel = selectEl(TASK_STATUSES.map((st) => st.name), t.status, { 'aria-label': 'Status', onChange: (e) => changeStatus(t, e.target.value) });
    const prioSel = selectEl(PRIORITIES.map((p) => p.name), t.priority, { 'aria-label': 'Priority', onChange: (e) => { db.updateTask(t.id, { priority: e.target.value }); toast(`Priority → ${e.target.value}`, { type: 'success', timeout: 2000 }); } });
    const deadline = h('input', { class: 'input', type: 'date', value: t.endDate || '', 'aria-label': 'Deadline', onChange: (e) => { try { db.updateTask(t.id, { endDate: e.target.value || null }); toast('Deadline updated', { type: 'success', timeout: 2000 }); } catch (er) { showError(er); render(); } } });

    const info = [
      ['Project', project ? projectChip(project) : h('span', { class: 'muted' }, 'None')],
      ['Category', categoryTag(t.category)],
      ['Start date', t.startDate ? formatDate(t.startDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
      ['Deadline', t.endDate ? `${formatDate(t.endDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${t.dueTime ? ` · ${formatTimeStr(t.dueTime)}` : ''}` : '—'],
      ['Estimate', t.estimatedMinutes ? formatMinutes(t.estimatedMinutes) : '—'],
      ['Progress', t.progress != null ? `${t.progress}%` : isDone(t) ? '100%' : '—'],
      ['Repeats', describeRecurrence(t.recurrence) || 'No'],
      ['Reminder', t.reminderAt ? formatDateTime(t.reminderAt) : '—'],
      ['Created', t.createdAt ? `${formatDateTime(t.createdAt)} (${timeAgo(t.createdAt)})` : '—'],
      ['Completed', t.completedAt ? formatDateTime(t.completedAt) : '—'],
    ];
    if (t.meetingId && store.meetings.get(t.meetingId)) info.push(['From meeting', store.meetings.get(t.meetingId).title]);

    add(clear(container), 
      h('div', { class: 'details-head' },
        h('h3', { class: 'details-title' }, t.title),
        h('div', { class: 'details-badges' }, statusPill(t.status), priorityBadge(t.priority), flags.map((f) => flagChip(f)), t.archived ? h('span', { class: 'chip' }, icon('archive', { size: 12 }), 'Archived') : null)),
      h('div', { class: 'quick-controls' },
        field('Status', statusSel), field('Priority', prioSel), field('Deadline', deadline)),
      h('div', { class: 'details-actions' },
        h('button', { class: `btn ${isDone(t) ? 'btn-ghost' : 'btn-success'}`, type: 'button', onClick: () => toggleComplete(t) }, icon(isDone(t) ? 'rotate-ccw' : 'circle-check', { size: 16 }), isDone(t) ? 'Reopen' : 'Mark complete'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { modal.close(); openTaskForm({ task: t }); } }, icon('pencil', { size: 16 }), 'Edit'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => duplicate(t) }, icon('copy', { size: 16 }), 'Duplicate'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => archiveToggle(t) }, icon('archive', { size: 16 }), t.archived ? 'Restore' : 'Archive'),
        h('button', { class: 'btn btn-ghost danger-text', type: 'button', onClick: async () => { if (await confirmDeleteTask(t)) modal.close(); } }, icon('trash-2', { size: 16 }), 'Delete')),
      t.description ? h('section', { class: 'details-section' }, h('h4', {}, 'Description'), h('p', { class: 'prewrap' }, t.description)) : null,
      h('dl', { class: 'info-grid' }, info.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      t.tags?.length ? h('section', { class: 'details-section' }, h('h4', {}, 'Tags'), h('div', { class: 'chip-row' }, t.tags.map((tag) => h('span', { class: 'chip' }, `#${tag}`)))) : null,
      h('section', { class: 'details-section' },
        h('h4', {}, 'Notes'),
        t.notes ? h('p', { class: 'prewrap notes-log' }, t.notes) : h('p', { class: 'muted' }, 'No notes yet.'),
        h('div', { class: 'note-add' }, noteInput, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: addNote }, icon('plus', { size: 15 }), 'Add note'))),
    );
  };
  render();
  unsub = store.subscribe((keys) => {
    if ((keys.has('tasks') || keys.has('tick') || keys.has('projects')) && document.activeElement !== noteInput) render();
  });
  return modal;
}
