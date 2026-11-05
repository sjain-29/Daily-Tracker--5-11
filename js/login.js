// js/login.js — sign-in page: email/password login, remember me, password reset and setup guidance.

import { configured } from './firebase.js';
import { getCurrentUser, signIn, sendReset, authErrorMessage } from './auth.js';
import { h, clear, storageGet, add } from './utils.js';
import { icon, setBusy } from './ui.js';
import { applyAppearance } from './theme.js';
import { registerServiceWorker } from './pwa.js';

applyAppearance(storageGet('fd-appearance', {}) || {});
const content = document.getElementById('login-content');
const params = new URLSearchParams(location.search);
const next = (() => { const n = params.get('next') || ''; return /^#\/[\w\-/?=&%.,]*$/.test(n) ? n : ''; })();

function goToApp() { location.replace(`index.html${next}`); }

async function init() {
  registerServiceWorker();
  if (!configured) { renderSetup(); return; }
  const user = await getCurrentUser();
  if (user) { goToApp(); return; }
  renderSignIn();
}

function notice(type, text) {
  return h('div', { class: type === 'error' ? 'form-error' : 'form-ok', role: type === 'error' ? 'alert' : 'status' }, text);
}

function renderSignIn(prefillEmail = '') {
  const reason = params.get('reason');
  const banner = reason === 'expired' ? notice('error', 'Your session ended or expired. Please sign in again.')
    : reason === 'signedout' ? notice('ok', 'You’ve been signed out.') : null;
  const msg = h('div');
  const email = h('input', { class: 'input', type: 'email', id: 'email', autocomplete: 'username', inputmode: 'email', required: true, value: prefillEmail, placeholder: 'you@company.com', autofocus: true });
  const password = h('input', { class: 'input', type: 'password', id: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const toggle = h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'Show password', onClick: () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    add(clear(toggle), icon(show ? 'eye-off' : 'eye', { size: 16 }));
  } }, icon('eye', { size: 16 }));
  const remember = h('input', { type: 'checkbox', checked: storageGet('fd-remember', true) !== false });
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'login-form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    clear(msg);
    if (!email.value.trim() || !password.value) { add(msg, notice('error', 'Enter your email and password.')); return; }
    setBusy(submit, true);
    try {
      await signIn(email.value, password.value, remember.checked);
      goToApp();
    } catch (err) {
      setBusy(submit, false);
      add(msg, notice('error', authErrorMessage(err)));
      password.select();
    }
  } },
  h('div', { class: 'field' }, h('label', { class: 'field-label', htmlFor: 'email' }, 'Email'), email),
  h('div', { class: 'field' }, h('label', { class: 'field-label', htmlFor: 'password' }, 'Password'), h('div', { class: 'pw-wrap' }, password, toggle)),
  h('div', { class: 'login-row' },
    h('label', { class: 'check-row' }, remember, h('span', {}, 'Keep me signed in')),
    h('button', { class: 'link-btn', type: 'button', onClick: () => renderReset(email.value) }, 'Forgot password?')),
  msg,
  submit);
  add(clear(content), 
    h('h2', { id: 'login-title' }, 'Welcome back'),
    h('p', { class: 'sub' }, 'Sign in to your workspace.'),
    banner ? h('div', { style: 'margin-bottom:14px' }, banner) : null,
    form,
    h('p', { class: 'login-foot' }, icon('lock', { size: 13 }), 'Private workspace — accounts are created by the administrator.'));
}

function renderReset(prefill = '') {
  const msg = h('div');
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', inputmode: 'email', value: prefill, placeholder: 'you@company.com', autofocus: true });
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Send reset link');
  add(clear(content), 
    h('h2', { id: 'login-title' }, 'Reset password'),
    h('p', { class: 'sub' }, 'We’ll email you a secure link to choose a new password.'),
    h('form', { class: 'login-form', novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      clear(msg);
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { add(msg, notice('error', 'Enter a valid email address.')); return; }
      setBusy(submit, true);
      try {
        await sendReset(email.value);
        // Same message whether or not the account exists, to avoid revealing which emails are registered.
        add(msg, notice('ok', `If an account exists for ${email.value.trim()}, a reset link is on its way. Check your inbox and spam folder.`));
      } catch (err) {
        if (err?.code === 'auth/user-not-found') add(msg, notice('ok', `If an account exists for ${email.value.trim()}, a reset link is on its way.`));
        else add(msg, notice('error', authErrorMessage(err)));
      } finally { setBusy(submit, false); }
    } },
    h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Email'), email), msg, submit),
    h('button', { class: 'link-btn', type: 'button', style: 'margin-top:16px', onClick: () => renderSignIn(email.value) }, '← Back to sign in'));
}

function renderSetup() {
  add(clear(content), 
    h('h2', { id: 'login-title' }, 'Connect Firebase'),
    h('p', { class: 'sub' }, 'One-time setup: this copy of the app doesn’t have your Firebase web configuration yet.'),
    h('ol', { class: 'setup-steps' },
      h('li', {}, 'Open Firebase Console → ⚙ Project settings → General → Your apps → Web app (create one if needed).'),
      h('li', {}, 'Copy the config values (apiKey, appId, messagingSenderId…).'),
      h('li', {}, 'Paste them into ', h('code', {}, 'js/firebase-config.js'), ' and commit/redeploy.'),
      h('li', {}, 'Enable Authentication → Sign-in method → Email/Password, and publish ', h('code', {}, 'database.rules.json'), '.')),
    h('div', { class: 'notice', style: 'margin-top:16px' }, icon('info', { size: 16 }), h('div', {}, 'These config values are public identifiers, not secrets — security comes from Authentication and the database rules. See README.md for the full guide.')));
}

init().catch((err) => { console.error(err); add(clear(content), notice('error', `Couldn’t start: ${err.message}`)); });
