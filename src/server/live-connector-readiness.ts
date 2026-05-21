import { getThoonServerEnv, hasProductionEncryptionKey } from './env';

type LiveConnectorStatus = 'blocked' | 'configured' | 'ready';
type LiveConnectorKind = 'cex' | 'dex-perp';

type LiveConnectorCredential = {
  configured: boolean;
  name: string;
  required: boolean;
};

type LiveConnectorVenue = {
  blockers: string[];
  canReadAccount: boolean;
  credentials: LiveConnectorCredential[];
  id: 'binance' | 'bitget' | 'bybit' | 'dydx' | 'hyperliquid';
  kind: LiveConnectorKind;
  liveExecutionSupported: boolean;
  name: string;
  nextAction: string;
  ready: boolean;
  signer: {
    enabled: boolean;
    officialAdapterRequired: boolean;
  };
  status: LiveConnectorStatus;
};

export type LiveConnectorReadiness = {
  blockers: string[];
  generatedAt: string;
  global: {
    appMode: string;
    authMode: string;
    budBackendLiveEnabled: boolean;
    databaseProvider: string;
    liveExchangeProvider: string;
    liveOperatorMode: string;
    productionEncryptionKey: boolean;
  };
  liveReady: boolean;
  source: 'thoon_live_connector_readiness';
  summary: {
    cexReady: number;
    dexReadReady: number;
    dexTradeReady: number;
    readyVenues: number;
    totalVenues: number;
  };
  venues: LiveConnectorVenue[];
};

const cexVenues = [
  {
    id: 'binance' as const,
    name: 'Binance',
    requiredEnv: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
  },
  {
    id: 'bybit' as const,
    name: 'Bybit',
    requiredEnv: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'],
  },
  {
    id: 'bitget' as const,
    name: 'Bitget',
    requiredEnv: ['BITGET_API_KEY', 'BITGET_API_SECRET', 'BITGET_API_PASSPHRASE'],
  },
];

const dexVenues = [
  {
    id: 'hyperliquid' as const,
    name: 'Hyperliquid',
    optionalEnv: ['HYPERLIQUID_VAULT_ADDRESS'],
    requiredEnv: ['HYPERLIQUID_MAIN_WALLET_ADDRESS', 'HYPERLIQUID_API_WALLET_PRIVATE_KEY'],
    signerEnv: 'HYPERLIQUID_OFFICIAL_SIGNER_ENABLED',
  },
  {
    id: 'dydx' as const,
    name: 'dYdX',
    optionalEnv: ['DYDX_SUBACCOUNT_NUMBER'],
    requiredEnv: ['DYDX_OWNER_ADDRESS', 'DYDX_PERMISSIONED_PRIVATE_KEY', 'DYDX_AUTHENTICATOR_ID'],
    signerEnv: 'DYDX_OFFICIAL_SIGNER_ENABLED',
  },
];

export function getLiveConnectorReadiness(): LiveConnectorReadiness {
  const env = getThoonServerEnv();
  const budBackendLiveEnabled = process.env.EXECUTION_LIVE_TRADING_ENABLED === 'true';
  const globalBlockers = globalLiveBlockers(env, budBackendLiveEnabled);
  const venues = [
    ...cexVenues.map((venue) => buildCexVenue(venue, globalBlockers)),
    ...dexVenues.map((venue) => buildDexVenue(venue, globalBlockers)),
  ];
  const blockers = Array.from(new Set([...globalBlockers, ...venues.flatMap((venue) => venue.blockers)])).slice(0, 80);

  return {
    blockers,
    generatedAt: new Date().toISOString(),
    global: {
      appMode: env.appMode,
      authMode: env.authMode,
      budBackendLiveEnabled,
      databaseProvider: env.databaseProvider,
      liveExchangeProvider: env.liveExchangeProvider,
      liveOperatorMode: env.liveOperatorMode,
      productionEncryptionKey: hasProductionEncryptionKey(env.encryptionKey),
    },
    liveReady: venues.every((venue) => venue.ready) && blockers.length === 0,
    source: 'thoon_live_connector_readiness',
    summary: {
      cexReady: venues.filter((venue) => venue.kind === 'cex' && venue.ready).length,
      dexReadReady: venues.filter((venue) => venue.kind === 'dex-perp' && venue.canReadAccount).length,
      dexTradeReady: venues.filter((venue) => venue.kind === 'dex-perp' && venue.ready).length,
      readyVenues: venues.filter((venue) => venue.ready).length,
      totalVenues: venues.length,
    },
    venues,
  };
}

function buildCexVenue(venue: (typeof cexVenues)[number], globalBlockers: string[]): LiveConnectorVenue {
  const credentials = credentialList(venue.requiredEnv);
  const missing = credentials.filter((credential) => credential.required && !credential.configured).map((credential) => `${venue.id}_${credential.name.toLowerCase()}_missing`);
  const blockers = [...globalBlockers, ...missing];

  return {
    blockers,
    canReadAccount: missing.length === 0,
    credentials,
    id: venue.id,
    kind: 'cex',
    liveExecutionSupported: true,
    name: venue.name,
    nextAction: missing.length ? `Set ${venue.requiredEnv.join(', ')} in the server environment.` : 'Run Bud live-readiness and a tiny paper-to-live dry run before any real order.',
    ready: blockers.length === 0,
    signer: {
      enabled: true,
      officialAdapterRequired: false,
    },
    status: blockers.length ? 'blocked' : 'ready',
  };
}

function buildDexVenue(venue: (typeof dexVenues)[number], globalBlockers: string[]): LiveConnectorVenue {
  const credentials = [...credentialList(venue.requiredEnv), ...credentialList(venue.optionalEnv, false)];
  const missing = credentials.filter((credential) => credential.required && !credential.configured).map((credential) => `${venue.id}_${credential.name.toLowerCase()}_missing`);
  const signerEnabled = process.env[venue.signerEnv] === 'true';
  const signerBlocker = signerEnabled ? 'official_signer_code_not_implemented' : `${venue.id}_official_signer_not_enabled`;
  const blockers = [...globalBlockers, ...missing, signerBlocker];

  return {
    blockers,
    canReadAccount: missing.length === 0,
    credentials,
    id: venue.id,
    kind: 'dex-perp',
    liveExecutionSupported: false,
    name: venue.name,
    nextAction: signerEnabled
      ? 'Wire the official isolated signer adapter before enabling live orders.'
      : `Set ${venue.requiredEnv.join(', ')} and keep ${venue.signerEnv}=false until the official signer adapter is implemented.`,
    ready: false,
    signer: {
      enabled: signerEnabled,
      officialAdapterRequired: true,
    },
    status: missing.length ? 'blocked' : 'configured',
  };
}

function globalLiveBlockers(env: ReturnType<typeof getThoonServerEnv>, budBackendLiveEnabled: boolean) {
  const blockers: string[] = [];

  if (env.appMode !== 'live-enabled') {
    blockers.push('thoon_app_mode_not_live_enabled');
  }

  if (env.liveExchangeProvider !== 'bud') {
    blockers.push('thoon_live_exchange_provider_must_be_bud');
  }

  if (!budBackendLiveEnabled) {
    blockers.push('bud_execution_live_trading_not_enabled');
  }

  if (env.authMode !== 'local-required') {
    blockers.push('local_auth_required_for_live_trading');
  }

  if (env.databaseProvider !== 'postgres') {
    blockers.push('postgres_required_for_live_trading');
  }

  if (!hasProductionEncryptionKey(env.encryptionKey)) {
    blockers.push('production_encryption_key_required');
  }

  return blockers;
}

function credentialList(names: string[], required = true): LiveConnectorCredential[] {
  return names.map((name) => ({
    configured: Boolean(process.env[name]?.trim()),
    name,
    required,
  }));
}
