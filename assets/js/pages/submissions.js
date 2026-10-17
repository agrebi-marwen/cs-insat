// submissions.js - Submission history log
// Bootstrap: config.js + common.js must load before this file.

initApp(initSubmissionsPage);

const logsTableBody = document.getElementById('logs-table-body');

async function initSubmissionsPage() {
  const session = await requireSession();
  if (!session) return;

  await fetchUserSubmissions(session.user.id);
}

async function fetchUserSubmissions(userId) {
  logsTableBody.innerHTML = `<tr><td colspan="4" class="table-loading">Loading your submissions...</td></tr>`;

  const { data: submissions, error } = await supabaseClient
    .from('submissions')
    .select(`
            id,
            submitted_at,
            submission_url,
            notes,
            status,
            challenges (
                title
            ),
            cp_submission_details (
                language,
                verdict,
                code,
                execution_time_ms,
                memory_kb,
                compile_output,
                run_output,
                test_results
            )
        `)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error("Failed to query submissions log:", error);
    logsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="table-error">
                    Failed to load submissions: ${escapeHtml(error.message)}
                </td>
            </tr>`;
    return;
  }

  if (!submissions || submissions.length === 0) {
    logsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="table-empty">
                    No submissions yet.
                </td>
            </tr>`;
    return;
  }

  logsTableBody.innerHTML = "";

  submissions.forEach(sub => {
    const timestamp = sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "Unknown";
    const challengeTitle = sub.challenges ? sub.challenges.title : "Unknown Challenge";

    const cpDetails = sub.cp_submission_details || null;
    const cp = Array.isArray(cpDetails) ? cpDetails[0] : cpDetails;

    let detailHtml;
    if (cp && cp.verdict) {
      const langLabel = (cp.language || '').toUpperCase();
      const verdictCode = (cp.verdict || 'PENDING').toUpperCase();
      let vClass = 'cp-v-pending';
      if (verdictCode === 'AC')  vClass = 'cp-v-ac';
      if (verdictCode === 'WA')  vClass = 'cp-v-wa';
      if (verdictCode === 'TLE') vClass = 'cp-v-tle';
      if (verdictCode === 'MLE') vClass = 'cp-v-mle';
      if (verdictCode === 'RE')  vClass = 'cp-v-re';
      if (verdictCode === 'CE')  vClass = 'cp-v-ce';
      detailHtml = `
        <span class="cp-detail-lang">${escapeHtml(langLabel)}</span>
        <span class="cp-detail-verdict ${escapeHtml(vClass)}">${escapeHtml(verdictCode)}</span>
        ${cp.execution_time_ms != null ? `<small>${escapeHtml(String(cp.execution_time_ms))} ms${cp.memory_kb != null ? ` · ${escapeHtml(String(cp.memory_kb))} KB` : ''}</small>` : ''}
        <details class="submission-source">
          <summary>View source and judge output</summary>
          <pre>${escapeHtml(cp.code || '')}</pre>
          ${cp.compile_output ? `<strong>Compiler output</strong><pre>${escapeHtml(cp.compile_output)}</pre>` : ''}
          ${cp.run_output ? `<strong>Run output</strong><pre>${escapeHtml(cp.run_output)}</pre>` : ''}
          ${renderTestResults(cp.test_results)}
        </details>`;
    } else if (sub.notes) {
      detailHtml = `<span class="cp-detail-pending">${escapeHtml(sub.notes)}</span>`;
    } else if (sub.submission_url) {
      detailHtml = `<a href="${escapeHtml(sub.submission_url)}" target="_blank" rel="noopener noreferrer" class="table-link">${escapeHtml(sub.submission_url)}</a>`;
    } else {
      detailHtml = '<span class="cp-detail-pending">Code submitted</span>';
    }

    const cleanStatus = (sub.status || "PENDING").toUpperCase();
    let statusClass = "status-pending";
    if (cleanStatus === "APPROVED" || cleanStatus === "ACCEPTED") statusClass = "status-accepted";
    if (cleanStatus === "REJECTED") statusClass = "status-rejected";

    const row = document.createElement('tr');
    row.innerHTML = `
            <td class="col-time">${escapeHtml(timestamp)}</td>
            <td class="col-title">${escapeHtml(challengeTitle)}</td>
            <td class="col-details">${detailHtml}</td>
            <td class="col-status">
                <span class="table-status-badge ${escapeHtml(statusClass)}">${escapeHtml(cleanStatus)}</span>
            </td>
        `;
    logsTableBody.appendChild(row);
  });
}

function renderTestResults(rawResults) {
  if (!Array.isArray(rawResults) || rawResults.length === 0) return '';

  const rows = rawResults.map(test => {
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
  }).join('');

  return `
    <div class="cp-test-results">
      <strong>Test cases</strong>
      <div class="cp-test-header"><span>Test</span><span>CPU</span><span>Memory</span><span>Result</span></div>
      ${rows}
      <small>CPU and memory are measured for the complete program run.</small>
    </div>`;
}