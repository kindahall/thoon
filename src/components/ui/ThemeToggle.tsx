'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '../../hooks/useTheme';
import { IconButton } from './IconButton';

export function ThemeToggle() {
  const { resolvedTheme, theme, toggleTheme } = useTheme();
  const icon = theme === 'dark' ? <Sun size={18} /> : theme === 'light' ? <Monitor size={18} /> : <Moon size={18} />;
  const label = theme === 'dark' ? 'Light mode' : theme === 'light' ? 'System theme' : 'Dark mode';

  return (
    <IconButton
      aria-label={`${label}. Current ${theme === 'system' ? `system ${resolvedTheme}` : theme}.`}
      icon={icon}
      label={label}
      onClick={toggleTheme}
    />
  );
}
