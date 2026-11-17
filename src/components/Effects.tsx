'use client';

import { useEffect } from 'react';
import { isPerfMode, onPerfMode, togglePerfMode, toggleTheme, usePerfMode, useTheme } from '@/lib/prefs';

const CARD_SELECTOR =
  '.card, .stat-card, .panel-card, .signup-form, .challenge-card, .leaderboard-card, .modal-content, .submission-card, .challenge-details-card, .login-card';

/**
 * Cursor spotlight + ring and per-card hover lighting. Fully stops (no rAF,
 * no listeners) while performance mode is on. Returns a cleanup function.
 */
function startCursorLighting(): () => void {
  const RING_SIZE = 32; // must match the CSS width/height
  const HALF = RING_SIZE / 2;

  const ensure = (id: string, className: string) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = className;
      document.body.appendChild(el);
    }
    return el;
  };
  const spotlight = ensure('cursor-spotlight-layer', 'cursor-spotlight-layer');
  const ring = ensure('cursor-light-ring', 'cursor-light-ring');

  let visible = false;
  let targetX = -200;
  let targetY = -200;
  let currentX = -200;
  let currentY = -200;
  let rafId: number | null = null;

  const tick = () => {
    if (isPerfMode()) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
    currentX += (targetX - currentX) * 0.18;
    currentY += (targetY - currentY) * 0.18;
    ring.style.transform = `translate3d(${currentX - HALF}px, ${currentY - HALF}px, 0)`;
  };

  const onMouseMove = (e: MouseEvent) => {
    targetX = e.clientX;
    targetY = e.clientY;
    document.documentElement.style.setProperty('--mouse-x', `${targetX}px`);
    document.documentElement.style.setProperty('--mouse-y', `${targetY}px`);
    if (!visible) {
      spotlight.style.opacity = '1';
      ring.style.opacity = '1';
      visible = true;
    }
  };

  const hide = () => {
    spotlight.style.opacity = '0';
    ring.style.opacity = '0';
    visible = false;
  };

  // One delegated listener instead of one per card + a MutationObserver.
  const onCardMove = (e: MouseEvent) => {
    const card = (e.target as Element | null)?.closest?.<HTMLElement>(CARD_SELECTOR);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--card-mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--card-mouse-y', `${e.clientY - rect.top}px`);
  };

  const start = () => {
    if (rafId == null) rafId = requestAnimationFrame(tick);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mousemove', onCardMove, { passive: true });
    document.addEventListener('mouseleave', hide);
  };

  const stop = () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mousemove', onCardMove);
    document.removeEventListener('mouseleave', hide);
    hide();
  };

  const off = onPerfMode((perfOn) => (perfOn ? stop() : start()));
  return () => {
    off();
    stop();
  };
}

/** Anti-tamper guards carried over from the static site (right-click, devtools keys). */
function startSecurityGuards(): () => void {
  const onContextMenu = (e: MouseEvent) => e.preventDefault();
  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (
      e.key === 'F12' ||
      (mod && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
      (mod && e.key.toLowerCase() === 'u')
    ) {
      e.preventDefault();
    }
  };
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
  };
}

/** Mounted once in the root layout: background, cursor lighting, perf toggle. */
export function Effects() {
  useEffect(() => {
    const stopCursor = startCursorLighting();
    const stopGuards = startSecurityGuards();
    // The WebGL starfield is loaded after hydration so it never blocks the page.
    void import('@/legacy/galaxy-bg').then((m) => m.startGalaxy());
    return () => {
      stopCursor();
      stopGuards();
    };
  }, []);

  return <PerfToggle />;
}

function PerfToggle() {
  const on = usePerfMode();
  return (
    <button
      type="button"
      data-perf-toggle=""
      aria-pressed={on}
      title={on ? 'Performance mode ON - click to disable' : 'Performance mode OFF - click to enable'}
      onClick={togglePerfMode}
      suppressHydrationWarning
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9970,
        fontFamily: 'var(--font-meta, monospace)',
        fontSize: 15,
        fontWeight: 'bold',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-strong, #fff)',
        background: 'var(--bg-panel, #1a1a22)',
        border: '2px solid var(--line, #555)',
        borderRadius: 6,
        boxShadow: '4px 4px 0 var(--line, #333)',
        padding: '12px 20px',
        cursor: 'pointer',
      }}
    >
      {on ? 'PERFORMANCE MODE: ON' : 'PERFORMANCE MODE: OFF'}
    </button>
  );
}

export function ThemeToggle({ fixed = false }: { fixed?: boolean }) {
  const isLight = useTheme() === 'light';
  return (
    <button
      className={fixed ? 'theme-toggle theme-toggle-fixed' : 'theme-toggle'}
      type="button"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={toggleTheme}
      suppressHydrationWarning
    >
      {isLight ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
    </button>
  );
}
