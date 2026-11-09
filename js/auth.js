// js/auth.js — Firebase Authentication: sign-in, sign-out, password reset, route protection.

import {
  auth, configured, onAuthStateChanged, onIdTokenChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, setPersistence, browserSessionPersistence, indexedDBLocalPersistence,
} from './firebase.js';
import { storageSet, storageGet } from './utils.js';

const REMEMBER_KEY = 'fd-remember';

/** Resolves with the current user (or null) once Firebase has restored any saved session. */
export function getCurrentUser() {
  if (!configured) return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); }, () => { unsub(); resolve(null); });
  });
}

/**
 * Route guard for protected pages. Redirects to the login page when there is no session.
 * The original hash route is preserved so the user lands back where they were.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const next = location.hash && location.hash.startsWith('#/') ? `?next=${encodeURIComponent(location.hash)}` : '';
    location.replace(`login.html${next}`);
    return new Promise(() => {}); // never resolves; the page is navigating away
  }
  return user;
}

/** Calls `cb(null)` if the session ends while the app is open (sign-out elsewhere, token revoked, account disabled). */
export function watchSession(cb) {
  if (!configured) return () => {};
  return onIdTokenChanged(auth, (user) => { if (!user) cb(null); }, () => cb(null));
}

export async function signIn(email, password, remember = true) {
  // "Remember me" keeps the session across browser restarts; otherwise it ends when the tab closes.
  await setPersistence(auth, remember ? indexedDBLocalPersistence : browserSessionPersistence);
  storageSet(REMEMBER_KEY, !!remember);
  return signInWithEmailAndPassword(auth, String(email).trim(), password);
}

export const rememberedDevice = () => storageGet(REMEMBER_KEY, true) !== false;

export function signOutUser() {
  return signOut(auth);
}

export function sendReset(email) {
  return sendPasswordResetEmail(auth, String(email).trim());
}

/** Turns Firebase Auth error codes into clear, non-technical messages. */
export function authErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/user-disabled': 'This account has been disabled. Contact the administrator.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes or reset your password.',
    'auth/network-request-failed': 'No connection to Firebase. Check your internet connection and try again.',
    'auth/operation-not-allowed': 'Email/Password sign-in is not enabled in the Firebase console.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase API key in js/firebase-config.js is not valid.',
    'auth/invalid-api-key': 'The Firebase API key in js/firebase-config.js is not valid.',
    'auth/unauthorized-domain': 'This domain is not authorised. Add it under Authentication → Settings → Authorized domains.',
    'auth/firebase-app-check-token-is-invalid.': 'App Check rejected this request. Check the reCAPTCHA site key and App Check settings.',
    'auth/requires-recent-login': 'Please sign in again to continue.',
    'auth/internal-error': 'Firebase returned an internal error. Please try again.',
  };
  return map[code] || (code ? `Sign-in failed (${code}).` : 'Something went wrong. Please try again.');
}
