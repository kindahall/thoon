'use client';

import { Check, Download, LockKeyhole, ReceiptText, Save } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { BillingPlanId, BillingSettings, UserPreferences } from '../../types/trading';

type BillingAction = 'all-invoices' | 'billing-history' | 'cancel-subscription' | 'compare-features' | 'download-invoice' | 'manage-plan' | 'save-changes' | 'usage-details' | null;

const plans = [
  { botSlots: 1, credits: 10, exchangeConnections: 1, id: 'free', label: 'Free', monthlyPrice: 0, support: 'Basic Support', yearlyPrice: 0 },
  { botSlots: 10, credits: 1000, exchangeConnections: 3, id: 'pro', label: 'Pro', monthlyPrice: 29, support: 'Priority Support', yearlyPrice: 290 },
  { botSlots: 50, credits: 10000, exchangeConnections: 12, id: 'elite', label: 'Elite', monthlyPrice: 79, support: 'Priority Support', yearlyPrice: 790 },
] satisfies Array<{ botSlots: number; credits: number; exchangeConnections: number; id: BillingPlanId; label: string; monthlyPrice: number; support: string; yearlyPrice: number }>;

type BillingSettingsPageProps = {
  preferences: UserPreferences;
};

export function BillingSettingsPage({ preferences }: BillingSettingsPageProps) {
  const [billing, setBilling] = useState(normalizeBillingSettings(preferences.billingSettings));
  const [action, setAction] = useState<BillingAction>(null);
  const [nextPlanId, setNextPlanId] = useState<BillingPlanId>(billing.planId);
  const [status, setStatus] = useState('Ready');
  const currentPlan = getPlan(billing.planId);
  const pendingPlan = getPlan(nextPlanId);
  const amount = billing.billingPeriod === 'monthly' ? currentPlan.monthlyPrice : currentPlan.yearlyPrice;
  const generatedReceipts = billing.localReceipts.length
    ? billing.localReceipts
    : [
        {
          amount,
          createdAt: billing.updatedAt,
          id: `CURRENT-${billing.planId.toUpperCase()}`,
          planId: billing.planId,
          status: 'generated' as const,
        },
      ];

  async function saveBilling(nextBilling = billing, successStatus = 'Saved') {
    setStatus('Saving');

    try {
      const updatedPreferences = await patchJson<UserPreferences>('/api/preferences', {
        billingSettings: {
          ...nextBilling,
          updatedAt: new Date().toISOString(),
        },
      });
      const persistedBilling = normalizeBillingSettings(updatedPreferences.billingSettings);

      setBilling(persistedBilling);
      setNextPlanId(persistedBilling.planId);
      setStatus(successStatus);
      setAction(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  function changeBillingPeriod(nextPeriod: BillingSettings['billingPeriod']) {
    const nextBilling = { ...billing, billingPeriod: nextPeriod };

    setBilling(nextBilling);
    void saveBilling(nextBilling, 'Period saved');
  }

  function startPlanChange(planId: BillingPlanId) {
    setNextPlanId(planId);
    setAction('manage-plan');
  }

  async function confirmBillingAction() {
    if (action === 'manage-plan') {
      await saveBilling({ ...billing, planId: nextPlanId, status: 'active' }, `${pendingPlan.label} plan saved`);
      return;
    }

    if (action === 'cancel-subscription') {
      await saveBilling({ ...billing, status: 'cancelled' }, 'Plan cancelled');
      return;
    }

    if (action === 'download-invoice') {
      const receipt = {
        amount,
        createdAt: new Date().toISOString(),
        id: `LOCAL-${Date.now()}`,
        planId: billing.planId,
        status: 'generated' as const,
      };
      const nextBilling = {
        ...billing,
        localReceipts: [receipt, ...billing.localReceipts].slice(0, 24),
      };

      downloadBillingReceipt(receipt, nextBilling);
      await saveBilling(nextBilling, 'Receipt generated');
      return;
    }

    if (action === 'save-changes') {
      await saveBilling();
      return;
    }

    setAction(null);
  }

  return (
    <section className="billing-settings-page" aria-label="Billing settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Billing & Plan</h1>
        </div>
        <div className="workspace-header__right">
          <small>{status}</small>
          <Button icon={<Save size={15} />} onClick={() => setAction('save-changes')} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Billing settings are stored in the Thoon data store.', 'Receipts are local JSON records until a payment provider is connected.']} title="Billing" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="billing" />

        <div className="billing-layout">
          <div className="billing-head">
            <div>
              <h2>Billing & Plan</h2>
              <p>Subscription, usage and local receipts.</p>
            </div>
            <div className="billing-period-toggle">
              <button className={billing.billingPeriod === 'monthly' ? 'is-active' : undefined} onClick={() => changeBillingPeriod('monthly')} type="button">
                Monthly
              </button>
              <button className={billing.billingPeriod === 'yearly' ? 'is-active' : undefined} onClick={() => changeBillingPeriod('yearly')} type="button">
                Yearly
              </button>
              <Badge tone="positive">Save 16%</Badge>
            </div>
          </div>

          <div className="billing-top-grid">
            <Card className="plans-card">
              <div className="plans-grid">
                {plans.map((plan) => {
                  const isCurrent = plan.id === billing.planId;

                  return (
                    <div className={`plan-card ${isCurrent ? 'is-current' : ''}`} key={plan.id}>
                      {isCurrent ? <Badge tone="primary">Current plan</Badge> : null}
                      <h3>{plan.label}</h3>
                      <p>{plan.id === 'free' ? 'Essential tools.' : plan.id === 'pro' ? 'Active trader tools.' : 'Professional power.'}</p>
                      <strong>
                        {formatPlanPrice(plan, billing.billingPeriod)}
                        <span>/{billing.billingPeriod === 'monthly' ? 'month' : 'year'}</span>
                      </strong>
                      <Button size="sm" variant={isCurrent ? 'primary' : 'ghost'} onClick={() => startPlanChange(plan.id)}>
                        {isCurrent ? 'Manage Plan' : plan.monthlyPrice < currentPlan.monthlyPrice ? 'Downgrade' : 'Upgrade'}
                      </Button>
                      <ul>
                        <li><Check size={14} /> {plan.exchangeConnections} Exchange Connections</li>
                        <li><Check size={14} /> {plan.botSlots} Bot Slots</li>
                        <li><Check size={14} /> {plan.credits.toLocaleString('en-US')} Backtest Credits / month</li>
                        <li><Check size={14} /> {plan.support}</li>
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="plans-note">
                <span>Local plan controls gate Thoon features before a payment provider is added.</span>
                <button onClick={() => setAction('compare-features')} type="button">Compare features</button>
              </div>
            </Card>

            <Card className="subscription-card">
              <h2>Your Subscription</h2>
              <BillingLine label="Current Plan" value={<Badge tone="primary">{currentPlan.label}</Badge>} />
              <BillingLine label="Billing Period" value={titleCase(billing.billingPeriod)} />
              <BillingLine label="Status" value={<span className={billing.status === 'active' ? 'positive' : 'negative'}>{titleCase(billing.status)}</span>} />
              <BillingLine label="Next Renewal" value={formatDate(billing.nextRenewalAt)} />
              <BillingLine label="Amount" value={`${formatCurrency(amount)} / ${billing.billingPeriod === 'monthly' ? 'month' : 'year'}`} />
              <Button variant="ghost" onClick={() => startPlanChange(billing.planId)}>Manage Plan</Button>
              <button className="billing-cancel-button" onClick={() => setAction('cancel-subscription')} type="button">Cancel Subscription</button>
            </Card>
          </div>

          <div className="billing-mid-grid">
            <Card className="usage-card">
              <h2>Usage & Limits</h2>
              <UsageLimit label="Exchange Connections" max={String(currentPlan.exchangeConnections)} value={String(Math.min(2, currentPlan.exchangeConnections))} width={`${Math.min(100, (2 / Math.max(currentPlan.exchangeConnections, 1)) * 100)}%`} />
              <UsageLimit label="Bot Slots" max={String(currentPlan.botSlots)} value={String(Math.min(6, currentPlan.botSlots))} width={`${Math.min(100, (6 / Math.max(currentPlan.botSlots, 1)) * 100)}%`} />
              <UsageLimit label="Backtest Credits" max={currentPlan.credits.toLocaleString('en-US')} value={String(Math.min(342, currentPlan.credits))} width={`${Math.min(100, (342 / Math.max(currentPlan.credits, 1)) * 100)}%`} />
              <Button onClick={() => setAction('usage-details')} variant="ghost">View Usage Details</Button>
            </Card>

            <Card className="payment-card">
              <h2>Payment Method</h2>
              <div className="payment-method-box">
                <b>LOCAL</b>
                <div>
                  <strong>Local billing profile</strong>
                  <small>No external card stored</small>
                </div>
                <Badge tone="primary">Primary</Badge>
              </div>
              <Button variant="ghost" onClick={() => setAction('manage-plan')}>Update Billing Profile</Button>
              <small><LockKeyhole size={13} /> No payment secret is stored in the client</small>
            </Card>

            <Card className="billing-summary-card">
              <h2>Billing Summary</h2>
              <BillingLine label={`${currentPlan.label} Plan (${titleCase(billing.billingPeriod)})`} value={formatCurrency(amount)} />
              <BillingLine label="Discount" value={<span className="positive">{billing.billingPeriod === 'yearly' && amount > 0 ? 'Applied' : 'None'}</span>} />
              <BillingLine label="Total" value={formatCurrency(amount)} />
              <Button icon={<Download size={15} />} variant="ghost" onClick={() => setAction('download-invoice')}>Download Receipt</Button>
            </Card>
          </div>

          <div className="billing-bottom-grid">
            <Card className="invoice-card">
              <h2>Receipts</h2>
              {generatedReceipts.map((invoice) => (
                <InvoiceRow invoice={invoice} key={invoice.id} onDownload={() => setAction('download-invoice')} />
              ))}
              <button onClick={() => setAction('all-invoices')} type="button">View all receipts</button>
            </Card>

            <Card className="invoice-card">
              <h2>Billing History</h2>
              {generatedReceipts.map((invoice) => (
                <div className="billing-history-row" key={invoice.id}>
                  <ReceiptText size={17} />
                  <span>{formatDate(invoice.createdAt)}</span>
                  <span>{getPlan(invoice.planId).label} Plan ({titleCase(billing.billingPeriod)})</span>
                  <strong>{formatCurrency(invoice.amount)}</strong>
                  <Badge tone="positive">{titleCase(invoice.status)}</Badge>
                </div>
              ))}
              <button onClick={() => setAction('billing-history')} type="button">View full billing history</button>
            </Card>
          </div>
        </div>
      </div>

      <Modal onClose={() => setAction(null)} open={action !== null} title={billingActionTitle(action)}>
        <div className="confirmation-modal-body">
          <p>{billingActionCopy(action, pendingPlan.label)}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button size="sm" variant={action === 'cancel-subscription' ? 'danger' : 'primary'} onClick={() => void confirmBillingAction()}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

type BillingLineProps = {
  label: string;
  value: ReactNode;
};

function BillingLine({ label, value }: BillingLineProps) {
  return (
    <div className="billing-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type UsageLimitProps = {
  label: string;
  max: string;
  value: string;
  width: string;
};

function UsageLimit({ label, max, value, width }: UsageLimitProps) {
  return (
    <div className="usage-limit">
      <div>
        <span>{label}</span>
        <strong>{value} / {max}</strong>
      </div>
      <i style={{ '--usage-width': width } as CSSProperties} />
    </div>
  );
}

type InvoiceRowProps = {
  invoice: BillingSettings['localReceipts'][number];
  onDownload: () => void;
};

function InvoiceRow({ invoice, onDownload }: InvoiceRowProps) {
  return (
    <div className="invoice-row">
      <span>{invoice.id}</span>
      <span>{formatDate(invoice.createdAt)}</span>
      <Badge tone="positive">{titleCase(invoice.status)}</Badge>
      <strong>{formatCurrency(invoice.amount)}</strong>
      <button aria-label={`Download ${invoice.id}`} onClick={onDownload} type="button">
        <Download size={15} />
      </button>
    </div>
  );
}

function normalizeBillingSettings(settings: UserPreferences['billingSettings']): BillingSettings {
  return {
    billingPeriod: settings?.billingPeriod ?? 'yearly',
    localReceipts: settings?.localReceipts ?? [],
    nextRenewalAt: settings?.nextRenewalAt ?? '2026-06-17T00:00:00.000Z',
    planId: settings?.planId ?? 'pro',
    status: settings?.status ?? 'active',
    updatedAt: settings?.updatedAt ?? new Date(0).toISOString(),
  };
}

function getPlan(planId: BillingPlanId) {
  return plans.find((plan) => plan.id === planId) ?? plans[1];
}

function formatPlanPrice(plan: ReturnType<typeof getPlan>, period: BillingSettings['billingPeriod']) {
  return formatCurrency(period === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { currency: 'USD', maximumFractionDigits: 0, style: 'currency' }).format(value);
}

function formatDate(value?: string) {
  if (!value) {
    return 'Not scheduled';
  }

  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replace('-', ' ');
}

function downloadBillingReceipt(receipt: BillingSettings['localReceipts'][number], billing: BillingSettings) {
  const blob = new Blob([JSON.stringify({ billing, receipt }, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = href;
  link.download = `thoon-receipt-${receipt.id}.json`;
  link.click();
  URL.revokeObjectURL(href);
}

function billingActionTitle(action: BillingAction) {
  switch (action) {
    case 'manage-plan':
      return 'Manage Plan';
    case 'cancel-subscription':
      return 'Cancel Subscription';
    case 'download-invoice':
      return 'Download Receipt';
    case 'save-changes':
      return 'Save Billing Settings';
    case 'compare-features':
      return 'Compare Features';
    case 'usage-details':
      return 'Usage Details';
    case 'all-invoices':
      return 'All Receipts';
    case 'billing-history':
      return 'Billing History';
    default:
      return 'Billing Action';
  }
}

function billingActionCopy(action: BillingAction, pendingPlanLabel: string) {
  switch (action) {
    case 'manage-plan':
      return `Save ${pendingPlanLabel} as the active local plan.`;
    case 'cancel-subscription':
      return 'Confirm cancellation in the local billing profile.';
    case 'download-invoice':
      return 'Generate and store a local JSON receipt for the current billing state.';
    case 'save-changes':
      return 'Persist the current billing settings.';
    case 'compare-features':
      return 'The plan comparison is visible in the plan cards.';
    case 'usage-details':
      return 'Usage details are calculated from the active local plan.';
    case 'all-invoices':
      return 'All generated local receipts are visible in the receipt section.';
    case 'billing-history':
      return 'Billing history is built from generated local receipts.';
    default:
      return 'Confirm this billing action.';
  }
}
