// dashboard.js - Command Center home page
// Bootstrap: config.js + common.js must load before this file.

initApp(initDashboard);

// DOM Elements
const navUsername = document.getElementById('nav-username');
const statRank = document.getElementById('stat-rank');
const statPoints = document.getElementById('stat-points');
const statSolved = document.getElementById('stat-solved');
const statMissions = document.getElementById('stat-missions');
const missionProgress = document.getElementById('mission-progress');
const epochStats = document.getElementById('epoch-stats');
const logoutBtn = document.getElementById('logout-btn');

// Registry + summary elements
const regWorkshops = document.getElementById('reg-workshops');
const regRoadmaps = document.getElementById('reg-roadmaps');
const regSteps = document.getElementById('reg-steps');
const regByCategory = document.getElementById('reg-by-category');
const regByRoadmap = document.getElementById('reg-by-roadmap');
const sumTravelers = document.getElementById('sum-travelers');
const sumWorkshops = document.getElementById('sum-workshops');
const sumRoadmaps = document.getElementById('sum-roadmaps');
const sumMissions = document.getElementById('sum-missions');
const sumRank = document.getElementById('sum-rank');

// Modal Elements
const leaderboardModal = document.getElementById('leaderboard-modal');
const settingsModal = document.getElementById('settings-modal');
const openLeaderboardBtn = document.getElementById('open-leaderboard');
const openSettingsBtn = document.getElementById('open-settings');
const closeLeaderboardBtn = document.getElementById('close-leaderboard');
const closeSettingsBtn = document.getElementById('close-settings');

// Settings Form Elements
const settingsForm = document.getElementById('settings-form');
const settingsUsernameInput = document.getElementById('settings-username');
const settingsPasswordInput = document.getElementById('settings-password');
const settingsMessage = document.getElementById('settings-message');

let currentUser = null;

// ==========================================
// 1. AUTHENTICATION & PROFILE FLOW
// ==========================================
async function initDashboard() {
  setupEventListeners();

  const session = await requireSession();
  if (!session) return;

  currentUser = session.user;

  await fetchUserProfile();
  await fetchDashboardData();
  await fetchRegistry();
}

async function fetchUserProfile() {
  let { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('username, total_points')
    .eq('id', currentUser.id)
    .maybeSingle(); // returns null instead of throwing for "no rows"

  // If no row exists for this user, create it
  if (!profile && !error) {
    const { error: insertError } = await supabaseClient
      .from('profiles')
      .insert({
        id: currentUser.id,
        username: 'User',
        total_points: 0,
      });

    if (insertError) {
      console.error('Profile insert failed:', insertError);
navUsername.textContent = 'User';
      statPoints.textContent = '0 pts';
      statSolved.textContent = '0';
      return;
    }

    // refetch after insert
    const { data: newProfile } = await supabaseClient
      .from('profiles')
      .select('username, total_points')
      .eq('id', currentUser.id)
      .single();

    profile = newProfile;
  } else if (error) {
    console.error('Profile load failed:', error);
    navUsername.textContent = 'User';
    statPoints.textContent = '0 pts';
    statSolved.textContent = '0';
    return;
  }

  // Update UI from `profile`
  const points = profile.total_points ?? 0;

  navUsername.textContent = profile.username;
  statPoints.textContent = `${points} pts`;
  settingsUsernameInput.value = profile.username;

  const rank = getRank(points);
  statRank.textContent = rank.name;
  if (sumRank) sumRank.textContent = rank.name;

  const avatar = document.getElementById('user-avatar');
  if (avatar) {
    avatar.textContent = (profile.username || '◈').slice(0, 2).toUpperCase();
  }

  updateRankBar(points);

  const { count, error: countError } = await supabaseClient
    .from('submissions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .eq('status', 'APPROVED');

  if (!countError) {
    statSolved.textContent = count ?? 0;
  } else {
    console.error("Failed to count submissions:", countError);
    statSolved.textContent = "0";
  }
}

// ==========================================
// 2. DASHBOARD DATA FLOW
// ==========================================

// Rank ladder (cumulative total points)
const RANKS = [
  { name: "Novice", min: 0 },
  { name: "Apprentice", min: 500 },
  { name: "Junior", min: 1200 },
  { name: "Intermediate", min: 2500 },
  { name: "Senior", min: 5000 },
  { name: "Expert", min: 10000 },
  { name: "Master", min: 20000 },
];

function getRank(points) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (points >= RANKS[i].min) idx = i;
  }
  const current = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  return { name: current.name, min: current.min, nextMin: next ? next.min : null };
}

// Segmented progress toward the next rank
function updateRankBar(points) {
  const bar = document.getElementById('rank-bar');
  const next = document.getElementById('rank-bar-next');
  if (!bar || !next) return;

  const segs = bar.querySelectorAll('.seg');
  if (!segs.length) return;

  const SEGMENTS = segs.length;
  const rank = getRank(points);

  if (rank.nextMin === null) {
    segs.forEach(s => s.classList.add('on'));
    next.textContent = 'Highest rank reached';
    return;
  }

  const progress = Math.min(1, Math.max(0, (points - rank.min) / (rank.nextMin - rank.min)));
  const filled = Math.round(progress * SEGMENTS);
  segs.forEach((s, i) => {
    s.classList.toggle('on', i < filled);
    s.classList.toggle('half', i === filled && progress < 1 && filled < SEGMENTS);
  });
  next.textContent = `${rank.nextMin - points} pts to next rank`;
}

async function fetchDashboardData() {
  // Fetch active challenges (cached 5-min) and the user's full submission history
  const cacheKey = 'active_challenges';
  const cached = window.apiCache?.get(`supabase_${cacheKey}`);
  let challenges, error;

  if (cached) {
    ({ data: challenges, error } = cached);
  } else {
    const result = await supabaseClient
      .from('challenges')
      .select('id, title, instructions, month_year, points_worth, is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    challenges = result.data;
    error = result.error;
    if (window.apiCache) {
      window.apiCache.set(`supabase_${cacheKey}`, { data: challenges, error });
    }
  }

  const { data: submissions, error: subError } = await supabaseClient
    .from('submissions')
    .select('id, submitted_at, status, challenge_id')
    .eq('user_id', currentUser.id)
    .order('submitted_at', { ascending: false });

  if (subError) {
    console.error('Submissions load failed:', subError);
  }

  const submissionsList = submissions || [];
  const latestByChallenge = buildLatestStatusMap(submissionsList);

  renderMissionProgress(error ? [] : challenges || [], latestByChallenge);
  renderEpochStats(error ? [] : challenges || [], latestByChallenge);

  if (statMissions) {
    const active = (challenges || []).length;
    statMissions.textContent = active;
    if (sumMissions) sumMissions.textContent = active;
  }
}

// ==========================================
// 2b. REGISTRY & SUMMARY (PORTAL REGISTRY PANEL)
// ==========================================
async function fetchRegistry() {
  // Counts come from existing tables only — no new tables required.
  const [catsRes, wksRes, rmRes, stepsRes, profRes] = await Promise.all([
    supabaseClient.from('workshop_categories').select('id, name').order('name'),
    supabaseClient.from('workshops').select('id, category_id'),
    supabaseClient.from('roadmaps').select('id, title'),
    supabaseClient.from('roadmap_steps').select('id, roadmap_id'),
    supabaseClient.from('profiles').select('id', { count: 'exact', head: true }),
  ]);

  const cats = catsRes.data || [];
  const wks = wksRes.data || [];
  const rms = rmRes.data || [];
  const steps = stepsRes.data || [];

  const workshopCount = wks.length;
  const roadmapCount = rms.length;
  const stepCount = steps.length;

  if (regWorkshops) regWorkshops.textContent = workshopCount;
  if (regRoadmaps) regRoadmaps.textContent = roadmapCount;
  if (regSteps) regSteps.textContent = stepCount;
  if (sumWorkshops) sumWorkshops.textContent = workshopCount;
  if (sumRoadmaps) sumRoadmaps.textContent = roadmapCount;
  if (sumTravelers) sumTravelers.textContent = profRes.count ?? '–';

  // Workshops by category (segmented bars, 10 segs scaled to max)
  if (regByCategory) {
    const byCat = cats.map(c => ({
      name: c.name,
      count: wks.filter(w => w.category_id === c.id).length,
    })).filter(x => x.count > 0);

    regByCategory.innerHTML = byCat.length === 0
      ? '<div class="empty-hint">No workshops yet.</div>'
      : renderRegistryRows(byCat);
  }

  // Steps per roadmap (segmented bars, 10 segs scaled to max)
  if (regByRoadmap) {
    const byRm = rms.map(r => ({
      name: r.title,
      count: steps.filter(s => s.roadmap_id === r.id).length,
    })).filter(x => x.count > 0);

    regByRoadmap.innerHTML = byRm.length === 0
      ? '<div class="empty-hint">No learning paths yet.</div>'
      : renderRegistryRows(byRm);
  }
}

function renderRegistryRows(items) {
  const max = Math.max(...items.map(x => x.count));
  return items.map(x => `
        <div class="reg-row">
            <span class="rr-name">${escapeHtml(x.name)}</span>
            <div class="rr-bar">${buildSegments(Math.round(x.count / max * 100))}</div>
            <span class="rr-count">${x.count}</span>
        </div>
    `).join('');
}

// Map each challenge to its most recent submission status
function buildLatestStatusMap(submissions) {
  const map = {};
  submissions.forEach(s => {
    const ts = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
    const cur = map[s.challenge_id];
    if (!cur || ts > cur.ts) {
      map[s.challenge_id] = { status: s.status, ts };
    }
  });
  return map;
}

function statusLabel(status) {
  switch (status) {
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    case 'PENDING': return 'Pending Review';
    default: return 'Not Started';
  }
}

function renderMissionProgress(challenges, latestByChallenge) {
  if (!challenges || challenges.length === 0) {
    missionProgress.innerHTML = `<div class="empty-hint">No active challenges right now.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  challenges.slice(0, 3).forEach(challenge => {
    const status = latestByChallenge[challenge.id]?.status ?? null;
    const row = document.createElement('div');
    row.classList.add('mini-row');

    const badgeClass = statusClass(status);
    row.innerHTML = `
            <span class="mr-icon">◈</span>
            <div class="mr-body">
                <span class="mr-title">${escapeHtml(challenge.title)}</span>
                <span class="mr-meta">${status ? 'Last submitted ' + escapeHtml(formatDate(latestByChallenge[challenge.id].ts)) : 'Awaiting first submission'}</span>
            </div>
            <span class="mini-badge ${badgeClass}">${escapeHtml(statusLabel(status))}</span>
            <a class="mission-link" href="${escapeHtml(buildChallengeSubmitUrl(challenge.id))}">Open &rarr;</a>
        `;
    fragment.appendChild(row);
  });

  missionProgress.innerHTML = "";
  missionProgress.appendChild(fragment);
}

function buildChallengeSubmitUrl(challengeId) {
  const submitUrl = new URL('submit', window.location.href);
  submitUrl.searchParams.set('id', challengeId);
  return submitUrl.href;
}

function statusClass(status) {
  switch (status) {
    case 'APPROVED': return 'ok';
    case 'REJECTED': return 'warn';
    case 'PENDING': return '';
    default: return '';
  }
}

function renderEpochStats(challenges, latestByChallenge) {
  const epochs = {};
  challenges.forEach(challenge => {
    const month = (challenge.month_year || 'Unknown Month').trim();
    if (!epochs[month]) {
      epochs[month] = { total: 0, approved: 0, hue: window.epochHue ? window.epochHue(month) : 25 };
    }
    epochs[month].total++;
    if (latestByChallenge[challenge.id]?.status === 'APPROVED') {
      epochs[month].approved++;
    }
  });

  const sorted = Object.keys(epochs).sort((a, b) => parseMonthYear(b) - parseMonthYear(a));

  if (sorted.length === 0) {
    epochStats.innerHTML = `<div class="empty-hint">No active challenges right now.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  sorted.forEach(month => {
    const epoch = epochs[month];
    const pct = epoch.total ? Math.round((epoch.approved / epoch.total) * 100) : 0;
    const stat = document.createElement('div');
    stat.classList.add('mini-row');

    stat.innerHTML = `
            <span class="mr-icon">▶</span>
            <div class="mr-body">
                <span class="mr-title">${escapeHtml(month)}</span>
                <span class="mr-meta">${epoch.approved}/${epoch.total} approved</span>
            </div>
            <span class="mini-badge">${pct}%</span>
        `;
    fragment.appendChild(stat);
  });

  epochStats.innerHTML = "";
  epochStats.appendChild(fragment);
}

// ==========================================
// 3. INLINE LEADERBOARD & SETTINGS FLOW
// ==========================================
async function fetchLeaderboard() {
  const tbody = document.getElementById('leaderboard-tbody');
  tbody.innerHTML = `<tr><td colspan="3" class="table-loading">Loading leaderboard...</td></tr>`;

  // PERF: Pagination - load 50 at a time instead of unlimited
  const { data: rankings, error } = await supabaseClient
    .from('profiles')
    .select('username, total_points')
    .order('total_points', { ascending: false })
    .limit(50);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-loading">Failed to load leaderboard: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!rankings || rankings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-loading">No members yet.</td></tr>`;
    return;
  }

  // PERF: Batch DOM updates with DocumentFragment
  const fragment = document.createDocumentFragment();
  rankings.forEach((profile, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td>${escapeHtml(profile.username)}</td>
            <td>${escapeHtml(profile.total_points ?? 0)} pts</td>
        `;
    fragment.appendChild(row);
  });

  // Single DOM write
  tbody.innerHTML = "";
  tbody.appendChild(fragment);

  // Add Load More button if there are 50 results
  if (rankings.length === 50) {
    const loadMoreRow = document.createElement('tr');
    const loadMoreTd = document.createElement('td');
    loadMoreTd.colSpan = 3;
    loadMoreTd.style.textAlign = 'center';
    loadMoreTd.style.padding = '15px';
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'load-more-btn';
    loadMoreBtn.textContent = 'Load More Members';
    loadMoreBtn.addEventListener('click', loadMoreLeaderboard);
    loadMoreTd.appendChild(loadMoreBtn);
    loadMoreRow.appendChild(loadMoreTd);
    tbody.appendChild(loadMoreRow);
  }
}

// Load additional leaderboard entries
let leaderboardOffset = 50;
async function loadMoreLeaderboard() {
  const tbody = document.getElementById('leaderboard-tbody');
  const lastRow = tbody.lastChild;
  if (lastRow) lastRow.remove(); // Remove Load More button

  const { data: rankings, error } = await supabaseClient
    .from('profiles')
    .select('username, total_points')
    .order('total_points', { ascending: false })
    .range(leaderboardOffset, leaderboardOffset + 49);

  if (!error && rankings?.length > 0) {
    const fragment = document.createDocumentFragment();
    rankings.forEach((profile, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
                <td><strong>#${leaderboardOffset + index + 1}</strong></td>
                <td>${escapeHtml(profile.username)}</td>
                <td>${escapeHtml(profile.total_points ?? 0)} pts</td>
            `;
      fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
    leaderboardOffset += 50;

    // Add Load More button again if full batch returned
    if (rankings.length === 50) {
      const loadMoreRow = document.createElement('tr');
      const loadMoreTd = document.createElement('td');
      loadMoreTd.colSpan = 3;
      loadMoreTd.style.textAlign = 'center';
      loadMoreTd.style.padding = '15px';
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.className = 'load-more-btn';
      loadMoreBtn.textContent = 'Load More Members';
      loadMoreBtn.addEventListener('click', loadMoreLeaderboard);
      loadMoreTd.appendChild(loadMoreBtn);
      loadMoreRow.appendChild(loadMoreTd);
      tbody.appendChild(loadMoreRow);
    }
  }
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingsMessage.textContent = "Saving changes...";
  settingsMessage.style.color = "var(--text-strong)";

  const newUsername = settingsUsernameInput.value.trim();
  const newPassword = settingsPasswordInput.value;

  const { error: profileError } = await supabaseClient
    .from('profiles')
    .update({ username: newUsername })
    .eq('id', currentUser.id);

  if (profileError) {
    settingsMessage.textContent = "Error: " + profileError.message;
    settingsMessage.style.color = "#fe4e00";
    return;
  }

  if (newPassword.trim() !== "") {
    const { error: authError } = await supabaseClient.auth.updateUser({
      password: newPassword
    });

    if (authError) {
      settingsMessage.textContent = "Username saved, but password failed: " + authError.message;
      settingsMessage.style.color = "#fe4e00";
      return;
    }
  }

  settingsMessage.textContent = "Changes saved successfully!";
  settingsMessage.style.color = "#83b5d1";
  fetchUserProfile();
  setTimeout(() => {
    settingsModal.classList.remove('active');
    settingsMessage.textContent = "";
    settingsPasswordInput.value = "";
  }, 1500);
});

// ==========================================
// 4. GENERAL EVENTS
// ==========================================
function setupEventListeners() {
  bindLogout(logoutBtn);

  openLeaderboardBtn.addEventListener('click', (e) => {
    e.preventDefault();
    leaderboardModal.classList.add('active');
    fetchLeaderboard();
  });

  openSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    settingsModal.classList.add('active');
  });

  closeLeaderboardBtn.addEventListener('click', () => leaderboardModal.classList.remove('active'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));

  window.addEventListener('click', (e) => {
    if (e.target === leaderboardModal) leaderboardModal.classList.remove('active');
    if (e.target === settingsModal) settingsModal.classList.remove('active');
  });

  // Stealth Trigger: Click the RANK text 5 times while holding Shift
  statRank.addEventListener('click', (e) => {
    if (e.shiftKey) {
      clickTracker++;

      clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        clickTracker = 0;
      }, 1500);

      if (clickTracker === 5) {
        clickTracker = 0;
        triggerStealthRedirect();
      }
    }
  });
}

// ==========================================
// 5. THE STEALTH GATEWAY (UNEXPOSED)
// ==========================================
let clickTracker = 0;
let clickTimeout;

// Base64-encoded "../admin/admin.html" to obscure the route in source
const ENCODED_ROUTE = "Li4vYWRtaW4vYWRtaW4uaHRtbA==";

function triggerStealthRedirect() {
  window.location.href = atob(ENCODED_ROUTE);
}