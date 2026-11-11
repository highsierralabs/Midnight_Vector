import {
  CAMERA_HALF_TAN_MAX, CAMERA_PITCH, FOG_END, FOG_START, PALETTE_FLOATS, PHASE_COUNT, WORLD_PERIOD,
  type FrameView, type SharedUniforms,
} from '../contracts/index';
import { rowMod, travelMod } from './coords';

/** One object per uniform, for spreading by reference into every ShaderMaterial. */
export function createSharedUniforms(): SharedUniforms {
  return {
    uTravel: { value: new Float32Array(2) },
    uCamRow: { value: 0 },
    uPhases: { value: new Float32Array(PHASE_COUNT) },
    uBend: { value: new Float32Array(3) },
    uPal: { value: new Float32Array(PALETTE_FLOATS) },
    uFog: { value: Float32Array.of(FOG_START, FOG_END) },
    uHero: { value: new Float32Array(3) },
  };
}

/**
 * Step 9 of section 3.3, so app/ and the dev shell cannot drift apart. All in place, no allocation, and uFog
 * stays as created. Under v.reducedMotion it writes uBend = (0, 0, vMax), so nobody repeats section 10.3's bend-off.
 */
export function writeSharedUniforms(v: Readonly<FrameView>, out: SharedUniforms): void {
  const travel = out.uTravel.value;
  travel[0] = v.cam.local;
  travel[1] = travelMod(v.cam, WORLD_PERIOD);
  out.uCamRow.value = rowMod(v.cam.chunk);
  out.uPhases.value.set(v.phases);
  const bend = out.uBend.value;
  bend[0] = v.reducedMotion ? 0 : v.bend.a;
  bend[1] = v.reducedMotion ? 0 : v.bend.c;
  bend[2] = v.bend.vMax;
  out.uPal.value.set(v.zone.palette);
  const hero = out.uHero.value;
  hero[0] = v.zone.heroA;
  hero[1] = v.zone.heroB;
  hero[2] = v.zone.heroMix;
}

export interface CameraPose { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; fovDeg: number }

/** min(fovDeg, 2 * atan(CAMERA_HALF_TAN_MAX / aspect) in degrees): the section 6.4 cap. */
export function cameraFov(fovDeg: number, aspect: number): number {
  return Math.min(fovDeg, (2 * Math.atan(CAMERA_HALF_TAN_MAX / aspect) * 180) / Math.PI);
}

/** x camX, y camY, z 0; rotX CAMERA_PITCH + shakeY, rotY shakeX, rotZ roll, in three's default XYZ order; fovDeg through cameraFov. */
export function writeCameraPose(v: Readonly<FrameView>, aspect: number, out: CameraPose): void {
  out.x = v.camX;
  out.y = v.camY;
  out.z = 0;
  out.rotX = CAMERA_PITCH + v.feel.shakeY;
  out.rotY = v.feel.shakeX;
  out.rotZ = v.feel.roll;
  out.fovDeg = cameraFov(v.feel.fovDeg, aspect);
}
