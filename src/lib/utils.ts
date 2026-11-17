// Shared pure helpers (ported from assets/js/common.js and creative.js).

/** Only http(s) URLs may be used as a link target; anything else is inert. */
export function safeUrl(value: unknown): string {
  const url = String(value ?? '');
  return /^https?:\/\//i.test(url) ? url : '#';
}

/**
 * Normalize a Google Drive share link (or bare file id) to its preview embed
 * URL. Returns null when no usable Drive id can be extracted.
 */
export function toDriveEmbed(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let id: string | null = null;
  const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  const idParamMatch = raw.match(/[?&]id=([^&]+)/);

  if (fileMatch?.[1]) id = fileMatch[1];
  else if (idParamMatch?.[1]) id = idParamMatch[1];
  else if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) id = raw;

  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

/** Parse a label like "AUGUST 2026" into a comparable number (0 when invalid). */
export function parseMonthYear(label: unknown): number {
  const match = String(label ?? '').trim().toUpperCase().match(/^([A-Z]+)\s*(\d{4})$/);
  if (!match) return 0;
  const month = MONTHS[match[1] ?? ''];
  return month ? Number(match[2]) * 12 + month : 0;
}

/** Number of lit cells (out of `segments`) for a percentage. */
export function filledSegments(pct: number, segments = 10): number {
  return Math.round((Math.min(100, Math.max(0, pct)) / 100) * segments);
}

/** Compact relative timestamp ("3h ago") falling back to a short date. */
export function formatDate(value: string | number | Date | null | undefined, now = Date.now()): string {
  if (!value) return 'Unknown';
  const d = new Date(value);
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Hues of the DESIGN.md palette: Sky Reflection, Dusk Blue, Flame Orange, Tuscan Sun.
const PALETTE_HUES = [205, 220, 18, 45] as const;

/** Stable accent hue for a month label or slug, limited to the brand palette. */
export function epochHue(key: unknown): number {
  const str = String(key ?? '').toUpperCase().trim();
  if (!str) return 25;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return PALETTE_HUES[h % PALETTE_HUES.length] ?? 25;
}

/** Inline style object carrying the --epoch-hue custom property. */
export function hueStyle(hue: number): React.CSSProperties {
  return { '--epoch-hue': hue } as React.CSSProperties;
}

/** Success sparkle burst at a viewport position. */
export function burstParticles(x: number, y: number, hue?: number | null): void {
  let layer = document.getElementById('burst-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'burst-layer';
    layer.className = 'burst-layer';
    document.body.appendChild(layer);
  }

  const palette =
    hue != null
      ? [`hsl(${hue} 85% 60%)`, `hsl(${(hue + 25) % 360} 85% 62%)`, '#ffffff']
      : ['#83b5d1', '#fe4e00', '#eec643', '#ffffff'];

  for (let i = 0; i < 26; i++) {
    const p = document.createElement('span');
    p.className = 'burst-particle';
    const angle = Math.random() * Math.PI * 2;
    const dist = 55 + Math.random() * 95;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${(Math.cos(angle) * dist).toFixed(1)}px`);
    p.style.setProperty('--dy', `${(Math.sin(angle) * dist).toFixed(1)}px`);
    p.style.background = palette[i % palette.length] ?? '#ffffff';
    const size = (4 + Math.random() * 5).toFixed(1);
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    layer.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

/** Burst centered on an element (no-op when the element is missing). */
export function burstFrom(el: Element | null, hue?: number | null): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, hue);
}

// Rank ladder (cumulative total points).
export const RANKS = [
  { name: 'Novice', min: 0 },
  { name: 'Apprentice', min: 500 },
  { name: 'Junior', min: 1200 },
  { name: 'Intermediate', min: 2500 },
  { name: 'Senior', min: 5000 },
  { name: 'Expert', min: 10000 },
  { name: 'Master', min: 20000 },
] as const;

export interface Rank {
  name: string;
  min: number;
  nextMin: number | null;
}

export function getRank(points: number): Rank {
  let idx = 0;
  RANKS.forEach((r, i) => {
    if (points >= r.min) idx = i;
  });
  const current = RANKS[idx] ?? RANKS[0];
  const next = RANKS[idx + 1];
  return { name: current.name, min: current.min, nextMin: next ? next.min : null };
}

/** Password policy used at signup. Returns an error message or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  return null;
}

export const GIT_URL_REGEX =
  /^https?:\/\/(www\.)?(github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i;

/** Normalize a challenge tag: strip leading '#', trim, lowercase. */
export function normalizeTag(tag: unknown): string {
  return String(tag ?? '').trim().replace(/^#+/, '').toLowerCase();
}

/** Split a space-separated tag string into normalized, de-duplicated tags. */
export function splitTags(raw: unknown): string[] {
  const seen = new Set<string>();
  for (const t of String(raw ?? '').split(/\s+/)) {
    const norm = normalizeTag(t);
    if (norm) seen.add(norm);
  }
  return [...seen];
}
