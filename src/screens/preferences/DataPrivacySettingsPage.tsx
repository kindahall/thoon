'use client';

import {
  Activity,
  BarChart3,
  Check,
  ChevronRight,
  Cookie,
  Database,
  Download,
  FileText,
  Globe2,
  Link as LinkIcon,
  LockKeyhole,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';
import { patchJson, postJson } from '../../services/api-client';
import type { AuditEvent, UserPreferences } from '../../types/trading';

type DataPrivacySettingsPageProps = {
  auditLogs: AuditEvent[];
  preferences: UserPreferences;
};

type PrivacyAction = 'export-data' | 'download-report' | 'delete-account' | null;

export function DataPrivacySettingsPage({ auditLogs, preferences }: DataPrivacySettingsPageProps) {
  const [analyticsConsent, setAnalyticsConsent] = useState(preferences.analyticsConsent ?? true);
  const [personalizedExperience, setPersonalizedExperience] = useState(preferences.personalizedExperience ?? true);
  const [action, setAction] = useState<PrivacyAction>(null);
  const [status, setStatus] = useState('Ready');

  async function savePrivacy() {
    setStatus('Saving');

    try {
      await patchJson('/api/preferences', { analyticsConsent, personalizedExperience });
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function confirmPrivacyAction() {
    if (!action) {
      return;
    }

    setStatus(action === 'delete-account' ? 'Confirming' : 'Preparing');

    try {
      if (action === 'export-data' || action === 'download-report') {
        const payload = await postJson('/api/privacy/export', { report: action });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = href;
        link.download = `thoon-${action}-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(href);
        setStatus('Downloaded');
      } else {
        await postJson('/api/security/action', { action, confirmed: true });
        setStatus('Deletion workflow required');
      }

      setAction(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Action failed');
    }
  }

  return (
    <section className="data-privacy-page" aria-label="Data and privacy settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Data & Privacy</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={savePrivacy} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Exports are generated through the local backend.', 'Deletion requires confirmation.']} title="Data & Privacy" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="data-privacy" />

        <div className="data-privacy-layout">
          <div className="data-privacy-head">
            <div>
              <h2>Data & Privacy</h2>
              <p>Exports, controls and account data.</p>
            </div>
            <Badge tone="positive">Encrypted</Badge>
            <small>{status}</small>
          </div>

          <div className="data-privacy-grid">
            <Card className="privacy-summary-card">
              <div>
                <h2>Privacy Summary</h2>
                <PrivacySummaryRow>Your data is encrypted and secure</PrivacySummaryRow>
                <PrivacySummaryRow>You control privacy settings</PrivacySummaryRow>
                <PrivacySummaryRow>Export or delete anytime</PrivacySummaryRow>
              </div>
              <div className="privacy-shield">
                <ShieldCheck size={44} />
              </div>
            </Card>

            <div className="privacy-side-actions">
              <Card className="privacy-action-card">
                <Database size={21} />
                <div>
                  <h2>Export My Data</h2>
                  <p>Download account data and activity.</p>
                </div>
                <Button icon={<Download size={14} />} size="sm" variant="ghost" onClick={() => setAction('export-data')}>Export Data</Button>
              </Card>

              <Card className="privacy-action-card">
                <FileText size={21} />
                <div>
                  <h2>Download Reports</h2>
                  <p>Generate account reports.</p>
                </div>
                <select className="trading-select" defaultValue="">
                  <option value="" disabled>Select Report</option>
                  <option value="activity">Activity Report</option>
                  <option value="trading">Trading Activity</option>
                  <option value="audit">Audit Logs</option>
                </select>
                <Button icon={<Download size={14} />} size="sm" variant="ghost" onClick={() => setAction('download-report')}>Download</Button>
              </Card>
            </div>

            <Card className="privacy-controls-card">
              <PrivacyControl icon={<LockKeyhole size={18} />} label="Privacy Controls" value="Profile and activity visibility" />
              <PrivacyControl icon={<BarChart3 size={18} />} label="Analytics Consent" onToggle={() => setAnalyticsConsent((current) => !current)} toggled={analyticsConsent} value="Anonymous usage data" />
              <PrivacyControl icon={<Sparkles size={18} />} label="Personalized Experience" onToggle={() => setPersonalizedExperience((current) => !current)} toggled={personalizedExperience} value="Feature recommendations" />
              <PrivacyControl icon={<Cookie size={18} />} label="Cookies & Tracking" value="Manage tracking technologies" />
              <PrivacyControl icon={<Activity size={18} />} label="Data Retention" value="Retention rules" />
              <PrivacyControl icon={<LinkIcon size={18} />} label="Connected Apps" value="Apps connected to Thoon" />
              <PrivacyControl icon={<FileText size={18} />} label="Activity Logs" value={`${auditLogs.length} recent events`} />
              <PrivacyControl icon={<Globe2 size={18} />} label="Regional Privacy Options" value="Region-specific rights" />
            </Card>

            <div className="privacy-right-column">
              <Card className="data-control-card">
                <h2>Data You Control</h2>
                <div className="data-donut" aria-hidden="true" />
                <div className="data-legend">
                  <span><i /> Account Data <b>45%</b></span>
                  <span><i /> Trading Activity <b>30%</b></span>
                  <span><i /> Preferences <b>15%</b></span>
                  <span><i /> Other <b>10%</b></span>
                </div>
                <p>You have full control over export and deletion.</p>
              </Card>

              <Card className="privacy-delete-card">
                <Trash2 size={21} />
                <div>
                  <h2>Delete Account</h2>
                  <p>Permanently delete account data.</p>
                </div>
                <Button variant="danger" onClick={() => setAction('delete-account')}>Delete Account</Button>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Modal onClose={() => setAction(null)} open={action !== null} title={privacyActionTitle(action)}>
        <div className="confirmation-modal-body">
          <p>{privacyActionCopy(action)}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button size="sm" variant={action === 'delete-account' ? 'danger' : 'primary'} onClick={() => void confirmPrivacyAction()}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

type PrivacySummaryRowProps = {
  children: ReactNode;
};

function PrivacySummaryRow({ children }: PrivacySummaryRowProps) {
  return (
    <span className="privacy-summary-row">
      <Check size={15} />
      {children}
    </span>
  );
}

type PrivacyControlProps = {
  icon: ReactNode;
  label: string;
  onToggle?: () => void;
  toggled?: boolean;
  value: string;
};

function PrivacyControl({ icon, label, onToggle, toggled, value }: PrivacyControlProps) {
  return (
    <div className="privacy-control-row">
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
      {onToggle ? <button aria-label={label} className={`switch ${toggled ? 'is-on' : ''}`} onClick={onToggle} type="button" /> : <ChevronRight size={17} />}
    </div>
  );
}

function privacyActionTitle(action: PrivacyAction) {
  switch (action) {
    case 'export-data':
      return 'Export My Data';
    case 'download-report':
      return 'Download Report';
    case 'delete-account':
      return 'Delete Account';
    default:
      return 'Privacy Action';
  }
}

function privacyActionCopy(action: PrivacyAction) {
  switch (action) {
    case 'export-data':
      return 'The local backend will prepare a JSON export of account and activity data.';
    case 'download-report':
      return 'The local backend will generate the selected privacy report.';
    case 'delete-account':
      return 'This action must be confirmed before permanently deleting account data.';
    default:
      return 'Confirm this privacy action.';
  }
}
