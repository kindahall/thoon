import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getThoonServerEnv } from './env';

export type TradingViewMcpProfile = {
  cautions: string[];
  command: string;
  configPath: string;
  configured: boolean;
  diagnostics: string[];
  importPath: string[];
  mcpName: string;
  repoUrl: string;
  summary: string;
  tools: string[];
};

export function getTradingViewMcpProfile(): TradingViewMcpProfile {
  const env = getThoonServerEnv();
  const configPath = join(homedir(), '.codex', 'config.toml');
  const configured = isTradingViewMcpConfigured(configPath, env.tradingViewMcpName);
  const command = [env.tradingViewMcpCommand, ...env.tradingViewMcpArgs].join(' ');

  return {
    cautions: [
      'The configured TradingView MCP is unofficial and should be treated as market-research evidence only.',
      'It exposes screener, symbol discovery and technical-analysis summaries; visual chart review should still happen through Thoon charts or TradingView URLs.',
      'It does not safely import protected Pine source.',
      'Protected/private scripts must stay concept-only unless the user provides code or the script is clearly open-source/public.',
    ],
    command,
    configPath,
    configured,
    diagnostics: configured
      ? [`Codex MCP server "${env.tradingViewMcpName}" is present in ${configPath}.`, `Expected stdio command: ${command}.`]
      : [`Codex MCP server "${env.tradingViewMcpName}" is missing from ${configPath}.`, `Add [mcp_servers.${env.tradingViewMcpName}] command="${env.tradingViewMcpCommand}" args=${JSON.stringify(env.tradingViewMcpArgs)}.`],
    importPath: [
      'Use Codex MCP for exact TradingView symbol discovery and TA summaries.',
      'Open Thoon charts or TradingView chart URLs when a visual chart review is needed.',
      'Use Thoon public TradingView research to save strategy metadata and concepts.',
      'Convert open/public concepts into separate Thoon strategy records.',
      'Validate every imported idea through calculated candles, out-of-sample checks and paper testing.',
    ],
    mcpName: env.tradingViewMcpName,
    repoUrl: 'https://github.com/fiale-plus/tradingview-mcp-server',
    summary: configured ? 'TradingView MCP is configured globally for Thoonix as a stdio server.' : 'TradingView MCP is expected by Thoonix but not found in the local Codex config.',
    tools: ['screen_crypto', 'search_symbols', 'lookup_symbols', 'get_ta_summary', 'rank_by_ta', 'list_fields', 'list_presets'],
  };
}

export function tradingViewMcpContextPrompt() {
  const profile = getTradingViewMcpProfile();

  return [
    profile.summary,
    `MCP name: ${profile.mcpName}. Command: ${profile.command}.`,
    `Repo: ${profile.repoUrl}`,
    `Useful tools: ${profile.tools.join(', ')}.`,
    `Import path: ${profile.importPath.join(' -> ')}`,
    `Cautions: ${profile.cautions.join(' | ')}`,
  ].join('\n');
}

function isTradingViewMcpConfigured(configPath: string, mcpName: string) {
  if (!existsSync(configPath)) {
    return false;
  }

  const config = readFileSync(configPath, 'utf8');
  const escapedName = mcpName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tablePattern = new RegExp(`\\[mcp_servers\\.(?:"${escapedName}"|${escapedName})\\]`);

  return tablePattern.test(config) && config.includes('tradingview-mcp-server');
}
