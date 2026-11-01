/**
 * Selects the experimental Stickerless renderer (v2) for this page load.
 *
 * Production keeps v1 unless the URL carries `?stickerless=v2`, so the two
 * renderers can be compared on the same build, machine and state. Nothing is
 * persisted: a reload without the parameter is plain v1 again.
 */
export type StickerlessRenderer = 'v1' | 'v2';

function fromLocation(): StickerlessRenderer {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return 'v1';
  return new URLSearchParams(window.location.search).get('stickerless') === 'v2' ? 'v2' : 'v1';
}

export const STICKERLESS_RENDERER: StickerlessRenderer = fromLocation();
