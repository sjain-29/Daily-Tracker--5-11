// js/charts.js — Chart.js helpers themed from CSS variables. Chart.js is loaded as a vendored UMD script.

import { h } from './utils.js';

export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    text: v('--text-2'), faint: v('--text-3'), grid: v('--border'), accent: v('--accent'), accentRgb: v('--accent-rgb'),
    accent2: v('--accent-2'), success: v('--success'), warning: v('--warning'), danger: v('--danger'), orange: v('--orange'),
    surface: v('--surface-solid'), track: v('--ring-track'),
  };
}

/** A per-view group of charts: first render animates, later refreshes redraw instantly. */
export function chartGroup() {
  let charts = [];
  let animated = false;
  return {
    add(canvas, config) {
      if (!window.Chart) {
        canvas.replaceWith(h('div', { class: 'empty compact' }, h('p', {}, 'Charts are unavailable (Chart.js failed to load).')));
        return null;
      }
      const p = palette();
      const C = window.Chart;
      C.defaults.font.family = getComputedStyle(document.body).fontFamily;
      C.defaults.font.size = 11.5;
      C.defaults.color = p.text;
      C.defaults.borderColor = p.grid;
      const base = {
        responsive: true, maintainAspectRatio: false,
        animation: animated ? false : { duration: 650, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false, labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14 } },
          tooltip: {
            backgroundColor: p.surface, titleColor: p.text, bodyColor: p.text, borderColor: p.grid, borderWidth: 1,
            padding: 10, cornerRadius: 10, boxPadding: 4, usePointStyle: true,
          },
        },
      };
      const cfg = { ...config, options: deepMerge(base, config.options || {}) };
      const chart = new C(canvas, cfg);
      charts.push(chart);
      return chart;
    },
    destroyAll() { charts.forEach((c) => c.destroy()); charts = []; },
    markRendered() { animated = true; },
  };
}

export function axes({ stacked = false, yPrecision = 0, horizontal = false, showGridX = false } = {}) {
  const p = palette();
  const cat = { grid: { display: showGridX, color: p.grid }, border: { display: false }, ticks: { color: p.faint, maxRotation: 0, autoSkipPadding: 10 }, stacked };
  const val = { grid: { color: p.grid }, border: { display: false }, ticks: { color: p.faint, precision: yPrecision, maxTicksLimit: 5 }, beginAtZero: true, stacked };
  return horizontal ? { x: val, y: cat } : { x: cat, y: val };
}

export function gradientFill(canvas, rgb, alphaTop = 0.35) {
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 200);
  g.addColorStop(0, `rgba(${rgb}, ${alphaTop})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  return g;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !(v instanceof CanvasGradient) ? deepMerge(a[k], v) : v;
  }
  return out;
}
