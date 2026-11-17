'use client';

import { useQuery } from '@tanstack/react-query';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { PathCard } from '@/components/dashboard/PathCard';
import { unwrap, useSupabase } from '@/components/Providers';
import { Segments } from '@/components/Segments';
import { Styles } from '@/components/Styles';
import { FRESH, roadmapsQuery } from '@/lib/queries';

export default function LearnPage() {
  const supabase = useSupabase();
  const { userId } = useDashboard();

  const roadmapsQ = useQuery(roadmapsQuery(supabase, 'learn'));

  const stepsQ = useQuery({
    queryKey: ['roadmap-step-ids'],
    queryFn: () =>
      unwrap<{ id: string; roadmap_id: string }[] | null>(
        supabase.from('roadmap_steps').select('id, roadmap_id'),
      ).then((rows) => rows ?? []),
  });

  const progressQ = useQuery({
    queryKey: ['roadmap-progress', userId],
    ...FRESH,
    queryFn: () =>
      unwrap<{ step_id: string }[] | null>(
        supabase.from('roadmap_progress').select('step_id').eq('user_id', userId),
      ).then((rows) => new Set((rows ?? []).map((p) => p.step_id))),
  });

  const roadmaps = roadmapsQ.data;
  const completed = progressQ.data ?? new Set<string>();

  return (
    <>
      <Styles sheets={['learn']} />
      <section className="learn-header">
        <span className="section-badge">Learning Paths</span>
        <h2 className="section-title">Choose a Path</h2>
        <p className="section-subtitle">Follow a structured series of steps and track your progress.</p>
      </section>

      <div id="learn-grid" className="learn-grid">
        {roadmapsQ.isPending && <div className="loading-state">Loading paths...</div>}
        {roadmapsQ.error && (
          <div className="loading-state">Failed to load paths: {roadmapsQ.error.message}</div>
        )}
        {roadmaps && roadmaps.length === 0 && (
          <div className="loading-state">No learning paths available yet.</div>
        )}
        {roadmaps?.map((roadmap) => {
          const stepIds = (stepsQ.data ?? []).filter((s) => s.roadmap_id === roadmap.id).map((s) => s.id);
          const total = stepIds.length;
          const done = stepIds.filter((id) => completed.has(id)).length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <PathCard
              key={roadmap.id}
              roadmap={roadmap}
              href={`/dashboard/roadmap?id=${encodeURIComponent(roadmap.id)}`}
              fallbackBadge="Path"
              count={`${total} step${total === 1 ? '' : 's'}`}
              enterLabel="Open Path →"
            >
              <div className="learn-progress-bar"><Segments pct={pct} /></div>
              <div className="path-progress-caption">
                <span>{done}/{total} complete</span>
                <strong>{pct}%</strong>
              </div>
            </PathCard>
          );
        })}
      </div>
    </>
  );
}
