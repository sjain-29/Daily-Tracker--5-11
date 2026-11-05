// js/firebase.js — initialises Firebase once and re-exports the SDK functions the app uses.
// The SDK version is pinned in exactly one place (the import URLs below) to make upgrades easy.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, onIdTokenChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, setPersistence, browserSessionPersistence, indexedDBLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, push, update, get, onValue, query, orderByChild, startAt,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import {
  initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js';
import { getFirebaseConfig, isConfigured, appCheckSettings, getEnvironment } from './firebase-config.js';

export const firebaseConfig = getFirebaseConfig();
export const configured = isConfigured(firebaseConfig);
export const environment = getEnvironment();

export let app = null;
export let auth = null;
export let db = null;
export let appCheckEnabled = false;

if (configured) {
  app = initializeApp(firebaseConfig);

  // App Check must be initialised before other services make requests.
  if (appCheckSettings.siteKey) {
    try {
      if (environment === 'development' && appCheckSettings.debugTokenOnLocalhost) {
        // Prints a debug token in the console that you register in the Firebase console.
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      const provider = appCheckSettings.provider === 'recaptcha-enterprise'
        ? new ReCaptchaEnterpriseProvider(appCheckSettings.siteKey)
        : new ReCaptchaV3Provider(appCheckSettings.siteKey);
      initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
      appCheckEnabled = true;
    } catch (err) {
      console.warn('[App Check] initialisation failed — continuing without it.', err);
    }
  }

  auth = getAuth(app);
  db = getDatabase(app);
}

export {
  onAuthStateChanged, onIdTokenChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  setPersistence, browserSessionPersistence, indexedDBLocalPersistence,
  ref, push, update, get, onValue, query, orderByChild, startAt,
};
