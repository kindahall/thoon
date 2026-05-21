import { AsyncLocalStorage } from 'node:async_hooks';

import type { BillingPlanId } from '../types/trading';
import type { SessionRole } from './auth';
import type { ThoonDb } from './thoon-db';

export type SaasUserContext = {
  email: string;
  id: string;
  role: SessionRole;
  status: 'active' | 'disabled';
};

export type SaasWorkspaceContext = {
  id: string;
  liveAccessStatus: 'approved' | 'not_requested' | 'pending' | 'rejected';
  name: string;
  ownerUserId: string;
  planId: BillingPlanId;
};

export type SaasSubscriptionContext = {
  billingPeriod?: 'monthly' | 'yearly';
  planId: BillingPlanId;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

export type ThoonRequestContext = {
  db?: ThoonDb;
  membership?: {
    role: SessionRole;
  };
  mode: 'local' | 'saas';
  sessionId?: string;
  subscription?: SaasSubscriptionContext;
  user?: SaasUserContext;
  workspace?: SaasWorkspaceContext;
};

const requestContextStorage = new AsyncLocalStorage<ThoonRequestContext>();

export function runWithThoonRequestContext<T>(context: ThoonRequestContext, callback: () => T) {
  return requestContextStorage.run(context, callback);
}

export function getThoonRequestContext() {
  return requestContextStorage.getStore();
}

export function setThoonRequestContextDb(db: ThoonDb) {
  const context = requestContextStorage.getStore();

  if (context) {
    context.db = db;
  }
}
