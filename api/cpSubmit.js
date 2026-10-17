// api/cpSubmit.js - Serverless CP judge (graded submission).
// Authenticates the caller, loads the admin-provided test file from Supabase
// Storage, runs the submitted code ONCE on Piston against the whole
// Codeforces-style input (which starts with "t" = number of test cases),
// compares the full stdout against the full expected output, then persists
// the verdict.
//
//   one attempt  ->  one Piston execute call  ->  one comparison
//
// Request  : POST /api/cpSubmit
//            Authorization: Bearer <session token>
//            { challengeId, code, language }
// Response : { verdict, passed, total, failedTest, executionTimeMs, memoryKb,
//              compileOutput, runOutput, testResults, error? }
//
// Requires env (Vercel): SUPABASE_SERVICE_ROLE_KEY (so submissions can be
// written server-side and the private test file can be read), PISTON_BASE_URL.

import { applyCommonHeaders, handlePreflight, readBody } from './_lib/http.js';
import { getUser } from './_lib/supabase.js';
import { LANG_CONFIG } from './_lib/piston.js';
import { rest, loadTestFile, judge, JudgeInfraError, CONTACT_HOSTS } from './_lib/judge.js';

const MAX_CODE_LENGTH = 256 * 1024; // 256 KB of source

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

    let testFile;
    try {
      testFile = await loadTestFile(cp.test_file_path);
    } catch (err) {
      // Nothing recorded yet, so the attempt is not used.
      console.error('cpSubmit test file error:', err.message);
      res.status(502).json({ error: `${CONTACT_HOSTS} (Details: ${err.message})`, judgeError: true });
      return;
    }

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
      }
    });
    if (!createResp.ok || !createResp.data || !createResp.data[0]) {
      const message = createResp.data && createResp.data.message
        ? createResp.data.message
        : (createResp.text || 'Failed to record submission');
      const status = /already succeeded|Only one submission|already being judged/i.test(message) ? 409 : 500;
      res.status(status).json({ error: message });
      return;
    }
    const submissionId = createResp.data[0].submission_id;
    const detailId = createResp.data[0].detail_id;

    // Persist the verdict + award points (idempotent) in one SQL call.
    const complete = (verdict, extra = {}) => rest('/rest/v1/rpc/complete_cp_submission', {
      method: 'POST',
      body: {
        p_submission_id: submissionId,
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
    let result;
    try {
      result = await judge({ language, code, testFile, timeLimitMs, memoryLimitMb, inputMode: cp.input_mode || 'multi' });
    } catch (err) {
      if (!(err instanceof JudgeInfraError)) throw err;
      console.error('Piston execution error:', err.message);
      await complete('RE', { runOutput: `Judge infrastructure error: ${err.message}. ${CONTACT_HOSTS}` });
      res.status(502).json({ error: `${CONTACT_HOSTS} (Details: ${err.message})`, judgeError: true });
      return;
    }

    await complete(result.verdict, result);

    res.status(200).json({
      verdict: result.verdict,
      passed: result.verdict === 'AC' ? 1 : 0,
      total: 1,
      failedTest: result.verdict === 'AC' ? null : 1,
      executionTimeMs: result.executionTimeMs,
      memoryKb: result.memoryKb,
      compileOutput: result.compileOutput,
      runOutput: result.runOutput,
      testResults: result.testResults
    });
  } catch (err) {
    console.error('cpSubmit error:', err.message);
    res.status(500).json({ error: `${CONTACT_HOSTS} (Details: ${err.message || 'Judge failed'})`, judgeError: true });
  }
}
