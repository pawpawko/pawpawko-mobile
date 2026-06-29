// Runtime light/dark theme for the app. The Profile screen exposes a toggle;
// the choice is persisted to AsyncStorage and restored on launch. Screens read
// the active palette via useTheme().colors so a flip re-renders them instantly.
// Mirrors the web data-theme toggle. See reference-pawpawko-theme.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { darkColors, lightColors, type Palette } from './theme';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'pawpaw:theme';

type ThemeContextValue = {
  theme: ThemeName;
  colors: Palette;
  toggle: () => void;
  setTheme: (t: ThemeName) => void;
  ready: boolean; // true once the persisted choice has been read
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (alive && (v === 'dark' || v === 'light')) setThemeState(v);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEY, t).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, colors: theme === 'dark' ? darkColors : lightColors, toggle, setTheme, ready }),
    [theme, toggle, setTheme, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
