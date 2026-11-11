// The GPU sync, the full-frame read and the same-run guard. A pixel read in a later task reads empty after compositing,
// and a read before the composite can still succeed, so a careless test would pass sometimes (section 11.3, third trap).
// pixels() therefore refuses to read outside the synchronous run of a render.
import type { RenderContext } from '../contracts/index';

/** The 1x1 sync of section 11.4. Module scope, so a tight loop allocates nothing here. */
const SYNC_PIXEL = new Uint8Array(4);

export interface Sync {
  /** Allows full reads until the next microtask checkpoint. */
  arm(): void;
  isArmed(): boolean;
  /** 1x1 readPixels from the canvas, which waits for the GPU. Does nothing while the context is lost. */
  one(): void;
  /** Fresh full-frame RGBA, bottom-up rows. Throws unless armed. */
  full(): Uint8Array;
  /** Full-frame read into out at a byte offset. Throws unless armed. */
  fullInto(out: Uint8Array, offset: number): void;
  width(): number;
  height(): number;
}

export function createSync(ctx: RenderContext): Sync {
  let armed = false;
  const disarm = (): void => { armed = false; };

  function requireArmed(): void {
    if (!armed) {
      throw new Error('pixels() must be called in the same run as renderAt or stepFrames: a read after an await or in a later evaluate is unreliable (section 11.3)');
    }
  }

  return {
    arm(): void {
      if (armed) return;
      armed = true;
      queueMicrotask(disarm);
    },
    isArmed(): boolean {
      return armed;
    },
    one(): void {
      const { renderer } = ctx;
      const gl = renderer.getContext();
      // The sim keeps stepping through a loss (section 10.2), so a batch can reach this with nothing to wait for.
      if (gl.isContextLost()) return;
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
    },
    full(): Uint8Array {
      requireArmed();
      const { renderer } = ctx;
      renderer.setRenderTarget(null);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const out = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    },
    fullInto(out: Uint8Array, offset: number): void {
      requireArmed();
      const { renderer } = ctx;
      renderer.setRenderTarget(null);
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out, offset);
    },
    width(): number {
      return ctx.renderer.getContext().drawingBufferWidth;
    },
    height(): number {
      return ctx.renderer.getContext().drawingBufferHeight;
    },
  };
}
