// Node has no GL, and createFakeHost's stub renderer has only what T00 promised. This wraps it with what the harness
// touches: a recording readPixels, the buffer size, context loss through a real EventTarget, and the clear colour.
// frame() decides what readPixels returns, so sweeps can be tested against a chosen picture.
import type { Color, WebGLRenderer } from 'three';
import { createFakeHost, type FakeHost } from '../../../../src/testing/fakeHost';

export interface PixelRead { x: number; y: number; w: number; h: number; offset: number }
export type FramePainter = (out: Uint8Array, offset: number, w: number, h: number) => void;

export interface GlStub {
  readonly host: FakeHost;
  readonly reads: PixelRead[];
  /** Direct calls that reach GL. A guard that refuses must leave these untouched. */
  readonly losses: number[];
  readonly restores: number[];
  width: number;
  height: number;
  lost: boolean;
  /** What readPixels writes for a full-frame read. Defaults to opaque black. */
  paint: FramePainter;
  /** Clear state as the harness last set it. */
  clearColour: number | null;
  clearAlpha: number;
  renderTargets: unknown[];
}

const LOST = 'webglcontextlost';
const RESTORED = 'webglcontextrestored';

export function createGlStub(): GlStub {
  const host = createFakeHost();
  const canvas = new EventTarget();
  const stub: GlStub = {
    host,
    reads: [],
    losses: [],
    restores: [],
    width: 64,
    height: 32,
    lost: false,
    paint(out: Uint8Array, offset: number, w: number, h: number): void {
      out.fill(0, offset, offset + w * h * 4);
      for (let i = offset + 3; i < offset + w * h * 4; i += 4) out[i] = 255;
    },
    clearColour: null,
    clearAlpha: 0,
    renderTargets: [],
  };
  const gl = {
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    get drawingBufferWidth(): number { return stub.width; },
    get drawingBufferHeight(): number { return stub.height; },
    isContextLost: (): boolean => stub.lost,
    readPixels(x: number, y: number, w: number, h: number, _f: number, _t: number, out: Uint8Array, offset = 0): void {
      stub.reads.push({ x, y, w, h, offset });
      if (w === 1 && h === 1) out.fill(0, offset, offset + 4);
      else stub.paint(out, offset, w, h);
    },
  };
  const savedColour = { r: 0, g: 0, b: 0 };
  Object.assign(host.ctx.renderer as unknown as Record<string, unknown>, {
    domElement: canvas,
    getContext: () => gl,
    setRenderTarget(t: unknown): void { stub.renderTargets.push(t); },
    getClearColor(target: Color): Color {
      target.r = savedColour.r;
      target.g = savedColour.g;
      target.b = savedColour.b;
      return target;
    },
    getClearAlpha: (): number => stub.clearAlpha,
    setClearColor(c: number | Color, alpha: number): void {
      stub.clearAlpha = alpha;
      if (typeof c === 'number') {
        stub.clearColour = c;
        savedColour.r = ((c >> 16) & 255) / 255;
        savedColour.g = ((c >> 8) & 255) / 255;
        savedColour.b = (c & 255) / 255;
      } else {
        stub.clearColour = -1;
        savedColour.r = c.r;
        savedColour.g = c.g;
        savedColour.b = c.b;
      }
    },
    forceContextLoss(): void {
      stub.losses.push(performance.now());
      stub.lost = true;
      setTimeout(() => { canvas.dispatchEvent(new Event(LOST)); }, 0);
    },
    forceContextRestore(): void {
      stub.restores.push(performance.now());
      stub.lost = false;
      setTimeout(() => { canvas.dispatchEvent(new Event(RESTORED)); }, 0);
    },
  } satisfies Partial<Record<keyof WebGLRenderer, unknown>>);
  return stub;
}
