// sintoniza-tv-app/src/hooks/useLocalStorage.ts
import { useState, useCallback } from 'preact/hooks';

export function useLocalStorage(key: string, initial: string): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(() => localStorage.getItem(key) ?? initial);

  const set = useCallback((next: string) => {
    localStorage.setItem(key, next);
    setValue(next);
  }, [key]);

  return [value, set];
}
