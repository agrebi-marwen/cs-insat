import Link from 'next/link';
import type { ReactNode } from 'react';
import { epochHue, hueStyle } from '@/lib/utils';
import type { Roadmap } from '@/types/db';

interface Props {
  roadmap: Roadmap;
  href: string;
  fallbackBadge: string;
  count: string;
  enterLabel: string;
  children?: ReactNode;
}

/** Card used by both roadmap galleries (learning paths and node roadmaps). */
export function PathCard({ roadmap, href, fallbackBadge, count, enterLabel, children }: Props) {
  return (
    <Link className="path-card" href={href} style={hueStyle(epochHue(roadmap.slug))}>
      <div className="path-card-top">
        <span className="path-badge">{roadmap.difficulty || fallbackBadge}</span>
        <span className="path-difficulty">{count}</span>
      </div>
      <h3>{roadmap.title}</h3>
      <p className="path-desc">{roadmap.description || ''}</p>
      {children}
      <span className="path-enter">{enterLabel}</span>
    </Link>
  );
}

/** Curated resource links of a step or node (only http(s) targets are live). */
export function ResourceLinks({ resources }: { resources: { title?: string | null; url?: string | null }[] | null }) {
  const list = Array.isArray(resources) ? resources : [];
  if (list.length === 0) return null;
  return (
    <div className="roadmap-step-resources">
      {list.map((r, i) => {
        const safe = /^https?:\/\//i.test(String(r.url ?? '')) ? String(r.url) : '#';
        return (
          <a className="roadmap-resource" key={i} href={safe} target="_blank" rel="noopener noreferrer">
            {r.title || r.url} ↗
          </a>
        );
      })}
    </div>
  );
}
