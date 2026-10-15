/** Strong Hybrid: coloured-plastic reflections under one finite window source. */
import * as THREE from 'three';

export interface DiffuseEnvironment {
  value: THREE.Texture | null;
}

/**
 * Called only by the Stickerless Gloss resource factory on physical tiers.
 * Keep the approved piece shader, normals and deterministic finish variation.
 * The mechanism shares the illumination without acquiring the shell's polish.
 */
export function applyStrongHybrid(material: THREE.MeshStandardMaterial, diffuse: DiffuseEnvironment, shell = true): void {
  if (shell) {
    material.roughness *= 0.13 / 0.26;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.clearcoat = 0.14;
      material.clearcoatRoughness *= 0.14 / 0.07;
      material.specularIntensity = 0.95;
    }
  }
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.uPlasticDiffuseEnvironment = diffuse;
    // Both PMREM maps have identical packing. Room irradiance comes from the
    // diffuse map; the window's diffuse energy comes from the matching key.
    let environment = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 )',
      'textureCubeUV( uPlasticDiffuseEnvironment, envMapRotation * worldNormal, 1.0 )',
    );
    environment = environment.replace('return envMapColor.rgb * envMapIntensity;', /* glsl */ `
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
vec3 plasticRoomRadiance = textureCubeUV(uPlasticDiffuseEnvironment, envMapRotation * reflectVec, roughness).rgb;
return mix(plasticRoomRadiance, envMapColor.rgb, plasticWindowVisibility) * envMapIntensity;
#else
return envMapColor.rgb * envMapIntensity;
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPlasticDiffuseEnvironment;\nfloat plasticWindowVisibility = 1.0;')
      .replace('#include <envmap_physical_pars_fragment>', environment)
      .replace('#include <lights_fragment_begin>', /* glsl */ `
vec3 plasticSavedDirectSpecular = reflectedLight.directSpecular;
#ifdef USE_CLEARCOAT
vec3 plasticSavedCoat = clearcoatSpecularDirect;
#endif
#include <lights_fragment_begin>
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHTS > 0
plasticWindowVisibility = clamp(dot(directLight.color, vec3(1.0)) / max(dot(directionalLights[0].color, vec3(1.0)), 1e-7), 0.0, 1.0);
#endif
// The finite window is already reflected by IBL. Avoid a duplicate point-like
// direct specular highlight, while retaining its shadowed diffuse light.
reflectedLight.directSpecular = plasticSavedDirectSpecular;
#ifdef USE_CLEARCOAT
clearcoatSpecularDirect = plasticSavedCoat;
#endif`);
  };
  material.customProgramCacheKey = () => `${key}-strong-hybrid`;
}
