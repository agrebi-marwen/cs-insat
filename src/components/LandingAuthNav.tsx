'use client';

import { useSupabase } from '@/components/Providers';

/** Signed-in state of the landing navbar: profile link + log out. */
export function LandingAuthNav({ username, points }: { username: string; points: number }) {
  const supabase = useSupabase();

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div id="user-nav-container" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
      <a
        href="/dashboard/dashboard"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: 19,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-strong)',
          textDecoration: 'none',
          borderBottom: '2px dashed var(--neon-cyan)',
          paddingBottom: 2,
        }}
      >
        🕒 {username} ({points} pts)
      </a>
      <button
        id="logout-btn"
        type="button"
        onClick={logout}
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: 17,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'var(--bg-panel)',
          border: '2px solid var(--line)',
          boxShadow: 'var(--shadow-hard-sm)',
          color: 'var(--neon-red)',
          padding: '4px 14px',
          cursor: 'pointer',
        }}
      >
        Log Out
      </button>
    </div>
  );
}
