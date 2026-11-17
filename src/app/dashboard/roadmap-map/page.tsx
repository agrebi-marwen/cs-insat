'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { ResourceLinks } from '@/components/dashboard/PathCard';
import { unwrap, useSupabase } from '@/components/Providers';
import { Segments } from '@/components/Segments';
import { Styles } from '@/components/Styles';
import { activeChallengesQuery, FRESH, roadmapQuery } from '@/lib/queries';
import { burstFrom, epochHue, hueStyle, normalizeTag, splitTags } from '@/lib/utils';
import type { Challenge, RoadmapNode } from '@/types/db';

interface UserState {
  /** Deepest unlocked node id for this roadmap, if any. */
  nodeId: string | null;
  /** Normalized tags earned through approved submissions. */
  completedTags: Set<string>;
}

/** Active challenges carrying ANY of the given tags (de-duplicated). */
function challengesForTags(tags: string[], challenges: Challenge[]): Challenge[] {
  if (tags.length === 0) return [];
  const wanted = new Set(tags);
  return challenges.filter((ch) => splitTags(ch.tags).some((t) => wanted.has(t)));
}

export default function RoadmapMapPage() {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userId } = useDashboard();
  const roadmapId = useSearchParams().get('id');
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const roadmapQ = useQuery({ ...roadmapQuery(supabase, roadmapId ?? ''), enabled: !!roadmapId });

  const nodesQ = useQuery({
    queryKey: ['roadmap-nodes', roadmapId],
    enabled: !!roadmapId,
    queryFn: () =>
      unwrap<RoadmapNode[] | null>(
        supabase
          .from('roadmap_nodes')
          .select('id, title, description, required_tags, resources')
          .eq('roadmap_id', roadmapId!)
          .order('position', { ascending: true }),
      ).then((rows) => rows ?? []),
  });

  const activeQ = useQuery(activeChallengesQuery(supabase));

  const stateKey = ['roadmap-user-state', userId, roadmapId];
  const stateQ = useQuery({
    queryKey: stateKey,
    enabled: !!roadmapId,
    ...FRESH,
    queryFn: async (): Promise<UserState> => {
      const [progress, approved] = await Promise.all([
        supabase
          .from('roadmap_node_progress')
          .select('node_id')
          .eq('user_id', userId)
          .eq('roadmap_id', roadmapId!)
          .maybeSingle(),
        supabase.from('submissions').select('challenge_id').eq('user_id', userId).eq('status', 'APPROVED'),
      ]);
      if (progress.error) console.error('Progress load failed:', progress.error);
      if (approved.error) console.error('Approved submissions load failed:', approved.error);

      const ids = [...new Set((approved.data ?? []).map((s) => s.challenge_id as string))];
      const completedTags = new Set<string>();
      if (ids.length > 0) {
        const { data } = await supabase.from('challenges').select('id, tags').in('id', ids);
        for (const ch of data ?? []) splitTags(ch.tags).forEach((t) => completedTags.add(t));
      }
      return { nodeId: (progress.data?.node_id as string | undefined) ?? null, completedTags };
    },
  });

  const roadmap = roadmapQ.data;
  const nodes = nodesQ.data ?? [];
  const hue = roadmap ? epochHue(roadmap.slug) : 25;
  const completedTags = stateQ.data?.completedTags ?? new Set<string>();
  const deepestIndex = stateQ.data?.nodeId ? nodes.findIndex((n) => n.id === stateQ.data!.nodeId) : -1;

  const done = deepestIndex + 1;
  const total = nodes.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const unlock = async (nodeId: string, button: HTMLElement) => {
    if (!roadmapId) return;
    setUnlocking(nodeId);
    const { error } = await supabase
      .from('roadmap_node_progress')
      .upsert({ user_id: userId, roadmap_id: roadmapId, node_id: nodeId }, { onConflict: 'user_id,roadmap_id' });
    if (error) {
      console.error('Unlock failed:', error);
      setUnlocking(null);
      return;
    }
    burstFrom(button, hue);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: stateKey }),
      queryClient.invalidateQueries({ queryKey: ['roadmap-nodes', roadmapId] }),
      queryClient.invalidateQueries({ queryKey: ['roadmap-node-progress', userId] }),
    ]);
    setUnlocking(null);
  };

  let title = 'Loading Roadmap...';
  let description = 'Loading roadmap details...';
  let placeholder: string | null = 'Loading nodes...';
  if (!roadmapId) {
    title = 'Roadmap Not Found';
    description = 'Please return to the Roadmaps page and select a field.';
    placeholder = 'No roadmap selected.';
  } else if (roadmapQ.isError || (roadmapQ.isSuccess && !roadmap)) {
    title = 'Loading Failed';
    description = 'Could not load this roadmap. It may have been removed.';
    placeholder = 'Roadmap not found.';
  } else if (roadmap) {
    title = roadmap.title;
    description = roadmap.description || '';
    if (nodesQ.error) placeholder = `Failed to load nodes: ${nodesQ.error.message}`;
    else if (nodesQ.isPending || stateQ.isPending) placeholder = 'Loading nodes...';
    else placeholder = total === 0 ? 'This field has no nodes yet.' : null;
  }

  return (
    <>
      <Styles sheets={['learn', 'roadmaps']} />
      <section className="roadmap-map-header" id="roadmap-header" style={hueStyle(hue)}>
        <span className="path-badge" id="roadmap-difficulty">{roadmap?.difficulty || 'Field'}</span>
        <h1 className="roadmap-title" id="roadmap-title">{title}</h1>
        <p className="roadmap-subtitle" id="roadmap-description">{description}</p>
        <Link href="/dashboard/roadmaps" className="roadmap-back">← All Roadmaps</Link>
      </section>

      <div className="roadmap-overview" id="roadmap-overview" style={hueStyle(hue)}>
        <span className="roadmap-overview-label">Field Progress</span>
        <div className="learn-progress-bar" id="roadmap-progress-bar">
          <Segments pct={placeholder ? 0 : pct} />
        </div>
        <div className="roadmap-overview-caption" id="roadmap-progress-caption">
          Node {placeholder ? 0 : done}/{placeholder ? 0 : total} unlocked — <strong>{placeholder ? 0 : pct}%</strong>
        </div>
      </div>

      <div id="roadmap-nodes" className="roadmap-map-steps">
        {placeholder ? (
          <div className="loading-state">{placeholder}</div>
        ) : (
          nodes.map((node, index) => {
            const isUnlocked = index <= deepestIndex;
            const isNext = index === deepestIndex + 1;
            const isLocked = index > deepestIndex + 1;

            const rawTags = Array.isArray(node.required_tags) ? node.required_tags : [];
            const required = rawTags.map(normalizeTag);
            const tagsMet = required.length > 0 && required.every((t) => completedTags.has(t));
            const unlockable = isNext && tagsMet;
            const practice = challengesForTags(required, activeQ.data ?? []);

            const className = [
              'roadmap-map-step',
              isUnlocked ? 'is-unlocked' : '',
              isNext ? 'is-next' : '',
              unlockable ? 'is-ready' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div className={className} key={node.id}>
                <div className="roadmap-step-body">
                  <div className="roadmap-step-head">
                    <span className="roadmap-step-num">Node {index + 1}</span>
                    <span className="roadmap-step-title">{node.title}</span>
                    {isUnlocked ? (
                      <span className="node-status unlocked">Unlocked</span>
                    ) : isNext ? (
                      unlockable ? (
                        <span className="node-status ready">Ready to Unlock</span>
                      ) : (
                        <span className="node-status next">Next Up</span>
                      )
                    ) : (
                      <span className="node-status locked">Locked</span>
                    )}
                  </div>
                  <p className="roadmap-step-desc">{node.description || ''}</p>

                  {required.length > 0 && (
                    <div className="node-required-tags">
                      <span className="node-required-label">Requires:</span>
                      {rawTags.map((t) => (
                        <span className="node-required-tag" key={t}>#{String(t).replace(/^#+/, '').trim()}</span>
                      ))}
                    </div>
                  )}

                  <ResourceLinks resources={node.resources} />

                  {required.length > 0 &&
                    (practice.length > 0 ? (
                      <div className="node-challenges">
                        <span className="node-required-label">
                          {isUnlocked ? 'Practice with:' : 'Try these to earn the tags:'}
                        </span>
                        <div className="node-challenge-links">
                          {practice.map((ch) => (
                            <Link
                              className="node-challenge-link"
                              key={ch.id}
                              href={`/dashboard/submit?id=${encodeURIComponent(ch.id)}`}
                            >
                              {ch.title} →
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="node-lock-hint">No active challenges with these tags yet.</div>
                    ))}

                  {isNext &&
                    (unlockable ? (
                      <button
                        type="button"
                        className="node-unlock-btn"
                        disabled={unlocking !== null}
                        onClick={(e) => void unlock(node.id, e.currentTarget)}
                      >
                        {unlocking === node.id ? 'Unlocking...' : 'Unlock Node →'}
                      </button>
                    ) : (
                      <div className="node-lock-hint">
                        Complete approved challenges matching the tags above to unlock.
                      </div>
                    ))}
                  {isLocked && <div className="node-lock-hint">Unlock the previous node to proceed.</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
