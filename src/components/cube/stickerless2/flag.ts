/**
 * Modern Stickerless always uses the approved v2 renderer.
 *
 * The former v1 implementation is no longer selected by any URL or settings
 * choice. Existing style preferences still work: Classic Stickered is separate.
 */
export type StickerlessRenderer = 'v1' | 'v2';

export const STICKERLESS_RENDERER: StickerlessRenderer = 'v2';
