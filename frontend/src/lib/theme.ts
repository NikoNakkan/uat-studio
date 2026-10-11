import { readStored, writeStored } from './storage';

/** Remembered on this browser only. Absent means follow the operating system. */
export const THEME_KEY = 'uat-theme';

export type Theme = 'light' | 'dark';

export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  return stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
}

export function readTheme(): Theme {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTheme(readStored(THEME_KEY), prefersDark);
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function writeTheme(theme: Theme) {
  writeStored(THEME_KEY, theme);
  applyTheme(theme);
}
