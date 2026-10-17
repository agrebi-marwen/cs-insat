// submit.js - Submit a solution to a challenge
// Bootstrap: config.js + common.js must load before this file.

initApp(initSubmitPage);

// DOM Elements
const challengeTitle = document.getElementById('challenge-title');
const challengeMonth = document.getElementById('challenge-month');
const challengePoints = document.getElementById('challenge-points');
const challengeInstructions = document.getElementById('challenge-instructions');
const submissionForm = document.getElementById('submission-form');
const submissionUrl = document.getElementById('submission-url');
const submissionMessage = document.getElementById('submission-message');
const submitBtn = document.getElementById('submit-btn');

const repoBlock = document.getElementById('repo-submit-block');
const cpBlock   = document.getElementById('cp-submit-block');
const cpLangSlct = document.getElementById('cp-language');
const cpLimitsEl = document.getElementById('cp-limits');
const cpFileInput = document.getElementById('cp-file');
const cpFileNameEl = document.getElementById('cp-file-name');
const cpSubmitBtn = document.getElementById('cp-submit-btn');
const cpRunBtn = document.getElementById('cp-run-btn');
const cpDropEl = document.getElementById('cp-drop');
const cpVerdictEl = document.getElementById('cp-verdict');
const cpTestResultsEl = document.getElementById('cp-test-results');

const freebieBlock = document.getElementById('freebie-submit-block');
const freebieForm = document.getElementById('freebie-form');
const freebieAnswer = document.getElementById('freebie-answer');
const freebieSubmitBtn = document.getElementById('freebie-submit-btn');

let currentUserId = null;
let challengeId = null;
let isCpChallenge = false;
let cpAllowMultipleSubmissions = false;
let isFreebieChallenge = false;

const MAX_CODE_LENGTH = 256 * 1024; // 256 KB of source

// Extra time / minimum memory the judge gives each language on top of the
// problem's limits (keep in sync with LANG_CONFIG in api/_lib/piston.js).
const LANG_ALLOWANCE = {
  java:   { extraTimeMs: 2000, minMemoryMb: 256 },
  python: { minMemoryMb: 64 }
};
let cpTimeLimitMs = 1000;
let cpMemoryLimitMb = 256;
let cpInputMode = 'multi';

// Show the limits that apply to the selected language as two HUD cells.
function updateCpLimits() {
  const allowance = LANG_ALLOWANCE[cpLangSlct.value] || {};
  const tl = cpTimeLimitMs + (allowance.extraTimeMs || 0);
  const ml = Math.max(cpMemoryLimitMb, allowance.minMemoryMb || 0);
  const langName = cpLangSlct.options[cpLangSlct.selectedIndex]?.textContent || '';
  const cell = (label, value, unit, base) => `
    <div class="cp-limit">
      <span class="cp-limit-label">${label}</span>
      <span class="cp-limit-value">${value}<small>${unit}</small></span>
      ${base != null ? `<span class="cp-limit-note">problem: ${base} ${unit}</span>` : ''}
    </div>`;
  // One test per run: limits apply to each test, and Java's JVM start-up is
  // paid once, so it gets no extra time per test.
  const perTest = cpInputMode === 'single';
  const shownTl = perTest ? cpTimeLimitMs : tl;
  cpLimitsEl.innerHTML =
    cell('Time', shownTl, 'ms', shownTl !== cpTimeLimitMs ? cpTimeLimitMs : null) +
    cell('Memory', ml, 'MB', ml !== cpMemoryLimitMb ? cpMemoryLimitMb : null) +
    `<p class="cp-format">${perTest
      ? 'Read the input exactly as shown in the examples and print the answer. Your program is run once for every test.'
      : '<strong>The input starts with the number of test cases <code>t</code>.</strong> Read <code>t</code> first, then answer each test case on its own line, as in the examples.'}</p>`;
  cpLimitsEl.setAttribute('aria-label', `Limits for ${langName}: ${tl} milliseconds, ${ml} megabytes`);
}

function setFileStatus(text, isError) {
  cpFileNameEl.textContent = text;
  cpDropEl.classList.toggle('is-error', !!isError);
  cpDropEl.classList.toggle('has-file', !isError && text !== 'Choose a source file');
}

// Let users drop a source file onto the picker.
function bindDropZone() {
  ['dragenter', 'dragover'].forEach(type => cpDropEl.addEventListener(type, e => {
    e.preventDefault();
    cpDropEl.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach(type => cpDropEl.addEventListener(type, () => cpDropEl.classList.remove('is-dragging')));
  cpDropEl.addEventListener('drop', e => {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    cpFileInput.files = files;
    handleFileSelect();
  });
}

const FILE_LANG = {
  '.c': 'c',
  '.cpp': 'c++',
  '.cc': 'c++',
  '.cxx': 'c++',
  '.c++': 'c++',
  '.h': 'c++',
  '.hpp': 'c++',
  '.py': 'python',
  '.py3': 'python',
  '.java': 'java'
};

async function initSubmitPage() {
  const session = await requireSession();
  if (!session) return;

  currentUserId = session.user.id;
  loadUsername(currentUserId, document.getElementById('nav-username'));

  const params = new URLSearchParams(window.location.search);
  challengeId = params.get('id') || params.get('challenge_id') || params.get('challenge');
  if (!challengeId) {
    challengeTitle.textContent = "Challenge Not Found";
    challengeInstructions.innerHTML = 'This page needs a challenge link. <a href="challenges.html">Return to Challenges</a> and select an active challenge.';
    submitBtn.disabled = true;
    cpSubmitBtn && (cpSubmitBtn.disabled = true);
    cpRunBtn && (cpRunBtn.disabled = true);
    freebieSubmitBtn && (freebieSubmitBtn.disabled = true);
    return;
  }

  await loadChallengeDetails();
  await loadCpConfig();
  showSubmitBlock();
  await applySubmissionAvailability();
}

async function loadChallengeDetails() {
  const { data: challenge, error } = await supabaseClient
    .from('challenges')
    .select('*, challenge_categories(id, slug, name)')
    .eq('id', challengeId)
    .single();

  if (error || !challenge) {
    challengeTitle.textContent = "Loading Failed";
    challengeInstructions.textContent = "Could not load this challenge. It may have been removed.";
    console.error("Fetch challenge error:", error);
    submitBtn.disabled = true;
    cpSubmitBtn && (cpSubmitBtn.disabled = true);
    cpRunBtn && (cpRunBtn.disabled = true);
    freebieSubmitBtn && (freebieSubmitBtn.disabled = true);
    return;
  }

  const cat = challenge.challenge_categories;
  isFreebieChallenge = !!(cat && (cat.slug === 'freebie' || String(cat.name || '').toLowerCase() === 'freebie'));

  challengeTitle.textContent = challenge.title;
  challengeMonth.textContent = challenge.month_year || "Active Challenge";
  challengePoints.textContent = `Reward: ${challenge.points_worth} pts`;
  document.title = `${challenge.title} · The Time Portal`;
  if (window.renderStatement) {
    window.renderStatement(challengeInstructions, challenge.instructions);
  } else {
    challengeInstructions.textContent = challenge.instructions;
  }

  const detailsCard = document.querySelector('.challenge-details-card');
  if (detailsCard && window.applyEpochColor && window.epochHue) {
    window.applyEpochColor(detailsCard, window.epochHue(challenge.month_year));
  }
}

// Fetch CP judge config. If present → show CP block; else stay on repo block.
async function loadCpConfig() {
  const { data, error } = await supabaseClient
    .from('cp_problems')
    .select('*')
    .eq('challenge_id', challengeId)
    .maybeSingle();

  if (error || !data) return; // Not a CP challenge — use repo form.

  isCpChallenge = true;
  cpAllowMultipleSubmissions = data.allow_multiple_submissions === true;
  repoBlock.style.display = 'none';
  cpBlock.style.display = 'block';
  submissionForm.style.display = 'none';

  const allowed = Array.isArray(data.languages) && data.languages.length
    ? data.languages
    : ['c++', 'c', 'python', 'java'];

  cpLangSlct.innerHTML = '';
  allowed.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang === 'c++' ? 'C++' : lang === 'c' ? 'C' : lang === 'python' ? 'Python 3' : 'Java';
    cpLangSlct.appendChild(opt);
  });

  cpTimeLimitMs = data.time_limit_ms || 1000;
  cpMemoryLimitMb = data.memory_limit_mb || 256;
  cpInputMode = data.input_mode === 'single' ? 'single' : 'multi';
  updateCpLimits();

  cpLangSlct.addEventListener('change', updateCpLimits);
  cpFileInput.addEventListener('change', handleFileSelect);
  bindDropZone();
  cpSubmitBtn.addEventListener('click', handleCpSubmit);
  cpRunBtn.addEventListener('click', handleCpRun);
}

// Pick which submission UI is shown: freebie > CP > repo.
function showSubmitBlock() {
  if (isFreebieChallenge) {
    repoBlock.style.display = 'none';
    submissionForm.style.display = 'none';
    cpBlock.style.display = 'none';
    freebieBlock.style.display = 'block';
  }
}

// A source file was picked — validate size and auto-detect the language from
// its extension so the user only has to attach a file and submit.
function handleFileSelect() {
  const file = cpFileInput.files && cpFileInput.files[0];
  if (!file) return;

  if (file.size > MAX_CODE_LENGTH) {
    setFileStatus(`${file.name} is too large (max 256 KB). Choose a smaller file.`, true);
    return;
  }

  const ext = (file.name.match(/(\.[^.]+)$/) || [])[1] || '';
  const inferred = FILE_LANG[ext.toLowerCase()];
  if (inferred) {
    const allowedVals = Array.from(cpLangSlct.options).map(o => o.value);
    if (allowedVals.includes(inferred)) {
      cpLangSlct.value = inferred;
      updateCpLimits();
    }
  }

  const size = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`;
  setFileStatus(`${file.name} · ${size}`, false);
}

// This is only UX feedback; cpSubmit.js and the database RPC enforce the same
// rules authoritatively.
async function getSubmissionPolicy() {
  const { data, error } = await supabaseClient
    .from('submissions')
    .select('status, submission_url, submitted_at')
    .eq('user_id', currentUserId)
    .eq('challenge_id', challengeId);

  if (error) {
    console.error("Submission policy check failed:", error);
    return { allowed: true };
  }

  const subs = Array.isArray(data) ? data : [];
  if (isCpChallenge && !cpAllowMultipleSubmissions && subs.length > 0) {
    return {
      allowed: false,
      reason: "Only one submission is allowed for this challenge."
    };
  }
  if (subs.some(s => s.status === 'APPROVED')) {
    return {
      allowed: false,
      reason: "You've already succeeded on this challenge, so you can't submit again."
    };
  }
  // A CP submission pending for over 2 minutes is stale (the judge stopped);
  // the server closes it on the next attempt, so it must not block here.
  const STALE_MS = 2 * 60 * 1000;
  if (subs.some(s => s.status === 'PENDING' && !s.submission_url &&
      Date.now() - new Date(s.submitted_at).getTime() < STALE_MS)) {
    return {
      allowed: false,
      reason: "A submission is currently being judged. Wait for the verdict before submitting again."
    };
  }
  return { allowed: true, reason: null };
}

function showSubmissionMessage(text, color) {
  submissionMessage.textContent = text;
  submissionMessage.style.color = color;
}

// On load, lock the forms if the user is not eligible to submit right now.
async function applySubmissionAvailability() {
  const policy = await getSubmissionPolicy();
  if (!policy.allowed) {
    submitBtn.disabled = true;
    cpSubmitBtn.disabled = true;
    freebieSubmitBtn.disabled = true;
    showSubmissionMessage(policy.reason, "#fe4e00");
    // Running on samples records nothing, so it stays available.
  }
}

// Read the currently selected file as UTF-8 text (used at submit time).
function readSelectedFile() {
  const file = cpFileInput.files && cpFileInput.files[0];
  if (!file) return Promise.resolve('');
  if (file.size > MAX_CODE_LENGTH) return Promise.resolve('');

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });
}

// Handle Form Submission (repo)
submissionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submissionMessage.textContent = "Submitting solution...";
  submissionMessage.style.color = "var(--text-strong)";

  const url = submissionUrl.value.trim();
  const gitUrlRegex = /^https?:\/\/(www\.)?(github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i;

  if (!gitUrlRegex.test(url)) {
    submissionMessage.textContent = "Invalid URL. Please provide a valid GitHub or GitLab repository link.";
    submissionMessage.style.color = "#fe4e00";
    submitBtn.disabled = false;
    return;
  }

  const policy = await getSubmissionPolicy();
  if (!policy.allowed) {
    showSubmissionMessage(policy.reason, "#fe4e00");
    submitBtn.disabled = false;
    return;
  }

  const { error } = await supabaseClient
    .from('submissions')
    .insert([{
      user_id: currentUserId,
      challenge_id: challengeId,
      submission_url: url,
      status: 'PENDING',
      submitted_at: new Date().toISOString()
    }]);

  if (error) {
    submissionMessage.textContent = "Failed to submit solution: " + error.message;
    submissionMessage.style.color = "#fe4e00";
    submitBtn.disabled = false;
  } else {
    submissionMessage.textContent = "Solution submitted! Waiting for admin approval.";
    submissionMessage.style.color = "#83b5d1";
    submissionUrl.value = "";
    submitBtn.textContent = "Solution Submitted";

    if (window.burstParticles) {
      const rect = submitBtn.getBoundingClientRect();
      const hue = window.epochHue ? window.epochHue(challengeMonth.textContent) : undefined;
      window.burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, hue);
    }

    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Solution";
    }, 3000);
  }
});

// Freebie challenge — a short-text answer that is always accepted. The user
// must not learn that it always succeeds, so the flow mirrors a normal repo
// submission (submit -> "waiting for admin approval") even though approval is
// instant. The usual policy still applies: one successful submission per user.
freebieForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = freebieAnswer.value.trim();
  if (!text) {
    showSubmissionMessage("Enter your answer first.", "#fe4e00");
    return;
  }

  const policy = await getSubmissionPolicy();
  if (!policy.allowed) {
    showSubmissionMessage(policy.reason, "#fe4e00");
    return;
  }

  freebieSubmitBtn.disabled = true;
  showSubmissionMessage("Submitting solution...", "var(--text-strong)");

  const { error } = await supabaseClient
    .from('submissions')
    .insert([{
      user_id: currentUserId,
      challenge_id: challengeId,
      submission_url: null,
      notes: text,
      status: 'APPROVED',
      submitted_at: new Date().toISOString()
    }]);

  if (error) {
    showSubmissionMessage("Failed to submit solution: " + error.message, "#fe4e00");
    freebieSubmitBtn.disabled = false;
    return;
  }

  freebieAnswer.value = "";
  showSubmissionMessage("Solution submitted! Waiting for admin approval.", "#83b5d1");
  freebieSubmitBtn.textContent = "Solution Submitted";

  if (window.burstParticles) {
    const rect = freebieSubmitBtn.getBoundingClientRect();
    const hue = window.epochHue ? window.epochHue(challengeMonth.textContent) : undefined;
    window.burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, hue);
  }

  setTimeout(() => {
    freebieSubmitBtn.disabled = false;
    freebieSubmitBtn.textContent = "Submit Solution";
  }, 3000);
});

// Verdict explanations shown under the badge.
const VERDICT_TEXT = {
  WA: 'Wrong answer: output does not match the expected output.',
  TLE: 'Time limit exceeded.',
  MLE: 'Memory limit exceeded.',
  CE: 'Compilation error.',
  RE: 'Runtime error during execution.'
};

function renderTestResults(results) {
  if (!cpTestResultsEl) return;
  if (!Array.isArray(results) || results.length === 0) {
    cpTestResultsEl.style.display = 'none';
    return;
  }
  const norm = r => String(r || 'PENDING').toUpperCase();
  const isOk = r => r === 'OK' || r === 'AC';
  const passed = results.filter(t => isOk(norm(t.result))).length;

  // Segmented strip: one cell per test, in order.
  const strip = results.map(t => {
    const r = norm(t.result);
    return `<span class="cp-seg ${isOk(r) ? 'cp-seg-ok' : `cp-seg-${escapeHtml(r.toLowerCase())}`}" title="Test ${escapeHtml(String(t.index))}: ${escapeHtml(isOk(r) ? 'passed' : r)}"></span>`;
  }).join('');

  cpTestResultsEl.innerHTML = `
    <div class="cp-results-head">
      <strong>Tests</strong>
      <span class="cp-results-count"><b>${passed}</b> / ${results.length} passed</span>
    </div>
    <div class="cp-strip" role="img" aria-label="${passed} of ${results.length} tests passed">${strip}</div>
    <div class="cp-test-list">
    ${results.map(test => {
      const result = norm(test.result);
      const resultClass = isOk(result) ? 'cp-v-ac' : `cp-v-${result.toLowerCase()}`;
      return `
        <details class="cp-test-result">
          <summary>
            <span class="cp-test-name">Test ${escapeHtml(String(test.index ?? ''))}</span>
            <span class="cp-detail-verdict ${escapeHtml(resultClass)}">${escapeHtml(isOk(result) ? 'OK' : result)}</span>
          </summary>
          <div class="cp-test-panels">
            <div><span class="cp-panel-label">Input</span><pre>${escapeHtml(test.input || '')}</pre></div>
            <div><span class="cp-panel-label">Expected</span><pre>${escapeHtml(test.expected || '')}</pre></div>
            <div><span class="cp-panel-label">Your output</span><pre>${escapeHtml(test.output || '')}</pre></div>
          </div>
        </details>`;
    }).join('')}
    </div>
    <small class="cp-results-note">Time and memory are measured for the whole run: ${escapeHtml(String(results[0].cpu_ms ?? '—'))} ms, ${escapeHtml(String(results[0].memory_kb ?? '—'))} KB.</small>`;
  cpTestResultsEl.style.display = 'block';
}

function renderVerdict(data, isSampleRun) {
  const verdict = String(data.verdict || '');
  const detail = verdict === 'AC'
    ? `${isSampleRun ? 'All sample tests passed' : 'All tests passed'} in ${data.executionTimeMs || 0} ms.`
    : (VERDICT_TEXT[verdict] || `Verdict: ${verdict}`);
  const extra = verdict === 'CE' && data.compileOutput
    ? `<pre class="cp-compile-output">${escapeHtml(String(data.compileOutput).slice(0, 2000))}</pre>`
    : '';
  cpVerdictEl.className = `cp-verdict cp-verdict-${escapeHtml(verdict.toLowerCase())}`;
  cpVerdictEl.innerHTML = `
    <div class="cp-verdict-main">
      <span class="cp-verdict-badge verdict-${escapeHtml(verdict.toLowerCase())}">${escapeHtml(verdict)}</span>
      <div class="cp-verdict-text">
        <span class="cp-verdict-kind">${isSampleRun ? 'Sample run · not submitted' : 'Graded submission'}</span>
        <span class="cp-verdict-detail">${escapeHtml(detail)}</span>
      </div>
    </div>${extra}`;
  cpVerdictEl.style.display = 'block';
}

// Shared request flow for "Run on samples" (cpRun) and "Run & Submit" (cpSubmit).
async function callJudge(endpoint, button, busyLabel, idleLabel) {
  const code = await readSelectedFile();
  if (!code.trim()) {
    showSubmissionMessage("Attach a source file with your solution first.", "#fe4e00");
    return null;
  }

  button.disabled = true;
  button.textContent = busyLabel;
  cpVerdictEl.style.display = 'none';

  const session = await supabaseClient.auth.getSession();
  const token = session && session.data && session.data.session && session.data.session.access_token;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || '')
      },
      body: JSON.stringify({ challengeId, code, language: cpLangSlct.value })
    });
    const data = await res.json();
    if (!res.ok) {
      showSubmissionMessage(data.error || "Judge request failed.", "#fe4e00");
      return null;
    }
    return data;
  } catch (err) {
    showSubmissionMessage("Judge request failed: " + err.message, "#fe4e00");
    return null;
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

// Run against the sample tests only: nothing is recorded, no attempt used.
async function handleCpRun() {
  if (!currentUserId || !challengeId) return;
  showSubmissionMessage("Running your code on the sample tests (not submitted)...", "var(--text-strong)");

  const data = await callJudge('../api/cpRun', cpRunBtn, "Running...", "Run on samples");
  if (!data) return;

  renderVerdict(data, true);
  renderTestResults(data.testResults);
  showSubmissionMessage(
    data.verdict === 'AC'
      ? "Sample tests passed. This was not a submission: use Run & Submit to be graded."
      : "Sample run finished. This was not a submission and did not use an attempt.",
    data.verdict === 'AC' ? "#83b5d1" : "var(--text-mid)"
  );
}

// Handle CP submission (attached source file → judge endpoint)
async function handleCpSubmit() {
  if (!currentUserId || !challengeId) return;

  const policy = await getSubmissionPolicy();
  if (!policy.allowed) {
    cpVerdictEl.style.display = 'none';
    showSubmissionMessage(policy.reason, "#fe4e00");
    return;
  }

  showSubmissionMessage("Running your code against test cases...", "var(--text-strong)");
  const data = await callJudge('../api/cpSubmit', cpSubmitBtn, "Judging...", "Run & Submit");
  if (!data) return;

  renderVerdict(data, false);
  renderTestResults(data.testResults);

  if (data.verdict === 'AC') {
    showSubmissionMessage("Accepted! Submission queued for approval.", "#83b5d1");
    if (window.burstParticles) {
      const rect = cpSubmitBtn.getBoundingClientRect();
      const hue = window.epochHue ? window.epochHue(challengeMonth.textContent) : undefined;
      window.burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, hue);
    }
  } else {
    showSubmissionMessage("Not accepted. Try again!", "#fe4e00");
  }
}
