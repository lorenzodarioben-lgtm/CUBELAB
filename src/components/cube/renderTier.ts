/**
 * Render tiers, shared by both cube styles.
 *  high   — physical materials, finest meshes, real-time soft shadows (desktop).
 *  medium — same materials, lighter meshes, no shadow passes (touch devices).
 *  low    — standard materials, coarser meshes, no shadows.
 */
export type RenderTier = 'high' | 'medium' | 'low';
