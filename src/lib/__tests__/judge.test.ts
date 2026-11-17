import { describe, expect, it } from 'vitest';
import { buildTestResults, classifyRun, normalizeOutput, outputsMatch, parseTestFile } from '@/lib/judge';

describe('normalizeOutput / outputsMatch', () => {
  it('ignores trailing whitespace per line and trailing blank lines', () => {
    expect(outputsMatch('15  \n60\t\n\n\n', '15\n60')).toBe(true);
  });

  it('treats CRLF and LF the same', () => {
    expect(outputsMatch('1\r\n2\r\n', '1\n2\n')).toBe(true);
  });

  it('keeps leading whitespace and inner blank lines significant', () => {
    expect(outputsMatch(' 1', '1')).toBe(false);
    expect(outputsMatch('1\n\n2', '1\n2')).toBe(false);
  });

  it('does not accept a missing line', () => {
    expect(outputsMatch('15', '15\n60')).toBe(false);
    expect(normalizeOutput(null)).toBe('');
  });
});

describe('parseTestFile', () => {
  it('accepts a Codeforces-style pair and reads t', () => {
    const result = parseTestFile({ input: '2\n1 2\n3 4\n', expected: '3\n7\n' });
    expect(result).toEqual({ ok: true, file: { input: '2\n1 2\n3 4\n', expected: '3\n7\n' }, testCount: 2 });
  });

  it('accepts a one-element array and rejects longer ones', () => {
    expect(parseTestFile([{ input: '1\n5\n', expected: '5\n' }]).ok).toBe(true);
    expect(parseTestFile([{ input: '1\n', expected: '' }, { input: '1\n', expected: '' }]).ok).toBe(false);
  });

  it('rejects wrong shapes and inputs that do not start with t', () => {
    expect(parseTestFile(null).ok).toBe(false);
    expect(parseTestFile({ input: 1, expected: '' }).ok).toBe(false);
    expect(parseTestFile({ input: 'abc\n', expected: '' }).ok).toBe(false);
  });
});

describe('classifyRun', () => {
  it('reports compile errors first', () => {
    expect(classifyRun({ compile: { code: 1, stderr: 'boom' }, run: { code: 0 } })).toEqual({
      kind: 'CE',
      compileOutput: 'boom',
    });
  });

  it('maps Piston statuses and exit codes', () => {
    expect(classifyRun({ run: { status: 'TO' } }).kind).toBe('TLE');
    expect(classifyRun({ run: { status: 'OL', stdout: 'x' } }).kind).toBe('RE');
    expect(classifyRun({ run: { code: 139, signal: 'SIGSEGV' } })).toMatchObject({ kind: 'RE', message: 'Killed (SIGSEGV)' });
    expect(classifyRun({ run: { code: 3 } })).toMatchObject({ kind: 'RE', message: 'Exit code 3' });
  });

  it('returns stdout for a clean run', () => {
    expect(classifyRun({ compile: { code: 0 }, run: { code: 0, stdout: '42\n' } })).toEqual({ kind: 'OK', output: '42\n' });
  });
});

describe('buildTestResults', () => {
  const file = { input: '2\n1 2\n3 4\n', expected: '3\n7\n' };

  it('marks every sub-test OK on AC', () => {
    const rows = buildTestResults(file, '3\n7\n', 2, 12, 900, 'AC');
    expect(rows.map((r) => r.result)).toEqual(['OK', 'OK']);
    expect(rows[1]).toMatchObject({ index: 2, input: '3 4', expected: '7', output: '7', cpu_ms: 12, memory_kb: 900 });
  });

  it('pinpoints the failing sub-test on WA', () => {
    const rows = buildTestResults(file, '3\n8\n', 2, null, null, 'WA');
    expect(rows.map((r) => r.result)).toEqual(['OK', 'WA']);
  });

  it('labels every sub-test with the verdict when there is no output', () => {
    expect(buildTestResults(file, '', 2, null, null, 'TLE').map((r) => r.result)).toEqual(['TLE', 'TLE']);
  });
});
