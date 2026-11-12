# Midnight Vector: architecture

Status: design frozen for implementation, 2026-11-04, with §8 amended at plan reconciliation, 2026-11-05, and the design issues the plans raised decided the same day in §3, §5 to §7 and §9 to §14. Every such decision and its reason is in [plans/RECONCILIATION.md](plans/RECONCILIATION.md). A decision there is not an observation: a tag such as [O: T04 rehearsal] below means a plan's throwaway probe saw it, as that plan reports. No project code exists yet.

Evidence tags, used wherever the difference matters:

| Tag | Meaning |
|---|---|
| [O] | Observed this session: run on this machine, or read in the installed source of the exact pinned version |
| [I] | Inferred from observed facts, not directly tested |
| [A] | Assumed starting value; only implementation or playtesting can confirm it |
| [M] | From memory, not checked against a source this session |

All GPU numbers come from one RTX 4070 SUPER plus SwiftShader. No mid-range GPU, integrated GPU or phone was available, so R6 is a target with a proxy gate, not a measured result. The spikes behind the [O] numbers were throwaway JavaScript in a session scratchpad and are not part of this project. The code that matters from them is reproduced below.

## 1. Overview

Midnight Vector is a static website and an endless arcade game. You fly a low hover-delta down a neon valley toward a banded sun that never moves on screen. Mountains, palms, arcologies, chrome orbs, saucers and searchlights stream past. Every 80 seconds or so the palette, the biome, the objective and the music key change.

The world cannot be stopped. There is no game over and no pause that freezes motion. A title screen, a pause menu and a "signal lost" state all sit on top of a world that keeps moving.

With no input at all, an autopilot flies the same simulation under the title screen, so the page works as a screensaver. The first gesture launches a run and unlocks audio. You collect shards, thread gates on the beat to raise the SYNC multiplier, graze hazards for bonus, and spend overdrive on boost. Hitting things costs score momentum, never the run.

Requirements referred to throughout:

| Id | Requirement |
|---|---|
| R1 | **Forever.** The camera never stops moving forward and stays correct after hours; testable by warping to at least 1e9 u; no absolute coordinate reaches a GLSL float |
| R2 | **Beautiful.** Unmistakably 80s synthwave, from custom GLSL and post-processing, with no wash-out, moire, banding or shimmer |
| R3 | **Full of stuff.** Many distinct object types, dense, deterministic per chunk, evolving over distance |
| R4 | **A kind of video game.** Input, goals, score, HUD, title, game feel, yet beautiful and moving with zero input |
| R5 | **A website.** Static, responsive, touch, WebGL2 fallback, context loss, reduced motion, hidden tabs, audio only after a gesture, no runtime network dependency, all art procedural |
| R6 | **Performance.** 60 fps at 1080p on a mid-range GPU, adaptive quality, no per-frame allocation in hot paths, stable memory |
| R7 | **Independent tasks.** Parallel work with disjoint file ownership against frozen contracts |

## 2. Tech stack

Pin exact versions in `package.json`, with no `^` or `~`. Versions marked [O] were installed and resolved together this session.

| Item | Pin | Why | Rejected alternatives |
|---|---|---|---|
| Language | TypeScript **6.0.3** [O], GLSL ES 3.00 | Strict types are what make parallel work against frozen contracts safe | **TypeScript 7.0.2**: `typescript-eslint` 8.72.1 peers `<6.1.0`, so npm fails with ERESOLVE [O] |
| 3D engine | `three` **0.187.0** [O] | Instancing, `ShaderMaterial`, `DataTexture`, partial uploads, context-loss handling; the source is readable | **WebGPU/TSL**: `postprocessing` is WebGLRenderer-only, and WebGL2 reaches more devices today. **Babylon.js**: no advantage, and all evidence here is on three. **Raw WebGL2**: rebuilds what three already gives |
| Types | `@types/three` **0.187.0** [O] | Matches the engine | |
| Post | `postprocessing` **6.39.6** [O] | Merged HDR effect passes, mipmap bloom, MSAA on half-float targets | three's built-in `renderer.setEffects` pipeline: less evidence, no effect merging. three's `examples/jsm` composer: one fullscreen pass per effect, more draws. **SMAA**: see §6.6 |
| Build | `vite` **8.3.5** [O] | `?raw` GLSL with no plugin, `base:'./'` static output, fast dev server | Webpack and Parcel: nothing gained. `vite-plugin-glsl`: `?raw` plus string concatenation is enough [O] |
| Unit tests | `vitest` **5.1.0** [O] | Runs in `node`, so pure modules are tested with no browser | jsdom and happy-dom: not needed, since DOM behaviour is tested in Playwright |
| Browser tests | `playwright` **1.64.1** [O], import from `playwright/test` | Real-GPU and SwiftShader screenshots, `hasTouch`, media emulation, CDP heap sampling | `@playwright/test` as a separate dependency: not needed [O] |
| Lint | `eslint` **10.14.0**, `typescript-eslint` **8.72.1** [O] | Per-directory `no-restricted-imports` enforces module boundaries | |
| Node types | `@types/node` **24.19.2** [O: latest 24.x, matching Node 24] | Only for `tests/**` and config files | |
| Tooling runtime | Node 24.14.1, npm 11.11.0 [O] | Vitest 5.1.0 accepts Node 22.12+, 24 or 26+, and Vite 8.3.5 accepts 20.19+ or 22.12+ [O: `engines`] | |

Deliberately **not** used:

| Library | Why rejected |
|---|---|
| `simplex-noise` 4.0.3 | `Math.floor(x)\|0` makes it return exactly 0 past input of about 1.57e9 [O: three independent runs]. Replaced by 40 lines of lattice noise (§4.4) |
| `stats-gl` | Not needed: the harness and governor own their timers. Also absent from the reference install [O] |
| React Three Fiber | A per-frame React layer adds allocation and an extra owner for scene state, and it solves no problem here. The HUD is plain DOM |
| Web Worker for generation | Height generation costs under 1 ms per frame on the main thread [O], and a worker adds late rows and ordering problems (§13) |

Compatibility constraints:

- `postprocessing` 6.39.6 peers `three >=0.168.0 <0.188.0`. **Do not move three to 0.188 or later** without a replacement post stack.
- `typescript-eslint` 8.72.1 peers `typescript >=4.8.4 <6.1.0`. TypeScript stays on 6.0.3.
- `npm audit` reports a moderate `minimatch` advisory, reached only through the eslint toolchain and never shipped. **Do not run `npm audit fix --force`**: it downgrades eslint to 9.39.5 [O].
- Playwright 1.64.1 wants chromium revision 1248, which is not cached here; revision 1234 is. Tests use discovery (§11.1), never `npx playwright install` as a side effect.
- Vite 8 replaces `rollupOptions` with `rolldownOptions` and `esbuild` with `oxc`. The old names survive in 8.3.5's types only as `@deprecated` aliases [O]. Use the new names; most blog-era config snippets are stale [from the migration guide].

**Runtime dependencies are exactly two:** `three` and `postprocessing`. Everything else is dev-only. No fonts, images or audio files ship; all art is procedural.

## 3. System design

### 3.1 Module map

```
terrain/
  architecture.md  Agents.md  plans/
  index.html                  T10  fallback poster, boot script
  package.json tsconfig.json vite.config.ts vitest.config.ts
  playwright.config.ts eslint.config.js     T00
  scripts/                    T00  GLSL grep gate, plan overlap check
  src/
    contracts/                T00  index.ts (types, constants), glsl.ts, glsl/*.glsl
    core/                     T00  coords.ts, hash.ts, motion.ts, uniforms.ts, alloc.ts       pure
    testing/                  T00  fakeWorld.ts, scriptedFrame.ts, fakeHost.ts, devShell.ts, devPost.ts, index.ts
    world/                    T01  noise, height, zones, palettes, biomes, scatter, items   no three, no DOM
    sim/                      T02  rules, collision, autopilot, objectives                  no three, no DOM
    feel/                     T02  events to FeelState                                      no three, no DOM
    render/terrain/           T03  clipmap, atlas, floor shader
    render/sky/               T04  sky, stars, nebula, hero disc
    render/props/             T05  builders, neon material, FIFO rings, items, ship
    render/fx/                T06  composer, Crt effect, speed lines, quality table, governor
    audio/                    T07  graph, composer, scheduler                               no three
    ui/ input/                T08  HUD, title, menus, fallback text, controls               no three
    harness/                  T09  window.__mv API, test modes, metrics
    app/ main.ts              T10  composition root, loop, lifecycle
  dev/<module>.html           owned by that module's task
  tests/
    support/ boundaries/      T00
    unit/<module>/            owned by that module's task
    visual/<module>.spec.ts   owned by that module's task
    forever/ perf/            T09
    e2e/                      T10
    art/                      T11
```

### 3.2 Dependency direction

```
contracts  <-  core  <-  every other module
testing    ->  contracts, core          (imported only by dev/ and tests/)
app        ->  everything               (only app may import implementations)
```

- Sibling modules never import each other. `world`, `sim`, `render/*`, `audio`, `ui`, `input` and `harness` see each other only through `contracts`.
- `sim` receives `WorldSource` by injection. The composition root in `app/` is the only file that names concrete factories.
- `render/*` may import `three` and `postprocessing`. `world`, `sim`, `feel`, `core`, `audio`, `ui` and `input` may not.
- `testing` may import both, except `fakeWorld` and `scriptedFrame`, which T07's and T08's three-free pages import directly: `startDevShell` has to build a `RenderContext`. `harness` may import `three` but not `postprocessing`, which it reaches through `PostStack`. `app` may import both.
- Enforced by per-directory `no-restricted-imports`. `tests/boundaries/` holds a fixture that proves the rule fails on a forbidden import.

### 3.3 Frame loop, exact order

One `requestAnimationFrame` callback in `app/loop.ts`, timed by the rAF timestamp. `THREE.Clock` is banned: it is deprecated and warns at construction [O]. Nothing in the loop allocates, apart from three's own internals.

```
onFrame(nowMs):
  0  requestAnimationFrame(onFrame)      // re-armed first; the rest runs inside one try/catch
  1  rawDt = (nowMs - lastMs) / 1000; lastMs = nowMs; dt = min(rawDt, 0.25)
  2  pendingTier = governor.sample(rawDt * 1000)
  3  input.sample(control)
  4  acc += dt; while (acc >= 1/120) { sim.step(control); acc -= 1/120 }     // at most 30 steps
  5  alpha = acc * 120
     copy sim.state.travel into view.cam; advance(view.cam, -(1 - alpha) * state.stepDist)
     view.camX, view.camY = lerp(prev, cur, alpha) * follow gains
  6  for each phase i: view.phases[i] = ((tick % PERIOD[i]) + alpha) / PERIOD[i]
  7  world.zoneAt(view.cam, zone); world.bendAt(view.cam, bend)
  8  feel.update(dt, state, events, reducedMotion)
  9  writeSharedUniforms(view, shared); set camera position, fov (§6.4 cap) and roll; camera.updateMatrixWorld()
 10  if (contextOk && state.warpSerial changed) { every layer.rebuild(view); post.rebuild() }
 11  if (contextOk) { sky.frame(view); terrain.frame(view); props.frame(view); fx.frame(view) }   // streaming is bounded here
 12  if (contextOk) { post.frame(view); post.render(dt) }
 13  ui.frame(view); audio.frame(view)
 14  events.count = 0
 15  if pendingTier is set: setQuality on layers and post; held while the context is lost     // at most one change; post applies its size at the next frame
```

`sim.step` is called unconditionally. No mode, menu or overlay can skip step 4, which makes R1 a structural property while the page runs. rAF is re-armed before anything else, and a `catch` around steps 1 to 15 routes to the fatal page, so an exception in a layer cannot silently end the loop.

Motion stops in exactly three cases, none of them a game state: the browser halts rAF in a hidden tab (§10.4), a fatal page has replaced the canvas (§10.1, §10.2), or a test called `manual(true)` under `?harness` (§11.3).

Layers are skipped while the context is lost, because `addUpdateRange` only accumulates until an upload clears it [O], and the restore path rebuilds from pure state anyway (§10.2).

`HarnessHost.runFrame` and `renderState` run this body with `governor.sample(0)` in step 2, and `renderState` skips steps 3, 4 and 8 (§8.1).

Step 5's camera interpolates between ticks T-1 and T, and step 6's phases between T and T+1, so a moving item is drawn up to one tick ahead of its collision position: at most .42 u at the drone cap in §5.8, under the ship's 1.6 u radius [arithmetic]. Accepted. If it ever matters, step 6 could use `tick - 1 + alpha`.

### 3.4 Data flow

```
input -> ControlFrame -> sim.step -> SimState + EventBuffer
                           ^                    |
            WorldSource ---+                    v
            (pure functions)      app builds one FrameView, mutated in place each frame
                 |                              |
                 +-- height, props, items -->   +--> render layers -> SharedUniforms -> GPU
                                                +--> feel -> FeelState (cosmetic only)
                                                +--> audio (sim.beat is the clock)
                                                +--> ui (writes the DOM only on change)
```

Data flows one way. Audio and UI never write to the sim, except UI commands through `UiCommands`, which `app/` routes to `sim.command`.

## 4. Coordinates and precision

### 4.1 Spaces

| Space | Type | Range | Used by |
|---|---|---|---|
| Travel `{chunk, local}` | two doubles | `chunk` integer-valued in `[0, CHUNK_LIMIT)`, just under 2^48; `local` in `[0, 64)` | Sim, camera, all streaming |
| Lattice row `iz` | integer-valued double | `< 2^53` | Height function |
| Render space | float32 in GLSL and attributes | Camera at z = 0 always; world moves. Magnitudes up to about 6100 u | Every vertex shader |
| Instance row | float32 | Chunk mod 65536, exact | Prop rings |
| Travel phases | float32 | `uTravel.x` in `[0, 64)`, `uTravel.y` in `[0, 4096)` | Grid and pulses |
| Time phases | float32 | `[0, 1)` | All animation |

Scale: 1 u = 1 m. Forward is -z in render space. `CHUNK_LEN = 64 u`.

**There is no floating origin to rebase.** The camera stays at z = 0 and the only subtraction of positions is `between(a, b) = (a.chunk - b.chunk) * 64 + (a.local - b.local)`, in `core/coords.ts`. The integer difference is exact and the result is small. No absolute coordinate ever reaches a float32 or GLSL.

### 4.2 The arithmetic

| Quantity | Value | Consequence |
|---|---|---|
| float32 ulp at 1e9 | 64 u [O] | One absolute coordinate in GLSL would destroy the frame |
| double ulp at 1e9, 1e15, 2^53 | 1.2e-7, 0.125, 2 [O] | A plain double fails around 1e15 at a 0.5 u frame step, hence `{chunk, local}` |
| `local` ulp in `[0, 64)` | 2^-47 = 7.1e-15 u [arithmetic] | Constant at any distance |
| World limit | `chunk < CHUNK_LIMIT = 2^48 - 1024`, so 1.8e16 u; 3.8 million years at 150 u/s [arithmetic] | Warp must refuse beyond this: past it, row increments are lost, and a spike tab crashed [O]. The headroom exists because level-0 rows ahead of the camera pass 2^53 from chunk 2^48 - 3 [O] |
| Render-space ulp at 4096 to 8192 u | 4.9e-4 u [arithmetic] | At 6000 u one pixel spans 6.2 u (1080p, 58 deg), so the error is about 8e-5 px |
| Grid uv | `(forward + uTravel.x) / 8` at most 760 | Below 2^10; an offset of 2^10 gave mean error 0.02/255, while 2^20 gave 14.75/255 [O] |
| Pulse coordinate | `forward + uTravel.y` at most 10112 | ulp 9.8e-4 u, fine for a 512 u period [arithmetic] |
| Depth, 24-bit, near = 1 | 0.016 u at 512 u, 0.54 u at 3000 u, 1.1 u at 4300 u [arithmetic]. 24-bit because three picks `DEPTH_COMPONENT24` with no depth texture [O] | Far terrain overlap drops exceed this (§6.4) |
| Instance row | `mod(aRow - uCamRow + 32768., 65536.) - 32768.` | 0 mismatches in 2e6 float32 simulations in JS [O]. GPU path covered by the identity test |
| `tick` | double, integer-valued, 120 per second | Reaches 2^53 after 2.4 million years |

### 4.3 The T = 4096 rule

Every world-anchored pattern a shader can see must have a period dividing `WORLD_PERIOD = 4096 u`. Grid lines: 8 and 64. Road dashes: 16. Pulses: 512. Ripple: `4096/k` for integer `k`.

JS uploads `uTravel = (local, ((chunk mod 64) * 64) + local)` computed from exact integers. Shaders add the forward distance to the phase, so derivatives stay continuous and nothing jumps at a wrap. The result can be pixel-identical at any distance, and the test checks exactly that (§11.3).

### 4.4 Noise at huge distance

Lattice gradient noise, split into integer cell plus fraction, power-of-two wavelengths only. The hash takes the high and low 32 bits of the cell, so it is exact up to 2^53. This is the code the identity test ran [O], reproduced for T01:

```js
// world z = iz * zs + zLocal; integer iz; zs and wl are powers of two
function oct(x, iz, zs, zLocal, wl) {
  let zc, fz;
  if (wl >= zs) { const ra = wl / zs, q = Math.floor(iz / ra), rem = iz - q * ra;
    const fr = (rem * zs + zLocal) / wl, fl = Math.floor(fr); zc = q + fl; fz = fr - fl; }
  else { const ra = zs / wl, fr = zLocal / wl, fl = Math.floor(fr); zc = iz * ra + fl; fz = fr - fl; }
  const xf = x / wl, xc = Math.floor(xf);
  if (period > 0) { const P = period * 64 / wl; zc = ((zc % P) + P) % P; return gradP(xc, xf - xc, zc, fz, P); }   // periodChunks, §5.1
  return gradP(xc, xf - xc, zc, fz, 0);
}
// Quintic fade and no extra scaling: the statistics in §5.2 and §5.7 depend on this amplitude.
function gradP(ix, fx, iz, fz, P) {
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const z1 = P > 0 ? (iz + 1) % P : iz + 1;
  const a = hsh(ix, iz), b = hsh(ix + 1, iz), c = hsh(ix, z1), d = hsh(ix + 1, z1);
  const n00 = GX[a] * fx + GZ[a] * fz, n10 = GX[b] * (fx - 1) + GZ[b] * fz;
  const n01 = GX[c] * fx + GZ[c] * (fz - 1), n11 = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const k0 = n00 + (n10 - n00) * u, k1 = n01 + (n11 - n01) * u; return k0 + (k1 - k0) * v;
}
// GX, GZ: 256 unit vectors (cos t, sin t), t uniform from a PRNG, built once. T01 seeds it from the world seed.
function hsh(ix, iz) { const lo = (iz % 4294967296) | 0, hi = Math.floor(iz / 4294967296) | 0;
  let m = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA77) ^ Math.imul(ix, 0xC2B2AE3D);
  m ^= m >>> 15; m = Math.imul(m, 0x2C1B3C6D); m ^= m >>> 13; return m & 255; }
```

Measured: 0.17 us per sample of the full height function in Node on the Ryzen 3900X, or 0.022 ms per 129-column row [O]. A 1e9 warp alone would not catch a flat-noise bug in low octaves, because `simplex-noise` at wavelength 32 goes flat only at about 5e10 u. So `tests/unit/world` asserts non-flat output at 1e9, 1e12 and 1e15.

### 4.5 Time

There is no `uTime` anywhere. Phases are a pure function of the sim tick:

```ts
PHASE_PERIOD_TICKS = [72, 288, 1152, 120, 480, 1920, 7680, 30720]   // 0.6, 2.4, 9.6, 1, 4, 16, 64, 256 s
phase[i] = ((tick % P[i]) + alpha) / P[i]
```

The first three are beat, bar and phrase at 100 BPM. No accumulator exists, so no drift can exist, and setting `tick` reproduces a frame exactly. Shaders may use only integer harmonics of a phase (`fract(phaseAt(7) * 16. + seed)`), so wraps cannot pop.

**postprocessing trap:** `EffectPass` does `material.time += deltaTime * timeScale` at build line 15685, and `maxTime` is assigned at 15535 and read nowhere [O]. So set `pass.timeScale = 0` on every pass; `material.time` then held at 0 through 50 renders with merged effects [O]. `NoiseEffect` uses `rand(uv * (1.0 + time))`. A CPU simulation predicted its grain would collapse over hours, but a real-GPU run showed 256 levels at every t up to 30 days [O], so decay is **not** a reason to drop it. It is dropped because the custom Crt effect already supplies grain (§6.6).

A gate greps every `.glsl` file and inline shader for `uTime`, `cameraPosition.z` and `modelMatrix`.

## 5. World generation

### 5.1 Determinism model

The world is a set of pure functions of `(seed, chunk)`. There is no generation state, no visit-order dependence and no cache that could change a result. `WorldSource` is the only entry point, and everything takes a caller-owned `out` object, so calls allocate nothing.

`?seed=<int>` overrides `DEFAULT_SEED`, which is `155` (CCR-T11-5, DI-102: Sunset Drive / Boulevard / banded sun, continuous with the poster; it started at `1985`, which opens on Ultraviolet at deepest night). Fake worlds keep `FAKE_SEED = 1985` and T11's art suite `ART_SEED = 1985`, so every baseline calibrated on them stands. Harness mode passes `periodChunks = 1024` unless `?period=<n>` says otherwise (§8.1), and every function of `chunk` then reduces it mod 1024 first. That covers hash keys, zone index, day phase and landmarks, since 100, 750 and 48 do not divide 1024 and wrapping hash keys alone would not repeat them. Noise wraps per octave (§4.4). The world then repeats exactly, which makes pixel identity testable [O: 0 height mismatches in 10,000 samples, up to k = 2^37 periods]. Because 100 does not divide 1024, zone 10 lasts 24 chunks and then jumps to zone 0 with no fade, a visible step in height and lanes at each wrap. That is accepted as harness-only, and no picture is judged across a wrap. Cross-browser bit-exactness is not a goal: `Math.sin` may differ between engines [M], and golden hashes are per-engine.

### 5.2 Height function

Single source of truth, computed in doubles on the CPU. The GPU only reads results.

```ts
function height(x, iz, zs, zLocal) {
  const d = Math.abs(x), k = smooth((d - 85) / riseWidth);     // riseWidth 430, by biome
  if (k === 0) return 0;                                       // valley floor is EXACTLY y = 0
  let a = 1, wl = 512, v = 0, w = 0;
  for (let o = 0; o < 5; o++) {
    const n = 1 - Math.abs(oct(x + 37, iz, zs, zLocal, wl)) * 1.6;
    v += a * n * n; w += a; a *= 0.52; wl /= 2;
  }
  return k * (v / w) * (135 + 250 * smooth((d - 260) / 1100)); // amplitudes by biome
}
```

This is the art prototype's envelope on the lattice noise. Measured statistics for this exact function, 20,000 samples per column [O]:

| abs(x) | 150 | 300 | 515 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|---|
| height p50 | 4.3 | 34 | 102 | 208 | 251 | 227 |
| height p95 | 6.4 | 52 | 135 | 279 | 336 | 308 |
| p95 / abs(x) | .04 | .17 | .26 | .28 | .17 | .08 |

The envelope peaks at about h = 0.28 |x|. That gives the mountains the V-notch around the sun (§6.1), and it is what the object keep-out rule is derived from (§5.6). It is by design: mountains rise slowly enough to frame the sun and never crowd it.

Biome parameters (`riseWidth`, amplitudes, gain) are crossfaded as a pure function of the row's exact z, so height stays continuous across zones and across chunks. Evaluate the biome mix once per row, not per sample. Stepping it per chunk instead left a faint ridge every 64 u: the mean row step on chunk-edge rows read 2.16 times other rows in a Boulevard to Canyon fade, against 1.02 when continuous in z, and the worst step could not tell them apart (12.05 against 12.00) [O: T01 rehearsal].

### 5.3 Road and corridor

| Band | abs(x) | Contents |
|---|---|---|
| Road | up to 22 | Filtered edge lines, dashes every 16 u, reduced grid |
| Play window | up to 40, y from 2 to 14 [A] | Player and items. Collision tests items only, never terrain |
| Valley floor | up to 85 | Exactly y = 0; mirror reflections live here |
| Shoulder | 44 to 85 | Palms, posts, chevrons, signs |
| Rise | 85 to 520 | Most scenery, grounded (§5.7) |
| Upper slope | 520 to 1040 | Floating objects only. Terrain alone reaches the keep-out limit here (§5.6), so grounded objects have no room |
| Far | above 1040 | Tall grounded scenery, beyond the keep-out |

The world is straight in `(x, chunk)`. Curves are a vertex-shader bend (§6.1) driven by `world.bendAt`, a pure sum of two sines on exact `travelMod` values with periods of 16384 and 65536 u: `a = 8e-5 * (0.7 sin + 0.3 sin)`, `c = -1.2e-5` constant (negative lowers far geometry), `vMax = 1500` [A]. One test frame at `a = 8e-5, c = -1.2e-5` kept verticals vertical [O]. The sim knows nothing about the bend. At 100 u ahead the shift is only 0.8 u, so play is not visibly false [arithmetic].

### 5.4 Zones and evolution

| Layer | Period | Effect |
|---|---|---|
| Zone | 100 chunks = 6,400 u, 80 s at cruise | Palette, biome, objective, music key |
| Crossfade | Last 25 chunks = 1,600 u, 20 s at cruise | Palette in OKLCh on the CPU, by shortest hue (§6.8); biome by spawn probability per row |
| Hero disc | By zone | Banded sun, eclipse corona, ringed planet, wire moon, always at the same position |
| Day phase | 750 chunks = 48 km | Exposure, in post, so sky, fog and props move together (T06). Star, nebula, aurora and meteor intensity (T04) |
| Sky events | By zone | Meteors, aurora (Orbital Night), lightning (Cyber Canyon) |
| Landmarks | 48 chunks = 3,072 u | 200 u ring that frames the sun and is flown through |
| Difficulty | By zone, capped at zone 12 [A] | Hazard density |

Selection: `index = floor(chunk / 100)`, then a hashed permutation of six per block of six zones. The first entry is swapped with the second if it would repeat the previous block's last entry, using raw (unswapped) permutations so the repair stays pure. Palette and biome use independent permutations, giving 36 combinations.

Biomes and their signature archetypes (spawn weights are T01's, tuned at T11):

| Biome | Terrain | Scenery |
|---|---|---|
| Boulevard | Default | Palms, reflectors, chevrons, billboards, traffic |
| Neon City | Default, lower | Arcologies, billboards, searchlights, obelisks, pylons |
| Crystal Desert | Lower, wider | Pyramids, crystals, cacti, obelisks |
| Cyber Canyon | `riseWidth` 180, high walls | Pylons, turbines, dishes, cassette slabs. Exempt from the V rule, reviewed by contact sheet |
| Orbital Night | Default | Saucers, dishes, domes, orbs |
| Olympus | Default | Colonnades, orbs, totems |

Rejected: drifting the sun's height with the day phase. It would break the composition invariant.

Rejected: day-phase sky saturation. A sky-only change breaks fog's match to the sky (§8.2), and full-frame saturation works against the chroma gate: Toxic Arcade read 64.6 at exposure 1, 61.8 at exposure .88, 55.5 at saturation .95 and 50.3 at .90 [O: T06 probe].

### 5.5 Scatter

`fillProps(chunk, out)` writes up to `MAX_PROPS_PER_CHUNK` prop records, sorted by archetype, into a caller-owned row. Placement is a pure function of `(seed, chunk, archetype, i)`, using `hash01` from `core/hash.ts`. Rows are 64 u long, one per chunk. Records are row-local floats only.

| Record field | Meaning |
|---|---|
| `x, y, zLocal` | Lateral, ground, position inside the chunk |
| `yaw, scale` | Transform; rotation computed in the vertex shader |
| `keep` | In `[0,1)`; the shader collapses the instance if its ring keep (§6.5, `keep` or a little higher) is at or above `uDensity`, so a density ramp needs no CPU writes |
| `tintSeed, variant` | Palette accent choice and per-archetype variation |

### 5.6 Sun keep-out

An object inside the sun's lateral cone must stay below the disc's lower part. An object at lateral `u` and top height `h` enters the cone (gnomonic |x| = C = 0.24) at distance `v = |u| / C`, where its gnomonic height is `h / v = h C / |u|`. That is largest at the moment it enters, so a static test is enough:

```
h <= |u| * K / C,  with K = 0.05  =>  h <= |u| / 4.8     when |u| < C * FOG_END = 1032
```

Scatter scales a candidate down to fit, then rejects it if the scale would drop below 0.5. The art proposal's K = 0.02 gives h <= |u| / 12, which is stricter than the terrain itself (0.24 * 0.28 = K of about 0.067) and would forbid tall towers near the road, so K = 0.05 [A]. Exempt: floating objects, landmark rings, Cyber Canyon. The prototype defect "towers crowd the sun's lower third" [O] is what this prevents. The rule has not been rendered; T05 and T11 check it with a disc-occlusion metric (§11.5).

`h` is the world height of the top, terrain included (`y + top * scale`), so the rule is tighter than it reads. Room is `|u| / 4.8` minus the ground: on default terrain at p50, 27, 29, 26, 18, 4, 29, 13 u at `|u|` 150, 200, 300, 400, 515, 700, 1000 [O: T01 rehearsal]. So near the road a tall tower is scaled to about 25 to 29 u, and between 500 and 1032 terrain alone reaches the limit (p95 / `|u|` is .27 against .208). Tall archetypes therefore get two bands: near and scaled down, or from 1040, just outside `C * FOG_END = 1032`, where the rule stops and they reach full size (§5.7 rule 4). A bare upper slope is the visible cost, against R3. The rule still does real work: with keep-out off, Neon City's disc occlusion rose from 5.8% to 24.3% in a CPU projection [O: T01 rehearsal]. `KEEPOUT_K` is in `src/world/biomes.ts`, and T11 may raise it toward the terrain's own .067 if real frames show bare slopes and room under the occlusion gate. T11's O1, D1 and D2 gates and the operator's Q4 settle it (§14 risk 12).

### 5.7 Grounding

The GPU surface differs from true height because coarse clipmap levels sag. Measured sag for this exact height function, 120,000 samples per cell [O]:

| Spacing s (visible from) | abs(x) 85-200: p95 / max | 200-500: p95 / max | 500-1400: p95 / max |
|---|---|---|---|
| 2 (0 u) | 0.01 / 0.2 | 0.13 / 1.5 | 0.4 / 4 |
| 8 (352 u) | 0.12 / 0.8 | 1.1 / 7.7 | 3.1 / 19 |
| 16 (736 u) | 0.32 / 1.7 | 2.6 / 17 | 7.5 / 33 |
| 32 (1504 u) | 0.76 / 2.5 | 5.7 / 25 | 16 / 63 |
| 64 (3008 u) | 1.7 / 5.7 | 11 / 46 | 31 / 100 |

Rules:

1. Inside the valley, y = 0 with no sink. Coarse-level valley sag near the boundary is at most 1.2 u, beyond 3 km [O].
2. Every grounded archetype mesh carries a buried root (`root` in `ARCHETYPE_SPEC`). Scatter sinks it by `min(p95 of the band at the object's maxDist, .3 * top * scale)`. Sinking by the p95 alone drowned small objects with long reach on steep terrain: in Cyber Canyon DISH placed .27 of its quota and CASSETTE .22, against .98 and .96 with the cap and the deeper roots [O: T01 rehearsal].
3. Sag gate at placement: evaluate the coarse surface `g` at the 3 surrounding lattice corners for the `maxDist` band, and reject the candidate if it would float (`h - g - sink > root * scale`) or be mostly buried (`g - y > .7 * top * scale`). Cost is 3 to 4 extra height samples, about 0.7 us [arithmetic]. Rehearsed on placement statistics by T01, not yet rendered with real meshes.
4. Above |x| = 520, only floating archetypes are placed, and from 1040 also tall grounded ones (h >= 40 u, root 20 u).

Rejected: per-vertex atlas planting. It adds several texture fetches per vertex, and SwiftShader runs show vertices dominating there [O].

### 5.8 Items

`fillItems(chunk, out)` is pure like scatter but cheap, and is called by both `sim` (it collides against home chunks `c - 2 .. c + 1` with `c = travel.chunk`, `ITEM_WINDOW_BEHIND` in §8.1) and `render/props` (out to 1600 u, the farthest item `maxDist` in §6.5). Moving items are pure functions of `(record, phase)` through `core/motion.ts`, with GLSL twins in `common.glsl` (§8.2):

- Traffic: `z += travel * fract(k * phase7 + seed)`, scale fading at both ends.
- Drone: `x += amp * sin(TAU * (k * phase3 + seed))`, with `amp` at most 8 u. `k` is an integer on a 1 s phase, so 1 Hz is the slowest swing, and peak speed is `2 pi * amp`, 50 u/s at 8 u [arithmetic].

Gates fall on chunk multiples of 3. At cruise (80 u/s, 100 BPM) one beat is 48 u, so a bar is 192 u = 3 chunks, and gates arrive on the beat [arithmetic]. Shards lie on a 12 u lattice, which is a sixteenth note at cruise.

The lane has a height as well as a lateral walk, so the path swoops (DI-118, the operator's feedback at T11's review). Each node draws its own height, even nodes in [8, 10) and odd nodes in [11, 13), so every gate is 1 to 5 u above or below the one before, 3 on average, as a pure function of the node. A gate stands at its node's height with radius 8 (it was 9 at a fixed y 8), with no legs: its inner rim is 0 to 5 u off the floor, so the high gates float and the low ones touch the road. Smaller rings would float higher but alias more: with the heights, T05's A16b read .222 at radius 6 against its .2 limit, and .184 at 8 [O: DI-118]. Shards follow the same height between nodes, eased as their x is. The floor of 8 is the old fixed height: traffic (y 2.5, radius 3) is cleared by height alone, so the straight path between nodes, in x and in height, still threads every gate and misses every hazard for a ship of radius 2. The checkpoint arch keeps y 8 and radius 42.

That holds only at normal cruise and only until the first speed change, because `beat` comes from `tick` and cannot shift. T02 re-locks: at normal cruise, not boosting and with no hit slowdown, a speed trim of up to 6% (4.8 u/s) closes the phase error, 24 u at worst, in about 6 s [arithmetic: T02]. So gates land on the beat at normal cruise after that re-lock. They do not during a boost, a hit's slowdown or under reduced motion, where a bar is not 192 u, and audio assumes no alignment (T07). The checkpoint arch (§7.1) sits at `chunk % 100 === 0`, off the 3-chunk grid and 1 or 2 chunks from a normal gate, so its flash may cut another short. Cosmetic and accepted.

## 6. Rendering design

### 6.1 Composition invariants

- **Camera:** y = 7, FOV 58 deg, pitch +0.05 rad, near 1, far 6200. No steady yaw: `feel.shakeX` is a small transient (§7.4), under 0.006 rad [A]. The horizon sits near row 590 of 1080 [O].
- **Hero disc:** always at gnomonic (0, .125), radius .215, about 20% sunk [O: rendered]. The framing cannot be lost.
- **OutRun bend:** in every scene vertex shader, on render-space positions before the view matrix: `bendV` in §8.2. Fog direction and distance use the bent position, so far geometry still matches the sky. It is geometrically false, so everything sets `frustumCulled = false` (§6.5 pays that cost explicitly).
- **Mountain V:** valley floor exactly y = 0 for |x| < 85, rising per §5.2.
- **Follow:** camera x = gain * ship x, camera y = 7 + 0.15 * (ship y - 6) [A] (.35 until DI-118: with the swooping lane the camera rose with the ship and the far terrain sparkled past S1far's limit). The gain keeps the whole ship, wing tips included, inside .85 of the half-width at the lane walls: `followGainX` in `src/app`, `max(.72, 1 - (.85 tan(29°) aspect (SHIP_FORWARD - SHIP_HALF_LENGTH) - SHIP_HALF_WIDTH) / PLAY_HALF_X)`. That is .793 at 16:9, .976 at 390x844, and .72 from aspect 2.30 up [arithmetic: T10, DI-88]. Dev frames keep 0.72.

### 6.2 Shared shader code

`src/contracts/glsl/` is prepended by string concatenation to every scene shader (§8.2). Rules: leave `glslVersion` unset, since three compiles `#version 300 es` regardless and `GLSL3` removes the `gl_FragColor` define [O]. Write `in`/`out` for varyings and `gl_FragColor` for output. Use `ShaderMaterial`, not `RawShaderMaterial`. Spread shared uniforms by reference, and never `clone()` a material, since that silently breaks the link [O]. All of §8.2 compiled and rendered with no shader error [O].

### 6.3 Sky (fullscreen triangle, drawn first)

- **Gradient:** `skyGrad(y)`, shared with fog.
- **Hero disc:** `sunDisc(rd, yScale)`; bands `fract(v * 9 + phase)`, width `.04 + .8 * sq(clamp((.42 - v) / 1.42, 0, 1))`, edges filtered with `fwidth`. Mode 0 is rendered in the prototype [O]; the other three modes are untested.
- **Painted halo:** `exp(-e * 2.4) * .30 + exp(-e * .7) * .10`. Large glows are painted, because bloom scales with area and washes out [I]. Bloom is reserved for thin lines.
- **Stars:** hash cells on `rd.xz / (rd.y + .35)`, radius defined in pixels `mix(.8, 1.9, h)`, mapped from pixels to cell space by the exact inverse Jacobian of the cell coordinates, jitter bounded by the radius. A fixed cell-space radius produced torn dashes [O]. `max(fwidth(st))` stretched them into horizontal dashes off-axis near the horizon, because `fwidth` adds both screen derivatives; the inverse Jacobian gave round stars, flux CV p95 .125 and .131 against a naive star's .734 and .468 [O: T04 rehearsal]. The star code is branch-free: a hash early-out above it drew hollow outlines on D3D11 [O: T04 rehearsal].
- **Nebula:** domain-warped fbm into a 384x192 half-float target each frame, upsampled in the sky shader. The prototype ran it per pixel; the render target is [A].
- **Below the horizon:** the floor's top edge is a crest below the true horizon, so the sky keeps its full gradient and disc down to `gb`, just under that edge, then goes near-black fast, because the translucent floor blends over it. With `g = rd.xy / max(-rd.z, 1e-3)`, `cy = max(camera y, 1)`, `cc = max(-uBend.y, 0)` and `vm = uBend.z`: `gb = (sqrt(cy / max(cc, 1e-12)) <= vm ? -2 * sqrt(cy * cc) : -(cy + cc * (vm^2 + 2 * vm * (6016 - vm))) / 6016) - .004`, then `c = mix(uPal[0] * .25, c, smoothstep(gb - .016, gb, g.y))`. At `c = -1.2e-5` and camera y 7, `gb` is -.0223. Going black at `rd.y < 0` drew a black band on the horizon, and a band reaching -.045 lifted the floor from 15 to 37 at row 630 [O: T03 and T04 rehearsals, as reported in their plans]. This relies on terrain's forward limit staying 6016 u.
- **Dither:** none in the sky. The chain is half-float, and the final pass sets `dithering = true` (§6.6).

### 6.4 Terrain: one-axis clipmap on a height ring

Six nested levels share one grid: 128x96 quads, centred on x = 0, scrolling only in z. **No chunk meshes, no skirts, no pool, no per-chunk draw calls.**

| Level | Spacing | Half-width | Forward | Rear rows | Drop (u) |
|---|---|---|---|---|---|
| 0 | 2 | 128 | 160 | 16 | 0 |
| 1 | 4 | 256 | 352 | 8 | .02 |
| 2 | 8 | 512 | 736 | 4 | .06 |
| 3 | 16 | 1024 | 1504 | 2 | .2 |
| 4 | 32 | 2048 | 3008 | 2 | .7 |
| 5 | 64 | 4096 | 6016 | 2 | 2.4 |

Index count gives 120,456 triangles in 6 draws: 24,576 for level 0, and 19,176 for each level with a hole [O: delta measured].

**Atlas.** One RGBA32F `DataTexture`, 129x768, 1.6 MB, allocated once. R = true height, G = morph height. RGBA because three's partial texture update hard-codes RGBA [O: `WebGLTextures.js:861`]. Rows are written in pairs (odd + even) every 2 spacings of travel, so the morph value of an odd row is always known:

```
even row:  morph = odd col ? 0.5 * (h[c-1] + h[c+1]) : h[c]
odd row:   morph = even col ? 0.5 * (lo[c] + hi[c]) : 0.5 * (lo[c+1] + hi[c-1])   // the uniform diagonal
```

**Vertex shader:**

```glsl
int slot = (int(position.y) + uBaseMod) % 128;
vec4 t = texelFetch(uH, ivec2(int(position.x), slot + uLevel * 128), 0);  // highp sampler2D
float x = (position.x - 64.) * uS, zf = position.y * uS + uRowOffset;     // uRowOffset is small and exact
float m = smoothstep(.6, .9, max(abs(x) / uHalfW, zf / uForward));
vec3 p = bendV(vec3(x, mix(t.r, t.g, m) - uDrop, -zf));
```

with `uRowOffset = (baseRow - chunk * (64 / s)) * s - local` in doubles, and `baseRow = floor(camRow / 2) * 2 - rearRows[k]`.

**Seams, two layers.** Morph makes each level equal the coarse mesh exactly at morph = 1, at stride 1. The coarse hole is rows `[0, 45)` and columns `[34, 94)` (rows `[0, 44)` at stride 2, so cells stay aligned). That leaves it smaller than the fine footprint by 2 cells laterally, 3 to 4 forward at levels 1 to 3, and 4 to 5 forward at levels 4 and 5 [arithmetic: T03]. The coarse level is dropped by a small epsilon, so it loses every depth test but covers any crack.

At stride 2 a level's 2s mesh meets its parent's 4s mesh in the overlap, which morph cannot equalise, so the parent can lie above the child [I]. Terrain is therefore `side: DoubleSide` at all tiers. `side` is in the program key (`WebGLPrograms.js:382`), so it cannot flip per tier.

| Crack test (0 sky pixels under terrain) | Result [O] |
|---|---|
| 5 levels, original height, 900 frames at 150 u/s, world 0, 1e9, 1e15 | 0 cracks |
| 5 and 6 levels, this height function, 300 frames per position, same positions | 0 cracks |
| Negative control, hole +2 cells / +4 cells | 0 / 10.4M px, so the detector works and the margin is 2 to 3 cells |
| 6 levels, stride 2, 1e15, full bend, 900 frames (T03 rehearsal) | `FrontSide`: 8 bad pixels, all on one ridge. `DoubleSide`: 0, and 0 across the rest of T03's matrix, with p95 1.0 against 1.1 ms |

**Fog bound.** Terrain ends at half-width 4096. Its side edge enters the frustum at a post-bend radial distance that shrinks as the view widens. At 21:9 and full bend (a = 8e-5) [arithmetic]:

| FOV | Camera x | Radial entry (u) | `fogK` there if `FOG_END` were 4500 |
|---|---|---|---|
| 58 (cruise) | 0 | 4559 | 1 |
| 66 (boost) | 0 | 4423 | .998 |
| 68 (boost and gate pulse) | 0 | 4396 | .997 |
| 68 | -28.8 (full follow) | 4366 | .994 |

So **`FOG_END = 4300`**, with `FOG_START = 1500`, measured on the post-bend radial distance. Feel caps FOV at `CAMERA_FOV_MAX = 68`. Wider than 21:9 the bound would fail: 32:9 reaches 4211 at camera x 0 [arithmetic: T03], and the 4183 first quoted here may include full follow. So `app/` sets `fov = min(feel.fovDeg, 2 * atan(CAMERA_HALF_TAN_MAX / aspect))`, which holds the horizontal half-tangent at the 21:9 value. The art prototype's 1800 to 6100 looked good but had a different far edge; T11 may lower these values by amendment (§8), and never raise them, because the worst inner edge of a boundary cell is at radial 4300.5 u [arithmetic: T03]. T03 proves the bound with a boundary-paint render at 21:9, maximum bend and FOV 68.

**Floor and mountain shading** (from the art prototype, rendered [O]):

```
hk = h / 230; rise = smoothstep(0, 3, h)
base  = mix(top * .16, mid * .20, hk) + discBottom * .05 * hk^2
facet = N from cross(dFdx(vL), dFdy(vL)); base += mix(mid, horizon, hk) * pow(sunFacing, 3) * .32 * rise
grid  = pristine at /8 (lw .03) * .55 + pristine at /64 (lw .0075) * .75, reduced 75% on the road
L     = 1.45 * (1 - .72 * fogK(d * 1.4));  c += emit(grid colour, L) * grid
pulse = exp(-fract(v / 512 - phase) * 14), emit(accent, 2.4) along the long lines
sun column: reflect rd, ripple rd.x by 0.0035 * two sines of period 4096/k, sunDisc(rr, .55)
            * (.05 + .95 * (1 - cos)^5) * smoothstep(-.34, -.05, rd.y)
            * colK   T11 r03 (DI-105): 1 above rd.y -.06; below it, fades out from rd.y -.07 to -.22
                     and tapers in from .45 of the disc radius at the sides
alpha = mix(mix(.72, .94, 1 - F), 1, rise), then mix(alpha, 1, fog); 1 everywhere when mirror is off
```

`pulse` moves its peak away from the camera, with the sharp edge on the camera side and the tail ahead, which may read backwards in motion [arithmetic, not reviewed]. Kept as written. T03's pulse shots and T11 decide, and flipping it is one sign.

Terrain keeps `transparent: true` at all tiers and writes alpha = 1 when the mirror is off. Flipping `transparent` changes the program cache key (`opaque` in `WebGLPrograms.js:272`) and would recompile mid-game [O].

**Far grid.** Filtered lines converge to mean coverage, so far luminance falls below the bloom threshold and the horizon does not flare. Row statistics in the 8 px under the horizon, width .04 [O]:

| Variant | Row std | Row mean |
|---|---|---|
| Pristine | .0051 | .0784 (expected coverage .0784) |
| Derivatives after `fract` | .0273 | .0846 |
| Hard step | .2923 | .2527 |
| Simple `fract/fwidth` | .0017 | .9954 (horizon whiteout) |

Frame-to-frame difference at a 1.17 u step, filtered vs naive: rows 615-650, 4.7 vs 14.1; rows 650-720, 10.0 vs 18.9; near field, 7.3 vs 4.9 [O]. Filtered is worse up close because its lines are thicker [I]. That is accepted: near-field change reads as speed, and far-field change reads as shimmer.

Both tables are history. The metric behind them was not recorded, and T03's rehearsal of the same formula on a flat floor gave rows 591 to 598 a mean of .0747 to .0828 and a std of .011 to .027, and rows 650 to 720 12.8 against 10.0 [O]. The scenes differ. T03's thresholds come from its own rehearsal and carry negative controls.

### 6.5 Objects

One `InstancedBufferGeometry` per archetype, one FIFO ring per archetype, capacity fixed at init. Retirement is free: rows die in strict order, the CPU only overwrites the oldest slots with `addUpdateRange`, and the vertex shader computes the modular row distance and collapses anything behind the camera or past `maxDist`. Rings whose archetype has additive draws (SAUCER, SEARCHLIGHT, FENCE) slide instead: each crossing shifts their live slots so slot order equals rebuild order, because additive blending into a half-float target depends on instance order [O: T05, 38 to 41 bytes FIFO against rebuild at tier 3, 0 with beams removed]. Caps are unchanged (DI-62).

```glsl
float zf = rowDelta(aRow) * 64. + aZLocal - uTravel.x;
if (zf < -30. || zf > uMaxDist || aKeep >= uDensity) { gl_Position = vec4(2., 2., 2., 1.); return; }
```

- At most 1 `fillProps` per frame. Terrain rows are written only as they are crossed. dt is clamped.
- **Feeding rings of different reach.** A ring holds only its own `maxDist` window, and the roster has 7 distinct reaches, so one chunk crossing touches 7 different rows. T05 keeps a ring of 96 cached `PropRow`s (about 400 KB [arithmetic]), calls `fillProps` once per crossing for the row 94 chunks ahead, and copies each archetype's slice into its ring when that row reaches the archetype's `maxDist`. Designed, not run: the spike gave every ring one reach [O].
- **Geometry** comes from our own `panel()` and `tri()` builders with an edge-distance attribute, filtered like the grid. Stock primitives are banned: stock `ConeGeometry` UVs produced flat slabs under the edge shader [O].
- **Neon look:** dark body plus `emit(tint, 1.7) * edge`, filtered with derivatives. Edge luminance fades with `1 - .7 * fogK(d * 1.4)`, so subpixel edges at range do not bloom-flicker [I].
- **Mirror:** emissive archetypes are drawn a second time with `y = -y`, `BackSide`, times .42, sharing the same attributes, and the floor blends over them. Real parallax reflections rendered correctly [O]. Reflected values stay under the bloom threshold, so bloom cannot cascade [I]. First thing sacrificed. The flip clamps `y` to 0 first, so a buried root (§5.7) cannot rise above the floor, root faces carry no lines, and instances past `abs(x)` 125 collapse, because terrain is opaque beyond the valley. Not rendered with real roots.
- **Scale-in:** `scale *= 1. - smoothstep(maxDist * .92, maxDist, zf)`, so nothing pops inside the fog. The shader's reach is `min(maxDist, uFog.y)`, because a fragment past `FOG_END` is pure `skyGrad` and would paint a faint mark over the disc. Only RING is affected, and its record still arrives early, at row 94.
- **Hide idle rings:** `mesh.visible = false` when no live row contains that archetype, because every live slot costs vertices with no frustum culling. A hidden mesh never uploads, so its `updateRanges` accumulate: 30 pending after 30 crossings, 0 after the first visible render [O: T05 spike]. Past 64 pending, clear them, which forces a full upload at the next show. When a ring goes idle, mark every slot dead (`keep = 2`, above any density), or a slot untouched for 65536 chunks aliases back to live through `rowDelta` [arithmetic; T05's plan unit-tests it, not yet run].
- **Reduced density:** a FIFO's live slots spread across its whole capacity, so `instanceCount` cannot shrink by waiting. Each ring has a per-tier modulus and a per-row clamp: `perRowClamp(d) = min(perChunk, ceil(perChunk * d * 1.25))`, `modulus(d) = perRowClamp(d) * (reach + 1 + rear)`. A ring stores `keep' = max(keep, rank / (perChunk * 1.25))`, with `rank` the record's 0-based position by ascending `keep` in its row and archetype, ties by ordinal, and the filter and shader use it. So at most `perRowClamp(d)` records pass for any `d` and the clamp cuts no live record [O: arithmetic only, ledger DI-41]. Going down, ramp `uDensity` over 90 ticks, then refill one ring per frame from the row cache. Going up, refill first, then ramp. A refill changes only which dead slots exist, so it must be invisible, and a test requires that. RING and items never filter. Designed, not run.

**Roster.** 20 scenery types, 6 gameplay types and the ship. Height, root, reach and per-chunk counts are in `ARCHETYPE_SPEC` and `ITEM_SPEC` (§8.1). Capacity is `perChunk * ceil(maxDist / 64 + 2)`, except traffic, which keeps 3 rear rows, capacity 116, because a car stays live up to 128 u past its row. Searchlight's 49 is oversized for its spawn rule, and harmless. Triangle counts are targets [A]. Rendered in the prototype: palm, arcology, pyramid, orb. Everything else is untested.

| # | Archetype | Silhouette and neon trick | Tris | Per chunk | maxDist | Cap | Mirror |
|---|---|---|---|---|---|---|---|
| 0 | Palm | Curved trunk, 9 drooping blades; edge-only, phase sway | 300 | 10 | 1600 | 270 | yes |
| 1 | Arcology | Stacked boxes; panel edges, hashed windows | 180 | 6 | 4000 | 390 | |
| 2 | Pyramid | 4-sided; barycentric edges, apex beacon | 16 | 2 | 4000 | 130 | |
| 3 | Chrome orb | Hovering sphere; analytic reflection of sky and grid, flat fade past 400 u | 480 | 3 | 1200 | 63 | yes |
| 4 | Colonnade | Fluted 12-gon, broken tops; emissive rings | 200 | 6 | 1600 | 162 | yes |
| 5 | Billboard | Tilted quad on legs; hashed block glyph rows | 24 | 3 | 1600 | 81 | |
| 6 | Pylon | Lattice mast with catenary to the next fixed anchor | 160 | 2 | 3000 | 98 | |
| 7 | Reflector post | 1 m stick; blink wave, sells speed | 12 | 32 | 800 | 480 | yes |
| 8 | Crystal | Floating octahedron; Fresnel fill plus edges | 24 | 8 | 2000 | 272 | yes |
| 9 | Saucer | Lens disc; 12 hash-lit dots, additive beam | 96 | 2 | 3000 | 98 | |
| 10 | Searchlight | Long cone; Fresnel-faded additive; only on `chunk % 6 === 0`, so at most 8 live in its 47 chunks [arithmetic] | 24 | 1 | 3000 | 49 | |
| 11 | Memphis totem | Cube, cone, sphere stack; zigzag by `fract(uv)` | 120 | 6 | 1200 | 126 | yes |
| 12 | Radio dish | Lathed bowl on mast; rim ring, red blinker | 160 | 1 | 3000 | 49 | |
| 13 | Landmark ring | 200 u torus, centre y = 65.14 [A]; frames the sun, flown through. Not yet rendered at that height | 1152 | 1 per 48 | 6000 | 4 | |
| 14 | Obelisk | Tall tapered slab; glowing seams | 20 | 3 | 3000 | 147 | |
| 15 | Geodesic dome | Faceted half-sphere; barycentric edges | 160 | 1 | 2000 | 34 | |
| 16 | Turbine | Tower and 3 blades; phase rotation | 100 | 2 | 2000 | 68 | |
| 17 | Cassette slab | Giant tilted cassette; spinning reels | 60 | 1 | 2000 | 34 | |
| 18 | Wire cactus | Saguaro of tubes; edge-only | 90 | 8 | 1200 | 168 | yes |
| 19 | Chevron sign | Roadside arrows; scrolled by phase, sells the bend | 16 | 4 | 800 | 60 | |
| I0 | Data shard | Pickup; spinning diamond, highest luminance | 8 | 12 | 800 | 180 | yes |
| I1 | Gate arch | Octagon over the road; chevrons scrolled by phase | 64 | 1 | 1600 | 27 | yes |
| I2 | Spike | Static hazard; red pulse | 20 | 4 | 800 | 60 | yes |
| I3 | Laser fence | Two posts and a beam with a gap | 8 | 2 | 800 | 30 | yes |
| I4 | Drone | Hovering wedge; oscillates | 60 | 3 | 800 | 45 | |
| I5 | Traffic car | Low wedge; taillights, moves along its lane | 48 | 4 | 1600 | 116 | yes |

Worst-case live geometry if every ring were visible at once: scenery about 317k, items about 12k, mirror about 200k, terrain 120k, so **about 650k triangles** [arithmetic], well under the 1.5M budget. Biome gating hides roughly half in practice [I].

### 6.6 Post stack

```ts
new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling })
// RenderPass, then one merged EffectPass per variant; dithering = true, timeScale = 0
```

Renderer: `{ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false }`, with `toneMapping` left at `NoToneMapping`, `renderer.info.autoReset = false`, and `info.reset()` once per frame.

| Order | Effect | Settings (starting values) | Why |
|---|---|---|---|
| 1 | ChromaticAberration | offset (.0006-.0014, .0003-.0007), radial, modulationOffset .35 | CONVOLUTION effects sort first regardless of argument order (`b.attributes - a.attributes`, line 15584) [O] |
| 2 | Bloom | mipmapBlur, threshold .95, smoothing .25, intensity .8, radius .68, levels by tier | SCREEN here is `dst + src - min(dst * src, 1)`, HDR-safe [O]. Not ADD |
| 3 | ToneMapping | `ToneMappingMode.NEUTRAL`, set explicitly | Source default is AGX [O: line 13446]. Mean chroma on the prototype: Neutral 70.9, ACES 58.7, AgX 49.7 [O] |
| 4 | Crt (custom) | Integer 3 px scan period, scan .10, grain up to .07, phase-locked, `BlendFunction.SRC`, writes alpha = 1 | Final alpha must be 1: context alpha is hard-coded true, and a material's alpha reaches the canvas [O] |
| 5 | Vignette | offset .3, darkness .55 | The library's default technique has reversed edges, `smoothstep(0.8, offset * 0.799, ...)` [O], undefined by the spec [M]. It rendered on the RTX and SwiftShader [O]. If a device misrenders it, T06 moves the vignette into Crt |

**Variants, prebuilt and swapped:** `composer.autoRenderToScreen = false; every variant.renderToScreen = true; toggle .enabled`.

| Variant | Effects | Tiers |
|---|---|---|
| `full` | CA, Bloom, Tone, Crt, Vignette | 4, 3 |
| `noCa` | Bloom, Tone, Crt, Vignette | 2 |
| `min` | Bloom, Tone, Crt with scan and grain 0, Vignette | 1 |
| `bare` | Tone, Crt with scan and grain 0 | 0 |

Variants **share the same `BloomEffect`, `ToneMappingEffect` and `VignetteEffect` instances**: two passes sharing them rendered correctly, with alpha 255 and no errors [O]. Programs rose from 7 to 8 on the first use of the second variant [O], so each variant is rendered once at boot behind the title (first use cost 14.3 ms [O]), and scene materials go through `renderer.compileAsync` at the same point. Effect-level disabling is rejected: setting an effect to `DST` recompiles and still runs all bloom draws, and disabling the last pass under auto mode leaves the canvas empty [O].

Changing bloom `levels` disposes both blur materials, so three links them again mid-game, and `renderer.info.programs` hides it: 8 to 20 links over a tier cycle while `info.programs.length` stayed 8 [O: T06 probe]. So T06 keeps one extra `MipmapBlurPass` alive and renders it in every `precompile`, which gave 0 links on the RTX and SwiftShader, including after a restore when re-rendered [O: T06 probe]. Compile gates spy on `gl.linkProgram`.

**Rejected, plainly:**

- **SMAA.** SMAA and CA both carry CONVOLUTION and throw `Convolution effects cannot be merged` at `addPass`, not at construction [O: line 15601]. That forces a second pass, and the earlier type-only probe that listed them together could not show this. It cannot fix subpixel lines anyway [I]; filtered shaders and MSAA handle the main sources.
- **`NoiseEffect` and `ScanlineEffect`.** One custom effect does scan, grain and the final alpha write together. `ScanlineEffect`'s period is `2 pi / density` drawing-buffer pixels, so it jumps with adaptive resolution [O: formula in source]. The custom effect's period is an integer, tested at DPR 1 only.
- **Two post passes.** The game-first proposal's split exists only to fit SMAA and CA in one stack, and is unneeded without SMAA.
- **Renderer tone mapping.** The mode is silently ignored under the composer [O]. `renderer.toneMappingExposure` does reach the effect: flat .2 moved from code value 112 to 70 at exposure .5, with no link [O: T06 probe]. That is how T06 applies day-phase exposure, `1 - .12 * (.5 + .5 * cos(TAU * dayPhase))`, .88 at deepest night and 1 at midday [A].

### 6.7 Photometric budget (wash-out control)

The bloom mask is `smoothstep(th, th + sm, luminance)` with Rec.709 weights [O]. Magenta #F6019D has luma .22 and cyan #2DE2E6 has .61, so equal multipliers would bloom only the cyan. Reaching luminance 1 takes x4.5 for that magenta and x1.65 for that cyan; for pure primaries it takes magenta x3.5, blue x13.9 and cyan x1.27 [arithmetic]. **All emission goes through `emit(colour, L)`.**

| Source | Luminance L |
|---|---|
| Surfaces | up to .2 |
| Sky | up to .8. Toxic Arcade and Arctic Laser reach .71 and .76 through `skyGrad(0) = .96 * horizon`, the other four under .25 [arithmetic], all under the .95 bloom threshold |
| Hero disc | about 1.05 |
| Neon lines | 1.4 to 2.4. One exception: the laser fence's wall lines at .90, under bloom's .95 threshold, and its gap verticals at 1.5 (T11 r12, DI-105) |
| Shard pickups | 2.4 |

Wash-out is a gate, not a matter of taste, and no single metric catches it. Near-white and mean chroma both pass a visibly flooded frame: near-white needs all three channels high, which a magenta glow does not reach, and SCREEN raises the dominant channel, so chroma goes up. Haze lift catches a bloom flood but improves under an additive veil, because tone mapping compresses the difference, so it needs a black-floor metric beside it. Definitions are in §8.1. Each gate has a negative control that must fail it.

| Gate | Limit | Catches | Negative control | Probe [O: T06, T09], clean then control |
|---|---|---|---|---|
| Near-white | under .5% of pixels [A] | Blown disc or flash | T06's card at `over=5` | Prototype .003%; `over=4` read only .524%, so 5 |
| Mean chroma | over 55 [A] | Grey-out, desaturation | T06's white flash | 64.6 to 116.1 on six palettes; prototype 70.9 |
| Haze lift | at most 20 [A] | Bloom flood | T06: bloom threshold .1 at intensity 3. T09: `floodLines(16)`. Near-white and chroma must still pass, or the control proves nothing | 7.76 to 11.33, then 33.03 and 35.34 |
| `blackP10` | at most 25 [A] | Additive veil, lifted blacks | T09: `veil(.1)`, with near-white, chroma and haze lift still passing | 8 to 18, then 58 |

T06 gates the first three on its card, on all six palettes. T09 gates all four on the integrated default frame. T11 gates near-white and chroma on every real sample, with three sharper metrics in place of the last two: **centre haze** at most 18 (haze lift inside uv radius .26), **floor black** at most 10 (25th percentile of luma, rows 612 to 1079) and **lit saturation** at least .70 (mean `(max - min) / max` where `max >= 32`), all [A]. On the art prototype a flood read near-white .007% and chroma 72 to 76, above clean's 71, with centre haze 9.0 clean and 58.7 flooded, and floor black 3 clean and 11 to 19 flooded [O: T11 probe].

Every limit above is a probe number. None has seen the real scene. T11's round 0 re-derives the [A] limits on real frames once and then freezes them, and its drill DR1 must fail centre haze and floor black on the real path while near-white and chroma pass. A metric that does not separate there becomes report-only, with a Decision log entry and the reviewer's agreement, except that one haze metric must fail DR1: if neither does, T11 is `blocked`, because R2 then has no flood detector.

### 6.8 Palette

Authored in sRGB, uploaded linear, crossfaded on the CPU in OKLCh, per slot: lerp L and C, shortest arc on hue, and if either end has chroma under .02, use the other end's hue. One exception (T11 r06, DI-105): a slot pair whose ends both have OKLab L under .5, neither hue in the olive band of 75 to 125 degrees, and whose shortest arc crosses that band takes the long arc, so red to green midpoints no longer pass through olive. All six palettes have now been rendered with objects in all six biomes (T11 `sheet36`); two values below moved there (DI-105).

Straight OKLab runs complementary neons through near-neutral, and emission normalises luminance, so grey lines stay bright. Across all 30 ordered pairs at m = .25, .5, .75, grid and accent sRGB saturation is at worst .18 straight and .41 by shortest hue, with 52 of 180 samples under .4 straight and none by shortest hue [arithmetic, run at reconciliation on the table below]. On T03's rehearsal terrain and sky, with no props, mean chroma at the midpoint was 27.1 on Sunset Drive to Toxic Arcade and 39.2 on Toxic Arcade to Ember straight, viewed as grey-beige, and 56.3 and 55.8 by shortest hue, viewed as still neon [O: T11 probe]. That is barely over the gate, so T11's X1 must confirm it with objects on.

| Zone palette | Top | Mid | Horizon | Disc top | Disc bottom | Grid | Accent |
|---|---|---|---|---|---|---|---|
| Sunset Drive | #0D0221 | #3A0F6B | #FD3777 | #FFD319 | #F6019D | #F6019D | #2DE2E6 |
| Miami Dusk | #120458 | #7A04EB | #FF2A6D | #FFE66D | #FF6C11 | #05D9E8 | #FF2A6D |
| Ultraviolet | #03001C | #301E67 | #8A2BE2 | #E0D4FF | #7B2FF7 | #B026FF | #00FFC8 |
| Toxic Arcade | #020F0D | #0B3D2E | #00FF9F | #D1F7FF | #00B8FF | #00FF9F | #FF00A0 |
| Ember | #1A0005 | #5C0A2E | #FF4500 | #FFB000 | #FF0054 | #FF0054 | #FFB000 |
| Arctic Laser | #020B2E | #0F3C8C | #7DF9FF | #D8F6FF | #4CC9F0 | #4CC9F0 | #F72585 |

**Two cells differ in the shipped game** (T11 r02, DI-105): Ultraviolet's disc top is `#FF6BE6`, because `#E0D4FF` was a pale lilac with little contrast against its violet sky, and Ember's accent is `#FF7A00`, because `#FFB000` read ochre in the ring fill, the aurora bars and the nebula. The table keeps the starting values, because the fake world mirrors it cell for cell (`tests/unit/core/fakeWorld.test.ts`) and every dev-page baseline rests on that; `src/world/palettes.ts` holds the shipped values.

Arctic Laser's disc top was `#FFFFFF`, which alone failed the near-white gate: 1.46% on a sky-only frame, 0% at `#D8F6FF` with chroma up, 73.6 against 72.2 [O: T04 rehearsal]. T03 read 1.46% and T06 .97% on their own stacks with the old value. The new one read .002% at night and .011% by day on T06's test card [O: T06 review]; it has not run on T03's stack.

### 6.9 Render order

Terrain is in three's transparent list, so it always draws after every opaque object.

| `renderOrder` | What | List |
|---|---|---|
| -1000 | Sky, no depth test | Opaque |
| -500 | Mirrored props, `BackSide` | Opaque |
| 0 | Props and items | Opaque |
| 10 | Ship | Opaque |
| 100 + level | Terrain, finest first, so coarse overlap fails the depth test and never double-blends | Transparent |
| 200 | Beams, searchlights, additive, no depth write | Transparent |
| 210 | Speed lines | Transparent |

### 6.10 Quality tiers

Order of sacrifice: mirror, MSAA, CA, bloom levels, density, nebula, resolution. **Grid, disc and palette never degrade.**

| Tier | Name | DPR cap | Max pixels | MSAA | Mirror | Post | Bloom levels | Nebula | Density | Terrain stride | Speed lines |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | High | 2 | 3686400 | 4 | on | `full` | 7 | 384x192 | 1 | 1 | 96 |
| 3 | Standard (default) | 1.5 | 2073600 | 2 | on | `full` | 6 | 384x192 | 1 | 1 | 64 |
| 2 | Low | 1 | 1440000 | 0 | off | `noCa` | 5 | 192x96 | .7 | 1 | 32 |
| 1 | Minimum | .75 | 921600 | 0 | off | `min` | 3 | off | .4 | 2 | 0 |
| 0 | Software | 1 | 230400 (640x360) | 0 | off | `bare` | none | off | .08 (landmarks) | 2 | 0 |

`pixelRatio = min(devicePixelRatio, dprCap, sqrt(maxPixels / (cssW * cssH)))`, so a DPR 1 monitor is never supersampled. Every tier stays on the composer, because the canvas has 0 depth bits under `depth: false` [O]. A direct-to-canvas low tier is impossible.

Tier-switch costs on the RTX, synced [O]:

| Change | Cost |
|---|---|
| Pass `enabled` toggle | Indistinguishable from a base frame |
| Bloom `levels` | 6.8 ms, which may be the compile §6.6 removes [I: T06] |
| `composer.multisampling` | 3.5-7.9 ms |
| `composer.setSize` | 56.6 ms first shrink, 12.9 ms grow |

**Governor** (pure, in `render/fx`, unit-tested with synthetic frame series):

- **Boot:** 30 frames at tier 3 behind the title, timed with the readPixels sync (§11.4). The unmasked renderer string from `WEBGL_debug_renderer_info` (`gl.RENDERER` reads `WebKit WebGL` on both rasterizers [O: T00 rehearsal]) matching `/swiftshader|llvmpipe|software|basic render/i` goes straight to tier 0. Otherwise p95 under 2 ms starts at tier 4, under 14 ms at tier 3, under 28 ms at tier 2, and anything slower at tier 1 [A].
- **Down:** rAF-delta p95 above 20 ms over 2 s, unless the delta is steady and `bootP95Ms` is under half of it. That pattern is a display or power limit (a 50 Hz panel, or a browser capping rAF at 30 Hz [M]), and shedding quality would not help [A]. A device that boots fast and then throttles to a steady rate looks identical, and the hold keeps it at its tier: steady 33.3 ms with boot p95 8 changed nothing for 120 s on a synthetic series [O: T06]. Kept as written, because only a real device can show which mistake is worse (§14 risk 17).
- **Up:** one tier after 60 s at p95 at or below 17.5 ms [A]. In production rAF is vsync-paced, so it can show misses but not headroom, which is why upshifts are slow probes rather than a threshold.
- **Rate:** at most one change per 5 s. A reversed upshift locks that tier out for 5 minutes.
- **Terrain stride changes** ramp morph to 1 over 30 frames, then swap a prebuilt index buffer. The swap frame differed from the one before by mean .035/255 on the RTX, on T03's rehearsal terrain [O]. **Density changes** follow §6.5. Neither has run in the integrated build (§14 risk 10).

The spike's "256 columns at the top tier" is rejected: it was affordable [O], but it adds a second atlas layout for detail that fog and speed hide.

## 7. Game design

All numbers are unplaytested starting values [A]. T02 owns them as named constants.

### 7.1 Rules

| Element | Rule |
|---|---|
| Shard | +100 x SYNC, +8% overdrive |
| Gate | Thread: +500 x SYNC, SYNC +1 (cap 16). Miss: SYNC -1 |
| Graze | Pass a hazard within 1.5 radii: +50 x SYNC, +5% overdrive |
| Boost | Hold: drains overdrive, speed to 150, score x2. Double-tap (two presses within 0.3 s) locks it on with nothing held, until overdrive is empty, a hit lands, or the next press; a button still held then boosts as a plain hold (operator, 2026-11-11) |
| Hazards | Spike, laser fence with a gap, drone, traffic |
| Hit | Shield -1, SYNC halved, speed x0.65 recovering over 1.5 s, 1.2 s ghost |
| Shield 0 | `SIGNAL_LOST`: SYNC = 1, autopilot for 3 s, shields refill, **score kept** |
| Sector | Each zone has a seeded objective (gates threaded, chain length, grazes, no-hit distance, boost distance). The checkpoint arch, a GATE record with `a = 1` every 100 chunks that never counts as a miss, grades S to C with a bonus. T01 places it, T05 draws it, T02 grades it |
| Bests | Best score and furthest distance in `localStorage`, in try/catch, owned by T08 |

**Invariants, fuzz-tested:** `speed >= 45` at all times (27 under reduced motion), travel strictly increases every step, `dt` is never scaled. Collisions are deterministic swept-z checks at the ship plane, `travel + SHIP_FORWARD`, against items in `ITEM_WINDOW_BEHIND`'s window (§8.1), in `(x, y)`, never terrain.

### 7.2 Modes and UI states

```
BOOT -> DEMO (title over live world, autopilot, rules off)
DEMO --first gesture--> PLAY          (audio unlocks here)
PLAY --Esc/P or button--> CRUISE      (menu open, rules frozen, hazards ghosted, autopilot at cruise, world moving)
PLAY --fullscreen left, not by the menu--> CRUISE   (in fullscreen, Esc is the browser's)
PLAY --shield 0--> SIGNAL_LOST --3 s--> PLAY
PLAY --10 s idle--> autopilot tag, all rules frozen, cosmetic events only; any input returns
any  --context lost--> overlay; sim keeps stepping; rendering resumes on restore
any  --no WebGL2 or restore timeout--> fatal page
```

Idle freezes score, shields, SYNC and objectives alike, because otherwise a parked player farms best score and loses shields with nobody at the controls. Furthest distance accrues only while score accrues, so CRUISE and idle autopilot cannot farm it either (DI-61).

Pause is CRUISE. **There is no true pause: R1 wins, and a player cannot freeze the screen.** This is stated in the UI ("the road never stops") and raised as an operator decision in §14.

### 7.3 Input

| Device | Mapping |
|---|---|
| Keyboard | WASD or arrows rate-steer, Space boost, Esc or P cruise, M mute. In fullscreen Esc is the browser's: it leaves fullscreen, and from PLAY the UI then opens CRUISE |
| Mouse (Pointer Events) | Position is an absolute target, left button boosts |
| Touch (Pointer Events) | One-finger relative drag, second finger or on-screen button boosts, `touch-action: none` |
| Gamepad | Out of v1 |

One `step()` path serves player, autopilot and tests. Autopilot produces a `ControlFrame` inside `sim`, so it cannot have different physics.

### 7.4 Feel

`feel/` is pure and cosmetic, variable-step, and cannot affect rules:

- Hit-stop: for 70 ms ship animation and HUD hold. Sim `dt` is untouched, and the speed drop is the sim's own hit rule.
- Trauma-squared shake, rotation only.
- FOV 58, +8 on boost, +2 pulse per gate, capped at 68 (§6.4). The disc scales with it; position holds.
- Instanced speed lines scale with speed.
- CA and bloom pulses, capped against wash-out.
- Glitch burst on hit, 0.2 s.
- Beat pulses on grid and gates from `sim.beat`, so visuals pulse even when muted.

### 7.5 HUD

DOM over the canvas with system fonts only: score, SYNC, shield pips, overdrive, km, sector, objective, in `"Courier New", ui-monospace, monospace`. The chrome wordmark uses a heavy system stack by CSS gradient clip, one CSS token, because Courier's thin strokes carry the chrome band poorly [O: T08 mock, one reviewer, stills]. Phone fallbacks are untested [M]. Text is written only on change, and bars move by `transform`. A gate counts DOM writes per second: 0 idle, at most 24 at cruise, 60 on boost, 300 adversarial [A]. It counts with a `MutationObserver` plus a `setProperty` wrapper, because an observer gives 0 records for `style.transform`, `setProperty` and custom properties [O: T08 rehearsal].

### 7.6 Audio

Web Audio only, all synthesized, created inside the first gesture.

- `audio/composer.ts` is pure: `patternFor(bar, sector, sync, out)` writes notes into a caller-owned bar. `sector` carries the index, the key, and whether a change is next or has just happened, since audio may not import `world` and zone boundaries are not bar-aligned. 100 BPM.
- Layers: kick, gated-reverb snare, hats, saw bass, detuned pad; arp at SYNC >= 4, lead at SYNC >= 8.
- Pickup blips quantise to the next sixteenth inside the current chord, rising with the chain.
- Procedural convolver impulse; drums pre-rendered with `OfflineAudioContext`.
- Lookahead scheduler: 25 ms timer, 120 ms window, `start(t)` and `set*ValueAtTime` [web source]. Never driven from rAF.
- `sim.beat` is the clock. Audio filters drift against `currentTime` with a .4 s EMA, slews below 30 ms at up to 2 ms per second, re-anchors when the filtered value passes 30 ms, and fast re-anchors above 150 ms raw. Raw drift spanned 12.1 ms on an idle page, and .9 ms after the EMA [O: T07 prototype], so an unfiltered test could trip on a coarse audio buffer.
- A hit ducks music -9 dB with a 500 Hz lowpass for 400 ms.
- Nodes allocate per note, bounded and not per frame. Cap polyphony; disconnect per-voice chains on `onended`.

## 8. Frozen contracts

Owner: T00. Changes are additive only, by plan amendment approved by the T00 owner. The one exception is T11 retuning a numeric look constant (`FOG_START`, `FOG_END`, `DEFAULT_SEED`), through the same amendment and inside any bound stated for it. Contract change requests from the plan set were reconciled on 2026-11-05 and are already in the text below, so T00 extracts them with the rest; [plans/RECONCILIATION.md](plans/RECONCILIATION.md) records each decision. The design-issues pass that followed added two comment lines and changed no type. Every interface below was extracted from this file and type-checked with `tsc` 6.0.3 under the §8.3 configuration, along with a conformance stub that implements each one [O: re-run after reconciliation]. That proves the types only: the stub's method bodies are mostly empty, so it does not show that each interface can do its job.

### 8.1 TypeScript

```ts
// src/contracts/index.ts
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

// ---- scale and lattice (1 u = 1 m) ----
export const CHUNK_LEN = 64;
export const WORLD_PERIOD = 4096;      // every shader-visible world pattern has a period dividing this
export const CHUNK_LIMIT = 2 ** 48 - 1024;   // warp refuses chunk >= this; the headroom keeps rows ahead of the camera below 2^53
export const ROW_MOD = 65536;          // instance rows are chunk mod ROW_MOD

export const CLIP_LEVELS = 6;
export const CLIP_BASE_SPACING = 2;
export const CLIP_COLS = 128;
export const CLIP_ROWS = 96;
export const CLIP_RING_ROWS = 128;
export const CLIP_HOLE_COLS = 30;
export const CLIP_HOLE_ROWS = 45;
export const CLIP_REAR_ROWS = [16, 8, 4, 2, 2, 2] as const;
export const CLIP_DROP = [0, 0.02, 0.06, 0.2, 0.7, 2.4] as const;

export const FOG_START = 1500;
export const FOG_END = 4300;
export const CAMERA_FOV = 58;
export const CAMERA_FOV_MAX = 68;
export const CAMERA_HALF_TAN_MAX = 1.574;   // horizontal, the 21:9 value at CAMERA_FOV_MAX (§6.4)
export const CAMERA_Y = 7;
export const CAMERA_PITCH = 0.05;
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 6200;

export const VALLEY_HALF = 85;
export const ROAD_HALF = 22;
export const PLAY_HALF_X = 40;
export const PLAY_Y_MIN = 2;
export const PLAY_Y_MAX = 14;
/** The ship is drawn this far ahead of the camera plane, and collision sweeps travel + SHIP_FORWARD. Its collision radius is 1.6 u (T02's SHIP_HIT_RADIUS; T01's solvable road assumes at most 2 u), and T05 draws it 3.2 u wide. */
export const SHIP_FORWARD = 14;

export const ZONE_CHUNKS = 100;
export const ZONE_FADE_CHUNKS = 25;
export const PALETTE_COUNT = 6;
export const BIOME_COUNT = 6;
/** Index order is the rows of §5.4 and §6.8. zone.biomeA and zone.paletteA index these, and T01's tables follow the same order. */
export const Biome = { BOULEVARD: 0, NEON_CITY: 1, CRYSTAL_DESERT: 2, CYBER_CANYON: 3, ORBITAL_NIGHT: 4, OLYMPUS: 5 } as const;
export const PaletteId = { SUNSET_DRIVE: 0, MIAMI_DUSK: 1, ULTRAVIOLET: 2, TOXIC_ARCADE: 3, EMBER: 4, ARCTIC_LASER: 5 } as const;
/** Display names, in the same order. They do not replace Biome and PaletteId. */
export const PALETTE_NAMES = ['Sunset Drive', 'Miami Dusk', 'Ultraviolet', 'Toxic Arcade', 'Ember', 'Arctic Laser'] as const;
export const BIOME_NAMES = ['Boulevard', 'Neon City', 'Crystal Desert', 'Cyber Canyon', 'Orbital Night', 'Olympus'] as const;
export const DAY_CHUNKS = 750;

export const SIM_HZ = 120;
export const BPM = 100;
export const SPEED_FLOOR = 45;
export const SPEED_CRUISE = 80;
export const SPEED_MAX = 150;

export const PHASE_COUNT = 8;
/** Beat, bar, phrase, then 1 s, 4 s, 16 s, 64 s, 256 s. Integer ticks, so phases are exact. */
export const PHASE_PERIOD_TICKS = [72, 288, 1152, 120, 480, 1920, 7680, 30720] as const;

export const PALETTE_FLOATS = 21;      // 7 linear RGB: top, mid, horizon, discTop, discBottom, grid, accent
export const PROP_STRIDE = 8;          // x, y, zLocal, yaw, scale, keep, tintSeed, variant
export const ITEM_STRIDE = 8;          // kind, x, y, zLocal, radius, a, b, seed
/**
 * Offsets in one PROP_STRIDE record. x lateral u. y world y of the mesh origin: grounded, true height minus sink, exactly 0 at abs(x) <= VALLEY_HALF; floating, true height plus hover, the object's centre.
 * zLocal in [0, CHUNK_LEN). yaw radians about +y: local +z maps to (sin yaw, 0, cos yaw), so a mesh's front faces +z and yaw 0 faces the approaching camera. scale > 0, uniform.
 * keep, tintSeed, variant in [0, 1). An instance is drawn while its ring keep, which is keep or higher (§6.5), is < density. A consumer computes floor(variant * n). PYLON: floor(variant * 2) === 1 means the next row also holds a pylon pair, so the wires are drawn. SEARCHLIGHT: yaw is a sweep phase offset.
 */
export const PropField = { X: 0, Y: 1, Z_LOCAL: 2, YAW: 3, SCALE: 4, KEEP: 5, TINT_SEED: 6, VARIANT: 7 } as const;
/**
 * Offsets in one ITEM_STRIDE record. x, y absolute u, the centre. radius > 0 is the pickup, opening or hit radius; meshes scale by it, except SHARD, which draws at a fixed size. seed in [0, 1).
 * SHARD, SPIKE: a = b = 0. GATE: a = 1 for a sector checkpoint arch, otherwise 0; b = 0; threaded when the ship's centre is within radius. FENCE: x span centre, radius span half-width, a gap centre x, b gap half-width; hits at any y, and y is for drawing.
 * DRONE: a amp, b integer k, phase 3. TRAFFIC: a travel, b integer k, phase 7. Records ascend by kind, then zLocal, so (chunk as passed, record ordinal) is a stable identity.
 */
export const ItemField = { KIND: 0, X: 1, Y: 2, Z_LOCAL: 3, RADIUS: 4, A: 5, B: 6, SEED: 7 } as const;
/** TRAFFIC's a is at most this, so zLocal + a < 3 * CHUNK_LEN and a car stays within its home chunk + 2. */
export const TRAFFIC_TRAVEL_MAX = 128;
/** With f = fract(b * phase7 + seed), TRAFFIC scale = min(1, f / TRAFFIC_FADE, (1 - f) / TRAFFIC_FADE). It collides only while that is 1. */
export const TRAFFIC_FADE = 0.1;
/** Collision reads item rows of home chunks c - ITEM_WINDOW_BEHIND .. c + 1, where c = travel.chunk. That sees every crossing of the ship plane, travel + SHIP_FORWARD. */
export const ITEM_WINDOW_BEHIND = 2;
export const MAX_PROPS_PER_CHUNK = 128;
export const MAX_ITEMS_PER_CHUNK = 32;
export const EVENT_CAPACITY = 64;
export const SHIELD_MAX = 3;           // SimState.shields is an integer in [0, SHIELD_MAX]
export const SYNC_MAX = 16;            // SimState.sync is an integer in [1, SYNC_MAX]

export const Archetype = {
  PALM: 0, ARCOLOGY: 1, PYRAMID: 2, ORB: 3, COLONNADE: 4, BILLBOARD: 5, PYLON: 6, REFLECTOR: 7,
  CRYSTAL: 8, SAUCER: 9, SEARCHLIGHT: 10, TOTEM: 11, DISH: 12, RING: 13, OBELISK: 14, DOME: 15,
  TURBINE: 16, CASSETTE: 17, CACTUS: 18, CHEVRON: 19,
} as const;
export type Archetype = (typeof Archetype)[keyof typeof Archetype];
export const ARCHETYPE_COUNT = 20;
/**
 * Facts T01 places by and T05 builds to, in u at scale 1. top: mesh reach above its origin, the half-height if it floats. root: buried depth below the origin, 0 if it floats.
 * Origin: ground contact, or the centre if it floats. maxDist: draw reach. perChunk: T01 never emits more of it in one row.
 * RING appears only on chunk % 48 === 0, and T01's keep-out and sag rules ignore it. SEARCHLIGHT's top and root describe a housing T05 does not draw. T11 does not retune this table.
 */
export interface ArchetypeSpec { readonly maxDist: number; readonly perChunk: number; readonly top: number; readonly root: number; readonly floats: boolean }
export const ARCHETYPE_SPEC = [
  { maxDist: 1600, perChunk: 10, top: 14,  root: 1.5, floats: false },   // PALM
  { maxDist: 4000, perChunk: 6,  top: 50,  root: 20,  floats: false },   // ARCOLOGY
  { maxDist: 4000, perChunk: 2,  top: 40,  root: 20,  floats: false },   // PYRAMID
  { maxDist: 1200, perChunk: 3,  top: 3.5, root: 0,   floats: true },    // ORB
  { maxDist: 1600, perChunk: 6,  top: 12,  root: 1.5, floats: false },   // COLONNADE
  { maxDist: 1600, perChunk: 3,  top: 12,  root: 4,   floats: false },   // BILLBOARD
  { maxDist: 3000, perChunk: 2,  top: 20,  root: 3,   floats: false },   // PYLON
  { maxDist: 800,  perChunk: 32, top: 1,   root: 0.3, floats: false },   // REFLECTOR
  { maxDist: 2000, perChunk: 8,  top: 3.5, root: 0,   floats: true },    // CRYSTAL
  { maxDist: 3000, perChunk: 2,  top: 3,   root: 0,   floats: true },    // SAUCER
  { maxDist: 3000, perChunk: 1,  top: 6,   root: 6,   floats: false },   // SEARCHLIGHT
  { maxDist: 1200, perChunk: 6,  top: 9,   root: 1.5, floats: false },   // TOTEM
  { maxDist: 3000, perChunk: 1,  top: 18,  root: 8,   floats: false },   // DISH
  { maxDist: 6000, perChunk: 1,  top: 100, root: 0,   floats: true },    // RING
  { maxDist: 3000, perChunk: 3,  top: 40,  root: 20,  floats: false },   // OBELISK
  { maxDist: 2000, perChunk: 1,  top: 20,  root: 6,   floats: false },   // DOME
  { maxDist: 2000, perChunk: 2,  top: 40,  root: 20,  floats: false },   // TURBINE
  { maxDist: 2000, perChunk: 1,  top: 16,  root: 8,   floats: false },   // CASSETTE
  { maxDist: 1200, perChunk: 8,  top: 8,   root: 1.5, floats: false },   // CACTUS
  { maxDist: 800,  perChunk: 4,  top: 5,   root: 1,   floats: false },   // CHEVRON
] as const satisfies readonly ArchetypeSpec[];

export const ItemKind = { SHARD: 0, GATE: 1, SPIKE: 2, FENCE: 3, DRONE: 4, TRAFFIC: 5 } as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];
export const ITEM_KIND_COUNT = 6;
/** maxDist: draw reach. perChunk: T01 never emits more of it in one row. T05 sizes TRAFFIC's ring with 3 rear rows, capacity 116 (§6.5). */
export interface ItemSpec { readonly maxDist: number; readonly perChunk: number }
export const ITEM_SPEC = [
  { maxDist: 800,  perChunk: 12 },   // SHARD
  { maxDist: 1600, perChunk: 1 },    // GATE, including a checkpoint, which takes a normal gate's place
  { maxDist: 800,  perChunk: 4 },    // SPIKE
  { maxDist: 800,  perChunk: 2 },    // FENCE
  { maxDist: 800,  perChunk: 3 },    // DRONE
  { maxDist: 1600, perChunk: 4 },    // TRAFFIC
] as const satisfies readonly ItemSpec[];

export const RenderOrder = {
  SKY: -1000, MIRROR: -500, PROP: 0, SHIP: 10, TERRAIN: 100, ADDITIVE: 200, SPEED_LINES: 210,
} as const;

// ---- position ----
/** chunk is integer-valued in [0, CHUNK_LIMIT); local is in [0, CHUNK_LEN). */
export interface Travel { chunk: number; local: number }

// ---- world ----
/** createWorld throws RangeError on a non-integer seed, or on a periodChunks that is negative, non-integer or not a multiple of 8. Every function of chunk reduces it first, so k and k + periodChunks * n give identical bytes. */
export interface WorldOptions { seed: number; periodChunks: number }   // periodChunks 0 = aperiodic
/** §5.1. World seed when no ?seed= is given. It decides the opening, so T11 may retune it under §8. */
export const DEFAULT_SEED = 155;   // 1985 until CCR-T11-5 (DI-102)

export interface PropRow {
  chunk: number;
  readonly data: Float32Array;   // PROP_STRIDE * MAX_PROPS_PER_CHUNK
  readonly start: Uint16Array;   // ARCHETYPE_COUNT + 1; instances of a are start[a] .. start[a + 1] - 1
}
export interface ItemRow {
  chunk: number;
  readonly data: Float32Array;   // ITEM_STRIDE * MAX_ITEMS_PER_CHUNK
  count: number;
}
/** bendV adds a * q to x and c * q to y (§8.2), so c < 0 lowers far geometry. abs(a) <= 8e-5, or the fog bound of §6.4 fails. c = -1.2e-5 and vMax = 1500, constant [A]; vMax > 0 always. */
export interface BendState { a: number; c: number; vMax: number }
export type HeroMode = 0 | 1 | 2 | 3;   // banded sun, eclipse, ringed planet, wire moon
export const Objective = { GATES: 0, CHAIN: 1, GRAZES: 2, NO_HIT: 3, BOOST: 4 } as const;
export type Objective = (typeof Objective)[keyof typeof Objective];
export interface ZoneState {
  index: number;
  biomeA: number; biomeB: number; biomeMix: number;
  paletteA: number; paletteB: number; paletteMix: number;
  readonly palette: Float32Array;   // PALETTE_FLOATS, linear, crossfaded in OKLab
  // The palette crossfade uses OKLab's polar form, OKLCh: lerp L and C, shortest arc on hue, per slot (§6.8). Nobody re-mixes it.
  heroA: HeroMode; heroB: HeroMode; heroMix: number;
  // objectiveTarget is an integer: GATES count, CHAIN consecutive shards, GRAZES count, NO_HIT u, BOOST u. SimState.objectiveProgress uses the same unit.
  // biomeB, paletteB, heroB always hold the next zone's value; ignore them at mix 0. musicKey is an integer semitone offset in [0, 12).
  objective: Objective; objectiveTarget: number; musicKey: number;
  // dayPhase is a sawtooth in [0, 1), and 0 is deepest night. Consumers evaluate cos(TAU * dayPhase), so the wrap cannot pop.
  // T06 applies exposure from dayPhase in post, so sky, fog and props move together. T04 applies it only to stars, nebula, aurora and meteors.
  dayPhase: number;
}
/** Pure and allocation-free: same seed and arguments give the same output, in any call order. */
export interface WorldSource {
  readonly seed: number;
  // iz may be negative near chunk 0. Exactly 0 at abs(x) <= VALLEY_HALF, never negative, continuous across chunks and zones. T01 memoises one row, so call a whole row at a time.
  /** True height at (x, iz * zs + zLocal). zs is a power of two; iz is integer-valued; zLocal is in [0, zs). */
  height(x: number, iz: number, zs: number, zLocal: number): number;
  /** Chunk may be any integer below 2^48, negative included. out.chunk is set to chunk as passed. Row contents never depend on out's prior contents. */
  fillProps(chunk: number, out: PropRow): void;
  fillItems(chunk: number, out: ItemRow): void;
  zoneAt(at: Readonly<Travel>, out: ZoneState): ZoneState;
  bendAt(at: Readonly<Travel>, out: BendState): BendState;
}

// ---- input ----
/**
 * One sample per rendered frame (§3.3 step 3); the sim reuses it for every step of that frame.
 * absolute false: moveX, moveY are steering rates in [-1, 1].
 * absolute true: moveX, moveY are a target in [-1, 1] across the play window, x = moveX * PLAY_HALF_X,
 *   y = PLAY_Y_MIN + (moveY + 1) / 2 * (PLAY_Y_MAX - PLAY_Y_MIN). The sim approaches it at its own bounded rate.
 * +moveX is sim +x and screen right. +moveY is sim +y and screen up.
 * boost: held this frame. human: a device event arrived since the last sample, or a key, button or finger is held.
 */
export interface ControlFrame { moveX: number; moveY: number; absolute: boolean; boost: boolean; human: boolean }
export interface InputSource { attach(el: HTMLElement): void; sample(out: ControlFrame): void; detach(): void }

// ---- sim ----
export const SimMode = { DEMO: 0, PLAY: 1, CRUISE: 2, SIGNAL_LOST: 3 } as const;
export type SimMode = (typeof SimMode)[keyof typeof SimMode];
/**
 * EventBuffer fields. x, y: ship position in u when the event fired.
 * value: SHARD, GATE, GRAZE points added including multipliers, 0 when cosmetic; HIT shields remaining; SECTOR new sector index; GRADE bonus points; others 0.
 * index: GRADE rank, 0 S, 1 A, 2 B, 3 C; otherwise the item's record ordinal in its row, or 0 if none.
 * chunk: the item's row chunk as passed to fillItems, or travel.chunk if there is no item.
 */
export const Ev = {
  SHARD: 1, GATE: 2, GATE_MISS: 3, GRAZE: 4, HIT: 5, SIGNAL_LOST: 6, SECTOR: 7, GRADE: 8, BOOST_ON: 9, BOOST_OFF: 10,
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];
/** Appended by sim.step, cleared by app at the end of the frame. Overflow drops events, never rules. */
export interface EventBuffer {
  readonly kind: Uint8Array; readonly x: Float32Array; readonly y: Float32Array; readonly value: Float32Array;
  readonly chunk: Float64Array; readonly index: Uint16Array;
  count: number;
}
/**
 * beat = tick / 72, fractional, unaffected by warp, mode and hit-stop. score is integer-valued, 0 until launch, and reset only by launch. overdrive in [0, 1]. ghost: seconds of immunity left.
 * autopilot is true whenever the planner steers, so the idle tag is mode === PLAY && autopilot. sectorIndex is zoneAt(travel).index, so it can lead FrameView.zone.index by one frame; HUD and audio read the zone.
 * sim.state, sim.events and state.travel are stable objects, mutated in place.
 */
export interface SimState {
  tick: number;            // integer-valued, never reset
  travel: Travel;
  stepDist: number;        // distance of the last step, always > 0; used for interpolation
  speed: number;
  x: number; y: number; prevX: number; prevY: number;
  mode: SimMode;
  score: number; sync: number; shields: number; overdrive: number; ghost: number;
  beat: number;
  sectorIndex: number; objectiveProgress: number;
  autopilot: boolean;
  warpSerial: number;      // incremented by warpTo; layers rebuild when it changes
}
/** launch works from DEMO only, pause from PLAY only, resume from CRUISE only. Anything else is a silent no-op. */
export type SimCommand = 'launch' | 'pause' | 'resume';
export interface Sim {
  readonly state: Readonly<SimState>;
  readonly events: EventBuffer;
  step(c: Readonly<ControlFrame>): void;
  command(c: SimCommand): void;
  // On success it rebuilds its own item rows, emits no event, leaves tick, mode and score alone, and warpSerial rises by 1.
  /** Returns false and changes nothing unless chunk is an integer in [0, CHUNK_LIMIT) and local in [0, CHUNK_LEN). */
  warpTo(chunk: number, local: number): boolean;
  /** Scales cruise, boost and the speed floor by 0.6 when on. Never stops motion. */
  setReducedMotion(on: boolean): void;
  /** Harness only. In PLAY, acts as if shields just reached 0; no-op in any other mode. */
  forceSignalLost(): void;
}

// ---- feel ----
/**
 * shakeX, shakeY, roll: radians; roll is three's rotation.z, negative banks right. shakeX is a small transient yaw, the one exception to §6.1. fovDeg: [58, 68]. aberration: [0, 1], maps across §6.6's range.
 * flash: [0, 0.6]. speedLines: [0, 1], the fraction of lines shown. bloomGain: multiplier in [1, 1.25]; T06 clamps it to [0, 1.5], so a harness override of 0 removes bloom. glitch: [0, 1]. shipHold: seconds, > 0 means hold ship and HUD animation.
 * duck: [0, 1], 1 at a hit, linear to 0 over 0.4 s. Audio does not read it: T07 schedules its own duck from Ev.HIT on the audio clock. Neutral values are createNeutralFeel().
 */
export interface FeelState {
  shakeX: number; shakeY: number; roll: number; fovDeg: number; aberration: number; flash: number;
  speedLines: number; bloomGain: number; duck: number; shipHold: number; glitch: number;
}
export interface Feel {
  readonly out: Readonly<FeelState>;
  update(dt: number, s: Readonly<SimState>, e: EventBuffer, reducedMotion: boolean): void;
}

// ---- quality ----
export type Tier = 0 | 1 | 2 | 3 | 4;
export type PostVariant = 'full' | 'noCa' | 'min' | 'bare';
/** One row of §6.10 per tier; T06 owns the table. maxPixels are exact: 3686400, 2073600, 1440000, 921600, 230400. Tier 0 has dprCap 1 and bloomLevels 0. nebulaWidth 0 means off, and target height is width / 2. */
export interface QualityProfile {
  tier: Tier;
  dprCap: number; maxPixels: number; msaa: 0 | 2 | 4;
  mirror: boolean; post: PostVariant; bloomLevels: number;
  nebulaWidth: number;             // 0 = off
  propDensity: number;
  terrainStride: 1 | 2;
  speedLines: number;
}
export interface Governor {
  readonly profile: Readonly<QualityProfile>;
  // sample(0) is a no-time tick: it returns a pending force once and adds to no statistic. Deltas of 1000 ms or more are ignored as stalls.
  /** Feed one rAF delta; returns the new tier when it changed, otherwise null. */
  sample(frameMs: number): Tier | null;
  /** Updates profile at once; the next sample() returns the new tier once, so app/ applies every change in one place. 'auto' keeps the current tier and resumes control, except on software, which returns to tier 0. */
  force(t: Tier | 'auto'): void;
}

// ---- the per-frame view: one object, mutated in place, never retained by a layer ----
export interface FrameView {
  // dt: clamped rAF delta in s, 0 under renderState, and no layer depends on it: ramps count frames or ticks. tick: integer-valued, never reset. cam can read chunk -1 for one frame after warpTo(0, 0).
  dt: number; tick: number; alpha: number;
  readonly cam: Travel;            // interpolated
  camX: number; camY: number;      // render-space; camera z is always 0
  readonly phases: Float32Array;   // PHASE_COUNT
  readonly sim: Readonly<SimState>;
  readonly feel: Readonly<FeelState>;
  readonly zone: Readonly<ZoneState>;
  readonly bend: Readonly<BendState>;
  readonly events: EventBuffer;
  quality: Readonly<QualityProfile>;
  reducedMotion: boolean;
}

// ---- rendering ----
// writeSharedUniforms writes all but uFog, which stays as created: uTravel = (cam.local, travelMod(cam, 4096)), uCamRow = rowMod(cam.chunk), uHero = (heroA, heroB, heroMix). Under v.reducedMotion it writes uBend = (0, 0, vMax), so neither app/ nor a layer repeats §10.3's bend-off.
/** One object per uniform; spread by reference into every ShaderMaterial. Names match glsl/common.glsl. */
export interface SharedUniforms {
  uTravel: { value: Float32Array };   // vec2
  uCamRow: { value: number };
  uPhases: { value: Float32Array };   // vec4[2]
  uBend: { value: Float32Array };     // vec3: a, c, vMax
  uPal: { value: Float32Array };      // vec3[7], flat
  uFog: { value: Float32Array };      // vec2: start, end
  uHero: { value: Float32Array };     // vec3: modeA, modeB, mix
}
export interface RenderContext {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly shared: SharedUniforms;
  readonly world: WorldSource;
}
export type LayerName = 'sky' | 'terrain' | 'props' | 'fx';
// The harness hides the other layers and sets the clear colour and zero pitch; terrain only swaps materials, and other layers ignore the mode. Debug materials compile on first use, in harness runs only.
/** 'crack': flat-shaded terrain for the crack test. 'edge-paint': terrain boundary rows painted for the fog-bound test. */
export type DebugMode = 'none' | 'crack' | 'edge-paint';
/** Cells added to each coarse hole by the crack test's negative control (§11.3). At this value the crack test must fail. */
export const CRACK_CONTROL_GROW = 4;
/**
 * Canvas output of the terrain debug modes. Clear to CLEAR first. RGB 0-255 tests:
 * sky is R > 200, G < 60, B > 200. EDGE_OK is G > 200, R < 60. EDGE_BAD is R > 200, G < 60, B < 60.
 * FLAT is below the bloom threshold, so the sky test also works post-on at MSAA 0.
 */
export const DebugPaint = {
  CLEAR: 0xff00ff, FLAT: [0.1, 0.6, 0.3], EDGE_OK: [0, 1, 0], EDGE_BAD: [1, 0, 0], EDGE_INTERIOR: [0.1, 0.1, 0.1],
} as const;
/**
 * Lifecycle: attach in array order (sky, terrain, props, fx) and setQuality; then post.attach, post.setQuality, post.resize, await post.precompile(); then rebuild once on every layer before the first frame.
 * Every mesh exists after attach, and nothing adds a mesh or flips transparent or side afterwards. After timed boot frames app/ may call setQuality and rebuild once more.
 * setQuality comes from §3.3 step 15 at any rate, including mid-ramp from the quality menu, and never while the context is lost. The first call and every rebuild apply at once, with no ramp.
 * frame self-heals after a camera jump, but app/ and the dev shell call rebuild first on any backward move or forward jump over CHUNK_LEN. A rebuild from equal rows gives the same slot order, whatever came before.
 * frame may render to the layer's own target and must restore what getRenderTarget returned.
 */
export interface RenderLayer {
  readonly name: LayerName;
  attach(ctx: RenderContext): void;
  setQuality(q: Readonly<QualityProfile>): void;
  /** Bounded work: at most 1 fillProps, and terrain rows only as crossed. */
  frame(v: Readonly<FrameView>): void;
  /** After a warp or a context restore: clear updateRanges, refill from pure state, mark for full upload. */
  rebuild(v: Readonly<FrameView>): void;
  /** Harness only. Hides every mesh of this layer. */
  setVisible(on: boolean): void;
  /** Harness only. A layer that a mode does not concern ignores it. */
  setDebugMode(m: DebugMode): void;
  /** Harness only, terrain only: grows the coarse holes by this many cells; 0 restores the real mesh. */
  setCrackControl?(holeGrow: number): void;
  dispose(): void;
}
/** The frame owner (app/ or the dev shell), not PostStack, owns renderer.info.reset and autoReset, debug.onShaderError, renderer flags, camera.aspect and updateProjectionMatrix. PostStack alone writes pixel ratio, renderer and composer size, and toneMappingExposure. */
export interface PostStack {
  attach(ctx: RenderContext): void;
  /** Renders every variant once, so no program compiles mid-game. Call behind the title. */
  precompile(): Promise<void>;
  /** setQuality and resize only record. They apply at the start of the next frame, render or precompile, so GL is never touched while the context is lost. resize applies the §6.10 pixel-ratio formula, and app/ takes devicePixelRatio from window. */
  setQuality(q: Readonly<QualityProfile>): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  frame(v: Readonly<FrameView>): void;
  render(dt: number): void;
  /** Cheap and GL-free, safe on every warp. After a context restore, call precompile again as well, and only with a live context. */
  rebuild(): void;
  // Both forces survive setQuality and apply at the next frame or render. Scan and grain follow the active variant, not the tier.
  /** Harness only; null returns to the quality profile. Under 'off', render() draws the scene straight to the canvas with autoClear on. */
  forceVariant(v: PostVariant | 'off' | null): void;
  /** Harness only; null returns to the quality profile. */
  forceMsaa(n: 0 | 2 | 4 | null): void;
  dispose(): void;
}

// ---- audio ----
/**
 * unlock: inside an activating event, in the same call stack. Idempotent. Never rejects; resolves when running or after 1 s, so never await it before launching. Retry on later gestures is internal.
 * frame: every frame in every mode, before events are cleared; a no-op until unlocked. Never throws.
 * setVolume: linear gains in [0, 1], callable before unlock. Mute is setVolume(0, 0).
 * suspend, resume: tab hidden and shown (§10.4). Idempotent, safe before unlock. dispose: on the fatal page; every method is then a no-op.
 */
export interface AudioEngine {
  /** Must be called inside a user gesture. */
  unlock(): Promise<void>;
  frame(v: Readonly<FrameView>): void;
  setVolume(music: number, sfx: number): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

// ---- ui ----
/**
 * launch runs synchronously inside an activating event and may fire more than once for one gesture:
 *   it must unlock audio in the same call stack, be idempotent, and do nothing to the sim outside DEMO.
 * togglePause: PLAY to CRUISE, CRUISE to PLAY, otherwise nothing. setQuality(t) means governor.force(t). setReducedMotion writes the sim and FrameView.reducedMotion together.
 * Ui.mount calls setVolume and setReducedMotion at once, and setQuality if a stored choice exists, before the renderer and the final governor exist. app/ routes the first two to live objects and buffers setQuality until boot ends.
 * Ui is the only reader of prefers-reduced-motion and the only owner of localStorage bests. Ui.showFatal may be called before mount.
 */
export interface UiCommands {
  launch(): void;
  togglePause(): void;
  setQuality(t: Tier | 'auto'): void;
  setVolume(music: number, sfx: number): void;
  setReducedMotion(on: boolean): void;
}
export type FatalReason = 'no-webgl2' | 'context-lost-permanent' | 'shader-error' | 'runtime-error';
/** mount(root): root is an empty element above the canvas, never transformed, and input attaches to the canvas itself. DOM hooks for tests, as data-mv values: title, launch, hud, km, sector, cruise, resume, signal-lost, context-lost, autopilot, reduced, quality, fatal, reload. <html data-mv-mode> is demo, play, cruise or lost. The UI writes no bests once warpSerial is non-zero. */
export interface Ui {
  mount(root: HTMLElement, cmd: UiCommands): void;
  frame(v: Readonly<FrameView>): void;
  showContextLost(lost: boolean): void;
  showFatal(r: FatalReason): void;
}

// ---- harness (window.__mv when the page is opened with ?harness) ----
export interface HarnessStats {
  calls: number; triangles: number; geometries: number; textures: number; programs: number;
  /** chunk and local are the sim's travel, which renderAt does not move. tier is governor.profile.tier, which changes as soon as a force is made. */
  chunk: number; local: number; tier: Tier;
  /** Drawing buffer size in pixels, the shape of pixels(). */
  width: number; height: number;
  tick: number; warpSerial: number; mode: SimMode;
}
/**
 * Real page query, read only by app/. ?harness enables window.__mv. Under it ?period=<n> sets WorldOptions.periodChunks, default 1024, 0 = aperiodic. In any mode, ?seed=<int> overrides DEFAULT_SEED, and ?tier=0..4 sets CreateGovernor.forced with no boot timing. A bad value warns and falls back.
 * The periodic world holds only zones 0 to 10 and jumps at multiples of 1024, so judge no picture across a wrap, and use ?period=0 to reach all 36 palette and biome pairs.
 * Wash-out metrics on final 8-bit RGBA, one meaning for T06, T09 and T11 (§6.7). Near-white: share of pixels with min(r, g, b) > 235. Mean chroma: mean of max - min. Haze lift: mean Rec.709 luma of the frame minus the same frame under forceFeel({ bloomGain: 0 }), whole frame.
 * blackP10: nearest-rank 10th percentile of rounded Rec.709 luma, whole frame. Limits and negative controls are in §6.7.
 */
export interface HarnessApi {
  readonly ready: boolean;
  /** Stops the rAF loop; the harness then drives frames explicitly. */
  manual(on: boolean): void;
  warp(chunk: number, local: number): boolean;
  /** Renders exactly this world state with neutral feel. Returns GPU-synced ms. */
  renderAt(chunk: number, local: number, tick: number): number;
  stepFrames(n: number, dt: number): void;
  setPost(variant: PostVariant | 'off'): void;
  setMsaa(n: 0 | 2 | 4): void;
  setLayerVisible(name: LayerName, on: boolean): void;
  setCrackMode(on: boolean): void;
  setEdgePaint(on: boolean): void;
  /** Negative control for setCrackMode: while on, holes are grown by CRACK_CONTROL_GROW, and the crack count must be non-zero. */
  setCrackControl(on: boolean): void;
  /** Changes palette, hero and the sky's biome key only. Terrain and props follow the chunk's real biome, so to see a true pair, warp to a real chunk. */
  forceZone(palette: number, biome: number, hero: HeroMode): void;
  forceBend(a: number, c: number): void;
  /** Overrides feel's FOV, including under renderAt; null clears. The fog-bound test uses CAMERA_FOV_MAX. */
  forceFov(deg: number | null): void;
  /** Overrides feel fields, including under renderAt; null clears. { shakeY: -CAMERA_PITCH } gives zero pitch, { bloomGain: 0 } removes bloom. */
  forceFeel(o: Partial<FeelState> | null): void;
  /** Calls governor.force. stats().tier changes at once; layers and post apply it at step 15 of the next renderAt or stepFrames frame, so it shows from the frame after. 'auto' returns control to the governor. */
  setTier(t: Tier | 'auto'): void;
  /** Reaches SIGNAL_LOST through sim.forceSignalLost(). PLAY only. */
  forceSignalLost(): void;
  /** Resolves one macrotask after webglcontextlost. Rejects if already lost. */
  loseContext(): Promise<void>;
  /** Resolves on webglcontextrestored. Rejects, touching no GL, unless a loseContext promise has resolved (§11.3). */
  restoreContext(): Promise<void>;
  stats(): HarnessStats;
  /** Full-frame RGBA read in the same task as the render. */
  /** Rows are bottom-up, as gl.readPixels gives them. Throws unless in the same synchronous run as renderAt or stepFrames. renderAt and stepFrames throw unless manual(true). */
  pixels(): Uint8Array;
}
/*
 * Boot: app/ imports src/harness dynamically, only under ?harness, and calls createHarness(host) once, after boot and one real frame. createHarness installs window.__mv and window.__mvLab and returns the API.
 * app/ then logs console.info('MV_READY') once, which is the only wait that does not grant user activation.
 * runFrame(dt): the §3.3 body with rawDt = dt, stepping the sim. Step 2 calls governor.sample(0), so a synthetic dt reaches no statistic.
 * renderState(chunk, local, tick): §3.3 steps 2 and 5 to 15, with no input, sim step or feel.update: cam is exactly (chunk, local), tick is tick, alpha 0, dt 0, phases at alpha 0, camX and camY from prevX and prevY,
 *   neutral feel plus overrideFeel, post.render(0), sim unchanged, so the ship holds still. Step 10 rebuilds if warpSerial changed, and any backward camera move or forward jump over CHUNK_LEN rebuilds every layer and post first. A forward step within CHUNK_LEN streams as in play.
 * In both, a Governor.force applies at step 15 and shows from the next frame, held while the context is lost; a throw goes to the fatal route and is then rethrown. Overrides persist until cleared.
 * Methods on sim, layers and post are reached by property lookup, never a captured reference, and those objects are not frozen, so the harness may wrap them.
 */
/** What app/ hands the harness. The harness imports no sibling module, so this is everything it may touch. */
export interface HarnessHost {
  readonly sim: Sim;
  readonly ctx: RenderContext;
  readonly layers: readonly RenderLayer[];
  readonly post: PostStack;
  readonly governor: Governor;
  /** true stops the rAF loop; false restarts it. */
  setManual(on: boolean): void;
  /** One pass of the frame loop (§3.3) at this dt, stepping the sim. */
  runFrame(dt: number): void;
  /** The frame loop without stepping the sim, at exactly this state, with alpha 0 and neutral feel. */
  renderState(chunk: number, local: number, tick: number): void;
  /** Applied straight after step 7 of §3.3. null clears. */
  overrideZone(o: { palette: number; biome: number; hero: HeroMode } | null): void;
  overrideBend(o: { a: number; c: number } | null): void;
  /** Replaces feel.out.fovDeg in step 9 of §3.3. null clears. */
  overrideFov(deg: number | null): void;
  /** Merged over feel.out in runFrame and over neutral feel in renderState; overrideFov wins on fovDeg. null clears. */
  overrideFeel(o: Partial<FeelState> | null): void;
}

// ---- composition root: each module exports only its factories, from its index.ts (src/render/fx has three, the rest one) ----
// For src/app and tests only, outside the factories: writePalette from src/world/palettes.ts (overrideZone), findZoneChunk from src/world/zones.ts (tests/art).
export type CreateWorld = (o: WorldOptions) => WorldSource;         // src/world/index.ts        createWorld
export type CreateSim = (w: WorldSource) => Sim;                    // src/sim/index.ts          createSim
export type CreateFeel = () => Feel;                                // src/feel/index.ts         createFeel
export type CreateLayer = () => RenderLayer;                        // createSkyLayer, createTerrainLayer, createPropsLayer, createFxLayer, each from its src/render/<name>/index.ts
export type CreatePost = () => PostStack;                           // src/render/fx/index.ts    createPost
/** forced beats software. software comes from the unmasked WEBGL_debug_renderer_info string, and pins tier 0 under 'auto'. bootP95Ms is milliseconds of the readPixels-synced boot frames at tier 3; not finite or not above 0 means no measurement. */
export type CreateGovernor = (o: { software: boolean; bootP95Ms: number; forced: Tier | null }) => Governor;  // src/render/fx/index.ts
export type CreateAudio = () => AudioEngine;                        // src/audio/index.ts        createAudio
export type CreateUi = () => Ui;                                    // src/ui/index.ts           createUi
export type CreateInput = () => InputSource;                        // src/input/index.ts        createInput
export type CreateHarness = (h: HarnessHost) => HarnessApi;         // src/harness/index.ts      createHarness
```

```ts
// src/core/coords.ts -- complete; T00 ships exactly this
import { CHUNK_LEN, CHUNK_LIMIT, ROW_MOD, type Travel } from '../contracts/index';

/** Moves t by d (either sign), keeping local in [0, CHUNK_LEN). */
export function advance(t: Travel, d: number): void {
  t.local += d;
  if (t.local >= CHUNK_LEN || t.local < 0) {
    const n = Math.floor(t.local / CHUNK_LEN);
    t.chunk += n;
    t.local -= n * CHUNK_LEN;
    // A tiny negative local rounds up to exactly CHUNK_LEN just above.
    if (t.local >= CHUNK_LEN) { t.local = 0; t.chunk += 1; }
  }
}
/** a - b in u. The only legal way to subtract positions. Exact while the chunks are close. */
export function between(a: Readonly<Travel>, b: Readonly<Travel>): number {
  return (a.chunk - b.chunk) * CHUNK_LEN + (a.local - b.local);
}
/** Chunk mod 65536 in [0, 65536), for the uCamRow uniform and aRow attributes. */
export function rowMod(chunk: number): number {
  return ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
}
/** Distance mod period, exact. period must be a positive integer multiple of CHUNK_LEN. */
export function travelMod(t: Readonly<Travel>, period: number): number {
  const chunks = period / CHUNK_LEN;
  return (((t.chunk % chunks) + chunks) % chunks) * CHUNK_LEN + t.local;
}
export function canWarp(chunk: number, local: number): boolean {
  return Number.isInteger(chunk) && chunk >= 0 && chunk < CHUNK_LIMIT && local >= 0 && local < CHUNK_LEN;
}
/** HUD only. Loses precision at extreme distances, which no player will see. */
export function totalDistance(t: Readonly<Travel>): number {
  return t.chunk * CHUNK_LEN + t.local;
}
```

```ts
// src/contracts/glsl.ts
import common from './glsl/common.glsl?raw';
import commonFrag from './glsl/common.frag.glsl?raw';
import hero from './glsl/hero.glsl?raw';

export const COMMON_VERT = common;
export const COMMON_FRAG = common + commonFrag + hero;
```

`src/core/hash.ts` exports `hash01(seed: number, chunk: number, a: number, b: number): number`, `src/core/motion.ts` exports `trafficOffset(travel, k, seed, phase)` and `droneOffset(amp, k, seed, phase)`. `src/core/uniforms.ts` exports `createSharedUniforms(): SharedUniforms` and `writeSharedUniforms(v: Readonly<FrameView>, out: SharedUniforms): void`, so `app/` and the dev shell cannot drift apart on what step 9 of §3.3 writes.

`src/testing/` exports `createFakeWorld(): WorldSource` (flat valley, simple hills), `scriptedFrame(t: number): FrameView`, `createFakeHost(): HarnessHost`, and `startDevShell(layers: RenderLayer[], post?: PostStack)`, so T03 to T06 get screenshots before integration, and T09 can build against a host before T10 exists.

The signatures T00 implements in `src/core` and `src/testing`, with optional parameters and extra members added at reconciliation. Behaviour is in `plans/T00-foundation.md`. `contracts:check` does not extract this fence, because its first line names no file:

```ts
// Signatures only, for T00 to implement. Each block names its file.
import type {
  Archetype, BendState, DebugMode, Ev, EventBuffer, FeelState, FrameView, HarnessHost, HeroMode, ItemKind, ItemRow, LayerName, PostStack, PropRow,
  QualityProfile, RenderContext, RenderLayer, SharedUniforms, SimState, Tier, Travel, WorldSource, ZoneState,
} from '../contracts/index';

// src/core/hash.ts. Exact text is in plans/T00-foundation.md, because T01's goldens depend on it.
export declare function hash01(seed: number, chunk: number, a: number, b: number): number;

// src/core/motion.ts. Same expressions as the GLSL twins in common.glsl. The sim passes alpha 0 phases from the tick; render passes uPhases.
export declare function trafficOffset(travel: number, k: number, seed: number, phase: number): number;   // u added to zLocal, forward, in [0, travel); phase index 7
export declare function droneOffset(amp: number, k: number, seed: number, phase: number): number;        // u added to x; phase index 3
export declare function phaseOf(tick: number, alpha: number, i: number): number;                         // ((tick % PHASE_PERIOD_TICKS[i]) + alpha) / PHASE_PERIOD_TICKS[i]
export declare function writePhases(tick: number, alpha: number, out: Float32Array): void;

// src/core/uniforms.ts
export declare function createSharedUniforms(): SharedUniforms;
export declare function writeSharedUniforms(v: Readonly<FrameView>, out: SharedUniforms): void;
export interface CameraPose { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; fovDeg: number }
export declare function cameraFov(fovDeg: number, aspect: number): number;   // min(fovDeg, 2 * atan(CAMERA_HALF_TAN_MAX / aspect) in degrees)
/** x camX, y camY, z 0; rotX CAMERA_PITCH + shakeY, rotY shakeX, rotZ roll, in three's default XYZ order; fovDeg through cameraFov. */
export declare function writeCameraPose(v: Readonly<FrameView>, aspect: number, out: CameraPose): void;

// src/core/alloc.ts. Caller-owned records, sized from the constants.
export declare function createPropRow(): PropRow;
export declare function createItemRow(): ItemRow;
export declare function createZoneState(): ZoneState;
export declare function createBendState(): BendState;
export declare function createEventBuffer(): EventBuffer;   // EVENT_CAPACITY per array
export declare function createNeutralFeel(): FeelState;     // shake and roll 0, fovDeg CAMERA_FOV, aberration, flash, speedLines 0, bloomGain 1, duck, shipHold, glitch 0

// src/testing/fakeWorld.ts, no three. Record values follow PropField, ItemField and T01's RING, PYLON and GATE rows.
export interface FakeWorldOptions { seed?: number; periodChunks?: number; archetypes?: readonly Archetype[]; items?: readonly ItemKind[] }
export declare function createFakeWorld(o?: FakeWorldOptions): WorldSource;

// src/testing/scriptedFrame.ts, no three, so T07 and T08 pages can import it directly.
export interface ScriptedEvent { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
export interface ScriptedFrameOptions {
  at?: Travel; tick?: number; palette?: number; biome?: number; hero?: HeroMode;
  bend?: { a: number; c: number }; feel?: Partial<FeelState>; sim?: Partial<SimState>;
  tier?: Tier; reducedMotion?: boolean; events?: readonly ScriptedEvent[]; world?: WorldSource;
  camX?: number; camY?: number;   // render-space; default as §6.1 from sim.x and sim.y, with gain 0.72
  /** Applied last, after palette, biome and hero. For testing crossfades and day phase. */
  zone?: Partial<Pick<ZoneState, 'index' | 'biomeA' | 'biomeB' | 'biomeMix' | 'heroA' | 'heroB' | 'heroMix' | 'dayPhase'>>;
}
export declare function scriptedFrame(t: number, o?: ScriptedFrameOptions): FrameView;
export declare function fakeProfile(t: Tier): QualityProfile;   // equal field by field to T06's table

// src/testing/fakeHost.ts. Works in Node and a browser. Its sim: warpTo obeys canWarp, updates state.travel, and raises warpSerial only on success; step advances travel by SPEED_CRUISE / SIM_HZ, sets stepDist and raises tick; forceSignalLost exists.
export interface FakeHostCalls {
  setManual: boolean[]; runFrame: number[]; renderState: [number, number, number][];
  overrideZone: unknown[]; overrideBend: unknown[]; overrideFov: (number | null)[]; overrideFeel: unknown[];
  forceVariant: unknown[]; forceMsaa: unknown[]; layerVisible: [LayerName, boolean][]; debugMode: [LayerName, DebugMode][];
  governorForce: (Tier | 'auto')[];
}
export interface FakeHost extends HarnessHost { readonly calls: FakeHostCalls }
export declare function createFakeHost(): FakeHost;

// src/testing/devShell.ts and devPost.ts, which may use three and postprocessing. src/testing/index.ts re-exports everything here.
export interface DevShellOptions { world?: WorldSource; tier?: Tier }
export interface DevShell {
  readonly ready: boolean;                       // attach, precompile and first frame are done
  readonly ctx: RenderContext;
  readonly shaderErrors: readonly string[];
  readonly warpSerial: number;
  setManual(on: boolean): void;                  // true stops the rAF loop
  frameAt(t: number, o?: ScriptedFrameOptions): number;   // renders exactly that frame in this task, returns 1x1 readPixels-synced ms
  pixels(): Uint8Array;                          // full-frame RGBA, rows bottom-up; call in the same task as frameAt (§11.3)
  stats(): { calls: number; triangles: number; programs: number; geometries: number; textures: number; width: number; height: number };
  rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number };   // unmasked, through WEBGL_debug_renderer_info
  setTier(t: Tier): void;
  setLayerVisible(name: LayerName, on: boolean): void;
  setDebugMode(m: DebugMode): void;
  rebuild(): void;
  dispose(): void;
}
export declare function startDevShell(layers: RenderLayer[], post?: PostStack, o?: DevShellOptions): DevShell;
declare global { interface Window { __shell?: DevShell } }
export declare function createDevPost(): PostStack;   // setQuality and resize record and apply later, like the real PostStack
```

### 8.2 GLSL

```glsl
// src/contracts/glsl/common.glsl -- both stages
uniform vec2  uTravel;     // x: camera distance mod 64, y: camera distance mod 4096
uniform float uCamRow;     // camera chunk mod 65536
uniform vec4  uPhases[2];  // 8 phases in [0, 1), PHASE_PERIOD_TICKS order
uniform vec3  uBend;       // a, c, vMax
uniform vec3  uPal[7];     // linear: top, mid, horizon, discTop, discBottom, grid, accent
uniform vec2  uFog;        // start, end (radial, post-bend)
uniform vec3  uHero;       // modeA, modeB, mix

const vec3  W709 = vec3(.2126, .7152, .0722);
const float TAU  = 6.28318530718;

// All emission goes through this: equal L gives equal bloom response on any hue.
vec3 emit(vec3 c, float L) { return c * (L / max(dot(c, W709), 1e-3)); }

// Applied to render-space positions (camera at z = 0) in every scene vertex shader.
vec3 bendV(vec3 p) {
  float v = max(-p.z, 0.), b = min(v, uBend.z), q = b * b + 2. * uBend.z * (v - b);
  p.x += uBend.x * q; p.y += uBend.y * q; return p;
}

float fogK(float d) { return smoothstep(uFog.x, uFog.y, d); }

// Sky gradient; terrain and props fade into exactly this, so far geometry appears invisibly.
// y is rd.y of the normalized view direction, in world axes, after the bend. Not gnomonic. The sky passes the same quantity.
vec3 skyGrad(float y) {
  float h = max(y, 0.);
  vec3 c = mix(uPal[2] * .62, uPal[1], smoothstep(0., .17, h));
  c = mix(c, uPal[0], smoothstep(.09, .55, h));
  return c + uPal[2] * exp(-h * 30.) * .34;
}

// Exact modular row distance for FIFO rings; row is chunk mod 65536 stored as float.
float rowDelta(float row) { return mod(row - uCamRow + 32768., 65536.) - 32768.; }

// Use only integer harmonics: fract(phaseAt(i) * k + seed) with integer k, or the wrap pops.
float phaseAt(int i) { return uPhases[i / 4][i % 4]; }

// Twins of src/core/motion.ts. Same expressions, so sim collision and the drawn position agree.
float trafficOffset(float travel, float k, float seed, float phase) { return travel * fract(k * phase + seed); }
float droneOffset(float amp, float k, float seed, float phase) { return amp * sin(TAU * (k * phase + seed)); }
```

```glsl
// src/contracts/glsl/common.frag.glsl -- fragment stage only
// Pristine-grid lines (Ben Golus), per axis. Derivatives BEFORE fract. lw < 0.5.
// Written with increasing smoothstep edges: reversed or equal edges are undefined in GLSL.
// min(max()) rather than clamp(): clamp is undefined when its minimum exceeds its maximum,
// and deriv passes .5 across the whole far field.
vec2 pristineLines(vec2 uv, vec2 lw) {
  vec4 dd = vec4(dFdx(uv), dFdy(uv));
  vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
  vec2 draw = min(max(lw, deriv), vec2(.5));
  vec2 aa = deriv * 1.5;
  vec2 g = 1. - abs(fract(uv) * 2. - 1.);
  vec2 l = 1. - smoothstep(draw - aa, draw + aa, g);
  l *= clamp(lw / draw, 0., 1.);
  return mix(l, lw, clamp(deriv * 2. - 1., 0., 1.));
}
float pristineGrid(vec2 uv, vec2 lw) { vec2 l = pristineLines(uv, lw); return mix(l.x, 1., l.y); }
```

```glsl
// src/contracts/glsl/hero.glsl -- created by T00 with mode 0; ownership passes to T04. Signature frozen.
// Fragment stage only. rd is any finite vector; yScale in (0, 1]. rgb is premultiplied emission including the halo; a is opaque disc coverage. Composite c * (1. - s.a) + s.rgb, never mix(c, s.rgb, s.a).
// Reads only uPhases, uPal and uHero. Everything else this file declares is prefixed hero.
const vec2  HERO_C = vec2(0., .125);
const float HERO_R = .215;
vec4 sunDisc(vec3 rd, float yScale) {
  vec2 g = rd.xy / max(-rd.z, 1e-3); g.y *= yScale;
  vec2 p = (g - HERO_C) / HERO_R;
  float d = length(p), a = fwidth(d) + 1e-4, v = p.y;
  float f = fract(v * 9. + uPhases[1].x), b = fwidth(v) * 9. + 1e-4;
  float w = clamp((.42 - v) / 1.42, 0., 1.); w = .04 + .8 * w * w;
  float band = v > .42 ? 1. : smoothstep(w - b, w + b, abs(f - .5) * 2.);
  float m = (1. - smoothstep(1. - a, 1. + a, d)) * band;
  vec3 s = emit(mix(uPal[4], uPal[3], smoothstep(-.9, .75, v)), 1.05) * m;
  float e = max(d - 1., 0.);
  float halo = exp(-e * 2.4) * .30 + exp(-e * .7) * .10;
  return vec4(s + mix(uPal[4], uPal[2], .5) * halo * (1. - m), m);
}
```

### 8.3 tsconfig

Gave no diagnostics on the contracts and stubs above with `tsc` 6.0.3 [O]:

```json
{ "compilerOptions": {
  "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
  "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"],
  "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true, "isolatedModules": true,
  "verbatimModuleSyntax": true, "skipLibCheck": true, "noEmit": true } }
```

Without `types`, `?raw` imports fail with TS2307 [O]. `tsconfig.json` is this text plus `"include": ["src/**/*.ts"]`: with no `include` the whole tree compiled as one program and `process` in `src/` gave no diagnostic, while with it `process` gave TS2591 [O: T00 rehearsal]. `tests/` and config files use a second tsconfig with `"types": ["vite/client", "node"]`, because tests import `?raw` through `contracts/glsl.ts`.

## 9. Performance budgets

### 9.1 What was measured

| Scene, RTX 4070 SUPER, 1080p, HDR post | Sync p50 / p99 [O] |
|---|---|
| Spike, 6-level terrain, 24 rings, 1.25M tris, 45 draws, MSAA 4, trivial shaders | 1.3 / 2.2 ms |
| Art prototype, real shaders, mirror, 1.12M tris, 48 draws, MSAA 4 | 1.1 ms p50 |
| Art prototype, MSAA 0 | 0.8 ms p50 |
| SwiftShader, art prototype, 1080p, MSAA 0 | 386 ms |
| SwiftShader, spike, 1080p, full post | 319 ms |
| SwiftShader, spike, 360p, no post, 250k tris | 32 ms |
| SwiftShader, spike, 360p, no post, terrain only, 25k tris | 5 ms |

So in software, vertices dominate [I]. Tiers must cut vertices, not only pixels.

**R6 is not measured here.** The proxy: a typical mid-range GPU is assumed 4 to 8 times slower than this RTX [M/A], so a build at or under 2 ms on the RTX should land at 8 to 16 ms. That is an inference from one GPU. It says nothing about tile-based mobile GPUs. The final check is a real device (§14).

### 9.2 Budgets

| Budget | Limit | Status |
|---|---|---|
| Frame, 1080p, tier 3 | 16.6 ms on a mid-range GPU | Target, not measured |
| **Proxy gate:** GPU-synced frame, tier 3, RTX, real build, heaviest biome | p95 at or below 2.0 ms | [A] threshold; art prototype 1.1 ms. `forceZone` cannot select a biome (§8.1), so T09 scans `zoneAt` on an aperiodic page for real chunks and T09 and T11 measure all six |
| World streaming per frame (terrain rows + 1 prop row) | p99 at or below 2 ms | Spike p99 0.5 ms, max 0.8 ms [O]; phone assumed 5 to 8 times slower [A] |
| Sim per frame (up to 3 steps at 60 Hz) | at most 0.5 ms | [A], unmeasured |
| Layer `frame()` plus uniforms | at most 1 ms | [A] |
| UI plus audio scheduling | at most 0.5 ms | [A] |
| Warp or full refill | at most 30 ms, once | 16 to 20 ms [O] |
| Draw calls, tier 3 | at most 68 | Worst case 64 [arithmetic]: sky 1, nebula 1, terrain 6, rings 26, beams 2 (saucer and laser fence mix opaque and additive, §6.9), mirror 12, ship 2, lines 1, post 13 [O: T06 review probe, 2 * 6 + 1] |
| Triangles, tier 3 | at most 1.5M | Worst case about 650k [arithmetic] |
| Tier 0 on SwiftShader | at most 50 ms (20 fps) | [A]. 60 fps is not promised in software. Not divided between layers; the sky alone took 16.9 ms at 640x360 with no post [O: T04 rehearsal]. If the integrated build misses at T10, T03's `NO_SUN_COLUMN` and T04's `HERO_SUN_ONLY` compile the extras out, at the cost of a plain sun in software |
| Allocation in our hot paths | **zero** per frame in what our code asks for | Gated per URL class on the real build by the sampling profiler plus `usedJSHeapSize` windows (T09): project code outside `src/world` at most 512 B/frame [A; was 128 B, loosened by DI-78 after the app measured 296 to 377], `src/world` at most 20 KB/frame [A], libraries at most 32 KB/frame [A] |

`addUpdateRange` allocates one object per call [O], which is fine at chunk rate. Do not call it per instance per frame.

**Why not heap slope.** Slope across `gc(); gc();` read -0.14, .34, -.01 and 0 B/frame for true added allocations of 28, 136, 520 and 15,552 B/frame. Windows of `usedJSHeapSize` read exactly +28.0, +136.0 and +520.0, and the sampling profiler attributed 534 for a true 520 at the right URL [O: T09 rehearsal]. So slope is kept for leaks only (§9.3). The 128 B/frame line is the profiler's noise floor, not an allowance: it attributed 8 to 31 B/frame to a function that allocates nothing [O: T09 rehearsal].

**Why `src/world` has its own line.** `height` in §8.1 returns a double, and a double returned through a non-inlined call can be boxed. T01's rehearsal `height` read 50.3 to 60.3 B per sample in Chromium, 12,879 B/frame in `oct` and 2,590 in `height` for 216 samples, or about 15 to 19 KB/frame at T03's 310 samples per frame at 150 u/s [O and arithmetic: T09 rehearsal]. This is short-lived engine boxing on rows crossed, not objects our code creates, but it is a gap against R6's plain words, so it is recorded as §14 risk 18 and not hidden. T01 tries to remove the inner part, and T09 reports what remains at T10.

**Sub-budgets.** `performance.now` resolves .1 ms on these pages [O: T09 rehearsal], and `HarnessHost` has no UI or audio member. So T09 gates sums over frames as p95 or p50, and UI plus audio only as an upper bound: the residual of `runFrame` minus sim, layers and post. T02's, T07's and T08's own numbers are the precise ones.

Module tasks prove their pure paths with whatever separated cleanly for them: T01 a heap delta, T02 and T10 a median of short windows, T05 a GC event count, T08 sampling. Those are regression checks. Only T09's run on the real build establishes this budget.

### 9.3 Memory ceilings

| Resource | Ceiling | Basis |
|---|---|---|
| JS heap after GC | 64 MB | Spike 10.6 MB [O]; the real app will be larger [A] |
| Heap growth over soak | Total at most 1 MB, last three samples within 64 KB | Spike 10.34 to 10.594 MB over 723 km, last three identical [O] |
| `renderer.info.memory` geometries, textures | Constant after boot | Spike constant at 31 / 15 [O] |
| Scene audit | Object count and attribute bytes constant; pending update ranges 0 on visible meshes and at most 64 on hidden ones | `info.memory` does not cover these. The design has no growable JS pool: rings, atlas and sky are fixed at attach |
| Height atlas | 1.6 MB | 129 x 768 x 16 B [arithmetic] |
| Instance attributes | 0.2 MB | About 3,300 instances x 32 B plus rows |
| GPU targets, tier 3, 1080p | 160 MB | RGBA16F 16.6 MB per surface; (2 + 1 resolve) x 2 buffers, depth, bloom [arithmetic; drivers vary] |
| GPU targets, tier 4, 1440p | 465 MB | Same arithmetic: 295 color, 148 depth, 20 bloom. All three ceilings are upper bounds: with every variant rendering to screen, `outputBuffer` is never bound, so it should never allocate, which would halve the color and depth lines [I from source] |
| GPU targets, tier 2 | 40 MB | Same arithmetic |
| Dist JS, gzip | 260 KB | three plus these effects measured 148 KB gzip [O] |

## 10. Robustness

### 10.1 WebGL2 fallback

`index.html` contains a static CSS sunset poster and explanatory text, visible before any script runs. Its grid is a flat SVG path: a CSS `perspective` grid painted over sibling text under `--disable-3d-apis`, despite z-index and isolation [O: T10 rehearsal, cause not established], so neither the poster nor T08's fatal page uses a 3D transform. The poster cannot import T08's copy, so T10 writes it from `src/ui/copy.ts`, and a test compares the key phrases. `src/main.ts` checks WebGL2 and `EXT_color_buffer_float` or `EXT_color_buffer_half_float`, then dynamically imports `src/app/`, so unsupported clients never fetch three [I from a measured 604 KB bundle]. `new WebGLRenderer` is wrapped in try/catch, since three throws on failure [O]. Shader errors route through `renderer.debug.onShaderError` to the same fatal page, otherwise a failure is a silent black screen [I]. Missing float color buffers also gets the poster; an 8-bit tier is rejected because bloom thresholds at 1 stop working there [I].

### 10.2 Context loss

three calls `preventDefault` on loss and re-inits GL on restore [O]. On `webglcontextlost`: set `contextOk = false`, show the overlay, and keep the sim stepping. On `webglcontextrestored`:

1. Every `layer.rebuild(view)`: `clearUpdateRanges()` on the atlas and all instance attributes, refill from pure state, `needsUpdate = true`. **A non-empty `updateRanges` suppresses the full upload** [O: `WebGLTextures.js:865`, `WebGLAttributes.js:87`], so a restore or warp followed by partial writes leaves stale data and objects vanish.
2. `post.rebuild()`, then `post.precompile()`. Composer and bloom recovered without app code in tests [O]; re-baking is for our own render targets.
3. Do not cache `renderer.info`, `capabilities`, `extensions` or `properties`, since all are new objects after restore [O]. Never use `attr.onUpload(free)`: rendering then throws after restore [O].
4. No restore within 15 s [A]: fatal page with a reload button. Never recreate the renderer as recovery, since context limits evict the oldest [O].

Restore results on `WEBGL_lose_context` [O], with the composer rendering before the loss: 12 of 12 runs recovered with no GL error and no crash, across MSAA 0, 2 and 4 and 1080p and 360p, with or without rebuilding the composer, so rebuilding it is not required. Calling `restoreContext()` in the same task as the `webglcontextlost` dispatch is silently ignored and the restore never arrives; a second call 3 s later worked. A page left in that never-restored state survived 45 s (4 of 4) and then crashed the tab within 100 s (2 of 2), which is why the fatal page comes at 15 s. A simulated loss is not a real GPU reset (§14).

### 10.3 Reduced motion

Honoured from `prefers-reduced-motion` and a menu toggle, both owned by T08. World still moves.

| Reduced | Setting |
|---|---|
| Forward speed | x0.6, floor 27 u/s |
| Shake, roll, flash, speed lines, FOV pulses | Off |
| Bend, chromatic aberration, grain | Off |
| Pulses and blink waves | Slowest harmonic. The disc's band scroll is exempt: about 6 px/s [arithmetic: a 23 px band period over phase 4's 4 s, DI-63], not a pulse, and shared GLSL has no motion input |
| Glitch burst on hit | Off |

### 10.4 Hidden tabs

rAF stops [M]. On `visibilitychange` hidden: `audio.suspend()`, stop the scheduler timer. On return: `lastMs = now`, `resume()`, reset `nextNoteTime`. No catch-up simulation. dt is clamped to 0.25 s in any case, at most 30 sim steps. Hidden is the one time travel pauses; it is not a game state.

A real hidden tab cannot be reached under Playwright here: a second page, a minimized window and a frozen lifecycle state all left `visibilityState` `visible` [O: T10 rehearsal]. So tests cover the handler with a synthetic `visibilitychange` and the clamp with a minimized window, which throttled rAF to about 1 Hz. The real path is a human check (§14 risk 16).

### 10.5 Mobile

- `touch-action: none` on the canvas, viewport meta, `visualViewport` resize.
- `ResizeObserver` with `device-pixel-content-box`, falling back to `content-box` in a try/catch, since Safari has lacked that box [M]. Resized in rAF before drawing, always calling `renderer.setPixelRatio` and `composer.setSize` together [O: they desync otherwise]. The observer is only a trigger, and the ratio comes from `window.devicePixelRatio`: under Playwright's `deviceScaleFactor` 2, 1.5 and 3, `devicePixelContentBoxSize` reported CSS pixels [O: T10 rehearsal], so a ratio derived from it would silently render every emulated DPR at 1.
- `highp sampler2D` for the float atlas. Do not rely on mediump: this desktop reports 23 bits for mediump, so mediump bugs are invisible here [O].
- Audio state may be `interrupted` on iOS [M]; retry on the next gesture.
- Thermal throttling is handled only by the governor, whose display-limit hold can mask it (§6.10). Untested.
- `file://` is not supported: bundled module scripts need a static server [M]. Any static host works, with `base: './'` [O: ran from a nested path].

## 11. Test strategy

### 11.1 Finding a browser

Never a hard-coded user path. `tests/support/browser.ts` (T00) was type-checked and run against this machine's cache, where it found both executables and rejected a bad override [O]. Its relative paths are copied from `EXECUTABLE_PATHS` in Playwright 1.64.1's `coreBundle.js` [O]; only the Windows ones were exercised.

```ts
// tests/support/browser.ts
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RELATIVE = {
  gpu: ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux-arm64/chrome',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  software: ['chrome-headless-shell-win64/chrome-headless-shell.exe',
             'chrome-headless-shell-linux64/chrome-headless-shell',
             'chrome-headless-shell-linux-arm64/chrome-headless-shell',
             'chrome-headless-shell-mac-arm64/chrome-headless-shell',
             'chrome-headless-shell-mac-x64/chrome-headless-shell'],
} as const;

/** Env override first, then the newest cached revision. undefined means use Playwright's own default. */
export function findChromium(kind: 'gpu' | 'software'): string | undefined {
  const override = process.env[kind === 'gpu' ? 'TERRAIN_CHROMIUM' : 'TERRAIN_HEADLESS_SHELL'];
  if (override) {
    if (!existsSync(override)) throw new Error(`browser override does not exist: ${override}`);
    return override;
  }
  const prefix = kind === 'gpu' ? 'chromium-' : 'chromium_headless_shell-';
  const roots = [
    process.env['PLAYWRIGHT_BROWSERS_PATH'],
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'ms-playwright'),
    process.env['XDG_CACHE_HOME'] && join(process.env['XDG_CACHE_HOME'], 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  let best: { revision: number; path: string } | undefined;
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.startsWith(prefix)) continue;
      const revision = Number(name.slice(prefix.length));
      if (!Number.isInteger(revision) || (best && revision <= best.revision)) continue;
      for (const rel of RELATIVE[kind]) {
        const path = join(root, name, rel);
        if (existsSync(path)) { best = { revision, path }; break; }
      }
    }
  }
  return best?.path;
}
```

| Project | Launch | Purpose |
|---|---|---|
| `gpu` | `findChromium('gpu')`, headless, `--ignore-gpu-blocklist`, `--use-angle=d3d11` on Windows | Screenshots, identity, cracks |
| `gpu-timing` | Same, plus `--disable-gpu-vsync --disable-frame-rate-limit`, `--enable-precise-memory-info --js-flags=--expose-gc` | Frame timing, soak |
| `software` | `findChromium('software')`, `--use-angle=swiftshader --enable-unsafe-swiftshader` | Low-end stand-in, tier 0 |
| `no-webgl` | `--disable-3d-apis` | Fallback. `--disable-gpu` does **not** work for this: it falls back to SwiftShader [O] |

If discovery finds nothing, the suite fails with a message naming the env vars and `npx playwright install chromium`. The test asserts WebGL2 and the expected renderer string, so a run can't silently pass on the wrong rasterizer.

### 11.2 Commands

`npm run check` (tsc, eslint, vitest, GLSL grep gate), `test:browser`, `test:software` (the same specs on SwiftShader, DI-90), `test:forever`, `test:perf`, `test:art`.

| Layer | Runner | Covers |
|---|---|---|
| Unit | Vitest, `node` | World purity, determinism, visit-order independence, adjacent-row edges, non-flat noise at 1e9/1e12/1e15, zones never repeat, morph-on-parent exactness (T03's A2), `canWarp`, sim fuzz (1e6 steps per mode at chunk 0 and 2^40: speed floor, monotonic travel), golden hash, autopilot threads at least 80% of gates [A], `patternFor`, governor series |
| Boundaries | ESLint fixture | Forbidden imports fail |
| Module visual | Playwright, `dev/*.html` | Each render task screenshots alone on `FakeWorld` |
| Forever | Playwright, `gpu` | §11.3 |
| Perf | Playwright, `gpu-timing`, `software` | §11.4 |
| Smoke and e2e | Playwright | §11.5 |
| Art | Playwright, plus human review | §11.5 |

### 11.3 Forever harness (`?harness`, `window.__mv`)

`src/app/` imports `src/harness/` dynamically, and only when `?harness` is present, so a normal visit never fetches it. All of these have already run in spike form, except where noted.

| Test | Method | Spike result [O] | Required |
|---|---|---|---|
| **Pixel identity** | `periodChunks = 1024`; same phase at distant rows; byte compare | 0 differing bytes at world 6.4e7, 1e9, 6.4e13, 1e15, with 5 and 6 levels; 569k object pixels in the 5-level frame | Within the same-state bound (DI-58: on `gpu` at most 64 bytes and none over 1 level; on `software` 0 bytes), post off and MSAA off, one try. Then with post on, at MSAA 0 (DI-67: blended MSAA resolves differ between identical renders on D3D11): within the bound in the best of 5 attempts, each with a self-compare, failing at once beyond 64 bytes or a delta over 1. Then a 120-frame sequence (not yet done) |
| **Art-stack identity** | Same, with real shaders | Max diff 1/255 at 1.07e9 with objects hidden; real terrain clean by eye at 1e12 | At most 1/255 with objects on |
| **Cracks** | Magenta clear, flat shader, zero pitch and roll; any sky pixel under terrain in a column | 0 over 900 frames | 0, at world 0, 1e9, 1e15 |
| **Negative control** | Hole +4 cells must fail | 10.4M px | Must be non-zero, or the crack test itself fails |
| **Aperiodic warp** | World 1e9, 1e12, 1e15, 1e16 | Art prototype clean by eye at 1e12, one frame only | Shimmer metric within 1.25x of world 0 [A]; no NaN; non-flat |
| **Warp guard** | `warp(CHUNK_LIMIT, 0)`, `warp(2 ** 48, 0)` and non-integers; `warp(CHUNK_LIMIT - 1, 0)` must still work | Spike crashed without it | First three return false with state unchanged; the last returns true and passes the non-flat check |
| **Shimmer** | Mean frame diff, rows just under the horizon, 1.17 u step, **props hidden** (DI-74); all layers printed. Props have their own check: excess over a supersampled reference (T05, DI-74) | Filtered 4.7 vs naive 14.1 | At most 8 [A], and at or below a stored per-machine baseline. Little room: T03 read 6.27 to 7.42 on terrain alone, and T09's probe 8.102 with full post and no props [O]. A failure at T10 is a finding for T05 and T11, not a threshold edit |
| **Soak** | 72,000 frames, 600 u/s | 723 km, 10.34 to 10.594 MB | §9.3 ceilings, including the scene audit. 20 simulated minutes, not hours; operator runs a 2-hour real-time soak before release |
| **Context** | `forceContextLoss`, wait for the event, **yield a task**, `forceContextRestore` | Byte-identical with post off; 12 of 12 recovered with post on | Same, with travel still rising and no console error; plus never-restored reaching the fatal page |
| **Edge paint** | 21:9, `forceBend(8e-5, 0)`, `forceFov(CAMERA_FOV_MAX)`, terrain boundary rows painted | Not run | `fogK` = 1 on every boundary pixel. The harness cannot set camera x, so §6.4's worst row (-28.8) is covered only by T03's dev page, through `camX` in `ScriptedFrameOptions` |

**Why attempts on the post-on identity.** On the RTX a post-on frame can flip with no change in the world: one byte by 1/255, the same pixel across runs, by one half-float ulp in the scene target, sky only, lasting about 2 s after an idle of 2 s or more. Sticks and the direct path never flipped in 400 frames, a 3 s settle was not enough, and SwiftShader showed none in 4 repeats [O: T00 and T09 rehearsals]. The cause is not established; `--use-angle=gl` or a second GPU would separate the hypotheses. A real error repeats in every attempt, and this noise does not, so attempts keep 0 bytes, while a tolerance would also pass a real 1/255 error. T00's and T06's shell tolerance stays, since those test a different thing. **Amended by DI-58:** a flip on the RTX can persist once it appears, so a self-compare then reads 0 and attempts cannot remove it [O: T04's verifier, 1 to 41 bytes at 1 level, RTX only, 0 of 720 renders on SwiftShader]. Same-state comparisons on the `gpu` project therefore allow at most 64 bytes, none over 1 level, and `software` stays at 0 bytes. Real faults on record are far larger: 109,185 bytes for the band-scroll harmonic bug.

`setPost('off')` draws straight to a canvas with no depth buffer (§6.10), as the spike's post-off path did [O]. So the post-off runs prove coverage and data identity, not visibility. Anything that depends on depth, including the coarse levels' drop (§6.4), counts only from a post-on run.

**Four traps that produced false results in the spikes** [O]:

- `EffectComposer` sets `renderer.autoClear = false`, so direct renders stop clearing. The harness sets it true for crack mode. This made a first crack run meaningless.
- `updateRanges` must be cleared on warp (§10.2).
- Read pixels in the same task as the render, because the buffer reads empty after compositing without `preserveDrawingBuffer`. A later read can still succeed: the next `page.evaluate` with no composite between returned all 2,073,600 pixels, and one after a rAF or macrotask returned 0 [O: T09 rehearsal], so a careless test passes intermittently. `HarnessApi.pixels()` therefore throws outside the same synchronous run.
- `await lost; restoreContext()` runs inside the event dispatch and is ignored. This hung a driver until the tab crashed, and it was first mistaken for a composer bug. `HarnessApi.restoreContext()` therefore rejects until the loss has resolved.

### 11.4 Frame timing

**Use the 1x1 `readPixels` sync in a tight loop.** Calibration with a known-linear fullscreen fragment loop at 1080p [O]:

| Loop count | Sync wall p50 | Timer query p50 | rAF delta p50, vsync off |
|---|---|---|---|
| 1 | 0.3 ms | 0.01 ms | 0.3 ms |
| 256 | 1.6 ms | 1.31 ms | 0.2 ms |
| 1024 | 5.8 ms | 5.27 ms | 0.1 ms |
| 2048 | 11.1 ms | 10.54 ms | 0.1 ms |

Sync and timer query both track the load, about 0.4 ms apart. **rAF delta with vsync off does not track it at all**, and `gl.finish` also appeared not to block [O]. This resolves the art proposal's unresolved disagreement in one direction: in a tight loop on its scene, sync was 1.1 ms and timer query 0.55 ms [O]. Its earlier 5.6 ms timer figure came from an rAF-paced loop and did not reproduce; the cause was not established. The harness reports sync as primary and timer query as secondary, in a tight loop only. FPS tests must not use `page.clock`.

### 11.5 Smoke, e2e and art gates

- **Console:** fail on any console error or `pageerror`, and on `debug.onShaderError`. One context per page, or `Too many active WebGL contexts` evicts one [O]. A page with no icon link logs a 404 console error for `/favicon.ico` [O: T00 rehearsal], so T00's fixture answers it with 204 for all specs and `index.html` carries `<link rel="icon" href="data:,">`. D3D11 translator warnings reach `console.warn` through three, and the frozen `phaseAt` itself logs a dynamic-indexing one [O], so the shared fixture does not fail on warnings; T04's spec checks its own shaders for X4000.
- **Motion:** across DEMO, PLAY, CRUISE, SIGNAL_LOST, reduced motion and context loss, `travel` never moves backward on any frame and strictly rises across any 50 ms. Headless rAF ran at 6.1 ms p50 against an 8.33 ms sim step [O: T10 rehearsal], so many frames take no step, and rising on every step is T02's fuzz (§7.1). A control through `setManual(true)` must fail it. This is the R1 test.
- **Audio:** record `AudioContext` construction and `start()` through `addInitScript`, and assert none before the first real click. **`page.evaluate` runs with `userGesture: true`**, so a naive test passes wrongly [O: `coreBundle.js:36971`]. `locator.waitFor`, `waitForSelector`, `locator.isVisible` and `waitForFunction` also grant activation, and `locator.click` is void [O: T10 rehearsal]. Before the gesture, a test waits only on a console signal, and it gestures with `page.mouse`, `page.keyboard` or touch input. Launch fires on `pointerup`, `click` or a filtered `keydown`, because touch `pointerdown` does not activate and a touch drag never fires `click` [O: T08 rehearsal].
- **Network:** the request log on `dist/` from a nested path shows no external fetch.
- **Touch:** `hasTouch` drag. **Reduced motion:** `emulateMedia`. **Fallback:** `no-webgl` project shows the poster.
- **Deterministic frames:** `harness.renderAt`, not wall time. For DOM animation, `page.clock.install` first. Screenshots are per-machine references, never cross-GPU [from Playwright docs].
- **Art gates (T11):** the wash-out gates of §6.7 on every sample, shimmer at or below baseline, sky gradient step for banding, disc occlusion at most 15% by area in non-canyon zones [A] (per pair, the least occluded of five samples, with the player's ship masked out by a fixed mask made from its own projected geometry: T11 M2 and A24, DI-105, DI-111. This gives up items crossing the disc, which are not gated on real pixels, and the mask's 4.78% of the disc at its foot, which is never measured. A pair passes when one sample in five is clear: a keep-out twenty times too weak, `KEEPOUT_K` = 1, failed only 1 of 6 Neon City pairs, so T01's CPU keep-out test is the main guard for scenery over the disc), clipped-pixel histogram, and a **contact sheet of all 36 palette-biome combinations for human review**. Numbers catch regressions; they do not establish beauty.

## 12. Task decomposition

`architecture.md` and `Agents.md` come first. Each task then writes its plan file before any code, using the format in `Agents.md`. Ownership below is exclusive: a task edits only its own paths. Contract changes go through T00 by plan amendment.

| Id | Scope | Owns exactly | Depends on | Plan file |
|---|---|---|---|---|
| **T00** | Scaffold, contracts, core, fakes, browser discovery, boundary gate, GLSL grep gate, plan overlap check | `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.gitignore`, `scripts/**`, `src/contracts/**`, `src/core/**`, `src/testing/**`, `tests/support/**`, `tests/boundaries/**`, `tests/unit/core/**`, `plans/README.md`, `plans/T00-foundation.md` | none | `plans/T00-foundation.md` |
| **T01** | World: noise, height, zones, palettes, biomes, scatter, keep-out, grounding, items | `src/world/**`, `tests/unit/world/**`, `plans/T01-world.md` | T00 | `plans/T01-world.md` |
| **T02** | Sim rules, collision, autopilot, objectives, feel | `src/sim/**`, `src/feel/**`, `tests/unit/sim/**`, `tests/unit/feel/**`, `plans/T02-sim-feel.md` | T00 | `plans/T02-sim-feel.md` |
| **T03** | Terrain: clipmap, atlas, floor and mountain shading, pulses, sun column | `src/render/terrain/**`, `dev/terrain.html`, `tests/visual/terrain.spec.ts`, `tests/unit/terrain/**`, `plans/T03-terrain.md` | T00 | `plans/T03-terrain.md` |
| **T04** | Sky: gradient, disc modes, stars, nebula, events | `src/render/sky/**`, `src/contracts/glsl/hero.glsl` (after T00 hand-off), `dev/sky.html`, `tests/visual/sky.spec.ts`, `tests/unit/sky/**`, `plans/T04-sky.md` | T00 | `plans/T04-sky.md` |
| **T05** | Props: builders, neon material, rings, mirror, 20 archetypes, 6 items, ship | `src/render/props/**`, `dev/props.html`, `tests/visual/props.spec.ts`, `tests/unit/props/**`, `plans/T05-props.md` | T00 | `plans/T05-props.md` |
| **T06** | Post and quality: composer, variants, Crt, speed lines, tier table, governor | `src/render/fx/**`, `dev/fx.html`, `tests/visual/fx.spec.ts`, `tests/unit/fx/**`, `plans/T06-post-quality.md` | T00 | `plans/T06-post-quality.md` |
| **T07** | Audio: graph, pure composer, scheduler, ducking | `src/audio/**`, `dev/audio.html`, `tests/unit/audio/**`, `tests/visual/audio.spec.ts`, `plans/T07-audio.md` | T00 | `plans/T07-audio.md` |
| **T08** | UI and input: HUD, title, cruise menu, overlays, fatal text, controls, bests, the reduced-motion setting | `src/ui/**`, `src/input/**`, `dev/ui.html`, `tests/unit/input/**`, `tests/unit/ui/**`, `tests/visual/ui.spec.ts`, `plans/T08-ui-input.md` | T00 | `plans/T08-ui-input.md` |
| **T09** | Forever and perf harness: `window.__mv`, test modes, metric helpers, gate suites | `src/harness/**`, `tests/forever/**`, `tests/perf/**`, `tests/unit/harness/**`, `plans/T09-harness.md` | T00 | `plans/T09-harness.md` |
| **T10** | Integration: composition root, loop, lifecycle, boot, fallback page, e2e | `index.html`, `src/main.ts`, `src/app/**`, `tests/e2e/**`, `tests/unit/app/**`, `plans/T10-integrate.md` | T01-T09 | `plans/T10-integrate.md` |
| **T11** | Art pass: tune across modules, all gates green, operator review | Temporarily `src/render/**`, `src/world/palettes.ts`, `src/world/biomes.ts`, `src/contracts/glsl/hero.glsl`, `src/feel/tuning.ts`, `src/sim/tuning.ts`; permanently `tests/art/**`, `plans/T11-art-pass.md` | T10 | `plans/T11-art-pass.md` |
| **T12** | Public release: README, licence, third-party notices, contributing guide, screenshots, GitHub Pages workflow | `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `CONTRIBUTING.md`, `docs/screenshots/**`, `.github/**`, `plans/T12-release.md` | T10 | `plans/T12-release.md` |

Parallelism:

```
T00 (serial, first)
 |-> T01 T02 T03 T04 T05 T06 T07 T08 T09   (fully parallel, against fakes)
      |-> T10 (serial)
           |-> T11 (serial; nothing else writes while it runs)
           |-> T12 (release files and deploy only; no path in T11's window)
```

- T03 to T06 get screenshots before integration through `dev/*.html` and `startDevShell`, using `createFakeWorld()`.
- T09 builds against the same fakes and `createFakeHost()`, and its suites arm for real at T10, when `app/` implements `HarnessHost` and calls `createHarness`. T10 is not done until they pass on the integrated build.
- **A defect found at T10 stays in its owner's paths.** T10 does not edit another task's files. It records the defect in its own plan, and that task's plan is reopened by the operator or, in a one-go build, the orchestrating reviewer (see Deviations in `Agents.md`), and fixes it. T10 waits, which is the point: T01 to T09 are finished by then, so nothing else is writing.
- T11 is the one task that crosses ownership. It exists because seven parallel owners will not produce one coherent look by themselves [I]. It may change `src/contracts/index.ts` only through the numeric exception in §8. Inside its window it changes values and shader constants only: `hero.glsl`'s three signature lines stay byte-exact, `src/feel/tuning.ts` stays inside the ranges in `FeelState`'s comment, and `src/sim/tuning.ts` changes only on an operator finding from playing it (§14 risk 3). Anything else it needs changed (`src/ui/**`, `src/audio/**`, `src/world/zones.ts`, `scatter.ts`, `items.ts`, `height.ts`) reopens its owner.
- **T11's pin rule.** A test in another task's files that asserts a value T11 legally retuned is edited by T11 itself, expected-value lines only, each with a row in T11's ledger and a Decision log entry, and the reviewer agrees to the batch once, at T11's M9. The same goes for `fakeProfile`'s table in `src/testing`, which copies T06's. These lines stay out of T11's `owns`. A test that fails for any other reason is a defect and goes to its owner.

Definition of done for every task: its plan's acceptance list passes, `npm run check` is green, and it reports what it did not verify. A check that only a person or an absent device can run is a human check: it does not block `done`, it stays listed as not verified, and T11 collects them all for the operator (`Agents.md`, Definition of done). T11 itself exists for the operator's verdict, so it ends its agent stage `blocked` with its pack ready, and the build is not finished until the operator has answered.

## 13. Decision log

| Decision | Source | Rejected, and why |
|---|---|---|
| **Ribbon addressed by integer chunks, no rebase** | Infinity | 2D chunk grid and pool: adds queues and bursts a forward-only world doesn't need. Discrete floating-origin rebase: a cross-system event that can pop |
| **One-axis clipmap on a height ring, 6 levels** | Infinity's mechanism, extended to 6 levels to keep the art prototype's 6 km reach. Tested at final design stage: +19k tris, identity and cracks still 0 [O] | Art's 24 chunk meshes of 1.12M tris: more vertices, which SwiftShader shows is what costs, plus chunk upload bursts. Skirts: grid lines would need excluding, and overlap plus morph measured 0 cracks |
| **T = 4096 period rule** | Art | Infinity's 64 u limit: too short for pulses and ripple. Combined with Infinity's exact `chunk` arithmetic |
| **Tick-derived phases with no accumulator** | New, replacing all three proposals' phase schemes | Art's `(t/period)%1`, Infinity's `phase += dt/P`, Game's `uLoop`: all drift or depend on dt. Integer-tick phases are exact and let one call reproduce a frame |
| **Own lattice noise** | Infinity and Game, independently | `simplex-noise`: silent zero past 1.57e9 [O]. A frequency ceiling would also pass R1, but leaves a silent failure for a saving of 40 lines |
| **Main-thread generation, no worker** | All three agreed | Worker saves under 1 ms and adds late rows, ordering problems and async tests. `height` is pure, so moving it later stays possible |
| **Global FIFO rings with shader retirement** | Infinity | Per-chunk instancing: 26 types x many rows of draws. `BatchedMesh`: its only per-instance data is `setMatrixAt` and `setColorAt`, so anything else needs a texture [O] |
| **View bend, fixed sun, flat rules** | Art | Game's sum-of-sines path: real curves lose the framing and complicate sim, autopilot and collision. Cost accepted: geometry is false and culling is off |
| **Art's height envelope, palette, luminance budget, sky, floor, mirror, roster** | Art | Art's reversed `smoothstep` edges: worked on this GPU but undefined in GLSL [M]; replaced by research's `1 -` form. Art's sun height drift: breaks the invariant. Art's K = .02: stricter than the terrain itself. Art's `aG` baked attribute: unneeded, since `uTravel` plus forward distance gives the same result without a vertex attribute |
| **Merged single post pass per variant, shared effects** | Art's merge, Infinity's variant swap, research's `renderToScreen` recipe. Sharing effects tested at final design stage [O] | Game's two passes: exists only for SMAA and CA. Effect `DST` as a saving: recompiles, draws stay [O]. Art's "tiers rely on toggling": disabled last pass paints nothing [O] |
| **Neutral tone mapping, set explicitly** | Art, measured | AgX default: turned neon pastel [O]. Research declined to choose without a real scene; Art supplied one |
| **Custom Crt, no Noise or Scanline** | Art, reason corrected | Art's reason (grain decays over hours) was refuted by research's GPU run [O], and `material.time` can be set by hand anyway [O]. The surviving reasons are an integer scan period and one effect doing scan, grain and the final alpha write |
| **Rail-flight score game: SYNC, gates, graze, boost, shields, SIGNAL_LOST, sectors, CRUISE** | Game | Infinity's minimal steer-and-gates: too thin for "feels like a game". Game's ±24 window: narrower than the road; widened to ±40, y 2 to 14 [A] |
| **Pure sim, fixed 120 Hz, injected world, one `step()` for player and autopilot** | Game | Variable-step sim: no golden hash, rules depend on frame rate |
| **`{chunk, local}` in `SimState`** | Infinity, into Game's contracts | Game's `s: f64` and `prevS`: fine at 1e9, but 0.125 u ulp at 1e15, and contract interpolation would mix large numbers |
| **Frozen contracts, factories, per-directory import rules** | Game | Art's `FrameState` and Infinity's `contracts.ts`: less complete |
| **`dev/` harness pages per render task, T11 art pass** | Game | Parallel render owners with no pass to unify the look |
| **Forever harness with negative controls, sync timing** | Infinity | rAF deltas: showed 0.1 ms under a 10 ms load [O] |
| **Numeric art gates and a contact sheet** | Art | Trusting stills: temporal shimmer and variety would ship unseen |
| **Governor with slow upshift probes** | Infinity's rate limits, changed | Infinity's "up under 11 ms": unmeasurable in production, since a vsync-paced rAF never shows under 16.6 ms on a 60 Hz display |
| **No SMAA, no `stats-gl`, no `simplex-noise`, no R3F, no WebGPU, no TS 7, no worker** | Mostly research | See §2 and §6.6. WebGPU: a future option only if the post stack is replaced |
| **256-column top tier** | Rejected from Infinity | Affordable [O], but a second layout for detail that fog and speed hide |
| **`glslVersion` unset** | Research | The task brief's probe used GLSL3, proven at type level only. At runtime it removes the `gl_FragColor` define and `<colorspace_fragment>` fails [O] |
| **Fallback poster when float color buffers are missing** | New | An 8-bit tier: bloom threshold breaks, and it would be untested |
| **Plan reconciliation, design issues: wash-out gates, OKLCh crossfade, Arctic Laser's disc, allocation gates, T11's window, human checks** | T00 owner, acting for the operator. Each decision and its reason is in `plans/RECONCILIATION.md` | Heap slope as an allocation gate: read 0 for a 15.5 KB/frame allocator [O]. Near-white and chroma alone: both pass a visibly flooded frame [O]. Day-phase sky saturation: breaks the fog match or costs chroma [O]. Blocking `done` on checks no agent can run: would stall an unattended build, so they are listed and handed to the operator |
| **Plan reconciliation, contracts and seams** | T00 owner, acting for the operator. Each decision and its reason is in `plans/RECONCILIATION.md` | `HarnessHost.overridePitch`: `overrideFeel` covers zero pitch and the haze reference with one member. `feel.duck` as the source of the hit duck and `sim.sync` as the blip chain: a per-frame value cannot give a flat 400 ms, and SYNC moves at most once per gate |

## 14. Open risks

| # | Risk | Status | What would resolve it |
|---|---|---|---|
| 1 | **Mid-range and mobile GPU performance.** Every GPU number is from one RTX plus SwiftShader. Vertex-texture precision on mobile, tile-based MSAA cost and thermal throttling are all unmeasured | Open, high stakes for R6 | A run on a real integrated GPU and a real phone. The proxy gate (§9.2) cannot substitute |
| 2 | **Whether it looks beautiful across zones.** One palette, four object types and no zone transition have been seen, all judged by one reviewer from stills | Open | Contact sheet of 36 combinations and a screen recording, reviewed by the operator at T11 |
| 3 | **Whether it is fun.** No available test measures this. Every rule number is unplaytested | Open | Human playtest: handed over at T10, answered at T11's operator review. `src/sim/tuning.ts` and `src/feel/tuning.ts` are in T11's window for the retune this will need |
| 4 | **Temporal quality.** Shimmer was measured for one camera step on a prototype, without moving objects, and the limit of 8 has little room (§11.3). Bloom flicker from subpixel far objects and orb aliasing (seen [O]) are untested in motion | Open | Captured frame sequences with objects on, at T05 and T11. A shimmer failure at T10 goes to T05 and T11 as a finding |
| 5 | **Context recovery beyond the simulated case.** The spike crash traced to a driver restoring too early (§10.2), but the cause of the later tab crash in the never-restored state is not established. It was seen only in headless Chromium, and did not reproduce over 120 s on T10's simpler rehearsal scene [O], so the fatal page's survival on the real scene is unverified. Real GPU resets, restore during a tier change, and variants sharing effects across a restore are all untested | Open | Context suite at T10 covering those combinations, plus one real driver reset on a device where that is safe |
| 6 | **Unattributed allocation**, about 1.2 KB/frame in the spike | Open. On T09's probe stack about 3.7 KB/frame at about 18 draws, all in three.js [O] | T09's sampling profile on the real build at T10, pasted into T09's Outcomes. If it is inside three, record it under the libraries line of §9.2 |
| 7 | **Soak length.** 20 simulated minutes, not hours | Open | 2-hour real-time soak before release, operator-run |
| 8 | **R1 versus accessibility.** A player cannot freeze the screen, even under reduced motion. WCAG's pause requirement [M] is not met | **Operator decision** | Operator chooses: accept, or add a "still frame" option that deliberately overrides R1 |
| 9 | **Far mountain quality.** Sag reaches 100 u at the coarsest level, and the sag gate may thin objects on the best ridges. Six-level silhouettes have only been crack-tested, not reviewed | Open | Screenshots at T03; if needed soften ridges in `height` or add `riseWidth` by biome |
| 10 | **Pop-free tier switches** (terrain stride, density ramp) are designed and have never run | Open | T06 and T09 frame-diff across a forced switch |
| 11 | **Art budget against the 2 ms proxy.** Nebula render target, mirror, Crt at DPR above 1, and 26 archetypes together are unmeasured. Crt scan period has been tested at DPR 1 only | Open | T09 perf suite at T10, and DPR 1, 1.5 and 2 screenshots at T06 |
| 12 | **Sun keep-out K = .05** is derived, not rendered, and leaves the upper slope bare (§5.6) | Open | Disc-occlusion and density gates at T11, then the operator's answer on empty stretches |
| 13 | **Sim cost at 120 Hz** on a slow phone is unmeasured | Open | T02 Node benchmark, then a device run |
| 14 | **Playwright revision skew.** Tests run on chromium-1234, not the 1248 that 1.64.1 expects. Basic launch and screenshots work [O]; other API skew is possible. `recordVideo` does not run here at all: it wants `ffmpeg-1013`, and only `ffmpeg-1011` is cached [O: T10 rehearsal]. CDP screencast is the replacement | Open, low | `npx playwright install chromium` on a machine where that is acceptable, or upgrade together |
| 15 | **Whether the soundtrack sounds good.** No agent has heard it. T07's objective gates prove notes, levels and timing only | Open, human check | The operator answers T07's H1 to H13 through T11's pack. A defect reopens T07 |
| 16 | **A real hidden tab.** Not reachable under Playwright here (§10.4) | Open, human check | The operator switches tabs for 30 s and watches for no jump and no audio burst on return |
| 17 | **The governor's display-limit hold may mask real throttling** (§6.10). A hold that expires, or a one-step probe that reverts if p50 does not improve, are the candidate fixes | Open | A real device that slows after some minutes. If it stays at its tier and stutters, reopen T06 |
| 18 | **`height` allocates in the browser** (§9.2), through boxed doubles the frozen contract returns. An additive row-filling method on `WorldSource` would remove the boundary part if T01's inner fix is not enough | Open | T01's scratch measurement, then T09's profile on the real build at T10, against 20 KB/frame [A] |
| 19 | **Audio allocates while the JIT is cold.** About 260 B per 60 Hz frame for tens of seconds after start, against §9.2's 128 B line, from engine boxing in `frame()`; 5 B when warm [O: T07's verifier] | Open (DI-60) | A sampling profile of the real build in its first minute with audio running, at T10 or T11. Audio is inert under the harness, so no gate sees it |
