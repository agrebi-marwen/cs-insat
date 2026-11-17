'use client';

import { useState, type FormEvent } from 'react';
import { TONE_COLOR, type Message } from '@/components/FormMessage';
import { useSupabase } from '@/components/Providers';
import { useDashboard } from './DashboardShell';
import { Modal } from './Modal';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const supabase = useSupabase();
  const { userId, profile, refreshProfile } = useDashboard();
  const [username, setUsername] = useState(profile.username ?? '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage({ text: 'Saving changes...', tone: 'strong' });

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ username: username.trim() })
      .eq('id', userId);

    if (profileError) {
      setMessage({ text: 'Error: ' + profileError.message, tone: 'error' });
      setBusy(false);
      return;
    }
    await refreshProfile();

    if (password.trim() !== '') {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setMessage({ text: 'Username saved, but password failed: ' + authError.message, tone: 'error' });
        setBusy(false);
        return;
      }
    }

    setMessage({ text: 'Changes saved successfully!', tone: 'success' });
    setPassword('');
    setTimeout(onClose, 1500);
  };

  return (
    <Modal
      id="settings-modal"
      title="⚙️ Account Settings"
      subtitle="Update your public username and password."
      onClose={onClose}
    >
      <form id="settings-form" className="settings-form-layout" onSubmit={onSubmit}>
        <div className="form-group">
          <label htmlFor="settings-username">Public Username</label>
          <input
            type="text"
            id="settings-username"
            placeholder="New username"
            required
            minLength={3}
            maxLength={50}
            pattern="^[a-zA-Z0-9_]+$"
            title="Usernames can only contain letters, numbers, and underscores (3-50 chars)."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="settings-password">New Password</label>
          <input
            type="password"
            id="settings-password"
            placeholder="Leave blank to keep current"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn-save-settings" disabled={busy}>Save Changes</button>
        <div id="settings-message" role="status" style={{ color: message ? TONE_COLOR[message.tone] : undefined }}>
          {message?.text ?? ''}
        </div>
      </form>
    </Modal>
  );
}
