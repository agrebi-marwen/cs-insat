// roadmap-map.js - Node-based roadmap detail + sequential tag-gated unlock
// Bootstrap: config.js + common.js must load before this file.

initApp(initRoadmapMapPage);

// DOM Elements
const navUsername = document.getElementById('nav-username');
const logoutBtn = document.getElementById('logout-btn');
const difficultyEl = document.getElementById('roadmap-difficulty');
const titleEl = document.getElementById('roadmap-title');
const descEl = document.getElementById('roadmap-description');
const headerEl = document.getElementById('roadmap-header');
const overviewEl = document.getElementById('roadmap-overview');
const progressBar = document.getElementById('roadmap-progress-bar');
const progressCaption = document.getElementById('roadmap-progress-caption');
const nodesContainer = document.getElementById('roadmap-nodes');

let currentUserId = null;
let roadmapId = null;
let currentHue = 25;

// Normalize a tag: strip any leading '#' and trim
function normalizeTag(t) {
  return String(t || '').trim().replace(/^#+/, '').toLowerCase();
}

// Build a set of "completed" tags from the user's approved submissions.
// A challenge's `tags` is stored as space-separated text like "#Arrays #Binary".
function buildCompletedTags(challenges, approvedChallengeIds) {
  const tags = new Set();
  challenges.forEach(ch => {
    if (!approvedChallengeIds.has(ch.id)) return;
    const raw = String(ch.tags || '');
    raw.split(/\s+/).forEach(t => {
      const norm = normalizeTag(t);
      if (norm) tags.add(norm);
    });
  });
  return tags;
}

// Build a map: normalized tag -> unique challenges carrying that tag.
function buildChallengesByTag(challenges) {
  const map = {};
  (challenges || []).forEach(ch => {
    const seen = new Set();
    String(ch.tags || '').split(/\s+/).forEach(t => {
      const norm = normalizeTag(t);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      if (!map[norm]) map[norm] = [];
      map[norm].push(ch);
    });
  });
  return map;
}

// Find challenges that match ANY of a node's required tags (deduped by id).
function challengesForNode(requiredTags, challengesByTag) {
  const out = new Map();
  requiredTags.forEach(norm => {
    (challengesByTag[norm] || []).forEach(ch => {
      if (!out.has(ch.id)) out.set(ch.id, ch);
    });
  });
  return Array.from(out.values());
}

async function initRoadmapMapPage() {
  bindLogout(logoutBtn);

  const session = await requireSession();
  if (!session) return;

  currentUserId = session.user.id;
  await loadUsername(session.user.id, navUsername);

  const urlParams = new URLSearchParams(window.location.search);
  roadmapId = urlParams.get('id');

  if (!roadmapId) {
    titleEl.textContent = "Roadmap Not Found";
    descEl.textContent = "Please return to the Roadmaps page and select a field.";
    nodesContainer.innerHTML = `<div class="loading-state">No roadmap selected.</div>`;
    return;
  }

  await loadRoadmap();
}

async function loadRoadmap() {
  const roadmapQuery = supabaseClient
    .from('roadmaps')
    .select('id, slug, title, description, difficulty')
    .eq('id', roadmapId)
    .maybeSingle();
  const nodesQuery = supabaseClient
    .from('roadmap_nodes')
    .select('id, title, description, required_tags, resources')
    .eq('roadmap_id', roadmapId)
    .order('position', { ascending: true });

  const [{ data: roadmap, error: roadmapError }, { data: nodes, error: nodesError }] = await Promise.all([
    roadmapQuery,
    nodesQuery
  ]);

  if (roadmapError || !roadmap) {
    titleEl.textContent = "Loading Failed";
    descEl.textContent = "Could not load this roadmap. It may have been removed.";
    nodesContainer.innerHTML = `<div class="loading-state">Roadmap not found.</div>`;
    return;
  }

  currentHue = window.epochHue ? window.epochHue(roadmap.slug) : 25;
  headerEl.style.setProperty('--epoch-hue', currentHue);
  overviewEl.style.setProperty('--epoch-hue', currentHue);

  difficultyEl.textContent = roadmap.difficulty || 'Field';
  titleEl.textContent = roadmap.title;
  descEl.textContent = roadmap.description || '';

  if (nodesError) {
    nodesContainer.innerHTML = `<div class="loading-state">Failed to load nodes: ${escapeHtml(nodesError.message)}</div>`;
    return;
  }

  await loadUserState(nodesError ? [] : nodes || []);
}

// Load the user's deepest unlocked node + approved challenge tags, then render.
async function loadUserState(nodes) {
  const progressQuery = supabaseClient
    .from('roadmap_node_progress')
    .select('node_id')
    .eq('user_id', currentUserId)
    .eq('roadmap_id', roadmapId)
    .maybeSingle();

  const approvedQuery = supabaseClient
    .from('submissions')
    .select('challenge_id')
    .eq('user_id', currentUserId)
    .eq('status', 'APPROVED');

  const [{ data: progress, error: progressError }, { data: approved, error: approvedError }] = await Promise.all([
    progressQuery,
    approvedQuery
  ]);

  if (progressError) console.error('Progress load failed:', progressError);
  if (approvedError) console.error('Approved submissions load failed:', approvedError);

  const approvedChallengeIds = new Set((approved || []).map(s => s.challenge_id));

  // Fetch tags for the challenges the user has completed
  const challengeQuery = approvedChallengeIds.size
    ? supabaseClient.from('challenges').select('id, tags').in('id', Array.from(approvedChallengeIds))
    : Promise.resolve({ data: [], error: null });
  const { data: challenges } = await challengeQuery;

  // Also fetch all active challenges so each node can offer a "solve this"
  // section linking to challenges that carry the node's required tags.
  const activeQuery = supabaseClient
    .from('challenges')
    .select('id, title, tags')
    .eq('is_active', true);
  const { data: activeChallenges } = await activeQuery;

  const completedTags = buildCompletedTags(challenges || [], approvedChallengeIds);
  const challengesByTag = buildChallengesByTag(activeChallenges || []);

  // Deepest unlocked index: -1 means nothing unlocked yet
  let deepestIndex = -1;
  if (progress && progress.node_id) {
    const idx = nodes.findIndex(n => n.id === progress.node_id);
    if (idx !== -1) deepestIndex = idx;
  }

  renderNodes(nodes, deepestIndex, completedTags, challengesByTag);
}

function renderNodes(nodes, deepestIndex, completedTags, challengesByTag) {
  if (!nodes || nodes.length === 0) {
    nodesContainer.innerHTML = `<div class="loading-state">This field has no nodes yet.</div>`;
    updateProgress(0, 0);
    return;
  }

  const fragment = document.createDocumentFragment();

  nodes.forEach((node, index) => {
    const isUnlocked = index <= deepestIndex;
    const isNext = index === deepestIndex + 1;
    const isLocked = index > deepestIndex + 1;

    const requiredTags = Array.isArray(node.required_tags) ? node.required_tags : [];
    const normalizedRequired = requiredTags.map(normalizeTag);
    const tagsMet = normalizedRequired.length > 0 &&
      normalizedRequired.every(tag => completedTags.has(tag));
    const unlockable = isNext && tagsMet;

    const resources = Array.isArray(node.resources) ? node.resources : [];
    const resourceHtml = resources.length
      ? `<div class="roadmap-step-resources">` +
        resources.map(r => `<a class="roadmap-resource" href="${escapeHtml(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title || r.url)} ↗</a>`).join('') +
        `</div>`
      : '';

    const tagChips = normalizedRequired.length
      ? `<div class="node-required-tags"><span class="node-required-label">Requires:</span>` +
        requiredTags.map(t => `<span class="node-required-tag">#${escapeHtml(String(t).replace(/^#+/, '').trim())}</span>`).join('') +
        `</div>`
      : '';

    const statusBadge = isUnlocked
      ? `<span class="node-status unlocked">Unlocked</span>`
      : isNext
        ? (unlockable
            ? `<span class="node-status ready">Ready to Unlock</span>`
            : `<span class="node-status next">Next Up</span>`)
        : `<span class="node-status locked">Locked</span>`;

    const actionHtml = isNext
      ? (unlockable
          ? `<button type="button" class="node-unlock-btn" data-node-id="${escapeHtml(node.id)}">Unlock Node →</button>`
          : `<div class="node-lock-hint">Complete approved challenges matching the tags above to unlock.</div>`)
      : isLocked
        ? `<div class="node-lock-hint">Unlock the previous node to proceed.</div>`
        : '';

    // "Solve a challenge" section: active challenges carrying ANY of this
    // node's required tags. Unlocked nodes also surface them (re-brush up).
    const nodeChallenges = challengesForNode(normalizedRequired, challengesByTag);
    const challengeSection = normalizedRequired.length && nodeChallenges.length
      ? `<div class="node-challenges">
            <span class="node-required-label">${isUnlocked ? 'Practice with:' : 'Try these to earn the tags:'}</span>
            <div class="node-challenge-links">
              ${nodeChallenges.map(ch =>
                `<a class="node-challenge-link" href="${escapeHtml(buildChallengeSubmitUrl(ch.id))}">${escapeHtml(ch.title)} →</a>`
              ).join('')}
            </div>
         </div>`
      : (normalizedRequired.length
          ? `<div class="node-lock-hint">No active challenges with these tags yet.</div>`
          : '');

    const row = document.createElement('div');
    row.classList.add('roadmap-map-step');
    if (isUnlocked) row.classList.add('is-unlocked');
    if (isNext) row.classList.add('is-next');
    if (unlockable) row.classList.add('is-ready');

    row.innerHTML = `
            <div class="roadmap-step-body">
                <div class="roadmap-step-head">
                    <span class="roadmap-step-num">Node ${index + 1}</span>
                    <span class="roadmap-step-title">${escapeHtml(node.title)}</span>
                    ${statusBadge}
                </div>
                <p class="roadmap-step-desc">${escapeHtml(node.description || '')}</p>
                ${tagChips}
                ${resourceHtml}
                ${challengeSection}
                ${actionHtml}
            </div>
        `;

    fragment.appendChild(row);
  });

  nodesContainer.innerHTML = "";
  nodesContainer.appendChild(fragment);

  const done = nodes.filter((_, index) => index <= deepestIndex).length;
  updateProgress(done, nodes.length);
}

function buildChallengeSubmitUrl(challengeId) {
  const submitUrl = new URL('submit', window.location.href);
  submitUrl.searchParams.set('id', challengeId);
  return submitUrl.href;
}

function updateProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressBar.innerHTML = buildSegments(pct);
  progressCaption.innerHTML = `Node ${done}/${total} unlocked — <strong>${pct}%</strong>`;
}

// UNLOCK: write the deepest-unlocked node (one per user per roadmap),
// then reload the user state to re-render.
nodesContainer.addEventListener('click', async (e) => {
  const unlockBtn = e.target.closest('.node-unlock-btn');
  if (!unlockBtn) return;

  const nodeId = unlockBtn.getAttribute('data-node-id');
  unlockBtn.disabled = true;
  unlockBtn.textContent = "Unlocking...";

  const { error } = await supabaseClient
    .from('roadmap_node_progress')
    .upsert({ user_id: currentUserId, roadmap_id: roadmapId, node_id: nodeId }, { onConflict: 'user_id,roadmap_id' });

  if (error) {
    console.error('Unlock failed:', error);
    unlockBtn.disabled = false;
    unlockBtn.textContent = "Unlock Node →";
    return;
  }

  const { data: nodes } = await supabaseClient
    .from('roadmap_nodes')
    .select('id, title, description, required_tags, resources')
    .eq('roadmap_id', roadmapId)
    .order('position', { ascending: true });

  if (window.burstParticles) {
    const rect = unlockBtn.getBoundingClientRect();
    window.burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, currentHue);
  }

  await loadUserState(nodes || []);
});
