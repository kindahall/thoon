'use client';

import { Database, Globe2, KeyRound, Save, ShieldCheck, SlidersHorizontal, UserCircle, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { UserProfile } from '../../types/trading';

type ProfileSettingsPageProps = {
  profile: UserProfile;
};

type ProfileTabId = 'account' | 'locale' | 'trading' | 'access' | 'privacy';

type ProfileTab = {
  icon: ReactNode;
  id: ProfileTabId;
  label: string;
  tone: 'cyan' | 'green' | 'orange' | 'pink' | 'violet' | 'yellow';
};

const profileTabs: ProfileTab[] = [
  { icon: <UserCircle size={16} />, id: 'account', label: 'Account Details', tone: 'violet' },
  { icon: <Globe2 size={16} />, id: 'locale', label: 'Locale', tone: 'cyan' },
  { icon: <SlidersHorizontal size={16} />, id: 'trading', label: 'Trading', tone: 'green' },
  { icon: <ShieldCheck size={16} />, id: 'access', label: 'Access', tone: 'yellow' },
  { icon: <Database size={16} />, id: 'privacy', label: 'Privacy', tone: 'pink' },
];

export function ProfileSettingsPage({ profile }: ProfileSettingsPageProps) {
  const [activeTab, setActiveTab] = useState<ProfileTabId>('account');
  const [profileDraft, setProfileDraft] = useState(profile);
  const [saveStatus, setSaveStatus] = useState('Ready');
  const activeTabConfig = profileTabs.find((tab) => tab.id === activeTab) ?? profileTabs[0];

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
      <div className="workspace-header workspace-header--compact profile-settings-hero">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Profile</h1>
        </div>
        <div className="workspace-header__right">
          <small>{saveStatus}</small>
          <Button icon={<Save size={15} />} onClick={saveProfile} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Profile data stays scoped to this workspace.', 'Exchange secrets are managed outside profile.']} title="Profile" />
        </div>
      </div>

      <div className="preferences-layout profile-preferences-layout">
        <PreferencesSectionNav active="profile" />

        <div className="profile-clean-main">
          <div className="profile-clean-tabs" role="tablist" aria-label="Profile sections">
            {profileTabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={`profile-clean-tab is-${tab.tone}${activeTab === tab.id ? ' is-active' : ''}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="profile-clean-grid">
            <div className="profile-clean-left">
              <Card className="profile-clean-identity">
                <div className="profile-clean-avatar" aria-hidden="true">
                  {profileDraft.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="profile-clean-name">
                  <h2>{profileDraft.name}</h2>
                  <span>@{profileDraft.username}</span>
                  <div>
                    <Badge tone="primary">Private</Badge>
                    <Badge tone="positive">Paper</Badge>
                    <Badge>Compact</Badge>
                  </div>
                </div>
                <div className="profile-clean-metrics">
                  <ProfileMetric label="Email" value={profileDraft.email} />
                  <ProfileMetric label="Country" value={profileDraft.country} />
                  <ProfileMetric label="Currency" value={profileDraft.mainCurrency} />
                  <ProfileMetric label="Level" value={titleCase(profileDraft.tradingExperience)} />
                </div>
              </Card>

              <Card className={`profile-clean-panel is-${activeTabConfig.tone}`} role="tabpanel">
                <div className="profile-clean-panel-head">
                  <div>
                    {activeTabConfig.icon}
                    <h2>{activeTabConfig.label}</h2>
                  </div>
                  <Badge tone={saveStatus === 'Saved' ? 'positive' : 'primary'}>{saveStatus}</Badge>
                </div>
                {renderProfilePanel(activeTab, profileDraft, updateProfile)}
              </Card>
            </div>

            <div className="profile-clean-side">
              <Card className="profile-clean-status">
                <h2>Status</h2>
                <ProfileStatusRow label="Plan" tone="cyan" value="Private" />
                <ProfileStatusRow label="Live" tone="green" value="Guarded" />
                <ProfileStatusRow label="Keys" tone="pink" value="0" />
                <ProfileStatusRow label="Alerts" value="0" />
              </Card>

              <Card className="profile-clean-actions">
                <h2>Actions</h2>
                <div>
                  <ProfileAction href="/preferences/security" label="Security" tone="cyan" />
                  <ProfileAction href="/exchanges" label="Exchanges" tone="green" />
                  <ProfileAction href="/preferences/data-privacy" label="Privacy" tone="violet" />
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function renderProfilePanel(activeTab: ProfileTabId, profileDraft: UserProfile, updateProfile: (update: Partial<UserProfile>) => void) {
  if (activeTab === 'locale') {
    return (
      <div className="profile-selector-grid">
        <ProfileSelect label="Country" onChange={(value) => updateProfile({ country: value })} options={['FR', 'US', 'GB', 'AE', 'SG']} value={profileDraft.country} />
        <ProfileSelect label="Language" onChange={(value) => updateProfile({ language: value === 'en' ? 'en' : 'fr' })} options={['fr', 'en']} value={profileDraft.language} />
        <ProfileSelect label="Timezone" onChange={(value) => updateProfile({ timezone: value })} options={['Europe/Paris', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Singapore']} value={profileDraft.timezone} />
        <ProfileSelect label="Currency" onChange={(value) => updateProfile({ mainCurrency: normalizeCurrency(value) })} options={['USDT', 'USD', 'EUR']} value={profileDraft.mainCurrency} />
      </div>
    );
  }

  if (activeTab === 'trading') {
    return (
      <div className="profile-selector-grid">
        <ProfileSegmented
          label="Experience"
          onChange={(value) => updateProfile({ tradingExperience: normalizeExperience(value) })}
          options={['beginner', 'intermediate', 'advanced']}
          value={profileDraft.tradingExperience}
        />
        <ProfileLinkSelector href="/preferences/trading-defaults" icon={<SlidersHorizontal size={18} />} label="Defaults" value="Open" />
        <ProfileLinkSelector href="/exchanges" icon={<WalletCards size={18} />} label="Exchange" value="Connect" />
      </div>
    );
  }

  if (activeTab === 'access') {
    return (
      <div className="profile-selector-grid">
        <ProfileLinkSelector href="/preferences/security" icon={<ShieldCheck size={18} />} label="Security" value="Open" />
        <ProfileLinkSelector href="/preferences/audit-logs" icon={<KeyRound size={18} />} label="Sessions" value="Audit" />
      </div>
    );
  }

  if (activeTab === 'privacy') {
    return (
      <div className="profile-selector-grid">
        <ProfileLinkSelector href="/preferences/data-privacy" icon={<Database size={18} />} label="Data" value="Export" />
        <ProfileLinkSelector href="/preferences/data-privacy" icon={<ShieldCheck size={18} />} label="Secrets" value="Masked" />
      </div>
    );
  }

  return (
    <div className="profile-selector-grid">
      <ProfileField label="Name" onChange={(value) => updateProfile({ name: value })} value={profileDraft.name} />
      <ProfileField label="Username" onChange={(value) => updateProfile({ username: value })} value={profileDraft.username} />
      <ProfileField label="Email" onChange={(value) => updateProfile({ email: value })} value={profileDraft.email} />
      <ProfileSelect label="Language" onChange={(value) => updateProfile({ language: value === 'en' ? 'en' : 'fr' })} options={['fr', 'en']} value={profileDraft.language} />
      <ProfileSelect label="Experience" onChange={(value) => updateProfile({ tradingExperience: normalizeExperience(value) })} options={['beginner', 'intermediate', 'advanced']} value={profileDraft.tradingExperience} />
      <ProfileSelect label="Currency" onChange={(value) => updateProfile({ mainCurrency: normalizeCurrency(value) })} options={['USDT', 'USD', 'EUR']} value={profileDraft.mainCurrency} />
    </div>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-clean-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProfileStatusRow({ label, tone = 'neutral', value }: { label: string; tone?: 'cyan' | 'green' | 'neutral' | 'pink'; value: string }) {
  return (
    <div className={`profile-status-row is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProfileAction({ href, label, tone }: { href: string; label: string; tone: 'cyan' | 'green' | 'orange' | 'violet' }) {
  return (
    <Link className={`profile-action-link is-${tone}`} href={href}>
      {label}
    </Link>
  );
}

function ProfileField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="profile-selector">
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function ProfileSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label className="profile-selector">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {titleCase(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileSegmented({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <div className="profile-selector profile-selector--segmented">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button className={option === value ? 'is-active' : undefined} key={option} onClick={() => onChange(option)} type="button">
            {titleCase(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileLinkSelector({ href, icon, label, value }: { href: string; icon: ReactNode; label: string; value: string }) {
  return (
    <Link className="profile-selector profile-link-selector" href={href}>
      <span>{label}</span>
      <strong>
        {icon}
        {value}
      </strong>
    </Link>
  );
}

function normalizeCurrency(value: string): UserProfile['mainCurrency'] {
  return value === 'EUR' || value === 'USD' ? value : 'USDT';
}

function normalizeExperience(value: string): UserProfile['tradingExperience'] {
  return value === 'beginner' || value === 'advanced' ? value : 'intermediate';
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll('-', ' ');
}
