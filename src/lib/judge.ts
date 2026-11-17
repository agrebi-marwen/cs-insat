// Pure judge logic shared by the CP submit route, the admin panel and tests.
// No I/O here: everything is deterministic and unit-tested (judge.test.ts).

export const LANG_CONFIG = {
  c: { label: 'C', file: 'main.c', language: 'c' },
  'c++': { label: 'C++', file: 'main.cpp', language: 'c++' },
  python: { label: 'Python 3', file: 'main.py', language: 'python' },
  java: { label: 'Java', file: 'Main.java', language: 'java' },
} as const;

export type Language = keyof typeof LANG_CONFIG;
export const LANGUAGES = Object.keys(LANG_CONFIG) as Language[];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in LANG_CONFIG;
}

export type Verdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'CE';

export const MAX_CODE_LENGTH = 256 * 1024; // 256 KB of source
export const MAX_TEST_FILE_BYTES = 4 * 1024 * 1024; // 4 MB gzipped

/** Source file extension -> judge language (used to preselect the language). */
export const FILE_LANG: Record<string, Language> = {
  '.c': 'c',
  '.cpp': 'c++',
  '.cc': 'c++',
  '.cxx': 'c++',
  '.c++': 'c++',
  '.h': 'c++',
  '.hpp': 'c++',
  '.py': 'python',
  '.py3': 'python',
  '.java': 'java',
};

function splitLines(value: unknown): string[] {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Judge whitespace rules: trailing spaces/tabs on each line are ignored, as
 * are trailing blank lines.
 */
export function normalizeOutput(value: unknown): string {
  const lines = splitLines(value).map((line) => line.replace(/[ \t]+$/g, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export function outputsMatch(actual: unknown, expected: unknown): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

export interface TestFile {
  input: string;
  expected: string;
}

export type TestFileResult =
  | { ok: true; file: TestFile; testCount: number }
  | { ok: false; error: string };

/**
 * Validate a Codeforces-style test file: ONE { input, expected } pair whose
 * input starts with t (the number of sub-tests). A 1-element array is accepted.
 */
export function parseTestFile(parsed: unknown): TestFileResult {
  let pair: unknown = parsed;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return { ok: false, error: 'must be a single { input, expected } object (Codeforces style)' };
    }
    pair = parsed[0];
  }
  if (!pair || typeof pair !== 'object') {
    return { ok: false, error: "must be an object with string fields 'input' and 'expected'" };
  }
  const { input, expected } = pair as Record<string, unknown>;
  if (typeof input !== 'string' || typeof expected !== 'string') {
    return { ok: false, error: "must have string fields 'input' and 'expected'" };
  }
  const firstLine = (input.trim().split(/\r?\n/, 1)[0] ?? '').trim();
  if (!/^\d+$/.test(firstLine)) {
    return { ok: false, error: 'input must begin with the number of tests t (Codeforces style)' };
  }
  return { ok: true, file: { input, expected }, testCount: parseInt(firstLine, 10) };
}

export interface RunStage {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
  status?: string | null;
}

export type RunClass =
  | { kind: 'OK'; output: string }
  | { kind: 'CE'; compileOutput: string }
  | { kind: 'TLE' }
  | { kind: 'RE'; runOutput: string; message: string };

/** Classify one Piston execute response into a judge outcome. */
export function classifyRun(data: { compile?: RunStage; run?: RunStage }): RunClass {
  const compile = data.compile;
  if (compile && typeof compile.code === 'number' && compile.code !== 0) {
    return { kind: 'CE', compileOutput: compile.stderr || compile.stdout || '' };
  }

  const run = data.run ?? {};

  // Piston statuses: TO = timeout, OL = stdout limit, EL = stderr limit.
  if (run.status === 'TO') return { kind: 'TLE' };
  if (run.status === 'OL' || run.status === 'EL') {
    return { kind: 'RE', runOutput: run.stdout || '', message: `Output limit exceeded (${run.status})` };
  }
  if ((typeof run.code === 'number' && run.code !== 0) || run.signal) {
    return {
      kind: 'RE',
      runOutput: run.stdout || '',
      message: run.signal ? `Killed (${run.signal})` : `Exit code ${run.code}`,
    };
  }
  return { kind: 'OK', output: run.stdout || '' };
}

export interface TestCaseResult {
  index: number;
  input: string;
  expected: string;
  output: string;
  cpu_ms: number | null;
  memory_kb: number | null;
  result: string;
}

/** Per-sub-test breakdown shown to the user (line i of output vs line i of expected). */
export function buildTestResults(
  file: TestFile,
  actual: string,
  testCount: number,
  executionTimeMs: number | null,
  memoryKb: number | null,
  verdict: Verdict,
): TestCaseResult[] {
  const inputLines = splitLines(file.input);
  const expectedLines = splitLines(file.expected);
  const outputLines = splitLines(actual);
  const cases: TestCaseResult[] = [];

  for (let i = 0; i < testCount; i += 1) {
    const expected = expectedLines[i] ?? '';
    const output = outputLines[i] ?? '';
    cases.push({
      index: i + 1,
      input: inputLines[i + 1] ?? '',
      expected,
      output,
      cpu_ms: executionTimeMs,
      memory_kb: memoryKb,
      result: verdict === 'AC' || output.trim() === expected.trim() ? 'OK' : verdict,
    });
  }
  return cases;
}
