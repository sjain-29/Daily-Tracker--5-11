// js/components.js — reusable visual building blocks (badges, task rows/cards, rings, bars).

import { h, s, relativeDay, formatTimeStr, initials, clamp } from './utils.js';
import { icon } from './ui.js';
import { priorityInfo, statusInfo, categoryColor } from './constants.js';
import { computeFlags, isDone, isOverdue, describeRecurrence } from './task-logic.js';
import { store } from './store.js';
import { toggleComplete, openTaskDetails, taskMenu } from './task-modal.js';

const slug = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function priorityBadge(priority, { compact = false } = {}) {
  const p = priorityInfo(priority);
  return h('span', { class: `prio prio-${slug(p.name)}`, title: `${p.name} priority` },
    p.rank <= 1 ? icon('flag', { size: 12 }) : null,
    compact ? null : h('span', {}, p.name));
}

export function statusPill(status) {
  const st = statusInfo(status);
  return h('span', { class: `status-pill status-${st.key}` }, h('span', { class: 'dot' }), st.name);
}

export function flagChip(flag, { small = false } = {}) {
  return h('span', { class: `flag flag-${flag.tone} ${small ? 'flag-sm' : ''}`, title: flagTitle(flag) },
    icon(flag.icon, { size: small ? 11 : 12 }), h('span', {}, flag.label.toUpperCase()));
}

function flagTitle(flag) {
  return {
    OVERDUE: 'Deadline has passed and the task is not completed',
    DELAYED: 'In progress, but the deadline has passed',
    DUE_SOON: 'Deadline within the next 24 hours',
    NOT_STARTED: 'Start date has arrived but the task is still Not Started',
    UPCOMING: 'Deadline within the next 3 days',
  }[flag.key] || flag.label;
}

export function flagChips(task, now = new Date(), { max = 2, small = false } = {}) {
  const flags = computeFlags(task, now).slice(0, max);
  if (!flags.length) return null;
  return h('span', { class: 'flags' }, flags.map((f) => flagChip(f, { small })));
}

export function projectChip(project, { compact = false } = {}) {
  if (!project) return null;
  return h('span', { class: 'project-chip', title: project.name },
    h('span', { class: 'dot', style: { background: project.color || '#3b82f6' } }),
    h('span', { class: 'project-chip-name' }, compact && project.code ? project.code : project.name));
}

export function categoryTag(category) {
  return h('span', { class: 'cat-tag' }, h('span', { class: 'dot', style: { background: categoryColor(category) } }), category);
}

export function dueLabel(task, now = new Date()) {
  if (!task.endDate) return null;
  const overdue = isOverdue(task, now);
  const label = relativeDay(task.endDate, now) + (task.dueTime ? ` · ${formatTimeStr(task.dueTime)}` : '');
  return h('span', { class: `due ${overdue ? 'is-overdue' : ''}`, title: `Deadline ${task.endDate}${task.dueTime ? ' ' + task.dueTime : ''}` },
    icon('calendar', { size: 12 }), label);
}

export function checkButton(task) {
  const done = isDone(task);
  return h('button', {
    class: `check ${done ? 'is-done' : ''}`, type: 'button', role: 'checkbox', 'aria-checked': String(done),
    'aria-label': done ? `Reopen “${task.title}”` : `Mark “${task.title}” complete`,
    onClick: (e) => { e.stopPropagation(); toggleComplete(task); },
  }, icon('check', { size: 13, strokeWidth: 3 }));
}

/** Compact task row used on the dashboard, list view, project pages and calendar day view. */
export function taskRow(task, { now = new Date(), showProject = true, showStatus = false, showCategory = false, menu = true } = {}) {
  const project = store.project(task.projectId);
  const done = isDone(task);
  const recurring = describeRecurrence(task.recurrence);
  return h('div', {
    class: `task-row ${done ? 'is-done' : ''} ${task.status === 'Cancelled' ? 'is-cancelled' : ''}`, dataset: { id: task.id },
    tabindex: '0', role: 'button', 'aria-label': `Open task ${task.title}`,
    onClick: () => openTaskDetails(task.id),
    onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTaskDetails(task.id); },
  },
  checkButton(task),
  h('div', { class: 'task-main' },
    h('div', { class: 'task-title-line' },
      h('span', { class: 'task-title' }, task.title),
      recurring ? h('span', { class: 'mini-icon', title: recurring }, icon('repeat', { size: 12 })) : null),
    h('div', { class: 'task-meta' },
      showProject ? projectChip(project) : null,
      showCategory || !project ? categoryTag(task.category) : null,
      dueLabel(task, now),
      task.tags?.length ? h('span', { class: 'tag-count', title: task.tags.join(', ') }, icon('tag', { size: 11 }), task.tags.slice(0, 2).join(', ')) : null)),
  h('div', { class: 'task-side' },
    flagChips(task, now, { max: 2, small: true }),
    showStatus ? statusPill(task.status) : null,
    priorityBadge(task.priority),
    menu ? h('button', {
      class: 'icon-btn sm ghost row-menu', type: 'button', 'aria-label': 'Task actions',
      onClick: (e) => { e.stopPropagation(); taskMenu(e.currentTarget, task); },
    }, icon('ellipsis', { size: 16 })) : null));
}

/** Kanban card. */
export function taskCard(task, { now = new Date(), draggable = true } = {}) {
  const project = store.project(task.projectId);
  const progress = task.progress ?? (isDone(task) ? 100 : null);
  return h('article', {
    class: `k-card ${isDone(task) ? 'is-done' : ''}`, dataset: { id: task.id }, draggable: draggable ? 'true' : null, tabindex: '0',
    'aria-label': task.title,
    onClick: () => openTaskDetails(task.id),
    onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTaskDetails(task.id); },
  },
  h('div', { class: 'k-card-top' },
    project ? projectChip(project, { compact: true }) : categoryTag(task.category),
    h('span', { class: 'spacer' }),
    priorityBadge(task.priority, { compact: task.priority === 'Low' || task.priority === 'Medium' }),
    h('button', { class: 'icon-btn xs ghost', type: 'button', 'aria-label': 'Task actions / move', onClick: (e) => { e.stopPropagation(); taskMenu(e.currentTarget, task); } }, icon('ellipsis', { size: 15 }))),
  h('div', { class: 'k-card-title' }, task.title),
  flagChips(task, now, { max: 2, small: true }),
  progress !== null && progress !== undefined ? progressBar(progress, isDone(task) ? 'var(--success)' : 'var(--accent)') : null,
  h('div', { class: 'k-card-foot' },
    dueLabel(task, now) || h('span', { class: 'muted xs' }, 'No deadline'),
    h('span', { class: 'spacer' }),
    task.recurrence ? h('span', { class: 'mini-icon', title: describeRecurrence(task.recurrence) }, icon('repeat', { size: 12 })) : null,
    task.notes ? h('span', { class: 'mini-icon', title: 'Has notes' }, icon('file-text', { size: 12 })) : null,
    task.tags?.length ? h('span', { class: 'mini-icon', title: task.tags.join(', ') }, icon('tag', { size: 12 }), String(task.tags.length)) : null));
}

export function progressBar(percent, color = 'var(--accent)', { thin = false } = {}) {
  const v = clamp(Math.round(percent || 0), 0, 100);
  return h('div', { class: `bar ${thin ? 'thin' : ''}`, role: 'progressbar', 'aria-valuenow': String(v), 'aria-valuemin': '0', 'aria-valuemax': '100' },
    h('div', { class: 'bar-fill', style: { width: `${v}%`, background: color } }));
}

/** Single progress ring. */
export function ring(percent, { size = 64, stroke = 7, color = 'var(--accent)', label = null } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = clamp(percent || 0, 0, 100);
  return h('div', { class: 'ring', style: { width: `${size}px`, height: `${size}px` } },
    s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size },
      s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ring-track)', 'stroke-width': stroke }),
      s('circle', {
        cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
        'stroke-dasharray': `${(c * v) / 100} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-arc',
      })),
    label !== null ? h('div', { class: 'ring-label' }, label) : null);
}

/** Concentric activity rings like the reference dashboard: rings = [{ value: 0..1, color }] (outer first). */
export function activityRings(rings, { size = 168, stroke = 14, gap = 4, center = null } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'rings-svg', role: 'img', 'aria-label': 'Daily progress rings' });
  rings.forEach((rg, i) => {
    const r = size / 2 - stroke / 2 - i * (stroke + gap);
    if (r <= stroke / 2) return;
    const c = 2 * Math.PI * r, v = clamp(rg.value || 0, 0, 1);
    svg.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: rg.color, 'stroke-opacity': '0.16', 'stroke-width': stroke }));
    svg.appendChild(s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: rg.color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${Math.max(v * c, v > 0 ? 0.01 : 0)} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-arc',
    }));
  });
  return h('div', { class: 'rings', style: { width: `${size}px`, height: `${size}px` } }, svg, center ? h('div', { class: 'rings-center' }, center) : null);
}

export function avatarStack(names = [], max = 4) {
  const list = names.slice(0, max);
  return h('div', { class: 'avatars' },
    list.map((n, i) => h('span', { class: 'avatar', title: n, style: { '--i': i, background: `hsl(${(hash(n) % 360)}, 55%, 42%)` } }, initials(n))),
    names.length > max ? h('span', { class: 'avatar more' }, `+${names.length - max}`) : null);
}

function hash(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x;
}

export function cardHead(title, subtitle, actions) {
  return h('div', { class: 'card-head' },
    h('div', { class: 'card-titles' }, h('h3', { class: 'card-title' }, title), subtitle ? h('p', { class: 'card-sub' }, subtitle) : null),
    actions ? h('div', { class: 'card-actions' }, actions) : null);
}
