// js/firebase-config.js — the ONLY file you need to edit to connect your Firebase project.
//
// ┌──────────────────────────────────────────────────────────────────────────────┐
// │ These values are PUBLIC client identifiers, not secrets. Every Firebase web   │
// │ app ships them to the browser. Security comes from Firebase Authentication +  │
// │ the Realtime Database Security Rules (database.rules.json) + App Check — NOT  │
// │ from hiding these values. Never put service-account JSON, Admin SDK keys or   │
// │ passwords in this file (or anywhere in this repository).                      │
// └──────────────────────────────────────────────────────────────────────────────┘
//
// Where to find them: Firebase Console → ⚙ Project settings → General → "Your apps"
// → Web app (</>) → "SDK setup and configuration" → Config. Copy each value below.

/** Production project (used on GitHub Pages and any non-localhost domain). */
const production = {
  apiKey: 'AIzaSyDXWEcbDfXqIoRC9WRj1rYqYg4J-0IomF4',
  authDomain: 'daily-tasks-1987e.firebaseapp.com',
  databaseURL: 'https://daily-tasks-1987e-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'daily-tasks-1987e',
  storageBucket: 'daily-tasks-1987e.firebasestorage.app',
  messagingSenderId: '324537978634',
  appId: '1:324537978634:web:2cd61efbf092b4a041f4f3',
};

/**
 * Optional separate project for local development (http://localhost).
 * Leave as null to use the production project everywhere.
 */
const development = null;

/**
 * Firebase App Check (recommended). Create a reCAPTCHA v3 site key for your GitHub Pages
 * domain, register it under Firebase Console → App Check → Apps, then paste the SITE key
 * (public) here. The reCAPTCHA SECRET key stays in the Firebase console — never here.
 * Leave siteKey empty to run without App Check.
 */
export const appCheckSettings = {
  provider: 'recaptcha-v3', // 'recaptcha-v3' | 'recaptcha-enterprise'
  siteKey: '',
  // On localhost the SDK prints a debug token in the console; register it in
  // App Check → Apps → ⋮ → Manage debug tokens so local testing works with enforcement on.
  debugTokenOnLocalhost: true,
};

export function getEnvironment() {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local') ? 'development' : 'production';
}

export function getFirebaseConfig() {
  return getEnvironment() === 'development' && development ? development : production;
}

/** True once every required value has been filled in. */
export function isConfigured(config = getFirebaseConfig()) {
  const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
  return required.every((k) => typeof config?.[k] === 'string' && config[k].length > 0 && !config[k].startsWith('PASTE_'));
}
