import type { NextConfig } from 'next';

// Security headers that do not vary per request. The Content-Security-Policy
// carries a per-request nonce, so it is set in src/proxy.ts instead.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
  // Old static-site URLs (bookmarks, links in announcements) keep working.
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: true },
      { source: '/:path(.+)\\.html', destination: '/:path', permanent: true },
      { source: '/dashboard', destination: '/dashboard/dashboard', permanent: false },
      { source: '/admin', destination: '/admin/admin', permanent: false },
    ];
  },
};

export default nextConfig;
