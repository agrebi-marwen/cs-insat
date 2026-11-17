'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { unwrap, useSupabase } from '@/components/Providers';
import { Styles } from '@/components/Styles';
import { epochHue, hueStyle, toDriveEmbed } from '@/lib/utils';
import type { Workshop, WorkshopCategory } from '@/types/db';

const dateOf = (w: Workshop) => (w.published_at ? new Date(w.published_at).toLocaleDateString() : '');

export default function WorkshopsPage() {
  const supabase = useSupabase();
  const [filter, setFilter] = useState('all');
  const [playing, setPlaying] = useState<Workshop | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['workshops'],
    queryFn: () =>
      unwrap<Workshop[] | null>(
        supabase
          .from('workshops')
          .select(
            'id, title, description, video_url, duration, published_at, category_id, workshop_categories (id, slug, name)',
          )
          .order('published_at', { ascending: false }),
      ).then((rows) => rows ?? []),
  });

  const workshops = data ?? [];
  const categories: WorkshopCategory[] = [];
  for (const w of workshops) {
    const cat = w.workshop_categories;
    if (cat && !categories.some((c) => c.id === cat.id)) categories.push(cat);
  }
  const visible = filter === 'all' ? workshops : workshops.filter((w) => w.category_id === filter);

  const open = (workshop: Workshop) => {
    if (!toDriveEmbed(workshop.video_url)) {
      alert('This video has no valid Google Drive link.');
      return;
    }
    setPlaying(workshop);
  };

  // While the player is open: lock page scroll and close on Escape.
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlaying(null);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [playing]);

  return (
    <>
      <Styles sheets={['workshops']} />
      <section className="workshops-header">
        <span className="section-badge">Workshops</span>
        <h2 className="section-title">Workshops</h2>
        <p className="section-subtitle">Recorded sessions organized by topic. Select a video to start watching.</p>
      </section>

      {workshops.length > 0 && (
        <div id="workshop-filters" className="workshop-filter-pills">
          <button type="button" className={filter === 'all' ? 'pill active' : 'pill'} onClick={() => setFilter('all')}>
            All
          </button>
          {categories.map((cat) => (
            <button
              type="button"
              key={cat.id}
              className={filter === cat.id ? 'pill active' : 'pill'}
              onClick={() => setFilter(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      <div id="workshop-grid" className="workshop-grid">
        {isPending && <div className="loading-state">Loading workshops...</div>}
        {error && <div className="loading-state">Failed to load workshops: {error.message}</div>}
        {data && workshops.length === 0 && <div className="loading-state">No workshops available yet.</div>}
        {workshops.length > 0 && visible.length === 0 && (
          <div className="loading-state">No videos in this category yet.</div>
        )}
        {visible.map((workshop) => {
          const cat = workshop.workshop_categories;
          return (
            <article
              className="workshop-card"
              key={workshop.id}
              data-id={workshop.id}
              style={hueStyle(cat?.slug ? epochHue(cat.slug) : 25)}
              role="button"
              tabIndex={0}
              onClick={() => open(workshop)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') open(workshop);
              }}
            >
              <div className="workshop-card-top">
                <span className="path-badge">{cat?.name || 'Workshop'}</span>
                <span className="workshop-duration">{workshop.duration || ''}</span>
              </div>
              <h3>{workshop.title}</h3>
              <p className="workshop-desc">{workshop.description || ''}</p>
              <div className="workshop-card-foot">
                <span className="workshop-date">{dateOf(workshop)}</span>
                <span className="workshop-play">Play Video ▸</span>
              </div>
            </article>
          );
        })}
      </div>

      {playing && (
        <div
          className="workshop-player-overlay"
          id="workshop-player-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPlaying(null);
          }}
        >
          <div className="workshop-player-modal" role="dialog" aria-modal="true" aria-label="Workshop player">
            <div className="workshop-player-head">
              <span className="path-badge" id="player-category">{playing.workshop_categories?.name || 'Workshop'}</span>
              <button className="workshop-close" id="player-close" type="button" aria-label="Close player" onClick={() => setPlaying(null)}>
                &times;
              </button>
            </div>
            <div className="workshop-player-frame">
              <iframe
                id="player-frame"
                title="Workshop video player"
                src={toDriveEmbed(playing.video_url) ?? undefined}
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <h3 className="workshop-player-title" id="player-title">{playing.title}</h3>
            <p className="workshop-player-meta" id="player-meta">
              {[playing.duration, dateOf(playing)].filter(Boolean).join(' • ')}
            </p>
            <p className="workshop-player-desc" id="player-desc">{playing.description || ''}</p>
          </div>
        </div>
      )}
    </>
  );
}
