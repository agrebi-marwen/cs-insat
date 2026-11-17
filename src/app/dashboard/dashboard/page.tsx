'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef } from 'react';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { unwrap, useSupabase } from '@/components/Providers';
import { Segments, StaticSegments } from '@/components/Segments';
import { activeChallengesQuery, FRESH, mySubmissionsQuery, type MySubmission } from '@/lib/queries';
import { formatDate, getRank, parseMonthYear } from '@/lib/utils';
import type { Challenge } from '@/types/db';

interface Latest {
  status: string | null;
  ts: number;
}

/** Most recent submission status per challenge. */
function latestByChallenge(submissions: MySubmission[]): Record<string, Latest> {
  const map: Record<string, Latest> = {};
  for (const s of submissions) {
    const ts = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
    const cur = map[s.challenge_id];
    if (!cur || ts > cur.ts) map[s.challenge_id] = { status: s.status, ts };
  }
  return map;
}

function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    case 'PENDING': return 'Pending Review';
    default: return 'Not Started';
  }
}

function statusClass(status: string | null | undefined): string {
  if (status === 'APPROVED') return 'ok';
  if (status === 'REJECTED') return 'warn';
  return '';
}

interface Registry {
  categories: { id: string; name: string }[];
  workshops: { id: string; category_id: string | null }[];
  roadmaps: { id: string; title: string }[];
  steps: { id: string; roadmap_id: string }[];
  members: number | null;
}

export default function DashboardPage() {
  const supabase = useSupabase();
  const { userId, profile } = useDashboard();

  const points = profile.total_points ?? 0;
  const rank = getRank(points);

  const challengesQ = useQuery(activeChallengesQuery(supabase));
  const submissionsQ = useQuery(mySubmissionsQuery(supabase, userId));

  const solvedQ = useQuery({
    queryKey: ['solved-count', userId],
    ...FRESH,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('submissions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'APPROVED');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  // All catalog counts load in parallel and independently of the user's data.
  const registryQ = useQuery({
    queryKey: ['registry'],
    queryFn: async (): Promise<Registry> => {
      // One failing table must not blank the whole panel: fall back to empty.
      const soft = <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
        unwrap<T | null>(q).catch(() => null);
      const [categories, workshops, roadmaps, steps, members] = await Promise.all([
        soft<Registry['categories']>(supabase.from('workshop_categories').select('id, name').order('name')),
        soft<Registry['workshops']>(supabase.from('workshops').select('id, category_id')),
        soft<Registry['roadmaps']>(supabase.from('roadmaps').select('id, title')),
        soft<Registry['steps']>(supabase.from('roadmap_steps').select('id, roadmap_id')),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);
      return {
        categories: categories ?? [],
        workshops: workshops ?? [],
        roadmaps: roadmaps ?? [],
        steps: steps ?? [],
        members: members.count ?? null,
      };
    },
  });

  const challenges = challengesQ.data ?? [];
  const latest = latestByChallenge(submissionsQ.data ?? []);
  const registry = registryQ.data;
  const activeCount = challengesQ.data ? challenges.length : null;

  // Rank progress (10 cells, with a half cell at the leading edge).
  const SEGMENTS = 10;
  const progress =
    rank.nextMin === null ? 1 : Math.min(1, Math.max(0, (points - rank.min) / (rank.nextMin - rank.min)));
  const filled = Math.round(progress * SEGMENTS);

  // Hidden admin entry: Shift+click the rank 5 times within 1.5 s.
  const clicks = useRef({ count: 0, timer: 0 });
  const onRankClick = (e: React.MouseEvent) => {
    if (!e.shiftKey) return;
    const c = clicks.current;
    c.count += 1;
    window.clearTimeout(c.timer);
    c.timer = window.setTimeout(() => (c.count = 0), 1500);
    if (c.count === 5) {
      c.count = 0;
      window.location.assign('/admin/admin');
    }
  };

  const dash = (value: number | null | undefined) => (value == null ? '–' : value);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of your challenges, learning paths, and activity.</p>
        </div>
      </div>

      <section className="kpi-grid" aria-label="Key metrics">
        <div className="kpi-card kpi-purple">
          <div className="kpi-label">Rank <span className="kpi-options">⋯</span></div>
          <div className="kpi-value" id="stat-rank" onClick={onRankClick}>{rank.name}</div>
          <div className="kpi-sub" id="rank-bar-next">
            {rank.nextMin === null ? 'Highest rank reached' : `${rank.nextMin - points} pts to next rank`}
          </div>
          <div className="kpi-bar" id="rank-bar">
            {Array.from({ length: SEGMENTS }, (_, i) => {
              const on = rank.nextMin === null || i < filled;
              const half = rank.nextMin !== null && i === filled && progress < 1 && filled < SEGMENTS;
              return <span key={i} className={`seg${on ? ' on' : ''}${half ? ' half' : ''}`} />;
            })}
          </div>
        </div>

        <div className="kpi-card kpi-blue">
          <div className="kpi-label">Points <span className="kpi-options">⋯</span></div>
          <div className="kpi-value" id="stat-points">{points} pts</div>
          <div className="kpi-sub">Total accumulated</div>
          <div className="kpi-bar"><StaticSegments on={8} /></div>
        </div>

        <div className="kpi-card kpi-yellow">
          <div className="kpi-label">Challenges Solved <span className="kpi-options">⋯</span></div>
          <div className="kpi-value" id="stat-solved">{solvedQ.data ?? 0}</div>
          <div className="kpi-sub">Approved solutions</div>
          <div className="kpi-bar"><StaticSegments on={3} /></div>
        </div>

        <div className="kpi-card kpi-red">
          <div className="kpi-label">Active Challenges <span className="kpi-options">⋯</span></div>
          <div className="kpi-value" id="stat-missions">{activeCount ?? 0}</div>
          <div className="kpi-sub">Open challenges</div>
          <div className="kpi-bar"><StaticSegments on={2} /></div>
        </div>
      </section>

      <section className="summary-bar" aria-label="Platform summary">
        <SummaryItem hue="#eec643" label="Members" value={dash(registry?.members)} on={7} />
        <SummaryItem hue="#83b5d1" label="Workshops" value={dash(registry?.workshops.length)} on={5} />
        <SummaryItem hue="#345995" label="Roadmaps" value={dash(registry?.roadmaps.length)} on={3} />
        <SummaryItem hue="#fe4e00" label="Active Challenges" value={dash(activeCount)} on={2} />
        <SummaryItem hue="#83b5d1" label="Your Rank" value={rank.name} on={5} />
      </section>

      <section className="lower-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Challenge Progress</h2>
              <div className="panel-sub">Active challenges with your latest submission status</div>
            </div>
          </div>
          <div id="mission-progress" className="mini-list">
            <MissionProgress loading={challengesQ.isPending} challenges={challenges} latest={latest} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Stats by Month</h2>
              <div className="panel-sub">Approved solutions by month</div>
            </div>
          </div>
          <div id="epoch-stats" className="mini-list">
            <EpochStats loading={challengesQ.isPending} challenges={challenges} latest={latest} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Catalog</h2>
            <div className="panel-sub">Live overview of available content</div>
          </div>
          <span className="feed-status"><span className="dot"></span> synced</span>
        </div>

        <div className="reg-stats">
          <div className="reg-stat">
            <div className="rs-num" id="reg-workshops">{dash(registry?.workshops.length)}</div>
            <div className="rs-label">Workshops</div>
          </div>
          <div className="reg-stat">
            <div className="rs-num" id="reg-roadmaps">{dash(registry?.roadmaps.length)}</div>
            <div className="rs-label">Roadmaps</div>
          </div>
          <div className="reg-stat">
            <div className="rs-num" id="reg-steps">{dash(registry?.steps.length)}</div>
            <div className="rs-label">Steps</div>
          </div>
        </div>

        <div className="reg-grid">
          <div className="reg-col">
            <div className="rc-title">Workshops by category</div>
            <div id="reg-by-category" className="mini-list">
              {!registry ? (
                <div className="empty-hint">Loading categories...</div>
              ) : (
                <RegistryRows
                  empty="No workshops yet."
                  items={registry.categories.map((c) => ({
                    name: c.name,
                    count: registry.workshops.filter((w) => w.category_id === c.id).length,
                  }))}
                />
              )}
            </div>
          </div>
          <div className="reg-col">
            <div className="rc-title">Steps per roadmap</div>
            <div id="reg-by-roadmap" className="mini-list">
              {!registry ? (
                <div className="empty-hint">Loading roadmaps...</div>
              ) : (
                <RegistryRows
                  empty="No learning paths yet."
                  items={registry.roadmaps.map((r) => ({
                    name: r.title,
                    count: registry.steps.filter((s) => s.roadmap_id === r.id).length,
                  }))}
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SummaryItem({ hue, label, value, on }: { hue: string; label: string; value: React.ReactNode; on: number }) {
  return (
    <div className="summary-item" style={{ '--si-hue': hue } as React.CSSProperties}>
      <span className="si-label">{label}</span>
      <span className="si-value">{value}</span>
      <div className="si-bar"><StaticSegments on={on} /></div>
    </div>
  );
}

function RegistryRows({ items, empty }: { items: { name: string; count: number }[]; empty: string }) {
  const rows = items.filter((x) => x.count > 0);
  if (rows.length === 0) return <div className="empty-hint">{empty}</div>;
  const max = Math.max(...rows.map((x) => x.count));
  return (
    <>
      {rows.map((x) => (
        <div className="reg-row" key={x.name}>
          <span className="rr-name">{x.name}</span>
          <div className="rr-bar"><Segments pct={Math.round((x.count / max) * 100)} /></div>
          <span className="rr-count">{x.count}</span>
        </div>
      ))}
    </>
  );
}

interface ListProps {
  loading: boolean;
  challenges: Challenge[];
  latest: Record<string, Latest>;
}

function MissionProgress({ loading, challenges, latest }: ListProps) {
  if (loading) return <div className="empty-hint">Loading active challenges...</div>;
  if (challenges.length === 0) return <div className="empty-hint">No active challenges right now.</div>;
  return (
    <>
      {challenges.slice(0, 3).map((challenge) => {
        const entry = latest[challenge.id];
        const status = entry?.status ?? null;
        return (
          <div className="mini-row" key={challenge.id}>
            <span className="mr-icon">◈</span>
            <div className="mr-body">
              <span className="mr-title">{challenge.title}</span>
              <span className="mr-meta">
                {status && entry ? `Last submitted ${formatDate(entry.ts)}` : 'Awaiting first submission'}
              </span>
            </div>
            <span className={`mini-badge ${statusClass(status)}`}>{statusLabel(status)}</span>
            <Link className="mission-link" href={`/dashboard/submit?id=${encodeURIComponent(challenge.id)}`}>
              Open &rarr;
            </Link>
          </div>
        );
      })}
    </>
  );
}

function EpochStats({ loading, challenges, latest }: ListProps) {
  if (loading) return <div className="empty-hint">Loading monthly stats...</div>;

  const epochs = new Map<string, { total: number; approved: number }>();
  for (const challenge of challenges) {
    const month = (challenge.month_year || 'Unknown Month').trim();
    const epoch = epochs.get(month) ?? { total: 0, approved: 0 };
    epoch.total += 1;
    if (latest[challenge.id]?.status === 'APPROVED') epoch.approved += 1;
    epochs.set(month, epoch);
  }

  const months = [...epochs.keys()].sort((a, b) => parseMonthYear(b) - parseMonthYear(a));
  if (months.length === 0) return <div className="empty-hint">No active challenges right now.</div>;

  return (
    <>
      {months.map((month) => {
        const epoch = epochs.get(month)!;
        const pct = epoch.total ? Math.round((epoch.approved / epoch.total) * 100) : 0;
        return (
          <div className="mini-row" key={month}>
            <span className="mr-icon">▶</span>
            <div className="mr-body">
              <span className="mr-title">{month}</span>
              <span className="mr-meta">{epoch.approved}/{epoch.total} approved</span>
            </div>
            <span className="mini-badge">{pct}%</span>
          </div>
        );
      })}
    </>
  );
}
