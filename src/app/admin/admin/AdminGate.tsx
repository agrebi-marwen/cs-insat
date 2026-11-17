'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSupabase } from '@/components/Providers';
import { ADMIN_PANEL_HTML } from '@/legacy/admin-panel-html';
import { safeUrl, toDriveEmbed } from '@/lib/utils';

export function AdminGate() {
  const supabase = useSupabase();
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('Verifying password...');
    try {
      const response = await fetch('/api/adminCheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => ({}))) as { authorized?: boolean; error?: string };

      if (response.status === 401) {
        setError('Session expired. Please log in again.');
        window.location.assign('/account/login');
        return;
      }
      if (response.ok && result.authorized) {
        setError('');
        setAuthorized(true);
      } else {
        setError(result.error || 'Access denied: invalid password.');
      }
    } catch {
      setError('Verification service is unavailable.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  // Once both gates pass, hand the static panel markup to the legacy module.
  useEffect(() => {
    const root = panelRef.current;
    if (!authorized || !root || root.dataset.mounted) return;
    root.dataset.mounted = 'true';
    void import('@/legacy/admin-panel').then(({ mountAdminPanel }) =>
      mountAdminPanel({ supabaseClient: supabase, safeUrl, toDriveEmbed }),
    );
  }, [authorized, supabase]);

  if (!authorized) {
    return (
      <div id="security-overlay" className="overlay" style={{ display: 'flex' }}>
        <form className="security-card" onSubmit={verify}>
          <h2>Authorization Required</h2>
          <p>Enter the admin access code to continue.</p>
          <input
            type="password"
            id="admin-pass-input"
            placeholder="••••••••••••"
            autoFocus
            autoComplete="off"
            disabled={busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button id="admin-auth-btn" className="submit-btn" type="submit" disabled={busy}>Authorize</button>
          <div id="auth-error" className="status-msg" role="alert" style={{ color: '#fe4e00', marginTop: 15 }}>
            {error}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div
      className="admin-wrapper"
      id="admin-panel-content"
      ref={panelRef}
      dangerouslySetInnerHTML={{ __html: ADMIN_PANEL_HTML }}
    />
  );
}
