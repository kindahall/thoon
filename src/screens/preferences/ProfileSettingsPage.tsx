'use client';

import { Save, UserCircle } from 'lucide-react';
import { useState } from 'react';

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

      <div className="profile-settings-layout">
        <Card className="profile-card">
          <div className="profile-avatar" aria-hidden="true">
            <UserCircle size={42} />
          </div>
          <h2>{profileDraft.name}</h2>
          <span>@{profileDraft.username}</span>
          <b>Private plan</b>
          <small>{saveStatus}</small>
        </Card>

        <Card className="profile-form-card">
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
      </div>
    </section>
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
