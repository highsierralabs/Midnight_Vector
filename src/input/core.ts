// The input state machine. No DOM type appears here, so all of section 7.3's logic runs in Node. sample allocates nothing.
import type { ControlFrame } from '../contracts/index';
import { BOOST_MASK, DOWN_MASK, LEFT_MASK, RIGHT_MASK, STEER_MASK, UP_MASK, keyBit } from './keys';

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface InputCore {
  /** Returns true when the code is one input handles, so the caller may preventDefault. */
  key(code: string, down: boolean): boolean;
  pointerDown(id: number, type: PointerKind, button: number, x: number, y: number): void;
  pointerMove(id: number, type: PointerKind, x: number, y: number): void;
  pointerUp(id: number): void;
  /** Left mouse button changed without a pointerdown or pointerup, as in a chord with another button held. */
  mouseLeft(held: boolean): void;
  boostButton(id: number, down: boolean): void;
  resize(w: number, h: number): void;
  clear(): void;
  sample(out: ControlFrame): void;
}

/** The central 80% of the element covers the whole play window [A]. */
const MOUSE_SPAN = 0.8;
/** A drag across 60% of the short side covers the whole window [A]. */
const TOUCH_SPAN = 0.6;
const MAX_FINGERS = 5;
const MAX_BOOST_POINTERS = 5;

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function finite(v: number): boolean {
  return v - v === 0;
}

export function createInputCore(): InputCore {
  let keys = 0;
  let w = 0;
  let h = 0;
  let minDim = 0;

  let targetX = 0;
  let targetY = 0;
  /** A pointer has moved since the last steer key, so the target is what the ship should chase. */
  let absolute = false;
  /** A device event arrived since the last sample. */
  let pending = false;

  let mouseId = -1;
  let mouseHeld = false;
  let leftHeld = false;

  // Fixed arrays, so a finger never allocates. fingers[0] is the steer finger.
  const fingers = [0, 0, 0, 0, 0];
  const fingerX = [0, 0, 0, 0, 0];
  const fingerY = [0, 0, 0, 0, 0];
  let fingerCount = 0;

  const boostIds = [0, 0, 0, 0, 0];
  let boostCount = 0;

  function fingerIndex(id: number): number {
    for (let i = 0; i < fingerCount; i++) if (fingers[i] === id) return i;
    return -1;
  }

  function removeFinger(i: number): void {
    for (let j = i + 1; j < fingerCount; j++) {
      fingers[j - 1] = fingers[j]!;
      fingerX[j - 1] = fingerX[j]!;
      fingerY[j - 1] = fingerY[j]!;
    }
    fingerCount--;
  }

  return {
    key(code, down) {
      const bit = keyBit(code);
      if (bit === 0) return false;
      const was = keys & bit;
      if (down) {
        keys |= bit;
        // A steer key makes the keyboard the steering device, until a pointer moves again after release.
        if ((bit & STEER_MASK) !== 0) absolute = false;
        pending = true;
      } else if (was !== 0) {
        keys &= ~bit;
        pending = true;
      }
      return true;
    },

    pointerDown(id, type, button, x, y) {
      if (type === 'mouse') {
        mouseId = id;
        mouseHeld = true;
        if (button === 0) leftHeld = true;
        pending = true;
        return;
      }
      if (!finite(x) || !finite(y)) return;
      const known = fingerIndex(id);
      pending = true;
      if (known >= 0) {
        fingerX[known] = x;
        fingerY[known] = y;
        return;
      }
      if (fingerCount >= MAX_FINGERS) return;
      fingers[fingerCount] = id;
      fingerX[fingerCount] = x;
      fingerY[fingerCount] = y;
      fingerCount++;
    },

    pointerMove(id, type, x, y) {
      if (!finite(x) || !finite(y)) return;
      if (type === 'mouse') {
        pending = true;
        if (w > 0) targetX = clamp1((x / w * 2 - 1) / MOUSE_SPAN);
        if (h > 0) targetY = clamp1((1 - y / h * 2) / MOUSE_SPAN);
        if ((keys & STEER_MASK) === 0) absolute = true;
        return;
      }
      const i = fingerIndex(id);
      // A pen hovering, or a finger past the fifth: nothing is pressed here.
      if (i < 0) return;
      pending = true;
      const dx = x - fingerX[i]!;
      const dy = y - fingerY[i]!;
      fingerX[i] = x;
      fingerY[i] = y;
      if (i !== 0) return;
      if (minDim > 0) {
        targetX = clamp1(targetX + 2 * dx / (TOUCH_SPAN * minDim));
        targetY = clamp1(targetY - 2 * dy / (TOUCH_SPAN * minDim));
      }
      if ((keys & STEER_MASK) === 0) absolute = true;
    },

    pointerUp(id) {
      if (id === mouseId && mouseHeld) {
        mouseHeld = false;
        leftHeld = false;
        pending = true;
        return;
      }
      const i = fingerIndex(id);
      if (i < 0) return;
      removeFinger(i);
      pending = true;
    },

    mouseLeft(held) {
      if (held === leftHeld) return;
      leftHeld = held;
      pending = true;
    },

    boostButton(id, down) {
      let at = -1;
      for (let i = 0; i < boostCount; i++) if (boostIds[i] === id) at = i;
      if (down) {
        pending = true;
        if (at < 0 && boostCount < MAX_BOOST_POINTERS) boostIds[boostCount++] = id;
        return;
      }
      if (at < 0) return;
      for (let j = at + 1; j < boostCount; j++) boostIds[j - 1] = boostIds[j]!;
      boostCount--;
      pending = true;
    },

    resize(nw, nh) {
      w = nw > 0 ? nw : 0;
      h = nh > 0 ? nh : 0;
      minDim = w < h ? w : h;
    },

    clear() {
      keys = 0;
      mouseHeld = false;
      leftHeld = false;
      fingerCount = 0;
      boostCount = 0;
      pending = false;
    },

    sample(out) {
      const steer = keys & STEER_MASK;
      if (steer !== 0) {
        out.absolute = false;
        out.moveX = ((keys & RIGHT_MASK) !== 0 ? 1 : 0) - ((keys & LEFT_MASK) !== 0 ? 1 : 0);
        out.moveY = ((keys & UP_MASK) !== 0 ? 1 : 0) - ((keys & DOWN_MASK) !== 0 ? 1 : 0);
      } else if (absolute) {
        out.absolute = true;
        out.moveX = targetX;
        out.moveY = targetY;
      } else {
        out.absolute = false;
        out.moveX = 0;
        out.moveY = 0;
      }
      out.boost = (keys & BOOST_MASK) !== 0 || leftHeld || fingerCount >= 2 || boostCount > 0;
      out.human = pending || keys !== 0 || mouseHeld || leftHeld || fingerCount > 0 || boostCount > 0;
      pending = false;
    },
  };
}
