// js/quick-start-data.js — re-exports starter template data and a label helper.
export { SUGGESTED_PROJECTS, SUGGESTED_ROUTINES, PROJECT_COLORS } from './constants.js';
import { describeRecurrence } from './task-logic.js';
export const describeFreq = (freq) => describeRecurrence({ freq, interval: 1 });
