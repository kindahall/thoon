import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getThoonServerEnv, hasProductionEncryptionKey } from './env';
import { getLiveConnectorReadiness } from './live-connector-readiness';
import { readThoonDb } from './thoon-db';
import type { ExchangeConnection, WalletConnection } from '../types/trading';

type VenueStatus = 'blocked' | 'configured' | 'ready';

type WalletExecutionVenueReadiness = {
  activeTradeKey: boolean;
  blockers: string[];
  connectedExchange: boolean;
  connectedWallets: Array<{ address?: string; chain: WalletConnection['chain']; connector: WalletConnection['connector']; id: string; label: string }>;
  id: string;
  liveExecutionPath: string;
  name: string;
  ready: boolean;
  requiredChain?: WalletConnection['chain'];
  status: VenueStatus;
  venueType: 'cex' | 'dex';
  warnings: string[];
};

export type WalletExecutionReadiness = {
  blockers: string[];
  generatedAt: string;
  injectedWallets: {
    cosmos: boolean;
    evm: boolean;
    solana: boolean;
  };
  liveReady: boolean;
  source: 'thoon_wallet_execution_readiness';
  summary: {
    activeTradeKeys: number;
    connectedCex: number;
    connectedDexWallets: number;
    connectedWallets: number;
    serverCexReady: number;
    readyVenues: number;
    targetVenues: number;
  };
  venues: WalletExecutionVenueReadiness[];
  walletConnect: {
    projectIdConfigured: boolean;
    sdkInstalled: boolean;
    status: VenueStatus;
  };
};

const cexTargets = ['binance', 'bybit', 'bitget'];
const dexTargets = ['hyperliquid', 'dydx'];

export function getWalletExecutionReadiness(): WalletExecutionReadiness {
  const db = readThoonDb();
  const env = getThoonServerEnv();
  const walletConnectProjectId = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || process.env.WALLETCONNECT_PROJECT_ID?.trim());
  const walletConnectSdkInstalled = packageHasWalletConnect();
  const serverConnectors = getLiveConnectorReadiness();
  const targetIds = [...cexTargets, ...dexTargets];
  const venues = targetIds.map((id) => buildVenueReadiness(db.exchangeRecords.find((exchange) => exchange.id === id), db, env, serverConnectors));
  const blockers = Array.from(new Set(venues.flatMap((venue) => venue.blockers))).slice(0, 50);
  const readyVenues = venues.filter((venue) => venue.ready).length;

  if (!walletConnectProjectId) {
    blockers.push('walletconnect_project_id_missing');
  }

  if (!walletConnectSdkInstalled) {
    blockers.push('walletconnect_sdk_not_installed');
  }

  return {
    blockers: Array.from(new Set(blockers)),
    generatedAt: new Date().toISOString(),
    injectedWallets: {
      cosmos: true,
      evm: true,
      solana: true,
    },
    liveReady: blockers.length === 0 && readyVenues === venues.length,
    source: 'thoon_wallet_execution_readiness',
    summary: {
      activeTradeKeys: db.apiKeyRecords.filter((key) => key.status === 'active' && key.permissions.includes('trade')).length,
      connectedCex: db.exchangeRecords.filter((exchange) => exchange.venueType !== 'dex' && exchange.status === 'connected').length,
      connectedDexWallets: db.walletRecords.filter((wallet) => wallet.status === 'connected' && ['evm', 'cosmos', 'solana', 'multi'].includes(wallet.chain)).length,
      connectedWallets: db.walletRecords.filter((wallet) => wallet.status === 'connected').length,
      serverCexReady: serverConnectors.summary.cexReady,
      readyVenues,
      targetVenues: venues.length,
    },
    venues,
    walletConnect: {
      projectIdConfigured: walletConnectProjectId,
      sdkInstalled: walletConnectSdkInstalled,
      status: walletConnectProjectId && walletConnectSdkInstalled ? 'configured' : 'blocked',
    },
  };
}

function buildVenueReadiness(exchange: ExchangeConnection | undefined, db: ReturnType<typeof readThoonDb>, env: ReturnType<typeof getThoonServerEnv>, serverConnectors: ReturnType<typeof getLiveConnectorReadiness>): WalletExecutionVenueReadiness {
  const id = exchange?.id ?? 'unknown';
  const venueType = exchange?.venueType === 'dex' ? 'dex' : 'cex';
  const connectedExchange = exchange?.status === 'connected';
  const serverConnector = serverConnectors.venues.find((venue) => venue.id === id);
  const storedTradeKey = Boolean(exchange && db.apiKeyRecords.some((key) => key.exchangeId === exchange.id && key.status === 'active' && key.permissions.includes('trade')));
  const serverTradeKey = Boolean(serverConnector?.credentials.every((credential) => !credential.required || credential.configured));
  const requiredChain = venueType === 'dex' ? requiredWalletChain(id) : undefined;
  const connectedWallets =
    requiredChain === undefined
      ? []
      : db.walletRecords
          .filter((wallet) => wallet.status === 'connected')
          .filter((wallet) => wallet.preferredExchangeId === id || wallet.chain === requiredChain || wallet.chain === 'multi')
          .map((wallet) => ({
            address: wallet.address,
            chain: wallet.chain,
            connector: wallet.connector,
            id: wallet.id,
            label: wallet.label,
          }));
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!exchange) {
    blockers.push(`${id}_exchange_missing`);
  }

  if (!connectedExchange && !serverTradeKey) {
    blockers.push(`${id}_exchange_not_connected`);
  }

  if (env.appMode !== 'live-enabled') {
    blockers.push('thoon_live_mode_not_enabled');
  }

  if (env.databaseProvider !== 'postgres') {
    blockers.push('postgres_required_for_live_trading');
  }

  if (env.authMode !== 'local-required') {
    blockers.push('local_auth_required_for_live_trading');
  }

  if (!hasProductionEncryptionKey(env.encryptionKey)) {
    blockers.push('production_encryption_key_required');
  }

  if (venueType === 'cex') {
    if (!storedTradeKey && !serverTradeKey) {
      blockers.push(`${id}_trade_api_key_missing`);
    }

    if (serverTradeKey) {
      warnings.push('Server-side Bud credentials are configured; UI key storage is optional for this single-user app.');
    }
  } else {
    if (!connectedWallets.length) {
      blockers.push(`${id}_${requiredChain ?? 'wallet'}_wallet_missing`);
    }

    blockers.push(`${id}_official_signed_wallet_adapter_not_enabled`);
    warnings.push('Thoon can connect public wallet routes, but live DEX signing remains disabled until an isolated signer is configured.');
  }

  return {
    activeTradeKey: storedTradeKey || serverTradeKey,
    blockers,
    connectedExchange,
    connectedWallets,
    id,
    liveExecutionPath: liveExecutionPath(id, venueType),
    name: exchange?.name ?? id,
    ready: blockers.length === 0,
    requiredChain,
    status: blockers.length ? 'blocked' : warnings.length ? 'configured' : 'ready',
    venueType,
    warnings,
  };
}

function requiredWalletChain(id: string): WalletConnection['chain'] {
  if (id === 'dydx') {
    return 'cosmos';
  }

  return 'evm';
}

function liveExecutionPath(id: string, venueType: 'cex' | 'dex') {
  if (venueType === 'cex') {
    return `Bud signed ${id} connector -> /trade -> risk engine -> exchange REST`;
  }

  if (id === 'dydx') {
    return 'Cosmos wallet -> dYdX signed client adapter -> Bud risk engine';
  }

  return 'EVM wallet -> Hyperliquid official SDK signer -> Bud risk engine';
}

function packageHasWalletConnect() {
  const packageJsonPath = join(process.cwd(), 'package.json');

  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };

    return Object.keys(dependencies).some((name) => name.includes('walletconnect') || name === 'wagmi');
  } catch {
    return false;
  }
}
