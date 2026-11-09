// js/timer.js — Pomodoro / focus timer engine.
// Uses wall-clock end times (not tick counting) so it stays accurate when the tab is in the
// background, and persists its state on this device so a reload doesn't lose a running session.
// Completed focus sessions are saved to Firebase (/users/{uid}/focusSessions).

import { store } from './store.js';
import { logFocusSession } from './database.js';
import { notify } from './notifications.js';
import { storageGet, storageSet, toDateStr } from './utils.js';

const KEY = 'fd-timer-v1';
const listeners = new Set();
let ticker = null;
let audioCtx = null;

const defaultState = () => ({ mode: 'focus', status: 'idle', durationSec: null, endsAt: null, remainingSec: null, startedAt: null, cycle: 0, taskId: null });
let state = { ...defaultState(), ...(storageGet(KEY, null) || {}) };

export const MODES = {
  focus: { label: 'Focus', verb: 'Focusing' },
  short: { label: 'Short break', verb: 'Short break' },
  long: { label: 'Long break', verb: 'Long break' },
};

function durations() {
  const f = store.settings.focus;
  return { focus: f.focusMin * 60, short: f.shortMin * 60, long: f.longMin * 60 };
}

function save() { storageSet(KEY, state); }
function emit(type = 'change') { for (const fn of listeners) { try { fn(type, getState()); } catch (e) { console.error(e); } } }

export function subscribeTimer(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function remainingSec() {
  if (state.status === 'running') return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  if (state.status === 'paused') return state.remainingSec;
  return durations()[state.mode];
}

export function getState() {
  const total = state.status === 'idle' ? durations()[state.mode] : state.durationSec;
  const rem = remainingSec();
  return { ...state, remaining: rem, total, progress: total ? 1 - rem / total : 0 };
}

export function formatRemaining(sec = remainingSec()) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function start() {
  unlockAudio();
  if (state.status === 'running') return;
  if (state.status === 'paused') {
    state = { ...state, status: 'running', endsAt: Date.now() + state.remainingSec * 1000, remainingSec: null };
  } else {
    const dur = durations()[state.mode];
    state = { ...state, status: 'running', durationSec: dur, endsAt: Date.now() + dur * 1000, remainingSec: null, startedAt: Date.now() };
  }
  save(); ensureTicker(); emit();
}

export function pause() {
  if (state.status !== 'running') return;
  state = { ...state, status: 'paused', remainingSec: remainingSec(), endsAt: null };
  save(); stopTicker(); emit();
}

export function reset() {
  state = { ...defaultState(), mode: state.mode, cycle: state.cycle, taskId: state.taskId };
  save(); stopTicker(); emit();
}

export function setMode(mode) {
  if (!MODES[mode]) return;
  state = { ...defaultState(), mode, cycle: state.cycle, taskId: state.taskId };
  save(); stopTicker(); emit();
}

export function setTask(taskId) {
  state = { ...state, taskId: taskId || null };
  save(); emit();
}

/** End the current session early. A focus session of at least one minute is still recorded. */
export function endEarly() {
  if (state.status === 'idle') return;
  const elapsed = state.durationSec - remainingSec();
  if (state.mode === 'focus' && elapsed >= 60) record(elapsed, Date.now());
  advance(state.mode === 'focus' && elapsed >= 60);
}

function record(actualSec, endedAt) {
  if (!store.uid || !store.role) return;
  try {
    logFocusSession({ mode: state.mode, plannedSec: state.durationSec, actualSec, startedAt: state.startedAt || endedAt - actualSec * 1000, endedAt, taskId: state.taskId });
  } catch (err) { console.warn('[timer] could not record session', err); }
}

function advance(countedFocus) {
  const longEvery = store.settings.focus.longEvery || 4;
  let next = 'focus', cycle = state.cycle;
  if (state.mode === 'focus') {
    if (countedFocus) cycle += 1;
    next = countedFocus && cycle % longEvery === 0 ? 'long' : 'short';
  }
  state = { ...defaultState(), mode: next, cycle, taskId: state.taskId };
  save(); stopTicker();
  if (store.settings.focus.autoStartBreaks && next !== 'focus') start(); else emit();
}

function complete() {
  const endedAt = Math.min(Date.now(), state.endsAt || Date.now());
  const finished = state.mode;
  if (finished === 'focus') record(state.durationSec, endedAt);
  chime();
  const title = finished === 'focus' ? 'Focus session complete' : 'Break over';
  const body = finished === 'focus' ? `Nice work — ${Math.round(state.durationSec / 60)} focused minutes logged. Time for a break.` : 'Ready for the next focus session?';
  // The app shows its own in-app toast, so only a system notification is needed here.
  if (store.settings.notifications.focus) notify(title, body, { tag: 'focus-timer', always: true, fallback: false });
  emit('complete');
  advance(finished === 'focus');
}

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (state.status !== 'running') { stopTicker(); return; }
    if (Date.now() >= state.endsAt) complete(); else emit('tick');
  }, 500);
}
function stopTicker() { clearInterval(ticker); ticker = null; }

/** Called once the user's settings are loaded: resumes a running session or completes one that ended while the app was closed. */
export function initTimer() {
  if (state.status === 'running') {
    if (Date.now() >= state.endsAt) complete(); else ensureTicker();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.status === 'running' && Date.now() >= state.endsAt) complete();
  });
  emit();
}

/** Adjust the default duration of the current mode (only while idle). Saves to settings. */
export function durationKeyForMode(mode = state.mode) {
  return { focus: 'focusMin', short: 'shortMin', long: 'longMin' }[mode];
}

export function todayFocus(now = new Date()) {
  const today = toDateStr(now);
  const sessions = store.list('focusSessions').filter((s) => s.mode === 'focus' && s.date === today);
  return { sessions: sessions.length, minutes: sessions.reduce((sum, s) => sum + (s.actualSec || 0) / 60, 0) };
}

/* ---------------------------------------------------------------- Sound */

function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio not available */ }
}

export function chime(force = false) {
  if (!force && !store.settings.focus.sound) return;
  try {
    unlockAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [[880, 0], [1174.7, 0.18], [1568, 0.36]].forEach(([freq, offset]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.5);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.55);
    });
  } catch { /* ignore */ }
}
