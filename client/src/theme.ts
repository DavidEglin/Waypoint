import type { Theme } from '@waypoint/shared';

const KEY = 'waypoint-theme';

/** Apply and remember a theme. 'system' removes the override so the device setting decides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the server-side preference still applies after sign-in */
  }
}
