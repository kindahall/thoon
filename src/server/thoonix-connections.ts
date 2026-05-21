import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

import type {
  ThoonixProviderConnection,
  ThoonixProviderEndpoint,
  ThoonixProviderKind,
} from '../types/trading';
import { encryptSecret, decryptSecret, maskSecret, type EncryptedPayload } from './crypto';
import { getThoonServerEnv, hasProductionEncryptionKey } from './env';
import { getPostgresPool } from './postgres-store';
import { getStrategyAgentAiStatus, runThoonixAgentChat, type ThoonixAgentProviderOverride } from './strategy-agent-ai';
import type { ThoonRequestContext } from './thoon-request-context';

type ConnectionRow = {
  auth_type: 'api_key' | 'codex_oauth_bridge';
  base_url?: string | null;
  chat_model: string;
  created_at: Date | string;
  endpoint: ThoonixProviderEndpoint;
  id: string;
  is_default: boolean;
  label: string;
  last_checked_at?: Date | string | null;
  masked_credential?: string | null;
  model: string;
  provider_type: ThoonixProviderKind;
  status: ThoonixProviderConnection['status'];
  updated_at: Date | string;
};

type SecretConnectionRow = ConnectionRow & {
  encrypted_credential?: EncryptedPayload | null;
};

type CreateConnectionInput = {
  apiKey?: string;
  baseUrl?: string;
  chatModel?: string;
  endpoint?: string;
  label?: string;
  model?: string;
  provider?: string;
};

export async function listThoonixProviderConnections(context: ThoonRequestContext | undefined) {
  if (!context?.workspace) {
    return [environmentConnection()];
  }

  const result = await getPostgresPool().query<ConnectionRow>(
    `
      select
        id,
        label,
        provider_type,
        auth_type,
        endpoint,
        base_url,
        model,
        chat_model,
        status,
        is_default,
        masked_credential,
        last_checked_at,
        created_at,
        updated_at
      from thoonix_provider_connections
      where workspace_id = $1
      order by is_default desc, updated_at desc
    `,
    [context.workspace.id],
  );

  const records = result.rows.map(toConnection);
  return records.length ? records : [environmentConnection()];
}

export async function createThoonixProviderConnection(input: CreateConnectionInput, context: ThoonRequestContext | undefined) {
  requireWorkspaceAdmin(context);

  const env = getThoonServerEnv();
  const provider = normalizeProvider(input.provider);
  const endpoint = normalizeEndpoint(input.endpoint);
  const baseUrl = normalizeBaseUrl(input.baseUrl, provider);
  const model = normalizeModel(input.model);
  const chatModel = normalizeModel(input.chatModel || input.model);
  const label = normalizeLabel(input.label, provider);
  const id = `thoonix-conn-${randomBytes(12).toString('base64url')}`;
  const isCodexBridge = provider === 'codex-bridge';
  const apiKey = String(input.apiKey ?? '').trim();

  if (!isCodexBridge && !apiKey) {
    throw new Error('API key is required for OpenAI and compatible providers.');
  }

  if (!isCodexBridge && !hasProductionEncryptionKey(env.encryptionKey)) {
    throw new Error('Set a unique THOON_ENCRYPTION_KEY of at least 32 characters before storing AI provider keys.');
  }

  await getPostgresPool().query('update thoonix_provider_connections set is_default = false, updated_at = now() where workspace_id = $1', [context?.workspace?.id]);
  await getPostgresPool().query(
    `
      insert into thoonix_provider_connections (
        id,
        workspace_id,
        created_by_user_id,
        label,
        provider_type,
        auth_type,
        endpoint,
        base_url,
        model,
        chat_model,
        status,
        is_default,
        masked_credential,
        encrypted_credential,
        last_checked_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13::jsonb, now())
    `,
    [
      id,
      context?.workspace?.id,
      context?.user?.id,
      label,
      provider,
      isCodexBridge ? 'codex_oauth_bridge' : 'api_key',
      endpoint,
      baseUrl,
      model,
      chatModel,
      isCodexBridge ? 'pending_bridge' : 'active',
      isCodexBridge ? 'codex_pairing_required' : maskSecret(apiKey, provider === 'openai' ? 'sk' : 'api'),
      isCodexBridge ? null : JSON.stringify(encryptSecret(apiKey, env.encryptionKey)),
    ],
  );

  return (await listThoonixProviderConnections(context)).find((connection) => connection.id === id);
}

export async function createThoonixBridgePairingCode(context: ThoonRequestContext | undefined) {
  requireWorkspaceAdmin(context);

  const connection = await createThoonixProviderConnection(
    {
      label: 'Codex bridge',
      provider: 'codex-bridge',
    },
    context,
  );
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const id = `thoonix-pair-${randomBytes(12).toString('base64url')}`;

  await getPostgresPool().query(
    `
      insert into thoonix_bridge_pairing_codes (
        id,
        workspace_id,
        created_by_user_id,
        code_hash,
        code_hint,
        expires_at
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      id,
      context?.workspace?.id,
      context?.user?.id,
      hashPairingCode(code),
      code.slice(-4),
      expiresAt,
    ],
  );

  return {
    code,
    connection,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function disableThoonixProviderConnection(id: string, context: ThoonRequestContext | undefined) {
  requireWorkspaceAdmin(context);

  const result = await getPostgresPool().query<ConnectionRow>(
    `
      update thoonix_provider_connections
      set status = 'disabled',
          is_default = false,
          updated_at = now()
      where id = $1
        and workspace_id = $2
      returning
        id,
        label,
        provider_type,
        auth_type,
        endpoint,
        base_url,
        model,
        chat_model,
        status,
        is_default,
        masked_credential,
        last_checked_at,
        created_at,
        updated_at
    `,
    [id, context?.workspace?.id],
  );

  return result.rows[0] ? toConnection(result.rows[0]) : undefined;
}

export async function testThoonixProviderConnection(id: string, context: ThoonRequestContext | undefined) {
  requireWorkspaceAdmin(context);

  const connection = await getSecretConnectionById(id, context);

  if (!connection) {
    return undefined;
  }

  if (connection.provider_type === 'codex-bridge') {
    await markConnectionChecked(id, context, 'pending_bridge');
    return (await listThoonixProviderConnections(context)).find((record) => record.id === id);
  }

  if (!connection.encrypted_credential) {
    await markConnectionChecked(id, context, 'error');
    throw new Error('Connection is missing its encrypted API key.');
  }

  const env = getThoonServerEnv();
  const apiKey = decryptSecret(connection.encrypted_credential, env.encryptionKey);
  const response = await fetch(`${(connection.base_url || defaultBaseUrl(connection.provider_type)).replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
  const nextStatus = response?.ok ? 'active' : 'error';

  await markConnectionChecked(id, context, nextStatus);

  if (!response?.ok) {
    throw new Error(response ? `Provider test failed with ${response.status}.` : 'Provider test failed.');
  }

  return (await listThoonixProviderConnections(context)).find((record) => record.id === id);
}

export async function runThoonixGatewayChat(input: Parameters<typeof runThoonixAgentChat>[0], context: ThoonRequestContext | undefined) {
  const connection = await getDefaultSecretConnection(context);

  if (!connection) {
    return runThoonixAgentChat(input);
  }

  if (connection.provider_type === 'codex-bridge') {
    throw new Error('Codex bridge pairing is configured, but the local bridge runtime is not connected yet.');
  }

  if (!connection.encrypted_credential) {
    throw new Error('Default Thoonix provider is missing its encrypted credential.');
  }

  const env = getThoonServerEnv();
  const override: ThoonixAgentProviderOverride = {
    apiKey: decryptSecret(connection.encrypted_credential, env.encryptionKey),
    baseUrl: connection.base_url || defaultBaseUrl(connection.provider_type),
    chatModel: connection.chat_model,
    endpoint: connection.endpoint,
    model: connection.model,
    provider: connection.provider_type,
  };

  return runThoonixAgentChat(input, override);
}

async function getDefaultSecretConnection(context: ThoonRequestContext | undefined) {
  if (!context?.workspace) {
    return undefined;
  }

  const result = await getPostgresPool().query<SecretConnectionRow>(
    `
      select
        id,
        label,
        provider_type,
        auth_type,
        endpoint,
        base_url,
        model,
        chat_model,
        status,
        is_default,
        masked_credential,
        encrypted_credential,
        last_checked_at,
        created_at,
        updated_at
      from thoonix_provider_connections
      where workspace_id = $1
        and is_default is true
        and status in ('active', 'pending_bridge')
      order by updated_at desc
      limit 1
    `,
    [context.workspace.id],
  );

  return result.rows[0];
}

async function getSecretConnectionById(id: string, context: ThoonRequestContext | undefined) {
  if (!context?.workspace) {
    return undefined;
  }

  const result = await getPostgresPool().query<SecretConnectionRow>(
    `
      select
        id,
        label,
        provider_type,
        auth_type,
        endpoint,
        base_url,
        model,
        chat_model,
        status,
        is_default,
        masked_credential,
        encrypted_credential,
        last_checked_at,
        created_at,
        updated_at
      from thoonix_provider_connections
      where id = $1
        and workspace_id = $2
      limit 1
    `,
    [id, context.workspace.id],
  );

  return result.rows[0];
}

async function markConnectionChecked(id: string, context: ThoonRequestContext | undefined, status: ThoonixProviderConnection['status']) {
  await getPostgresPool().query(
    `
      update thoonix_provider_connections
      set status = $3,
          last_checked_at = now(),
          updated_at = now()
      where id = $1
        and workspace_id = $2
    `,
    [id, context?.workspace?.id, status],
  );
}

function environmentConnection(): ThoonixProviderConnection {
  const status = getStrategyAgentAiStatus();

  return {
    authType: status.provider === 'codex' ? 'codex_oauth_bridge' : 'api_key',
    baseUrl: status.endpoint,
    chatModel: status.chatModel,
    createdAt: new Date(0).toISOString(),
    endpoint: status.endpoint.endsWith('/chat/completions') || status.endpoint === 'chat-completions' ? 'chat-completions' : 'responses',
    id: 'server-env',
    isDefault: true,
    label: 'Server environment',
    maskedCredential: status.provider === 'codex' ? 'codex_oauth' : status.configured ? 'server_key_configured' : undefined,
    model: status.model,
    provider: status.provider === 'openai-compatible' || status.provider === 'openai' ? status.provider : 'codex-bridge',
    status: status.configured ? 'active' : 'error',
    updatedAt: new Date(0).toISOString(),
  };
}

function toConnection(row: ConnectionRow): ThoonixProviderConnection {
  return {
    authType: row.auth_type,
    baseUrl: row.base_url ?? undefined,
    chatModel: row.chat_model,
    createdAt: toIso(row.created_at),
    endpoint: row.endpoint,
    id: row.id,
    isDefault: row.is_default,
    label: row.label,
    lastCheckedAt: row.last_checked_at ? toIso(row.last_checked_at) : undefined,
    maskedCredential: row.masked_credential ?? undefined,
    model: row.model,
    provider: row.provider_type,
    status: row.status,
    updatedAt: toIso(row.updated_at),
  };
}

function requireWorkspaceAdmin(context: ThoonRequestContext | undefined) {
  if (!context?.workspace || !context.user || !context.membership) {
    throw new Error('A SaaS workspace session is required to manage Thoonix connections.');
  }

  if (context.membership.role !== 'owner' && context.membership.role !== 'admin') {
    throw new Error('Only workspace owners and admins can manage Thoonix connections.');
  }
}

function normalizeProvider(value?: string): ThoonixProviderKind {
  if (value === 'openai' || value === 'openai-compatible' || value === 'codex-bridge') {
    return value;
  }

  return 'openai';
}

function normalizeEndpoint(value?: string): ThoonixProviderEndpoint {
  return value === 'chat-completions' ? 'chat-completions' : 'responses';
}

function normalizeBaseUrl(value: string | undefined, provider: ThoonixProviderKind) {
  const trimmed = String(value ?? '').trim();

  if (provider === 'codex-bridge') {
    return undefined;
  }

  if (!trimmed) {
    const fallback = defaultBaseUrl(provider);

    if (!fallback) {
      throw new Error('Base URL is required for compatible API providers.');
    }

    return fallback;
  }

  const parsed = parseProviderBaseUrl(trimmed);

  if (provider === 'openai' && parsed.hostname !== 'api.openai.com') {
    throw new Error('OpenAI provider base URL must use api.openai.com. Use OpenAI-compatible for other public providers.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Provider base URL must use https.');
  }

  if (isBlockedProviderHost(parsed.hostname)) {
    throw new Error('Provider base URL must not target local, private, link-local or metadata hosts.');
  }

  return parsed.toString().replace(/\/$/, '');
}

function parseProviderBaseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error('Provider base URL must be a valid URL.');
  }
}

function isBlockedProviderHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    return true;
  }

  const ipVersion = isIP(host);

  if (ipVersion === 4) {
    const octets = host.split('.').map((part) => Number(part));
    const [first, second] = octets;

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first === 169 && second === 254 ||
      first === 172 && second >= 16 && second <= 31 ||
      first === 192 && second === 168 ||
      first === 100 && second >= 64 && second <= 127 ||
      first === 198 && (second === 18 || second === 19)
    );
  }

  if (ipVersion === 6) {
    return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
  }

  return false;
}

function defaultBaseUrl(provider: ThoonixProviderKind) {
  return provider === 'openai' ? 'https://api.openai.com/v1' : '';
}

function pairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join(''),
  );

  return groups.join('-');
}

function hashPairingCode(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeModel(value?: string) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed || trimmed.length > 120) {
    return 'gpt-5.5';
  }

  return trimmed;
}

function normalizeLabel(value: string | undefined, provider: ThoonixProviderKind) {
  const trimmed = String(value ?? '').trim();

  if (trimmed) {
    return trimmed.slice(0, 80);
  }

  if (provider === 'codex-bridge') {
    return 'Codex bridge';
  }

  return provider === 'openai' ? 'OpenAI API' : 'Compatible API';
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
