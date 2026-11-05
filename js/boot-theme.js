/* js/boot-theme.js — classic (non-module) script loaded in <head> so the saved theme is applied
   before first paint, avoiding a flash of the wrong theme. Runs before the app modules load. */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('fd-appearance') || 'null') || {};
    var root = document.documentElement;
    var theme = s.theme || 'dark';
    if (theme === 'auto') theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-accent', s.accent || 'blue');
    root.setAttribute('data-wallpaper', s.wallpaper || 'aurora');
    root.setAttribute('data-glass', s.glass || 'tinted');
    root.setAttribute('data-reduce-transparency', s.reduceTransparency ? 'true' : 'false');
  } catch { /* storage unavailable: defaults from the HTML attributes apply */ }
})();
