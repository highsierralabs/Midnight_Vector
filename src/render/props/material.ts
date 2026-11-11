// The ShaderMaterial families: at most 6 programs. Normal, mirror (BackSide), additive, CUTOUT (the only one with discard,
// used by CASSETTE alone), ship body and ship glow. Every per-ring value is a uniform, not a define, so rings share programs and
// nothing recompiles when a tier changes. Shared uniforms are spread by reference. Never clone a material here.
import { AdditiveBlending, BackSide, DoubleSide, FrontSide, ShaderMaterial, type IUniform } from 'three';
import { RenderOrder, SHIP_FORWARD, TRAFFIC_FADE, type SharedUniforms } from '../../contracts/index';
import { COMMON_FRAG, COMMON_VERT } from '../../contracts/glsl';
import { Look, Motion, type LookDef } from './archetypes';
import { SHIP_HALF_LENGTH } from './ship';
import neonSource from './glsl/neon.glsl?raw';
import fragSource from './glsl/props.frag.glsl?raw';
import vertSource from './glsl/props.vert.glsl?raw';
import shipVertSource from './glsl/ship.vert.glsl?raw';

function constants(prefix: string, values: Readonly<Record<string, number>>): string {
  let out = '';
  for (const key of Object.keys(values)) out += `const int ${prefix}${key} = ${values[key]};\n`;
  return out;
}
const CONSTANTS = constants('L_', Look) + constants('M_', Motion);

/** Per motion: which phase its one angle runs on, and the integer harmonic. Reduced motion takes the harmonic to 1. */
const SPIN: Readonly<Record<number, readonly [number, number]>> = {
  [Motion.PALM]: [2, 3],
  [Motion.CRYSTAL]: [4, 1],
  [Motion.SHARD]: [3, 2],
  [Motion.SAUCER]: [4, 1],
  [Motion.SEARCHLIGHT]: [6, 1],
  [Motion.TURBINE]: [4, 1],
};

export type Family = 'normal' | 'mirror' | 'additive' | 'cutout' | 'shipBody' | 'shipGlow';

export interface MaterialFlags {
  naive: boolean;
  silhouette: boolean;
  clipRoots: boolean;
  /** Tests only (A15): the mirror program paints a fragment red when its reflected world y is above the floor, dim green otherwise. */
  mirrorProbe: boolean;
}

/** Uniforms every prop material shares by reference, written once per frame by the layer. */
export interface LayerUniforms {
  uDensity: { value: number };
  uDensityWindow: { value: number };
  uGhost: { value: number };
  uReduced: { value: number };
  uOrbFade: { value: number };
  uGateFlash: { value: Float32Array };
  uTrafficFade: { value: number };
  /** 1: RING is cut at the floor plane. 0 only in a sheet tile with no floor, so the tile shows the whole circle. */
  uRingCut: { value: number };
  /** Drawing buffer height in px, written each frame, so the vertex shader knows a pixel's size in u at a depth (D-002). */
  uViewH: { value: number };
  /** The depth of the ship's tail ahead of the camera, in u. A gate nearer than this has been cleared and opens out (DI-113). */
  uGateOpen: { value: number };
}

export function createLayerUniforms(): LayerUniforms {
  return {
    uRingCut: { value: 1 },
    uViewH: { value: 1080 },
    uGateOpen: { value: SHIP_FORWARD - SHIP_HALF_LENGTH },
    uDensity: { value: 1 },
    uDensityWindow: { value: 0.03 },
    uGhost: { value: 0 },
    uReduced: { value: 0 },
    uOrbFade: { value: 1 },
    uGateFlash: { value: Float32Array.of(-1, 0) },
    uTrafficFade: { value: TRAFFIC_FADE },
  };
}

/** The ship's own uniforms, written in frame(), shared by its two draws. */
export interface ShipUniforms {
  uShipPos: { value: Float32Array };
  uShipRot: { value: Float32Array };
  uShipEngine: { value: Float32Array };
  uShipBlink: { value: number };
}

export function createShipUniforms(): ShipUniforms {
  return {
    uShipPos: { value: new Float32Array(3) },
    uShipRot: { value: new Float32Array(2) },
    uShipEngine: { value: new Float32Array(2) },
    uShipBlink: { value: 1 },
  };
}

function defines(family: Family, f: MaterialFlags): Record<string, string> {
  const d: Record<string, string> = {};
  if (family === 'mirror') d['MIRROR'] = '1';
  if (family === 'additive' || family === 'shipGlow') d['ADDITIVE'] = '1';
  if (family === 'cutout') d['CUTOUT'] = '1';
  if (family === 'shipGlow') d['SHIP_GLOW'] = '1';
  if (f.naive) d['NAIVE_EDGES'] = '1';
  if (f.silhouette) d['SILHOUETTE'] = '1';
  if (f.clipRoots && family !== 'shipBody' && family !== 'shipGlow') d['CLIP_ROOTS'] = '1';
  if (f.mirrorProbe && family === 'mirror') d['MIRROR_PROBE'] = '1';
  return d;
}

export interface RingLookUniforms {
  uLook: { value: number };
  uMotion: { value: number };
  uMaxDist: { value: number };
  uBodyL: { value: number };
  uEdgeL: { value: number };
  uEdgeW: { value: number };
  uUseYaw: { value: number };
  uGrounded: { value: number };
  uHazard: { value: number };
  uUnitScale: { value: number };
  uSpinPhase: { value: number };
  uSpinK: { value: number };
  uPivot: { value: Float32Array };
  uTint: { value: Int32Array };
  uFlat: { value: Float32Array };
}

export function ringLookUniforms(def: Readonly<LookDef>, maxDist: number, hazard: boolean, flat: readonly [number, number, number], unitScale = false): RingLookUniforms {
  return {
    uLook: { value: def.look },
    uMotion: { value: def.motion },
    uMaxDist: { value: maxDist },
    uBodyL: { value: def.bodyL },
    uEdgeL: { value: def.edgeL },
    uEdgeW: { value: def.edgeW },
    uUseYaw: { value: def.yaw ? 1 : 0 },
    uGrounded: { value: def.grounded ? 1 : 0 },
    uHazard: { value: hazard ? 1 : 0 },
    uUnitScale: { value: unitScale ? 1 : 0 },
    uSpinPhase: { value: SPIN[def.motion]?.[0] ?? 4 },
    uSpinK: { value: SPIN[def.motion]?.[1] ?? 1 },
    uPivot: { value: Float32Array.from(def.pivot ?? [0, 0, 0]) },
    uTint: { value: Int32Array.from(def.tints) },
    uFlat: { value: Float32Array.from(flat) },
  };
}

export function propMaterial(
  family: Family,
  shared: SharedUniforms,
  layer: LayerUniforms,
  look: RingLookUniforms,
  flags: MaterialFlags,
): ShaderMaterial {
  const uniforms = { ...shared, ...layer, ...look } as unknown as Record<string, IUniform>;
  const additive = family === 'additive' && !flags.silhouette;
  const m = new ShaderMaterial({
    name: `props-${family}`,
    vertexShader: CONSTANTS + COMMON_VERT + vertSource,
    fragmentShader: CONSTANTS + COMMON_FRAG + neonSource + fragSource,
    uniforms,
    defines: defines(family, flags),
    depthTest: true,
    depthWrite: !additive,
    transparent: additive,
    side: family === 'mirror' ? BackSide : family === 'cutout' ? FrontSide : DoubleSide,
  });
  if (additive) m.blending = AdditiveBlending;
  return m;
}

export function shipMaterial(
  family: 'shipBody' | 'shipGlow',
  shared: SharedUniforms,
  layer: LayerUniforms,
  ship: ShipUniforms,
  look: RingLookUniforms,
  flags: MaterialFlags,
): ShaderMaterial {
  const uniforms = { ...shared, ...layer, ...ship, ...look } as unknown as Record<string, IUniform>;
  const glow = family === 'shipGlow' && !flags.silhouette;
  const m = new ShaderMaterial({
    name: `props-${family}`,
    vertexShader: CONSTANTS + COMMON_VERT + shipVertSource,
    fragmentShader: CONSTANTS + COMMON_FRAG + neonSource + fragSource,
    uniforms,
    defines: defines(family, flags),
    depthTest: true,
    depthWrite: !glow,
    transparent: glow,
    side: FrontSide,
  });
  if (glow) m.blending = AdditiveBlending;
  return m;
}

export const RENDER_ORDER = { mirror: RenderOrder.MIRROR, normal: RenderOrder.PROP, ship: RenderOrder.SHIP, additive: RenderOrder.ADDITIVE } as const;
