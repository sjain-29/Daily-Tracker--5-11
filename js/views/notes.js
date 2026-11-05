// js/views/notes.js — Notes & Meetings: meeting records with action items (convertible to tasks) and categorised notes.

import { h, clear, toDateStr, formatDate, formatTimeStr, timeAgo, debounce, relativeDay, todayStr, parseDate, add } from '../utils.js';
import { icon, emptyState, skeleton, segmented, selectEl, openModal, field, toast, popMenu, confirmDialog, toggleSwitch } from '../ui.js';
import { store } from '../store.js';
import * as db from '../database.js';
import { NOTE_TYPES, LIMITS, noteTypeInfo } from '../constants.js';
import { sortMeetings, meetingEnd, openActionItems, isDone } from '../task-logic.js';
import { avatarStack, projectChip, statusPill } from '../components.js';
import { openTaskDetails, toggleComplete } from '../task-modal.js';

const view = {
  title: 'Notes & Meetings',
  deps: ['meetings', 'notes', 'tasks', 'projects', 'tick'],

  mount(root, route) {
    this.root = root;
    this.tab = route.query.get('tab') === 'notes' ? 'notes' : route.query.get('tab') === 'meetings' ? 'meetings' : (this.tab || 'meetings');
    this.q = '';
    this.meetingScope = 'upcoming';
    this.noteType = '';
    this.body = h('div');
    const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search notes and meetings', 'aria-label': 'Search', onInput: debounce((e) => { this.q = e.target.value.toLowerCase(); this.refresh(); }, 150) });
    this.tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    this.toolsEl = h('div', { class: 'row wrap' });
    add(root, 
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Notes & Meetings'), h('p', {}, 'Meeting minutes, action items, technical and R&D observations, ideas and reminders.')),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onClick: () => openNoteForm() }, icon('sticky-note', { size: 15 }), 'New note'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openMeetingForm() }, icon('calendar-plus', { size: 15 }), 'New meeting'))),
      this.tabsEl,
      h('div', { class: 'toolbar' }, h('div', { class: 'search-inline' }, icon('search', { size: 15 }), search), this.toolsEl),
      this.body);
    this.refresh();
  },

  refresh() {
    if (!this.root) return;
    const meetings = store.list('meetings').filter((m) => !m.archived);
    const notes = store.list('notes').filter((n) => !n.archived);
    add(clear(this.tabsEl), 
      tabBtn('Meetings', meetings.length, this.tab === 'meetings', () => { this.tab = 'meetings'; this.refresh(); }),
      tabBtn('Notes', notes.length, this.tab === 'notes', () => { this.tab = 'notes'; this.refresh(); }));
    clear(this.body);
    clear(this.toolsEl);
    if (!store.isLoaded()) { add(this.body, skeleton(4, { height: 80 })); return; }
    if (this.tab === 'meetings') this.renderMeetings(meetings); else this.renderNotes(notes);
  },

  renderMeetings(meetings) {
    const now = new Date();
    add(this.toolsEl, segmented([{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }], this.meetingScope, (v) => { this.meetingScope = v; this.refresh(); }, { size: 'sm' }));
    let list = meetings.filter((m) => !this.q || [m.title, m.agenda, m.notes, m.location, ...(m.participants || []), ...openActionItems(m).map((i) => i.text)].join(' ').toLowerCase().includes(this.q));
    if (this.meetingScope === 'upcoming') list = sortMeetings(list.filter((m) => meetingEnd(m) >= now || (m.followUpDate && !m.followUpDone)));
    else if (this.meetingScope === 'past') list = sortMeetings(list.filter((m) => meetingEnd(m) < now)).reverse();
    else list = sortMeetings(list).reverse();
    if (!list.length) {
      add(this.body, h('div', { class: 'card' }, emptyState({ iconName: 'users', title: meetings.length ? 'No meetings match' : 'No meetings yet', text: 'Record agenda, discussion notes and action items — then turn action items into tasks.', action: h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openMeetingForm() }, icon('plus', { size: 15 }), 'New meeting') })));
      return;
    }
    add(this.body, h('div', { class: 'meeting-list' }, list.map((m) => meetingCard(m, now))));
  },

  renderNotes(notes) {
    add(this.toolsEl, h('div', { class: 'chip-row' },
      h('button', { class: `chip-btn ${!this.noteType ? 'active' : ''}`, type: 'button', onClick: () => { this.noteType = ''; this.refresh(); } }, 'All'),
      NOTE_TYPES.map((t) => h('button', { class: `chip-btn ${this.noteType === t.key ? 'active' : ''}`, type: 'button', onClick: () => { this.noteType = t.key; this.refresh(); } }, t.name))));
    const list = notes
      .filter((n) => (!this.noteType || n.type === this.noteType) && (!this.q || [n.title, n.body, ...(n.tags || [])].join(' ').toLowerCase().includes(this.q)))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!list.length) {
      add(this.body, h('div', { class: 'card' }, emptyState({ iconName: 'notebook-pen', title: notes.length ? 'No notes match' : 'No notes yet', text: 'Capture quick notes, technical and R&D observations, ideas and important reminders.', action: h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openNoteForm({ defaults: { type: this.noteType || 'quick' } }) }, icon('plus', { size: 15 }), 'New note') })));
      return;
    }
    add(this.body, h('div', { class: 'notes-grid' }, list.map(noteCard)));
  },
};

export default view;

function tabBtn(label, count, active, onClick) {
  return h('button', { class: `tab ${active ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(active), onClick }, label, h('span', { class: 'count' }, String(count)));
}

/* ---------------------------------------------------------------- Meetings */

function meetingCard(m, now) {
  const d = parseDate(m.date);
  const items = openActionItems(m);
  const openItems = items.filter((i) => !itemDone(i)).length;
  const past = meetingEnd(m) < now;
  return h('article', { class: 'card interactive meeting-card', tabindex: '0', style: past ? 'opacity:.85' : '', onClick: () => openMeetingDetails(m.id), onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && openMeetingDetails(m.id) },
    h('div', { class: 'meeting-date' }, h('div', { class: 'm' }, formatDate(d, { month: 'short' })), h('div', { class: 'd' }, String(d.getDate()))),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'meeting-title' }, m.title),
      h('div', { class: 'meeting-meta' },
        h('span', {}, icon('clock', { size: 12 }), `${relativeDay(m.date, now)}${m.startTime ? ` · ${formatTimeStr(m.startTime)}${m.endTime ? `–${formatTimeStr(m.endTime)}` : ''}` : ''}`),
        m.location ? h('span', {}, icon('map-pin', { size: 12 }), m.location) : null,
        m.participants?.length ? h('span', {}, icon('users', { size: 12 }), `${m.participants.length}`) : null,
        items.length ? h('span', {}, icon('list-checks', { size: 12 }), `${items.length - openItems}/${items.length} actions done`) : null,
        m.followUpDate ? h('span', { class: !m.followUpDone && m.followUpDate < toDateStr(now) ? 'danger-text' : '' }, icon('handshake', { size: 12 }), m.followUpDone ? 'Follow-up done' : `Follow-up ${relativeDay(m.followUpDate, now)}`) : null,
        projectChip(store.project(m.projectId)))),
    h('div', { class: 'row' },
      m.participants?.length ? avatarStack(m.participants, 3) : null,
      h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'Meeting actions', onClick: (e) => { e.stopPropagation(); meetingMenu(e.currentTarget, m); } }, icon('ellipsis', { size: 16 }))));
}

function itemDone(item) {
  const t = item.taskId ? store.task(item.taskId) : null;
  return t ? isDone(t) : !!item.done;
}

function meetingMenu(anchor, m) {
  popMenu(anchor, [
    { label: 'Open', icon: 'eye', onClick: () => openMeetingDetails(m.id) },
    { label: 'Edit', icon: 'pencil', onClick: () => openMeetingForm({ meeting: m }) },
    m.followUpDate ? { label: m.followUpDone ? 'Reopen follow-up' : 'Mark follow-up done', icon: 'handshake', onClick: () => db.patchMeeting(m.id, { followUpDone: m.followUpDone ? null : true }) } : null,
    { separator: true },
    { label: 'Archive', icon: 'archive', onClick: () => { db.archiveMeeting(m.id, true); toast('Meeting archived', { type: 'success', action: { label: 'Undo', fn: () => db.archiveMeeting(m.id, false) } }); } },
    { label: 'Delete…', icon: 'trash-2', danger: true, onClick: () => confirmDeleteMeeting(m) },
  ]);
}

async function confirmDeleteMeeting(m) {
  const ok = await confirmDialog({ title: 'Delete meeting permanently?', message: `“${m.title}” and its notes will be deleted. Tasks created from its action items are kept.`, confirmText: 'Delete meeting', danger: true });
  if (ok) { db.deleteMeeting(m.id); toast('Meeting deleted', { type: 'success' }); }
  return ok;
}

export function openMeetingDetails(id) {
  const body = h('div', { class: 'task-details' });
  let unsub = null;
  const modal = openModal({ title: 'Meeting', size: 'drawer', body, onClose: () => unsub?.() });
  const render = () => {
    const m = store.meetings.get(id);
    if (!m) { add(clear(body), h('p', { class: 'muted' }, 'This meeting no longer exists.')); return; }
    const now = new Date();
    const items = openActionItems(m).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const unconverted = items.filter((i) => !(i.taskId && store.task(i.taskId)));
    add(clear(body), 
      h('div', { class: 'details-head' },
        h('h3', { class: 'details-title' }, m.title),
        h('div', { class: 'details-badges' },
          h('span', { class: 'chip' }, icon('calendar', { size: 12 }), formatDate(m.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })),
          m.startTime ? h('span', { class: 'chip' }, icon('clock', { size: 12 }), `${formatTimeStr(m.startTime)}${m.endTime ? ` – ${formatTimeStr(m.endTime)}` : ''}`) : null,
          m.location ? h('span', { class: 'chip' }, icon('map-pin', { size: 12 }), m.location) : null,
          projectChip(store.project(m.projectId)))),
      h('div', { class: 'details-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { modal.close(); openMeetingForm({ meeting: m }); } }, icon('pencil', { size: 16 }), 'Edit'),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { db.archiveMeeting(m.id, true); modal.close(); toast('Meeting archived', { type: 'success' }); } }, icon('archive', { size: 16 }), 'Archive'),
        h('button', { class: 'btn btn-ghost danger-text', type: 'button', onClick: async () => { if (await confirmDeleteMeeting(m)) modal.close(); } }, icon('trash-2', { size: 16 }), 'Delete')),
      m.participants?.length ? section('Participants', h('div', { class: 'chip-row' }, m.participants.map((p) => h('span', { class: 'chip' }, icon('user', { size: 12 }), p)))) : null,
      m.agenda ? section('Agenda', h('p', { class: 'prewrap muted' }, m.agenda)) : null,
      m.notes ? section('Discussion notes', h('p', { class: 'prewrap muted' }, m.notes)) : null,
      section(`Action items (${items.length})`,
        items.length ? h('div', { class: 'ai-list' }, items.map((it) => actionItemRow(m, it, now))) : h('p', { class: 'muted' }, 'No action items recorded.'),
        unconverted.length > 1 ? h('button', { class: 'btn btn-sm', type: 'button', style: 'margin-top:8px', onClick: () => {
          unconverted.forEach((it) => db.convertActionItemToTask(m.id, it.id));
          toast(`${unconverted.length} tasks created from action items`, { type: 'success' });
        } }, icon('list-checks', { size: 15 }), `Convert all ${unconverted.length} to tasks`) : null),
      m.followUpDate ? section('Follow-up', h('label', { class: 'row', style: 'gap:10px' },
        toggleSwitch(!!m.followUpDone, (v) => db.patchMeeting(m.id, { followUpDone: v ? true : null }), { label: 'Follow-up done' }),
        h('span', { class: !m.followUpDone && m.followUpDate < toDateStr(now) ? 'danger-text' : '' }, `${m.followUpDone ? 'Done' : 'Due'} · ${formatDate(m.followUpDate, { weekday: 'short', day: 'numeric', month: 'short' })}`))) : null);
  };
  render();
  unsub = store.subscribe((keys) => { if (keys.has('meetings') || keys.has('tasks')) render(); });
}

function actionItemRow(m, it, now) {
  const task = it.taskId ? store.task(it.taskId) : null;
  const done = itemDone(it);
  return h('div', { class: `ai-item ${done ? 'done' : ''}` },
    h('button', { class: `check ${done ? 'is-done' : ''}`, type: 'button', role: 'checkbox', 'aria-checked': String(done), 'aria-label': 'Toggle action item',
      onClick: () => (task ? toggleComplete(task) : db.setActionItemDone(m.id, it.id, !it.done)) }, icon('check', { size: 13, strokeWidth: 3 })),
    h('div', { class: 'txt' }, h('div', {}, it.text), h('div', { class: 'row wrap faint xs', style: 'gap:8px;margin-top:2px' },
      it.dueDate ? h('span', {}, `Due ${relativeDay(it.dueDate, now)}`) : null,
      task ? statusPill(task.status) : it.taskId ? h('span', {}, 'Linked task was deleted') : null)),
    task
      ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => openTaskDetails(task.id) }, 'View task')
      : h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { const tid = db.convertActionItemToTask(m.id, it.id); toast('Task created from action item', { type: 'success', action: { label: 'Open', fn: () => openTaskDetails(tid) } }); } }, icon('arrow-right', { size: 14 }), 'To task'));
}

function section(title, ...content) {
  return h('section', { class: 'details-section' }, h('h4', {}, title), content);
}

export function openMeetingForm({ meeting = null, defaults = {} } = {}) {
  const editing = !!meeting;
  const m = editing ? meeting : { date: todayStr(), ...defaults };
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const title = h('input', { class: 'input input-lg', value: m.title || '', maxlength: LIMITS.title, placeholder: 'e.g. Weekly EW prototype review', autofocus: true });
  const date = h('input', { class: 'input', type: 'date', value: m.date || '' });
  const start = h('input', { class: 'input', type: 'time', value: m.startTime || '' });
  const end = h('input', { class: 'input', type: 'time', value: m.endTime || '' });
  const location = h('input', { class: 'input', value: m.location || '', maxlength: LIMITS.location, placeholder: 'Room, lab or video link' });
  const project = selectEl([{ value: '', label: 'No project' }, ...store.activeProjects().map((p) => ({ value: p.id, label: p.name }))], m.projectId || '');
  const participants = h('input', { class: 'input', value: (m.participants || []).join(', '), placeholder: 'Names, separated by commas' });
  const agenda = h('textarea', { class: 'input', rows: 3, maxlength: LIMITS.agenda, placeholder: 'Topics to cover' }, m.agenda || '');
  const notes = h('textarea', { class: 'input', rows: 4, maxlength: LIMITS.notes, placeholder: 'Decisions, observations, open questions' }, m.notes || '');
  const followUp = h('input', { class: 'input', type: 'date', value: m.followUpDate || '' });
  const itemsWrap = h('div', { class: 'stack', style: 'gap:8px' });
  const items = openActionItems(m).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((it) => ({ ...it }));
  const drawItems = () => {
    clear(itemsWrap);
    items.forEach((it, idx) => {
      const text = h('input', { class: 'input input-sm', value: it.text || '', maxlength: LIMITS.actionItem, placeholder: 'Action item', onInput: (e) => { it.text = e.target.value; } });
      const due = h('input', { class: 'input input-sm', type: 'date', value: it.dueDate || '', 'aria-label': 'Due date', onInput: (e) => { it.dueDate = e.target.value; } });
      add(itemsWrap, h('div', { class: 'ai-edit-row' }, text, due,
        h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'Remove action item', onClick: () => { items.splice(idx, 1); drawItems(); } }, icon('x', { size: 15 }))));
    });
    add(itemsWrap, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'align-self:flex-start', onClick: () => { items.push({ text: '' }); drawItems(); itemsWrap.querySelectorAll('input:not([type=date])')[items.length - 1]?.focus(); } }, icon('plus', { size: 15 }), 'Add action item'));
  };
  drawItems();
  const save = () => {
    err.hidden = true;
    try {
      const data = { title: title.value, date: date.value, startTime: start.value, endTime: end.value, location: location.value, projectId: project.value, participants: participants.value, agenda: agenda.value, notes: notes.value, followUpDate: followUp.value, followUpDone: editing ? meeting.followUpDone : null, actionItems: items };
      if (editing) { db.updateMeeting(meeting.id, data); toast('Meeting saved', { type: 'success' }); }
      else { const id = db.createMeeting(data); toast('Meeting added', { type: 'success', action: { label: 'Open', fn: () => openMeetingDetails(id) } }); }
      modal.close();
    } catch (e) {
      err.textContent = e instanceof db.ValidationError ? e.message : `Couldn’t save: ${e.message}`;
      err.hidden = false;
    }
  };
  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } },
    err,
    field('Meeting title', title, { required: true }),
    h('div', { class: 'form-row three' }, field('Date', date, { required: true }), field('Start', start), field('End', end)),
    h('div', { class: 'form-row' }, field('Location / link', location), field('Project', project)),
    field('Participants', participants),
    field('Agenda', agenda),
    field('Discussion notes', notes),
    field('Action items', itemsWrap, { hint: 'After saving, open the meeting to convert action items into tasks.' }),
    field('Follow-up date', followUp),
    h('button', { type: 'submit', hidden: true }));
  const modal = openModal({
    title: editing ? 'Edit meeting' : 'New meeting', size: 'lg', body: form,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, editing ? 'Save changes' : 'Add meeting')],
  });
}

/* ---------------------------------------------------------------- Notes */

function noteCard(n) {
  const t = noteTypeInfo(n.type);
  return h('article', { class: 'card interactive note-card', style: { '--c': t.color }, tabindex: '0', onClick: () => openNoteForm({ note: n }), onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && openNoteForm({ note: n }) },
    h('div', { class: 'row' }, h('span', { class: 'type-badge' }, icon(t.icon, { size: 13 }), t.name), h('span', { class: 'spacer' }), n.pinned ? h('span', { class: 'mini-icon', title: 'Pinned' }, icon('pin', { size: 13 })) : null),
    n.title ? h('div', { class: 'note-title' }, n.title) : null,
    n.body ? h('div', { class: 'note-body' }, n.body) : null,
    h('div', { class: 'note-foot' }, n.tags?.length ? h('span', {}, n.tags.map((x) => `#${x}`).join(' ')) : null, h('span', { class: 'spacer' }), h('span', {}, timeAgo(n.updatedAt))));
}

export function openNoteForm({ note = null, defaults = {} } = {}) {
  const editing = !!note;
  const n = editing ? note : { type: 'quick', ...defaults };
  let type = n.type;
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const title = h('input', { class: 'input input-lg', value: n.title || '', maxlength: LIMITS.title, placeholder: 'Title (optional)', autofocus: true });
  const bodyEl = h('textarea', { class: 'input', rows: 9, maxlength: LIMITS.noteBody, placeholder: 'Write your note…' }, n.body || '');
  const tags = h('input', { class: 'input', value: (n.tags || []).join(', '), placeholder: 'e.g. gimbal, thermal, vendor' });
  const project = selectEl([{ value: '', label: 'No project' }, ...store.activeProjects().map((p) => ({ value: p.id, label: p.name }))], n.projectId || '');
  let pinned = !!n.pinned;
  const typeSel = h('div', { class: 'chip-row' });
  const drawTypes = () => { clear(typeSel); NOTE_TYPES.forEach((t) => add(typeSel, h('button', { class: `chip-btn ${type === t.key ? 'active' : ''}`, type: 'button', onClick: () => { type = t.key; drawTypes(); } }, icon(t.icon, { size: 13 }), ' ', t.name))); };
  drawTypes();
  const save = () => {
    err.hidden = true;
    try {
      const data = { title: title.value, body: bodyEl.value, type, tags: tags.value, projectId: project.value, pinned };
      if (editing) { db.updateNote(note.id, data); toast('Note saved', { type: 'success' }); } else { db.createNote(data); toast('Note added', { type: 'success' }); }
      modal.close();
    } catch (e) { err.textContent = e instanceof db.ValidationError ? e.message : `Couldn’t save: ${e.message}`; err.hidden = false; }
  };
  bodyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } },
    err, field('Type', typeSel), title, bodyEl,
    h('div', { class: 'form-row' }, field('Tags', tags), field('Project', project)),
    h('label', { class: 'row', style: 'gap:10px' }, toggleSwitch(pinned, (v) => { pinned = v; }, { label: 'Pin note' }), h('span', { class: 'sm' }, 'Pin to top')));
  const modal = openModal({
    title: editing ? 'Edit note' : 'New note', subtitle: editing ? `Updated ${timeAgo(note.updatedAt)}` : null, size: 'lg', body: form,
    footer: [
      editing ? h('button', { class: 'btn btn-ghost danger-text', type: 'button', onClick: async () => {
        if (await confirmDialog({ title: 'Delete note permanently?', message: 'This can’t be undone.', confirmText: 'Delete', danger: true })) { db.deleteNote(note.id); toast('Note deleted', { type: 'success' }); modal.close(); }
      } }, icon('trash-2', { size: 16 }), 'Delete') : null,
      editing ? h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { db.updateNote(note.id, { archived: true }); toast('Note archived', { type: 'success', action: { label: 'Undo', fn: () => db.updateNote(note.id, { archived: false }) } }); modal.close(); } }, icon('archive', { size: 16 }), 'Archive') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, editing ? 'Save' : 'Add note'),
    ],
  });
}

