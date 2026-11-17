import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Effects } from '@/components/Effects';
import { Providers } from '@/components/Providers';
import { PREFS_BOOT_SCRIPT } from '@/lib/boot-script';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

// Self-hosted fonts (previously three render-blocking Google Fonts requests).
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';

export const metadata: Metadata = {
  title: { default: 'The Time Portal', template: '%s · The Time Portal' },
  description:
    'Monthly coding challenges, learning paths and workshops by the IEEE CS INSAT Student Branch Chapter.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the nonce also opts every page into dynamic rendering, which the
  // per-request CSP (src/proxy.ts) requires.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* The anon key is public by design; passing it from the server keeps
            the existing SUPABASE_URL / SUPABASE_ANON_KEY env names working. */}
        <Providers supabaseUrl={supabaseUrl()} supabaseAnonKey={supabaseAnonKey()}>
          {children}
          <Effects />
        </Providers>
      </body>
    </html>
  );
}
