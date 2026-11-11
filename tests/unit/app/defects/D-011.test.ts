// D-011 (seam: the T00 owner, with T02 and T05 named): at 16:9 and wider section 6.1 fixes the follow gain at .72, and
// with the lane at PLAY_HALF_X = 40 (contract) and T05's ship 3.2 u wide and 2.2 u aft of its centre, the outer wing at
// x = +-40 projects outside the frame from 16:9 up to about 2.0: NDC 1.104 at 16:9, .982 at 2:1 [O: this projection, and
// 1.103 and 1.100 read through the live camera at 1920x1080, A16 "framing"]. Below 16:9 T10's followGainX keeps the
// whole ship inside .85 of the half-width (DI-81, follow.test.ts). This regression asks the same of 16:9 and wider. It
// was red until the T00 owner ruled: DI-88 adopted the gain formula at every aspect, and its assertions are unchanged.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_PITCH, CAMERA_Y, PLAY_HALF_X, SHIP_FORWARD } from '../../../../src/contracts/index';
import { FOLLOW_Y, followGainX } from '../../../../src/app/follow';
import { buildShipBody } from '../../../../src/render/props/ship';

const SHIP = buildShipBody().position;

function outerNdc(aspect: number, x: number): number {
  const cam = new PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
  // The ship level at y = 6, so the camera sits at CAMERA_Y + FOLLOW_Y * (6 - 6).
  cam.position.set(followGainX(aspect) * x, CAMERA_Y + FOLLOW_Y * (6 - 6), 0);
  cam.rotation.set(CAMERA_PITCH, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const v = new Vector3();
  let outer = -Infinity;
  for (let i = 0; i < SHIP.length; i += 3) {
    v.set(x + SHIP[i]!, 6 + SHIP[i + 1]!, -SHIP_FORWARD + SHIP[i + 2]!).project(cam);
    outer = Math.max(outer, Math.sign(x) * v.x);
  }
  return outer;
}

describe('D-011: the ship at the lane edges at 16:9 and wider', () => {
  for (const [name, aspect] of [['16:9', 16 / 9], ['16:9 at 1920x1080', 1920 / 1080], ['1.9', 1.9], ['2:1', 2]] as [string, number][]) {
    it(`${name}: the whole body inside .9 of the half-width at x = +-${PLAY_HALF_X}`, () => {
      const r = [outerNdc(aspect, PLAY_HALF_X), outerNdc(aspect, -PLAY_HALF_X)];
      console.log(`D-011 ${name} gain ${followGainX(aspect)}: outer NDC ${r.map((v) => v.toFixed(3)).join(' ')}`);
      for (const v of r) expect(v).toBeLessThanOrEqual(0.9);
    });
  }
});
