import 'server-only';
import { LANG_CONFIG, type Language } from '@/lib/judge';

// Piston code execution client. PISTON_BASE_URL is required: the judge refuses
// to fall back to the public Piston API. Resolved lazily so a missing variable
// fails the request with a clear message instead of breaking the build.

const COMPILE_TIMEOUT_MS = 10_000;
const RUNTIMES_TIMEOUT_MS = 8_000;
const EXECUTE_TIMEOUT_MS = 45_000;

function baseUrl(): string {
  const value = process.env.PISTON_BASE_URL;
  if (!value) {
    throw new Error('PISTON_BASE_URL is not set (refusing to fall back to the public Piston API)');
  }
  return value.replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PISTON_API_KEY) h.Authorization = process.env.PISTON_API_KEY;
  return h;
}

interface Runtime {
  language: string;
  version: string;
}

let runtimeCache: Runtime[] | null = null;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Newest installed version for a runtime; falls back to "*". */
async function resolveVersion(language: string): Promise<string> {
  try {
    if (!runtimeCache) {
      const res = await fetch(`${baseUrl()}/runtimes`, {
        headers: headers(),
        signal: AbortSignal.timeout(RUNTIMES_TIMEOUT_MS),
        cache: 'no-store',
      });
      const data: unknown = res.ok ? await res.json() : null;
      runtimeCache = Array.isArray(data) ? (data as Runtime[]) : null;
    }
    const matches = (runtimeCache ?? []).filter((r) => r.language === language);
    matches.sort((x, y) => compareVersions(y.version, x.version));
    if (matches[0]) return matches[0].version;
  } catch (err) {
    console.error('resolveVersion failed, falling back to "*":', (err as Error).message);
  }
  return '*';
}

export interface PistonStage {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
  status?: string | null;
  wall_time?: number | null;
  memory?: number | null;
}

export interface PistonResult {
  compile?: PistonStage;
  run?: PistonStage;
}

export interface ExecuteOptions {
  language: Language;
  code: string;
  stdin?: string;
  runTimeoutMs?: number;
  memoryLimitMb?: number;
}

/** Run code on Piston once. Throws on transport or service errors. */
export async function executePiston(opts: ExecuteOptions): Promise<PistonResult> {
  const cfg = LANG_CONFIG[opts.language];
  const runTimeoutMs = opts.runTimeoutMs ?? 1000;
  const memoryLimitMb = opts.memoryLimitMb ?? 10;
  const version = await resolveVersion(cfg.language);

  const res = await fetch(`${baseUrl()}/execute`, {
    method: 'POST',
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(EXECUTE_TIMEOUT_MS),
    body: JSON.stringify({
      language: cfg.language,
      version,
      files: [{ name: cfg.file, content: opts.code }],
      stdin: opts.stdin ?? '',
      compile_timeout: COMPILE_TIMEOUT_MS,
      compile_cpu_time: COMPILE_TIMEOUT_MS,
      compile_memory_limit: -1,
      run_timeout: runTimeoutMs,
      run_cpu_time: runTimeoutMs,
      run_memory_limit: memoryLimitMb > 0 ? memoryLimitMb * 1024 * 1024 : -1,
    }),
  });

  const data = (await res.json().catch(() => null)) as (PistonResult & { message?: string }) | null;
  if (!res.ok) {
    throw new Error(`Piston execute failed (${res.status}): ${data?.message || res.statusText}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Piston execute returned an unexpected response');
  }
  return data;
}
