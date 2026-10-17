// api/_lib/piston.js - Piston code execution client + C++ output comparator.
// Vercel ignores files in directories prefixed with "_", so this is not a route.
// The emkc.org/api/v2 endpoints are public; only PISTON_API_KEY (if set) is
// sent as the Authorization header when the public instance requires it.

if (!process.env.PISTON_BASE_URL) {
  throw new Error('PISTON_BASE_URL is not set (refusing to fall back to the public Piston API)');
}
const PISTON_BASE_URL = String(process.env.PISTON_BASE_URL).replace(/\/+$/, '');
console.log('[piston] using', PISTON_BASE_URL);

const EXECUTE_URL = `${PISTON_BASE_URL}/execute`;
const RUNTIMES_URL = `${PISTON_BASE_URL}/runtimes`;
const API_KEY = process.env.PISTON_API_KEY || '';

// Language keys used by the UI / DB. Maps to Piston runtime name + source file.
// extraTimeMs / minMemoryMb are added on top of the problem's limits:
// Piston runs Java through the single-file source launcher, so javac and JVM
// startup happen inside the run phase (~1.1 s CPU and ~100 MB for an empty
// program). Without the allowance every Java submission is a TLE.
// The Python interpreter alone uses up to ~10 MB, so a 10 MB problem limit
// would leave no room for the solution itself.
export const LANG_CONFIG = {
  c:      { label: 'C',        file: 'main.c',    language: 'c' },
  'c++':  { label: 'C++',      file: 'main.cpp',  language: 'c++' },
  python: { label: 'Python 3', file: 'main.py',   language: 'python', minMemoryMb: 64 },
  java:   { label: 'Java',     file: 'Main.java', language: 'java', extraTimeMs: 2000, minMemoryMb: 256 }
};

// Must not exceed the Piston server's configured caps
// (PISTON_COMPILE_TIMEOUT / PISTON_RUN_TIMEOUT on the Piston container).
const COMPILE_TIMEOUT = 30000;
const MAX_RUN_TIMEOUT = 10000;

let runtimeCache = null;

function compareVersions(a, b) {
  const pa = String(a).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

// Resolve the newest installed version for a runtime; falls back to "*".
async function resolveVersion(language) {
  try {
    if (!runtimeCache) {
      const headers = API_KEY ? { Authorization: API_KEY } : {};
      const res = await fetch(RUNTIMES_URL, { headers });
      runtimeCache = res.ok ? await res.json() : null;
    }
    if (runtimeCache && Array.isArray(runtimeCache)) {
      const matches = runtimeCache.filter(r => r.language === language);
      if (matches.length) {
        matches.sort((x, y) => compareVersions(y.version, x.version));
        return matches[0].version;
      }
    }
  } catch (err) {
    console.error('resolveVersion failed, falling back to "*":', err.message);
  }
  return '*';
}

function pistonHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers.Authorization = API_KEY;
  return headers;
}

// The limits a language actually runs with: the problem's limits plus the
// language allowance (keep in sync with LANG_ALLOWANCE in pages/submit.js).
export function effectiveLimits(language, timeLimitMs, memoryLimitMb) {
  const cfg = LANG_CONFIG[language] || {};
  return {
    runTimeoutMs: Math.min((timeLimitMs ?? 1000) + (cfg.extraTimeMs || 0), MAX_RUN_TIMEOUT),
    memoryLimitMb: Math.max(memoryLimitMb ?? 10, cfg.minMemoryMb || 0)
  };
}

// Run arbitrary code on Piston.
// opts: { language, code, stdin='', runTimeoutMs=1000, memoryLimitMb=256 }
//   files: [{ name, content }]  send these instead of a single `code` file
//   args:  [...]                 command-line arguments for the run stage
//   exactLimits: true            use runTimeoutMs / memoryLimitMb as given
//                                (no language allowance; the driver applies
//                                per-test limits itself)
// Resolves the full Piston execute response ({ compile?, run } or throws).
export async function executePiston(opts) {
  const cfg = LANG_CONFIG[opts.language];
  if (!cfg) throw new Error(`Unsupported language: ${opts.language}`);

  const { runTimeoutMs, memoryLimitMb } = opts.exactLimits
    ? { runTimeoutMs: Math.min(opts.runTimeoutMs, MAX_RUN_TIMEOUT), memoryLimitMb: opts.memoryLimitMb }
    : effectiveLimits(opts.language, opts.runTimeoutMs, opts.memoryLimitMb);
  const version = await resolveVersion(cfg.language);

  const body = {
    language: cfg.language,
    version,
    files: opts.files || [{ name: opts.file || cfg.file, content: opts.code }],
    args: opts.args || [],
    stdin: opts.stdin || '',
    compile_timeout: COMPILE_TIMEOUT,
    compile_cpu_time: COMPILE_TIMEOUT,
    compile_memory_limit: -1,
    run_timeout: runTimeoutMs,
    run_cpu_time: runTimeoutMs,
    run_memory_limit: memoryLimitMb > 0 ? memoryLimitMb * 1024 * 1024 : -1
  };

  const res = await fetch(EXECUTE_URL, {
    method: 'POST',
    headers: pistonHeaders(),
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Piston execute failed (${res.status}): ${(data && data.message) || res.statusText}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Piston execute returned an unexpected response');
  }
  return data;
}

// Normalize output using the judge's whitespace rules:
// trailing spaces/tabs on each line are ignored, as are trailing blank lines.
function normalizeOutput(value) {
  const lines = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''));

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

// Decimal answers are accepted within this absolute OR relative error
// (Codeforces convention): |actual - expected| <= EPS * max(1, |expected|).
const EPS = 1e-6;
const DECIMAL_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+(\.\d*)?[eE][+-]?\d+)$/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// Compare one output line. Exact match first; otherwise, when the expected
// line contains decimal numbers, compare token by token and let decimal
// tokens differ by at most EPS. Integers and words must still match exactly.
function linesMatch(actualLine, expectedLine) {
  if (actualLine === expectedLine) return true;
  const expectedTokens = expectedLine.trim().split(/\s+/);
  if (!expectedTokens.some(tok => DECIMAL_RE.test(tok))) return false;

  const actualTokens = actualLine.trim().split(/\s+/);
  if (actualTokens.length !== expectedTokens.length) return false;

  return expectedTokens.every((exp, i) => {
    const act = actualTokens[i];
    if (act === exp) return true;
    if (!DECIMAL_RE.test(exp) || !NUMBER_RE.test(act)) return false;
    const a = Number(act);
    const e = Number(exp);
    return Number.isFinite(a) && Math.abs(a - e) <= EPS * Math.max(1, Math.abs(e));
  });
}

function outputsMatch(actual, expected) {
  const a = normalizeOutput(actual);
  const e = normalizeOutput(expected);
  if (a === e) return true;
  const aLines = a.split('\n');
  const eLines = e.split('\n');
  if (aLines.length !== eLines.length) return false;
  return eLines.every((line, i) => linesMatch(aLines[i], line));
}

// Compare ([actual, expected], ...) pairs without a second Piston execution.
// Returns { accepted: boolean, index: number|null } (index is 1-based).
export function compareOutputs(pairs) {
  for (let index = 0; index < pairs.length; index += 1) {
    const [actual, expected] = pairs[index];
    if (!outputsMatch(actual, expected)) {
      return { accepted: false, index: index + 1 };
    }
  }
  return { accepted: true, index: null };
}