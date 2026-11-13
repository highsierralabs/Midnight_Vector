// The composition root's boot sequence, plan section 5 M3, steps 1 to 15 in this order. The only file that names the
// concrete factories (section 3.2).
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import {
  CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR,
  type ControlFrame, type Governor, type RenderContext, type RenderLayer, type Tier,
} from '../contracts/index';
import { createNeutralFeel } from '../core/alloc';
import { createSharedUniforms } from '../core/uniforms';
import { createAudio } from '../audio/index';
import { createFeel } from '../feel/index';
import { createInput } from '../input/index';
import { createFxLayer, createGovernor, createPost } from '../render/fx/index';
import { createPropsLayer } from '../render/props/index';
import { createSkyLayer } from '../render/sky/index';
import { createTerrainLayer } from '../render/terrain/index';
import { createSim } from '../sim/index';
import { createUi } from '../ui/index';
import { createWorld } from '../world/index';
import { measureBootP95 } from './bootTiming';
import { createCamState } from './cam';
import { createCommands } from './commands';
import { createHost } from './host';
import { createLifecycle, type LifecycleApp } from './lifecycle';
import { createCounters, createFlags, createLoop, createOverrides } from './loop';
import { parseParams } from './params';
import { SOFTWARE_RENDERER, createRendererOn, readRendererString } from './renderer';
import { aspectOf, createSizing } from './sizing';
import type { AppTestHook } from './testHook';
import { createAppView } from './view';

export interface BootOptions { canvas: HTMLCanvasElement; stage: HTMLElement; uiRoot: HTMLElement; search: string }

export async function bootApp(o: BootOptions): Promise<void> {
  const root = document.documentElement;
  const canvas = o.canvas;

  // 1. Pure objects. view.quality is a tier-3 placeholder until step 6.
  const params = parseParams(o.search);
  const world = createWorld({ seed: params.seed, periodChunks: params.period });
  const sim = createSim(world);
  const feel = createFeel();
  const input = createInput();
  const audio = createAudio();
  const ui = createUi();
  const control: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
  const neutralFeel = createNeutralFeel();
  let bootGovernor: Governor = createGovernor({ software: false, bootP95Ms: 0, forced: 3 });
  const view = createAppView(sim.state, sim.events, feel.out, bootGovernor.profile);
  let governor: Governor | null = null;
  const cam = createCamState();
  const commands = createCommands({ sim, audio, view, cam, governor: () => governor });
  const flags = createFlags();
  const counters = createCounters();
  const overrides = createOverrides();
  const app: LifecycleApp = { canvas, root, ui, audio, input, flags, counters, post: null, loop: null };
  const lifecycle = createLifecycle(app);

  // 2. The title shows over the poster from here. setQuality is buffered; setVolume and setReducedMotion apply.
  ui.mount(o.uiRoot, commands);

  try {
    // 3. The renderer, on the pre-checked canvas.
    let renderer: WebGLRenderer;
    try {
      renderer = createRendererOn(canvas, (log) => {
        // The handler replaces three's console.error, so a console listener must still see the failure.
        console.error('SHADER_ERROR', log);
        lifecycle.onFatal('shader-error', log);
      });
    } catch (e) {
      lifecycle.onFatal('no-webgl2', e);
      return;
    }
    renderer.info.autoReset = false;
    const gl = renderer.getContext();

    // 4. Software detection from the unmasked string.
    const rendererString = readRendererString(gl);
    const software = SOFTWARE_RENDERER.test(rendererString);
    const depthBits = Number(gl.getParameter(gl.DEPTH_BITS));

    // 5. Scene, camera, context, then the listeners, after three's own.
    const scene = new Scene();
    const camera = new PerspectiveCamera(CAMERA_FOV, aspectOf(o.stage), CAMERA_NEAR, CAMERA_FAR);
    const shared = createSharedUniforms();
    const ctx: RenderContext = { renderer, scene, camera, shared, world };
    lifecycle.wire();
    input.attach(canvas);

    // 6. The boot profile. Timing runs at tier 3 on a visible, hardware, unforced boot.
    const buffered = commands.buffered;
    const forcedTier: Tier | null = params.tier ?? (typeof buffered === 'number' ? buffered : null);
    const timing = !software && params.tier === null && !document.hidden;
    if (!timing) bootGovernor = createGovernor({ software, bootP95Ms: 0, forced: forcedTier });
    const bootProfile = bootGovernor.profile;
    view.quality = bootProfile;

    // The loop exists before attach so step 7 can use its helpers; nothing in a factory touches GL.
    const layers: RenderLayer[] = [createSkyLayer(), createTerrainLayer(), createPropsLayer(), createFxLayer()];
    const post = createPost();
    const sizing = createSizing(o.stage);
    let firstFrameMs = 0;
    let measuredP95Ms = 0;
    const loop = createLoop({
      raf: (cb) => requestAnimationFrame(cb),
      caf: (h) => { cancelAnimationFrame(h); },
      input, sim, world, feel, neutralFeel, layers, post, ui, audio, renderer, camera, shared, sizing, view, control, cam,
      flags, overrides, counters,
      governor: () => governor ?? bootGovernor,
      onFatal: lifecycle.onFatal,
      onFirstFrame: () => {
        root.dataset['mvBoot'] = 'running';
        firstFrameMs = performance.now();
        if (params.harness) void installHarness();
      },
    });
    app.post = post;
    app.loop = loop;

    // 7. Steps 5 to 9 with dt 0, so shared uniforms and the camera are valid before anything draws.
    loop.prepare();

    // 8. Attach in array order, then post, then size.
    for (const layer of layers) {
      layer.attach(ctx);
      layer.setQuality(bootProfile);
    }
    post.attach(ctx);
    post.setQuality(bootProfile);
    if (sizing.applyIfDirty(camera, post)) counters.resizes += 1;

    // 9. Every program, behind the title.
    if (flags.contextOk) await post.precompile();
    if (lifecycle.dead) return;

    // 10. The first rebuild, before any frame.
    if (flags.contextOk) loop.rebuildAll();

    // 11. Boot timing at tier 3, synced by a 1x1 readPixels (section 11.4).
    if (timing && flags.contextOk) {
      const px = new Uint8Array(4);
      measuredP95Ms = measureBootP95(
        () => {
          renderer.info.reset();
          for (const layer of layers) layer.frame(view);
          post.frame(view);
          post.render(0);
        },
        () => {
          renderer.setRenderTarget(null);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        },
        () => performance.now(),
      );
    }

    // 12. The final governor. From here setQuality calls force.
    const finalBuffered = commands.buffered;
    governor = createGovernor({ software, bootP95Ms: measuredP95Ms, forced: params.tier ?? (typeof finalBuffered === 'number' ? finalBuffered : null) });

    // 13. A changed profile applies now, and a rebuild snaps T03's and T05's ramps.
    const changed = governor.profile.tier !== bootProfile.tier;
    if (changed) {
      if (flags.contextOk) loop.applyQuality();
      else flags.tierHeld = true;
    }
    if (flags.contextOk && (timing || changed)) loop.rebuildAll();

    // 14. The loop. onFirstFrame hides the poster on the first frame that drew.
    loop.start();

    // 15. Under ?harness, after the first frame: host, harness, test hook, then MV_READY.
    async function installHarness(): Promise<void> {
      try {
        const [harness, hookModule] = await Promise.all([import('../harness/index'), import('./testHook')]);
        const host = createHost({ sim, ctx, layers, post, loop, overrides, governor: () => governor ?? bootGovernor });
        harness.createHarness(host);
        const hook: AppTestHook = {
          sim: sim.state,
          host,
          boot: { software, rendererString, measuredP95Ms, firstFrameMs, depthBits },
          counters,
          contextOk: () => flags.contextOk,
          camera: () => ({ fov: camera.fov, aspect: camera.aspect, gainX: sizing.gainX }),
          cam: () => ({ want: cam.want, mode: view.camMode, ahead: view.camAhead, cockpitIn: view.cockpitIn, camX: view.camX, camY: view.camY }),
          forceSignalLost: () => { sim.forceSignalLost(); },
          lastRawDt: () => loop.lastRawDt,
        };
        hookModule.installTestHook(hook);
        console.info('MV_READY');
      } catch (e) {
        console.error('HARNESS_FAILED', e);
      }
    }
  } catch (e) {
    // From ui.mount on, T08's title is live over the poster, so a boot failure takes the fatal route: its page covers the
    // title, the canvas goes, input detaches and audio is disposed (VI-r1). main.ts's poster copy is only for failures
    // before ui.mount, such as the app chunk failing to load. If the fatal route already ran, a later throw from the same
    // cause must not log over it.
    if (!lifecycle.dead) lifecycle.onFatal('runtime-error', e);
  }
}
