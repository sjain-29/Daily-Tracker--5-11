// js/theme.js — applies appearance settings (theme, accent, wallpaper, glass) to the document.

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let current = null;

export function resolveTheme(theme) {
  if (theme === 'auto') return media && media.matches ? 'light' : 'dark';
  return theme === 'light' ? 'light' : 'dark';
}

export function applyAppearance(settings = {}) {
  current = settings;
  const root = document.documentElement;
  const theme = resolveTheme(settings.theme || 'dark');
  root.dataset.theme = theme;
  root.dataset.accent = settings.accent || 'blue';
  root.dataset.wallpaper = settings.wallpaper || 'aurora';
  root.dataset.glass = settings.glass || 'tinted';
  root.dataset.reduceTransparency = settings.reduceTransparency ? 'true' : 'false';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef1f6' : '#06070b');
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// Follow the operating system when the theme is set to "auto".
media?.addEventListener?.('change', () => { if (current && current.theme === 'auto') applyAppearance(current); });
