'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useDashboard } from '@/components/dashboard/DashboardShell';
import { TONE_COLOR, type Message } from '@/components/FormMessage';
import { unwrap, useSupabase } from '@/components/Providers';
import { TestResults } from '@/components/TestResults';
import { FILE_LANG, isLanguage, LANG_CONFIG, LANGUAGES, MAX_CODE_LENGTH } from '@/lib/judge';
import { FRESH } from '@/lib/queries';
import { burstFrom, epochHue, GIT_URL_REGEX, hueStyle } from '@/lib/utils';
import type { Challenge, CpProblemConfig, TestCaseRow } from '@/types/db';

interface JudgeResponse {
  verdict: string;
  executionTimeMs: number | null;
  testResults?: TestCaseRow[];
  error?: string;
}

interface PolicyRow {
  status: string | null;
  submission_url: string | null;
}

const VERDICT_TEXT: Record<string, string> = {
  WA: 'Wrong answer — output does not match the expected output.',
  TLE: 'Time limit exceeded.',
  CE: 'Compilation error.',
  RE: 'Runtime error during execution.',
};

/**
 * UX-only eligibility check. The same rules are enforced authoritatively by
 * /api/cpSubmit and the database (RLS + create_cp_submission).
 */
function submissionBlock(rows: PolicyRow[], isCp: boolean, allowMultiple: boolean): string | null {
  if (isCp && !allowMultiple && rows.length > 0) return 'Only one submission is allowed for this challenge.';
  if (rows.some((s) => s.status === 'APPROVED')) {
    return "You've already succeeded on this challenge, so you can't submit again.";
  }
  if (rows.some((s) => s.status === 'PENDING' && !s.submission_url)) {
    return 'A submission is currently being judged. Wait for the verdict before submitting again.';
  }
  return null;
}

export default function SubmitPage() {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userId, refreshProfile } = useDashboard();
  const params = useSearchParams();
  const challengeId = params.get('id') || params.get('challenge_id') || params.get('challenge');

  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneLabel, setDoneLabel] = useState(false);

  const challengeQ = useQuery({
    queryKey: ['challenge', challengeId],
    enabled: !!challengeId,
    queryFn: () =>
      unwrap<Challenge>(
        supabase.from('challenges').select('*, challenge_categories(id, slug, name)').eq('id', challengeId!).single(),
      ),
  });

  const cpQ = useQuery({
    queryKey: ['cp-config', challengeId],
    enabled: !!challengeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cp_problems')
        .select('languages, time_limit_ms, memory_limit_mb, allow_multiple_submissions')
        .eq('challenge_id', challengeId!)
        .maybeSingle();
      // No row (or no access) simply means "not a CP challenge".
      return error ? null : ((data as CpProblemConfig | null) ?? null);
    },
  });

  const policyQ = useQuery({
    queryKey: ['submission-policy', userId, challengeId],
    enabled: !!challengeId,
    ...FRESH,
    queryFn: () =>
      unwrap<PolicyRow[] | null>(
        supabase.from('submissions').select('status, submission_url').eq('user_id', userId).eq('challenge_id', challengeId!),
      ).then((rows) => rows ?? []),
  });

  const challenge = challengeQ.data;
  const cp = cpQ.data ?? null;
  const cat = challenge?.challenge_categories ?? null;
  const isFreebie = !!cat && (cat.slug === 'freebie' || (cat.name || '').toLowerCase() === 'freebie');
  const isCp = !!cp;
  // Wait for both lookups before choosing a form, so the repo form never
  // flashes (or accepts input) on a CP or freebie challenge.
  const settled = !challengeId || (!challengeQ.isPending && !cpQ.isPending);
  const mode: 'loading' | 'freebie' | 'cp' | 'repo' = !settled
    ? 'loading'
    : isFreebie
      ? 'freebie'
      : isCp
        ? 'cp'
        : 'repo';
  const hue = epochHue(challenge?.month_year);

  const blockReason = policyQ.data
    ? submissionBlock(policyQ.data, isCp, cp?.allow_multiple_submissions === true)
    : null;
  const unavailable = !challengeId || challengeQ.isError || !challenge;
  const disabled = busy || unavailable || !!blockReason;

  // Show the policy reason once known (unless a newer message is on screen).
  useEffect(() => {
    if (blockReason) setMessage((m) => m ?? { text: blockReason, tone: 'error' });
  }, [blockReason]);

  /** Re-check eligibility right before writing, then refresh everything that depends on it. */
  const recheck = async (): Promise<string | null> => {
    const { data } = await policyQ.refetch();
    return data ? submissionBlock(data, isCp, cp?.allow_multiple_submissions === true) : null;
  };
  const afterSubmit = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['submission-policy', userId, challengeId] }),
      queryClient.invalidateQueries({ queryKey: ['my-submissions', userId] }),
      queryClient.invalidateQueries({ queryKey: ['submission-log', userId] }),
      queryClient.invalidateQueries({ queryKey: ['solved-count', userId] }),
      refreshProfile(),
    ]);
  };
  const flashDone = () => {
    setDoneLabel(true);
    setTimeout(() => setDoneLabel(false), 3000);
  };

  // ---- Repository submission --------------------------------------------------
  const repoBtn = useRef<HTMLButtonElement>(null);
  const [repoUrl, setRepoUrl] = useState('');

  const submitRepo = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    const url = repoUrl.trim();
    if (!GIT_URL_REGEX.test(url)) {
      setMessage({ text: 'Invalid URL. Please provide a valid GitHub or GitLab repository link.', tone: 'error' });
      return;
    }
    setBusy(true);
    setMessage({ text: 'Submitting solution...', tone: 'strong' });
    try {
      const reason = await recheck();
      if (reason) return setMessage({ text: reason, tone: 'error' });

      const { error } = await supabase.from('submissions').insert([
        { user_id: userId, challenge_id: challengeId, submission_url: url, status: 'PENDING', submitted_at: new Date().toISOString() },
      ]);
      if (error) return setMessage({ text: 'Failed to submit solution: ' + error.message, tone: 'error' });

      setMessage({ text: 'Solution submitted! Waiting for admin approval.', tone: 'success' });
      setRepoUrl('');
      flashDone();
      burstFrom(repoBtn.current, hue);
      await afterSubmit();
    } finally {
      setBusy(false);
    }
  };

  // ---- Freebie submission ------------------------------------------------------
  // The flow mirrors a normal submission ("waiting for approval") on purpose.
  const freebieBtn = useRef<HTMLButtonElement>(null);
  const [answer, setAnswer] = useState('');

  const submitFreebie = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    const text = answer.trim();
    if (!text) return setMessage({ text: 'Enter your answer first.', tone: 'error' });

    setBusy(true);
    setMessage({ text: 'Submitting solution...', tone: 'strong' });
    try {
      const reason = await recheck();
      if (reason) return setMessage({ text: reason, tone: 'error' });

      const { error } = await supabase.from('submissions').insert([
        { user_id: userId, challenge_id: challengeId, submission_url: null, notes: text, status: 'APPROVED', submitted_at: new Date().toISOString() },
      ]);
      if (error) return setMessage({ text: 'Failed to submit solution: ' + error.message, tone: 'error' });

      setAnswer('');
      setMessage({ text: 'Solution submitted! Waiting for admin approval.', tone: 'success' });
      flashDone();
      burstFrom(freebieBtn.current, hue);
      await afterSubmit();
    } finally {
      setBusy(false);
    }
  };

  // ---- Competitive programming submission ---------------------------------------
  const cpBtn = useRef<HTMLButtonElement>(null);
  const allowedLangs = (cp?.languages?.length ? cp.languages : ['c++', 'c', 'python', 'java']).filter(isLanguage);
  const [language, setLanguage] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<{ text: string; error: boolean } | null>(null);
  const [judged, setJudged] = useState<JudgeResponse | null>(null);
  const selectedLang = allowedLangs.find((l) => l === language) ?? allowedLangs[0] ?? LANGUAGES[0]!;

  const onFile = (picked: File | null) => {
    setFile(null);
    if (!picked) return setFileNote(null);
    if (picked.size > MAX_CODE_LENGTH) return setFileNote({ text: 'File too large (max 256 KB).', error: true });

    // Preselect the language from the extension when it is allowed here.
    const ext = (picked.name.match(/(\.[^.]+)$/)?.[1] ?? '').toLowerCase();
    const inferred = FILE_LANG[ext];
    if (inferred && allowedLangs.includes(inferred)) setLanguage(inferred);

    setFile(picked);
    setFileNote({ text: `${picked.name} (${picked.size} bytes)`, error: false });
  };

  const submitCp = async () => {
    if (!challengeId) return;
    setBusy(true);
    setJudged(null);
    try {
      const reason = await recheck();
      if (reason) return setMessage({ text: reason, tone: 'error' });

      const code = file ? await file.text().catch(() => '') : '';
      if (!code.trim()) {
        return setMessage({ text: 'Attach a source file with your solution first.', tone: 'error' });
      }
      setMessage({ text: 'Running your code against test cases...', tone: 'strong' });

      const res = await fetch('/api/cpSubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code, language: selectedLang }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<JudgeResponse>;

      if (!res.ok || !data.verdict) {
        setMessage({ text: data.error || 'Judge request failed.', tone: 'error' });
      } else {
        setJudged(data as JudgeResponse);
        if (data.verdict === 'AC') {
          setMessage({ text: 'Accepted! Submission queued for approval.', tone: 'success' });
          burstFrom(cpBtn.current, hue);
        } else {
          setMessage({ text: 'Not accepted. Try again!', tone: 'error' });
        }
      }
      await afterSubmit();
    } catch (err) {
      setMessage({ text: 'Judge request failed: ' + (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // ---- Render ---------------------------------------------------------------------
  let title = 'Loading Challenge...';
  let instructions: React.ReactNode = 'Loading challenge details...';
  if (!challengeId) {
    title = 'Challenge Not Found';
    instructions = (
      <>
        This page needs a challenge link. <Link href="/dashboard/challenges">Return to Challenges</Link> and select
        an active challenge.
      </>
    );
  } else if (challengeQ.isError) {
    title = 'Loading Failed';
    instructions = 'Could not load this challenge. It may have been removed.';
  } else if (challenge) {
    title = challenge.title;
    instructions = challenge.instructions;
  }

  const timeLimit = cp?.time_limit_ms || 1000;
  const memoryLimit = cp?.memory_limit_mb || 256;
  const submitLabel = doneLabel ? 'Solution Submitted' : 'Submit Solution';

  return (
    <div className="submit-layout-container">
      <div className="challenge-details-card" style={challenge ? hueStyle(hue) : undefined}>
        <div className="section-badge" id="challenge-month">
          {challenge ? challenge.month_year || 'Active Challenge' : 'Monthly Challenge'}
        </div>
        <h1 id="challenge-title">{title}</h1>
        <div className="challenge-reward" id="challenge-points">
          Reward: {challenge ? `${challenge.points_worth} pts` : '-- EP'}
        </div>

        <div className="challenge-instructions-box">
          <h3>Instructions</h3>
          <p id="challenge-instructions">{instructions}</p>
        </div>
      </div>

      <aside className="submission-panel">
        <div className="submission-card">
          <h3>Submit Your Solution</h3>

          {mode === 'loading' && <p className="sub-text">Loading submission form...</p>}

          {mode === 'repo' && (
            <div id="repo-submit-block">
              <p className="sub-text">Paste the link to your repository below.</p>
              <form id="submission-form" onSubmit={submitRepo}>
                <label htmlFor="submission-url">Repository URL</label>
                <input
                  type="url"
                  id="submission-url"
                  placeholder="https://github.com/username/repository"
                  pattern="^https?:\/\/(www\.)?(github\.com|gitlab\.com)\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+.*$"
                  title="Please enter a valid GitHub or GitLab repository URL (e.g., https://github.com/username/repository)"
                  required
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
                <button type="submit" id="submit-btn" ref={repoBtn} disabled={disabled}>{submitLabel}</button>
              </form>
            </div>
          )}

          {mode === 'cp' && (
            <div id="cp-submit-block">
              <p className="sub-text">
                Attach your source file below. Code is judged against hidden test cases; the language is detected
                from the file extension.
              </p>

              <label htmlFor="cp-language">Language</label>
              <select id="cp-language" value={selectedLang} onChange={(e) => setLanguage(e.target.value)}>
                {allowedLangs.map((lang) => (
                  <option key={lang} value={lang}>{LANG_CONFIG[lang].label}</option>
                ))}
              </select>

              <div className="cp-limits" id="cp-limits">
                Time: {timeLimit} ms &nbsp;·&nbsp; Memory: {memoryLimit} MB &nbsp;·&nbsp; {allowedLangs.length} language
                {allowedLangs.length > 1 ? 's' : ''}
              </div>

              <label htmlFor="cp-file">Source File</label>
              <input
                type="file"
                id="cp-file"
                accept=".c,.cpp,.cc,.cxx,.py,.java"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <div
                className="cp-file-name"
                id="cp-file-name"
                style={{ color: fileNote?.error ? '#fe4e00' : 'var(--text-mid)' }}
              >
                {fileNote?.text ?? ''}
              </div>

              <button type="button" id="cp-submit-btn" className="cp-submit-btn" ref={cpBtn} disabled={disabled} onClick={submitCp}>
                {busy ? 'Judging...' : 'Run & Submit'}
              </button>

              {judged && (
                <>
                  <div id="cp-verdict" className="cp-verdict">
                    <span className={`cp-verdict-badge verdict-${judged.verdict.toLowerCase()}`}>{judged.verdict}</span>{' '}
                    <span className="cp-verdict-detail">
                      {judged.verdict === 'AC'
                        ? `All sub-tests passed (${judged.executionTimeMs || 0} ms).`
                        : (VERDICT_TEXT[judged.verdict] ?? `Verdict: ${judged.verdict}`)}
                    </span>
                  </div>
                  <TestResults results={judged.testResults} />
                </>
              )}
            </div>
          )}

          {mode === 'freebie' && (
            <div id="freebie-submit-block">
              <p className="sub-text">Describe your solution below to claim this challenge.</p>
              <form id="freebie-form" onSubmit={submitFreebie}>
                <label htmlFor="freebie-answer">Your answer</label>
                <textarea
                  id="freebie-answer"
                  placeholder="Type your answer here..."
                  maxLength={500}
                  rows={6}
                  required
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <button type="submit" id="freebie-submit-btn" ref={freebieBtn} disabled={disabled}>{submitLabel}</button>
              </form>
            </div>
          )}

          <div id="submission-message" role="status" aria-live="polite" style={{ color: message ? TONE_COLOR[message.tone] : undefined }}>
            {message?.text ?? ''}
          </div>
        </div>
      </aside>
    </div>
  );
}
