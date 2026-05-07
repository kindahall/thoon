import type { Watchlist } from '../types/trading';

export const watchlists: Watchlist[] = [
  {
    alertCount: 0,
    id: 'favorites',
    name: 'Favorites',
    pairSymbols: [],
    type: 'favorites',
    updatedAt: new Date(0).toISOString(),
  },
];
