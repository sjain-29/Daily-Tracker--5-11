// js/constants.js — fixed option lists, colours and defaults shared across the app.

export const APP_NAME = 'Flightdeck';
export const APP_VERSION = '1.0.0';

export const TASK_CATEGORIES = [
  { name: 'Office Work', color: '#94a3b8', icon: 'briefcase' },
  { name: 'R&D', color: '#a78bfa', icon: 'flask-conical' },
  { name: 'EW Drone', color: '#22d3ee', icon: 'radar' },
  { name: 'EM Drone', color: '#60a5fa', icon: 'zap' },
  { name: 'Hardware Integration', color: '#fb923c', icon: 'cpu' },
  { name: 'Software Development', color: '#34d399', icon: 'hash' },
  { name: 'Testing & Validation', color: '#f472b6', icon: 'target' },
  { name: 'Documentation', color: '#facc15', icon: 'file-text' },
  { name: 'Meetings', color: '#e879f9', icon: 'users' },
  { name: 'Procurement', color: '#fb7185', icon: 'inbox' },
  { name: 'Personal', color: '#a3e635', icon: 'user' },
  { name: 'Other', color: '#a8a29e', icon: 'layers' },
];

export const PROJECT_CATEGORIES = [
  'EW Drone', 'EM Drone', 'R&D', 'Product Development (NPD)', 'Hardware Integration',
  'Software Development', 'Testing & Validation', 'Documentation & Compliance',
  'Procurement', 'Office Work', 'Personal', 'Other',
];

export const PRIORITIES = [
  { name: 'Critical', color: '#ef4444', rank: 0 },
  { name: 'High', color: '#f97316', rank: 1 },
  { name: 'Medium', color: '#60a5fa', rank: 2 },
  { name: 'Low', color: '#94a3b8', rank: 3 },
];

export const TASK_STATUSES = [
  { name: 'Not Started', color: '#94a3b8', key: 'not-started' },
  { name: 'In Progress', color: '#3b82f6', key: 'in-progress' },
  { name: 'On Hold', color: '#a78bfa', key: 'on-hold' },
  { name: 'Completed', color: '#22c55e', key: 'completed' },
  { name: 'Cancelled', color: '#6b7280', key: 'cancelled' },
];

export const KANBAN_COLUMNS = ['Not Started', 'In Progress', 'On Hold', 'Completed'];

export const PROJECT_STATUSES = [
  { name: 'Planning', color: '#94a3b8' },
  { name: 'Active', color: '#3b82f6' },
  { name: 'On Hold', color: '#a78bfa' },
  { name: 'Completed', color: '#22c55e' },
  { name: 'Cancelled', color: '#6b7280' },
];

export const PROJECT_COLORS = ['#3b82f6', '#8b5cf6', '#22d3ee', '#22c55e', '#f59e0b', '#f97316', '#ec4899', '#ef4444', '#14b8a6', '#a3e635'];

export const NOTE_TYPES = [
  { key: 'quick', name: 'Quick note', color: '#94a3b8', icon: 'sticky-note' },
  { key: 'technical', name: 'Technical observation', color: '#22d3ee', icon: 'wrench' },
  { key: 'rnd', name: 'R&D observation', color: '#a78bfa', icon: 'flask-conical' },
  { key: 'idea', name: 'Idea', color: '#facc15', icon: 'lightbulb' },
  { key: 'reminder', name: 'Important reminder', color: '#f97316', icon: 'bell-ring' },
];

export const RECURRENCE_OPTIONS = [
  { key: 'none', name: 'Does not repeat' },
  { key: 'daily', name: 'Daily' },
  { key: 'weekdays', name: 'Every weekday (Mon–Fri)' },
  { key: 'weekly', name: 'Weekly' },
  { key: 'monthly', name: 'Monthly' },
  { key: 'custom', name: 'Custom interval…' },
];

export const ACCENTS = [
  { key: 'blue', name: 'Electric blue', color: '#3b82f6' },
  { key: 'violet', name: 'Violet', color: '#8b5cf6' },
  { key: 'pink', name: 'Pink', color: '#ec4899' },
  { key: 'orange', name: 'Orange', color: '#f97316' },
  { key: 'green', name: 'Green', color: '#22c55e' },
  { key: 'graphite', name: 'Graphite', color: '#94a3b8' },
];

export const WALLPAPERS = [
  { key: 'midnight', name: 'Midnight' },
  { key: 'aurora', name: 'Aurora' },
  { key: 'tide', name: 'Tide' },
  { key: 'dusk', name: 'Dusk' },
  { key: 'ember', name: 'Ember' },
  { key: 'grove', name: 'Grove' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',            // 'dark' | 'light' | 'auto'
  accent: 'blue',
  wallpaper: 'aurora',
  glass: 'tinted',          // 'tinted' | 'clear'
  reduceTransparency: false,
  sidebarCollapsed: false,
  weekStartsOn: 1,          // 1 = Monday, 0 = Sunday
  dailyFocusGoalMin: 120,
  focus: Object.freeze({ focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, sound: true, autoStartBreaks: false }),
  notifications: Object.freeze({
    enabled: false, dueToday: true, upcoming: true, overdue: true,
    meetings: true, reminders: true, focus: true, meetingLeadMin: 10,
  }),
});

export const MOTIVATION = [
  "Let's make today productive.",
  'Small steps every day add up to big launches.',
  'Clear the critical path first — the rest follows.',
  'One focused hour beats a scattered afternoon.',
  'Test early, document as you go, ship with confidence.',
  'Progress over perfection. Keep the prototype moving.',
  'Protect your focus time like a flight window.',
  'Close one loop before you open the next.',
  'Good coordination is invisible — until it is missing.',
  'Today is a good day to unblock someone.',
  'Plan the work, then work the plan.',
  'Finish strong: review, update, follow up.',
];

/** Suggested starter content offered (never auto-created) in the Quick start dialog. */
export const SUGGESTED_PROJECTS = [
  { name: 'EW Drone Prototype Development', code: 'EW-PROTO', category: 'EW Drone' },
  { name: 'EM Drone Integration', code: 'EM-INT', category: 'EM Drone' },
  { name: 'Flight Controller Testing', code: 'FC-TEST', category: 'Testing & Validation' },
  { name: 'Payload Integration', code: 'PAYLOAD', category: 'Hardware Integration' },
  { name: 'Drone Endurance Testing', code: 'ENDURE', category: 'Testing & Validation' },
  { name: 'Documentation & Compliance', code: 'DOCS', category: 'Documentation & Compliance' },
];

export const SUGGESTED_ROUTINES = [
  { title: 'Daily R&D review', category: 'R&D', freq: 'weekdays', priority: 'Medium' },
  { title: 'Daily project status update', category: 'Office Work', freq: 'weekdays', priority: 'High' },
  { title: 'Weekly team meeting', category: 'Meetings', freq: 'weekly', priority: 'Medium' },
  { title: 'Weekly prototype review', category: 'R&D', freq: 'weekly', priority: 'High' },
  { title: 'Monthly reporting', category: 'Documentation', freq: 'monthly', priority: 'High' },
];

export const LIMITS = Object.freeze({
  title: 200, description: 5000, notes: 20000, tag: 40, tags: 20, name: 120, code: 30,
  noteBody: 50000, agenda: 10000, participant: 80, participants: 50, actionItem: 500, location: 300,
});

export const categoryColor = (name) => (TASK_CATEGORIES.find((c) => c.name === name) || TASK_CATEGORIES[TASK_CATEGORIES.length - 1]).color;
export const priorityInfo = (name) => PRIORITIES.find((p) => p.name === name) || PRIORITIES[2];
export const statusInfo = (name) => TASK_STATUSES.find((s) => s.name === name) || TASK_STATUSES[0];
export const projectStatusInfo = (name) => PROJECT_STATUSES.find((s) => s.name === name) || PROJECT_STATUSES[0];
export const noteTypeInfo = (key) => NOTE_TYPES.find((t) => t.key === key) || NOTE_TYPES[0];

/** Project categories map to the closest task-category colour so the timeline stays consistent. */
export function projectCategoryColor(cat) {
  const map = {
    'Product Development (NPD)': '#a78bfa',
    'Documentation & Compliance': '#facc15',
  };
  return map[cat] || categoryColor(cat);
}
