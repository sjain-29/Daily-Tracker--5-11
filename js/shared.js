// js/shared.js — small cross-view state and actions (kept separate from app.js to avoid import cycles).

import { store } from './store.js';
import * as db from './database.js';
import { signOutUser } from './auth.js';
import { confirmDialog } from './ui.js';
import { stopReminderLoop } from './notifications.js';

/** Global search text from the top bar; list views subscribe to changes. */
export const ui = { search: '', searchListeners: new Set() };

export const session = { signingOut: false };

export function navigate(hash) { location.hash = hash; }

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { name: parts[0] || 'dashboard', params: parts.slice(1), query: new URLSearchParams(qs || '') };
}

/** Sign out, warning first if changes made offline haven't synced yet. */
export async function signOut() {
  const pending = db.pendingChangeCount();
  if (pending > 0) {
    const ok = await confirmDialog({
      title: 'Unsynced changes',
      message: `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} reached Firebase yet (you may be offline). Signing out now will discard ${pending === 1 ? 'it' : 'them'}.`,
      confirmText: 'Sign out anyway', danger: true,
    });
    if (!ok) return;
  }
  session.signingOut = true;
  stopReminderLoop();
  db.stopSync({ clearLocal: true });
  try { await signOutUser(); } catch { /* ignore */ }
  location.replace('login.html?reason=signedout');
}

export const userUid = () => store.uid;
