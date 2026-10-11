// api/config.js - Vercel serverless function to serve Supabase config securely
export default function handler(req, res) {
  // CORS: Only allow requests from your Vercel domain
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ].filter(Boolean);
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  
  // PERF: Cache control - config changes rarely, cache for 1 hour
  res.setHeader('Cache-Control', 'no-store');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  res.setHeader('Content-Type', 'application/json');

  const configuredUrl = String(process.env.SUPABASE_URL || '')
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');

  // Return config from environment variables (never exposed to client source)
  res.status(200).json({
    url: configuredUrl,
    anonKey: process.env.SUPABASE_ANON_KEY
  });
}
