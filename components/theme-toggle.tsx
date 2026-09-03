'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ccc-theme', next);
    } catch {
      /* private mode — the in-memory theme still applies for this session */
    }
    setTheme(next);
  }

  // Render a stable shell until mounted so the markup matches the server output.
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

  return (
    <button
      type="button"
      onClick={() => apply(theme === 'light' ? 'dark' : 'light')}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-lg border border-line text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      <span aria-hidden="true" className="text-sm">
        {theme === 'light' ? '☾' : '☀'}
      </span>
    </button>
  );
}
