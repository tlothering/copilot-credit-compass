'use client';

import { useEffect } from 'react';
import { useSession } from './session';

/**
 * Constraint C2: results live only in the browser. Warn before the tab closes
 * or reloads once the user has entered anything worth losing.
 */
export function useUnloadGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy assignment kept for browsers that still gate the prompt on it.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [enabled]);
}

/** Reads the sessionStorage mirror once on mount. Safe to call from many components. */
export function useHydratedSession() {
  const hydrate = useSession((s) => s.hydrate);
  const hydrated = useSession((s) => s.hydrated);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return hydrated;
}
