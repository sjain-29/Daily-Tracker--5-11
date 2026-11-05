# Flightdeck — Personal Productivity & R&D Project Dashboard

A mobile-friendly, installable (PWA) productivity dashboard for an R&D project coordinator: daily office tasks, long-running drone programmes (EW / EM drones, integration, testing, documentation), meetings, notes, focus sessions and analytics — synced in real time through **Firebase Authentication + Realtime Database**, hosted for free on **GitHub Pages**.

Built with plain HTML, CSS and ES-module JavaScript (no framework, no build step), Chart.js for charts and Lucide icons.

---

## Contents

1. [Features](#1-features)
2. [Project structure](#2-project-structure)
3. [Deployment — step by step](#3-deployment--step-by-step)
4. [Security model](#4-security-model)
5. [Database structure](#5-database-structure)
6. [How the automatic flags work](#6-how-the-automatic-flags-work)
7. [Recurring tasks](#7-recurring-tasks)
8. [Offline behaviour and sync](#8-offline-behaviour-and-sync)
9. [Notifications and their limits](#9-notifications-and-their-limits)
10. [Testing](#10-testing)
11. [Updating and customising](#11-updating-and-customising)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Features

| Area | What you get |
|---|---|
| **Dashboard** | Time-based greeting, live clock, date, daily motivation line; Total / Completed / In Progress / Pending cards with % and week-over-week comparison; Overdue, Due today, Due this week and Not-started counters; concentric "Today's progress" rings (tasks · focus · meetings); Pomodoro focus timer; Up next agenda; Today's tasks with one-click completion; Upcoming (next 7 days, approaching deadlines, follow-ups/approvals, overdue); weekly completion chart, 14-day trend, work by project, completed vs pending and priority distribution; quick actions. |
| **Tasks** | Create, edit, delete (with confirmation), duplicate, complete/reopen (with Undo), change status/priority/deadline, add timestamped notes, full details drawer. Fields: title, description, project, category, priority, start date, deadline + optional due time, status, estimated duration, progress, tags, notes, recurrence, reminder. |
| **Views** | List (group by due date / project / status), Kanban (drag-and-drop on desktop, ⋯ move menu on touch), Calendar (month / week / day), Timeline (Gantt). |
| **Search, sort, filter** | Search titles, descriptions, notes, project names/codes and tags. Sort by deadline, priority, creation date, status, project or title. Filter by status, priority, category, project, deadline range and warning flag (Overdue, Not started, Due soon, Due today, This week, Delayed). |
| **Automatic flags** | OVERDUE · DELAYED · DUE SOON · NOT STARTED · UPCOMING — calculated live from dates and status, never stored. See §6. |
| **Projects** | Name, code, description, category, start, target date, status, priority, colour, notes; totals, completed, pending, overdue, auto-calculated completion %, timeline bar; project page with its tasks. Optional one-click starter templates (EW Drone Prototype Development, EM Drone Integration, Flight Controller Testing, Payload Integration, Drone Endurance Testing, Documentation & Compliance). |
| **Notes & Meetings** | Meetings with date/time, location, participants, agenda, discussion notes, action items (convert one or all into linked tasks), follow-up date. Notes typed as Quick note, Technical observation, R&D observation, Idea or Important reminder, with tags, pinning and search. |
| **Analytics** | Completed today / week / month, pending, overdue, average completion time, on-time %, focus hours, completion trend, 12-week completions, productivity by category and by project, priority and status distribution, live flag summary, CSV export. 7D / 30D / 90D / All ranges. All figures come from your own records — there is no sample data. |
| **Focus timer** | 25 / 5 / 15-minute defaults (customisable), long break every N sessions, start / pause / resume / reset / end early, session counter, daily focus time and goal ring, chime with mute, browser notification, sessions saved to Firebase. Keeps running accurately across reloads. |
| **Recurring tasks** | Daily, every weekday, weekly, monthly or custom (every N days/weeks/months). The next occurrence is created when you complete one; history is kept. |
| **Archive** | Archive / restore tasks, projects, notes and meetings; bulk-archive finished tasks older than N days. |
| **Settings** | Name, theme (dark default / light / auto), accent colour, wallpaper, clear/tinted glass, reduce transparency, compact sidebar, week start, timer durations, notification preferences, install button, JSON backup, password reset, sign out. Preferences sync to your account. |
| **PWA** | Installable on Android, iPhone, Windows and macOS; offline app shell; connection indicator; offline changes queued on the device and synced on reconnect. |

Keyboard shortcuts: **N** new task · **/** search · **Esc** close dialogs · **Ctrl/⌘ + Enter** save a form.

---

## 2. Project structure

```
daily-productivity-dashboard/
├── index.html              App shell (protected — redirects to login when signed out)
├── login.html              Sign-in, password reset, first-time setup guidance
├── manifest.json           PWA manifest
├── sw.js                   Service worker (offline shell, caching, notification clicks)
├── database.rules.json     Realtime Database Security Rules  ← deploy these
├── firebase.json           Firebase CLI config (rules deployment only)
├── .firebaserc             Firebase CLI project alias (daily-tasks-1987e)
├── .gitignore              Keeps credentials and tooling files out of git
├── .nojekyll               Tells GitHub Pages to serve files as-is
├── css/
│   ├── themes.css          Design tokens: dark/light, accents, glass, wallpapers
│   ├── style.css           Layout and components
│   └── responsive.css      Tablet and phone layouts
├── js/
│   ├── firebase-config.js  ← the only file you must edit (public web config + App Check site key)
│   ├── firebase.js         Initialises Firebase (SDK version pinned here: 12.19.0)
│   ├── auth.js             Sign-in, sign-out, reset, route guard, error messages
│   ├── database.js         All database reads/writes, listeners, offline journal, cache
│   ├── store.js            In-memory state and change events
│   ├── task-logic.js       Pure rules: flags, recurrence, filters, sorting, statistics
│   ├── app.js              Bootstrap, navigation, router, global actions
│   ├── shared.js           Shared UI state and sign-out
│   ├── ui.js               Modals, toasts, menus, form controls, empty/loading states
│   ├── components.js       Task rows/cards, badges, flags, rings, progress bars
│   ├── task-modal.js       Task form, details drawer, task actions
│   ├── timer.js            Pomodoro engine
│   ├── notifications.js    Reminder checks and browser notifications
│   ├── charts.js           Chart.js theming helpers
│   ├── theme.js / boot-theme.js   Appearance (applied before first paint)
│   ├── pwa.js              Service-worker registration, update prompt, install prompt
│   ├── quick-start*.js     Optional starter templates
│   ├── constants.js        Categories, priorities, statuses, colours, defaults
│   ├── utils.js            Safe DOM builder, dates, formatting, input hygiene
│   ├── icons.js            Lucide icon subset (ISC licence)
│   ├── login.js            Login page logic
│   └── views/              dashboard, tasks, projects, calendar, kanban, timeline,
│                           analytics, notes (& meetings), archive, settings
└── assets/
    ├── icons/              App icons (192, 512, maskable, Apple touch, badge, favicon)
    └── vendor/chart.umd.min.js   Chart.js 4.5.1 (MIT), bundled so charts work offline
```

---

## 3. Deployment — step by step

You need a GitHub account and access to the Firebase project **daily-tasks-1987e** (database: `https://daily-tasks-1987e-default-rtdb.europe-west1.firebasedatabase.app/`). Allow about 20 minutes.

### Step 1 — Create the GitHub repository

1. Go to <https://github.com/new>.
2. Repository name: `daily-productivity-dashboard` (any name works).
3. Choose **Public** (GitHub Pages on a free account requires a public repo; your *data* stays private because it lives in Firebase behind authentication and security rules, not in the repo).
4. Leave "Add a README" unticked and click **Create repository**.

### Step 2 — Upload the project

**Option A — in the browser (no tools needed):**
1. Unzip `daily-productivity-dashboard.zip` on your computer.
2. In the new repository, click **uploading an existing file**.
3. Open the unzipped folder, select **everything inside it** (including `.nojekyll`, `.gitignore`, `.firebaserc` — on macOS press ⌘ + Shift + . to show hidden files; on Windows enable *View → Hidden items*) and drag it into the page.
4. Click **Commit changes**.

**Option B — with git:**
```bash
cd daily-productivity-dashboard
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/daily-productivity-dashboard.git
git push -u origin main
```

You will edit `js/firebase-config.js` in Step 3 — do that before or after uploading (on GitHub you can click the file → ✏️ edit → commit).

### Step 3 — Configure Firebase (web app config)

1. Open <https://console.firebase.google.com> → project **daily-tasks-1987e**.
2. Click ⚙ **Project settings** → **General** → scroll to **Your apps**.
3. If there is no web app yet, click the **</>** (Web) icon, give it a nickname (e.g. "Flightdeck"), leave *Firebase Hosting* unticked, and click **Register app**.
4. Under **SDK setup and configuration**, choose **Config**. You'll see an object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "daily-tasks-1987e.firebaseapp.com",
     databaseURL: "https://daily-tasks-1987e-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "daily-tasks-1987e",
     storageBucket: "daily-tasks-1987e.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123…"
   };
   ```
5. Open `js/firebase-config.js` and replace the three `PASTE_…` placeholders (`apiKey`, `messagingSenderId`, `appId`). Check the other values match too — the database URL is already filled in.
6. Commit the change. These values are **public identifiers** (see §4) — committing them is normal and expected.

> Until this is done, the app shows a "Connect Firebase" setup screen instead of the login form.

### Step 4 — Enable Email/Password sign-in and create your account

1. Firebase Console → **Build → Authentication** → **Get started** (if shown).
2. **Sign-in method** tab → **Email/Password** → enable the first toggle → **Save**. (Leave "Email link (passwordless sign-in)" off.)
3. **Users** tab → **Add user** → enter your email and a strong password → **Add user**.
4. Copy the new user's **User UID** (the long ID in the users table). You need it in Step 5.
5. Recommended: **Settings** tab → **User actions** → untick **Enable create (sign-up)** (if your console shows this option), so nobody can create accounts in your project with the public API key. Even if someone did, an account without a role (Step 5) can't read or write any data.
6. **Settings** tab → **Authorized domains** → **Add domain** → `<your-username>.github.io` (keep `localhost` for local testing).

### Step 5 — Configure the Realtime Database and authorise your account

The database already exists at `…europe-west1.firebasedatabase.app`. Access is granted per user through a `roles` node that **only an administrator can write** (from the console):

1. Firebase Console → **Build → Realtime Database** → **Data** tab.
2. Hover over the root (the database URL) → click **+**.
3. Name: `roles` → click **+** again on the new `roles` row to add a child:
   - Key: *your User UID from Step 4*
   - Value: `owner`
4. Click **Add**. The result looks like:
   ```json
   { "roles": { "Xy12AbC…yourUid": "owner" } }
   ```

The app creates everything under `/users/<your-uid>/…` itself on first sign-in. If you sign in before doing this step, the app shows **"Account not authorised yet"** with your UID and a copy button.

**Adding another person later:** create their account in Authentication → Users, then add `roles/<their-uid>: "member"`. Each person only ever sees their own data.

**Removing someone:** delete their `roles/<uid>` entry (blocks all reads/writes immediately) **and** disable or delete their account in Authentication → Users. An open app notices the role disappearing, switches to the “not authorised” screen and clears its cached data from that device.

### Step 6 — Deploy the database security rules

**Option A — Firebase Console (simplest):**
1. Realtime Database → **Rules** tab.
2. Delete everything in the editor, then paste the full contents of `database.rules.json`.
3. Click **Publish**.
4. Optional check: click **Rules Playground** → Type *read*, Location `/users/anything`, *Authenticated* **off** → **Run** → it must say **Denied**.

**Option B — Firebase CLI:**
```bash
npm install -g firebase-tools        # once
firebase login                       # once
cd daily-productivity-dashboard
firebase use daily-tasks-1987e       # matches .firebaserc
firebase deploy --only database      # uploads database.rules.json
```

> ⚠️ Never leave the database in "test mode" (`".read": true, ".write": true`). The included rules deny everything by default.

### Step 7 — Enable App Check (recommended)

App Check makes Firebase reject requests that don't come from your real web app (scripts, bots, copied configs).

1. Create a reCAPTCHA v3 key at <https://www.google.com/recaptcha/admin/create>:
   - Type: **Score based (v3)**
   - Domains: `<your-username>.github.io` and `localhost`
   - You get a **site key** (public) and a **secret key** (private).
2. Firebase Console → **Build → App Check** → **Apps** → select your web app → **reCAPTCHA** → paste the **secret key** → **Save**. (The secret stays in Firebase — never put it in the code.)
3. In `js/firebase-config.js`, set `appCheckSettings.siteKey` to the **site key** and commit.
4. Leave it in **monitoring** mode for a day or two: App Check → **APIs** → *Realtime Database* shows verified vs unverified requests.
5. When almost all requests are verified, click **Enforce** for *Realtime Database* (and *Authentication*, if your console offers it).
6. For local development with enforcement on: open the app on `http://localhost`, copy the debug token printed in the browser console, and register it under App Check → Apps → ⋮ → **Manage debug tokens**.

> If you enforce App Check before the site key is configured, the app can't reach the database and shows "Can't reach Firebase".

### Step 8 — Publish on GitHub Pages

1. In your repository: **Settings → Pages**.
2. **Build and deployment → Source:** *Deploy from a branch*.
3. **Branch:** `main`, folder **/ (root)** → **Save**.
4. Wait 1–2 minutes and refresh; the site address appears at the top, e.g. `https://<your-username>.github.io/daily-productivity-dashboard/`.
5. Open it, sign in with the account from Step 4, and you'll land on the dashboard.

Every later commit to `main` redeploys automatically. When a new version is live, the open app shows **"A new version is available — Reload"**.

### Step 9 — Install on your phone

**Android (Chrome):** open the site → sign in → tap the **⋮** menu → **Install app** (or **Add to Home screen**). You can also use **Settings → App & offline → Install app** inside Flightdeck.

**iPhone / iPad (Safari):** open the site in **Safari** → tap **Share** (□↑) → **Add to Home Screen** → **Add**. Open it from the Home Screen icon. (On iOS 16.4+, notifications work only for the Home Screen app, not inside Safari.)

**Desktop (Chrome / Edge):** click the install icon in the address bar.

---

## 4. Security model

### What is public and what is secret

| Item | Where it lives | Public? | Notes |
|---|---|---|---|
| `apiKey`, `authDomain`, `projectId`, `databaseURL`, `storageBucket`, `messagingSenderId`, `appId` | `js/firebase-config.js` | **Public** | Identify your project to Google. Every Firebase web app ships them to the browser. They are not passwords. |
| reCAPTCHA **site key** | `js/firebase-config.js` | **Public** | Designed to be embedded in pages. |
| reCAPTCHA **secret key** | Firebase Console (App Check) only | **Secret** | Never in code or git. |
| User passwords | Firebase Authentication only | **Secret** | Never stored or logged by the app. |
| Service-account JSON / Admin SDK credentials | Not used by this app | **Secret** | Grants full admin access. Never put it in this repo (`.gitignore` blocks common file names). GitHub Pages is static hosting and cannot keep server secrets. |

Security does **not** depend on hiding the database URL or API key. It comes from:

1. **Firebase Authentication** — every request carries a signed ID token for your account.
2. **Realtime Database Security Rules** (`database.rules.json`), enforced by Google's servers:
   - Default **deny all** at the root — no public read or write anywhere.
   - `/users/{uid}` readable and writable **only** when `auth.uid == uid` **and** an administrator has created `/roles/{uid}`. One user can never reach another user's data, and listing `/users` is denied.
   - `/roles` is **read-only for everyone** (`.write: false`), so users cannot grant or change their own role; each user can read only their own role entry.
   - Removing a role or deleting the account cuts off access (see Step 5).
   - **Validation** on every field: required fields, types, string lengths, allowed values (status, priority, recurrence, theme…), date `YYYY-MM-DD` and time `HH:MM` formats, number ranges, and `$other: false`, which rejects unknown fields and unknown collections.
3. **App Check** (Step 7) — only your genuine site can talk to the database.

### In the app

- **XSS protection:** all user content is inserted with `textContent` through a small DOM builder (`js/utils.js → h()`), which refuses `innerHTML`. Nothing user-generated is ever parsed as HTML. CSV exports neutralise spreadsheet-formula injection.
- **Content-Security-Policy** in `index.html` / `login.html` only allows scripts from this site, Google's Firebase/reCAPTCHA domains and Firebase database hosts. If you add another service, extend the policy.
- **Input validation** on the client (trimming, control-character stripping, length limits, date checks) **and** on the server (rules).
- **Session handling:** protected pages redirect to login when there's no session; if the session ends while the app is open (signed out elsewhere, account disabled, token revoked) you're returned to the login page with a message. "Keep me signed in" off = the session ends when the browser closes, and no data is cached on the device.
- **Sign-out** removes cached data and the offline queue from the device. If changes made offline haven't synced yet, you're warned first.
- **Optional hardening:** in Google Cloud Console → APIs & Services → Credentials, restrict the browser API key with *HTTP referrers* `https://<your-username>.github.io/*` and `http://localhost/*`.

---

## 5. Database structure

```
/roles
  /{uid}: "owner" | "member"                       ← written only from the Firebase console
/users
  /{uid}
    /profile        { name, email, createdAt, updatedAt }
    /settings       { theme, accent, wallpaper, glass, reduceTransparency, sidebarCollapsed, weekStartsOn,
                      dailyFocusGoalMin, focus:{focusMin, shortMin, longMin, longEvery, sound, autoStartBreaks},
                      notifications:{enabled, dueToday, upcoming, overdue, meetings, reminders, focus, meetingLeadMin},
                      updatedAt }
    /tasks/{pushId} { title*, description, projectId, category*, priority*, status*, startDate, endDate, dueTime,
                      estimatedMinutes, progress, tags[], notes, recurrence:{freq, interval, unit}, reminderAt,
                      archived, archivedAt, createdAt*, updatedAt*, completedAt, startedAt,
                      seriesId, nextOccurrenceId, meetingId }
    /projects/{id}  { name*, code, description, category, startDate, targetDate, status*, priority, notes, color,
                      archived, archivedAt, createdAt*, updatedAt*, completedAt }
    /meetings/{id}  { title*, date*, startTime, endTime, location, projectId, participants[], agenda, notes,
                      actionItems:{ {id}:{ text*, done, dueDate, taskId, createdAt* } },
                      followUpDate, followUpDone, archived, archivedAt, createdAt*, updatedAt* }
    /notes/{id}     { title | body*, type* (quick|technical|rnd|idea|reminder), tags[], pinned, projectId,
                      archived, archivedAt, createdAt*, updatedAt* }
    /focusSessions/{id} { mode*, plannedSec*, actualSec*, startedAt*, endedAt*, date*, taskId }   (indexed on startedAt)
```
`*` = required. IDs are Firebase push IDs. Dates are local calendar dates (`YYYY-MM-DD`); timestamps are epoch milliseconds.

- Every write is a **multi-path `update()`** that touches only the changed fields, so editing one task never overwrites anything else. Related changes are atomic: converting an action item creates the task and links it in one update; deleting a project unassigns (or deletes) its tasks in the same update.
- One listener per collection, scoped to your UID; focus sessions are limited to roughly the last 13 months; all listeners are removed on sign-out.
- **Flags are never stored** — they're recalculated from dates and status every time the screen updates.

---

## 6. How the automatic flags work

Calculated in `js/task-logic.js → computeFlags()` from the current date/time, re-checked every 30 seconds:

| Flag | Rule | Look |
|---|---|---|
| **OVERDUE** | Deadline has passed and status is not Completed/Cancelled. Takes precedence over every other flag. | Red |
| **DELAYED** | Status is *In Progress* and the deadline has passed (shown next to OVERDUE). | Soft red |
| **DUE SOON** | Deadline within the next 24 hours. | Orange |
| **NOT STARTED** | Start date has arrived (from midnight of that day) but status is still *Not Started*. | Amber |
| **UPCOMING** | Deadline within the next 3 calendar days. | Subtle grey |

- The deadline is the end of the deadline date (23:59), or the exact due time if you set one.
- Completed and Cancelled tasks are never flagged; completing a task removes its flags instantly.
- **Flags** (uppercase, square, with an icon) look different from **status pills** (rounded, coloured dot) so you can't confuse the two.

## 7. Recurring tasks

Set **Repeat** under *More options* in the task form. When you complete a recurring task, the app keeps that completed task as history and creates the next one with its dates shifted (start, deadline and reminder). If you complete it late, the series jumps to the next date that isn't already in the past. Reopening and re-completing a task never creates a duplicate (the link is stored as `nextOccurrenceId`). Undo right after completing also removes the copy it created. To stop a series, set Repeat to *Does not repeat* on the latest task.

## 8. Offline behaviour and sync

- The **app shell** (HTML, CSS, JS, icons, Chart.js, Firebase SDK) is cached by the service worker, so the app opens without a connection once you've used it online.
- Your **data** is cached on the device after your first online sign-in (only when "Keep me signed in" is ticked), so the dashboard shows your latest data offline.
- **Changes made offline** (create/edit/complete/delete anything) appear immediately and are saved in an on-device queue (`localStorage`). They're sent to Firebase automatically when the connection returns — **even if you closed or reloaded the app in between**. The top bar shows `Offline · N saved on device` → `Syncing…` → `Synced`.
- Conflicts resolve as **last write wins**: if you edit the same field offline on your phone and online on your laptop, whichever sync reaches Firebase last is kept.
- The first sign-in on a new device needs a connection.

## 9. Notifications and their limits

Turn them on in **Settings → Notifications** (the browser asks for permission). You can choose: tasks due today (one daily summary), approaching deadlines (≤ 24 h), overdue tasks, task reminders, meetings (N minutes before), and focus-session completion. Each event notifies **once per device**, and bursts are grouped into a single summary.

**Be aware:** a website can only run these checks while it is open (in a tab or as an installed app that's running). If the browser or app is fully closed, the phone is asleep or offline, reminders won't fire until you open the app again. On iPhone, notifications require the Home Screen app (iOS 16.4+).

**Background push (optional, not included):** true reminders while the app is closed need **Firebase Cloud Messaging** plus a **server** that decides when to send them, typically a scheduled Cloud Function on the Blaze (pay-as-you-go) plan that scans upcoming deadlines and sends to saved device tokens. GitHub Pages can't run server code or hold the credentials that requires, so it isn't part of this static deployment.

## 10. Testing

How this build was verified before delivery:

- **30 unit tests** of the flag, recurrence, filtering, sorting and statistics logic, run in two time zones.
- **40 security-rule tests** of `database.rules.json` (with the `targaryen` rules simulator): unauthenticated access, missing role, cross-user access, role tampering, field validation, unknown fields, revocation.
- **39 end-to-end browser tests** (Chromium; desktop, iPhone 13 and Pixel 7 emulation) running the real app against a stand-in Firebase backend that enforces the same rules file, including:
  1. No dashboard access without login (redirect, and back to the requested page after login)
  2. Create, edit, duplicate and delete (with confirmation)
  3. A task turning OVERDUE + DELAYED automatically when its due time passes
  4. NOT STARTED flag once the start date arrives
  5. Completing a task removes its overdue flag (and Undo restores it)
  6. Kanban drag-and-drop and status changes moving cards
  7. Dashboard counts updating automatically
  8. Project completion % updating automatically
  9. Data still there after sign-out and sign-in
  10. Unauthenticated reads and writes denied
  11. Reading or writing another user's data, or your own role, denied
  12. Phone layouts fit the screen with no sideways scrolling
  13. Offline changes surviving a reload and syncing on reconnect
  …plus recurring tasks, meetings → tasks, focus sessions, theme sync, XSS attempts, the "not authorised" screen, and the service worker serving the app offline.

The stand-in backend can't reproduce every behaviour of Google's servers, so after deploying run this **2-minute check on your live site**:

1. Open the site in a private window → you land on the sign-in page.
2. Sign in → add a task with a deadline of yesterday → it shows **OVERDUE** → tick it → the flag disappears.
3. Firebase Console → Realtime Database → **Data** → your task appears under `users/<uid>/tasks`.
4. Rules Playground: unauthenticated read of `/users/<your-uid>` → **Denied**.
5. On your phone: turn on airplane mode → add a task → turn airplane mode off → it appears on your laptop.

## 11. Updating and customising

- **Releasing changes:** commit to `main`. If you add or rename files, add them to the `SHELL` list in `sw.js`; for every release, bump `VERSION` in `sw.js` so phones pick up the new version.
- **App name:** `APP_NAME` in `js/constants.js`, the `<title>` / `apple-mobile-web-app-title` tags in both HTML files, and `name`/`short_name` in `manifest.json`.
- **Categories, priorities, statuses, colours, starter templates:** `js/constants.js`. If you add a *status*, *priority* or *note type*, add it to the matching allowed values in `database.rules.json` and re-publish the rules. New *categories* need no rule change.
- **Firebase SDK version:** the import URLs in `js/firebase.js` and the `SDK` list in `sw.js`.
- **Separate development project:** set `development` in `js/firebase-config.js`; it's used automatically on `localhost`.
- **Run locally:** any static server works, e.g. `python3 -m http.server 8080` in the project folder, then open <http://localhost:8080>. ES modules and service workers don't work from `file://`.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| "Connect Firebase" screen | Fill in the `PASTE_…` values in `js/firebase-config.js` and redeploy. |
| "Incorrect email or password" for the right password | Check the user exists in Authentication → Users, and that Email/Password is enabled. |
| "Account not authorised yet" | Add `roles/<your-uid>: "owner"` in Realtime Database → Data (Step 5). |
| "Can't reach Firebase" / stuck loading | Check internet; check `databaseURL`; if App Check is enforced, make sure the site key is set and the domain is registered with reCAPTCHA. |
| "Couldn't save … permission" toasts | Rules not published, role missing, or your session expired; sign in again. |
| Changes don't appear on the live site | GitHub Pages takes 1–2 minutes; then reload. If an old version sticks, bump `VERSION` in `sw.js`. |
| No notifications | Allow notifications for the site in browser settings; on iPhone install to the Home Screen first; keep the app open (§9). |

---

Third-party code: Chart.js 4.5.1 (MIT), Lucide icons (ISC), Firebase JS SDK 12.19.0 loaded from Google's CDN (Apache-2.0), Inter font via Google Fonts (OFL).
