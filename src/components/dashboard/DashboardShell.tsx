'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/Effects';
import { unwrap, useSupabase } from '@/components/Providers';
import type { Profile } from '@/types/db';
import { LeaderboardModal } from './LeaderboardModal';
import { SettingsModal } from './SettingsModal';

interface DashboardContextValue {
  userId: string;
  profile: Profile;
  refreshProfile: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

/** Signed-in user + profile, available to every dashboard page. */
export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('useDashboard must be used inside the dashboard layout');
  return value;
}

const NAV = [
  { href: '/dashboard/dashboard', label: 'Overview', icon: '▶', match: ['/dashboard/dashboard'] },
  { href: '/dashboard/challenges', label: 'Challenges', icon: '◆', match: ['/dashboard/challenges'] },
  { href: '/dashboard/submissions', label: 'Submissions', icon: '◆', match: ['/dashboard/submissions'] },
  {
    href: '/dashboard/roadmaps',
    label: 'Roadmaps',
    icon: '◆',
    match: ['/dashboard/roadmaps', '/dashboard/roadmap', '/dashboard/roadmap-map'],
  },
] as const;

const CRUMBS: Record<string, string> = {
  '/dashboard/dashboard': 'Dashboard',
  '/dashboard/challenges': 'Challenge Archive',
  '/dashboard/submissions': 'My Submissions',
  '/dashboard/submit': 'Submit Solution',
  '/dashboard/roadmaps': 'Roadmaps',
  '/dashboard/roadmap': 'Learning Path',
  '/dashboard/roadmap-map': 'Roadmap',
  '/dashboard/learn': 'Learn',
  '/dashboard/workshops': 'Workshops',
};

interface Props {
  userId: string;
  initialProfile: Profile;
  children: ReactNode;
}

export function DashboardShell({ userId, initialProfile, children }: Props) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [modal, setModal] = useState<'leaderboard' | 'settings' | null>(null);

  // Seeded by the server render, so the name is on screen immediately.
  const { data: profile } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () =>
      unwrap<Profile | null>(
        supabase.from('profiles').select('id, username, total_points').eq('id', userId).maybeSingle(),
      ).then((p) => p ?? initialProfile),
    initialData: initialProfile,
  });

  const crumb = CRUMBS[pathname] ?? 'Dashboard';
  useEffect(() => {
    document.title = `${crumb} · The Time Portal`;
  }, [crumb]);

  const refreshProfile = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
  };

  const logout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    window.location.assign('/');
  };

  const username = profile.username || 'User';

  return (
    <DashboardContext.Provider value={{ userId, profile, refreshProfile }}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="logo">
            <span className="logo-cube">◈</span>
            <span>
              The Time Portal
              <span className="logo-badge">IEEE CS INSAT SBC</span>
            </span>
          </div>

          <nav className="nav-group">
            <span className="nav-group-label">Menu</span>
            {NAV.map((item) => {
              const active = (item.match as readonly string[]).includes(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? 'nav-link active' : 'nav-link'}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-icon">{item.icon}</span> {item.label}
                </Link>
              );
            })}
          </nav>

          <nav className="nav-group">
            <span className="nav-group-label">Account</span>
            <a
              href="#"
              className="nav-link"
              id="open-leaderboard"
              onClick={(e) => {
                e.preventDefault();
                setModal('leaderboard');
              }}
            >
              <span className="nav-icon">▤</span> Leaderboard
            </a>
            <a
              href="#"
              className="nav-link"
              id="open-settings"
              onClick={(e) => {
                e.preventDefault();
                setModal('settings');
              }}
            >
              <span className="nav-icon">◈</span> Settings
            </a>
            <button
              type="button"
              className="nav-link"
              id="logout-btn"
              onClick={logout}
              style={{ background: 'none', borderColor: 'transparent', cursor: 'pointer', width: '100%', textAlign: 'left' }}
            >
              <span className="nav-icon">»</span> Log Out
            </button>
          </nav>

          <div className="sidebar-footer">
            <div className="status-pill"><span className="status-dot"></span> System online</div>
            <div className="status-pill">V. 2.0.0</div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <span className="crumb">
              Home <span className="crumb-sep">/</span>{' '}
              <span className="crumb-cur">{crumb}</span>
            </span>
            <ThemeToggle />
            <div className="user-chip">
              <span className="user-avatar" id="user-avatar">{username.slice(0, 2).toUpperCase()}</span>
              <span className="user-name" id="nav-username">{username}</span>
            </div>
          </header>

          <main className="content">{children}</main>
        </div>
      </div>

      {modal === 'leaderboard' && <LeaderboardModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
    </DashboardContext.Provider>
  );
}
