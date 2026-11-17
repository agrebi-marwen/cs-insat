import type { TestCaseRow } from '@/types/db';

/** Per-sub-test breakdown of a CP run (shared by the submit and submissions pages). */
export function TestResults({ results }: { results: TestCaseRow[] | null | undefined }) {
  if (!Array.isArray(results) || results.length === 0) return null;

  return (
    <div className="cp-test-results">
      <strong>Test cases</strong>
      <div className="cp-test-header">
        <span>Test</span><span>CPU</span><span>Memory</span><span>Result</span>
      </div>
      {results.map((test, i) => {
        const result = String(test.result || 'PENDING').toUpperCase();
        const resultClass = result === 'OK' || result === 'AC' ? 'cp-v-ac' : `cp-v-${result.toLowerCase()}`;
        return (
          <details className="cp-test-result" key={test.index ?? i}>
            <summary>
              <span>Test {test.index ?? ''}</span>
              <span>{test.cpu_ms ?? '—'} ms</span>
              <span>{test.memory_kb ?? '—'} KB</span>
              <span className={`cp-detail-verdict ${resultClass}`}>{result}</span>
            </summary>
            <div className="cp-test-panels">
              <div><strong>Input</strong><pre>{test.input || ''}</pre></div>
              <div><strong>Expected output</strong><pre>{test.expected || ''}</pre></div>
              <div><strong>Your output</strong><pre>{test.output || ''}</pre></div>
            </div>
          </details>
        );
      })}
      <small>CPU and memory are measured for the complete program run.</small>
    </div>
  );
}
