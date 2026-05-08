'use client';

import { Bell, CreditCard, Database, Moon, Save, ShieldCheck, SlidersHorizontal, UserCircle, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Button, Card, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { UserProfile } from '../../types/trading';

type ProfileSettingsPageProps = {
  profile: UserProfile;
};

export function ProfileSettingsPage({ profile }: ProfileSettingsPageProps) {
  const [profileDraft, setProfileDraft] = useState(profile);
  const [saveStatus, setSaveStatus] = useState('Ready');

  function updateProfile(update: Partial<UserProfile>) {
    setProfileDraft((currentProfile) => ({ ...currentProfile, ...update }));
  }

  async function saveProfile() {
    setSaveStatus('Saving');

    try {
      const savedProfile = await patchJson<UserProfile>('/api/profile', profileDraft);
      setProfileDraft(savedProfile);
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="profile-settings-page" aria-label="Profile settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Profile</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveProfile} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Profile data is only used for local preferences.', 'No exchange secrets are stored here.']} title="Profile" />
        </div>
      </div>

      <div className="preferences-layout profile-preferences-layout">
        <PreferencesSectionNav active="profile" />

        <div className="profile-settings-main">
          <Card className="profile-settings-hero">
            <div className="profile-settings-identity">
              <div className="profile-avatar profile-avatar--photo" aria-hidden="true">
                <UserCircle size={48} />
              </div>
              <div>
                <h2>{profileDraft.name}</h2>
                <span>@{profileDraft.username}</span>
                <b>Private plan</b>
              </div>
            </div>
            <dl>
              <ProfileFact label="Email" value={profileDraft.email} />
              <ProfileFact label="Country" value={profileDraft.country} />
              <ProfileFact label="Timezone" value={profileDraft.timezone} />
              <ProfileFact label="Currency" value={profileDraft.mainCurrency} />
            </dl>
            <Link className="profile-manage-plan" href="/preferences/billing">Manage Plan</Link>
          </Card>

          <div className="profile-settings-grid">
            <Card className="profile-form-card profile-settings-card--wide">
              <div className="profile-settings-card-head">
                <UserCircle size={18} />
                <div>
                  <h2>Account Details</h2>
                  <span>{saveStatus}</span>
                </div>
              </div>
              <div className="profile-field-grid">
                <ProfileField label="Name" onChange={(value) => updateProfile({ name: value })} value={profileDraft.name} />
                <ProfileField label="Username" onChange={(value) => updateProfile({ username: value })} value={profileDraft.username} />
                <ProfileField label="Email" onChange={(value) => updateProfile({ email: value })} value={profileDraft.email} />
                <ProfileField label="Phone" value="Not set" />
                <ProfileField label="Country" onChange={(value) => updateProfile({ country: value })} value={profileDraft.country} />
                <ProfileField label="Language" onChange={(value) => updateProfile({ language: value.toLowerCase() === 'en' ? 'en' : 'fr' })} value={profileDraft.language.toUpperCase()} />
                <ProfileField label="Timezone" onChange={(value) => updateProfile({ timezone: value })} value={profileDraft.timezone} />
                <ProfileField label="Currency" onChange={(value) => updateProfile({ mainCurrency: value === 'EUR' ? 'EUR' : value === 'USD' ? 'USD' : 'USDT' })} value={profileDraft.mainCurrency} />
                <ProfileField
                  label="Experience"
                  onChange={(value) => updateProfile({ tradingExperience: value === 'beginner' || value === 'advanced' ? value : 'intermediate' })}
                  value={profileDraft.tradingExperience}
                />
              </div>
            </Card>

            <ProfileShortcutCard href="/preferences/appearance" icon={<Moon size={18} />} title="Appearance" rows={[['Theme', 'Open settings'], ['Density', 'Open settings']]} />
            <ProfileShortcutCard href="/preferences/trading-defaults" icon={<SlidersHorizontal size={18} />} title="Trading Defaults" rows={[['Risk', 'Trading defaults'], ['Leverage', 'Trading defaults'], ['Order Type', 'Trading defaults']]} />
            <ProfileShortcutCard href="/preferences/security" icon={<ShieldCheck size={18} />} title="Security" rows={[['Password', 'Security page'], ['2FA', 'Security page'], ['Sessions', 'Audit logs']]} />
            <ProfileShortcutCard href="/preferences/notifications" icon={<Bell size={18} />} title="Notifications" rows={[['App', 'Notification rules'], ['Email', 'Notification rules'], ['Webhook', 'Notification rules']]} />
            <ProfileShortcutCard href="/preferences/exchange-api" icon={<WalletCards size={18} />} title="Exchange & API" rows={[['Connections', 'Manage'], ['API keys', 'Manage'], ['Scopes', 'Manage']]} />
            <ProfileShortcutCard href="/preferences/billing" icon={<CreditCard size={18} />} title="Billing & Plan" rows={[['Plan', 'Private'], ['Currency', profileDraft.mainCurrency], ['Billing', 'Manage']]} />
            <ProfileShortcutCard className="profile-settings-card--wide" href="/preferences/data-privacy" icon={<Database size={18} />} title="Data & Privacy" rows={[['Storage', 'Local JSON DB'], ['Exports', 'Available'], ['Secrets', 'Masked']]} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ProfileShortcutCard({ className = '', href, icon, rows, title }: { className?: string; href: string; icon: ReactNode; rows: Array<[string, string]>; title: string }) {
  return (
    <Card className={`profile-settings-card ${className}`}>
      <div className="profile-settings-card-head">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="profile-settings-rows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Link href={href}>Manage {title}</Link>
    </Card>
  );
}

function ProfileField({ label, onChange, value }: { label: string; onChange?: (value: string) => void; value: string }) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      <input onChange={(event) => onChange?.(event.target.value)} readOnly={!onChange} value={value} />
    </label>
  );
}
