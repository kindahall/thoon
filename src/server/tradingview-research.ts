import type { Strategy, StrategyResearchRecord } from '../types/trading';

type ResearchCandidate = {
  author?: string;
  description: string;
  publishedAt?: string;
  query: string;
  scriptType: StrategyResearchRecord['scriptType'];
  title: string;
  url: string;
};

type ResearchOptions = {
  limit?: number;
  query?: string;
  strategy?: Strategy;
};

const tradingViewBaseUrl = 'https://www.tradingview.com';
const requestHeaders = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
  'user-agent': 'Mozilla/5.0 ThoonStrategyResearch/1.0 (+https://github.com/kindahall/thoon)',
};

export async function researchTradingViewStrategies(options: ResearchOptions = {}) {
  const fetchedAt = new Date().toISOString();
  const queries = researchQueries(options);
  const errors: string[] = [];
  const candidates: ResearchCandidate[] = [];

  for (const query of queries) {
    try {
      const searchUrl = `${tradingViewBaseUrl}/scripts/search/${encodeURIComponent(query)}/?script_type=strategies`;
      const html = await fetchHtml(searchUrl);

      candidates.push(...parseSearchCandidates(html, query));
    } catch (error) {
      errors.push(`${query}: ${error instanceof Error ? error.message : 'TradingView request failed'}`);
    }
  }

  const uniqueCandidates = Array.from(new Map(candidates.map((candidate) => [candidate.url, candidate])).values());
  const enriched = await Promise.all(uniqueCandidates.slice(0, Math.max(options.limit ?? 8, 4) * 2).map((candidate) => enrichCandidate(candidate, options.strategy, fetchedAt, errors)));
  const records = enriched
    .filter((record): record is StrategyResearchRecord => Boolean(record))
    .sort((left, right) => researchScore(right) - researchScore(left))
    .slice(0, options.limit ?? 8);

  if (!records.length) {
    throw new Error(errors[0] ?? 'TradingView public research returned no usable strategy records.');
  }

  return {
    errors,
    fetchedAt,
    provider: 'tradingview' as const,
    records,
    searchedQueries: queries,
  };
}

function researchQueries(options: ResearchOptions) {
  const strategy = options.strategy;
  const base = [
    options.query,
    'trix',
    'donchian',
    'rsi atr',
    'crypto strategy',
    strategy ? `${strategy.market.split('/')[0]} strategy` : undefined,
  ];

  return Array.from(new Set(base.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).slice(0, 5);
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: requestHeaders,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('text/html')) {
    throw new Error(`Unexpected content-type ${contentType || 'unknown'}`);
  }

  return response.text();
}

function parseSearchCandidates(html: string, query: string): ResearchCandidate[] {
  return Array.from(html.matchAll(/<article[\s\S]*?<\/article>/g))
    .map((match): ResearchCandidate | undefined => {
      const article = match[0];
      const titleAnchor = extractAnchor(article, 'ui-lib-card-link-title');
      const descriptionAnchor = extractAnchor(article, 'ui-lib-card-link-paragraph');
      const authorAnchor = extractAnchor(article, 'ui-lib-card-link-author');
      const rawHref = titleAnchor.match(/href="([^"]+)"/)?.[1];
      const url = normalizeTradingViewUrl(rawHref);
      const title = cleanText(titleAnchor);

      if (!url || !title) {
        return undefined;
      }

      return {
        author: cleanText(authorAnchor).replace(/^by\s+/i, '') || undefined,
        description: cleanText(descriptionAnchor),
        publishedAt: article.match(/dateTime="([^"]+)"/)?.[1] ?? article.match(/datetime="([^"]+)"/i)?.[1],
        query,
        scriptType: article.toLowerCase().includes('pine script') && article.toLowerCase().includes('strategy') ? 'strategy' : 'unknown',
        title,
        url,
      };
    })
    .filter((candidate): candidate is ResearchCandidate => Boolean(candidate));
}

async function enrichCandidate(candidate: ResearchCandidate, strategy: Strategy | undefined, fetchedAt: string, errors: string[]): Promise<StrategyResearchRecord | undefined> {
  try {
    const html = await fetchHtml(candidate.url);
    const pageTitle = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]) || extractTitleFromHead(html) || candidate.title;
    const titleAuthor = extractAuthorFromHeadTitle(html);
    const description = extractMetaDescription(html) || candidate.description;
    const sourceVisibility = detectSourceVisibility(html);
    const concepts = detectConcepts(`${pageTitle} ${description}`);

    return {
      author: titleAuthor ?? candidate.author,
      concepts,
      fetchedAt,
      id: `research-tv-${slug(candidate.url)}-${Date.now()}`,
      jimmyAdaptationNotes: buildJimmyAdaptationNotes(concepts, strategy),
      provider: 'tradingview' as const,
      publicDescription: truncate(description, 520),
      publishedAt: html.match(/dateTime="([^"]+)"/)?.[1] ?? candidate.publishedAt,
      query: candidate.query,
      scriptType: detectScriptType(html, candidate.scriptType),
      sourcePolicy: sourceVisibility === 'protected_source' ? 'concept_only' : sourceVisibility === 'open_source' ? 'open_source_reference' : 'public_metadata',
      sourceVisibility,
      strategyId: strategy?.id ?? 'strat-jimmy',
      tags: buildTags(`${pageTitle} ${description}`, concepts),
      title: pageTitle,
      url: candidate.url,
    } satisfies StrategyResearchRecord;
  } catch (error) {
    errors.push(`${candidate.url}: ${error instanceof Error ? error.message : 'detail page failed'}`);
    return undefined;
  }
}

function extractAnchor(html: string, qaId: string) {
  return html.match(new RegExp(`<a[^>]+data-qa-id="${qaId}"[\\s\\S]*?<\\/a>`))?.[0] ?? '';
}

function normalizeTradingViewUrl(href: string | undefined) {
  if (!href) {
    return undefined;
  }

  if (href.startsWith('/script/')) {
    return `${tradingViewBaseUrl}${href}`;
  }

  return href.startsWith(`${tradingViewBaseUrl}/script/`) ? href : undefined;
}

function extractMetaDescription(html: string) {
  const content = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];

  return content ? cleanText(content) : '';
}

function extractTitleFromHead(html: string) {
  return cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+by\s+.+?\s+(?:--|\u2014)\s+TradingView$/i, ''));
}

function extractAuthorFromHeadTitle(html: string) {
  const title = cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const match = title.match(/\s+by\s+(.+?)\s+(?:--|\u2014)\s+TradingView$/i);

  return match?.[1];
}

function detectSourceVisibility(html: string): StrategyResearchRecord['sourceVisibility'] {
  if (html.includes('OPEN-SOURCE SCRIPT')) {
    return 'open_source';
  }

  if (html.includes('PROTECTED SOURCE SCRIPT') || html.includes('Protected script')) {
    return 'protected_source';
  }

  return html.includes('publication-container') ? 'public_description' : 'unknown';
}

function detectScriptType(html: string, fallback: StrategyResearchRecord['scriptType']) {
  const lower = html.toLowerCase();

  if (lower.includes('pine script') && lower.includes('strategy')) {
    return 'strategy';
  }

  if (lower.includes('pine script') && lower.includes('indicator')) {
    return 'indicator';
  }

  return fallback;
}

function detectConcepts(text: string) {
  const lower = text.toLowerCase();
  const catalog: Array<[string, string[]]> = [
    ['TRIX momentum', ['trix']],
    ['Donchian breakout', ['donchian']],
    ['ATR stop or trail', ['atr', 'average true range', 'trailing stop', 'chandelier']],
    ['RSI regime filter', ['rsi', 'relative strength']],
    ['Stochastic RSI trigger', ['stoch rsi', 'stochastic rsi']],
    ['ADX trend strength', ['adx', 'directional strength']],
    ['Choppiness filter', ['choppiness', 'chop']],
    ['EMA/SMA trend filter', ['ema', 'sma', 'moving average']],
    ['Volume filter', ['volume']],
    ['Multi-timeframe confirmation', ['multi-timeframe', 'multiple timeframes', 'higher timeframe']],
    ['Break-even management', ['breakeven', 'break-even']],
    ['Partial take profit', ['partial', 'scale out', 'take profit']],
    ['Cooldown filter', ['cooldown']],
    ['Range/trend detection', ['range', 'trend detection', 'regime']],
  ];

  return catalog.filter(([, needles]) => needles.some((needle) => lower.includes(needle))).map(([concept]) => concept);
}

function buildJimmyAdaptationNotes(concepts: string[], strategy: Strategy | undefined) {
  const notes: string[] = [];

  if (concepts.includes('TRIX momentum')) {
    notes.push('Compare TRIX signal length and trend-strength gating against jimmy entries.');
  }

  if (concepts.includes('Donchian breakout')) {
    notes.push('Sweep Donchian length and breakout confirmation on the selected crypto/timeframe.');
  }

  if (concepts.includes('ATR stop or trail')) {
    notes.push('Test ATR stop and trail multipliers against drawdown and profit factor.');
  }

  if (concepts.includes('RSI regime filter') || concepts.includes('ADX trend strength') || concepts.includes('Choppiness filter')) {
    notes.push('Use the filter as a candidate regime gate, not as a replacement for jimmy.');
  }

  if (concepts.includes('Multi-timeframe confirmation')) {
    notes.push('Validate current timeframe against one higher timeframe before paper testing.');
  }

  if (!notes.length) {
    notes.push(`Review concept manually before adapting ${strategy?.name ?? 'jimmy'}.`);
  }

  return notes.slice(0, 4);
}

function buildTags(text: string, concepts: string[]) {
  const lower = text.toLowerCase();
  const tags = new Set<string>();

  for (const concept of concepts) {
    tags.add(slug(concept).replace(/-/g, '_'));
  }

  for (const token of ['crypto', 'trend', 'breakout', 'reversal', 'volatility', 'scalping', 'swing']) {
    if (lower.includes(token)) {
      tags.add(token);
    }
  }

  return Array.from(tags).slice(0, 8);
}

function researchScore(record: StrategyResearchRecord) {
  const text = `${record.title} ${record.publicDescription} ${record.tags.join(' ')}`.toLowerCase();
  let score = record.concepts.length * 8;

  for (const token of ['trix', 'donchian', 'atr', 'rsi', 'crypto', 'bitcoin', 'btc']) {
    if (text.includes(token)) {
      score += 3;
    }
  }

  if (record.scriptType === 'strategy') {
    score += 4;
  }

  if (record.sourceVisibility === 'open_source') {
    score += 2;
  }

  return score;
}

function cleanText(value: string | undefined) {
  return decodeHtml(stripHtml(value ?? ''))
    .replace(/\s+/g, ' ')
    .replace(/\s+--\s+/g, ' -- ')
    .trim();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ');
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}...`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tradingview';
}
