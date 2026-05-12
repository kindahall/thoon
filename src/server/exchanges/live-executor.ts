import { createHmac } from 'node:crypto';

import { decryptSecret } from '../crypto';
import { getThoonServerEnv } from '../env';
import type { ApiKeySecretRecord } from '../thoon-db';
import type { ApiKeyRecord, ExchangeConnection, Order } from '../../types/trading';

export type LiveOrderRequest = {
  apiKey: ApiKeyRecord;
  exchange: ExchangeConnection;
  secret: ApiKeySecretRecord;
  order: Order;
};

export type LiveOrderResult = {
  endpoint: 'test' | 'live';
  exchangeOrderId?: string;
  rawStatus?: string;
};

export type LiveAccountSnapshot = {
  accountBalance: number;
  availableBalance: number;
  asset: string;
  checkedAt: string;
};

export async function verifyLiveApiKey(request: Pick<LiveOrderRequest, 'apiKey' | 'exchange' | 'secret'>): Promise<LiveAccountSnapshot> {
  const env = getThoonServerEnv();

  if (env.liveExchangeProvider !== 'binance' || request.exchange.id !== 'binance') {
    throw new Error(`Live credential test is not configured for ${request.exchange.name}.`);
  }

  if (!request.secret.encryptedKey || !request.secret.encryptedSecret) {
    throw new Error('Encrypted API credentials are missing.');
  }

  return fetchBinanceAccountSnapshot(request.secret, env.encryptionKey);
}

export async function fetchLiveAccountSnapshot(request: Pick<LiveOrderRequest, 'apiKey' | 'exchange' | 'secret'>): Promise<LiveAccountSnapshot> {
  const env = getThoonServerEnv();

  assertLiveBinanceCredentials(request);

  return fetchBinanceAccountSnapshot(request.secret, env.encryptionKey);
}

async function fetchBinanceAccountSnapshot(secret: ApiKeySecretRecord, encryptionKey: string): Promise<LiveAccountSnapshot> {
  const env = getThoonServerEnv();
  const credentials = decryptApiCredentials(secret, encryptionKey);
  const params = new URLSearchParams({
    recvWindow: '5000',
    timestamp: String(Date.now()),
  });
  params.set('signature', createHmac('sha256', credentials.apiSecret).update(params.toString()).digest('hex'));

  const response = await fetch(`${env.binanceTradeBaseUrl}/api/v3/account?${params.toString()}`, {
    headers: {
      'x-mbx-apikey': credentials.apiKey,
    },
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    balances?: Array<{ asset?: string; free?: string; locked?: string }>;
    msg?: string;
  };

  if (!response.ok) {
    throw new Error(payload.msg || `Binance account request failed with ${response.status}.`);
  }

  const quoteBalance = payload.balances?.find((balance) => balance.asset === 'USDT');
  const availableBalance = Number(quoteBalance?.free ?? 0);
  const lockedBalance = Number(quoteBalance?.locked ?? 0);

  if (!Number.isFinite(availableBalance) || !Number.isFinite(lockedBalance)) {
    throw new Error('Binance account balance response is invalid.');
  }

  return {
    accountBalance: availableBalance + lockedBalance,
    asset: 'USDT',
    availableBalance,
    checkedAt: new Date().toISOString(),
  };
}

export async function executeLiveOrder(request: LiveOrderRequest): Promise<LiveOrderResult> {
  const env = getThoonServerEnv();

  assertLiveBinanceCredentials(request);

  const { apiKey, apiSecret } = decryptApiCredentials(request.secret, env.encryptionKey);
  const params = new URLSearchParams({
    newClientOrderId: request.order.id.slice(0, 36),
    quantity: String(request.order.size),
    recvWindow: '5000',
    side: request.order.side.toUpperCase(),
    symbol: request.order.symbol.replace('/', ''),
    timestamp: String(Date.now()),
    type: request.order.type === 'market' ? 'MARKET' : 'LIMIT',
  });

  if (request.order.type !== 'market') {
    params.set('price', String(request.order.price));
    params.set('timeInForce', 'GTC');
  }

  params.set('signature', createHmac('sha256', apiSecret).update(params.toString()).digest('hex'));

  const path = env.liveOrderEndpoint === 'live' ? '/api/v3/order' : '/api/v3/order/test';
  const response = await fetch(`${env.binanceTradeBaseUrl}${path}`, {
    body: params.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-mbx-apikey': apiKey,
    },
    method: 'POST',
    signal: AbortSignal.timeout(8000),
  });

  const payload = (await response.json().catch(() => ({}))) as { orderId?: number | string; status?: string; msg?: string };

  if (!response.ok) {
    throw new Error(payload.msg || `Binance order request failed with ${response.status}.`);
  }

  return {
    endpoint: env.liveOrderEndpoint,
    exchangeOrderId: payload.orderId ? String(payload.orderId) : undefined,
    rawStatus: payload.status,
  };
}

function assertLiveBinanceCredentials(request: Pick<LiveOrderRequest, 'apiKey' | 'exchange' | 'secret'>) {
  const env = getThoonServerEnv();

  if (env.liveExchangeProvider !== 'binance' || request.exchange.id !== 'binance') {
    throw new Error(`Live executor is not configured for ${request.exchange.name}.`);
  }

  if (request.exchange.status !== 'connected') {
    throw new Error('Exchange must be connected before live execution.');
  }

  if (request.apiKey.status !== 'active') {
    throw new Error('API key must be active before live execution.');
  }

  if (!request.apiKey.permissions.includes('trade')) {
    throw new Error('API key must include trade permission for live execution.');
  }

  if (!request.secret.encryptedKey || !request.secret.encryptedSecret) {
    throw new Error('Encrypted API credentials are missing.');
  }
}

function decryptApiCredentials(secret: ApiKeySecretRecord, encryptionKey: string) {
  if (!secret.encryptedKey || !secret.encryptedSecret) {
    throw new Error('Encrypted API credentials are missing.');
  }

  return {
    apiKey: decryptSecret(secret.encryptedKey, encryptionKey),
    apiSecret: decryptSecret(secret.encryptedSecret, encryptionKey),
  };
}
