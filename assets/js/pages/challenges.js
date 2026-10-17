// challenges.js - Epoch archive of all challenges
// Bootstrap: config.js + common.js must load before this file.

initApp(initChallengesPage);

// DOM Elements
const navUsername = document.getElementById('nav-username');
const logoutBtn = document.getElementById('logout-btn');
const archiveContainer = document.getElementById('challenges-archive');
const tabsContainer = document.getElementById('category-tabs');

const targetChallengeId = new URLSearchParams(window.location.search).get('target');

const MISC_KEY = '__misc__';

let allChallenges = [];
let activeCategory = 'all';
let categoryGroups = [];

async function initChallengesPage() {
  bindLogout(logoutBtn);

  const session = await requireSession();
  if (!session) return;

  await loadUsername(session.user.id, navUsername);
  await loadSolved(session.user.id);
  await fetchAllChallenges();
}

// Challenges this user has already solved (an APPROVED submission).
let solvedIds = new Set();
async function loadSolved(userId) {
  const { data } = await supabaseClient
    .from('submissions')
    .select('challenge_id')
    .eq('user_id', userId)
    .eq('status', 'APPROVED');
  solvedIds = new Set((data || []).map(s => s.challenge_id));
}

function cardSummary(text) {
  const plain = window.statementPlainText
    ? window.statementPlainText(text)
    : String(text || '').replace(/\s+/g, ' ').trim();
  return plain.length > 140 ? plain.slice(0, 140).replace(/\s+\S*$/, '') + '…' : plain;
}

async function fetchAllChallenges() {
  archiveContainer.innerHTML = `<div class="loading-state">Loading challenges...</div>`;

  // PERF: Check cache first (5-minute TTL)
  const cacheKey = 'all_challenges';
  const cached = window.apiCache?.get(`supabase_${cacheKey}`);
  let challenges, error;

  if (cached) {
    ({ data: challenges, error } = cached);
  } else {
    const result = await supabaseClient
      .from('challenges')
      .select(`id, title, instructions, month_year, points_worth, is_active, category_id, tags, challenge_categories (id, slug, name)`)
      .order('created_at', { ascending: false });
    challenges = result.data;
    error = result.error;
    if (window.apiCache) {
      window.apiCache.set(`supabase_${cacheKey}`, { data: challenges, error });
    }
  }

  if (error) {
    archiveContainer.innerHTML = `<div class="loading-state">Failed to load challenges: ${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!challenges || challenges.length === 0) {
    archiveContainer.innerHTML = `<div class="loading-state">The archive is empty. No challenges yet.</div>`;
    return;
  }

  allChallenges = challenges;
  categoryGroups = buildCategoryGroups();
  renderCategoryTabs();
  renderArchive();
}

// Group challenges by their category; unassigned challenges land in "Misc".
function buildCategoryGroups() {
  const map = {};
  const order = [];

  allChallenges.forEach(challenge => {
    const cat = challenge.challenge_categories;
    const key = cat ? cat.slug : MISC_KEY;

    let group = map[key];
    if (!group) {
      group = {
        key,
        name: cat ? cat.name : 'Misc',
        hue: cat && cat.slug && window.epochHue ? window.epochHue(cat.slug) : 25,
        challenges: []
      };
      map[key] = group;
      order.push(group);
    }
    group.challenges.push(challenge);
  });

  // Alphabetical by name, with "Misc" pinned to the very end.
  order.sort((a, b) => {
    if (a.key === MISC_KEY) return 1;
    if (b.key === MISC_KEY) return -1;
    return a.name.localeCompare(b.name);
  });

  return order;
}

function renderCategoryTabs() {
  tabsContainer.innerHTML = `<button type="button" class="category-tab active" data-category="all">All</button>`;

  categoryGroups.forEach(group => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-tab';
    btn.dataset.category = group.key;
    btn.textContent = group.name;
    tabsContainer.appendChild(btn);
  });

  tabsContainer.hidden = false;
}

function hueForCategory(key) {
  if (key === 'all') return null;
  const group = categoryGroups.find(g => g.key === key);
  return group ? group.hue : null;
}

function renderArchive() {
  const visible = activeCategory === 'all'
    ? categoryGroups
    : categoryGroups.filter(g => g.key === activeCategory);

  archiveContainer.innerHTML = "";

  // PERF: Batch DOM updates with DocumentFragment (single reflow instead of multiple)
  const fragment = document.createDocumentFragment();

  visible.forEach(group => {
    const section = document.createElement('section');
    section.classList.add('category-section');
    section.style.setProperty('--epoch-hue', group.hue);

    const header = document.createElement('div');
    header.classList.add('category-header');
    header.innerHTML = `
            <span class="category-name">${escapeHtml(group.name)}</span>
            <span class="category-count">${group.challenges.length} challenge${group.challenges.length === 1 ? '' : 's'}</span>
        `;

    const grid = document.createElement('div');
    grid.classList.add('challenges-grid');

    group.challenges.forEach(challenge => {
      const archived = !challenge.is_active;
      const solved = solvedIds.has(challenge.id);
      const card = document.createElement(archived ? 'div' : 'a');
      card.classList.add('challenge-card');
      if (archived) card.classList.add('card-archived');
      if (solved) card.classList.add('card-solved');
      card.dataset.id = challenge.id;

      if (!archived) {
        // A real link: keyboard focus, middle-click and "open in new tab" work.
        const submitUrl = new URL('submit', window.location.href);
        submitUrl.searchParams.set('id', challenge.id);
        card.href = submitUrl.href;
      }

      card.innerHTML = `
                <div class="card-top">
                    <span class="card-badge">${escapeHtml(challenge.month_year || 'Month')}</span>
                    ${solved
                      ? `<span class="card-solved-chip">Solved</span>`
                      : `<span class="card-points">+${escapeHtml(challenge.points_worth ?? 100)} pts</span>`}
                </div>
                <h3>${escapeHtml(challenge.title)}</h3>
                <p class="challenge-desc">${escapeHtml(cardSummary(challenge.instructions))}</p>
                ${challenge.tags ? `<div class="card-tags">${challenge.tags.split(/\s+/).filter(t => t).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                <span class="enter-link">${archived ? 'Archived Month' : solved ? 'View challenge →' : 'Submit Solution →'}</span>
            `;
      grid.appendChild(card);
    });

    section.appendChild(header);
    section.appendChild(grid);
    fragment.appendChild(section);
  });

  archiveContainer.appendChild(fragment);

  // Highlight a challenge targeted from the homepage "View Paradox" link (?target=<id>)
  if (targetChallengeId) {
    const targetCard = archiveContainer.querySelector(`[data-id="${CSS.escape(targetChallengeId)}"]`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.classList.add('highlighted');
      setTimeout(() => targetCard.classList.remove('highlighted'), 3000);
    }
  }
}

tabsContainer.addEventListener('click', (e) => {
  const tab = e.target.closest('.category-tab');
  if (!tab) return;

  activeCategory = tab.dataset.category;
  tabsContainer.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === tab));

  // Theme the active tab with its category's hue.
  const hue = hueForCategory(activeCategory);
  if (hue != null) {
    tabsContainer.style.setProperty('--epoch-hue', hue);
  } else {
    tabsContainer.style.removeProperty('--epoch-hue');
  }

  renderArchive();
});