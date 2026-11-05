// js/quick-start.js — optional, user-initiated starter templates (nothing is created automatically).

import { h, todayStr } from './utils.js';
import { openModal, toast, icon } from './ui.js';
import { SUGGESTED_PROJECTS, SUGGESTED_ROUTINES, PROJECT_COLORS, describeFreq } from './quick-start-data.js';
import { store } from './store.js';
import * as db from './database.js';

export function openQuickStart() {
  const existing = new Set(store.list('projects').map((p) => p.name.toLowerCase()));
  const existingTasks = new Set(store.list('tasks').map((t) => t.title.toLowerCase()));
  const projectChecks = SUGGESTED_PROJECTS.map((p) => ({ p, el: h('input', { type: 'checkbox', checked: !existing.has(p.name.toLowerCase()), disabled: existing.has(p.name.toLowerCase()) }) }));
  const routineChecks = SUGGESTED_ROUTINES.map((r) => ({ r, el: h('input', { type: 'checkbox', checked: false, disabled: existingTasks.has(r.title.toLowerCase()) }) }));

  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Pick anything useful to create it in your workspace. You can rename or delete these later — nothing here is added unless you choose it.'),
    h('section', { class: 'stack', style: 'gap:8px' },
      h('h4', { class: 'field-label' }, 'R&D projects'),
      projectChecks.map(({ p, el }) => h('label', { class: 'check-row' }, el, h('span', {}, p.name, ' ', h('span', { class: 'faint xs' }, `${p.code} · ${p.category}${el.disabled ? ' · already exists' : ''}`))))),
    h('section', { class: 'stack', style: 'gap:8px' },
      h('h4', { class: 'field-label' }, 'Recurring routines (start today)'),
      routineChecks.map(({ r, el }) => h('label', { class: 'check-row' }, el, h('span', {}, r.title, ' ', h('span', { class: 'faint xs' }, `${describeFreq(r.freq)} · ${r.category}${el.disabled ? ' · already exists' : ''}`))))));

  const create = () => {
    let projectsMade = 0, tasksMade = 0;
    projectChecks.forEach(({ p, el }, i) => {
      if (el.checked && !el.disabled) {
        db.createProject({ ...p, status: 'Active', priority: 'High', color: PROJECT_COLORS[i % PROJECT_COLORS.length], startDate: todayStr() });
        projectsMade++;
      }
    });
    routineChecks.forEach(({ r, el }) => {
      if (el.checked && !el.disabled) {
        db.createTask({ title: r.title, category: r.category, priority: r.priority, status: 'Not Started', startDate: todayStr(), endDate: todayStr(), recurrence: { freq: r.freq, interval: 1 } });
        tasksMade++;
      }
    });
    modal.close();
    if (projectsMade || tasksMade) toast(`Created ${projectsMade} project${projectsMade === 1 ? '' : 's'} and ${tasksMade} routine${tasksMade === 1 ? '' : 's'}`, { type: 'success' });
  };

  const modal = openModal({
    title: 'Quick start', subtitle: 'Optional templates for drone R&D coordination', size: 'md', body,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: create }, icon('sparkles', { size: 16 }), 'Create selected')],
  });
}
