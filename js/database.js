// js/database.js — every Realtime Database read/write goes through this module.
//
// Design notes
// • All paths are scoped to /users/{auth.uid}; the UID always comes from Firebase Auth.
// • Writes are multi-path `update()` calls touching only the fields that changed, so editing one
//   task can never overwrite unrelated data.
// • Writes are applied to local state immediately (optimistic UI) and recorded in a small
//   on-device journal until Firebase acknowledges them. If the tab is closed or reloaded while
//   offline, the journal is replayed on the next start so offline changes are not lost.
//   Conflicts resolve as "last write wins".
// • One listener per collection; all listeners are removed on sign-out.

import { db, ref, push, update, onValue, query, orderByChild, startAt } from './firebase.js';
import { store, COLLECTIONS, deepMerge } from './store.js';
import {
  TASK_CATEGORIES, PRIORITIES, TASK_STATUSES, PROJECT_STATUSES, PROJECT_CATEGORIES, NOTE_TYPES,
  LIMITS, DEFAULT_SETTINGS, ACCENTS, WALLPAPERS,
} from './constants.js';
import {
  cleanText, parseTags, isValidDateStr, isValidTimeStr, storageGet, storageSet, storageRemove,
  debounce, DAY_MS, clamp, toDateStr, formatDateTime,
} from './utils.js';
import { nextOccurrenceDates } from './task-logic.js';

export class ValidationError extends Error {}

let uid = null;
let rootUnsubs = [];
let dataUnsubs = [];
let handlers = { onWriteError: () => {}, onPermissionDenied: () => {}, onRoleChange: () => {} };
let remember = true;
let settingsRaw = {};
let profileEnsured = false;
let unsubscribeCache = null;

/* ================================================================ Lifecycle */

export function startSync(user, opts = {}) {
  stopSync();
  uid = user.uid;
  remember = opts.remember !== false;
  handlers = { ...handlers, ...opts };
  store.uid = uid;
  store.user = user;
  hydrateFromCache();
  // A cached role lets the app open with cached data while offline; the live listener below confirms it.
  if (store.role) { attachData(); queueMicrotask(() => handlers.onRoleChange(store.role)); }

  rootUnsubs.push(onValue(ref(db, '.info/connected'), (snap) => {
    store.connected = snap.val() === true;
    store.changed('connection');
  }));

  // Authorisation: a user may only use the app if an administrator created /roles/{uid}.
  rootUnsubs.push(onValue(ref(db, `roles/${uid}`), (snap) => {
    const role = snap.val();
    store.role = role || null;
    if (role) attachData();
    else { detachData(); storageRemove(cacheKey()); }
    handlers.onRoleChange(store.role);
    store.changed('role');
  }, (err) => {
    store.role = null;
    detachData();
    handlers.onRoleChange(null, err);
    store.changed('role');
  }));

  unsubscribeCache = store.subscribe(saveCacheDebounced);
}

export function stopSync({ clearLocal = false } = {}) {
  detachData();
  rootUnsubs.forEach((u) => u());
  rootUnsubs = [];
  if (unsubscribeCache) { unsubscribeCache(); unsubscribeCache = null; }
  saveCacheDebounced.cancel?.();
  if (clearLocal && uid) {
    storageRemove(cacheKey());
    storageRemove(journalKey(), 'local');
    storageRemove(journalKey(), 'session');
  }
  uid = null;
  profileEnsured = false;
  settingsRaw = {};
  store.reset();
}

function attachData() {
  if (dataUnsubs.length) return;
  const base = `users/${uid}`;
  const listen = (q, name, onData) => {
    dataUnsubs.push(onValue(q, onData, (err) => handleListenError(err, name)));
  };
  for (const name of ['tasks', 'projects', 'meetings', 'notes']) {
    listen(ref(db, `${base}/${name}`), name, (snap) => store.replace(name, snap.val()));
  }
  // Focus sessions: only the last ~13 months are needed for analytics.
  listen(query(ref(db, `${base}/focusSessions`), orderByChild('startedAt'), startAt(Date.now() - 400 * DAY_MS)),
    'focusSessions', (snap) => store.replace('focusSessions', snap.val()));
  listen(ref(db, `${base}/settings`), 'settings', (snap) => {
    settingsRaw = snap.val() || {};
    store.setSettings(settingsRaw);
    cacheAppearance(store.settings);
  });
  listen(ref(db, `${base}/profile`), 'profile', (snap) => {
    store.setProfile(snap.val());
    if (!snap.exists()) ensureProfile();
  });
  replayJournal();
}

function detachData() {
  dataUnsubs.forEach((u) => u());
  dataUnsubs = [];
}

function handleListenError(err, name) {
  console.warn(`[db] listener for ${name} cancelled:`, err?.message || err);
  if (isPermissionError(err)) handlers.onPermissionDenied(err);
}

export const isPermissionError = (err) => /permission[_ ]denied/i.test(`${err?.code || ''} ${err?.message || ''}`);

/* ================================================================ Writes */

const journalArea = () => (remember ? 'local' : 'session');
const journalKey = () => `fd-journal-v1-${uid}`;
const cacheKey = () => `fd-cache-v1-${uid}`;
const readJournal = () => storageGet(journalKey(), [], journalArea()) || [];
const writeJournal = (list) => storageSet(journalKey(), list, journalArea());

export const pendingChangeCount = () => (uid ? readJournal().length : 0);

function assertSerializable(value, path) {
  if (value === undefined) throw new Error(`Refusing to write undefined at ${path}`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Refusing to write non-finite number at ${path}`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertSerializable(v, `${path}/${k}`);
}

/**
 * Commit a multi-path update relative to /users/{uid}. Returns immediately; the change is applied to
 * local state at once and synchronised in the background (including after reconnecting).
 */
function commit(updates, label = 'change') {
  if (!uid) throw new Error('Not signed in');
  const keys = Object.keys(updates);
  if (!keys.length) return;
  for (const k of keys) assertSerializable(updates[k], k);
  const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), label, updates };
  writeJournal([...readJournal(), entry]);
  applyLocal(updates);
  send(entry);
}

function send(entry) {
  store.pendingWrites++;
  store.changed('sync');
  update(ref(db, `users/${uid}`), entry.updates)
    .then(() => removeJournal(entry.id))
    .catch((err) => {
      removeJournal(entry.id);
      handlers.onWriteError(err, entry.label);
      if (isPermissionError(err)) handlers.onPermissionDenied(err);
    })
    .finally(() => { store.pendingWrites = Math.max(0, store.pendingWrites - 1); store.changed('sync'); });
}

function removeJournal(id) {
  if (!uid) return;
  writeJournal(readJournal().filter((e) => e.id !== id));
  store.changed('sync');
}

/** Re-send writes recorded in a previous session that Firebase never acknowledged. */
function replayJournal() {
  const entries = readJournal();
  if (!entries.length) return;
  console.info(`[db] replaying ${entries.length} unsynced change(s) from this device`);
  for (const e of entries) { applyLocal(e.updates); send(e); }
}

/** Apply an update map to the in-memory store so the UI reflects it instantly (also while offline). */
function applyLocal(updates) {
  const touched = new Set();
  for (const [path, value] of Object.entries(updates)) {
    const [col, id, ...rest] = path.split('/');
    if (COLLECTIONS.includes(col) && id) {
      const map = store[col];
      if (!rest.length) {
        if (value === null) map.delete(id); else map.set(id, normaliseLocal(col, id, value));
      } else {
        const rec = map.get(id) ? structuredClone(map.get(id)) : { id };
        setDeep(rec, rest, value);
        map.set(id, normaliseLocal(col, id, rec));
      }
      store._lists[col] = null;
      touched.add(col);
    } else if (col === 'settings') {
      settingsRaw = structuredClone(settingsRaw || {});
      if (id) setDeep(settingsRaw, [id, ...rest], value); else settingsRaw = value || {};
      store.setSettings(settingsRaw);
      cacheAppearance(store.settings);
    } else if (col === 'profile') {
      const p = structuredClone(store.profile || {});
      if (id) setDeep(p, [id, ...rest], value);
      store.setProfile(id ? p : value);
    }
  }
  touched.forEach((c) => store.changed(c));
}

function setDeep(obj, parts, value) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value === null) { if (Array.isArray(o)) o.splice(Number(last), 1); else delete o[last]; } else o[last] = structuredClone(value);
}

function normaliseLocal(col, id, value) {
  const rec = { ...value, id };
  if ('tags' in rec && !Array.isArray(rec.tags)) rec.tags = Object.values(rec.tags || {});
  if (col === 'tasks' && !rec.tags) rec.tags = [];
  if (col === 'meetings') {
    if (rec.participants && !Array.isArray(rec.participants)) rec.participants = Object.values(rec.participants);
    rec.participants = rec.participants || [];
    rec.actionItems = rec.actionItems || {};
  }
  return rec;
}

const newKey = (col) => push(ref(db, `users/${uid}/${col}`)).key;
const validId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Diff `next` against `current` for the given fields and add `${base}/${field}` entries. */
function diffInto(updates, base, current, next, fields) {
  for (const f of fields) {
    const a = isEmpty(current?.[f]) ? null : current[f];
    const b = isEmpty(next?.[f]) ? null : next[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) updates[`${base}/${f}`] = b;
  }
}

function withoutEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!isEmpty(v)) out[k] = v;
  return out;
}

/* ================================================================ Tasks */

const TASK_EDITABLE = ['title', 'description', 'projectId', 'category', 'priority', 'status', 'startDate', 'endDate',
  'dueTime', 'estimatedMinutes', 'progress', 'tags', 'notes', 'recurrence', 'reminderAt'];
const TASK_SYSTEM = ['archived', 'archivedAt', 'completedAt', 'startedAt', 'seriesId', 'nextOccurrenceId', 'meetingId'];
const TASK_FIELDS = [...TASK_EDITABLE, ...TASK_SYSTEM];

function cleanRecurrence(rec) {
  if (!rec || !rec.freq || rec.freq === 'none') return null;
  const freq = ['daily', 'weekdays', 'weekly', 'monthly', 'custom'].includes(rec.freq) ? rec.freq : null;
  if (!freq) return null;
  const out = { freq, interval: clamp(parseInt(rec.interval, 10) || 1, 1, 365) };
  if (freq === 'custom') out.unit = ['day', 'week', 'month'].includes(rec.unit) ? rec.unit : 'day';
  return out;
}

/** Validates and normalises user input for a task. Throws ValidationError with a friendly message. */
export function cleanTaskInput(input) {
  const t = {};
  t.title = cleanText(input.title, LIMITS.title);
  if (!t.title) throw new ValidationError('Task title is required.');
  t.description = cleanText(input.description, LIMITS.description, { multiline: true });
  t.projectId = validId(input.projectId);
  t.category = TASK_CATEGORIES.some((c) => c.name === input.category) ? input.category : 'Other';
  t.priority = PRIORITIES.some((p) => p.name === input.priority) ? input.priority : 'Medium';
  t.status = TASK_STATUSES.some((s) => s.name === input.status) ? input.status : 'Not Started';
  t.startDate = isValidDateStr(input.startDate) ? input.startDate : null;
  t.endDate = isValidDateStr(input.endDate) ? input.endDate : null;
  if (t.startDate && t.endDate && t.startDate > t.endDate) throw new ValidationError('The deadline can’t be earlier than the start date.');
  t.dueTime = t.endDate && isValidTimeStr(input.dueTime) ? input.dueTime : null;
  const est = Number(input.estimatedMinutes);
  t.estimatedMinutes = Number.isFinite(est) && est > 0 ? clamp(Math.round(est), 1, 100000) : null;
  const prog = Number(input.progress);
  t.progress = input.progress === '' || input.progress === null || input.progress === undefined || !Number.isFinite(prog) ? null : clamp(Math.round(prog), 0, 100);
  t.tags = parseTags(input.tags, { max: LIMITS.tags, maxLen: LIMITS.tag });
  t.notes = cleanText(input.notes, LIMITS.notes, { multiline: true });
  t.recurrence = cleanRecurrence(input.recurrence);
  const rem = Number(input.reminderAt);
  t.reminderAt = Number.isFinite(rem) && rem > 0 ? Math.round(rem) : null;
  return t;
}

/** Status side-effects: completion timestamps, progress and start tracking. Mutates `next`. */
function applyStatusTransition(prev, next, now) {
  if (prev.status === next.status) return;
  if (next.status === 'Completed') {
    next.completedAt = now;
    next.progress = 100;
  } else {
    next.completedAt = null;
    if (prev.status === 'Completed' && next.progress === 100) next.progress = null;
  }
  if (next.status === 'In Progress' && !next.startedAt) next.startedAt = now;
}

/** Build the next occurrence of a recurring task (returns [id, record] or null). */
function buildNextOccurrence(sourceId, task, now) {
  if (!task.recurrence || task.nextOccurrenceId) return null;
  const dates = nextOccurrenceDates(task, new Date(now));
  if (!dates) return null;
  const id = newKey('tasks');
  const rec = withoutEmpty({
    title: task.title, description: task.description, projectId: task.projectId, category: task.category,
    priority: task.priority, status: 'Not Started', dueTime: task.dueTime, estimatedMinutes: task.estimatedMinutes,
    tags: task.tags, recurrence: task.recurrence, seriesId: task.seriesId || sourceId,
    startDate: dates.startDate, endDate: dates.endDate, reminderAt: dates.reminderAt,
    createdAt: now, updatedAt: now,
  });
  return [id, rec];
}

export function createTask(input) {
  const now = Date.now();
  const clean = cleanTaskInput(input);
  const id = newKey('tasks');
  const rec = { ...clean, meetingId: validId(input.meetingId) };
  applyStatusTransition({ status: null }, rec, now);
  commit({ [`tasks/${id}`]: withoutEmpty({ ...rec, createdAt: now, updatedAt: now }) }, 'task');
  return id;
}

/**
 * Update a task with a partial patch. Handles status side-effects and recurring generation.
 * Returns { before, spawnedId } so callers can offer Undo.
 */
export function updateTask(id, patch, { label = 'task' } = {}) {
  const current = store.task(id);
  if (!current) throw new Error('Task not found');
  const now = Date.now();
  let next = { ...current, ...patch };
  if (TASK_EDITABLE.some((f) => f in patch)) next = { ...current, ...patch, ...cleanTaskInput(next) };
  applyStatusTransition(current, next, now);

  const updates = {};
  let spawnedId = null;
  if (next.status === 'Completed' && current.status !== 'Completed') {
    const occ = buildNextOccurrence(id, next, now);
    if (occ) {
      [spawnedId] = occ;
      updates[`tasks/${occ[0]}`] = occ[1];
      next.nextOccurrenceId = spawnedId;
    }
  }
  diffInto(updates, `tasks/${id}`, current, next, TASK_FIELDS);
  if (!Object.keys(updates).length) return { before: current, spawnedId: null };
  updates[`tasks/${id}/updatedAt`] = now;
  commit(updates, label);
  return { before: current, spawnedId };
}

export const setTaskStatus = (id, status) => updateTask(id, { status }, { label: 'status' });
export const completeTask = (id) => setTaskStatus(id, 'Completed');

export function reopenTask(id) {
  const t = store.task(id);
  if (!t) return null;
  return updateTask(id, { status: t.startedAt ? 'In Progress' : 'Not Started' }, { label: 'task' });
}

/** Undo a change made by updateTask (restores fields and removes a spawned recurring copy). */
export function undoTaskChange(id, before, spawnedId) {
  const current = store.task(id);
  if (!current || !before) return;
  const updates = {};
  diffInto(updates, `tasks/${id}`, current, before, TASK_FIELDS);
  if (spawnedId && store.task(spawnedId)) {
    updates[`tasks/${spawnedId}`] = null;
    updates[`tasks/${id}/nextOccurrenceId`] = null;
  }
  updates[`tasks/${id}/updatedAt`] = Date.now();
  commit(updates, 'undo');
}

export function duplicateTask(id) {
  const t = store.task(id);
  if (!t) return null;
  return createTask({ ...t, title: `${t.title} (copy)`.slice(0, LIMITS.title), status: 'Not Started', progress: null });
}

export function deleteTask(id) {
  const updates = { [`tasks/${id}`]: null };
  // Detach the task from any meeting action item that created it.
  for (const m of store.list('meetings')) {
    for (const [itemId, item] of Object.entries(m.actionItems || {})) {
      if (item?.taskId === id) updates[`meetings/${m.id}/actionItems/${itemId}/taskId`] = null;
    }
  }
  commit(updates, 'delete task');
}

export function archiveTask(id, archived = true) {
  commit({
    [`tasks/${id}/archived`]: archived ? true : null,
    [`tasks/${id}/archivedAt`]: archived ? Date.now() : null,
    [`tasks/${id}/updatedAt`]: Date.now(),
  }, archived ? 'archive' : 'restore');
}

export function archiveCompletedOlderThan(days) {
  const cutoff = Date.now() - days * DAY_MS;
  const updates = {};
  let count = 0;
  for (const t of store.list('tasks')) {
    if (!t.archived && (t.status === 'Completed' || t.status === 'Cancelled') && (t.completedAt || t.updatedAt || 0) < cutoff) {
      updates[`tasks/${t.id}/archived`] = true;
      updates[`tasks/${t.id}/archivedAt`] = Date.now();
      count++;
    }
  }
  if (count) commit(updates, 'archive');
  return count;
}

export function appendTaskNote(id, text) {
  const t = store.task(id);
  const line = cleanText(text, 2000, { multiline: true });
  if (!t || !line) return;
  const stamp = formatDateTime(Date.now());
  const notes = `${t.notes ? `${t.notes}\n\n` : ''}[${stamp}] ${line}`.slice(-LIMITS.notes);
  commit({ [`tasks/${id}/notes`]: notes, [`tasks/${id}/updatedAt`]: Date.now() }, 'note');
}

/* ================================================================ Projects */

const PROJECT_FIELDS = ['name', 'code', 'description', 'category', 'startDate', 'targetDate', 'status', 'priority', 'notes', 'color', 'archived', 'archivedAt', 'completedAt'];

export function cleanProjectInput(input) {
  const p = {};
  p.name = cleanText(input.name, LIMITS.name);
  if (!p.name) throw new ValidationError('Project name is required.');
  p.code = cleanText(input.code, LIMITS.code).toUpperCase() || null;
  p.description = cleanText(input.description, LIMITS.description, { multiline: true });
  p.category = PROJECT_CATEGORIES.includes(input.category) ? input.category : 'Other';
  p.startDate = isValidDateStr(input.startDate) ? input.startDate : null;
  p.targetDate = isValidDateStr(input.targetDate) ? input.targetDate : null;
  if (p.startDate && p.targetDate && p.startDate > p.targetDate) throw new ValidationError('Target completion date can’t be before the start date.');
  p.status = PROJECT_STATUSES.some((s) => s.name === input.status) ? input.status : 'Active';
  p.priority = PRIORITIES.some((x) => x.name === input.priority) ? input.priority : 'Medium';
  p.notes = cleanText(input.notes, LIMITS.notes, { multiline: true });
  p.color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : '#3b82f6';
  return p;
}

export function createProject(input) {
  const now = Date.now();
  const id = newKey('projects');
  const p = cleanProjectInput(input);
  if (p.status === 'Completed') p.completedAt = now;
  commit({ [`projects/${id}`]: withoutEmpty({ ...p, createdAt: now, updatedAt: now }) }, 'project');
  return id;
}

export function updateProject(id, input) {
  const current = store.project(id);
  if (!current) throw new Error('Project not found');
  const next = { ...current, ...cleanProjectInput({ ...current, ...input }) };
  if (next.status === 'Completed' && current.status !== 'Completed') next.completedAt = Date.now();
  if (next.status !== 'Completed') next.completedAt = null;
  if ('archived' in input) { next.archived = input.archived || null; next.archivedAt = input.archived ? Date.now() : null; }
  const updates = {};
  diffInto(updates, `projects/${id}`, current, next, PROJECT_FIELDS);
  if (!Object.keys(updates).length) return;
  updates[`projects/${id}/updatedAt`] = Date.now();
  commit(updates, 'project');
}

export function archiveProject(id, archived = true) {
  updateProject(id, { archived });
}

/** Delete a project; its tasks are either deleted too or kept and unassigned. */
export function deleteProject(id, { deleteTasks = false } = {}) {
  const updates = { [`projects/${id}`]: null };
  for (const t of store.list('tasks')) {
    if (t.projectId !== id) continue;
    if (deleteTasks) updates[`tasks/${t.id}`] = null;
    else { updates[`tasks/${t.id}/projectId`] = null; updates[`tasks/${t.id}/updatedAt`] = Date.now(); }
  }
  for (const m of store.list('meetings')) if (m.projectId === id) updates[`meetings/${m.id}/projectId`] = null;
  for (const n of store.list('notes')) if (n.projectId === id) updates[`notes/${n.id}/projectId`] = null;
  commit(updates, 'delete project');
}

/* ================================================================ Meetings */

const MEETING_FIELDS = ['title', 'date', 'startTime', 'endTime', 'location', 'projectId', 'participants', 'agenda', 'notes',
  'actionItems', 'followUpDate', 'followUpDone', 'archived', 'archivedAt'];

export function cleanMeetingInput(input, existingItems = {}) {
  const m = {};
  m.title = cleanText(input.title, LIMITS.title);
  if (!m.title) throw new ValidationError('Meeting title is required.');
  if (!isValidDateStr(input.date)) throw new ValidationError('Choose a meeting date.');
  m.date = input.date;
  m.startTime = isValidTimeStr(input.startTime) ? input.startTime : null;
  m.endTime = isValidTimeStr(input.endTime) ? input.endTime : null;
  if (m.startTime && m.endTime && m.endTime < m.startTime) throw new ValidationError('The meeting ends before it starts.');
  m.location = cleanText(input.location, LIMITS.location);
  m.projectId = validId(input.projectId);
  m.participants = parseTags(input.participants, { max: LIMITS.participants, maxLen: LIMITS.participant });
  m.agenda = cleanText(input.agenda, LIMITS.agenda, { multiline: true });
  m.notes = cleanText(input.notes, LIMITS.notes, { multiline: true });
  m.followUpDate = isValidDateStr(input.followUpDate) ? input.followUpDate : null;
  m.followUpDone = input.followUpDone ? true : null;
  // Action items: [{ id?, text, dueDate?, done? }] -> { itemId: {...} } preserving linked task ids.
  const items = {};
  for (const raw of input.actionItems || []) {
    const text = cleanText(raw.text, LIMITS.actionItem);
    if (!text) continue;
    const itemId = validId(raw.id) || newKey('meetings');
    const prev = existingItems[itemId] || {};
    items[itemId] = withoutEmpty({
      text, done: raw.done ? true : null, dueDate: isValidDateStr(raw.dueDate) ? raw.dueDate : null,
      taskId: validId(prev.taskId || raw.taskId), createdAt: prev.createdAt || Date.now(),
    });
  }
  m.actionItems = Object.keys(items).length ? items : null;
  return m;
}

export function createMeeting(input) {
  const now = Date.now();
  const id = newKey('meetings');
  const m = cleanMeetingInput(input);
  commit({ [`meetings/${id}`]: withoutEmpty({ ...m, createdAt: now, updatedAt: now }) }, 'meeting');
  return id;
}

export function updateMeeting(id, input) {
  const current = store.meetings.get(id);
  if (!current) throw new Error('Meeting not found');
  const next = { ...current, ...cleanMeetingInput({ ...current, ...input }, current.actionItems) };
  const updates = {};
  diffInto(updates, `meetings/${id}`, current, next, MEETING_FIELDS);
  if (!Object.keys(updates).length) return;
  updates[`meetings/${id}/updatedAt`] = Date.now();
  commit(updates, 'meeting');
}

export function patchMeeting(id, patch) {
  const updates = {};
  for (const [k, v] of Object.entries(patch)) updates[`meetings/${id}/${k}`] = v;
  updates[`meetings/${id}/updatedAt`] = Date.now();
  commit(updates, 'meeting');
}

export function deleteMeeting(id) {
  commit({ [`meetings/${id}`]: null }, 'delete meeting');
}

export function setActionItemDone(meetingId, itemId, done) {
  commit({
    [`meetings/${meetingId}/actionItems/${itemId}/done`]: done ? true : null,
    [`meetings/${meetingId}/updatedAt`]: Date.now(),
  }, 'action item');
}

/** Turn a meeting action item into a task and link the two (atomic multi-path update). */
export function convertActionItemToTask(meetingId, itemId) {
  const m = store.meetings.get(meetingId);
  const item = m?.actionItems?.[itemId];
  if (!m || !item) throw new Error('Action item not found');
  if (item.taskId && store.task(item.taskId)) return item.taskId;
  const now = Date.now();
  const id = newKey('tasks');
  const task = withoutEmpty({
    title: cleanText(item.text, LIMITS.title),
    description: `Action item from meeting “${m.title}” (${m.date}).`,
    projectId: m.projectId, category: 'Meetings', priority: 'Medium', status: 'Not Started',
    endDate: item.dueDate || m.followUpDate || null, tags: ['follow-up'], meetingId,
    createdAt: now, updatedAt: now,
  });
  commit({
    [`tasks/${id}`]: task,
    [`meetings/${meetingId}/actionItems/${itemId}/taskId`]: id,
    [`meetings/${meetingId}/updatedAt`]: now,
  }, 'convert action item');
  return id;
}

/* ================================================================ Notes */

const NOTE_FIELDS = ['title', 'body', 'type', 'tags', 'pinned', 'projectId', 'archived', 'archivedAt'];

export function cleanNoteInput(input) {
  const n = {};
  n.title = cleanText(input.title, LIMITS.title);
  n.body = cleanText(input.body, LIMITS.noteBody, { multiline: true });
  if (!n.title && !n.body) throw new ValidationError('Write a title or some text for the note.');
  n.type = NOTE_TYPES.some((t) => t.key === input.type) ? input.type : 'quick';
  n.tags = parseTags(input.tags, { max: LIMITS.tags, maxLen: LIMITS.tag });
  n.pinned = input.pinned ? true : null;
  n.projectId = validId(input.projectId);
  return n;
}

export function createNote(input) {
  const now = Date.now();
  const id = newKey('notes');
  commit({ [`notes/${id}`]: withoutEmpty({ ...cleanNoteInput(input), createdAt: now, updatedAt: now }) }, 'note');
  return id;
}

export function updateNote(id, input) {
  const current = store.notes.get(id);
  if (!current) throw new Error('Note not found');
  const next = { ...current, ...cleanNoteInput({ ...current, ...input }) };
  if ('archived' in input) { next.archived = input.archived || null; next.archivedAt = input.archived ? Date.now() : null; }
  const updates = {};
  diffInto(updates, `notes/${id}`, current, next, NOTE_FIELDS);
  if (!Object.keys(updates).length) return;
  updates[`notes/${id}/updatedAt`] = Date.now();
  commit(updates, 'note');
}

export function deleteNote(id) {
  commit({ [`notes/${id}`]: null }, 'delete note');
}

export function archiveMeeting(id, archived = true) {
  patchMeeting(id, { archived: archived ? true : null, archivedAt: archived ? Date.now() : null });
}

/* ================================================================ Focus sessions */

export function logFocusSession({ mode, plannedSec, actualSec, startedAt, endedAt, taskId }) {
  const id = newKey('focusSessions');
  commit({
    [`focusSessions/${id}`]: withoutEmpty({
      mode: ['focus', 'short', 'long'].includes(mode) ? mode : 'focus',
      plannedSec: clamp(Math.round(plannedSec), 60, 14400),
      actualSec: clamp(Math.round(actualSec), 0, 14400),
      startedAt: Math.round(startedAt), endedAt: Math.round(endedAt),
      date: toDateStr(new Date(startedAt)), taskId: validId(taskId),
    }),
  }, 'focus session');
  return id;
}

/* ================================================================ Settings & profile */

const SETTING_RANGES = {
  focusMin: [1, 180], shortMin: [1, 60], longMin: [1, 120], longEvery: [2, 12],
  meetingLeadMin: [0, 120], dailyFocusGoalMin: [0, 1440], weekStartsOn: [0, 1],
};

const SETTING_ENUMS = {
  theme: ['dark', 'light', 'auto'],
  accent: ACCENTS.map((a) => a.key),
  wallpaper: WALLPAPERS.map((w) => w.key),
  glass: ['tinted', 'clear'],
};

/** Save a (possibly nested) settings patch; only the changed leaves are written. */
export function saveSettings(patch) {
  const updates = {};
  const walk = (obj, prefix, defaults) => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in defaults)) continue;
      const path = `${prefix}/${k}`;
      if (v && typeof v === 'object') walk(v, path, defaults[k]);
      else if (SETTING_ENUMS[k] && prefix === 'settings') { if (SETTING_ENUMS[k].includes(v)) updates[path] = v; }
      else if (typeof defaults[k] === 'boolean') updates[path] = !!v;
      else if (typeof defaults[k] === 'number' && Number.isFinite(Number(v))) {
        const [lo, hi] = SETTING_RANGES[k] || [0, 100000];
        updates[path] = clamp(Math.round(Number(v)), lo, hi);
      }
    }
  };
  walk(patch, 'settings', DEFAULT_SETTINGS);
  if (!Object.keys(updates).length) return;
  updates['settings/updatedAt'] = Date.now();
  commit(updates, 'settings');
}

export function saveProfile({ name }) {
  const clean = cleanText(name, 60);
  if (!clean) throw new ValidationError('Name can’t be empty.');
  commit({ 'profile/name': clean, 'profile/updatedAt': Date.now() }, 'profile');
}

function ensureProfile() {
  if (profileEnsured || !store.user) return;
  profileEnsured = true;
  const email = store.user.email || '';
  const fallback = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const now = Date.now();
  commit({ profile: withoutEmpty({ name: cleanText(store.user.displayName || fallback || 'User', 60), email: email.slice(0, 254), createdAt: now, updatedAt: now }) }, 'profile');
}

/* ================================================================ Local cache */

/** Appearance is cached separately so the login page and first paint use the right theme. */
export function cacheAppearance(settings) {
  const { theme, accent, wallpaper, glass, reduceTransparency, sidebarCollapsed } = settings;
  storageSet('fd-appearance', { theme, accent, wallpaper, glass, reduceTransparency, sidebarCollapsed });
}

function hydrateFromCache() {
  if (!remember) return;
  const cached = storageGet(cacheKey(), null);
  if (!cached || cached.v !== 1) return;
  for (const name of COLLECTIONS) {
    store[name] = new Map(Object.entries(cached[name] || {}).map(([id, v]) => [id, normaliseLocal(name, id, v)]));
  }
  store._lists = {};
  settingsRaw = cached.settings || {};
  store.settings = deepMerge(DEFAULT_SETTINGS, settingsRaw);
  store.profile = cached.profile || null;
  store.role = cached.role || undefined;
  store.fromCache = true;
  store.changed('cache');
}

function saveCacheNow() {
  if (!uid || !remember || !store.role) return;
  if (!COLLECTIONS.every((k) => store.loaded[k]) && !store.fromCache) return;
  const strip = (map) => Object.fromEntries([...map.entries()].map(([id, v]) => { const { id: _drop, ...rest } = v; return [id, rest]; }));
  const payload = { v: 1, savedAt: Date.now(), role: store.role, settings: settingsRaw, profile: store.profile };
  for (const name of COLLECTIONS) payload[name] = strip(store[name]);
  if (!storageSet(cacheKey(), payload)) console.warn('[db] local cache is full; offline start-up will show less data');
}
const saveCacheDebounced = debounce(saveCacheNow, 1000);
// Make sure the latest state is cached when the app is closed or sent to the background.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { saveCacheDebounced.cancel(); saveCacheNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveCacheDebounced.cancel(); saveCacheNow(); } });
}

/* ================================================================ Export */

export function exportAll() {
  const strip = (map) => Object.fromEntries([...map.entries()].map(([id, v]) => { const { id: _drop, ...rest } = v; return [id, rest]; }));
  return {
    exportedAt: new Date().toISOString(),
    app: 'Flightdeck',
    profile: store.profile,
    settings: settingsRaw,
    tasks: strip(store.tasks),
    projects: strip(store.projects),
    meetings: strip(store.meetings),
    notes: strip(store.notes),
    focusSessions: strip(store.focusSessions),
  };
}
