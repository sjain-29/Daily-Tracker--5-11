// js/store.js — in-memory application state mirrored from Firebase, with batched change events.

import { DEFAULT_SETTINGS } from './constants.js';
import { toList } from './utils.js';

const COLLECTIONS = ['tasks', 'projects', 'meetings', 'notes', 'focusSessions'];
const listeners = new Set();
const pendingKeys = new Set();
let scheduled = false;

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') out[k] = deepMerge(base[k], v);
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** Normalises records read from the database (arrays may arrive as objects, etc.). */
function normalise(name, id, value) {
  const rec = { ...value, id };
  if (name === 'tasks') {
    rec.tags = toList(rec.tags);
    rec.title = rec.title || 'Untitled task';
  }
  if (name === 'meetings') {
    rec.participants = toList(rec.participants);
    rec.actionItems = rec.actionItems && typeof rec.actionItems === 'object' ? rec.actionItems : {};
  }
  if (name === 'notes' || name === 'projects') rec.tags = toList(rec.tags);
  return rec;
}

export const store = {
  uid: null,
  user: null,
  role: undefined,            // undefined = unknown yet, null = not authorised
  connected: false,
  pendingWrites: 0,
  fromCache: false,
  loaded: Object.fromEntries([...COLLECTIONS, 'settings', 'profile'].map((k) => [k, false])),
  tasks: new Map(),
  projects: new Map(),
  meetings: new Map(),
  notes: new Map(),
  focusSessions: new Map(),
  settings: deepMerge(DEFAULT_SETTINGS, {}),
  profile: null,
  _lists: {},

  /** Cached array view of a collection (rebuilt only after it changes). */
  list(name) {
    if (!this._lists[name]) this._lists[name] = [...this[name].values()];
    return this._lists[name];
  },

  replace(name, obj) {
    const map = new Map();
    for (const [id, v] of Object.entries(obj || {})) if (v && typeof v === 'object') map.set(id, normalise(name, id, v));
    this[name] = map;
    this._lists[name] = null;
    this.loaded[name] = true;
    if (COLLECTIONS.every((k) => this.loaded[k])) this.fromCache = false;
    this.changed(name);
  },

  setSettings(val) {
    this.settings = deepMerge(DEFAULT_SETTINGS, val || {});
    this.loaded.settings = true;
    this.changed('settings');
  },

  setProfile(val) {
    this.profile = val || null;
    this.loaded.profile = true;
    this.changed('profile');
  },

  isLoaded() {
    return this.fromCache || COLLECTIONS.every((k) => this.loaded[k]);
  },

  reset() {
    for (const k of COLLECTIONS) { this[k] = new Map(); this.loaded[k] = false; }
    this._lists = {};
    this.settings = deepMerge(DEFAULT_SETTINGS, {});
    this.profile = null;
    this.loaded.settings = this.loaded.profile = false;
    this.role = undefined;
    this.uid = null;
    this.user = null;
    this.fromCache = false;
    this.pendingWrites = 0;
  },

  /** Queue a change notification; listeners receive a Set of changed keys once per frame. */
  changed(key) {
    pendingKeys.add(key);
    if (scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      const keys = new Set(pendingKeys);
      pendingKeys.clear();
      for (const fn of listeners) {
        try { fn(keys); } catch (err) { console.error('[store] listener failed', err); }
      }
    };
    if (typeof document !== 'undefined' && !document.hidden && typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /* Convenience getters */
  task(id) { return this.tasks.get(id) || null; },
  project(id) { return id ? this.projects.get(id) || null : null; },
  activeProjects() { return this.list('projects').filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)); },
  displayName() {
    if (this.profile?.name) return this.profile.name;
    const local = this.user?.email ? this.user.email.split('@')[0].replace(/[._-]+/g, ' ') : '';
    return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : 'there';
  },
};

export { COLLECTIONS, deepMerge };
