import { useCallback, useState } from 'react';

/**
 * Boolean UI state remembered in localStorage (e.g. whether a sidebar section is open).
 * Storage can be unavailable (private mode, blocked site data), so every access is guarded
 * and the hook just behaves like useState in that case.
 */
export function usePersistedBool(
  key: string,
  initial: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try { localStorage.setItem(key, resolved ? '1' : '0'); } catch { /* ignore */ }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
