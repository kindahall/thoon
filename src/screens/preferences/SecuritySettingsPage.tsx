'use client';

import {
  ChevronRight,
  Clock3,
  Fingerprint,
  Grid2X2,
  KeyRound,
  Laptop,
  LockKeyhole,
  Monitor,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserX,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';
import { postJson } from '../../services/api-client';
import type { ApiKeyRecord, AuditEvent, ExchangeConnection, RiskRules } from '../../types/trading';

type SecuritySettingsPageProps = {
  apiKeys: ApiKeyRecord[];
  auditLogs: AuditEvent[];
  exchanges: ExchangeConnection[];
  riskRules: RiskRules;
};

type ConfirmationKind = 'password' | 'backup-codes' | 'deactivate' | 'delete-account' | null;

export function SecuritySettingsPage({ apiKeys, auditLogs, exchanges, riskRules }: SecuritySettingsPageProps) {
  const [confirmation, setConfirmation] = useState<ConfirmationKind>(null);
  const [status, setStatus] = useState('Ready');
  const activeSessions = auditLogs.filter((log) => log.action.toLowerCase().includes('login') && log.status === 'success').length;
  const connectedExchanges = exchanges.filter((exchange) => exchange.status === 'connected').length;
  const activeApiKeys = apiKeys.filter((keyRecord) => keyRecord.status === 'active').length;
  const latestAudit = auditLogs[0];

  async function confirmSecurityAction() {
    if (!confirmation) {
      return;
    }

    setStatus('Confirming');

    try {
      await postJson('/api/security/action', { action: confirmation, confirmed: true });
      setStatus('Confirmed');
      setConfirmation(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Action failed');
    }
  }

  return (
    <section className="security-settings-page" aria-label="Security settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Security</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={() => void postJson('/api/security/action', { action: 'save-security-settings' }).then(() => setStatus('Saved')).catch((error) => setStatus(error instanceof Error ? error.message : 'Save failed'))} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Sensitive changes require confirmation.', 'API secrets stay server-side and masked.']} title="Security" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="security" />

        <div className="security-layout">
          <div className="security-head">
            <div>
              <h2>Security</h2>
              <p>Account access, sessions and API protection.</p>
              <small>{status}</small>
            </div>
          </div>

          <Card className="security-status-card">
            <SecurityStatus icon={<ShieldCheck size={24} />} label="Protected" value={riskRules.confirmLiveOrders ? 'Live confirmations on' : 'Review confirmations'} />
            <SecurityStatus icon={<LockKeyhole size={24} />} label="2FA" value="Not configured" />
            <SecurityStatus icon={<Monitor size={24} />} label={String(activeSessions)} value="Active sessions" />
            <SecurityStatus icon={<Clock3 size={24} />} label="Last login" value={latestAudit ? 'May 5, 2026 · 09:02' : 'No recent login'} />
          </Card>

          <div className="security-card-grid">
            <SecurityPanel title="Authentication">
              <SecurityRow action="Change" icon={<LockKeyhole size={18} />} label="Password" onAction={() => setConfirmation('password')} value="Update account password" />
              <SecurityRow badgeTone="neutral" icon={<ShieldCheck size={18} />} label="Two-Factor Authentication" status="Not configured" value="Extra account protection" />
              <SecurityRow badgeTone="neutral" icon={<KeyRound size={18} />} label="Authenticator App" status="Not configured" value="Manage authenticator app" />
              <SecurityRow action="View" icon={<Grid2X2 size={18} />} label="Backup Codes" onAction={() => setConfirmation('backup-codes')} value="View recovery codes" />
            </SecurityPanel>

            <SecurityPanel title="Access & Sessions">
              <SecurityRow icon={<Laptop size={18} />} label="Device Management" value="Manage trusted devices" />
              <SecurityRow badgeTone="positive" icon={<Clock3 size={18} />} label="Active Sessions" status={`${activeSessions} active`} value="Review open sessions" />
              <SecurityRow icon={<Clock3 size={18} />} label="Login History" value="Recent login activity" />
              <SecurityRow badgeTone="neutral" icon={<ShieldCheck size={18} />} label="IP Allowlist" status="Not enabled" value="Trusted IP addresses" />
            </SecurityPanel>

            <SecurityPanel title="API Security">
              <SecurityRow icon={<KeyRound size={18} />} label="API Permissions" status={`${activeApiKeys}/${apiKeys.length} active`} value={`${connectedExchanges} exchanges connected`} />
              <SecurityRow badgeTone="neutral" icon={<ShieldCheck size={18} />} label="IP Restrictions" status="Not enabled" value="Restrict API access to IPs" />
            </SecurityPanel>

            <SecurityPanel title="Additional Security">
              <SecurityRow badgeTone="positive" icon={<Fingerprint size={18} />} label="Biometric Unlock" status="Enabled" value="Unlock the app locally" />
              <SecurityRow icon={<Smartphone size={18} />} label="Trusted Device" status="This device" value="Current browser session" />
            </SecurityPanel>
          </div>

          <Card className="danger-zone-card">
            <div>
              <h2>Danger Zone</h2>
              <p>Permanent account actions.</p>
            </div>
            <SecurityRow action="Deactivate" danger icon={<UserX size={18} />} label="Deactivate Account" onAction={() => setConfirmation('deactivate')} value="Temporarily disable account access" />
            <SecurityRow action="Delete Account" danger icon={<Trash2 size={18} />} label="Delete Account" onAction={() => setConfirmation('delete-account')} value="Permanently delete all data" />
          </Card>
        </div>
      </div>

      <Modal onClose={() => setConfirmation(null)} open={confirmation !== null} title={confirmationTitle(confirmation)}>
        <div className="confirmation-modal-body">
          <p>{confirmationCopy(confirmation)}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button size="sm" variant={confirmation === 'delete-account' || confirmation === 'deactivate' ? 'danger' : 'primary'} onClick={() => void confirmSecurityAction()}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

type SecurityStatusProps = {
  icon: ReactNode;
  label: string;
  tone?: 'positive';
  value: string;
};

function SecurityStatus({ icon, label, tone, value }: SecurityStatusProps) {
  return (
    <div className="security-status">
      <span className={tone === 'positive' ? 'is-positive' : undefined}>{icon}</span>
      <div>
        <strong className={tone === 'positive' ? 'positive' : undefined}>{label}</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

type SecurityPanelProps = {
  children: ReactNode;
  title: string;
};

function SecurityPanel({ children, title }: SecurityPanelProps) {
  return (
    <Card className="security-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </Card>
  );
}

type SecurityRowProps = {
  action?: string;
  badgeTone?: 'positive' | 'neutral';
  danger?: boolean;
  icon: ReactNode;
  label: string;
  onAction?: () => void;
  status?: string;
  value: string;
};

function SecurityRow({ action, badgeTone = 'neutral', danger = false, icon, label, onAction, status, value }: SecurityRowProps) {
  return (
    <div className={`security-row ${danger ? 'is-danger' : ''}`}>
      <span className="security-row__icon">{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
      {status ? <Badge tone={badgeTone === 'positive' ? 'positive' : 'neutral'}>{status}</Badge> : null}
      {action ? (
        <Button size="sm" variant={danger ? 'danger' : 'ghost'} onClick={onAction}>
          {action}
        </Button>
      ) : (
        <ChevronRight size={17} />
      )}
    </div>
  );
}

function confirmationTitle(kind: ConfirmationKind) {
  switch (kind) {
    case 'password':
      return 'Confirm Password Change';
    case 'backup-codes':
      return 'View Backup Codes';
    case 'deactivate':
      return 'Deactivate Account';
    case 'delete-account':
      return 'Delete Account';
    default:
      return 'Confirm Action';
  }
}

function confirmationCopy(kind: ConfirmationKind) {
  switch (kind) {
    case 'password':
      return 'Confirm before opening the password change flow.';
    case 'backup-codes':
      return 'Backup codes are sensitive. Continue only if you are in a private environment.';
    case 'deactivate':
      return 'Deactivation will pause access and block live actions until reactivation.';
    case 'delete-account':
      return 'This action is permanent and is recorded before any destructive backend workflow runs.';
    default:
      return 'Confirm this security action.';
  }
}
