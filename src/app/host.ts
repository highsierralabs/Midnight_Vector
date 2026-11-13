// HarnessHost over the live app (plan section 4, section 8.1). Created once, after boot and one real frame. Its fields
// are the real objects, unfrozen, so T09's instrument can wrap their methods.
import { PALETTE_FLOATS, type Governor, type HarnessHost, type PostStack, type RenderContext, type RenderLayer, type Sim } from '../contracts/index';
import { writePalette } from '../world/palettes';
import type { Loop, Overrides } from './loop';

export interface HostApp {
  readonly sim: Sim;
  readonly ctx: RenderContext;
  readonly layers: readonly RenderLayer[];
  readonly post: PostStack;
  readonly loop: Loop;
  readonly overrides: Overrides;
  governor(): Governor;
}

export function createHost(app: HostApp): HarnessHost {
  const o = app.overrides;
  const floats = new Float32Array(PALETTE_FLOATS);
  return {
    sim: app.sim,
    ctx: app.ctx,
    layers: app.layers,
    post: app.post,
    get governor() { return app.governor(); },
    setManual(on) { app.loop.setManual(on); },
    runFrame(dt) { app.loop.runFrame(dt); },
    renderState(chunk, local, tick) { app.loop.renderState(chunk, local, tick); },
    overrideZone(z) {
      if (z === null) {
        o.zone = null;
        return;
      }
      writePalette(z.palette, floats);
      o.zone = { palette: z.palette, biome: z.biome, hero: z.hero, floats };
    },
    overrideBend(b) { o.bend = b === null ? null : { a: b.a, c: b.c }; },
    overrideFov(deg) { o.fov = deg; },
    overrideFeel(f) { o.feel = f === null ? null : { ...f }; },
    overrideCam(m) { o.cam = m; },
  };
}
