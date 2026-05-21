'use client';

import { Filter, LineChart, Search, Star } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';

import { Badge, Card, HelpPopover } from '../components/ui';
import { useBinanceLiveMarkets } from '../hooks/useBinanceLiveMarkets';
import { postJson } from '../services/api-client';
import type { MarketCategory, MarketDataStatus, MarketOverview, MarketPair } from '../types/market';
import { formatCompact, formatCompactUsd, formatPercent, formatUsd } from '../utils/format';

const categories: Array<{ key: MarketCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'trending', label: 'Trending' },
  { key: 'defi', label: 'DeFi' },
  { key: 'layer-1', label: 'Layer 1' },
  { key: 'meme', label: 'Meme' },
  { key: 'ai', label: 'AI' },
];

type MarketsPageProps = {
  favoriteSymbols: string[];
  initialOverview: MarketOverview;
  initialPairs: MarketPair[];
  initialStatus: MarketDataStatus;
};

export function MarketsPage({ favoriteSymbols: initialFavoriteSymbols, initialOverview, initialPairs, initialStatus }: MarketsPageProps) {
  const { connected, pairs, lastEventAt } = useBinanceLiveMarkets(initialPairs, initialStatus);
  const [activeCategory, setActiveCategory] = useState<MarketCategory>('all');
  const [heatmapMetric, setHeatmapMetric] = useState<'marketCap' | 'change24h'>('marketCap');
  const [moverMode, setMoverMode] = useState<'gainers' | 'losers'>('gainers');
  const [tableFiltered, setTableFiltered] = useState(false);
  const [compactColumns, setCompactColumns] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteSymbols, setFavoriteSymbols] = useState(() => new Set(initialFavoriteSymbols));
  const [actionStatus, setActionStatus] = useState('Ready');
  const overview = useMemo(() => buildLiveOverview(initialOverview, pairs), [initialOverview, pairs]);
  const sentiment = useMemo(() => buildMarketSentiment(pairs), [pairs]);
  const visiblePairs = useMemo(() => {
    const categoryPairs = activeCategory === 'all' ? pairs : pairs.filter((pair) => pair.category === activeCategory);
    const query = searchQuery.trim().toLowerCase();
    const searchedPairs = query ? categoryPairs.filter((pair) => `${pair.symbol} ${pair.name} ${pair.base}`.toLowerCase().includes(query)) : categoryPairs;
    const filteredPairs = tableFiltered ? searchedPairs.filter((pair) => Math.abs(pair.change24h) >= 1 || favoriteSymbols.has(pair.symbol)) : searchedPairs;

    return filteredPairs;
  }, [activeCategory, favoriteSymbols, pairs, searchQuery, tableFiltered]);
  const heatmapPairs = useMemo(() => {
    return [...visiblePairs].sort((first, second) => {
      if (heatmapMetric === 'change24h') {
        return Math.abs(second.change24h) - Math.abs(first.change24h);
      }

      return second.marketCap - first.marketCap;
    });
  }, [heatmapMetric, visiblePairs]);
  const topMovers = useMemo(() => {
    const sortedPairs = [...visiblePairs].sort((first, second) => (moverMode === 'gainers' ? second.change24h - first.change24h : first.change24h - second.change24h));

    return sortedPairs.slice(0, 5);
  }, [moverMode, visiblePairs]);
  const dataSourceLabel = connected ? 'Binance public tickers' : `${initialStatus.provider} cache`;

  async function toggleFavorite(symbol: string) {
    const wasFavorite = favoriteSymbols.has(symbol);
    const nextFavorites = new Set(favoriteSymbols);

    if (wasFavorite) {
      nextFavorites.delete(symbol);
    } else {
      nextFavorites.add(symbol);
    }

    setFavoriteSymbols(nextFavorites);
    setActionStatus(wasFavorite ? `${symbol} removed from watchlist` : `${symbol} added to watchlist`);

    try {
      await postJson('/api/watchlists', {
        action: wasFavorite ? 'remove-pair' : 'add-pair',
        listId: 'favorites',
        symbol,
      });
    } catch (error) {
      setFavoriteSymbols(favoriteSymbols);
      setActionStatus(error instanceof Error ? error.message : 'Watchlist update failed');
    }
  }

  return (
    <section className="markets-page" aria-label="Markets workspace">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Markets</h1>
          <p>Discover cryptocurrencies and track market trends.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone={connected ? 'positive' : 'warning'}>{connected ? 'Binance live' : 'Local cache'}</Badge>
          <div className="market-search" role="search">
            <Search size={16} />
            <input aria-label="Search markets" onChange={(event) => setSearchQuery(event.target.value)} placeholder={lastEventAt ? `Tick ${new Date(lastEventAt).toLocaleTimeString('fr-FR')}` : 'Search markets'} value={searchQuery} />
          </div>
          <span className="market-action-status" aria-live="polite">{actionStatus}</span>
          <HelpPopover
            items={['Open a pair on Charts.', 'Favorites stay local until the watchlist is rebuilt.', 'Trading decisions use real backend data only.']}
            title="Markets"
          />
        </div>
      </div>

      <div className="market-categories" aria-label="Market categories">
        {categories.map((category) => (
          <button className={category.key === activeCategory ? 'is-active' : undefined} key={category.key} onClick={() => setActiveCategory(category.key)} type="button">
            {category.label}
          </button>
        ))}
      </div>

      <div className="market-stat-grid">
        <MarketStat label="Tracked Market Cap" source={dataSourceLabel} value={formatCompactUsd(overview.marketCap)} />
        <MarketStat label="Tracked 24h Volume" source={dataSourceLabel} value={formatCompactUsd(overview.volume24h)} />
        <MarketStat label="BTC Share" source="Tracked pairs" value={`${overview.btcDominance.toFixed(2)}%`} />
        <MarketStat label="ETH Share" source="Tracked pairs" value={`${overview.ethDominance.toFixed(2)}%`} />
        <MarketStat label="Tracked Pairs" source={connected ? `${initialStatus.pairCount} live feeds` : 'Local records'} value={formatCompact(overview.activeCryptos)} />
      </div>

      <div className="markets-grid">
        <div className="markets-main">
          <Card className="market-heatmap-card">
            <div className="market-section-header">
              <h2>Market Heatmap</h2>
              <div className="market-section-actions">
                <button className={heatmapMetric === 'marketCap' ? 'is-active' : undefined} onClick={() => setHeatmapMetric('marketCap')} type="button">Market Cap</button>
                <button className={heatmapMetric === 'change24h' ? 'is-active' : undefined} onClick={() => setHeatmapMetric('change24h')} type="button">24h</button>
              </div>
            </div>
            <div className="market-heatmap">
              {heatmapPairs.slice(0, 12).map((pair, index) => (
                <HeatmapTile index={index} key={pair.symbol} pair={pair} />
              ))}
            </div>
          </Card>

          <Card className="market-table-card">
            <div className="market-table-toolbar">
              <div className="market-search market-search--table" role="search">
                <Search size={15} />
                <input aria-label="Search assets" onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search assets" value={searchQuery} />
              </div>
              <div className="market-section-actions">
                <button className={tableFiltered ? 'is-active' : undefined} onClick={() => setTableFiltered((current) => !current)} type="button">
                  <Filter size={14} />
                  Filter
                </button>
                <button className={compactColumns ? 'is-active' : undefined} onClick={() => setCompactColumns((current) => !current)} type="button">Columns</button>
              </div>
            </div>

            <div className={compactColumns ? 'market-table market-table--compact' : 'market-table'}>
              <div className="market-table__header">
                <span>#</span>
                <span>Symbol</span>
                <span>Name</span>
                <span>Price</span>
                <span>24h %</span>
                <span>Volume</span>
                {!compactColumns ? <span>Market Cap</span> : null}
                <span>Fav</span>
                <span>Actions</span>
              </div>
              {visiblePairs.slice(0, 9).map((pair, index) => (
                <MarketRow compact={compactColumns} favorite={favoriteSymbols.has(pair.symbol)} index={index + 1} key={pair.symbol} onToggleFavorite={toggleFavorite} pair={pair} />
              ))}
            </div>
          </Card>
        </div>

        <aside className="markets-side" aria-label="Market side panels">
          <Card className="top-movers-card">
            <div className="market-section-header">
              <h2>Top Movers</h2>
              <div className="market-tabs">
                <button className={moverMode === 'gainers' ? 'is-active' : undefined} onClick={() => setMoverMode('gainers')} type="button">
                  Gainers
                </button>
                <button className={moverMode === 'losers' ? 'is-active' : undefined} onClick={() => setMoverMode('losers')} type="button">Losers</button>
              </div>
            </div>
            <div className="top-movers-list">
              {topMovers.map((pair, index) => (
                <Link className="top-mover" href={`/charts?pair=${encodeURIComponent(pair.symbol)}`} key={pair.symbol}>
                  <span>{index + 1}</span>
                  <strong>{pair.base}</strong>
                  <small>{pair.name}</small>
                  <b>{formatUsd(pair.lastPrice)}</b>
                  <em className={pair.change24h >= 0 ? 'positive' : 'negative'}>{formatPercent(pair.change24h)}</em>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="market-sentiment-card">
            <div className="market-section-header">
              <h2>Market Sentiment</h2>
            </div>
            <div className={`sentiment-gauge sentiment-gauge--${sentiment.tone}`} aria-label={`Market sentiment ${sentiment.score}`} style={{ '--sentiment-score': `${sentiment.score}%` } as CSSProperties}>
              <span>{sentiment.score}</span>
              <strong>{sentiment.label}</strong>
            </div>
            <div className="sentiment-breakdown">
              <span className="negative">{sentiment.fear}% Fear</span>
              <span>{sentiment.neutral}% Neutral</span>
              <span className="positive">{sentiment.greed}% Greed</span>
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}

function MarketStat({ label, source, value }: { label: string; source: string; value: string }) {
  return (
    <Card className="market-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{source}</small>
    </Card>
  );
}

function buildLiveOverview(seedOverview: MarketOverview, pairs: MarketPair[]): MarketOverview {
  const marketCap = pairs.reduce((sum, pair) => sum + pair.marketCap, 0);
  const volume24h = pairs.reduce((sum, pair) => sum + pair.volume24h, 0);
  const btc = pairs.find((pair) => pair.base === 'BTC');
  const eth = pairs.find((pair) => pair.base === 'ETH');

  return {
    ...seedOverview,
    activeCryptos: pairs.length,
    btcDominance: btc && marketCap ? (btc.marketCap / marketCap) * 100 : seedOverview.btcDominance,
    ethDominance: eth && marketCap ? (eth.marketCap / marketCap) * 100 : seedOverview.ethDominance,
    marketCap,
    sentiment: pairs.filter((pair) => pair.change24h >= 0).length >= pairs.length / 2 ? 'Risk-on' : 'Risk-off',
    volume24h,
  };
}

function buildMarketSentiment(pairs: MarketPair[]) {
  const total = Math.max(pairs.length, 1);
  const greedCount = pairs.filter((pair) => pair.change24h > 0.1).length;
  const fearCount = pairs.filter((pair) => pair.change24h < -0.1).length;
  const neutralCount = Math.max(0, total - greedCount - fearCount);
  const score = Math.round(((greedCount + neutralCount * 0.5) / total) * 100);

  return {
    fear: Math.round((fearCount / total) * 100),
    greed: Math.round((greedCount / total) * 100),
    label: score >= 60 ? 'Greed' : score <= 40 ? 'Fear' : 'Neutral',
    neutral: Math.round((neutralCount / total) * 100),
    score,
    tone: score >= 60 ? 'positive' : score <= 40 ? 'negative' : 'neutral',
  };
}

function HeatmapTile({ index, pair }: { index: number; pair: MarketPair }) {
  const isLarge = index < 2;
  const tone = pair.change24h >= 0 ? 'positive' : 'negative';

  return (
    <Link
      className={`market-heatmap__tile market-heatmap__tile--${tone}`}
      href={`/charts?pair=${encodeURIComponent(pair.symbol)}`}
      style={{
        gridColumn: isLarge ? 'span 2' : undefined,
        gridRow: isLarge ? 'span 2' : undefined,
      }}
    >
      <strong>{pair.base}</strong>
      <span>{formatPercent(pair.change24h)}</span>
      <small>{formatUsd(pair.lastPrice)}</small>
    </Link>
  );
}

function MarketRow({
  compact,
  favorite,
  index,
  onToggleFavorite,
  pair,
}: {
  compact: boolean;
  favorite: boolean;
  index: number;
  onToggleFavorite: (symbol: string) => void;
  pair: MarketPair;
}) {
  const pairParam = encodeURIComponent(pair.symbol);

  return (
    <div className="market-table__row">
      <span>{index}</span>
      <span className="market-symbol">
        <Star className={favorite ? 'is-favorite' : undefined} size={15} />
        <strong>{pair.base}</strong>
      </span>
      <span>{pair.name}</span>
      <span>{formatUsd(pair.lastPrice)}</span>
      <span className={pair.change24h >= 0 ? 'positive' : 'negative'}>{formatPercent(pair.change24h)}</span>
      <span>{formatCompactUsd(pair.volume24h)}</span>
      {!compact ? <span>{formatCompactUsd(pair.marketCap)}</span> : null}
      <span>
        <button aria-label={favorite ? `Remove ${pair.symbol} from watchlist` : `Add ${pair.symbol} to watchlist`} className="market-watchlist-link" onClick={() => onToggleFavorite(pair.symbol)} title={favorite ? 'Remove from watchlist' : 'Add to watchlist'} type="button">
          <Star className={favorite ? 'is-favorite' : undefined} size={16} />
        </button>
      </span>
      <span className="market-row-actions">
        <Link aria-label={`Open ${pair.symbol} on chart`} href={`/charts?pair=${pairParam}`} title="Open on chart">
          <LineChart size={15} />
        </Link>
        <button aria-label={favorite ? `Remove ${pair.symbol} from watchlist` : `Add ${pair.symbol} to watchlist`} onClick={() => onToggleFavorite(pair.symbol)} title={favorite ? 'Remove from watchlist' : 'Add to watchlist'} type="button">
          <Star className={favorite ? 'is-favorite' : undefined} size={15} />
        </button>
      </span>
    </div>
  );
}
