import { useSyncExternalStore } from 'react';

const NARROW = '(max-width: 730px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsNarrow = () => useMediaQuery(NARROW);
