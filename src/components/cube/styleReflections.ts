import type * as THREE from 'three';

/**
 * The Premium Stickerless cube's own reflection map, published by the stage's
 * lighting (which owns the renderer and disposes the texture) and read by the
 * cube model each frame. `null` until rendered, and after disposal; the
 * stickerless materials then fall back to the shared scene environment.
 */
export class StyleReflections {
  #stickerless: THREE.Texture | null = null;

  get stickerless(): THREE.Texture | null {
    return this.#stickerless;
  }

  setStickerless(texture: THREE.Texture | null): void {
    this.#stickerless = texture;
  }
}
