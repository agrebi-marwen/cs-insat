'use client';

// Theme + performance-mode preferences, persisted in localStorage and exposed
// as tiny external stores for React (useSyncExternalStore).
//
// The initial values are applied before first paint by the inline script in
// app/layout.tsx; these stores read them back from <html>.

import { useSyncExternalStore } from 'react';
import { PERF_KEY, THEME_KEY } from '@/lib/boot-script';

export type Theme = 'dark' | 'light';

type Listener = () => void;
const themeListeners = new Set<Listener>();
const perfListeners = new Set<Listener>();

declare global {
  interface Window {
    __PERF_MODE?: boolean;
    // Read by the legacy galaxy background module.
    perfMode?: { on: (cb: (enabled: boolean) => void) => () => void };
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the preference then lasts for the page.
  }
}

// ---- Theme ------------------------------------------------------------------

function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function toggleTheme(): void {
  const next: Theme = getTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  store(THEME_KEY, next);
  themeListeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    getTheme,
    () => 'dark',
  );
}

// ---- Performance mode ---------------------------------------------------------

export function isPerfMode(): boolean {
  return typeof window !== 'undefined' && window.__PERF_MODE === true;
}

/** Subscribe to perf-mode changes; the callback also fires once immediately. */
export function onPerfMode(cb: (enabled: boolean) => void): () => void {
  const listener = () => cb(isPerfMode());
  perfListeners.add(listener);
  listener();
  return () => perfListeners.delete(listener);
}

export function togglePerfMode(): void {
  const next = !isPerfMode();
  window.__PERF_MODE = next;
  document.documentElement.classList.toggle('perf-mode', next);
  store(PERF_KEY, next ? '1' : '0');
  perfListeners.forEach((l) => l());
}

export function usePerfMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      perfListeners.add(l);
      return () => perfListeners.delete(l);
    },
    isPerfMode,
    () => false,
  );
}

if (typeof window !== 'undefined') {
  window.__PERF_MODE = document.documentElement.classList.contains('perf-mode');
  window.perfMode = { on: onPerfMode };
}
