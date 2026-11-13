import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV, CAMERA_FOV_MAX, CAMERA_HALF_TAN_MAX, CAMERA_PITCH, FOG_END, FOG_START, PALETTE_FLOATS, PHASE_COUNT, SimMode,
  type BendState, type FeelState, type FrameView, type QualityProfile, type SimState, type ZoneState,
} from '../../../src/contracts/index';
import { createBendState, createEventBuffer, createNeutralFeel, createZoneState } from '../../../src/core/alloc';
import { writePhases } from '../../../src/core/motion';
import { cameraFov, createSharedUniforms, writeCameraPose, writeSharedUniforms, type CameraPose } from '../../../src/core/uniforms';

interface TestView { v: FrameView; feel: FeelState; zone: ZoneState; bend: BendState }

function makeView(): TestView {
  const sim: SimState = {
    tick: 0, travel: { chunk: 0, local: 0 }, stepDist: 1, speed: 80, x: 0, y: 6, prevX: 0, prevY: 6, mode: SimMode.DEMO,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0, autopilot: true, warpSerial: 0,
  };
  const quality: QualityProfile = {
    tier: 3, dprCap: 1.5, maxPixels: 2073600, msaa: 2, mirror: true, post: 'full', bloomLevels: 6,
    nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 64,
  };
  const feel = createNeutralFeel();
  const zone = createZoneState();
  const bend = createBendState();
  const v: FrameView = {
    dt: 0, tick: 0, alpha: 0, cam: { chunk: 2 ** 40 + 63, local: 12.5 }, camX: 3, camY: 7,
    camMode: 0, camAhead: 0, cockpitIn: 0,
    phases: new Float32Array(PHASE_COUNT), sim, feel, zone, bend, events: createEventBuffer(), quality, reducedMotion: false,
  };
  return { v, feel, zone, bend };
}

describe('createSharedUniforms', () => {
  it('allocates the stated lengths', () => {
    const u = createSharedUniforms();
    expect(u.uTravel.value.length).toBe(2);
    expect(u.uPhases.value.length).toBe(8);
    expect(u.uBend.value.length).toBe(3);
    expect(u.uPal.value.length).toBe(PALETTE_FLOATS);
    expect(u.uPal.value.length).toBe(21);
    expect(u.uFog.value.length).toBe(2);
    expect(u.uHero.value.length).toBe(3);
    expect(Array.from(u.uFog.value)).toEqual([FOG_START, FOG_END]);
  });
});

describe('writeSharedUniforms', () => {
  it('writes in place, never replacing a value', () => {
    const u = createSharedUniforms();
    const before = [u.uTravel.value, u.uPhases.value, u.uBend.value, u.uPal.value, u.uFog.value, u.uHero.value];
    const objects = [u.uTravel, u.uPhases, u.uBend, u.uPal, u.uFog, u.uHero, u.uCamRow];
    writeSharedUniforms(makeView().v, u);
    expect([u.uTravel.value, u.uPhases.value, u.uBend.value, u.uPal.value, u.uFog.value, u.uHero.value].every((v, i) => v === before[i])).toBe(true);
    expect([u.uTravel, u.uPhases, u.uBend, u.uPal, u.uFog, u.uHero, u.uCamRow].every((v, i) => v === objects[i])).toBe(true);
  });

  it('gives uTravel.y 4044.5 and uCamRow 63 at the distant point', () => {
    const u = createSharedUniforms();
    writeSharedUniforms(makeView().v, u);
    expect(u.uTravel.value[0]).toBe(12.5);
    expect(u.uTravel.value[1]).toBe(4044.5);
    expect(u.uCamRow.value).toBe(63);
  });

  it('wraps uTravel.y at 4096: chunk 2^40 + 127 tells that from 8192, which 2^40 + 63 cannot', () => {
    const u = createSharedUniforms();
    const { v } = makeView();
    v.cam.chunk = 2 ** 40 + 127;
    writeSharedUniforms(v, u);
    expect(u.uTravel.value[0]).toBe(12.5);
    expect(u.uTravel.value[1]).toBe(4044.5);
  });

  it('copies phases, palette, bend and hero', () => {
    const u = createSharedUniforms();
    const { v, zone, bend } = makeView();
    writePhases(100, 0.5, v.phases);
    zone.palette.fill(0.25);
    zone.heroA = 1; zone.heroB = 2; zone.heroMix = 0.5;
    bend.a = 4e-5; bend.c = -1.2e-5; bend.vMax = 1500;
    writeSharedUniforms(v, u);
    expect(Array.from(u.uPhases.value)).toEqual(Array.from(v.phases));
    expect(u.uPal.value[20]).toBe(0.25);
    expect(Array.from(u.uHero.value)).toEqual([1, 2, 0.5]);
    expect(u.uBend.value[0]).toBe(Math.fround(4e-5));
    expect(u.uBend.value[1]).toBe(Math.fround(-1.2e-5));
    expect(u.uBend.value[2]).toBe(1500);
  });

  it('zeroes the bend under reducedMotion and keeps vMax', () => {
    const u = createSharedUniforms();
    const { v, bend } = makeView();
    bend.a = 8e-5; bend.c = -1.2e-5; bend.vMax = 1500;
    v.reducedMotion = true;
    writeSharedUniforms(v, u);
    expect(Array.from(u.uBend.value)).toEqual([0, 0, 1500]);
  });

  it('leaves uFog untouched, including after someone retunes it', () => {
    const u = createSharedUniforms();
    u.uFog.value[0] = 123;
    writeSharedUniforms(makeView().v, u);
    expect(u.uFog.value[0]).toBe(123);
    expect(u.uFog.value[1]).toBe(FOG_END);
  });
});

describe('camera pose', () => {
  it('cameraFov holds the section 6.4 cap, in degrees', () => {
    const capAt = (aspect: number): number => (2 * Math.atan(CAMERA_HALF_TAN_MAX / aspect) * 180) / Math.PI;
    expect(cameraFov(CAMERA_FOV, 16 / 9)).toBe(CAMERA_FOV);
    // CAMERA_HALF_TAN_MAX is the 21:9 value at CAMERA_FOV_MAX, so the cap just clears 68 there.
    expect(capAt(21 / 9)).toBeGreaterThan(CAMERA_FOV_MAX);
    expect(capAt(21 / 9)).toBeLessThan(CAMERA_FOV_MAX + 0.01);
    expect(cameraFov(CAMERA_FOV_MAX, 21 / 9)).toBe(CAMERA_FOV_MAX);
    // Wider than 21:9 the cap bites, and it comes back in degrees: radians would read near 1.
    expect(cameraFov(CAMERA_FOV_MAX, 32 / 9)).toBeCloseTo(capAt(32 / 9), 10);
    expect(cameraFov(CAMERA_FOV_MAX, 32 / 9)).toBeLessThan(CAMERA_FOV_MAX);
    expect(cameraFov(CAMERA_FOV_MAX, 32 / 9)).toBeGreaterThan(10);
  });

  it('writeCameraPose follows the seam', () => {
    const { v, feel } = makeView();
    const out: CameraPose = { x: 9, y: 9, z: 9, rotX: 9, rotY: 9, rotZ: 9, fovDeg: 9 };
    feel.shakeX = 0.002; feel.shakeY = 0.003; feel.roll = -0.01; feel.fovDeg = 60;
    writeCameraPose(v, 16 / 9, out);
    expect(out).toEqual({ x: 3, y: 7, z: 0, rotX: CAMERA_PITCH + 0.003, rotY: 0.002, rotZ: -0.01, fovDeg: 60 });
    // The pose goes through the section 6.4 cap: past 21:9 the wanted angle does not reach the camera.
    feel.fovDeg = CAMERA_FOV_MAX;
    writeCameraPose(v, 32 / 9, out);
    expect(out.fovDeg).toBeCloseTo(cameraFov(CAMERA_FOV_MAX, 32 / 9), 10);
    expect(out.fovDeg).toBeLessThan(CAMERA_FOV_MAX);
  });

  it('gives rotX exactly 0 under shakeY: -CAMERA_PITCH', () => {
    const { v, feel } = makeView();
    const out: CameraPose = { x: 0, y: 0, z: 0, rotX: 1, rotY: 1, rotZ: 1, fovDeg: 0 };
    feel.shakeY = -CAMERA_PITCH;
    writeCameraPose(v, 16 / 9, out);
    expect(out.rotX).toBe(0);
  });
});
