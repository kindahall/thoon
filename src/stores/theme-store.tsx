'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'system';

type ThemeContextValue = {
  resolvedTheme: Theme;
  setTheme: (theme: ThemePreference) => void;
  theme: ThemePreference;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = 'thoon-theme';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(theme: ThemePreference): Theme {
  return theme === 'system' ? getSystemTheme() : theme;
}

function readInitialTheme(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedTheme = window.localStorage.getItem(storageKey);
  return storedTheme === 'light' || storedTheme === 'system' ? storedTheme : 'dark';
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [hasLoadedTheme, setHasLoadedTheme] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('dark');

  useEffect(() => {
    const initialTheme = readInitialTheme();

    setTheme(initialTheme);
    setResolvedTheme(resolveTheme(initialTheme));
    setHasLoadedTheme(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedTheme) {
      return undefined;
    }

    const nextResolvedTheme = resolveTheme(theme);

    document.documentElement.dataset.theme = nextResolvedTheme;
    document.documentElement.style.colorScheme = nextResolvedTheme;
    window.localStorage.setItem(storageKey, theme);
    setResolvedTheme(nextResolvedTheme);

    if (theme !== 'system') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      const systemTheme = resolveTheme('system');

      document.documentElement.dataset.theme = systemTheme;
      document.documentElement.style.colorScheme = systemTheme;
      setResolvedTheme(systemTheme);
    };

    media.addEventListener('change', handleChange);

    return () => media.removeEventListener('change', handleChange);
  }, [hasLoadedTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme,
      theme,
      setTheme,
      toggleTheme: () => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : currentTheme === 'light' ? 'system' : 'dark')),
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }

  return context;
}
