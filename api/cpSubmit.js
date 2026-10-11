// api/cpSubmit.js - Serverless CP judge.
// Authenticates the caller, loads the admin-provided test file from Supabase
// Storage, runs the submitted code ONCE on Piston against the whole
// Codeforces-style input (which starts with "t" = number of test cases, t lines
// of data follow), compares the full stdout against the full expected output
// with a Piston-hosted C++ comparator, then persists the verdict.
//
//   one attempt     ->  one Piston execute call  ->  one comparator run
//
// Request  : POST /api/cpSubmit
//            Authorization: Bearer <session token>
//            { challengeId, code, language }
// Response : { verdict, passed, total, failedTest, executionTimeMs, memoryKb,
//              compileOutput, runOutput, error? }
//
// Requires env (Vercel): SUPABASE_SERVICE_ROLE_KEY (so submissions can be
// written server-side and the private test file can be read). Piston is a
// public API with no key.

import { applyCommonHeaders, handlePreflight, readBody } from './_lib/http.js';
import { getUser, supabaseUrl, supabaseKey } from './_lib/supabase.js';
import { executePiston, compareOutputs, LANG_CONFIG } from './_lib/piston.js';
import { gunzipSync } from 'zlib';

const MAX_CODE_LENGTH = 256 * 1024;      // 256 KB of source
const MAX_TEST_FILE_BYTES = 4 * 1024 * 1024; // 4 MB gz cap

async function rest(path, { method = 'GET', body, token, useServiceRole = false } = {}) {
  const headers = {
    apikey: supabaseKey(),
    'Content-Type': 'application/json'
  };
  // PostgREST returns no body for write requests by default (return=minimal),
  // but the judge needs the created row back to get its id. Ask for the
  // representation so a successful POST actually yields the inserted object.
  if (method === 'POST') headers.Prefer = 'return=representation';
  headers.Authorization = useServiceRole
    ? `Bearer ${supabaseKey()}`
    : (token ? `Bearer ${token}` : `Bearer ${supabaseKey()}`);
  const res = await fetch(`${supabaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data, text };
}

// Download + decompress the gzip test archive from the cp-tests bucket.
// Returns a single Codeforces-style pair: { input, expected } where
// input begins with "t" (number of sub-tests) followed by the t data sets,
// and expected is the concatenated expected output for all t sub-tests.
async function loadTestFile(testFilePath) {
  const encodedPath = String(testFilePath).split('/').map(encodeURIComponent).join('/');
  const url = `${supabaseUrl()}/storage/v1/object/cp-tests/${encodedPath}`;
  const key = supabaseKey();
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`Failed to fetch test file (storage ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_TEST_FILE_BYTES) throw new Error('Test archive exceeds the 4 MB cap');

  let parsed;
  try {
    parsed = JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch (err) {
    throw new Error('Test file is not a valid gzip JSON archive: ' + err.message);
  }

  // Accept { input, expected } or a 1-element array of it.
  let pair = parsed;
  if (Array.isArray(parsed)) {
    if (parsed.length === 1) pair = parsed[0];
    else throw new Error('Test file must be a single { input, expected } object (Codeforces style)');
  }
  if (!pair || typeof pair !== 'object' ||
      typeof pair.input !== 'string' || typeof pair.expected !== 'string') {
    throw new Error('Test file must be { "input": "...", "expected": "..." }');
  }

  const firstLine = String(pair.input).split(/\r?\n/, 1)[0].trim();
  if (!/^\d+$/.test(firstLine)) {
    throw new Error('input must begin with the number of tests t (Codeforces style)');
  }
  return { input: pair.input, expected: pair.expected };
}

// Classify a single Piston execute response into a judge verdict.
// Returns { kind: 'OK', output } or { kind: 'CE'|'RE'|'TLE', ... }.
function classifyRun(data) {
  // Compilation failed (C / C++ / Java).
  const compile = data.compile;
  if (compile && typeof compile.code === 'number' && compile.code !== 0) {
    return { kind: 'CE', compileOutput: compile.stderr || compile.stdout || '' };
  }

  const run = data.run || {};

  // Piston statuses: TO = timeout, OL = stdout limit, EL = stderr limit.
  if (run.status === 'TO') return { kind: 'TLE' };
  if (run.status === 'OL' || run.status === 'EL') {
    return { kind: 'RE', runOutput: run.stdout || '', message: `Output limit exceeded (${run.status})` };
  }

  // Non-zero exit code or a terminating signal => runtime error.
  if ((typeof run.code === 'number' && run.code !== 0) || run.signal) {
    return {
      kind: 'RE',
      runOutput: run.stdout || '',
      message: run.signal ? `Killed (${run.signal})` : `Exit code ${run.code}`
    };
  }

  return { kind: 'OK', output: run.stdout || '' };
}

function splitLines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function buildTestResults(input, expected, actual, testCount, executionTimeMs, memoryKb, verdict) {
  const inputLines = splitLines(input);
  const expectedLines = splitLines(expected);
  const outputLines = splitLines(actual);
  const cases = [];

  for (let index = 0; index < testCount; index += 1) {
    const expectedOutput = expectedLines[index] ?? '';
    const actualOutput = outputLines[index] ?? '';
    cases.push({
      index: index + 1,
      input: inputLines[index + 1] ?? '',
      expected: expectedOutput,
      output: actualOutput,
      cpu_ms: executionTimeMs,
      memory_kb: memoryKb,
      result: verdict === 'AC' || actualOutput.trim() === expectedOutput.trim() ? 'OK' : verdict
    });
  }

  return cases;
}

export default async function handler(req, res) {
  applyCommonHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = await getUser(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const body = await readBody(req);
  const { challengeId, code: rawCode, language } = body || {};
  const code = typeof rawCode === 'string' ? rawCode : '';

  if (!challengeId) {
    res.status(400).json({ error: 'challengeId is required' });
    return;
  }
  if (!LANG_CONFIG[language]) {
    res.status(400).json({ error: 'Unsupported language' });
    return;
  }
  if (!code.trim()) {
    res.status(400).json({ error: 'Code is empty' });
    return;
  }
  if (code.length > MAX_CODE_LENGTH) {
    res.status(400).json({ error: `Code is too large (max ${MAX_CODE_LENGTH} bytes)` });
    return;
  }

  try {
    // --- Challenge + judge config -------------------------------------------
    const cpResp = await rest(`/rest/v1/cp_problems?challenge_id=eq.${encodeURIComponent(challengeId)}&select=*`);
    const cp = Array.isArray(cpResp.data) ? cpResp.data[0] : null;
    if (!cp) {
      res.status(400).json({ error: 'This challenge is not a graded CP problem' });
      return;
    }

    const allowedLangs = Array.isArray(cp.languages) && cp.languages.length
      ? cp.languages
      : Object.keys(LANG_CONFIG);
    if (!allowedLangs.includes(language)) {
      res.status(400).json({ error: `Language ${language} is not enabled for this problem` });
      return;
    }

    const timeLimitMs = cp.time_limit_ms || 1000;
    const memoryLimitMb = cp.memory_limit_mb || 256;
    const testFile = await loadTestFile(cp.test_file_path);

    // Atomically enforce the per-challenge policy and create both history rows.
    // The RPC takes a transaction-scoped advisory lock, so concurrent requests
    // cannot bypass the one-submission or in-progress restrictions.
    const createResp = await rest('/rest/v1/rpc/create_cp_submission', {
      method: 'POST',
      body: {
        p_user_id: user.id,
        p_challenge_id: challengeId,
        p_language: language,
        p_code: code
      },
    });
    if (!createResp.ok || !createResp.data || !createResp.data[0]) {
      const message = createResp.data && createResp.data.message
        ? createResp.data.message
        : (createResp.text || 'Failed to record submission');
      const status = /already succeeded|Only one submission|already being judged/i.test(message) ? 409 : 500;
      res.status(status).json({ error: message });
      return;
    }
    const submission = { id: createResp.data[0].submission_id };
    const detailId = createResp.data[0].detail_id;

    // Persist the verdict + award points (idempotent) in one SQL call.
    const complete = (verdict, extra = {}) => rest('/rest/v1/rpc/complete_cp_submission', {
      method: 'POST',
      body: {
        p_submission_id: submission.id,
        p_detail_id: detailId,
        p_verdict: verdict,
        p_compile_output: extra.compileOutput ?? null,
        p_run_output: extra.runOutput ?? null,
        p_execution_time_ms: extra.executionTimeMs != null ? Math.round(extra.executionTimeMs) : null,
        p_memory_kb: extra.memoryKb ?? null,
        p_test_results: extra.testResults ?? []
      }
    });

    // --- Judge: one execution against the whole Codeforces-style input --------
    let data;
    try {
      data = await executePiston({
        language,
        code,
        stdin: testFile.input,
        runTimeoutMs: timeLimitMs,
        memoryLimitMb
      });
    } catch (err) {
      const runError = err.message;
      await complete('RE', { runOutput: err.message });
      res.status(200).json({
        verdict: 'RE',
        passed: 0,
        total: 1,
        failedTest: 1,
        executionTimeMs: null,
        memoryKb: null,
        compileOutput: null,
        runOutput: runError
      });
      return;
    }

    const run = data.run || {};
    const executionTimeMs = run.wall_time || null;
    const memoryKb = run.memory ? Math.round(run.memory / 1024) : null;

    const resT = classifyRun(data);
    let verdict;
    let compileOutput = null;
    let runOutput = null;
    let testResults = [];

    if (resT.kind === 'CE') {
      verdict = 'CE';
      compileOutput = resT.compileOutput;
    } else if (resT.kind === 'TLE') {
      verdict = 'TLE';
      runOutput = `Time limit exceeded (${timeLimitMs} ms)`;
    } else if (resT.kind === 'RE') {
      verdict = 'RE';
      runOutput = resT.runOutput || resT.message || 'Runtime error';
    } else {
      // Output produced — compare the FULL stdout vs the FULL expected output.
      const cmp = await compareOutputs([[resT.output, testFile.expected]]);
      verdict = cmp.accepted ? 'AC' : 'WA';
      runOutput = verdict === 'WA' ? resT.output : null;
      const testCount = parseInt(String(testFile.input).trim().split(/\r?\n/, 1)[0], 10);
      testResults = buildTestResults(
        testFile.input,
        testFile.expected,
        resT.output,
        Number.isFinite(testCount) ? testCount : 1,
        executionTimeMs,
        memoryKb,
        verdict
      );
    }

    if (testResults.length === 0) {
      const testCount = parseInt(String(testFile.input).trim().split(/\r?\n/, 1)[0], 10);
      testResults = buildTestResults(
        testFile.input,
        testFile.expected,
        '',
        Number.isFinite(testCount) ? testCount : 1,
        executionTimeMs,
        memoryKb,
        verdict
      );
    }

    const done = await complete(verdict, {
      compileOutput, runOutput, executionTimeMs, memoryKb, testResults
    });
    const award = Array.isArray(done.data) ? done.data[0] : null;

    res.status(200).json({
      verdict,
      passed: verdict === 'AC' ? 1 : 0,
      total: 1,
      failedTest: verdict === 'AC' ? null : 1,
      executionTimeMs,
      memoryKb,
      compileOutput,
      runOutput,
      testResults
    });
  } catch (err) {
    console.error('cpSubmit error:', err.message);
    res.status(500).json({ error: err.message || 'Judge failed' });
  }
}