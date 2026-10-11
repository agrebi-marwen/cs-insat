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

  const params = new URLSearchParams(window.location.search);
  challengeId = params.get('id') || params.get('challenge_id') || params.get('challenge');
  if (!challengeId) {
    challengeTitle.textContent = "Challenge Not Found";
    challengeInstructions.innerHTML = 'This page needs a challenge link. <a href="challenges.html">Return to Challenges</a> and select an active challenge.';
    submitBtn.disabled = true;
    cpSubmitBtn && (cpSubmitBtn.disabled = true);
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
    freebieSubmitBtn && (freebieSubmitBtn.disabled = true);
    return;
  }

  const cat = challenge.challenge_categories;
  isFreebieChallenge = !!(cat && (cat.slug === 'freebie' || String(cat.name || '').toLowerCase() === 'freebie'));

  challengeTitle.textContent = challenge.title;
  challengeMonth.textContent = challenge.month_year || "Active Challenge";
  challengePoints.textContent = `Reward: ${challenge.points_worth} pts`;
  challengeInstructions.textContent = challenge.instructions;

  const detailsCard = document.querySelector('.challenge-details-card');
  if (detailsCard && window.applyEpochColor && window.epochHue) {
    window.applyEpochColor(detailsCard, window.epochHue(challenge.month_year));
  }
}

// Fetch CP judge config. If present → show CP block; else stay on repo block.
async function loadCpConfig() {
  const { data, error } = await supabaseClient
    .from('cp_problems')
    .select('languages, time_limit_ms, memory_limit_mb, allow_multiple_submissions')
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

  const tl = data.time_limit_ms || 1000;
  const ml = data.memory_limit_mb || 256;
  cpLimitsEl.textContent = `Time: ${tl} ms  ·  Memory: ${ml} MB  ·  ${allowed.length} language${allowed.length > 1 ? 's' : ''}`;

  cpFileInput.addEventListener('change', handleFileSelect);
  cpSubmitBtn.addEventListener('click', handleCpSubmit);
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
    cpFileNameEl.textContent = 'File too large (max 256 KB).';
    cpFileNameEl.style.color = '#fe4e00';
    return;
  }

  const ext = (file.name.match(/(\.[^.]+)$/) || [])[1] || '';
  const inferred = FILE_LANG[ext.toLowerCase()];
  if (inferred) {
    const allowedVals = Array.from(cpLangSlct.options).map(o => o.value);
    if (allowedVals.includes(inferred)) cpLangSlct.value = inferred;
  }

  cpFileNameEl.textContent = `${file.name} (${file.size} bytes)`;
  cpFileNameEl.style.color = 'var(--text-mid)';
}

// This is only UX feedback; cpSubmit.js and the database RPC enforce the same
// rules authoritatively.
async function getSubmissionPolicy() {
  const { data, error } = await supabaseClient
    .from('submissions')
    .select('status, submission_url')
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
  if (subs.some(s => s.status === 'PENDING' && !s.submission_url)) {
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

// Handle CP submission (attached source file → judge endpoint)
async function handleCpSubmit() {
  if (!currentUserId || !challengeId) return;

  const policy = await getSubmissionPolicy();
  if (!policy.allowed) {
    cpVerdictEl.style.display = 'none';
    showSubmissionMessage(policy.reason, "#fe4e00");
    return;
  }

  cpSubmitBtn.disabled = true;
  cpSubmitBtn.textContent = "Judging...";
  cpVerdictEl.style.display = 'none';
  submissionMessage.textContent = "Running your code against test cases...";
  submissionMessage.style.color = "var(--text-strong)";

  const code = await readSelectedFile();
  const language = cpLangSlct.value;

  if (!code.trim()) {
    submissionMessage.textContent = "Attach a source file with your solution first.";
    submissionMessage.style.color = "#fe4e00";
    cpSubmitBtn.disabled = false;
    cpSubmitBtn.textContent = "Run & Submit";
    return;
  }

  const session = await supabaseClient.auth.getSession();
  const token = session && session.data && session.data.session && session.data.session.access_token;

  try {
    const res = await fetch('../api/cpSubmit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || '')
      },
      body: JSON.stringify({ challengeId, code, language })
    });

    const data = await res.json();

    if (!res.ok) {
      submissionMessage.textContent = data.error || "Judge request failed.";
      submissionMessage.style.color = "#fe4e00";
      cpSubmitBtn.disabled = false;
      cpSubmitBtn.textContent = "Run & Submit";
      return;
    }

    cpVerdictEl.style.display = 'block';
    renderTestResults(data.testResults);

    if (data.verdict === 'AC') {
      cpVerdictEl.innerHTML = `
        <span class="cp-verdict-badge verdict-ac">AC</span>
        <span class="cp-verdict-detail">All sub-tests passed (${data.executionTimeMs || 0} ms).</span>`;
      submissionMessage.textContent = "Accepted! Submission queued for approval.";
      submissionMessage.style.color = "#83b5d1";
    } else {
      const detailText = data.verdict === 'WA'
        ? `Wrong answer — output does not match the expected output.`
        : data.verdict === 'TLE'
        ? `Time limit exceeded.`
        : data.verdict === 'CE'
        ? `Compilation error.`
        : data.verdict === 'RE'
        ? `Runtime error during execution.`
        : `Verdict: ${data.verdict}`;
      cpVerdictEl.innerHTML = `
        <span class="cp-verdict-badge verdict-${data.verdict.toLowerCase()}">${data.verdict}</span>
        <span class="cp-verdict-detail">${escapeHtml(detailText)}</span>`;
      submissionMessage.textContent = "Not accepted. Try again!";
      submissionMessage.style.color = "#fe4e00";
    }

    function renderTestResults(results) {
      if (!cpTestResultsEl || !Array.isArray(results) || results.length === 0) return;
      cpTestResultsEl.innerHTML = `
        <strong>Test cases</strong>
        <div class="cp-test-header"><span>Test</span><span>CPU</span><span>Memory</span><span>Result</span></div>
        ${results.map(test => {
          const result = String(test.result || 'PENDING').toUpperCase();
          const resultClass = result === 'OK' || result === 'AC' ? 'cp-v-ac' : `cp-v-${result.toLowerCase()}`;
          return `
            <details class="cp-test-result">
              <summary>
                <span>Test ${escapeHtml(String(test.index ?? ''))}</span>
                <span>${escapeHtml(String(test.cpu_ms ?? '—'))} ms</span>
                <span>${escapeHtml(String(test.memory_kb ?? '—'))} KB</span>
                <span class="cp-detail-verdict ${escapeHtml(resultClass)}">${escapeHtml(result)}</span>
              </summary>
              <div class="cp-test-panels">
                <div><strong>Input</strong><pre>${escapeHtml(test.input || '')}</pre></div>
                <div><strong>Expected output</strong><pre>${escapeHtml(test.expected || '')}</pre></div>
                <div><strong>Your output</strong><pre>${escapeHtml(test.output || '')}</pre></div>
              </div>
            </details>`;
        }).join('')}
        <small>CPU and memory are measured for the complete program run.</small>`;
      cpTestResultsEl.style.display = 'block';
    }

    if (data.verdict === 'AC' && window.burstParticles) {
      const rect = cpSubmitBtn.getBoundingClientRect();
      const hue = window.epochHue ? window.epochHue(challengeMonth.textContent) : undefined;
      window.burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, hue);
    }
  } catch (err) {
    submissionMessage.textContent = "Judge request failed: " + err.message;
    submissionMessage.style.color = "#fe4e00";
  }

  cpSubmitBtn.disabled = false;
  cpSubmitBtn.textContent = "Run & Submit";
}