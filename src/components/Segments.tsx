import { filledSegments } from '@/lib/utils';

/** Segmented pixel bar cells (10 by default); render inside the bar container. */
export function Segments({ pct, as = 'div', count = 10 }: { pct: number; as?: 'div' | 'span'; count?: number }) {
  const filled = filledSegments(pct, count);
  const Tag = as;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Tag key={i} className={i < filled ? 'seg on' : 'seg'} />
      ))}
    </>
  );
}

/** Decorative bar with a fixed number of lit cells. */
export function StaticSegments({ on, count = 10 }: { on: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i < on ? 'seg on' : 'seg'} />
      ))}
    </>
  );
}
