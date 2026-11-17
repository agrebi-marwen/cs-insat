'use client';

// Error boundary for every dashboard page: a rendering failure shows a retry
// prompt inside the shell instead of a blank screen.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="loading-state" role="alert">
      <p>Something went wrong while loading this page.</p>
      <p style={{ opacity: 0.7, fontSize: '0.85em' }}>{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      <button type="button" className="load-more-btn" onClick={reset}>Try again</button>
    </div>
  );
}
