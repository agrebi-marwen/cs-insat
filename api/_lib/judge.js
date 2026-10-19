// api/_lib/judge.js - Shared CP judging logic used by cpSubmit (graded) and
// cpRun (sample tests only, nothing recorded). Not a route: Vercel ignores
// files in directories prefixed with "_".

import { gunzipSync } from 'zlib';
import { supabaseUrl, supabaseKey } from './supabase.js';
import { executePiston, compareOutputs, effectiveLimits, LANG_CONFIG } from './piston.js';
import { RUNNER_C, DRIVER_PY, wrapJava } from './drivers.js';

const MAX_TEST_FILE_BYTES = 4 * 1024 * 1024; // 4 MB gz cap

// Shown to participants when the judge (not their code) failed.
export const CONTACT_HOSTS =
  'The judge could not evaluate your code because of a server problem, not because of your code. ' +
  'Please contact the hosts and tell them the challenge and the time of your submission.';

// Thrown when Piston itself fails (unreachable, HTTP error): the user's code
// was never judged, so callers tell the participant to contact the hosts.
export class JudgeInfraError extends Error {}

// Supabase REST call with the service role key.
export async function rest(path, { method = 'GET', body } = {}) {
  const headers = {
    apikey: supabaseKey(),
    Authorization: `Bearer ${supabaseKey()}`,
    'Content-Type': 'application/json'
  };
  // PostgREST returns no body for write requests by default (return=minimal),
  // but the judge needs the created row back to get its id.
  if (method === 'POST') headers.Prefer = 'return=representation';
  const res = await fetch(`${supabaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data, text };
}

// Download + decompress the gzip test archive from the private cp-tests bucket.
export async function loadTestFile(testFilePath) {
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
  return parseTestArchive(parsed);
}

// Ensure a block of text ends with exactly one newline.
function asBlock(value) {
  const text = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  return text + '\n';
}

// Build the judge input/expected from a list of { input, expected } cases.
function fromCases(cases) {
  return {
    input: `${cases.length}\n` + cases.map(c => c.input).join(''),
    expected: cases.map(c => c.expected).join(''),
    cases
  };
}

// Turn the uploaded JSON into { input, expected, cases }.
// Two formats are accepted:
//   { "tests": [ { "input", "expected", "sample"? }, ... ] } - one entry per
//       sub-test; the judge prepends t and concatenates, so multi-line tests
//       (matrices, arrays) keep their boundaries. "sample": true marks the
//       tests that "Run on samples" may use.
//   { "input", "expected" } - legacy single pair whose input starts with t;
//       cases is null (and there are no samples).
export function parseTestArchive(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.tests)) {
    const tests = parsed.tests;
    if (tests.length === 0) throw new Error('"tests" must contain at least one test');
    const cases = tests.map((test, index) => {
      if (!test || typeof test.input !== 'string' || typeof test.expected !== 'string') {
        throw new Error(`Test ${index + 1} must have string fields "input" and "expected"`);
      }
      return { input: asBlock(test.input), expected: asBlock(test.expected), sample: test.sample === true };
    });
    return fromCases(cases);
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
  return { input: pair.input, expected: pair.expected, cases: null };
}

// Only the tests marked "sample": true, as their own judge input (or null).
export function sampleTestFile(testFile) {
  const samples = (testFile.cases || []).filter(c => c.sample);
  return samples.length ? fromCases(samples) : null;
}

const OOM_RE = /MemoryError|OutOfMemoryError|std::bad_alloc|Cannot allocate memory/i;

// Classify a single Piston execute response into a judge verdict.
// Returns { kind: 'OK', output } or { kind: 'CE'|'RE'|'TLE'|'MLE', ... }.
// memoryLimitMb is the limit the run actually had (after language allowance).
export function classifyRun(data, memoryLimitMb) {
  const compile = data.compile;
  // Compilation killed by Piston's compile limit (code is null, status set):
  // report it as a compile error rather than letting it look like a TLE.
  if (compile && compile.status) {
    return {
      kind: 'CE',
      compileOutput: compile.status === 'TO'
        ? 'Compilation timed out. Heavy headers such as <bits/stdc++.h> can exceed the judge\'s compile limit; include only the headers you need (e.g. <iostream>).'
        : (compile.stderr || compile.message || `Compilation failed (${compile.status})`)
    };
  }
  if (compile && typeof compile.code === 'number' && compile.code !== 0) {
    return { kind: 'CE', compileOutput: compile.stderr || compile.stdout || '' };
  }

  const run = data.run || {};

  // Piston statuses: TO = timeout, OL = stdout limit, EL = stderr limit.
  if (run.status === 'TO') return { kind: 'TLE' };
  if (run.status === 'OL' || run.status === 'EL') {
    return { kind: 'RE', runOutput: run.stdout || '', message: `Output limit exceeded (${run.status})` };
  }

  const failed = (typeof run.code === 'number' && run.code !== 0) || run.signal;
  if (failed) {
    // Memory limit: killed (Piston reports exit code 137 = 128 + SIGKILL)
    // while at the limit, or the runtime reported running out of memory.
    // Other crashes (segfault = 139, normal error exits) stay RE.
    const limitBytes = (memoryLimitMb || 0) * 1024 * 1024;
    const nearLimit = limitBytes > 0 && run.memory >= limitBytes * 0.9;
    const killed = run.signal === 'SIGKILL' || run.code === 137;
    if ((killed && nearLimit) || OOM_RE.test(String(run.stderr || ''))) {
      return { kind: 'MLE', runOutput: run.stdout || '' };
    }
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

// Lines of a block without its final newline ("3\n" -> ["3"]).
function blockLines(value) {
  return splitLines(String(value ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, ''));
}

// Per-sub-test pairs { input, expected } for display. Structured archives
// carry them directly; for legacy archives the input after the t line is
// divided evenly between the t tests (1 line each for simple inputs, 5 for a
// 5x5 matrix, ...) and the expected output gets one line per test.
function legacyCases(testFile, testCount) {
  const inputLines = blockLines(testFile.input).slice(1);
  const expectedLines = blockLines(testFile.expected);
  const perTest = inputLines.length % testCount === 0 ? inputLines.length / testCount : 1;
  const cases = [];
  for (let index = 0; index < testCount; index += 1) {
    cases.push({
      input: inputLines.slice(index * perTest, (index + 1) * perTest).join('\n'),
      expected: expectedLines[index] ?? ''
    });
  }
  return cases;
}

// Per-test details are stored with every submission and sent to the browser,
// so big inputs (e.g. N = 100000) are cut to keep both small.
const MAX_SHOWN_CHARS = 2000;
function clip(text) {
  return text.length > MAX_SHOWN_CHARS
    ? `${text.slice(0, MAX_SHOWN_CHARS)}\n… (truncated, ${text.length} characters in total)`
    : text;
}

export function buildTestResults(testFile, actual, executionTimeMs, memoryKb, verdict) {
  const testCount = parseInt(String(testFile.input).trim().split(/\r?\n/, 1)[0], 10);
  const cases = testFile.cases || legacyCases(testFile, Number.isFinite(testCount) && testCount > 0 ? testCount : 1);
  const outputLines = blockLines(actual);
  let cursor = 0;

  return cases.map((testCase, index) => {
    // Each test owns as many output lines as its expected answer has.
    const expectedOutput = blockLines(testCase.expected).join('\n');
    const lineCount = Math.max(1, blockLines(testCase.expected).length);
    const actualOutput = outputLines.slice(cursor, cursor + lineCount).join('\n');
    cursor += lineCount;
    const matches = compareOutputs([[actualOutput, expectedOutput]]).accepted;
    return {
      index: index + 1,
      input: clip(blockLines(testCase.input).join('\n')),
      expected: clip(expectedOutput),
      output: clip(actualOutput),
      cpu_ms: executionTimeMs,
      memory_kb: memoryKb,
      result: verdict === 'AC' || matches ? 'OK' : verdict
    };
  });
}

// ---------------------------------------------------------------------------
// One test per run ("single" input mode)
// ---------------------------------------------------------------------------
// Each test's input is given to a fresh run of the program on its own (no
// "t" line), like CSAcademy / AtCoder. Still ONE Piston request: a driver
// (see drivers.js) runs the program once per test inside it.

const RUN_BUDGET_MS = 45000;  // stop starting new tests after this (Piston caps a run at 50 s)
const MEMORY_SLACK_MB = 64;   // room for the driver itself above the per-test limit

// Files + arguments for the driver of each language.
function driverRequest(language, code, timeLimitMs, memoryLimitMb) {
  const args = ['--pj', String(timeLimitMs), String(memoryLimitMb), String(RUN_BUDGET_MS)];
  if (language === 'c') return { files: [{ name: 'main.c', content: code }, { name: 'pj_runner.c', content: RUNNER_C }], args };
  if (language === 'c++') return { files: [{ name: 'main.cpp', content: code }, { name: 'pj_runner.cpp', content: RUNNER_C }], args };
  if (language === 'python') return { files: [{ name: 'pj_driver.py', content: DRIVER_PY }, { name: 'solution.py', content: code }], args };
  if (language === 'java') {
    const wrapped = wrapJava(code);
    if (!wrapped) return null;
    return { files: [{ name: 'Main.java', content: wrapped }], args };
  }
  return null;
}

// Parse the driver's framed output into per-test results.
function parseDriverOutput(stdout) {
  const buf = Buffer.from(stdout || '', 'utf8');
  const results = [];
  let pos = 0;
  let endReason = null;
  let compileError = null;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const line = buf.toString('utf8', pos, nl);
    const ce = /^@@CE (\d+)$/.exec(line);
    if (ce) {
      compileError = buf.toString('utf8', nl + 1, nl + 1 + Number(ce[1]));
      break;
    }
    if (line.startsWith('@@END')) {
      endReason = line.split(' ')[1] || 'done';
      break;
    }
    const m = /^@@T (\d+) (\w+) (-?\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(line);
    if (!m) break;
    const length = Number(m[7]);
    const output = buf.toString('utf8', nl + 1, nl + 1 + length);
    results.push({
      index: Number(m[1]),
      status: m[2],
      exitCode: Number(m[3]),
      cpuMs: Number(m[4]),
      wallMs: Number(m[5]),
      memoryKb: Number(m[6]),
      output
    });
    pos = nl + 1 + length + 1; // block + trailing newline
  }
  return { results, endReason, compileError };
}

async function judgeSingle({ language, code, testFile, timeLimitMs, memoryLimitMb }) {
  const cfg = LANG_CONFIG[language] || {};
  // Per-test memory keeps the language minimum (Python, Java need more).
  const perTestMemoryMb = Math.max(memoryLimitMb, cfg.minMemoryMb || 0);
  const request = driverRequest(language, code, timeLimitMs, perTestMemoryMb);
  if (!request) {
    return {
      verdict: 'CE',
      compileOutput: 'Could not find a class to run. Declare your solution as "public class Main" with a main method.',
      runOutput: null, executionTimeMs: null, memoryKb: null, testResults: []
    };
  }

  const cases = testFile.cases || [];
  const stdin = `${cases.length}\n` + cases.map(c => {
    const body = Buffer.from(c.input, 'utf8');
    return `${body.length}\n${c.input}`;
  }).join('');

  let data;
  try {
    data = await executePiston({
      language,
      stdin,
      files: request.files,
      args: request.args,
      runTimeoutMs: 50000,
      memoryLimitMb: language === 'java' ? perTestMemoryMb + 512 : perTestMemoryMb + MEMORY_SLACK_MB,
      exactLimits: true
    });
  } catch (err) {
    throw new JudgeInfraError(err.message);
  }

  const compile = data.compile;
  if (compile && (compile.status || (typeof compile.code === 'number' && compile.code !== 0))) {
    return {
      verdict: 'CE',
      compileOutput: compile.status === 'TO'
        ? 'Compilation timed out. Include only the headers you need.'
        : (compile.stderr || compile.stdout || compile.message || 'Compilation failed'),
      runOutput: null, executionTimeMs: null, memoryKb: null, testResults: []
    };
  }

  const run = data.run || {};
  const { results, endReason, compileError } = parseDriverOutput(run.stdout);

  // Python syntax errors (reported by the driver) and Java compile errors
  // (Java compiles inside the run stage) are compile errors, not crashes.
  const javaCompileError = language === 'java' && results.length === 0 && !endReason &&
    /error:/.test(run.stderr || '') ? run.stderr : null;
  if (compileError || javaCompileError) {
    return {
      verdict: 'CE',
      compileOutput: compileError || javaCompileError.replace(/class PjLaunch__ \{.*?\} \} /g, ''),
      runOutput: null, executionTimeMs: null, memoryKb: null, testResults: []
    };
  }

  const byIndex = new Map(results.map(r => [r.index, r]));

  let verdict = 'AC';
  let failed = null;
  const testResults = cases.map((testCase, i) => {
    const r = byIndex.get(i + 1);
    const expected = blockLines(testCase.expected).join('\n');
    if (!r) {
      return { index: i + 1, input: clip(blockLines(testCase.input).join('\n')), expected: clip(expected), output: '', cpu_ms: null, memory_kb: null, result: 'SKIPPED' };
    }
    let result = r.status === 'OK'
      ? (compareOutputs([[r.output, expected]]).accepted ? 'OK' : 'WA')
      : r.status;
    if (result !== 'OK' && !failed) failed = { index: i + 1, result, r };
    return {
      index: i + 1,
      input: clip(blockLines(testCase.input).join('\n')),
      expected: clip(expected),
      output: clip(blockLines(r.output).join('\n')),
      cpu_ms: r.cpuMs,
      memory_kb: r.memoryKb || null,
      result
    };
  });

  let runOutput = null;
  if (failed) {
    verdict = failed.result;
    runOutput = `Test ${failed.index}: ${failed.result}` +
      (failed.result === 'RE' ? ` (exit code ${failed.r.exitCode})` : '') +
      (failed.result === 'TLE' ? ` (limit ${timeLimitMs} ms)` : '') +
      (failed.result === 'MLE' ? ` (limit ${perTestMemoryMb} MB)` : '');
  } else if (results.length < cases.length) {
    // The run ended before every test was judged.
    if (endReason === 'budget' || run.status === 'TO') {
      verdict = 'TLE';
      runOutput = `Judging stopped after ${results.length} of ${cases.length} tests: the total time for all tests ran out.`;
    } else if (run.status || run.signal || run.code) {
      // The sandbox killed the whole run (e.g. a fork bomb hitting the
      // process limit), taking the driver with it. That is the program's
      // fault, not the judge's: report RE on the test that was running.
      const index = results.length + 1;
      verdict = 'RE';
      runOutput = `Test ${index}: RE (the program was killed by the sandbox: too many processes or resources)`;
      if (testResults[index - 1]) testResults[index - 1].result = 'RE';
    } else {
      throw new JudgeInfraError(`Judge driver ended early after ${results.length} of ${cases.length} tests (${run.status || 'no status'}${run.message ? ': ' + run.message : ''})`);
    }
  }

  const judged = results.filter(r => r.status === 'OK');
  return {
    verdict,
    compileOutput: null,
    runOutput,
    executionTimeMs: judged.length ? Math.max(...judged.map(r => r.cpuMs)) : (run.wall_time || null),
    memoryKb: judged.length ? Math.max(...judged.map(r => r.memoryKb || 0)) || null : null,
    testResults
  };
}

// Run code against a test file and produce the full verdict.
//   inputMode 'multi'  (default): one run, all tests at once, input starts with t
//   inputMode 'single': each test is run on its own (no t), see judgeSingle
// Throws JudgeInfraError when Piston itself fails.
export async function judge(opts) {
  if (opts.inputMode === 'single' && opts.testFile.cases) return judgeSingle(opts);
  return judgeMulti(opts);
}

async function judgeMulti({ language, code, testFile, timeLimitMs, memoryLimitMb }) {
  let data;
  try {
    data = await executePiston({ language, code, stdin: testFile.input, runTimeoutMs: timeLimitMs, memoryLimitMb });
  } catch (err) {
    throw new JudgeInfraError(err.message);
  }

  const run = data.run || {};
  const executionTimeMs = run.wall_time || null;
  const memoryKb = run.memory ? Math.round(run.memory / 1024) : null;
  const limits = effectiveLimits(language, timeLimitMs, memoryLimitMb);
  const resT = classifyRun(data, limits.memoryLimitMb);

  let verdict;
  let compileOutput = null;
  let runOutput = null;
  let actual = '';

  if (resT.kind === 'CE') {
    verdict = 'CE';
    compileOutput = resT.compileOutput;
  } else if (resT.kind === 'TLE') {
    verdict = 'TLE';
    runOutput = `Time limit exceeded (${limits.runTimeoutMs} ms)`;
  } else if (resT.kind === 'MLE') {
    verdict = 'MLE';
    runOutput = `Memory limit exceeded (${limits.memoryLimitMb} MB)`;
  } else if (resT.kind === 'RE') {
    verdict = 'RE';
    runOutput = resT.runOutput || resT.message || 'Runtime error';
  } else {
    // Output produced: compare the FULL stdout vs the FULL expected output.
    actual = resT.output;
    verdict = compareOutputs([[actual, testFile.expected]]).accepted ? 'AC' : 'WA';
    runOutput = verdict === 'WA' ? actual : null;
  }

  return {
    verdict,
    compileOutput,
    runOutput,
    executionTimeMs,
    memoryKb,
    testResults: buildTestResults(testFile, actual, executionTimeMs, memoryKb, verdict)
  };
}
