'use client';

import { useQuery } from '@tanstack/react-query';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { unwrap, useSupabase } from '@/components/Providers';
import { TestResults } from '@/components/TestResults';
import { FRESH } from '@/lib/queries';
import { safeUrl } from '@/lib/utils';
import type { CpSubmissionDetail, SubmissionRow } from '@/types/db';

const VERDICT_CLASS: Record<string, string> = {
  AC: 'cp-v-ac',
  WA: 'cp-v-wa',
  TLE: 'cp-v-tle',
  RE: 'cp-v-re',
  CE: 'cp-v-ce',
};

function Details({ sub }: { sub: SubmissionRow }) {
  const raw = sub.cp_submission_details;
  const cp: CpSubmissionDetail | null = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  if (cp?.verdict) {
    const verdict = cp.verdict.toUpperCase();
    return (
      <>
        <span className="cp-detail-lang">{(cp.language || '').toUpperCase()}</span>{' '}
        <span className={`cp-detail-verdict ${VERDICT_CLASS[verdict] ?? 'cp-v-pending'}`}>{verdict}</span>{' '}
        {cp.execution_time_ms != null && (
          <small>
            {cp.execution_time_ms} ms{cp.memory_kb != null ? ` · ${cp.memory_kb} KB` : ''}
          </small>
        )}
        <details className="submission-source">
          <summary>View source and judge output</summary>
          <pre>{cp.code || ''}</pre>
          {cp.compile_output && (
            <>
              <strong>Compiler output</strong>
              <pre>{cp.compile_output}</pre>
            </>
          )}
          {cp.run_output && (
            <>
              <strong>Run output</strong>
              <pre>{cp.run_output}</pre>
            </>
          )}
          <TestResults results={cp.test_results} />
        </details>
      </>
    );
  }
  if (sub.notes) return <span className="cp-detail-pending">{sub.notes}</span>;
  if (sub.submission_url) {
    return (
      <a href={safeUrl(sub.submission_url)} target="_blank" rel="noopener noreferrer" className="table-link">
        {sub.submission_url}
      </a>
    );
  }
  return <span className="cp-detail-pending">Code submitted</span>;
}

export default function SubmissionsPage() {
  const supabase = useSupabase();
  const { userId } = useDashboard();

  const { data, error, isPending } = useQuery({
    queryKey: ['submission-log', userId],
    ...FRESH,
    queryFn: () =>
      unwrap<SubmissionRow[] | null>(
        supabase
          .from('submissions')
          .select(
            `id, submitted_at, submission_url, notes, status,
             challenges ( title ),
             cp_submission_details ( language, verdict, code, execution_time_ms, memory_kb, compile_output, run_output, test_results )`,
          )
          .eq('user_id', userId)
          .order('submitted_at', { ascending: false }),
      ).then((rows) => rows ?? []),
  });

  return (
    <>
      <header className="log-archive-header">
        <div className="section-badge">Submissions</div>
        <h1>My Submissions</h1>
        <p className="subtitle">Review the status of every solution you have submitted.</p>
      </header>

      <div className="log-archive-card">
        <div className="table-container">
          <table className="log-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Challenge</th>
                <th>Details</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="logs-table-body">
              {isPending && (
                <tr><td colSpan={4} className="table-loading">Loading your submissions...</td></tr>
              )}
              {error && (
                <tr><td colSpan={4} className="table-error">Failed to load submissions: {error.message}</td></tr>
              )}
              {data && data.length === 0 && (
                <tr><td colSpan={4} className="table-empty">No submissions yet.</td></tr>
              )}
              {data?.map((sub) => {
                const status = (sub.status || 'PENDING').toUpperCase();
                const statusClass =
                  status === 'APPROVED' || status === 'ACCEPTED'
                    ? 'status-accepted'
                    : status === 'REJECTED'
                      ? 'status-rejected'
                      : 'status-pending';
                return (
                  <tr key={sub.id}>
                    <td className="col-time">
                      {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : 'Unknown'}
                    </td>
                    <td className="col-title">{sub.challenges?.title ?? 'Unknown Challenge'}</td>
                    <td className="col-details"><Details sub={sub} /></td>
                    <td className="col-status">
                      <span className={`table-status-badge ${statusClass}`}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
