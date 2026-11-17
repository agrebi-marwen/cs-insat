// POST /api/cpSubmit - competitive programming judge.
//
// Authenticates the caller, loads the admin-provided test file from private
// storage, runs the submitted code ONCE on Piston against the whole
// Codeforces-style input, compares full stdout with the expected output and
// persists the verdict.
//
//   one attempt -> one Piston execute call -> one comparison
//
// Request  : { challengeId, code, language }
// Response : { verdict, passed, total, failedTest, executionTimeMs, memoryKb,
//              compileOutput, runOutput, testResults } or { error }

import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import {
  buildTestResults,
  classifyRun,
  isLanguage,
  LANGUAGES,
  MAX_CODE_LENGTH,
  MAX_TEST_FILE_BYTES,
  outputsMatch,
  parseTestFile,
  type TestCaseResult,
  type TestFile,
  type Verdict,
} from '@/lib/judge';
import { authenticate } from '@/lib/server/auth';
import { fail, json, parseBody } from '@/lib/server/http';
import { executePiston, type PistonResult } from '@/lib/server/piston';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const schema = z.object({
  challengeId: z.string().trim().min(1, 'challengeId is required'),
  language: z.string().refine(isLanguage, 'Unsupported language'),
  code: z
    .string()
    .refine((c) => c.trim().length > 0, 'Code is empty')
    .refine((c) => c.length <= MAX_CODE_LENGTH, `Code is too large (max ${MAX_CODE_LENGTH} bytes)`),
});

interface CpProblem {
  languages: string[] | null;
  time_limit_ms: number | null;
  memory_limit_mb: number | null;
  test_file_path: string;
}

type Admin = ReturnType<typeof createAdminClient>;

async function loadTestFile(admin: Admin, path: string): Promise<{ file: TestFile; testCount: number }> {
  const { data, error } = await admin.storage.from('cp-tests').download(path);
  if (error || !data) throw new Error(`Failed to fetch test file (${error?.message ?? 'not found'})`);

  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_TEST_FILE_BYTES) throw new Error('Test archive exceeds the 4 MB cap');

  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch (err) {
    throw new Error('Test file is not a valid gzip JSON archive: ' + (err as Error).message);
  }
  const result = parseTestFile(parsed);
  if (!result.ok) throw new Error('Test file ' + result.error);
  return { file: result.file, testCount: result.testCount };
}

export async function POST(request: Request) {
  const caller = await authenticate(request);
  if (!caller) return fail('Authentication required', 401);

  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const { challengeId, code } = body.data;
  const language = body.data.language;
  if (!isLanguage(language)) return fail('Unsupported language', 400);

  const admin = createAdminClient();

  try {
    // --- Challenge + judge config -------------------------------------------
    const { data: cpRows, error: cpError } = await admin
      .from('cp_problems')
      .select('languages, time_limit_ms, memory_limit_mb, test_file_path')
      .eq('challenge_id', challengeId)
      .limit(1);
    if (cpError) throw new Error(cpError.message);

    const cp = (cpRows?.[0] ?? null) as CpProblem | null;
    if (!cp) return fail('This challenge is not a graded CP problem', 400);

    const allowed = Array.isArray(cp.languages) && cp.languages.length ? cp.languages : LANGUAGES;
    if (!allowed.includes(language)) {
      return fail(`Language ${language} is not enabled for this problem`, 400);
    }

    const timeLimitMs = cp.time_limit_ms || 1000;
    const memoryLimitMb = cp.memory_limit_mb || 256;
    const { file, testCount } = await loadTestFile(admin, cp.test_file_path);

    // Atomically enforce the per-challenge policy and create both history rows.
    // The RPC takes a transaction-scoped advisory lock, so concurrent requests
    // cannot bypass the one-submission or in-progress restrictions.
    const { data: created, error: createError } = await admin.rpc('create_cp_submission', {
      p_user_id: caller.userId,
      p_challenge_id: challengeId,
      p_language: language,
      p_code: code,
    });
    const row = (Array.isArray(created) ? created[0] : created) as
      | { submission_id: string; detail_id: string }
      | null
      | undefined;
    if (createError || !row) {
      const message = createError?.message || 'Failed to record submission';
      const conflict = /already succeeded|Only one submission|already being judged/i.test(message);
      return fail(message, conflict ? 409 : 500);
    }

    // Persist the verdict + award points (idempotent) in one SQL call.
    const complete = async (
      verdict: Verdict,
      extra: {
        compileOutput?: string | null;
        runOutput?: string | null;
        executionTimeMs?: number | null;
        memoryKb?: number | null;
        testResults?: TestCaseResult[];
      } = {},
    ) => {
      const { error } = await admin.rpc('complete_cp_submission', {
        p_submission_id: row.submission_id,
        p_detail_id: row.detail_id,
        p_verdict: verdict,
        p_compile_output: extra.compileOutput ?? null,
        p_run_output: extra.runOutput ?? null,
        p_execution_time_ms: extra.executionTimeMs != null ? Math.round(extra.executionTimeMs) : null,
        p_memory_kb: extra.memoryKb ?? null,
        p_test_results: extra.testResults ?? [],
      });
      if (error) console.error('complete_cp_submission failed:', error.message);
      return !error;
    };

    // --- Judge: one execution against the whole input ------------------------
    let data: PistonResult;
    try {
      data = await executePiston({ language, code, stdin: file.input, runTimeoutMs: timeLimitMs, memoryLimitMb });
    } catch (err) {
      const message = (err as Error).message;
      console.error('Piston execution error:', message);
      // Close the submission so it does not stay "being judged" forever.
      await complete('RE', { runOutput: `Judge infrastructure error: ${message}` });
      return fail(`Judge execution service unavailable: ${message}`, 502);
    }

    const run = data.run ?? {};
    const executionTimeMs = run.wall_time || null;
    const memoryKb = run.memory ? Math.round(run.memory / 1024) : null;

    const outcome = classifyRun(data);
    let verdict: Verdict;
    let compileOutput: string | null = null;
    let runOutput: string | null = null;
    let actual = '';

    if (outcome.kind === 'CE') {
      verdict = 'CE';
      compileOutput = outcome.compileOutput;
    } else if (outcome.kind === 'TLE') {
      verdict = 'TLE';
      runOutput = `Time limit exceeded (${timeLimitMs} ms)`;
    } else if (outcome.kind === 'RE') {
      verdict = 'RE';
      runOutput = outcome.runOutput || outcome.message || 'Runtime error';
    } else {
      actual = outcome.output;
      verdict = outputsMatch(actual, file.expected) ? 'AC' : 'WA';
      runOutput = verdict === 'WA' ? actual : null;
    }

    const testResults = buildTestResults(file, actual, testCount || 1, executionTimeMs, memoryKb, verdict);

    const saved = await complete(verdict, { compileOutput, runOutput, executionTimeMs, memoryKb, testResults });
    if (!saved) return fail('The verdict could not be saved. Please contact an admin.', 500);

    return json({
      verdict,
      passed: verdict === 'AC' ? 1 : 0,
      total: 1,
      failedTest: verdict === 'AC' ? null : 1,
      executionTimeMs,
      memoryKb,
      compileOutput,
      runOutput,
      testResults,
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error('cpSubmit error:', message);
    return fail(message || 'Judge failed', 500);
  }
}
