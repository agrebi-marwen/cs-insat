import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { SiteFooter } from '@/components/SiteFooter';
import { Styles } from '@/components/Styles';
import { createSessionClient, getSessionUser } from '@/lib/supabase/server';
import type { Profile } from '@/types/db';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Server-side route guard: signed-out visitors never receive dashboard HTML.
  const user = await getSessionUser();
  if (!user) redirect('/account/login');

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, total_points')
    .eq('id', user.id)
    .maybeSingle();

  let profile = data as Profile | null;

  // First visit without a profile row: create the default one.
  if (!profile && !error) {
    const fallback = { id: user.id, username: 'User', total_points: 0 };
    const { error: insertError } = await supabase.from('profiles').insert(fallback);
    if (insertError) console.error('Profile insert failed:', insertError.message);
    profile = fallback;
  }

  return (
    <>
      <Styles sheets={['dashboard']} />
      <DashboardShell
        userId={user.id}
        initialProfile={profile ?? { id: user.id, username: 'User', total_points: 0 }}
      >
        {children}
      </DashboardShell>
      <SiteFooter showDashboard />
    </>
  );
}
