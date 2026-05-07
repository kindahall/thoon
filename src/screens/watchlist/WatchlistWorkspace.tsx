'use client';

import { Bell, LineChart, ListPlus, Plus, Search, Settings2, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button, Card, EmptyState, HelpPopover } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { postJson } from '../../services/api-client';
import type { MarketPair } from '../../types/market';
import type { Alert, Watchlist } from '../../types/trading';
import { formatCompactUsd, formatPercent, formatUsd } from '../../utils/format';

type WatchlistWorkspaceProps = {
  alerts: Alert[];
  initialAddPair?: string;
  marketPairs: MarketPair[];
  watchlists: Watchlist[];
};

const favoritesStorageKey = 'thoon.watchlist.favorites';
type WatchlistTab = 'lists' | 'favorites' | 'tracked';
type WatchlistFilter = 'spot' | 'perp' | 'favorites' | 'alerts';
type WatchlistSort = 'default' | 'price' | 'volume';

export function WatchlistWorkspace({ alerts, initialAddPair, marketPairs, watchlists }: WatchlistWorkspaceProps) {
  const { connected: isBinanceLive, pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs);
  const defaultFavorites = useMemo(() => watchlists.find((list) => list.id === 'favorites')?.pairSymbols ?? [], [watchlists]);
  const [listRecords, setListRecords] = useState(watchlists);
  const [activeTab, setActiveTab] = useState<WatchlistTab>('lists');
  const [activeFilter, setActiveFilter] = useState<WatchlistFilter>('spot');
  const [sortMode, setSortMode] = useState<WatchlistSort>('default');
  const [actionStatus, setActionStatus] = useState('Ready');
  const [favoriteSymbols, setFavoriteSymbols] = useState(defaultFavorites);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const favoriteSet = useMemo(() => new Set(favoriteSymbols), [favoriteSymbols]);
  const watchedSymbols = useMemo(() => new Set(listRecords.flatMap((list) => list.pairSymbols)), [listRecords]);
  const watchedPairs = useMemo(() => liveMarketPairs.filter((pair) => watchedSymbols.has(pair.symbol)), [liveMarketPairs, watchedSymbols]);
  const visibleLists = useMemo(() => {
    if (activeTab === 'favorites') {
      return listRecords.filter((list) => list.id === 'favorites');
    }

    if (activeTab === 'tracked') {
      return listRecords.filter((list) => list.type !== 'favorites');
    }

    return listRecords;
  }, [activeTab, listRecords]);
  const visiblePairs = useMemo(() => {
    const tabPairs = activeTab === 'favorites' ? liveMarketPairs.filter((pair) => favoriteSet.has(pair.symbol)) : watchedPairs;
    const filteredPairs = tabPairs.filter((pair) => {
      if (activeFilter === 'favorites') {
        return favoriteSet.has(pair.symbol);
      }

      if (activeFilter === 'alerts') {
        return alerts.some((alert) => alert.symbol === pair.symbol && alert.status === 'active');
      }

      if (activeFilter === 'perp') {
        return pair.status === 'live-disabled';
      }

      return pair.exchange === 'Binance';
    });

    return [...(filteredPairs.length ? filteredPairs : tabPairs)].sort((first, second) => {
      if (sortMode === 'price') {
        return second.lastPrice - first.lastPrice;
      }

      if (sortMode === 'volume') {
        return second.volume24h - first.volume24h;
      }

      return first.symbol.localeCompare(second.symbol);
    });
  }, [activeFilter, activeTab, alerts, favoriteSet, liveMarketPairs, sortMode, watchedPairs]);

  function createList() {
    const nextIndex = listRecords.filter((list) => list.type === 'custom').length + 1;
    const nextList: Watchlist = {
      alertCount: 0,
      id: `custom-${Date.now()}`,
      name: `New List ${nextIndex}`,
      pairSymbols: [],
      type: 'custom',
      updatedAt: new Date().toISOString(),
    };

    setListRecords((currentLists) => [...currentLists, nextList]);
    setActionStatus(`${nextList.name} created`);
  }

  useEffect(() => {
    const storedFavorites = window.localStorage.getItem(favoritesStorageKey);

    if (storedFavorites) {
      setFavoriteSymbols(JSON.parse(storedFavorites) as string[]);
    }

    setFavoritesLoaded(true);
  }, []);

  useEffect(() => {
    if (!favoritesLoaded) {
      return;
    }

    window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favoriteSymbols));
  }, [favoriteSymbols, favoritesLoaded]);

  useEffect(() => {
    if (!favoritesLoaded || !initialAddPair || !liveMarketPairs.some((pair) => pair.symbol === initialAddPair)) {
      return;
    }

    setFavoriteSymbols((currentSymbols) => {
      if (currentSymbols.includes(initialAddPair)) {
        return currentSymbols;
      }

      const nextSymbols = [...currentSymbols, initialAddPair];
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(nextSymbols));
      void postJson('/api/watchlists', { action: 'add-pair', listId: 'favorites', symbol: initialAddPair });

      return nextSymbols;
    });
  }, [favoritesLoaded, initialAddPair, liveMarketPairs]);

  function toggleFavorite(symbol: string) {
    if (!favoritesLoaded) {
      return;
    }

    setFavoriteSymbols((currentSymbols) => {
      if (currentSymbols.includes(symbol)) {
        const nextSymbols = currentSymbols.filter((item) => item !== symbol);
        window.localStorage.setItem(favoritesStorageKey, JSON.stringify(nextSymbols));
        void postJson('/api/watchlists', { action: 'remove-pair', listId: 'favorites', symbol });

        return nextSymbols;
      }

      const nextSymbols = [...currentSymbols, symbol];
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(nextSymbols));
      void postJson('/api/watchlists', { action: 'add-pair', listId: 'favorites', symbol });

      return nextSymbols;
    });
  }

  return (
    <section className="watchlist-page" aria-label="Watchlist workspace">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Watchlist</h1>
          <p>Track pairs, favorites and alerts from your trading lists.</p>
        </div>
        <div className="workspace-header__right">
          <div className="market-search" role="search">
            <Search size={16} />
            <span>{isBinanceLive ? 'Binance live' : 'Local fallback'}</span>
          </div>
          <span className="sr-only" aria-live="polite">{actionStatus}</span>
          <Button icon={<Plus size={16} />} onClick={createList} size="sm" variant="primary">
            New List
          </Button>
          <HelpPopover
            items={['Open a pair directly on Charts.', 'Send a pair into a new strategy.', 'Alert counts link back to Alerts.']}
            title="Watchlist"
          />
        </div>
      </div>

      <div className="watchlist-tabs" aria-label="Watchlist tabs">
        <button className={activeTab === 'lists' ? 'is-active' : undefined} onClick={() => setActiveTab('lists')} type="button">
          My Lists
        </button>
        <button className={activeTab === 'favorites' ? 'is-active' : undefined} onClick={() => setActiveTab('favorites')} type="button">Favorites</button>
        <button className={activeTab === 'tracked' ? 'is-active' : undefined} onClick={() => setActiveTab('tracked')} type="button">Tracked Pairs</button>
      </div>

      {listRecords.length === 0 ? (
        <EmptyState
          actionLabel="New List"
          description="Create a focused list for the pairs you trade."
          icon={<ListPlus size={20} />}
          secondaryActionHref="/markets"
          secondaryActionLabel="Browse Markets"
          title="No watchlists"
        />
      ) : (
        <div className="watchlist-layout">
          <aside className="watchlist-lists" aria-label="My lists">
            {visibleLists.map((list) => (
              <WatchlistCard favoriteSymbols={favoriteSymbols} key={list.id} list={list} onManage={() => setActionStatus(`${list.name} selected`)} />
            ))}
          </aside>

          <Card className="watchlist-table-card">
            <div className="watchlist-toolbar">
              <div className="watchlist-filters" aria-label="Watchlist filters">
                <button className={activeFilter === 'spot' ? 'is-active' : undefined} onClick={() => setActiveFilter('spot')} type="button">
                  Spot
                </button>
                <button className={activeFilter === 'perp' ? 'is-active' : undefined} onClick={() => setActiveFilter('perp')} type="button">Perp</button>
                <button className={activeFilter === 'favorites' ? 'is-active' : undefined} onClick={() => setActiveFilter('favorites')} type="button">Favorites</button>
                <button className={activeFilter === 'alerts' ? 'is-active' : undefined} onClick={() => setActiveFilter('alerts')} type="button">Alerts</button>
              </div>
              <div className="market-section-actions">
                <button className={sortMode === 'price' ? 'is-active' : undefined} onClick={() => setSortMode((current) => (current === 'price' ? 'default' : 'price'))} type="button">Sort Price</button>
                <button className={sortMode === 'volume' ? 'is-active' : undefined} onClick={() => setSortMode((current) => (current === 'volume' ? 'default' : 'volume'))} type="button">Sort Volume</button>
              </div>
            </div>

            <div className="watchlist-table">
              <div className="watchlist-table__header">
                <span>Pair</span>
                <span>Price</span>
                <span>24h</span>
                <span>Volume</span>
                <span>Alerts</span>
                <span>Actions</span>
              </div>
              {visiblePairs.length > 0 ? (
                visiblePairs.map((pair) => (
                  <WatchlistRow
                    alertCount={alerts.filter((alert) => alert.symbol === pair.symbol && alert.status === 'active').length}
                    favorite={favoriteSet.has(pair.symbol)}
                    favoritesLoaded={favoritesLoaded}
                    key={pair.symbol}
                    pair={pair}
                    toggleFavorite={toggleFavorite}
                  />
                ))
              ) : (
                <EmptyState
                  actionHref="/markets"
                  actionLabel="Browse Markets"
                  description="Add pairs to a list before tracking them here."
                  icon={<ListPlus size={20} />}
                  secondaryActionHref="/alerts"
                  secondaryActionLabel="Create Alert"
                  title="No tracked pairs"
                />
              )}
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

function WatchlistCard({ favoriteSymbols, list, onManage }: { favoriteSymbols: string[]; list: Watchlist; onManage: () => void }) {
  const pairCount = list.id === 'favorites' ? favoriteSymbols.length : list.pairSymbols.length;

  return (
    <Card className="watchlist-card">
      <div>
        <h2>{list.name}</h2>
        <span>{list.type}</span>
      </div>
      <strong>{pairCount}</strong>
      <small>{list.alertCount} alerts</small>
      <button aria-label={`Manage ${list.name}`} onClick={onManage} type="button">
        <Settings2 size={15} />
      </button>
    </Card>
  );
}

function WatchlistRow({
  alertCount,
  favorite,
  favoritesLoaded,
  pair,
  toggleFavorite,
}: {
  alertCount: number;
  favorite: boolean;
  favoritesLoaded: boolean;
  pair: MarketPair;
  toggleFavorite: (symbol: string) => void;
}) {
  const pairParam = encodeURIComponent(pair.symbol);

  return (
    <div className="watchlist-table__row">
      <span className="watchlist-pair">
        <button
          aria-label={`${favorite ? 'Remove' : 'Add'} ${pair.symbol} favorite`}
          className="watchlist-favorite-button"
          disabled={!favoritesLoaded}
          onClick={() => toggleFavorite(pair.symbol)}
          type="button"
        >
          <Star className={favorite ? 'is-favorite' : undefined} size={15} />
        </button>
        <strong>{pair.symbol}</strong>
        <small>{pair.name}</small>
      </span>
      <span>{formatUsd(pair.lastPrice)}</span>
      <span className={pair.change24h >= 0 ? 'positive' : 'negative'}>{formatPercent(pair.change24h)}</span>
      <span>{formatCompactUsd(pair.volume24h)}</span>
      <Link className={alertCount > 0 ? 'positive' : undefined} href={`/alerts?pair=${pairParam}`}>
        {alertCount}
      </Link>
      <span className="watchlist-actions">
        <Link href={`/charts?pair=${pairParam}`} title="Open on chart">
          <LineChart size={15} />
        </Link>
        <Link href={`/strategies/new?pair=${pairParam}`} title="Add to strategy">
          <Plus size={15} />
        </Link>
        <Link href={`/alerts?pair=${pairParam}`} title="Create alert">
          <Bell size={15} />
        </Link>
      </span>
    </div>
  );
}
