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
export const LANG_CONFIG = {
  c:      { label: 'C',        file: 'main.c',    language: 'c' },
  'c++':  { label: 'C++',      file: 'main.cpp',  language: 'c++' },
  python: { label: 'Python 3', file: 'main.py',   language: 'python' },
  java:   { label: 'Java',     file: 'Main.java', language: 'java' }
};

const COMPILE_TIMEOUT = 10000;

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

// Run arbitrary code on Piston.
// opts: { language, code, stdin='', runTimeoutMs=1000, memoryLimitMb=256 }
// Resolves the full Piston execute response ({ compile?, run } or throws).
export async function executePiston(opts) {
  const cfg = LANG_CONFIG[opts.language];
  if (!cfg) throw new Error(`Unsupported language: ${opts.language}`);

  const runTimeoutMs = opts.runTimeoutMs ?? 1000;
  const memoryLimitMb = opts.memoryLimitMb ?? 10;
  const version = await resolveVersion(cfg.language);

  const body = {
    language: cfg.language,
    version,
    files: [{ name: opts.file || cfg.file, content: opts.code }],
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

// Compare ([actual, expected], ...) pairs without a second Piston execution.
// Returns { accepted: boolean, index: number|null } (index is 1-based).
export function compareOutputs(pairs) {
  for (let index = 0; index < pairs.length; index += 1) {
    const [actual, expected] = pairs[index];
    if (normalizeOutput(actual) !== normalizeOutput(expected)) {
      return { accepted: false, index: index + 1 };
    }
  }
  return { accepted: true, index: null };
}