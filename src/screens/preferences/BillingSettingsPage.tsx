'use client';

import { Check, Download, LockKeyhole, ReceiptText, Save } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';

type BillingAction = 'manage-plan' | 'cancel-subscription' | 'download-invoice' | 'save-changes' | 'compare-features' | 'usage-details' | 'all-invoices' | 'billing-history' | null;

const plans = [
  { botSlots: '1 Bot Slot', credits: '10 Backtest Credits / month', id: 'free', label: 'Free', price: '$0', support: 'Basic Support' },
  { botSlots: '10 Bot Slots', credits: '1,000 Backtest Credits / month', id: 'pro', label: 'Pro', price: '$29', support: 'Priority Support' },
  { botSlots: '50 Bot Slots', credits: '10,000 Backtest Credits / month', id: 'elite', label: 'Elite', price: '$79', support: 'Priority Support' },
];

const invoices = [
  { amount: '$290.00', id: 'INV-2025-0617', status: 'Paid', time: 'Jun 17, 2025' },
  { amount: '$290.00', id: 'INV-2024-0617', status: 'Paid', time: 'Jun 17, 2024' },
  { amount: '$290.00', id: 'INV-2023-0617', status: 'Paid', time: 'Jun 17, 2023' },
];

export function BillingSettingsPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [action, setAction] = useState<BillingAction>(null);

  return (
    <section className="billing-settings-page" aria-label="Billing settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Billing & Plan</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={() => setAction('save-changes')} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Billing data is mocked in this frontend step.', 'No real payment method is connected.']} title="Billing" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="billing" />

        <div className="billing-layout">
          <div className="billing-head">
            <div>
              <h2>Billing & Plan</h2>
              <p>Subscription, usage and invoices.</p>
            </div>
            <div className="billing-period-toggle">
              <button className={billingPeriod === 'monthly' ? 'is-active' : undefined} onClick={() => setBillingPeriod('monthly')} type="button">Monthly</button>
              <button className={billingPeriod === 'yearly' ? 'is-active' : undefined} onClick={() => setBillingPeriod('yearly')} type="button">Yearly</button>
              <Badge tone="positive">Save 16%</Badge>
            </div>
          </div>

          <div className="billing-top-grid">
            <Card className="plans-card">
              <div className="plans-grid">
                {plans.map((plan) => (
                  <div className={`plan-card ${plan.id === 'pro' ? 'is-current' : ''}`} key={plan.id}>
                    {plan.id === 'pro' ? <Badge tone="primary">Current plan</Badge> : null}
                    <h3>{plan.label}</h3>
                    <p>{plan.id === 'free' ? 'Essential tools.' : plan.id === 'pro' ? 'Active trader tools.' : 'Professional power.'}</p>
                    <strong>{plan.price}<span>/month</span></strong>
                    <Button size="sm" variant={plan.id === 'pro' ? 'primary' : 'ghost'} onClick={() => setAction('manage-plan')}>
                      {plan.id === 'free' ? 'Downgrade' : plan.id === 'pro' ? 'Manage Plan' : 'Upgrade'}
                    </Button>
                    <ul>
                      <li><Check size={14} /> {plan.id === 'elite' ? 'Unlimited Exchange Connections' : plan.id === 'pro' ? '3 Exchange Connections' : '1 Exchange Connection'}</li>
                      <li><Check size={14} /> {plan.botSlots}</li>
                      <li><Check size={14} /> {plan.credits}</li>
                      <li><Check size={14} /> {plan.support}</li>
                    </ul>
                  </div>
                ))}
              </div>
              <div className="plans-note">
                <span>Need more? Add-on slots and credits stay available later.</span>
                <button onClick={() => setAction('compare-features')} type="button">Compare features</button>
              </div>
            </Card>

            <Card className="subscription-card">
              <h2>Your Subscription</h2>
              <BillingLine label="Current Plan" value={<Badge tone="primary">Pro</Badge>} />
              <BillingLine label="Billing Period" value="Yearly" />
              <BillingLine label="Status" value={<span className="positive">Active</span>} />
              <BillingLine label="Next Renewal" value="Jun 17, 2026" />
              <BillingLine label="Amount" value="$290.00 / year" />
              <Button variant="ghost" onClick={() => setAction('manage-plan')}>Manage Plan</Button>
              <button className="billing-cancel-button" onClick={() => setAction('cancel-subscription')} type="button">Cancel Subscription</button>
            </Card>
          </div>

          <div className="billing-mid-grid">
            <Card className="usage-card">
              <h2>Usage & Limits</h2>
              <UsageLimit label="Exchange Connections" max="3" value="2" width="66%" />
              <UsageLimit label="Bot Slots" max="10" value="6" width="60%" />
              <UsageLimit label="Backtest Credits" max="1,000" value="342" width="34%" />
              <Button onClick={() => setAction('usage-details')} variant="ghost">View Usage Details</Button>
            </Card>

            <Card className="payment-card">
              <h2>Payment Method</h2>
              <div className="payment-method-box">
                <b>VISA</b>
                <div>
                  <strong>Visa •••• 4242</strong>
                  <small>Expires 06/2026</small>
                </div>
                <Badge tone="primary">Primary</Badge>
              </div>
              <Button variant="ghost" onClick={() => setAction('manage-plan')}>Update Payment Method</Button>
              <small><LockKeyhole size={13} /> Mock payment method only</small>
            </Card>

            <Card className="billing-summary-card">
              <h2>Billing Summary</h2>
              <BillingLine label="Pro Plan (Yearly)" value="$348.00" />
              <BillingLine label="Discount (16%)" value={<span className="positive">-$58.00</span>} />
              <BillingLine label="Total" value="$290.00" />
              <Button icon={<Download size={15} />} variant="ghost" onClick={() => setAction('download-invoice')}>Download Invoice</Button>
            </Card>
          </div>

          <div className="billing-bottom-grid">
            <Card className="invoice-card">
              <h2>Invoices</h2>
              {invoices.map((invoice) => (
                <InvoiceRow invoice={invoice} key={invoice.id} onDownload={() => setAction('download-invoice')} />
              ))}
              <button onClick={() => setAction('all-invoices')} type="button">View all invoices</button>
            </Card>

            <Card className="invoice-card">
              <h2>Billing History</h2>
              {invoices.map((invoice) => (
                <div className="billing-history-row" key={invoice.id}>
                  <ReceiptText size={17} />
                  <span>{invoice.time}</span>
                  <span>Pro Plan (Yearly)</span>
                  <strong>{invoice.amount}</strong>
                  <Badge tone="positive">{invoice.status}</Badge>
                </div>
              ))}
              <button onClick={() => setAction('billing-history')} type="button">View full billing history</button>
            </Card>
          </div>
        </div>
      </div>

      <Modal onClose={() => setAction(null)} open={action !== null} title={billingActionTitle(action)}>
        <div className="confirmation-modal-body">
          <p>{billingActionCopy(action)}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button size="sm" variant={action === 'cancel-subscription' ? 'danger' : 'primary'} onClick={() => setAction(null)}>Confirm</Button>
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
  invoice: (typeof invoices)[number];
  onDownload: () => void;
};

function InvoiceRow({ invoice, onDownload }: InvoiceRowProps) {
  return (
    <div className="invoice-row">
      <span>{invoice.id}</span>
      <span>{invoice.time}</span>
      <Badge tone="positive">{invoice.status}</Badge>
      <strong>{invoice.amount}</strong>
      <button aria-label={`Download ${invoice.id}`} onClick={onDownload} type="button">
        <Download size={15} />
      </button>
    </div>
  );
}

function billingActionTitle(action: BillingAction) {
  switch (action) {
    case 'manage-plan':
      return 'Manage Plan';
    case 'cancel-subscription':
      return 'Cancel Subscription';
    case 'download-invoice':
      return 'Download Invoice';
    case 'save-changes':
      return 'Save Billing Settings';
    case 'compare-features':
      return 'Compare Features';
    case 'usage-details':
      return 'Usage Details';
    case 'all-invoices':
      return 'All Invoices';
    case 'billing-history':
      return 'Billing History';
    default:
      return 'Billing Action';
  }
}

function billingActionCopy(action: BillingAction) {
  switch (action) {
    case 'manage-plan':
      return 'This frontend goal only shows a mock billing flow. No real payment provider is connected.';
    case 'cancel-subscription':
      return 'Confirm cancellation in a real billing backend before changing access.';
    case 'download-invoice':
      return 'A real app would generate a PDF invoice from the billing backend.';
    case 'save-changes':
      return 'Billing display preferences have been staged for the current session.';
    case 'compare-features':
      return 'Plan comparison is ready. A production billing backend would load the full feature matrix.';
    case 'usage-details':
      return 'Usage details are available from the current local billing snapshot.';
    case 'all-invoices':
      return 'All visible invoices are loaded in the invoice section.';
    case 'billing-history':
      return 'Full billing history is ready from the local billing snapshot.';
    default:
      return 'Confirm this billing action.';
  }
}
