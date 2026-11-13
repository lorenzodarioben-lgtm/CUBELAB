import { useSyncExternalStore } from 'react';

const query = '(max-width: 1099px)';
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};
/** Presentation only; the existing studio remains the sole owner of puzzle state. */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
