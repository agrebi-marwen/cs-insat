// POST /api/cpTestUpload - admin upload of the gzipped CP test archive.
//
// The write uses the service role key because Storage can evaluate an
// authenticated browser request under the anon role and reject the INSERT
// (42501) on projects using JWT signing keys (supabase/supabase#46262).
//
// Request  : { challengeId, gzipBase64 } with a session cookie or Bearer token
// Response : { ok: true, path } or { error }

import { z } from 'zod';
import { MAX_TEST_FILE_BYTES } from '@/lib/judge';
import { authenticate, isAdmin } from '@/lib/server/auth';
import { fail, json, parseBody } from '@/lib/server/http';
import { createAdminClient } from '@/lib/supabase/server';

const schema = z.object({
  challengeId: z.string().trim().uuid('A valid challengeId is required'),
  gzipBase64: z.string().min(1, 'gzipBase64 is required'),
});

export async function POST(request: Request) {
  try {
    const caller = await authenticate(request);
    if (!caller) return fail('Authentication required', 401);
    if (!(await isAdmin(caller))) return fail('Not authorized', 403);

    const body = await parseBody(request, schema);
    if (!body.ok) return body.response;

    const gz = Buffer.from(body.data.gzipBase64, 'base64');
    if (gz.length === 0) return fail('Test archive is empty', 400);
    if (gz.length > MAX_TEST_FILE_BYTES) {
      return fail(`Test archive exceeds the ${MAX_TEST_FILE_BYTES} byte cap`, 400);
    }
    // gzip magic bytes: reject anything that is not actually a gzip archive.
    if (gz[0] !== 0x1f || gz[1] !== 0x8b) return fail('Test archive is not gzip data', 400);

    const path = `${body.data.challengeId}/tests.json.gz`;
    const { error } = await createAdminClient()
      .storage.from('cp-tests')
      .upload(path, gz, { contentType: 'application/gzip', upsert: true });

    if (error) {
      console.error('cpTestUpload storage error:', error.message);
      return fail(error.message || 'Storage upload failed', 500);
    }
    return json({ ok: true, path });
  } catch (err) {
    console.error('cpTestUpload error:', err);
    return fail('Upload failed', 500);
  }
}
