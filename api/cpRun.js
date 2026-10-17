// api/cpRun.js - "Run on samples": judges code against the problem's sample
// tests only (tests marked "sample": true in the test file). Nothing is
// recorded and no attempt is used, so participants can check their code
// before a graded submission. Samples are public, so full details are returned.
//
// Request  : POST /api/cpRun
//            Authorization: Bearer <session token>
//            { challengeId, code, language }
// Response : { verdict, executionTimeMs, memoryKb, compileOutput, runOutput,
//              testResults, error? }

import { applyCommonHeaders, handlePreflight, readBody } from './_lib/http.js';
import { getUser } from './_lib/supabase.js';
import { LANG_CONFIG } from './_lib/piston.js';
import { rest, loadTestFile, sampleTestFile, judge, JudgeInfraError, CONTACT_HOSTS } from './_lib/judge.js';

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

    const samples = sampleTestFile(await loadTestFile(cp.test_file_path));
    if (!samples) {
      res.status(400).json({ error: 'This problem has no sample tests to run. Use the examples in the statement.' });
      return;
    }

    const result = await judge({
      language,
      code,
      testFile: samples,
      timeLimitMs: cp.time_limit_ms || 1000,
      memoryLimitMb: cp.memory_limit_mb || 256,
      inputMode: cp.input_mode || 'multi'
    });

    res.status(200).json({
      verdict: result.verdict,
      executionTimeMs: result.executionTimeMs,
      memoryKb: result.memoryKb,
      compileOutput: result.compileOutput,
      runOutput: result.runOutput,
      testResults: result.testResults
    });
  } catch (err) {
    console.error('cpRun error:', err.message);
    const infra = err instanceof JudgeInfraError;
    res.status(502).json({ error: `${infra ? CONTACT_HOSTS : 'Sample run failed.'} (Details: ${err.message})`, judgeError: infra });
  }
}
