'use client';

import {
  Bell,
  Bot,
  CalendarDays,
  Check,
  Link as LinkIcon,
  Mail,
  Megaphone,
  Moon,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson, postJson } from '../../services/api-client';
import type { Alert } from '../../types/trading';

type NotificationsSettingsPageProps = {
  alerts: Alert[];
};

type NotificationToggleKey =
  | 'app'
  | 'email'
  | 'push'
  | 'sound'
  | 'webhook'
  | 'tradeExecution'
  | 'bot'
  | 'strategy'
  | 'security'
  | 'quietHours';

const recentNotifications = [
  { category: 'Trade', detail: 'Buy 0.125 BTC/USDT at 67,280.50', icon: <Bell size={16} />, title: 'Order Filled', time: '2m ago' },
  { category: 'Strategy', detail: 'Momentum Breakout on ETH/USDT', icon: <TrendingUp size={16} />, title: 'Strategy Signal', time: '15m ago' },
  { category: 'Bot', detail: 'Grid Bot started on BTC/USDT', icon: <Bot size={16} />, title: 'Bot Started', time: '32m ago' },
  { category: 'Security', detail: 'Chrome on macOS · Paris, FR', icon: <ShieldCheck size={16} />, title: 'New Login Detected', time: '1h ago' },
];

export function NotificationsSettingsPage({ alerts }: NotificationsSettingsPageProps) {
  const [enabled, setEnabled] = useState<Record<NotificationToggleKey, boolean>>({
    app: true,
    bot: true,
    email: true,
    push: true,
    quietHours: true,
    security: true,
    sound: true,
    strategy: true,
    tradeExecution: true,
    webhook: true,
  });
  const [digest, setDigest] = useState<'off' | 'daily' | 'weekly'>('daily');
  const [lastTest, setLastTest] = useState<string | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Ready');
  const activeAlerts = useMemo(() => alerts.filter((alert) => alert.status === 'active').length, [alerts]);
  const visibleNotifications = showAllRecent ? recentNotifications : recentNotifications.slice(0, 3);

  function toggle(key: NotificationToggleKey) {
    setEnabled((current) => ({ ...current, [key]: !current[key] }));
  }

  async function saveNotifications() {
    setSaveStatus('Saving');

    try {
      await patchJson('/api/preferences', { notificationDigest: digest, notificationSettings: enabled });
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function sendTest(channel: string) {
    setLastTest(null);

    try {
      await postJson('/api/notifications/test', { channel });
      setLastTest(channel);
    } catch (error) {
      setLastTest(error instanceof Error ? error.message : 'Test failed');
    }
  }

  return (
    <section className="notifications-settings-page" aria-label="Notifications settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Notifications</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveNotifications} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Trading alerts stay priority.', 'Webhook tests are recorded through the local backend.']} title="Notifications" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="notifications" />

        <div className="notifications-layout">
          <div className="notifications-head">
            <div>
              <h2>Notifications</h2>
              <p>Channels, trading alerts and delivery windows.</p>
            </div>
            <Badge tone="positive">{activeAlerts} active alerts</Badge>
            <small>{saveStatus}</small>
          </div>

          <div className="notifications-grid">
            <NotificationCard detail="In-app alerts and platform updates." icon={<Bell size={20} />} label="App Notifications" onToggle={() => toggle('app')} status="Enabled" enabled={enabled.app} />
            <NotificationCard detail="artisaul@example.invalid" icon={<Mail size={20} />} label="Email Notifications" onToggle={() => toggle('email')} status="Enabled" enabled={enabled.email} />
            <NotificationCard detail="Desktop + Mobile" icon={<Smartphone size={20} />} label="Push Notifications" onToggle={() => toggle('push')} status="Enabled" enabled={enabled.push} />
            <NotificationCard detail="Play a sound for important alerts." icon={<Volume2 size={20} />} label="Sound Alerts" onToggle={() => toggle('sound')} status="Enabled" enabled={enabled.sound}>
              <select className="notification-select" defaultValue="chime">
                <option value="chime">Chime</option>
                <option value="pulse">Pulse</option>
                <option value="silent">Silent</option>
              </select>
            </NotificationCard>
            <NotificationCard detail="2 endpoints configured." icon={<LinkIcon size={20} />} label="Webhook Alerts" onToggle={() => toggle('webhook')} status="Enabled" enabled={enabled.webhook} />
            <NotificationCard detail="Order fills, partial fills, cancellations." icon={<Megaphone size={20} />} label="Trade Execution Notices" onToggle={() => toggle('tradeExecution')} status="Enabled" enabled={enabled.tradeExecution} />
            <NotificationCard detail="Bot starts, stops, errors and status." icon={<Bot size={20} />} label="Bot Alerts" onToggle={() => toggle('bot')} status="Enabled" enabled={enabled.bot} />
            <NotificationCard detail="Signals, activations and errors." icon={<TrendingUp size={20} />} label="Strategy Alerts" onToggle={() => toggle('strategy')} status="Enabled" enabled={enabled.strategy} />
            <NotificationCard detail="Login activity, API keys, password changes." icon={<ShieldCheck size={20} />} label="Security Alerts" onToggle={() => toggle('security')} status="Enabled" enabled={enabled.security} />

            <Card className="notification-settings-card notification-settings-card--wide">
              <div className="notification-card-head">
                <span className="notification-card-icon"><CalendarDays size={20} /></span>
                <div>
                  <h3>Digest Frequency</h3>
                  <p>Summary of non-urgent alerts.</p>
                </div>
              </div>
              <div className="segmented-options">
                {(['off', 'daily', 'weekly'] as const).map((option) => (
                  <button className={digest === option ? 'is-active' : undefined} key={option} onClick={() => setDigest(option)} type="button">
                    {digestLabel(option)}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="notification-settings-card notification-settings-card--wide">
              <div className="notification-card-head">
                <span className="notification-card-icon"><Moon size={20} /></span>
                <div>
                  <h3>Quiet Hours</h3>
                  <p>Pause non-critical notifications.</p>
                </div>
                <button aria-label="Quiet hours" className={`switch ${enabled.quietHours ? 'is-on' : ''}`} onClick={() => toggle('quietHours')} type="button" />
              </div>
              <div className="quiet-hours-grid">
                <label>
                  From
                  <input readOnly value="22:00" />
                </label>
                <label>
                  To
                  <input readOnly value="07:00" />
                </label>
                <label>
                  Timezone
                  <input readOnly value="Europe/Paris" />
                </label>
              </div>
            </Card>

            <Card className="notification-test-card">
              <div className="notification-card-head">
                <span className="notification-card-icon"><Send size={20} /></span>
                <div>
                  <h3>Channel Testing</h3>
                  <p>Check delivery.</p>
                </div>
              </div>
              {['App Notification', 'Email Notification', 'Push Notification', 'Webhook Alert'].map((channel) => (
                <div className="notification-test-row" key={channel}>
                  <span>{channel}</span>
                  <Button size="sm" variant="ghost" onClick={() => void sendTest(channel)}>
                    Send Test
                  </Button>
                </div>
              ))}
              {lastTest ? <small><Check size={13} /> {lastTest} sent</small> : null}
            </Card>
          </div>

          <Card className="recent-notifications-card">
            <div className="recent-notifications-card__head">
              <h2>Recent Notification Preview</h2>
              <button className={showAllRecent ? 'is-active' : undefined} onClick={() => setShowAllRecent((current) => !current)} type="button">
                {showAllRecent ? 'View Less' : 'View All'}
              </button>
            </div>
            <div className="recent-notification-list">
              {visibleNotifications.map((notification) => (
                <div className="recent-notification-row" key={notification.title}>
                  <span className="notification-card-icon">{notification.icon}</span>
                  <div>
                    <strong>{notification.title}</strong>
                    <small>{notification.detail}</small>
                  </div>
                  <Badge>{notification.category}</Badge>
                  <span>{notification.time}</span>
                  <div className="notification-channel-icons" aria-label="Channels">
                    <Bell size={15} />
                    <Mail size={15} />
                    <Smartphone size={15} />
                    <LinkIcon size={15} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

type NotificationCardProps = {
  children?: ReactNode;
  detail: string;
  enabled: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
  status: string;
};

function NotificationCard({ children, detail, enabled, icon, label, onToggle, status }: NotificationCardProps) {
  return (
    <Card className="notification-settings-card">
      <div className="notification-card-head">
        <span className="notification-card-icon">{icon}</span>
        <div>
          <h3>{label}</h3>
          <p>{detail}</p>
        </div>
        <Badge tone={enabled ? 'positive' : 'neutral'}>{enabled ? status : 'Paused'}</Badge>
        <button aria-label={label} className={`switch ${enabled ? 'is-on' : ''}`} onClick={onToggle} type="button" />
      </div>
      {children}
    </Card>
  );
}

function digestLabel(value: 'off' | 'daily' | 'weekly') {
  return value === 'off' ? 'Off' : value === 'daily' ? 'Daily' : 'Weekly';
}
