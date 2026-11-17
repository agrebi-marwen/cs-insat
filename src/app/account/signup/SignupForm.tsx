'use client';

import { useState, type FormEvent } from 'react';
import { FormMessage, type Message } from '@/components/FormMessage';
import { useSupabase } from '@/components/Providers';
import { passwordProblem } from '@/lib/utils';

export function SignupForm() {
  const supabase = useSupabase();
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const username = String(form.get('name') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm-password') ?? '');

    const error = (text: string) => setMessage({ text, tone: 'error' });

    const problem = passwordProblem(password);
    if (problem) return error('Error: ' + problem);
    if (password !== confirm) return error('Passwords do not match!');

    setBusy(true);
    setMessage({ text: 'Creating account...', tone: 'neutral' });

    try {
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username)
        .maybeSingle();
      if (checkError) console.error('Username availability check failed:', checkError);
      if (existing) {
        error('Error: Username is already taken!');
        setBusy(false);
        return;
      }

      const response = await fetch('/api/authSignup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        needsEmailConfirmation?: boolean;
      };

      if (!response.ok || result.error) {
        const taken = (result.error || '').toLowerCase().includes('already registered');
        error(taken ? 'Error: Email is already registered!' : 'Error: ' + (result.error || 'Signup failed'));
        setBusy(false);
        return;
      }

      setMessage({
        tone: 'success',
        text: result.needsEmailConfirmation
          ? 'Success! Account created. Check your email to confirm before logging in.'
          : 'Success! Account created. Redirecting to login...',
      });
      formEl.reset();
      setTimeout(() => window.location.assign('/account/login'), 1500);
    } catch {
      error('Error: registration service unavailable.');
      setBusy(false);
    }
  };

  return (
    <form className="signup-form" id="signup-form" onSubmit={onSubmit}>
      <h2>Create Account</h2>
      <label htmlFor="username">Username:</label>
      <input
        type="text"
        id="username"
        name="name"
        required
        minLength={3}
        maxLength={50}
        pattern="^[a-zA-Z0-9_]+$"
        autoComplete="username"
        title="Usernames can only contain letters, numbers, and underscores (3-50 chars)."
      />

      <label htmlFor="email">Email:</label>
      <input type="email" id="email" name="email" autoComplete="email" required />

      <label htmlFor="password">Password:</label>
      <input type="password" id="password" name="password" autoComplete="new-password" required />

      <label htmlFor="confirm-password">Confirm Password:</label>
      <input type="password" id="confirm-password" name="confirm-password" autoComplete="new-password" required />

      <FormMessage message={message} />

      <a href="/account/login" id="a_style">Already got an account? Log in here</a>
      <button type="submit" disabled={busy}>Create Account</button>
    </form>
  );
}
