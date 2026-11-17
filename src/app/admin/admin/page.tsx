import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/Effects';
import { Styles } from '@/components/Styles';
import { createSessionClient, getSessionUser } from '@/lib/supabase/server';
import { AdminGate } from './AdminGate';

export const metadata: Metadata = { title: 'Admin Panel', robots: { index: false, follow: false } };

export default async function AdminPage() {
  // Gate 1, enforced on the server: a signed-in user whose profile role is
  // "admin". Everyone else is redirected before any admin markup is sent.
  const user = await getSessionUser();
  if (!user) redirect('/account/login');

  const supabase = await createSessionClient();
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') redirect('/dashboard/dashboard');

  return (
    <>
      <Styles sheets={['admin']} />
      <ThemeToggle fixed />
      {/* Gate 2: the panel password, checked by /api/adminCheck. */}
      <AdminGate />
    </>
  );
}
