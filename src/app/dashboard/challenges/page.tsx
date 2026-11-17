'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/Providers';
import { allChallengesQuery } from '@/lib/queries';
import { epochHue, hueStyle } from '@/lib/utils';
import type { Challenge } from '@/types/db';

const MISC_KEY = '__misc__';

interface Group {
  key: string;
  name: string;
  hue: number;
  challenges: Challenge[];
}

/** Group challenges by category; uncategorized ones land in "Misc" (pinned last). */
function buildGroups(challenges: Challenge[]): Group[] {
  const map = new Map<string, Group>();
  for (const challenge of challenges) {
    const cat = challenge.challenge_categories ?? null;
    const key = cat ? cat.slug : MISC_KEY;
    let group = map.get(key);
    if (!group) {
      group = { key, name: cat ? cat.name : 'Misc', hue: cat?.slug ? epochHue(cat.slug) : 25, challenges: [] };
      map.set(key, group);
    }
    group.challenges.push(challenge);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === MISC_KEY) return 1;
    if (b.key === MISC_KEY) return -1;
    return a.name.localeCompare(b.name);
  });
}

export default function ChallengesPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const target = useSearchParams().get('target');
  const [active, setActive] = useState('all');
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const { data, error, isPending } = useQuery(allChallengesQuery(supabase));
  const groups = useMemo(() => buildGroups(data ?? []), [data]);
  const visible = active === 'all' ? groups : groups.filter((g) => g.key === active);
  const activeHue = groups.find((g) => g.key === active)?.hue;

  // Deep link from elsewhere (?target=<challenge id>): scroll to it and highlight briefly.
  useEffect(() => {
    if (!target || !data) return;
    const card = document.querySelector(`[data-id="${CSS.escape(target)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(target);
    const timer = setTimeout(() => setHighlighted(null), 3000);
    return () => clearTimeout(timer);
  }, [target, data]);

  const open = (id: string) => router.push(`/dashboard/submit?id=${encodeURIComponent(id)}`);

  return (
    <>
      <section className="challenges-page-header">
        <span className="section-badge">Challenge Archive</span>
        <h2 className="section-title">All Challenges</h2>
        <p className="section-subtitle">
          All challenges grouped by category and difficulty. A new one is published every month.
        </p>
      </section>

      <div className="category-tabs" id="category-tabs" style={activeHue != null ? hueStyle(activeHue) : undefined}>
        <button
          type="button"
          className={active === 'all' ? 'category-tab active' : 'category-tab'}
          onClick={() => setActive('all')}
        >
          All
        </button>
        {groups.map((group) => (
          <button
            key={group.key}
            type="button"
            className={active === group.key ? 'category-tab active' : 'category-tab'}
            onClick={() => setActive(group.key)}
          >
            {group.name}
          </button>
        ))}
      </div>

      <div id="challenges-archive">
        {isPending && <div className="loading-state">Loading challenges...</div>}
        {error && <div className="loading-state">Failed to load challenges: {error.message}</div>}
        {data && data.length === 0 && (
          <div className="loading-state">The archive is empty. No challenges yet.</div>
        )}

        {visible.map((group) => (
          <section className="category-section" key={group.key} style={hueStyle(group.hue)}>
            <div className="category-header">
              <span className="category-name">{group.name}</span>
              <span className="category-count">
                {group.challenges.length} challenge{group.challenges.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="challenges-grid">
              {group.challenges.map((challenge) => {
                const archived = !challenge.is_active;
                const tags = (challenge.tags ?? '').split(/\s+/).filter(Boolean);
                const className = [
                  'challenge-card',
                  archived ? 'card-archived' : '',
                  highlighted === challenge.id ? 'highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div
                    key={challenge.id}
                    className={className}
                    data-id={challenge.id}
                    // Active cards are keyboard-operable, not just clickable.
                    role={archived ? undefined : 'link'}
                    tabIndex={archived ? undefined : 0}
                    onClick={archived ? undefined : () => open(challenge.id)}
                    onKeyDown={
                      archived
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter') open(challenge.id);
                          }
                    }
                  >
                    <div className="card-top">
                      <span className="card-badge">{challenge.month_year || 'Month'}</span>
                      <span className="card-points">+{challenge.points_worth ?? 100} pts</span>
                    </div>
                    <h3>{challenge.title}</h3>
                    <p className="challenge-desc">
                      {(challenge.instructions || '').replace(/\s+/g, ' ').trim().slice(0, 140)}
                    </p>
                    {tags.length > 0 && (
                      <div className="card-tags">
                        {tags.map((t) => (
                          <span className="card-tag" key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                    <span className="enter-link">{archived ? 'Archived Month' : 'Submit Solution →'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
