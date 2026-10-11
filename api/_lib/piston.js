// api/_lib/piston.js - Piston code execution client + C++ output comparator.
// Vercel ignores files in directories prefixed with "_", so this is not a route.
// The emkc.org/api/v2 endpoints are public; only PISTON_API_KEY (if set) is
// sent as the Authorization header when the public instance requires it.

const PISTON_BASE_URL = String(
  process.env.PISTON_BASE_URL || 'https://emkc.org/api/v2/piston'
).replace(/\/+$/, '');
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

// ----------------------------------------------------------------------------
// OUTPUT COMPARATOR (C++)
// Runs on Piston itself (fast, compiled) and handles whitespace:
//   - strips trailing spaces/tabs on every line
//   - strips the problem's trailing blank lines
// Docs a Piston request body with language c++ + this source; stdin carries
// length-prefixed (actual, expected) byte pairs so content is compared exactly.
//   stdin := "N\n"
//           for each test i: "<aLen>\n<actual bytes><eLen>\n<expected bytes>"
//   stdout: "AC\n" or "WA\n<1-based index>\n"
// ----------------------------------------------------------------------------
export const COMPARATOR_SOURCE = `#include <iostream>
#include <sstream>
#include <string>
#include <vector>
using namespace std;

static string normalize(const string& s) {
    istringstream iss(s);
    string line;
    vector<string> out;
    while (getline(iss, line)) {
        size_t end = line.find_last_not_of(" \\t\\r");
        if (end != string::npos) line.erase(end + 1);
        else line.clear();
        out.push_back(line);
    }
    while (!out.empty() && out.back().empty()) out.pop_back();
    ostringstream oss;
    for (size_t i = 0; i < out.size(); ++i) {
        if (i) oss << '\\n';
        oss << out[i];
    }
    return oss.str();
}

int main() {
    int n;
    if (!(cin >> n)) return 0;
    for (int t = 0; t < n; ++t) {
        int alen;
        if (!(cin >> alen)) break;
        cin.ignore(1); // newline after the length
        string actual(alen, '\\0');
        cin.read(&actual[0], alen);

        int elen;
        if (!(cin >> elen)) break;
        cin.ignore(1);
        string expected(elen, '\\0');
        cin.read(&expected[0], elen);

        if (normalize(actual) != normalize(expected)) {
            cout << "WA\\n" << (t + 1) << "\\n";
            return 0;
        }
    }
    cout << "AC\\n";
    return 0;
}
`;

function buildComparatorInput(pairs) {
  let s = String(pairs.length) + '\n';
  for (const [actual, expected] of pairs) {
    s += String(Buffer.byteLength(actual, 'utf8')) + '\n' + actual;
    s += String(Buffer.byteLength(expected, 'utf8')) + '\n' + expected;
  }
  return s;
}

// Compare ([actual, expected], ...) pairs via the C++ comparator on Piston.
// Returns { accepted: boolean, index: number|null } (index is 1-based).
export async function compareOutputs(pairs) {
  const data = await executePiston({
    language: 'c++',
    code: COMPARATOR_SOURCE,
    stdin: buildComparatorInput(pairs),
    runTimeoutMs: 3000,
    memoryLimitMb: -1
  });

  const stdout = (data.run && data.run.stdout) || '';
  const lines = stdout.split('\n').map(l => l.trim());
  if (lines[0] === 'AC') return { accepted: true, index: null };
  if (lines[0] === 'WA') {
    return { accepted: false, index: parseInt(lines[1], 10) || null };
  }
  return { accepted: false, index: null };
}