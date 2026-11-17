import { describe, expect, it } from 'vitest';
import {
  epochHue,
  filledSegments,
  formatDate,
  getRank,
  GIT_URL_REGEX,
  parseMonthYear,
  passwordProblem,
  safeUrl,
  splitTags,
  toDriveEmbed,
} from '@/lib/utils';

describe('safeUrl', () => {
  it('only lets http(s) through', () => {
    expect(safeUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,x')).toBe('#');
    expect(safeUrl(null)).toBe('#');
  });
});

describe('toDriveEmbed', () => {
  const embed = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview';
  it('normalizes every supported share-link form', () => {
    expect(toDriveEmbed('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe(embed);
    expect(toDriveEmbed('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe(embed);
    expect(toDriveEmbed('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp')).toBe(embed);
    expect(toDriveEmbed('1AbCdEfGhIjKlMnOp')).toBe(embed);
  });
  it('returns null for unusable input', () => {
    expect(toDriveEmbed('')).toBeNull();
    expect(toDriveEmbed('not a link')).toBeNull();
  });
});

describe('parseMonthYear', () => {
  it('orders months chronologically', () => {
    expect(parseMonthYear('AUGUST 2026')).toBeGreaterThan(parseMonthYear('july 2026'));
    expect(parseMonthYear('JANUARY 2027')).toBeGreaterThan(parseMonthYear('DECEMBER 2026'));
  });
  it('returns 0 for unknown labels', () => {
    expect(parseMonthYear('Unknown Month')).toBe(0);
    expect(parseMonthYear(null)).toBe(0);
  });
});

describe('getRank', () => {
  it('walks the ladder at its boundaries', () => {
    expect(getRank(0)).toEqual({ name: 'Novice', min: 0, nextMin: 500 });
    expect(getRank(499).name).toBe('Novice');
    expect(getRank(500).name).toBe('Apprentice');
    expect(getRank(20000)).toEqual({ name: 'Master', min: 20000, nextMin: null });
  });
});

describe('misc helpers', () => {
  it('filledSegments clamps to the bar', () => {
    expect(filledSegments(-5)).toBe(0);
    expect(filledSegments(55)).toBe(6);
    expect(filledSegments(250)).toBe(10);
  });

  it('epochHue is stable and stays in the palette', () => {
    expect(epochHue('AUGUST 2026')).toBe(epochHue('august 2026 '));
    expect([205, 220, 18, 45]).toContain(epochHue('competitive-programming'));
    expect(epochHue('')).toBe(25);
  });

  it('formatDate is relative for recent times', () => {
    const now = Date.UTC(2026, 10, 16, 12);
    expect(formatDate(now - 30_000, now)).toBe('Just now');
    expect(formatDate(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatDate(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatDate(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(formatDate(null, now)).toBe('Unknown');
  });

  it('passwordProblem enforces the signup policy', () => {
    expect(passwordProblem('Sh0rt')).toMatch(/8 characters/);
    expect(passwordProblem('alllowercase1')).toMatch(/uppercase/);
    expect(passwordProblem('ALLUPPERCASE1')).toMatch(/lowercase/);
    expect(passwordProblem('NoDigitsHere')).toMatch(/number/);
    expect(passwordProblem('Str0ngEnough')).toBeNull();
  });

  it('GIT_URL_REGEX accepts GitHub/GitLab repos only', () => {
    expect(GIT_URL_REGEX.test('https://github.com/user/repo')).toBe(true);
    expect(GIT_URL_REGEX.test('https://gitlab.com/user/repo/-/tree/main')).toBe(true);
    expect(GIT_URL_REGEX.test('https://github.com/user')).toBe(false);
    expect(GIT_URL_REGEX.test('https://evil.example/github.com/user/repo')).toBe(false);
  });

  it('splitTags normalizes and de-duplicates', () => {
    expect(splitTags('#Arrays  #binary #ARRAYS')).toEqual(['arrays', 'binary']);
    expect(splitTags(null)).toEqual([]);
  });
});
