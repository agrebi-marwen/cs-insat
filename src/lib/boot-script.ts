// Inline, pre-paint script: applies the stored theme and performance mode to
// <html> before anything renders, so there is no flash of the wrong theme.
// Kept in a server-safe module (no 'use client') so the root layout can inline it.

export const THEME_KEY = 'timeportal_theme';
export const PERF_KEY = 'timeportal_perf';

export const PREFS_BOOT_SCRIPT = `(function(){var r=document.documentElement;try{r.setAttribute('data-theme',localStorage.getItem('${THEME_KEY}')==='light'?'light':'dark');if(localStorage.getItem('${PERF_KEY}')==='1'){r.classList.add('perf-mode');window.__PERF_MODE=true}}catch(e){r.setAttribute('data-theme','dark')}})();`;
