import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/Effects';
import { Styles } from '@/components/Styles';
import { getSessionUser } from '@/lib/supabase/server';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  // Already signed in: skip the form entirely (decided on the server, no flash).
  if (await getSessionUser()) redirect('/dashboard/dashboard');

  return (
    <>
      <Styles sheets={['account']} />
      <ThemeToggle fixed />
      {children}
    </>
  );
}
