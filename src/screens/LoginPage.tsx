'use client';

import { Activity, BadgeCheck, KeyRound, Layers3, LockKeyhole, Radar, ShieldCheck, Sparkles } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '../components/ui';

export function LoginPage() {
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

    await response.json().catch(() => undefined);
    window.location.assign(safeNextPath(searchParams.get('next')));
  }

  return (
    <section className="login-page" aria-label="Thoon sign in">
      <div className="login-shell">
        <div className="login-visual" aria-label="Thoon production access status">
          <div className="login-visual__top">
            <span className="login-access-badge login-access-badge--cyan">
              <Radar size={15} />
              Production Gate
            </span>
            <span className="login-access-badge login-access-badge--green">
              <Activity size={15} />
              Guarded paper
            </span>
          </div>

          <div className="login-visual__copy">
            <p className="workspace-kicker">Secure trading workspace</p>
            <strong>Thoon command room</strong>
            <span>Acces controle pour ton cockpit, tes workspaces SaaS et les actions live bloquees par validation.</span>
          </div>

          <div className="login-market-grid" aria-label="Access checks">
            <div className="login-market-row login-market-row--cyan">
              <span>Workspace</span>
              <strong>Owner scope</strong>
              <em>isolated</em>
            </div>
            <div className="login-market-row login-market-row--green">
              <span>Session</span>
              <strong>HttpOnly</strong>
              <em>revocable</em>
            </div>
            <div className="login-market-row login-market-row--violet">
              <span>Agent</span>
              <strong>Thoonix</strong>
              <em>guarded</em>
            </div>
            <div className="login-market-row login-market-row--amber">
              <span>Live</span>
              <strong>Admin review</strong>
              <em>locked</em>
            </div>
          </div>

          <div className="login-signal-strip" aria-label="Security signals">
            <span>
              <ShieldCheck size={16} />
              Session secured
            </span>
            <span>
              <Layers3 size={16} />
              Tenant guard
            </span>
            <span>
              <BadgeCheck size={16} />
              Beta access
            </span>
          </div>
        </div>

        <form className="login-panel" onSubmit={submit}>
          <div className="login-panel__head">
            <div className="login-panel__mark" aria-hidden="true">
              <ShieldCheck size={24} />
            </div>
            <div>
              <p className="workspace-kicker">Production access</p>
              <h1>Unlock Thoon</h1>
              <span>Session required for this workspace.</span>
            </div>
          </div>

          <div className="login-field-stack">
            <label>
              <span>Email</span>
              <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            </label>
            <label>
              <span>Password</span>
              <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            </label>
          </div>

          <Button disabled={status === 'loading'} icon={<LockKeyhole size={16} />} type="submit">
            {status === 'loading' ? 'Checking access' : 'Sign in'}
          </Button>

          <div className="login-panel__meta">
            <p className={status === 'error' ? 'login-panel__status login-panel__status--error' : 'login-panel__status'} aria-live="polite">{message}</p>
            <span>
              <KeyRound size={14} />
              Workspace cookie only
            </span>
          </div>

          <div className="login-color-rail" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <Sparkles size={14} />
          </div>
        </form>
      </div>
    </section>
  );
}

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/charts';
  }

  try {
    const parsed = new URL(value, window.location.origin);

    if (parsed.origin !== window.location.origin) {
      return '/charts';
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/charts';
  } catch {
    return '/charts';
  }
}
