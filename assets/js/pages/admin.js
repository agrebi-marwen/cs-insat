// admin.js - Command Center admin terminal
// Bootstrap: config.js + common.js must load before this file.
// Uses shared helpers from common.js: supabaseClient, escapeHtml, safeUrl, toDriveEmbed.

initApp(initAdminPage);

// SECURITY SETTINGS - The terminal password is verified server-side
// (api/adminCheck.js) and is never exposed to the client.
let isRoleAuthorized = false;
let isPasswordAuthorized = false;

const overlay = document.getElementById('security-overlay');
const adminPanel = document.getElementById('admin-panel-content');
const authError = document.getElementById('auth-error');
const passInput = document.getElementById('admin-pass-input');
const authBtn = document.getElementById('admin-auth-btn');

// Add event listeners only if the elements exist
if (passInput) {
  passInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') window.checkAdminPassword();
  });
}
if (authBtn) {
  authBtn.addEventListener('click', () => window.checkAdminPassword());
}

async function initAdminPage(client, config) {
  // Verify admin role after client is ready
  await verifyAdminRole();
}

// DATABASE ROLE VERIFICATION
async function verifyAdminRole() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

  if (sessionError || !session || !session.user) {
    alert("Please log in first.");
    window.location.href = "../account/login.html";
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    alert("ACCESS DENIED: Administrative credentials required.");
    window.location.href = "../dashboard/dashboard.html";
    return;
  }

  isRoleAuthorized = true;
  overlay.style.display = "flex";
  passInput.focus();
}

// PASSWORD VERIFICATION - server-side via api/adminCheck.js
window.checkAdminPassword = async function() {
  if (!isRoleAuthorized) return;

  const inputVal = passInput.value;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || !session.access_token) {
    authError.textContent = "Session expired. Please log in again.";
    window.location.href = "../account/login.html";
    return;
  }

  authError.textContent = "Verifying password...";
  passInput.disabled = true;

  try {
    const response = await fetch('../api/adminCheck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ password: inputVal })
    });

    const result = await response.json();

    if (response.ok && result.authorized) {
      isPasswordAuthorized = true;
      authError.textContent = "";
      passInput.value = "";

      overlay.style.display = "none";
      adminPanel.style.display = "block";

      fetchPendingSubmissions();
      loadChallengeCategories();
      loadRoadmaps();
      loadWorkshopCategories();
      loadWorkshops();
      loadNodeRoadmaps();
    } else {
      authError.textContent = (result && result.error) || "Access denied: invalid password.";
      passInput.value = "";
      passInput.focus();
    }
  } catch (err) {
    authError.textContent = "Verification service is unavailable.";
    passInput.value = "";
    passInput.focus();
  } finally {
    passInput.disabled = false;
  }
};

// SUBMIT NEW CHALLENGES
const challengeForm = document.getElementById('challenge-form');
const creationMessage = document.getElementById('creation-message');
const submitBtn = document.getElementById('submit-btn');
const submissionsList = document.getElementById('submissions-list');

challengeForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating challenge...";
  creationMessage.textContent = "";

  const title = document.getElementById('title').value.trim();
  const points_worth = parseInt(document.getElementById('points_worth').value, 10);
  const instructions = document.getElementById('instructions').value.trim();
  const is_active = document.getElementById('is_active').checked;
  const categorySlct = document.getElementById('challenge-category');
  const category_id = categorySlct.value;
  const categorySlug = categorySlct.options[categorySlct.selectedIndex]?.dataset?.slug || '';
  const isCp = categorySlug === 'competitive-programming';
  const tags = document.getElementById('challenge-tags').value.trim();

  const currentDate = new Date();
  const month_year = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase();

  const payload = { title, instructions, month_year, points_worth, is_active };
  if (category_id) {
    payload.category_id = category_id;
  }
  if (tags) {
    payload.tags = tags;
  }

  // --- CP: gather judge config before creating anything -----------------------
  let cpConfig = null;
  if (isCp) {
    const timeLimitMs = parseInt(document.getElementById('cp-time-limit').value, 10);
    const memoryLimitMb = parseInt(document.getElementById('cp-memory-limit').value, 10);
    const languages = [];
    if (document.getElementById('cp-lang-cpp').checked) languages.push('c++');
    if (document.getElementById('cp-lang-c').checked) languages.push('c');
    if (document.getElementById('cp-lang-python').checked) languages.push('python');
    if (document.getElementById('cp-lang-java').checked) languages.push('java');

    const fileInput = document.getElementById('cp-test-file');
    if (languages.length === 0) {
      cpFail("Select at least one allowed language.");
      return;
    }
    if (!fileInput.files || !fileInput.files[0]) {
      cpFail("Attach a test cases JSON file.");
      return;
    }

    const validation = validateTestCases(await readJsonFile(fileInput.files[0]));
    if (!validation.ok) {
      cpFail("Test file: " + validation.error);
      return;
    }

    cpConfig = {
      timeLimitMs,
      memoryLimitMb,
      languages,
      allowMultipleSubmissions: document.getElementById('cp-allow-multiple').checked,
      testCount: validation.testCount
    };
  }

  const { data: inserted, error } = await supabaseClient
    .from('challenges')
    .insert([payload])
    .select();

  if (error) {
    cpFail("Failed: " + error.message);
    return;
  }

  const challengeId = inserted && inserted[0] && inserted[0].id;

  // --- CP: upload gzipped tests + create the problem row -----------------------
  if (cpConfig && challengeId) {
    try {
      const fileInput = document.getElementById('cp-test-file');
      const rawText = await readJsonFile(fileInput.files[0]);
      const { gz, err } = await gzipBytes(new Blob([rawText]))
        .then(bytes => ({ gz: bytes }))
        .catch(e => ({ err: e }));
      if (err) throw new Error("Failed to compress test file: " + err.message);

      const testFilePath = `${challengeId}/tests.json.gz`;

      // Confirm which user is attached to the client performing the upload.
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      const { data: identity } = await supabaseClient.auth.getUser();
      console.log("[cp] uploading test file as user:", identity?.user?.id || session?.user?.id);
      if (sessionError || !session?.access_token) {
        throw new Error("Session invalid — please log in again.");
      }

      // Upload server-side with the service role key. Direct client uploads to
      // the private bucket are rejected by storage.objects RLS (Storage can
      // evaluate the authenticated request under the anon role), so the gzipped
      // archive is posted to our API route, which bypasses RLS. See
      // api/cpTestUpload.js.
      const gzBase64 = await blobToBase64(gz);
      const upRes = await fetch('../api/cpTestUpload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ challengeId, gzipBase64: gzBase64 })
      });

      const upResult = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upResult.ok) {
        let message = upResult.error || `Storage upload failed (${upRes.status})`;
        if (/row[- ]level security|supabase_storage_admin/i.test(String(message))) {
          message += " — the upload must use SUPABASE_SERVICE_ROLE_KEY to bypass storage RLS; confirm that env var is set in Vercel.";
        }
        throw new Error("Failed to upload test file: " + message);
      }

      const { error: cpErr } = await supabaseClient.from('cp_problems').insert([{
        challenge_id: challengeId,
        time_limit_ms: cpConfig.timeLimitMs,
        memory_limit_mb: cpConfig.memoryLimitMb,
        languages: cpConfig.languages,
        allow_multiple_submissions: cpConfig.allowMultipleSubmissions,
        test_file_path: testFilePath
      }]);

      if (cpErr) {
        throw new Error("Challenge created but judge config failed: " + cpErr.message);
      }

      creationMessage.style.color = "#83b5d1";
      creationMessage.textContent = `Success! CP challenge published (${cpConfig.testCount} sub-tests, single-input judge).`;
    } catch (cpErr) {
      creationMessage.style.color = "#fe4e00";
      creationMessage.textContent = cpErr.message;
    }
  } else {
    creationMessage.style.color = "#83b5d1";
    creationMessage.textContent = `Success! Challenge published (${month_year}).`;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Create Challenge";
  challengeForm.reset();
  document.getElementById('is_active').checked = true;
  document.getElementById('cp-allow-multiple').checked = false;
  syncCpSettingsVisibility();
});

function cpFail(message) {
  creationMessage.style.color = "#fe4e00";
  creationMessage.textContent = message;
  submitBtn.disabled = false;
  submitBtn.textContent = "Create Challenge";
}

// Read a File as text.
function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsText(file);
  });
}

// Read a Blob/File as a bare base64 string (strips the data-URL prefix).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

// Validate + normalize the uploaded test JSON.
// Codeforces style: a single { input, expected } pair where the input text
// STARTS with the number of sub-tests "t" followed by all t data sets, and
// expected holds the concatenated output for all of them (the judge runs the
// user's code exactly once against the whole input).
function validateTestCases(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, error: "Invalid JSON (" + err.message + ")" };
  }

  let pair = parsed;
  if (Array.isArray(parsed)) {
    if (parsed.length === 1) pair = parsed[0];
    else return { ok: false, error: "must be a single { input, expected } object (Codeforces style)" };
  }

  if (!pair || typeof pair !== 'object') return { ok: false, error: "must be an object with string fields 'input' and 'expected'" };
  if (typeof pair.input !== 'string' || typeof pair.expected !== 'string') {
    return { ok: false, error: "must have string fields 'input' and 'expected'" };
  }

  const firstLine = pair.input.trim().split(/\r?\n/, 1)[0].trim();
  if (!/^\d+$/.test(firstLine)) {
    return { ok: false, error: "input must begin with the number of tests t (Codeforces style)" };
  }

  return { ok: true, testCount: parseInt(firstLine, 10) };
}

// Gzip a Blob using the browser's CompressionStream.
async function gzipBytes(blob) {
  const cs = new CompressionStream('gzip');
  const reader = blob.stream().pipeThrough(cs);
  const chunks = [];
  const rdr = reader.getReader();
  while (true) {
    const { done, value } = await rdr.read();
    if (done) break;
    chunks.push(value);
  }
  return new Blob(chunks, { type: 'application/gzip' });
}

// Toggle CP-specific fields based on the selected category.
const cpSettingsBlock = document.getElementById('cp-settings');

function syncCpSettingsVisibility() {
  const slct = document.getElementById('challenge-category');
  const slug = slct.options[slct.selectedIndex]?.dataset?.slug || '';
  if (cpSettingsBlock) cpSettingsBlock.style.display = slug === 'competitive-programming' ? 'block' : 'none';
}

document.getElementById('challenge-category').addEventListener('change', syncCpSettingsVisibility);

// PENDING SUBMISSIONS
async function fetchPendingSubmissions() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: submissions, error } = await supabaseClient
    .from('submissions')
    .select(`
            id,
            submission_url,
            submitted_at,
            status,
            user_id,
            challenge_id,
            profiles (username),
            cp_submission_details (verdict, language)
        `)
    .eq('status', 'PENDING');

  if (error) {
    console.error("Failed to load timeline queue:", error);
    return;
  }

  const { data: challenges } = await supabaseClient.from('challenges').select('id, title');
  const challengeLookup = {};
  if (challenges) {
    challenges.forEach(c => challengeLookup[c.id] = c.title);
  }

  renderSubmissions(submissions, challengeLookup);
}

// RENDERING ENGINE
function renderSubmissions(submissions, challengeLookup) {
  submissionsList.innerHTML = "";

  if (!submissions || submissions.length === 0) {
    submissionsList.innerHTML = `<p class="empty-state">No pending submissions to review.</p>`;
    return;
  }

  submissions.forEach(sub => {
    const username = sub.profiles?.username || "Unknown Member";
    const challengeTitle = challengeLookup[sub.challenge_id] || "Active Challenge";
    const dateRaw = sub.submitted_at || sub.created_at;
    const date = dateRaw ? new Date(dateRaw).toLocaleString() : "Recently";
    const cpDetails = sub.cp_submission_details || null;
    const cpDetail = Array.isArray(cpDetails) ? cpDetails[0] : cpDetails;

    const card = document.createElement('div');
    card.className = "sub-card";

    const resourceBlock = cpDetail && cpDetail.verdict !== 'PENDING'
      ? `<div style="background: rgba(0,0,0,0.2); padding: 10px; border: 2px solid rgba(131,181,209,0.15);">
          <span style="color: #6e8296; font-size: 0.8rem; display:block; margin-bottom:2px;">Language & Verdict:</span>
          <span style="color: #83b5d1; font-size: 0.9rem; font-family: 'VT323', monospace;">${escapeHtml(cpDetail.language || '').toUpperCase()} — ${escapeHtml(cpDetail.verdict || 'PENDING')}</span>
        </div>`
      : (sub.submission_url
          ? `<div style="background: rgba(0,0,0,0.2); padding: 10px; border: 2px solid rgba(131,181,209,0.15);">
              <span style="color: #6e8296; font-size: 0.8rem; display:block; margin-bottom:2px;">Repository URL:</span>
              <a href="${escapeHtml(safeUrl(sub.submission_url))}" target="_blank" rel="noopener noreferrer" style="color: #83b5d1; font-size: 0.9rem; word-break: break-all; text-decoration: none;">
                ${escapeHtml(sub.submission_url)} ↗
              </a>
            </div>`
          : `<div style="background: rgba(0,0,0,0.2); padding: 10px; border: 2px solid rgba(131,181,209,0.15);">
              <span style="color: #6e8296; font-size: 0.8rem; display:block;">Code submission (judging in progress...)</span>
            </div>`);

    card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="color: var(--text-strong); margin: 0; font-family: 'VT323', monospace; font-size: 1.25rem;">${escapeHtml(challengeTitle)}</h3>
                    <p style="color: #6e8296; font-size: 0.8rem; margin: 4px 0 0 0;"><strong>${escapeHtml(username)}</strong> • ${escapeHtml(date)}</p>
                </div>
                <span style="font-size: 0.8rem; color: #eec643; background: rgba(238, 198, 67, 0.1); padding: 3px 8px; border: 2px solid #eec643; font-family: 'VT323', monospace; text-transform: uppercase;">PENDING</span>
            </div>
            ${resourceBlock}
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                <button class="action-btn btn-approve" data-id="${escapeHtml(sub.id)}" data-action="APPROVED">Approve</button>
                <button class="action-btn btn-reject" data-id="${escapeHtml(sub.id)}" data-action="REJECTED">Reject</button>
            </div>
        `;
    submissionsList.appendChild(card);
  });
}

// RESOLVE PENDING
window.resolveSubmission = async (id, status) => {
  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload.");
    return;
  }

  const { error } = await supabaseClient
    .from('submissions')
    .update({ status: status })
    .eq('id', id);

  if (error) {
    alert("Failure adjusting status: " + error.message);
  } else {
    fetchPendingSubmissions();
  }
};

submissionsList.addEventListener('click', async (e) => {
  const targetButton = e.target.closest('button[data-action]');
  if (!targetButton) return;

  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload.");
    return;
  }

  const submissionId = targetButton.getAttribute('data-id');
  const newStatus = targetButton.getAttribute('data-action');

  const submissionCard = targetButton.closest('.sub-card');

  const siblingButtons = submissionCard ? submissionCard.querySelectorAll('button') : [];
  siblingButtons.forEach(btn => btn.disabled = true);
  targetButton.textContent = "Updating...";

  console.log(`Executing Database Call: Row ${submissionId} changing to state ${newStatus}`);

  const { error } = await supabaseClient
    .from('submissions')
    .update({ status: newStatus })
    .eq('id', submissionId);

  if (error) {
    alert("Failure adjusting status: " + error.message);
    siblingButtons.forEach(btn => btn.disabled = false);
    targetButton.textContent = newStatus === 'APPROVED' ? 'Approve' : 'Reject';
  } else {
    console.log("Database updated successfully!");

    if (submissionCard) {
      submissionCard.style.transition = "all 0.3s ease";
      submissionCard.style.opacity = "0";
      submissionCard.style.transform = "scale(0.95)";

      setTimeout(async () => {
        submissionCard.remove();

        await fetchPendingSubmissions();
      }, 300);
    } else {
      await fetchPendingSubmissions();
    }
  }
});

// ==========================================
// ROADMAP MANAGEMENT (paths + steps)
// ==========================================
const roadmapForm = document.getElementById('roadmap-form');
const roadmapMessage = document.getElementById('roadmap-message');
const roadmapAdminList = document.getElementById('roadmap-admin-list');

roadmapForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  const title = document.getElementById('roadmap-title').value.trim();
  const slug = document.getElementById('roadmap-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
  const description = document.getElementById('roadmap-description').value.trim();
  const difficulty = document.getElementById('roadmap-difficulty').value;

  roadmapMessage.textContent = "Creating learning path...";
  roadmapMessage.style.color = "var(--text-strong)";

  const { error } = await supabaseClient
    .from('roadmaps')
    .insert([{ title, slug, description, difficulty }]);

  if (error) {
    roadmapMessage.style.color = "#fe4e00";
    roadmapMessage.textContent = "Failed: " + error.message;
  } else {
    roadmapMessage.style.color = "#83b5d1";
    roadmapMessage.textContent = `Success! Path "${title}" created.`;
    roadmapForm.reset();
    loadRoadmaps();
  }
});

async function loadRoadmaps() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: roadmaps, error } = await supabaseClient
    .from('roadmaps')
    .select('id, slug, title, description, difficulty')
    .order('created_at', { ascending: true });

  if (error) {
    roadmapAdminList.innerHTML = `<p class="empty-state">Failed to load paths: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!roadmaps || roadmaps.length === 0) {
    roadmapAdminList.innerHTML = `<p class="empty-state">No learning paths yet.</p>`;
    return;
  }

  roadmapAdminList.innerHTML = "";
  roadmaps.forEach(roadmap => {
    roadmapAdminList.appendChild(renderRoadmapCard(roadmap));
  });
}

function renderRoadmapCard(roadmap) {
  const card = document.createElement('div');
  card.classList.add('roadmap-admin-card');
  card.dataset.roadmapId = roadmap.id;

  card.innerHTML = `
        <div class="roadmap-admin-head">
            <div>
                <h3>${escapeHtml(roadmap.title)}</h3>
                <div class="roadmap-admin-meta">/${escapeHtml(roadmap.slug)} • ${escapeHtml(roadmap.difficulty || 'Path')}</div>
            </div>
            <div class="roadmap-admin-actions">
                <button class="roadmap-admin-btn" data-action="edit">Edit</button>
                <button class="roadmap-admin-btn" data-action="steps">Manage Steps</button>
                <button class="roadmap-admin-btn danger" data-action="delete">Delete</button>
            </div>
        </div>
        <div class="roadmap-admin-steps" data-role="steps" style="display: none;">
            <p class="empty-state">Loading steps...</p>
        </div>
    `;

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete path "${roadmap.title}" and ALL its steps?`)) return;
    const { error } = await supabaseClient.from('roadmaps').delete().eq('id', roadmap.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadRoadmaps();
    }
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    toggleRoadmapEdit(card, roadmap);
  });

  card.querySelector('[data-action="steps"]').addEventListener('click', () => {
    const stepsBox = card.querySelector('[data-role="steps"]');
    const isHidden = stepsBox.style.display === 'none';
    stepsBox.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) loadRoadmapSteps(card, roadmap);
  });

  return card;
}

function toggleRoadmapEdit(card, roadmap) {
  const existing = card.querySelector('[data-role="edit"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit';
  form.classList.add('roadmap-edit-form');

  form.innerHTML = `
        <div class="form-group">
            <label>Path Title</label>
            <input type="text" value="${escapeHtml(roadmap.title)}" required>
        </div>
        <div class="form-group">
            <label>Slug</label>
            <input type="text" value="${escapeHtml(roadmap.slug)}" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea required>${escapeHtml(roadmap.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Difficulty</label>
            <select>
                <option value="Beginner" ${roadmap.difficulty === 'Beginner' ? 'selected' : ''}>Beginner</option>
                <option value="Intermediate" ${roadmap.difficulty === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="Advanced" ${roadmap.difficulty === 'Advanced' ? 'selected' : ''}>Advanced</option>
            </select>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Path</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.querySelector('input').value.trim();
    const slug = form.querySelectorAll('input')[1].value.trim().toLowerCase().replace(/\s+/g, '-');
    const description = form.querySelector('textarea').value.trim();
    const difficulty = form.querySelector('select').value;

    const { error } = await supabaseClient
      .from('roadmaps')
      .update({ title, slug, description, difficulty })
      .eq('id', roadmap.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadRoadmaps();
    }
  });

  form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => form.remove());

  card.querySelector('.roadmap-admin-head').after(form);
}

async function loadRoadmapSteps(card, roadmap) {
  const stepsBox = card.querySelector('[data-role="steps"]');
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: steps, error } = await supabaseClient
    .from('roadmap_steps')
    .select('id, title, description, resources, position')
    .eq('roadmap_id', roadmap.id)
    .order('position', { ascending: true });

  if (error) {
    stepsBox.innerHTML = `<p class="empty-state">Failed to load steps: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!steps || steps.length === 0) {
    stepsBox.innerHTML = `<p class="empty-state">No steps yet. Add the first one below.</p>`;
  } else {
    stepsBox.innerHTML = "";
    steps.forEach((step, index) => {
      stepsBox.appendChild(renderRoadmapStep(card, roadmap, step, index, steps.length));
    });
  }

  // Add-step form at the bottom
  const stepForm = document.createElement('form');
  stepForm.classList.add('roadmap-step-form');
  stepForm.innerHTML = `
        <div class="form-group">
            <label>Step Title</label>
            <input type="text" placeholder="e.g., Time Complexity & Big-O" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea placeholder="What should members learn here?" required></textarea>
        </div>
        <div class="form-group">
            <label>Resources (one per line: Title | URL)</label>
            <textarea placeholder="Big-O Cheat Sheet | https://www.bigocheatsheet.com/"></textarea>
        </div>
        <p class="hint">Resources are optional. Format each line as "Title | URL".</p>
        <button type="submit" class="roadmap-admin-btn">+ Add Step</button>
    `;

  stepForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = stepForm.querySelectorAll('input, textarea');
    const title = inputs[0].value.trim();
    const description = inputs[1].value.trim();
    const resourcesRaw = inputs[2].value.trim();

    const resources = resourcesRaw
      ? resourcesRaw.split('\n').map(line => {
        const sep = line.indexOf('|');
        if (sep === -1) return null;
        return { title: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() };
      }).filter(r => r && r.url)
      : [];

    const position = steps ? steps.length : 0;

    const { error } = await supabaseClient
      .from('roadmap_steps')
      .insert([{ roadmap_id: roadmap.id, position, title, description, resources }]);

    if (error) {
      alert("Failed to add step: " + error.message);
    } else {
      loadRoadmapSteps(card, roadmap);
    }
  });

  stepsBox.appendChild(stepForm);
}

function renderRoadmapStep(card, roadmap, step, index, total) {
  const row = document.createElement('div');
  row.classList.add('roadmap-admin-step');
  row.dataset.stepId = step.id;

  row.innerHTML = `
        <span class="roadmap-admin-step-pos">#${index + 1}</span>
        <span class="roadmap-admin-step-title">${escapeHtml(step.title)}</span>
        <div class="roadmap-admin-actions">
            <button class="roadmap-admin-btn" data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="roadmap-admin-btn" data-action="down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
            <button class="roadmap-admin-btn" data-action="edit-step">Edit</button>
            <button class="roadmap-admin-btn danger" data-action="delete-step">Del</button>
        </div>
    `;

  row.querySelector('[data-action="up"]').addEventListener('click', async () => {
    await swapStepPositions(step, -1, roadmap.id);
  });

  row.querySelector('[data-action="down"]').addEventListener('click', async () => {
    await swapStepPositions(step, 1, roadmap.id);
  });

  row.querySelector('[data-action="delete-step"]').addEventListener('click', async () => {
    if (!confirm(`Delete step "${step.title}"?`)) return;
    const { error } = await supabaseClient.from('roadmap_steps').delete().eq('id', step.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadRoadmapSteps(card, roadmap);
    }
  });

  row.querySelector('[data-action="edit-step"]').addEventListener('click', () => {
    toggleStepEdit(card, roadmap, row, step);
  });

  return row;
}

// Swap two steps' positions (move up/down), then reload
async function swapStepPositions(step, direction, roadmapId) {
  const { data: steps } = await supabaseClient
    .from('roadmap_steps')
    .select('id, position')
    .eq('roadmap_id', roadmapId)
    .order('position', { ascending: true });

  const idx = steps.findIndex(s => s.id === step.id);
  const target = steps[idx + direction];
  if (!target) return;

  const { error } = await supabaseClient
    .from('roadmap_steps')
    .upsert([
      { id: step.id, position: target.position },
      { id: target.id, position: step.position }
    ]);

  if (error) {
    alert("Reorder failed: " + error.message);
  } else {
    loadRoadmaps();
  }
}

function toggleStepEdit(card, roadmap, row, step) {
  const existing = row.querySelector('[data-role="edit-step"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit-step';
  form.classList.add('roadmap-edit-form');

  const resourcesText = (Array.isArray(step.resources) ? step.resources : [])
    .map(r => `${r.title} | ${r.url}`).join('\n');

  form.innerHTML = `
        <div class="form-group">
            <label>Step Title</label>
            <input type="text" value="${escapeHtml(step.title)}" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea required>${escapeHtml(step.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Resources (one per line: Title | URL)</label>
            <textarea>${escapeHtml(resourcesText)}</textarea>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Step</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-step-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = form.querySelectorAll('input, textarea');
    const title = inputs[0].value.trim();
    const description = inputs[1].value.trim();
    const resourcesRaw = inputs[2].value.trim();

    const resources = resourcesRaw
      ? resourcesRaw.split('\n').map(line => {
        const sep = line.indexOf('|');
        if (sep === -1) return null;
        return { title: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() };
      }).filter(r => r && r.url)
      : [];

    const { error } = await supabaseClient
      .from('roadmap_steps')
      .update({ title, description, resources })
      .eq('id', step.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadRoadmapSteps(card, roadmap);
    }
  });

  form.querySelector('[data-action="cancel-step-edit"]').addEventListener('click', () => form.remove());

  row.appendChild(form);
}

// ==========================================
// CHALLENGE CATEGORIES (manage)
// ==========================================
const challengeCategoryForm = document.getElementById('challenge-category-form');
const challengeCategoryMessage = document.getElementById('challenge-category-message');
const challengeCategoryList = document.getElementById('challenge-category-list');
const challengeCategorySelect = document.getElementById('challenge-category');

challengeCategoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  const name = document.getElementById('challenge-category-name').value.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  challengeCategoryMessage.textContent = "Creating category...";
  challengeCategoryMessage.style.color = "var(--text-strong)";

  const { error } = await supabaseClient
    .from('challenge_categories')
    .insert([{ name, slug }]);

  if (error) {
    challengeCategoryMessage.style.color = "#fe4e00";
    challengeCategoryMessage.textContent = "Failed: " + error.message;
  } else {
    challengeCategoryMessage.style.color = "#83b5d1";
    challengeCategoryMessage.textContent = `Success! Category "${name}" created.`;
    challengeCategoryForm.reset();
    loadChallengeCategories();
  }
});

async function loadChallengeCategories() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: categories, error } = await supabaseClient
    .from('challenge_categories')
    .select('id, name, slug, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    challengeCategoryList.innerHTML = `<p class="empty-state">Failed to load categories: ${escapeHtml(error.message)}</p>`;
    return;
  }

  // Keep the deploy form's category dropdown in sync
  challengeCategorySelect.innerHTML = `<option value="">Select a category...</option>`;
  (categories || []).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.dataset.slug = cat.slug || '';
    opt.textContent = cat.name;
    challengeCategorySelect.appendChild(opt);
  });
  syncCpSettingsVisibility();

  if (!categories || categories.length === 0) {
    challengeCategoryList.innerHTML = `<p class="empty-state">No categories yet. Add the first one above.</p>`;
    return;
  }

  challengeCategoryList.innerHTML = "";
  categories.forEach(cat => {
    challengeCategoryList.appendChild(renderChallengeCategoryCard(cat));
  });
}

function renderChallengeCategoryCard(category) {
  const card = document.createElement('div');
  card.classList.add('roadmap-admin-card');
  card.dataset.categoryId = category.id;

  card.innerHTML = `
        <div class="roadmap-admin-head">
            <div>
                <h3>${escapeHtml(category.name)}</h3>
                <div class="roadmap-admin-meta">/${escapeHtml(category.slug)}</div>
            </div>
            <div class="roadmap-admin-actions">
                <button class="roadmap-admin-btn" data-action="edit">Edit</button>
                <button class="roadmap-admin-btn danger" data-action="delete">Delete</button>
            </div>
        </div>
    `;

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete category "${category.name}"? Its challenges will be deleted too.`)) return;
    const { error } = await supabaseClient.from('challenge_categories').delete().eq('id', category.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadChallengeCategories();
    }
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    toggleChallengeCategoryEdit(card, category);
  });

  return card;
}

function toggleChallengeCategoryEdit(card, category) {
  const existing = card.querySelector('[data-role="edit"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit';
  form.classList.add('roadmap-edit-form');

  form.innerHTML = `
        <div class="form-group">
            <label>Category Name</label>
            <input type="text" value="${escapeHtml(category.name)}" required>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Category</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.querySelector('input').value.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const { error } = await supabaseClient
      .from('challenge_categories')
      .update({ name, slug })
      .eq('id', category.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadChallengeCategories();
    }
  });

  form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => form.remove());

  card.querySelector('.roadmap-admin-head').after(form);
}

// ==========================================
// WORKSHOP CATEGORIES (manage)
// ==========================================
const workshopCategoryForm = document.getElementById('workshop-category-form');
const workshopCategoryMessage = document.getElementById('workshop-category-message');
const workshopCategoryList = document.getElementById('workshop-category-list');
const workshopCategorySelect = document.getElementById('workshop-category');

workshopCategoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  const name = document.getElementById('workshop-category-name').value.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  workshopCategoryMessage.textContent = "Creating category...";
  workshopCategoryMessage.style.color = "var(--text-strong)";

  const { error } = await supabaseClient
    .from('workshop_categories')
    .insert([{ name, slug }]);

  if (error) {
    workshopCategoryMessage.style.color = "#fe4e00";
    workshopCategoryMessage.textContent = "Failed: " + error.message;
  } else {
    workshopCategoryMessage.style.color = "#83b5d1";
    workshopCategoryMessage.textContent = `Success! Category "${name}" created.`;
    workshopCategoryForm.reset();
    loadWorkshopCategories();
    loadWorkshops();
  }
});

async function loadWorkshopCategories() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: categories, error } = await supabaseClient
    .from('workshop_categories')
    .select('id, name, slug, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    workshopCategoryList.innerHTML = `<p class="empty-state">Failed to load categories: ${escapeHtml(error.message)}</p>`;
    return;
  }

  // Keep the deploy form's category dropdown in sync
  workshopCategorySelect.innerHTML = `<option value="">Select a category...</option>`;
  (categories || []).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    workshopCategorySelect.appendChild(opt);
  });

  if (!categories || categories.length === 0) {
    workshopCategoryList.innerHTML = `<p class="empty-state">No categories yet. Add the first one above.</p>`;
    return;
  }

  workshopCategoryList.innerHTML = "";
  categories.forEach(cat => {
    workshopCategoryList.appendChild(renderWorkshopCategoryCard(cat));
  });
}

function renderWorkshopCategoryCard(category) {
  const card = document.createElement('div');
  card.classList.add('roadmap-admin-card');
  card.dataset.categoryId = category.id;

  card.innerHTML = `
        <div class="roadmap-admin-head">
            <div>
                <h3>${escapeHtml(category.name)}</h3>
                <div class="roadmap-admin-meta">/${escapeHtml(category.slug)}</div>
            </div>
            <div class="roadmap-admin-actions">
                <button class="roadmap-admin-btn" data-action="edit">Edit</button>
                <button class="roadmap-admin-btn danger" data-action="delete">Delete</button>
            </div>
        </div>
    `;

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete category "${category.name}"? Its workshops will be deleted too.`)) return;
    const { error } = await supabaseClient.from('workshop_categories').delete().eq('id', category.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadWorkshopCategories();
      loadWorkshops();
    }
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    toggleCategoryEdit(card, category);
  });

  return card;
}

function toggleCategoryEdit(card, category) {
  const existing = card.querySelector('[data-role="edit"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit';
  form.classList.add('roadmap-edit-form');

  form.innerHTML = `
        <div class="form-group">
            <label>Category Name</label>
            <input type="text" value="${escapeHtml(category.name)}" required>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Category</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.querySelector('input').value.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const { error } = await supabaseClient
      .from('workshop_categories')
      .update({ name, slug })
      .eq('id', category.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadWorkshopCategories();
      loadWorkshops();
    }
  });

  form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => form.remove());

  card.querySelector('.roadmap-admin-head').after(form);
}

// ==========================================
// WORKSHOPS (deploy + manage)
// ==========================================
const workshopForm = document.getElementById('workshop-form');
const workshopMessage = document.getElementById('workshop-message');
const workshopAdminList = document.getElementById('workshop-admin-list');

workshopForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  const title = document.getElementById('workshop-title').value.trim();
  const category_id = document.getElementById('workshop-category').value;
  const video_url = document.getElementById('workshop-video').value.trim();
  const duration = document.getElementById('workshop-duration').value.trim();
  const description = document.getElementById('workshop-description').value.trim();
  const dateRaw = document.getElementById('workshop-date').value;

  if (!category_id) {
    workshopMessage.style.color = "#fe4e00";
    workshopMessage.textContent = "Failed: select a category first.";
    return;
  }

  if (!toDriveEmbed(video_url)) {
    workshopMessage.style.color = "#fe4e00";
    workshopMessage.textContent = "Failed: provide a valid Google Drive share link.";
    return;
  }

  workshopMessage.textContent = "Creating workshop...";
  workshopMessage.style.color = "var(--text-strong)";

  const payload = { title, category_id, video_url, duration: duration || null, description };
  if (dateRaw) {
    payload.published_at = new Date(dateRaw + 'T00:00:00').toISOString();
  }

  const { error } = await supabaseClient
    .from('workshops')
    .insert([payload]);

  if (error) {
    workshopMessage.style.color = "#fe4e00";
    workshopMessage.textContent = "Failed: " + error.message;
  } else {
    workshopMessage.style.color = "#83b5d1";
    workshopMessage.textContent = `Success! Workshop "${title}" created.`;
    workshopForm.reset();
    loadWorkshops();
  }
});

async function loadWorkshops() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: workshops, error } = await supabaseClient
    .from('workshops')
    .select('id, title, description, video_url, duration, published_at, category_id, workshop_categories (id, name, slug)')
    .order('published_at', { ascending: false });

  if (error) {
    workshopAdminList.innerHTML = `<p class="empty-state">Failed to load workshops: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!workshops || workshops.length === 0) {
    workshopAdminList.innerHTML = `<p class="empty-state">No workshops yet.</p>`;
    return;
  }

  workshopAdminList.innerHTML = "";
  workshops.forEach(workshop => {
    workshopAdminList.appendChild(renderWorkshopCard(workshop));
  });
}

function renderWorkshopCard(workshop) {
  const card = document.createElement('div');
  card.classList.add('roadmap-admin-card');
  card.dataset.workshopId = workshop.id;

  const catName = workshop.workshop_categories?.name || 'Uncategorized';
  const date = workshop.published_at ? new Date(workshop.published_at).toLocaleDateString() : '';
  const metaParts = [catName, workshop.duration, date].filter(Boolean).join(' • ');

  card.innerHTML = `
        <div class="roadmap-admin-head">
            <div>
                <h3>${escapeHtml(workshop.title)}</h3>
                <div class="roadmap-admin-meta">${escapeHtml(metaParts)}</div>
            </div>
            <div class="roadmap-admin-actions">
                <button class="roadmap-admin-btn" data-action="edit">Edit</button>
                <button class="roadmap-admin-btn danger" data-action="delete">Delete</button>
            </div>
        </div>
    `;

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete workshop "${workshop.title}"?`)) return;
    const { error } = await supabaseClient.from('workshops').delete().eq('id', workshop.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadWorkshops();
    }
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    toggleWorkshopEdit(card, workshop);
  });

  return card;
}

function toggleWorkshopEdit(card, workshop) {
  const existing = card.querySelector('[data-role="edit"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit';
  form.classList.add('roadmap-edit-form');

  const dateValue = workshop.published_at ? new Date(workshop.published_at).toISOString().slice(0, 10) : '';

  // Build a fresh category dropdown, preselecting the workshop's category
  const catOptions = Array.from(workshopCategorySelect.options)
    .map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === workshop.category_id ? 'selected' : ''}>${escapeHtml(opt.textContent)}</option>`)
    .join('');

  form.innerHTML = `
        <div class="form-group">
            <label>Workshop Title</label>
            <input type="text" value="${escapeHtml(workshop.title)}" required>
        </div>
        <div class="form-group">
            <label>Category</label>
            <select>${catOptions || '<option value="">Select a category...</option>'}</select>
        </div>
        <div class="form-group">
            <label>Google Drive Link</label>
            <input type="text" value="${escapeHtml(workshop.video_url)}" required>
        </div>
        <div class="form-group">
            <label>Duration (e.g., 42:15)</label>
            <input type="text" value="${escapeHtml(workshop.duration || '')}">
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea required>${escapeHtml(workshop.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Published Date</label>
            <input type="date" value="${escapeHtml(dateValue)}">
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Workshop</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = form.querySelectorAll('input, select, textarea');
    const title = inputs[0].value.trim();
    const category_id = inputs[1].value;
    const video_url = inputs[2].value.trim();
    const duration = inputs[3].value.trim();
    const description = inputs[4].value.trim();
    const dateRaw = inputs[5].value;

    if (!category_id) {
      alert("Select a category.");
      return;
    }

    if (!toDriveEmbed(video_url)) {
      alert("Provide a valid Google Drive share link.");
      return;
    }

    const payload = { title, category_id, video_url, duration: duration || null, description };
    if (dateRaw) {
      payload.published_at = new Date(dateRaw + 'T00:00:00').toISOString();
    } else {
      payload.published_at = null;
    }

    const { error } = await supabaseClient
      .from('workshops')
      .update(payload)
      .eq('id', workshop.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadWorkshops();
    }
  });

  form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => form.remove());

  card.querySelector('.roadmap-admin-head').after(form);
}

// ==========================================
// ROADMAP NODES (node-based roadmaps, challenge-tag gated)
// ==========================================
const nodeRoadmapForm = document.getElementById('node-roadmap-form');
const nodeRoadmapMessage = document.getElementById('node-roadmap-message');
const nodeRoadmapAdminList = document.getElementById('node-roadmap-admin-list');

nodeRoadmapForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isRoleAuthorized || !isPasswordAuthorized) {
    alert("Session expired. Please reload and log in again.");
    window.location.reload();
    return;
  }

  const title = document.getElementById('node-roadmap-title').value.trim();
  const slug = document.getElementById('node-roadmap-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
  const description = document.getElementById('node-roadmap-description').value.trim();
  const difficulty = document.getElementById('node-roadmap-difficulty').value;

  nodeRoadmapMessage.textContent = "Creating roadmap...";
  nodeRoadmapMessage.style.color = "var(--text-strong)";

  const { error } = await supabaseClient
    .from('roadmaps')
    .insert([{ title, slug, description, difficulty, type: 'nodes' }]);

  if (error) {
    nodeRoadmapMessage.style.color = "#fe4e00";
    nodeRoadmapMessage.textContent = "Failed: " + error.message;
  } else {
    nodeRoadmapMessage.style.color = "#83b5d1";
    nodeRoadmapMessage.textContent = `Success! Field "${title}" created. Now add nodes.`;
    nodeRoadmapForm.reset();
    loadNodeRoadmaps();
  }
});

async function loadNodeRoadmaps() {
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: roadmaps, error } = await supabaseClient
    .from('roadmaps')
    .select('id, slug, title, description, difficulty')
    .eq('type', 'nodes')
    .order('created_at', { ascending: true });

  if (error) {
    nodeRoadmapAdminList.innerHTML = `<p class="empty-state">Failed to load roadmaps: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!roadmaps || roadmaps.length === 0) {
    nodeRoadmapAdminList.innerHTML = `<p class="empty-state">No node roadmaps yet. Create the first one above.</p>`;
    return;
  }

  nodeRoadmapAdminList.innerHTML = "";
  roadmaps.forEach(roadmap => {
    nodeRoadmapAdminList.appendChild(renderNodeRoadmapCard(roadmap));
  });
}

function renderNodeRoadmapCard(roadmap) {
  const card = document.createElement('div');
  card.classList.add('roadmap-admin-card');
  card.dataset.roadmapId = roadmap.id;

  card.innerHTML = `
        <div class="roadmap-admin-head">
            <div>
                <h3>${escapeHtml(roadmap.title)}</h3>
                <div class="roadmap-admin-meta">/${escapeHtml(roadmap.slug)} • ${escapeHtml(roadmap.difficulty || 'Field')}</div>
            </div>
            <div class="roadmap-admin-actions">
                <button class="roadmap-admin-btn" data-action="nodes">Manage Nodes</button>
                <button class="roadmap-admin-btn" data-action="edit">Edit</button>
                <button class="roadmap-admin-btn danger" data-action="delete">Delete</button>
            </div>
        </div>
        <div class="roadmap-admin-steps" data-role="nodes" style="display: none;">
            <p class="empty-state">Loading nodes...</p>
        </div>
    `;

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete field "${roadmap.title}" and ALL its nodes?`)) return;
    const { error } = await supabaseClient.from('roadmaps').delete().eq('id', roadmap.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadNodeRoadmaps();
    }
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    toggleNodeRoadmapEdit(card, roadmap);
  });

  card.querySelector('[data-action="nodes"]').addEventListener('click', () => {
    const nodesBox = card.querySelector('[data-role="nodes"]');
    const isHidden = nodesBox.style.display === 'none';
    nodesBox.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) loadNodes(card, roadmap);
  });

  return card;
}

function toggleNodeRoadmapEdit(card, roadmap) {
  const existing = card.querySelector('[data-role="edit"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit';
  form.classList.add('roadmap-edit-form');

  form.innerHTML = `
        <div class="form-group">
            <label>Field Title</label>
            <input type="text" value="${escapeHtml(roadmap.title)}" required>
        </div>
        <div class="form-group">
            <label>Slug</label>
            <input type="text" value="${escapeHtml(roadmap.slug)}" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea required>${escapeHtml(roadmap.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Difficulty</label>
            <select>
                <option value="Beginner" ${roadmap.difficulty === 'Beginner' ? 'selected' : ''}>Beginner</option>
                <option value="Intermediate" ${roadmap.difficulty === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="Advanced" ${roadmap.difficulty === 'Advanced' ? 'selected' : ''}>Advanced</option>
            </select>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Field</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.querySelector('input').value.trim();
    const slug = form.querySelectorAll('input')[1].value.trim().toLowerCase().replace(/\s+/g, '-');
    const description = form.querySelector('textarea').value.trim();
    const difficulty = form.querySelector('select').value;

    const { error } = await supabaseClient
      .from('roadmaps')
      .update({ title, slug, description, difficulty })
      .eq('id', roadmap.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadNodeRoadmaps();
    }
  });

  form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => form.remove());

  card.querySelector('.roadmap-admin-head').after(form);
}

// Parse "Title | URL" lines into the resources jsonb array
function parseResourcesText(raw) {
  return raw
    ? String(raw).split('\n').map(line => {
      const sep = line.indexOf('|');
      if (sep === -1) return null;
      return { title: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() };
    }).filter(r => r && r.url)
    : [];
}

// Normalize a space-separated tag input like "#Arrays #Binary Search" into an array of tag strings
function parseRequiredTags(raw) {
  return String(raw || '')
    .split(/\s+/)
    .map(t => t.trim().replace(/^#+/, ''))
    .filter(Boolean);
}

async function loadNodes(card, roadmap) {
  const nodesBox = card.querySelector('[data-role="nodes"]');
  if (!isRoleAuthorized || !isPasswordAuthorized) return;

  const { data: nodes, error } = await supabaseClient
    .from('roadmap_nodes')
    .select('id, title, description, required_tags, resources, position')
    .eq('roadmap_id', roadmap.id)
    .order('position', { ascending: true });

  if (error) {
    nodesBox.innerHTML = `<p class="empty-state">Failed to load nodes: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!nodes || nodes.length === 0) {
    nodesBox.innerHTML = `<p class="empty-state">No nodes yet. Add the first one below.</p>`;
  } else {
    nodesBox.innerHTML = "";
    nodes.forEach((node, index) => {
      nodesBox.appendChild(renderNodeRow(card, roadmap, node, index, nodes.length));
    });
  }

  // Add-node form at the bottom
  const nodeForm = document.createElement('form');
  nodeForm.classList.add('roadmap-step-form');
  nodeForm.innerHTML = `
        <div class="form-group">
            <label>Node Title</label>
            <input type="text" placeholder="e.g., Arrays" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea placeholder="What should members master here?" required></textarea>
        </div>
        <div class="form-group">
            <label>Required Tags (space-separated, e.g. #Arrays #DataStructures)</label>
            <input type="text" placeholder="#Arrays #DataStructures">
            <p class="hint">User must have an APPROVED submission on a challenge carrying ALL listed tags to unlock this node.</p>
        </div>
        <div class="form-group">
            <label>Resources (one per line: Title | URL)</label>
            <textarea placeholder="Arrays guide | https://example.com/arrays"></textarea>
        </div>
        <button type="submit" class="roadmap-admin-btn">+ Add Node</button>
    `;

  nodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = nodeForm.querySelectorAll('input, textarea');
    const title = inputs[0].value.trim();
    const description = inputs[1].value.trim();
    const required_tags = parseRequiredTags(inputs[2].value);
    const resources = parseResourcesText(inputs[3].value);

    const position = nodes ? nodes.length : 0;

    const { error } = await supabaseClient
      .from('roadmap_nodes')
      .insert([{ roadmap_id: roadmap.id, position, title, description, required_tags, resources }]);

    if (error) {
      alert("Failed to add node: " + error.message);
    } else {
      loadNodes(card, roadmap);
    }
  });

  nodesBox.appendChild(nodeForm);
}

function renderNodeRow(card, roadmap, node, index, total) {
  const row = document.createElement('div');
  row.classList.add('roadmap-admin-step');
  row.dataset.nodeId = node.id;

  const tagsChip = (Array.isArray(node.required_tags) && node.required_tags.length)
    ? `<span class="roadmap-admin-step-title">${escapeHtml(node.title)} <span style="color: var(--neon-yellow);">[${escapeHtml(node.required_tags.map(t => '#' + t).join(' '))}]</span></span>`
    : `<span class="roadmap-admin-step-title">${escapeHtml(node.title)}</span>`;

  row.innerHTML = `
        <span class="roadmap-admin-step-pos">#${index + 1}</span>
        ${tagsChip}
        <div class="roadmap-admin-actions">
            <button class="roadmap-admin-btn" data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="roadmap-admin-btn" data-action="down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
            <button class="roadmap-admin-btn" data-action="edit-node">Edit</button>
            <button class="roadmap-admin-btn danger" data-action="delete-node">Del</button>
        </div>
    `;

  row.querySelector('[data-action="up"]').addEventListener('click', async () => {
    await swapNodePositions(node, -1, roadmap.id, card, row);
  });

  row.querySelector('[data-action="down"]').addEventListener('click', async () => {
    await swapNodePositions(node, 1, roadmap.id, card, row);
  });

  row.querySelector('[data-action="delete-node"]').addEventListener('click', async () => {
    if (!confirm(`Delete node "${node.title}"?`)) return;
    const { error } = await supabaseClient.from('roadmap_nodes').delete().eq('id', node.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadNodes(card, roadmap);
    }
  });

  row.querySelector('[data-action="edit-node"]').addEventListener('click', () => {
    toggleNodeEdit(card, roadmap, row, node);
  });

  return row;
}

async function swapNodePositions(node, direction, roadmapId, card, row) {
  const { data: nodes } = await supabaseClient
    .from('roadmap_nodes')
    .select('id, position')
    .eq('roadmap_id', roadmapId)
    .order('position', { ascending: true });

  const idx = nodes.findIndex(n => n.id === node.id);
  const target = nodes[idx + direction];
  if (!target) return;

  const { error } = await supabaseClient
    .from('roadmap_nodes')
    .upsert([
      { id: node.id, position: target.position },
      { id: target.id, position: node.position }
    ]);

  if (error) {
    alert("Reorder failed: " + error.message);
  } else {
    loadNodes(card, { id: roadmapId });
  }
}

function toggleNodeEdit(card, roadmap, row, node) {
  const existing = row.querySelector('[data-role="edit-node"]');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.dataset.role = 'edit-node';
  form.classList.add('roadmap-edit-form');

  const tagsText = (Array.isArray(node.required_tags) ? node.required_tags : []).map(t => '#' + t).join(' ');
  const resourcesText = (Array.isArray(node.resources) ? node.resources : [])
    .map(r => `${r.title} | ${r.url}`).join('\n');

  form.innerHTML = `
        <div class="form-group">
            <label>Node Title</label>
            <input type="text" value="${escapeHtml(node.title)}" required>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea required>${escapeHtml(node.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Required Tags (space-separated)</label>
            <input type="text" value="${escapeHtml(tagsText)}">
        </div>
        <div class="form-group">
            <label>Resources (one per line: Title | URL)</label>
            <textarea>${escapeHtml(resourcesText)}</textarea>
        </div>
        <div class="roadmap-admin-actions">
            <button type="submit" class="roadmap-admin-btn">Save Node</button>
            <button type="button" class="roadmap-admin-btn" data-action="cancel-node-edit">Cancel</button>
        </div>
    `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = form.querySelectorAll('input, textarea');
    const title = inputs[0].value.trim();
    const description = inputs[1].value.trim();
    const required_tags = parseRequiredTags(inputs[2].value);
    const resources = parseResourcesText(inputs[3].value);

    const { error } = await supabaseClient
      .from('roadmap_nodes')
      .update({ title, description, required_tags, resources })
      .eq('id', node.id);

    if (error) {
      alert("Update failed: " + error.message);
    } else {
      loadNodes(card, roadmap);
    }
  });

  form.querySelector('[data-action="cancel-node-edit"]').addEventListener('click', () => form.remove());

  row.appendChild(form);
}