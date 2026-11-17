'use client';

import { useQuery } from '@tanstack/react-query';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { PathCard } from '@/components/dashboard/PathCard';
import { unwrap, useSupabase } from '@/components/Providers';
import { Styles } from '@/components/Styles';
import { FRESH, roadmapsQuery } from '@/lib/queries';

export default function RoadmapsPage() {
  const supabase = useSupabase();
  const { userId } = useDashboard();

  const roadmapsQ = useQuery(roadmapsQuery(supabase, 'nodes'));
  const roadmaps = roadmapsQ.data;
  const ids = (roadmaps ?? []).map((r) => r.id);

  const nodesQ = useQuery({
    queryKey: ['roadmap-node-ids', ids],
    enabled: ids.length > 0,
    queryFn: () =>
      unwrap<{ id: string; roadmap_id: string }[] | null>(
        supabase.from('roadmap_nodes').select('id, roadmap_id').in('roadmap_id', ids),
      ).then((rows) => rows ?? []),
  });

  const progressQ = useQuery({
    queryKey: ['roadmap-node-progress', userId],
    ...FRESH,
    queryFn: () =>
      unwrap<{ roadmap_id: string; node_id: string }[] | null>(
        supabase.from('roadmap_node_progress').select('roadmap_id, node_id').eq('user_id', userId),
      ).then((rows) => new Set((rows ?? []).map((p) => p.roadmap_id))),
  });

  return (
    <>
      <Styles sheets={['learn', 'roadmaps']} />
      <section className="roadmaps-page-header">
        <span className="section-badge">Roadmaps</span>
        <h2 className="section-title">Choose a Field</h2>
        <p className="section-subtitle">
          Progress through nodes by completing challenges tagged with each node&apos;s required skills. Nodes unlock
          in order.
        </p>
      </section>

      <div id="roadmaps-grid" className="roadmaps-grid">
        {roadmapsQ.isPending && <div className="loading-state">Loading roadmaps...</div>}
        {roadmapsQ.error && (
          <div className="loading-state">Failed to load roadmaps: {roadmapsQ.error.message}</div>
        )}
        {roadmaps && roadmaps.length === 0 && (
          <div className="loading-state">No roadmaps available yet. Check back soon.</div>
        )}
        {roadmaps?.map((roadmap) => {
          const total = (nodesQ.data ?? []).filter((n) => n.roadmap_id === roadmap.id).length;
          return (
            <PathCard
              key={roadmap.id}
              roadmap={roadmap}
              href={`/dashboard/roadmap-map?id=${encodeURIComponent(roadmap.id)}`}
              fallbackBadge="Field"
              count={`${total} node${total === 1 ? '' : 's'}`}
              enterLabel="Explore Field →"
            >
              <div className="path-progress-caption">
                <span>{progressQ.data?.has(roadmap.id) ? 'In progress' : 'Not started'}</span>
              </div>
            </PathCard>
          );
        })}
      </div>
    </>
  );
}
