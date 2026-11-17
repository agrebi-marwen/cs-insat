'use client';

import { useState, type FormEvent } from 'react';
import { FormMessage, type Message } from '@/components/FormMessage';

export function LoginForm() {
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);

    setBusy(true);
    setMessage({ text: 'Logging in...', tone: 'neutral' });

    try {
      // Rate limiting and the password check both happen on the server, which
      // sets the session cookies on success.
      const response = await fetch('/api/authLogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        setMessage({ text: 'Error: ' + (result.error || 'Login failed'), tone: 'error' });
        setBusy(false);
        return;
      }

      setMessage({ text: 'Success! Redirecting...', tone: 'success' });
      window.location.assign('/dashboard/dashboard');
    } catch {
      setMessage({ text: 'Error: authentication service unavailable.', tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <form className="signup-form" id="login-form" onSubmit={onSubmit}>
      <h2>Login</h2>
      <label htmlFor="email">Email:</label>
      <input type="email" id="email" name="email" autoComplete="email" required />

      <label htmlFor="password">Password:</label>
      <input type="password" id="password" name="password" autoComplete="current-password" required />

      <FormMessage message={message} />

      <a href="/account/signup">Don&apos;t have an account? Create one here</a>
      <button type="submit" disabled={busy}>Login</button>
    </form>
  );
}
