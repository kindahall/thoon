import type { LucideIcon } from 'lucide-react';
import { Bell, Bot, BrainCircuit, ChartCandlestick, ClipboardList, History, LineChart, RotateCcw, Settings, Star, Trophy, WalletCards, Waypoints } from 'lucide-react';

export type AppNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export const appNavigation: AppNavigationItem[] = [
  { href: '/charts', icon: ChartCandlestick, label: 'Charts' },
  { href: '/markets', icon: LineChart, label: 'Markets' },
  { href: '/watchlist', icon: Star, label: 'Watchlist' },
  { href: '/exchanges', icon: WalletCards, label: 'Exchanges' },
  { href: '/backtest', icon: RotateCcw, label: 'Backtest' },
  { href: '/agent', icon: BrainCircuit, label: 'Agent' },
  { href: '/strategies', icon: Waypoints, label: 'Strategies' },
  { href: '/top-strategies', icon: Trophy, label: 'Top Strategies' },
  { href: '/bots', icon: Bot, label: 'Bots' },
  { href: '/orders', icon: ClipboardList, label: 'Orders' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
  { href: '/history', icon: History, label: 'History' },
  { href: '/preferences', icon: Settings, label: 'Preferences' },
];
