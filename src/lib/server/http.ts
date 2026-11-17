import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

const noStore = { 'Cache-Control': 'no-store' };

export function json<T>(body: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...noStore, ...headers } });
}

export function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, status);
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Parse and validate a JSON body; malformed input becomes a 400, never a crash. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  invalidMessage?: string,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail('Request body must be valid JSON', 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = invalidMessage ?? result.error.issues[0]?.message ?? 'Invalid request';
    return { ok: false, response: fail(message, 400) };
  }
  return { ok: true, data: result.data };
}
