// String assembly and the sky's ShaderMaterials. glslVersion stays unset (section 6.2), and no colourspace chunk is included,
// because the composer owns encoding. Shared uniforms are spread by reference, and these materials are never cloned.
import { ShaderMaterial, type IUniform, type Texture } from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../../contracts/glsl';
import commonFragSource from '../../contracts/glsl/common.frag.glsl?raw';
import type { SharedUniforms } from '../../contracts/index';
import type { SkyEvents } from './events';
import nebulaFrag from './nebula.frag.glsl?raw';
import nebulaVert from './nebula.vert.glsl?raw';
import skyFrag from './sky.frag.glsl?raw';
import skyVert from './sky.vert.glsl?raw';
import skyEventsSource from './skyEvents.glsl?raw';
import skyNoise from './skyNoise.glsl?raw';
import skyStarsSource from './skyStars.glsl?raw';

/** Compile-time, through defines, so the shipped program has no debug branch. Dev pages and the spec only. */
export interface SkyOptions {
  iso?: 'all' | 'gradient' | 'stars' | 'nebula' | 'hero' | 'nostars';   // default 'all'; nostars is all but the stars
  naiveStars?: boolean;     // negative control for the star gate
  legacyBelow?: boolean;    // negative control: the old section 6.3 rule, near-black at rd.y < 0 (S-25)
  heroSource?: string;      // replaces hero.glsl for this material only
  nanTest?: boolean;        // negative control for the float probe
  fullAtTier0?: boolean;    // negative control: tier 0 draws the program of tiers 1 to 4, as before D-007
}

/** The sky's private uniforms. Both sky programs spread this one record, so a write in frame() reaches whichever draws. */
export type SkyUniforms = Record<string, IUniform>;

/** COMMON_FRAG with another hero text, for a dev material only. */
export function commonFragWith(heroSource: string | undefined): string {
  return heroSource === undefined ? COMMON_FRAG : COMMON_VERT + commonFragSource + heroSource;
}

function skyDefines(o: SkyOptions, tier0: boolean): Record<string, number> {
  const iso = o.iso ?? 'all';
  // nostars lets a luminance check see the sky under an aurora without a star in a curtain counting as aurora.
  const most = iso === 'all' || iso === 'nostars';
  const d: Record<string, number> = {};
  if (most || iso === 'gradient') d['SKY_GRADIENT'] = 1;
  // Tier 0 has no nebula target (section 6.10), so its gain is 0 there and the sampling is compiled out (D-007).
  if (!tier0 && (most || iso === 'nebula')) d['SKY_NEBULA'] = 1;
  if (!tier0 && iso === 'nebula') d['SKY_ISO_NEBULA'] = 1;
  // Stars are compiled out at tier 0 too: they cost about 2 ms there on SwiftShader, and gradient, disc and horizon carry the read.
  if (!tier0 && (iso === 'all' || iso === 'stars')) d['SKY_STARS'] = 1;
  if (most) d['SKY_EVENTS'] = 1;
  if (most || iso === 'hero') d['SKY_HERO'] = 1;
  // Tier 0 on software: SwiftShader runs every hero mode under the uniform branch, so the disc is the plain sun (section 9.2, D-007).
  if (tier0) d['HERO_SUN_ONLY'] = 1;
  if (o.naiveStars) d['SKY_NAIVE_STARS'] = 1;
  if (o.legacyBelow) d['SKY_LEGACY_BELOW'] = 1;
  if (o.nanTest) d['SKY_NAN_TEST'] = 1;
  return d;
}

export function createSkyUniforms(nebula: Texture, events: SkyEvents): SkyUniforms {
  return {
    uNeb: { value: nebula },
    uNebGain: { value: 0 },
    uStarGain: { value: 1 },
    uStarPx: { value: 1 },
    uTwPhase: { value: 0 },
    uAuP: { value: new Float32Array(2) },
    uAurora: { value: 0 },
    uBoltK: { value: 0 },
    uFlash: { value: 0 },
    uMet: { value: events.met },
    uMetK: { value: events.metK },
    uBoltX: { value: events.boltX },
  };
}

/** tier0 builds the tier-0 program: no nebula sampling, no stars, HERO_SUN_ONLY. Tiers 1 to 4 use the other one, unchanged. */
export function createSkyMaterial(shared: SharedUniforms, sky: SkyUniforms, o: SkyOptions, tier0 = false): ShaderMaterial {
  return new ShaderMaterial({
    defines: skyDefines(o, tier0),
    uniforms: { ...shared, ...sky },
    vertexShader: skyVert,
    fragmentShader: commonFragWith(o.heroSource) + skyNoise + skyStarsSource + skyEventsSource + skyFrag,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
}

export function createNebulaMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: nebulaVert,
    fragmentShader: COMMON_VERT + skyNoise + nebulaFrag,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
}
