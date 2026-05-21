import type { LucideIcon } from 'lucide-react';
import { Bell, Bot, BrainCircuit, ChartCandlestick, ClipboardList, History, LineChart, ListChecks, Settings, Sparkles, WalletCards } from 'lucide-react';

export type AppNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export const appNavigation: AppNavigationItem[] = [
  { href: '/charts', icon: ChartCandlestick, label: 'Charts' },
  { href: '/markets', icon: LineChart, label: 'Markets' },
  { href: '/watchlist', icon: ListChecks, label: 'Watchlist' },
  { href: '/agents', icon: BrainCircuit, label: 'Agents' },
  { href: '/backtest', icon: ClipboardList, label: 'Backtest' },
  { href: '/strategies', icon: Sparkles, label: 'Strategies' },
  { href: '/bots', icon: Bot, label: 'Bots' },
  { href: '/orders', icon: WalletCards, label: 'Orders' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
  { href: '/history', icon: History, label: 'History' },
  { href: '/exchanges', icon: WalletCards, label: 'Exchanges' },
  { href: '/preferences', icon: Settings, label: 'Preferences' },
];
