import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createStickerlessResources } from '../../src/components/cube/stickerlessResources';
import { createStickeredResources } from '../../src/components/cube/stickeredResources';
import { stickerlessWindowIntensity, stickerlessWindowPosition } from '../../src/components/stage/stickerlessEnvironment';

function compile(material: THREE.Material) {
  const lib = THREE.ShaderLib.physical;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe('production Strong Hybrid', () => {
  for (const tier of ['high', 'medium'] as const) it(`uses the reviewed shell response and illumination at ${tier}`, () => {
    const resources = createStickerlessResources(tier, 'gloss');
    for (const material of resources.materials as THREE.MeshPhysicalMaterial[]) {
      expect(material.roughness).toBeGreaterThanOrEqual(0.13 * 0.93);
      expect(material.roughness).toBeLessThanOrEqual(0.13 * 1.07);
      expect(material.clearcoat).toBe(0.14);
      expect(material.clearcoatRoughness).toBeGreaterThanOrEqual(0.14 * 0.8);
      expect(material.clearcoatRoughness).toBeLessThanOrEqual(0.14 * 1.2);
      expect(material.specularIntensity).toBe(0.95);
      expect(material.ior).toBe(1.5);
      expect(material.metalness).toBe(0);
      const shader = compile(material);
      expect(shader.fragmentShader).toContain('pieceAnalyticRimNormal');
      expect(shader.fragmentShader).toContain('textureCubeUV( uPlasticDiffuseEnvironment, envMapRotation * worldNormal');
      expect(shader.fragmentShader).toContain('mix(plasticRoomRadiance, envMapColor.rgb, plasticWindowVisibility)');
      expect(shader.fragmentShader).toContain('reflectedLight.directSpecular = plasticSavedDirectSpecular;');
      expect((shader.uniforms.uSeamRange!.value as THREE.Vector2).toArray()).toEqual([0.35, 0.9]);
    }
    expect((resources.coreMaterial as THREE.MeshStandardMaterial).roughness).toBe(0.7);
    expect(compile(resources.coreMaterial).uniforms).toHaveProperty('uPlasticDiffuseEnvironment');
    resources.dispose();
  });

  it('updates both environment bindings without replacing materials or recompiling shaders', () => {
    const resources = createStickerlessResources('high', 'gloss');
    const material = resources.materials[0] as THREE.MeshPhysicalMaterial, shader = compile(material), key = material.customProgramCacheKey();
    const specular = new THREE.Texture(), diffuse = new THREE.Texture();
    resources.setEnvironment(specular, diffuse);
    expect(material.envMap).toBe(specular);
    expect((resources.coreMaterial as THREE.MeshStandardMaterial).envMap).toBe(specular);
    expect(shader.uniforms.uPlasticDiffuseEnvironment!.value).toBe(diffuse);
    resources.setExposure(0.75);
    expect(shader.uniforms.uExposure!.value).toBe(0.75);
    resources.setEnvironment(null);
    expect(shader.uniforms.uPlasticDiffuseEnvironment!.value).toBeNull();
    expect(material.customProgramCacheKey()).toBe(key);
    resources.dispose(); specular.dispose(); diffuse.dispose();
  });

  it('leaves Matte, Low and Classic outside the hybrid shader and material paths', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const matte = createStickerlessResources(tier, 'matte');
      for (const material of matte.materials as THREE.MeshPhysicalMaterial[]) {
        expect(material.roughness).toBeGreaterThanOrEqual(0.42 * 0.93);
        expect(material.roughness).toBeLessThanOrEqual(0.42 * 1.07);
        expect(compile(material).uniforms).not.toHaveProperty('uPlasticDiffuseEnvironment');
        if (tier !== 'low') expect(material.clearcoat).toBe(0.12);
      }
      const classic = createStickeredResources(tier, 'gloss');
      for (const material of Object.values(classic.bodyMaterials)) {
        const shader = compile(material);
        expect(shader.uniforms).not.toHaveProperty('uPlasticDiffuseEnvironment');
        expect(shader.fragmentShader).not.toContain('plasticWindowVisibility');
        expect(shader.fragmentShader).not.toContain('pieceAnalyticRimNormal');
      }
      matte.dispose(); classic.dispose();
    }
    const low = createStickerlessResources('low', 'gloss');
    for (const material of low.materials as THREE.MeshStandardMaterial[]) {
      expect(material.type).toBe('MeshStandardMaterial');
      expect(material.roughness).toBeGreaterThanOrEqual(0.26 * 0.93);
      expect(compile(material).uniforms).not.toHaveProperty('uPlasticDiffuseEnvironment');
    }
    low.dispose();
  });

  it('matches the reviewed finite-window illumination', () => {
    expect(stickerlessWindowPosition().length()).toBeCloseTo(Math.sqrt(50), 12);
    expect(stickerlessWindowIntensity()).toBeCloseTo(4.347050572660111, 12);
  });
});
