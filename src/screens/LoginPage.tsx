'use client';

import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '../components/ui';

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('Session required');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');

    const response = await fetch('/api/auth/login', {
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? 'Login failed');
      setStatus('error');
      return;
    }

    router.replace(searchParams.get('next') || '/charts');
    router.refresh();
  }

  return (
    <section className="login-page" aria-label="Thoon sign in">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-panel__mark" aria-hidden="true">
          <ShieldCheck size={24} />
        </div>
        <div>
          <p className="workspace-kicker">Production access</p>
          <h1>Unlock Thoon</h1>
        </div>
        <label>
          <span>Email</span>
          <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        </label>
        <label>
          <span>Password</span>
          <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        </label>
        <Button disabled={status === 'loading'} icon={<LockKeyhole size={16} />} type="submit">
          {status === 'loading' ? 'Checking' : 'Sign in'}
        </Button>
        <p className={status === 'error' ? 'login-panel__status login-panel__status--error' : 'login-panel__status'}>{message}</p>
      </form>
    </section>
  );
}
