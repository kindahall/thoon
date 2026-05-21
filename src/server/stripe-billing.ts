import Stripe from 'stripe';

import type { BillingPlanId } from '../types/trading';
import { getThoonServerEnv } from './env';
import type { ThoonRequestContext } from './thoon-request-context';
import { currentPlanFromContext, upsertStripeSubscription } from './saas-store';

type BillingPeriod = 'monthly' | 'yearly';

let stripeClient: Stripe | undefined;

function stripe() {
  const env = getThoonServerEnv();

  if (!env.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is required before Stripe billing can be used.');
  }

  stripeClient ??= new Stripe(env.stripeSecretKey, { apiVersion: '2026-04-22.dahlia' });

  return stripeClient;
}

export async function createStripeCheckoutSession({
  context,
  origin,
  period,
  planId,
}: {
  context: ThoonRequestContext;
  origin: string;
  period: BillingPeriod;
  planId: BillingPlanId;
}) {
  if (!context.user || !context.workspace) {
    throw new Error('A workspace session is required.');
  }

  if (planId === 'free') {
    throw new Error('The Free plan does not use Stripe Checkout.');
  }

  const price = stripePriceForPlan(planId, period);
  const publicOrigin = billingPublicOrigin(origin);
  let customerId = context.subscription?.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe().customers.create({
      email: context.user.email,
      metadata: {
        thoonUserId: context.user.id,
        thoonWorkspaceId: context.workspace.id,
      },
      name: context.workspace.name,
    });
    customerId = customer.id;
    await upsertStripeSubscription({
      billingPeriod: context.subscription?.billingPeriod,
      planId: currentPlanFromContext(context),
      status: context.subscription?.status ?? 'customer_created',
      stripeCustomerId: customer.id,
      workspaceId: context.workspace.id,
    });
  }

  return stripe().checkout.sessions.create({
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    cancel_url: `${publicOrigin}/preferences?checkout=cancelled`,
    client_reference_id: context.workspace.id,
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    metadata: stripeMetadata(context, planId, period),
    mode: 'subscription',
    subscription_data: {
      metadata: stripeMetadata(context, planId, period),
    },
    success_url: `${publicOrigin}/preferences?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  });
}

export async function createStripePortalSession({ context, origin }: { context: ThoonRequestContext; origin: string }) {
  const customer = context.subscription?.stripeCustomerId;
  const publicOrigin = billingPublicOrigin(origin);

  if (!context.workspace || !customer) {
    throw new Error('No Stripe customer is attached to this workspace yet.');
  }

  return stripe().billingPortal.sessions.create({
    customer,
    return_url: `${publicOrigin}/preferences`,
  });
}

export async function handleStripeWebhook({ rawBody, signature }: { rawBody: string; signature?: string }) {
  const env = getThoonServerEnv();

  if (!env.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required before Stripe webhooks can be accepted.');
  }

  if (!signature) {
    throw new Error('Missing Stripe signature.');
  }

  const event = stripe().webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event.data.object);
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    await handleSubscriptionEvent(event.data.object);
  }

  return { received: true, type: event.type };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const workspaceId = session.metadata?.workspaceId;

  if (!workspaceId) {
    return;
  }

  const planId = billingPlanId(session.metadata?.planId);
  const billingPeriod = billingPeriodId(session.metadata?.billingPeriod);
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  let currentPeriodEnd: string | undefined;
  let status = 'active';

  if (subscriptionId) {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    status = subscription.status;
    currentPeriodEnd = periodEndIso(subscription);
  }

  await upsertStripeSubscription({
    billingPeriod,
    currentPeriodEnd,
    planId,
    status,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    stripeSubscriptionId: subscriptionId,
    workspaceId,
  });
}

async function handleSubscriptionEvent(subscription: Stripe.Subscription) {
  const workspaceId = subscription.metadata?.workspaceId;

  if (!workspaceId) {
    return;
  }

  const deleted = subscription.status === 'canceled' || subscription.status === 'incomplete_expired';
  const planId = deleted ? 'free' : billingPlanId(subscription.metadata?.planId ?? planFromSubscriptionPrice(subscription));
  const billingPeriod = deleted ? undefined : billingPeriodId(subscription.metadata?.billingPeriod);

  await upsertStripeSubscription({
    billingPeriod,
    currentPeriodEnd: periodEndIso(subscription),
    planId,
    status: deleted ? 'canceled' : subscription.status,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    workspaceId,
  });
}

function stripeMetadata(context: ThoonRequestContext, planId: BillingPlanId, period: BillingPeriod) {
  return {
    billingPeriod: period,
    planId,
    userId: context.user?.id ?? '',
    workspaceId: context.workspace?.id ?? '',
  };
}

function stripePriceForPlan(planId: BillingPlanId, period: BillingPeriod) {
  const env = getThoonServerEnv();
  const prices = {
    elite: {
      monthly: env.stripePriceEliteMonthly ?? '',
      yearly: env.stripePriceEliteYearly ?? '',
    },
    free: {
      monthly: '',
      yearly: '',
    },
    pro: {
      monthly: env.stripePriceProMonthly ?? '',
      yearly: env.stripePriceProYearly ?? '',
    },
  } satisfies Record<BillingPlanId, Record<BillingPeriod, string>>;
  const price = prices[planId][period];

  if (!price) {
    throw new Error(`Missing Stripe price for ${planId} ${period}.`);
  }

  return price;
}

function billingPublicOrigin(requestOrigin: string) {
  const env = getThoonServerEnv();
  const configuredOrigin = env.productionBaseUrl?.trim();

  if (env.nodeEnv === 'production' && !configuredOrigin) {
    throw new Error('THOON_PRODUCTION_BASE_URL is required before Stripe billing can be used in production.');
  }

  const candidate = configuredOrigin || requestOrigin;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Billing public origin is not a valid URL.');
  }

  if (parsed.protocol !== 'https:' && env.nodeEnv === 'production') {
    throw new Error('Stripe billing return URLs must use https in production.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Stripe billing return URL origin must use http or https.');
  }

  return parsed.origin;
}

function planFromSubscriptionPrice(subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price.id;
  const env = getThoonServerEnv();

  if (priceId === env.stripePriceEliteMonthly || priceId === env.stripePriceEliteYearly) {
    return 'elite';
  }

  if (priceId === env.stripePriceProMonthly || priceId === env.stripePriceProYearly) {
    return 'pro';
  }

  return 'free';
}

function billingPlanId(value: unknown): BillingPlanId {
  return value === 'elite' || value === 'pro' ? value : 'free';
}

function billingPeriodId(value: unknown): BillingPeriod | undefined {
  return value === 'monthly' || value === 'yearly' ? value : undefined;
}

function periodEndIso(subscription: Stripe.Subscription) {
  const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;

  return periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined;
}
