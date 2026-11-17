'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { ResourceLinks } from '@/components/dashboard/PathCard';
import { unwrap, useSupabase } from '@/components/Providers';
import { Segments } from '@/components/Segments';
import { Styles } from '@/components/Styles';
import { FRESH, roadmapQuery } from '@/lib/queries';
import { epochHue, hueStyle } from '@/lib/utils';
import type { RoadmapStep } from '@/types/db';

export default function RoadmapPage() {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userId } = useDashboard();
  const roadmapId = useSearchParams().get('id');

  const roadmapQ = useQuery({ ...roadmapQuery(supabase, roadmapId ?? ''), enabled: !!roadmapId });

  const stepsQ = useQuery({
    queryKey: ['roadmap-steps', roadmapId],
    enabled: !!roadmapId,
    queryFn: () =>
      unwrap<RoadmapStep[] | null>(
        supabase
          .from('roadmap_steps')
          .select('id, title, description, resources')
          .eq('roadmap_id', roadmapId!)
          .order('position', { ascending: true }),
      ).then((rows) => rows ?? []),
  });

  const progressKey = ['roadmap-progress', userId];
  const progressQ = useQuery({
    queryKey: progressKey,
    ...FRESH,
    queryFn: () =>
      unwrap<{ step_id: string }[] | null>(
        supabase.from('roadmap_progress').select('step_id').eq('user_id', userId),
      ).then((rows) => new Set((rows ?? []).map((p) => p.step_id))),
  });

  // Optimistic toggle: the checkbox responds instantly and rolls back on failure.
  const toggle = useMutation({
    mutationFn: async ({ stepId, done }: { stepId: string; done: boolean }) => {
      const { error } = done
        ? await supabase.from('roadmap_progress').insert({ user_id: userId, step_id: stepId })
        : await supabase.from('roadmap_progress').delete().eq('user_id', userId).eq('step_id', stepId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ stepId, done }) => {
      await queryClient.cancelQueries({ queryKey: progressKey });
      const previous = queryClient.getQueryData<Set<string>>(progressKey);
      const next = new Set(previous);
      if (done) next.add(stepId);
      else next.delete(stepId);
      queryClient.setQueryData(progressKey, next);
      return { previous };
    },
    onError: (err, _vars, context) => {
      console.error('Progress update failed:', err);
      queryClient.setQueryData(progressKey, context?.previous);
    },
  });

  const roadmap = roadmapQ.data;
  const steps = stepsQ.data ?? [];
  const completed = progressQ.data ?? new Set<string>();
  const hue = roadmap ? epochHue(roadmap.slug) : 25;

  const total = steps.length;
  const done = steps.filter((s) => completed.has(s.id)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  let title = 'Loading Path...';
  let description = 'Loading path details...';
  let placeholder: string | null = 'Loading steps...';
  if (!roadmapId) {
    title = 'Path Not Found';
    description = 'Please return to the Learn page and select a path.';
    placeholder = 'No path selected.';
  } else if (roadmapQ.isError || (roadmapQ.isSuccess && !roadmap)) {
    title = 'Loading Failed';
    description = 'Could not load this path. It may have been removed.';
    placeholder = 'Path not found.';
  } else if (roadmap) {
    title = roadmap.title;
    description = roadmap.description || '';
    placeholder = stepsQ.isPending ? 'Loading steps...' : total === 0 ? 'This path has no steps yet.' : null;
  }

  return (
    <>
      <Styles sheets={['learn']} />
      <section className="roadmap-page-header" id="roadmap-header" style={hueStyle(hue)}>
        <span className="path-badge" id="roadmap-difficulty">{roadmap?.difficulty || 'Path'}</span>
        <h1 className="roadmap-title" id="roadmap-title">{title}</h1>
        <p className="roadmap-subtitle" id="roadmap-description">{description}</p>
      </section>

      <div className="roadmap-overview" id="roadmap-overview" style={hueStyle(hue)}>
        <span className="roadmap-overview-label">Path Progress</span>
        <div className="learn-progress-bar" id="roadmap-progress-bar"><Segments pct={pct} /></div>
        <div className="roadmap-overview-caption" id="roadmap-progress-caption">
          {done}/{total} steps complete — <strong>{pct}%</strong>
        </div>
      </div>

      <div id="roadmap-steps" className="roadmap-steps">
        {placeholder ? (
          <div className="loading-state">{placeholder}</div>
        ) : (
          steps.map((step, index) => {
            const isDone = completed.has(step.id);
            const pending = toggle.isPending && toggle.variables?.stepId === step.id;
            return (
              <div className={isDone ? 'roadmap-step is-done' : 'roadmap-step'} key={step.id} data-step-id={step.id}>
                <div className="roadmap-step-check">
                  <input
                    type="checkbox"
                    id={`step-${step.id}`}
                    checked={isDone}
                    disabled={pending}
                    aria-label={`Mark step ${index + 1} complete`}
                    onChange={(e) => toggle.mutate({ stepId: step.id, done: e.target.checked })}
                  />
                  <label className="check-box" htmlFor={`step-${step.id}`}></label>
                </div>
                <div className="roadmap-step-body">
                  <div className="roadmap-step-head">
                    <span className="roadmap-step-num">Step {index + 1}</span>
                    <span className="roadmap-step-title">{step.title}</span>
                  </div>
                  <p className="roadmap-step-desc">{step.description || ''}</p>
                  <ResourceLinks resources={step.resources} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
