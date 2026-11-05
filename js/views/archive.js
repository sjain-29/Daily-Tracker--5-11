// js/views/archive.js — archived tasks, projects, notes and meetings: restore or delete permanently.

import { h, clear, formatDate, timeAgo, add } from '../utils.js';
import { icon, emptyState, skeleton, confirmDialog, toast, selectEl } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { taskRow } from '../components.js';
import { confirmDeleteTask } from '../task-modal.js';
import { confirmDeleteProject } from './projects.js';
import { noteTypeInfo } from '../constants.js';

const view = {
  title: 'Archive',
  deps: ['tasks', 'projects', 'notes', 'meetings'],
  tab: 'tasks',

  mount(root) { this.root = root; this.refresh(); },

  refresh() {
    if (!this.root) return;
    clear(this.root);
    const lists = {
      tasks: store.list('tasks').filter((t) => t.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)),
      projects: store.list('projects').filter((p) => p.archived),
      notes: store.list('notes').filter((n) => n.archived),
      meetings: store.list('meetings').filter((m) => m.archived),
    };
    const days = selectEl([{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '0', label: 'any age' }], '7', { class: 'input input-sm', style: 'width:auto', 'aria-label': 'Age' });
    add(this.root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Archive'), h('p', {}, 'Hidden from everyday views but kept for history and analytics. Restore anything at any time.')),
        h('div', { class: 'page-actions' },
          h('span', { class: 'muted sm' }, 'Archive finished tasks older than'), days,
          h('button', { class: 'btn btn-sm', type: 'button', onClick: () => {
            const n = db.archiveCompletedOlderThan(Number(days.value));
            toast(n ? `Archived ${n} finished task${n === 1 ? '' : 's'}` : 'Nothing to archive', { type: n ? 'success' : 'info' });
          } }, icon('archive', { size: 15 }), 'Archive'))),
      h('div', { class: 'tabs', role: 'tablist' }, [['tasks', 'Tasks'], ['projects', 'Projects'], ['notes', 'Notes'], ['meetings', 'Meetings']].map(([k, label]) =>
        h('button', { class: `tab ${this.tab === k ? 'active' : ''}`, type: 'button', role: 'tab', onClick: () => { this.tab = k; this.refresh(); } }, label, h('span', { class: 'count' }, String(lists[k].length))))));
    if (!store.isLoaded()) { add(this.root, skeleton(4)); return; }
    const list = lists[this.tab];
    if (!list.length) { add(this.root, h('div', { class: 'card' }, emptyState({ iconName: 'archive', title: 'Nothing archived', text: 'Archived items will appear here.' }))); return; }
    const now = new Date();
    const restoreBtn = (fn) => h('button', { class: 'btn btn-sm', type: 'button', onClick: (e) => { e.stopPropagation(); fn(); toast('Restored', { type: 'success' }); } }, icon('rotate-ccw', { size: 14 }), 'Restore');
    const deleteBtn = (fn) => h('button', { class: 'icon-btn sm ghost danger-text', type: 'button', 'aria-label': 'Delete permanently', onClick: (e) => { e.stopPropagation(); fn(); } }, icon('trash-2', { size: 15 }));
    const row = (main, ...actions) => h('div', { class: 'row', style: 'gap:8px;padding:4px 6px;border-bottom:1px solid var(--border)' }, h('div', { style: 'flex:1;min-width:0' }, main), ...actions);
    let content;
    if (this.tab === 'tasks') content = list.map((t) => row(taskRow(t, { now, showStatus: true, menu: false }), restoreBtn(() => db.archiveTask(t.id, false)), deleteBtn(() => confirmDeleteTask(t))));
    if (this.tab === 'projects') content = list.map((p) => row(h('div', { style: 'padding:8px' }, h('strong', {}, p.name), h('div', { class: 'faint xs' }, `${p.code || ''} ${p.category} · archived ${timeAgo(p.archivedAt)}`)), restoreBtn(() => db.archiveProject(p.id, false)), deleteBtn(() => confirmDeleteProject(p))));
    if (this.tab === 'notes') content = list.map((n) => row(h('div', { style: 'padding:8px' }, h('strong', {}, n.title || (n.body || '').slice(0, 80)), h('div', { class: 'faint xs' }, `${noteTypeInfo(n.type).name} · archived ${timeAgo(n.archivedAt)}`)), restoreBtn(() => db.updateNote(n.id, { archived: false })),
      deleteBtn(async () => { if (await confirmDialog({ title: 'Delete note permanently?', confirmText: 'Delete', danger: true })) { db.deleteNote(n.id); toast('Note deleted', { type: 'success' }); } })));
    if (this.tab === 'meetings') content = list.map((m) => row(h('div', { style: 'padding:8px' }, h('strong', {}, m.title), h('div', { class: 'faint xs' }, `${formatDate(m.date, { day: 'numeric', month: 'short', year: 'numeric' })} · archived ${timeAgo(m.archivedAt)}`)), restoreBtn(() => db.archiveMeeting(m.id, false)),
      deleteBtn(async () => { if (await confirmDialog({ title: 'Delete meeting permanently?', confirmText: 'Delete', danger: true })) { db.deleteMeeting(m.id); toast('Meeting deleted', { type: 'success' }); } })));
    add(this.root, h('section', { class: 'card', style: 'padding:6px' }, content));
  },
};

export default view;
