---
id: T09-harness
title: Forever and perf harness - window.__mv, test modes, metric helpers, gate suites
status: done
owner: T09 executor
depends_on: [T00]
owns: [src/harness/**, tests/forever/**, tests/perf/**, tests/unit/harness/**, plans/T09-harness.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/testing/**, tests/support/**, plans/RECONCILIATION.md, plans/T00-foundation.md, plans/T01-world.md, plans/T02-sim-feel.md, plans/T03-terrain.md, plans/T04-sky.md, plans/T05-props.md, plans/T06-post-quality.md, plans/T07-audio.md, plans/T08-ui-input.md]
updated: 2026-11-06T10:59Z
---

## 1. Purpose

After T09 and T10, R1 and R6 stop being claims and become commands that can fail. What an operator can run and see:

1. `npm run test:forever` proves the world is correct at huge distance: pixel-identical frames at 1e9 and 1e15 u, zero terrain cracks, fog hiding the terrain's far edge, a guarded warp limit, recovery from context loss with travel still rising, and stable memory over a 720 km soak.
2. `npm run test:perf` reports GPU-synced frame time, sub-budgets, draw counts, tier 0 cost in software, bundle size, and **how many bytes per frame each part of the code allocates**, with three's share attributed by function. That closes §14 risk 6.
3. Every gate is shown able to fail. A shader using an absolute float32 coordinate fails identity. A naive grid fails shimmer. A flood of thin neon fails wash-out while near-white and chroma still pass. A 256-byte-per-frame allocator moves the allocation number by 256. A static import of the harness fails the isolation test.
4. A normal visit never fetches the harness. The request log of a built site from a nested path proves it, and a build with a static import proves the test can see the difference.
5. A test written carelessly gets an exception, not a false pass: `pixels()` outside the render's synchronous run throws, `renderAt` outside manual mode throws, and `restoreContext()` inside the loss dispatch rejects without touching GL.

Built against `createFakeHost()` and a real-GPU fixture before T10 exists. The suites that need real terrain, props and UI **arm at T10**, and T10 is not done until they pass (§12).

## 2. Context and orientation

Working directory for every command: `C:\highsierralabs\terrain`. It is not a git repository. `§n` means a section of `architecture.md`. T00 must be `done` before M1. T09 runs in parallel with T01 to T08, so sibling files may be half-written; T09 imports none of them (§3.2), uses port `5109` and `--output=test-results/T09*`, and checks itself with `npm run check:task -- T09`.

Terms:

- **Host:** an object implementing `HarnessHost` (§8.1). `createHarness(host)` is T09's only entry point, and T09 sees nothing else of the app.
- **Fake host:** `createFakeHost()` from `src/testing/fakeHost.ts`. Records calls. Used in Node unit tests.
- **Shell target:** `tests/forever/fixture/shell.html`, T09's own page. It adapts `startDevShell` to `HarnessHost`, with T00's proof layer (sky plus grid floor) and T09's small real composer stack. Real GPU pixels, real bloom and real three allocation, with no T10. It has no terrain, props or UI.
- **App target:** `/?harness`, the integrated build. Exists from T10.
- **Armed spec:** one that needs the app target. It skips with a message beginning `UNARMED` until `index.html` exists, then must run.
- **Lab:** `window.__mvLab`, T09's own page-side toolbox: metrics, audits, sweeps, negative controls. `window.__mv` is the frozen contract; the lab is an implementation detail that T09's and T11's specs use.
- **Manual mode:** `manual(true)`: the rAF loop is stopped, and the harness drives frames.
- **Same run:** the synchronous stretch of JS between a render and the next microtask checkpoint.
- **Band:** rows counted from the top of the frame. `pixels()` is bottom-up, as `gl.readPixels` returns it, so row `r` is `y = H - 1 - r`. Metric helpers take rows from the top.
- **Code value:** one step of a final 8-bit channel, 0 to 255.
- **Signature of driver noise:** at most 16 differing bytes, each differing by 1 code value. See section 10.
- **Same-state bound (DI-58):** when two renders of one state count as the same frame. On the `gpu` project at most 64 bytes differ and none by more than 1 level; a byte over 1 level fails at once. On `software`, 0 bytes. `src/harness/sweeps.ts` holds it as `GPU_SAME_STATE` and `EXACT`, and specs take it from `sameStateTolerance(info.project.name)` in `tests/forever/support/open.ts`. It applies to every comparison T09 gates between two renders of one state (DI-68): A6's `distant` and `again`, A8 to A11, A14's controls-off check, B3, B4, B12 and B14. Comparisons between different states, such as liveness and the controls that must differ, keep their own limits.
- **MSAA 0 for same-state compares (DI-67):** on `gpu`, every same-state comparison above runs at MSAA 0, post on or off. Through D3D11, blended draws resolved at MSAA 2 or 4 differ between identical renders by up to 173 B, past the bound, while MSAA 0 and Vulkan read 0 [T05 O]. MSAA keeps its coverage in the cost, look and tier rows, which do not compare bytes, and in one print-only identity run under `--use-angle=vulkan`.

**Where the evidence comes from.** Every `[O]` below was run on 2026-11-05 in a throwaway page in the session scratchpad, on the RTX 4070 SUPER with the pinned `three` 0.187.0, `postprocessing` 6.39.6, Vite 8.3.5, and Chromium 151.0.7922.34 from `chromium-1234`. The stack was T06's probe: sky through `skyGrad` and `sunDisc`, 400 instanced neon sticks, merged `EffectPass` variants with CA, bloom, tone mapping, Crt and vignette, at 1080p. It is not project code, may be gone, and none of it counts as acceptance. `[A]` is an unconfirmed starting value. The executor runs everything again.

## 3. Scope

**Owned, and the complete file list:**

| Path | Contents | Three? |
|---|---|---|
| `src/harness/index.ts` | `createHarness`, only export. Top-level side effect writes the chunk marker. Declares `Window.__mv`, `Window.__mvLab` | no |
| `src/harness/api.ts` | `HarnessApi` over `HarnessHost` | no |
| `src/harness/sync.ts` | 1x1 sync, full read, same-run guard, using a module-scope scratch | no |
| `src/harness/metrics.ts` | Pure functions on RGBA arrays and number arrays. Imported by Node tests and exposed on the lab | no |
| `src/harness/audit.ts` | Scene walk, finite checks, non-flat check, biome search | three types only |
| `src/harness/sweeps.ts` | `settle`, `compareAt`, `sequence`, `shimmer`, `washoutAt`, `crackSweep`, `edgePaint` | no |
| `src/harness/budget.ts` | Timing wrappers, tight-loop frames, allocation windows, heap calibration | no |
| `src/harness/controls.ts` | Scene-injected negative controls | yes |
| `src/harness/hotProbe.ts` | `probeFrame`, `allocTick`, `slotsFor`, in their own file so the profiler attributes them to one URL. `probeFrame` holds a dead branch that keeps it over V8's inlining limit, see section 10 | no |
| `src/harness/lab.ts` | `HarnessLab` type and `createLab(host, api)` | no |
| `tests/unit/harness/*.test.ts` | `metrics`, `api`, `sync`, `sweeps`, `audit`, `budget`, `backend` (R3), `support/glStub.ts` | |
| `tests/forever/support/open.ts` | `target()`, `openHarness`, `lab` typing | |
| `tests/forever/support/spies.ts` | `addInitScript` for the `linkProgram` spy | |
| `tests/forever/support/restore.ts` | B12's held wait, `renderUntilRestored`, at a tick that advances by T08's panel throttle (R3). No runtime import, so a probe can drive this exact function | |
| `tests/forever/support/backend.ts` | `notVulkanReason`: the Vulkan spec's backend check and its DI-71 skip, which also rejects SwiftShader (R3) | |
| `tests/forever/support/baseline.ts` | Per-machine baseline read and write | |
| `tests/forever/support/distServer.ts` | `node:http` server for a build folder under `/some/nested/path/` | |
| `tests/forever/fixture/shell.html`, `shellHost.ts`, `labPost.ts` | Shell target. `shellHost.ts` runs its own rAF loop that steps the sim until `manual(true)`, and with `?follow=1` takes `camX` from the sim (section 5, M3) | |
| `tests/forever/fixture/fake.html` | Page for `api.fake.spec.ts`: a few inline lines, `createHarness(createFakeHost())` | |
| `tests/forever/fixture/iso/` | `vite.config.ts`, `dynamic/index.html`, `dynamic/main.ts`, `dynamic/app.ts`, `static/index.html`, `static/main.ts` | |
| `tests/forever/*.spec.ts` | `armed`, `api.fake`, `identity`, `identity-vulkan` (print-only, DI-67), `traps`, `shimmer`, `washout`, `isolation`, `warp`, `cracks`, `edgepaint`, `context`, `tierswitch`, plus `soak.timing`, `soak-realtime.timing` | |
| `tests/perf/support/heap.ts` | CDP profile helper and URL classifier; B19's class lines (`classLimitProblems`) and its windows control by target (`WINDOWS_CONTROL`, `windowsControlCheck`) as pure code the unit suite tests | |
| `tests/perf/*.spec.ts` | `alloc.timing`, `frame.timing`, `budgets.timing`, `software`, `bundle` | |
| `plans/T09-harness.md` | This plan | |

**Read-only:** `src/contracts/**`, `src/core/**`, `src/testing/**`, `tests/support/**`, including T00's `tests/support/devshell/trivialLayer.ts`, which the shell target loads. Also all other plans.

**Non-goals:**

- No `src/app/`. T10 implements `HarnessHost` and calls `createHarness`. The exact shape T10 needs is in the seams table.
- No art judgement. T09 supplies wash-out and shimmer metrics and one default-frame gate. The 36-combination contact sheet and final thresholds are T11's (§11.5).
- No re-proving of T03's crack margin on its dev page, or T06's card gates. T09 re-proves the integrated path.
- No per-octave non-flat test: T01's is the real guard. T09's only proves integration (T01 seam).
- Audio stays outside these gates. Under `?harness` no gesture happens, so audio is inert (T07 seam).
- No GPU memory measurement. §9.3's GPU target ceilings stay arithmetic, since WebGL exposes no such number.
- No mid-range or phone numbers. Those are §14 risk 1, and only a real device resolves them.
- The 2-hour real-time soak is run by the operator. T09 supplies the spec, off by default.

## 4. Interfaces

**Consumed:**

- `src/contracts/index.ts`: `HarnessApi`, `HarnessHost`, `HarnessStats`, `CreateHarness`, `Sim`, `SimState`, `RenderLayer`, `LayerName`, `DebugMode`, `DebugPaint`, `CRACK_CONTROL_GROW`, `PostStack`, `PostVariant`, `Governor`, `Tier`, `RenderContext`, `WorldSource`, `ZoneState`, `FeelState`, `HeroMode`, `SimMode`, `Biome`, `PaletteId`, `CAMERA_PITCH`, `CAMERA_FOV_MAX`, `CHUNK_LIMIT`, `ZONE_CHUNKS`, `PALETTE_FLOATS`.
- `src/core/coords.ts`: `between`, `canWarp`.
- `src/testing/`: `createFakeHost`, `startDevShell`, `createFakeWorld`, `scriptedFrame`. `tests/support/devshell/trivialLayer.ts`: `createTrivialLayer`.
- `tests/support/pw.ts`: `test`, `expect`, `saveShot`. `tests/support/rasterizer.ts`: `checkRasterizer`. T09 calls `checkRasterizer(info.project.name, webgl2, renderer)` with `lab.rendererInfo()`, and does not use `openDevPage` or `expectRasterizer`, because those are specified around `window.__shell`.
- Sibling requests T09 depends on, all in §8.1: `CRACK_CONTROL_GROW`, `RenderLayer.setCrackControl?`, `HarnessApi.setCrackControl` (C-18), `DebugPaint` (C-19), `Sim.forceSignalLost` (C-14), `Biome`, `PaletteId` (C-10). T09's own are in section 12.

**Provided: `src/harness/index.ts`**

```ts
export function createHarness(h: HarnessHost): HarnessApi;   // assignable to CreateHarness
```

`createHarness` builds the API and the lab, sets `window.__mv` and `window.__mvLab` through `globalThis`, and returns the API. `ready` is `true` from that moment, so `app/` must call it only after boot has finished (see seams). Module load writes `globalThis.__mvHarnessChunk = 'MV-HARNESS-CHUNK'`. That side effect is deliberate: an unused exported constant was removed by the build [O].

**`HarnessApi` behaviour.** The types are §8.1. This table is what they mean.

| Member | Host call | Behaviour |
|---|---|---|
| `ready` | | `true` once created |
| `manual(on)` | `setManual(on)` | Remembers `on` |
| `warp(c, l)` | `sim.warpTo(c, l)` | Returned as is. T09 does not pre-validate, so the warp-guard test exercises the sim's own check |
| `renderAt(c, l, t)` | `renderState(c, l, t)`, then 1x1 `readPixels` | Throws unless manual. Throws a `RangeError` unless `c` is an integer in [0, CHUNK_LIMIT + 1024), before the loss check, so also while lost (DI-93); the core's `renderState`, the one route to the host for every harness frame and lab sweep, refuses the same range. Returns ms including the sync. Returns `NaN` if `gl.isContextLost()`. Arms the same-run guard |
| `stepFrames(n, dt)` | `runFrame(dt)` n times | Throws unless manual, or if `n` is not a non-negative integer or `dt <= 0`. Arms the guard |
| `setPost(v)`, `setMsaa(n)` | `post.forceVariant(v)`, `post.forceMsaa(n)` | Apply at the next frame (T06 seam) |
| `setLayerVisible(name, on)` | the named layer's `setVisible(on)` | Throws on an unknown name |
| `setCrackMode(on)` | see below | Idempotent; `false` restores what `true` saved |
| `setEdgePaint(on)` | see below | As crack mode, with `'edge-paint'`, and no pitch change |
| `setCrackControl(on)` | `layer.setCrackControl?.(on ? CRACK_CONTROL_GROW : 0)` on all layers | With `on` true and no layer implementing it: **throws**, so a control cannot pass vacuously |
| `forceZone(p, b, hero)` | `overrideZone({ palette: p, biome: b, hero })` | Terrain and props still follow the chunk's real biome (T01 seam) |
| `forceBend(a, c)` | `overrideBend({ a, c })` | |
| `forceFov(deg)` | `overrideFov(deg)` | |
| `forceFeel(o)` | `overrideFeel(o)` | C-28 |
| `setTier(t)` | `governor.force(t)` | Applies at step 15 of the next `renderAt` or `stepFrames` frame, and shows from the frame after |
| `forceSignalLost()` | `sim.forceSignalLost()` | PLAY only, no-op elsewhere (T02 seam) |
| `loseContext()` | `renderer.forceContextLoss()` | Resolves one macrotask after `webglcontextlost`. A second call while lost rejects |
| `restoreContext()` | `renderer.forceContextRestore()` | Resolves on `webglcontextrestored`. **Rejects without touching GL unless a `loseContext` promise has already resolved.** So §11.3's fourth trap cannot be written through this API |
| `stats()` | `renderer.info`, `sim.state`, `governor.profile`, `gl` | Reads `renderer.info` fresh on every call, never cached (`Agents.md`) |
| `pixels()` | `gl.readPixels` | Fresh `Uint8Array`, `width * height * 4`, bottom-up rows. **Throws unless in the same run as `renderAt` or `stepFrames`** |

`setCrackMode(true)` does exactly what T03's seam lists: every layer `setDebugMode('crack')`; `setVisible(name === 'terrain')`; save the clear colour and alpha, then `renderer.setClearColor(DebugPaint.CLEAR, 1)`; `overrideFeel({ shakeY: -CAMERA_PITCH })`. Roll is 0 under neutral feel. `autoClear` needs nothing here, since T06's `render` sets it on the `'off'` path (T06 seam); the trap test proves that it held.

The same-run guard is `armed = true; queueMicrotask(() => { armed = false })`. A later task would physically read empty, and a read between tasks is not reliable either way, see section 10.

**`window.__mvLab`** (`src/harness/lab.ts`):

```ts
export interface FrameKey { chunk: number; local: number; tick: number }
export interface HarnessLab {
  readonly metrics: typeof import('./metrics');
  rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number };   // unmasked, via WEBGL_debug_renderer_info
  settle(key: FrameKey, ms?: number): void;                                    // default 3000; renders key with a 1x1 sync until ms elapse, in one task
  refill(key: FrameKey): void;                                                 // R3: a frame 2 chunks ahead, then key, so every props ring is rebuilt at key
  stepToTick(tick: number): number;                                            // R3: one sim step a frame to exactly tick; throws if already past it, or on an overshoot
  compareAt(a: FrameKey, b: FrameKey, o?: CompareOptions): CompareResult;
  sequence(near: FrameKey, far: FrameKey, frames: number, stepU: number, stepTicks: number, o?: CompareOptions): SequenceResult;
  shimmer(start: FrameKey, o?: { frames?: number; stepU?: number; r0?: number; r1?: number }): { mean: number; perFrame: number[] };
  washoutAt(key: FrameKey): WashoutResult;     // two frames, forceFeel({ bloomGain: 0 }) for the reference, restored after
  crackSweep(start: FrameKey, frames: number, stepU: number): { bad: number; worstFrame: number; silhouetteStd: number };
  edgePaintAt(key: FrameKey): { ok: number; bad: number; interior: number; clear: number; other: number };
  audit(): Audit;
  finite(): { ok: boolean; bad: string[] };    // SimState numbers, shared uniforms, camera matrices
  nonFlat(chunk: number): { std: number; meanStep: number };
  findBiomeChunk(biome: number, fromChunk: number): number;                    // 5 chunks into a zone whose biomeA is biome with biomeMix 0, or -1
  timedFrames(n: number, dt: number): number[];                                // runFrame plus 1x1 sync, tight loop, ms
  instrument(on: boolean): void; budgets(): BudgetReport; resetBudgets(): void;
  allocWindows(windows: number, framesPerWindow: number, dt: number): AllocWindows;
  allocPairs(pairs: number, framesPerWindow: number, dt: number, bytes: number): AllocPairs;  // DI-84: allocProbe(bytes) on in each pair's first window, off in its second; off at the end
  heapCalibration(): number;                   // bytes seen for a known 1032-byte array, new Array(252); 0 means imprecise memory info
  heapAfterGc(): number;                       // gc(); gc(); usedJSHeapSize. Throws without --expose-gc
  links(): number;                             // window.__mvLinks from the init script, -1 if absent
  readonly controls: Controls;
  readonly traps: TrapDrills;
}
export interface Tolerance { bytes: number; max: number }                    // EXACT is { 0, 0 }, GPU_SAME_STATE { 64, 1 } (DI-58)
export interface CompareOptions { attempts?: number; tolerance?: Tolerance }  // tolerance defaults to EXACT
export interface CompareResult { pass: boolean; attempts: number; selfBytes: number; selfMax: number; crossBytes: number; crossMax: number; worstCrossMax: number; meanLuma: number }
export interface SequenceResult { pass: boolean; attempts: number; worstBytes: number; worstMax: number; worstFrame: number; store: 'ok' | 'failed' }
export interface WashoutResult { nearWhitePct: number; meanChroma: number; blackP10: number; meanLuma: number; hazeLift: number }
export interface Audit { objects: number; meshes: number; attributeBytes: number; instanceBytes: number; dataTextureBytes: number; pendingVisible: number; pendingHiddenMax: number }
export interface AllocWindows { median: number; dropped: number; windows: number }
export interface CallCounts { sim: number; layers: number; streaming: number; postFrame: number; postRender: number }   // fewest calls in any recorded frame
export interface BudgetReport { frames: number; sim: Quant; layers: Quant; streaming: Quant; postFrame: Quant; postRender: Quant; residual: Quant; minCalls: CallCounts; layerCount: number }
export interface Quant { p50: number; p95: number; p99: number; max: number }
```

**`Controls`** (all on the page, off by default, each returns to a clean scene when switched off). Every shader goes through `COMMON_VERT` and `COMMON_FRAG`, spreads `ctx.shared` by reference, and applies `bendV` to render-space positions, so the GLSL gate stays clean. Each compiles on first use, under the harness only.

| Control | What it adds | Which gate must react | Rehearsal [O] |
|---|---|---|---|
| `absCoord(on)` | Floor quad with `fract((forward + uAbs) / 16.)`. `uAbs` is the absolute distance of the frame, `chunk * 64 + local`, stored as float32. `api.ts` calls a hook with `(chunk, local)` before each `renderState`, and the control reads it | Identity | Near vs 1e9: 2,499,165 bytes differ, max 207; near vs near: 0. `uAbs` reads 999997440 |
| `naiveGrid(on)` | Additive floor grid, `fract(uv) < .04`, 8 u cell, L 1.45 | Shimmer | 8.102 without, 19.569 with, 8.102 after removal |
| `floodLines(k)` | Additive one-pixel lines every `k` px at L 2.4, palette grid colour, `k` 0 is off | Haze lift | `k` 16: haze 35.34, near-white .006%, chroma 152.4, so the old pair passes |
| `veil(L)` | Additive fullscreen through `emit`, 0 is off. The control runs at `L` .06 (DI-76, amending DI-72's .05) | Black floor | `L` .1: `blackP10` 58, haze 6.54, chroma 63.4, near-white .003% |
| `gpuLoad(n)` | Fullscreen fragment loop of `n` iterations | Timing | §11.4: 1024 loops is 5.8 ms |
| `staleUpload(on)`, `staleRewrite(stale)` | Probe mesh with one instanced attribute. `staleRewrite(true)` rewrites every instance and leaves one small `addUpdateRange` in place; `false` rewrites and uploads in full. `traps.rawStaleUpload(key)` runs the drill | Trap 2 | Mechanism per §10.2. T09: stale frame differs from the full upload by 6,123,600 bytes |
| `allocProbe(bytes)` | `hotProbe.ts` allocates `new Array(ceil((bytes - 24) / 4))` once per `runFrame` | Allocation | Size is 4K + 24 [O: windows moved by exactly 240 for 54 slots and 1008 for 246]. The rehearsal's "4K + 40" was wrong; see section 10 |
| `leakProbe(bytes)` | Same, retained in an array | Heap slope | 40.4 B/frame seen for a retained 28 B object and slot |

`allocProbe` and `leakProbe` run from a wrapper around `host.runFrame`, so they cost one call per frame. Both only exist while on.

```ts
export interface Controls {
  absCoord(on: boolean): void; naiveGrid(on: boolean): void; floodLines(k: number): void; veil(l: number): void;
  gpuLoad(n: number): void; staleUpload(on: boolean): void; staleRewrite(stale: boolean): void; allocProbe(bytes: number): void; leakProbe(bytes: number): void;
}
export interface TrapDrills {
  rawReadLater(): Promise<{ nonZero: number; total: number }>;
  rawDirectNoClear(): { autoClear: boolean; magenta: number; total: number };
  restoreInDispatch(): Promise<{ restoredWithin3s: number | null; secondCallRestoredAt: number | null }>;
  rawStaleUpload(key: FrameKey): { differ: number; pendingVisible: number };
}
```

**`TrapDrills`:** `rawReadLater()`, `rawDirectNoClear()`, `restoreInDispatch()`, `rawStaleUpload(key)`. Each performs the wrong thing on purpose and reports what happened, so the trap's reality is itself a test (section 5, M4).

**Metric definitions** (`src/harness/metrics.ts`). All take `(px, w, h, ...)`, with rows from the top unless stated.

| Function | Definition |
|---|---|
| `byteDiff(a, b)` | `{ bytes, max, first }`: count of differing bytes, largest absolute difference, first offset |
| `bandDiff(a, b, w, h, r0, r1)` | Mean absolute difference over R, G and B in rows `r0` to `r1 - 1` |
| `shimmerBand(h)` | `[round(615 * h / 1080), round(650 * h / 1080)]`, T03's band |
| `crackCount(px, w, h)` | T03's detector: scanning each column from the top, a pixel with R > 200, G < 60, B > 200 is sky; a sky pixel below the first non-sky pixel counts |
| `silhouetteStd(px, w, h)` | Standard deviation over columns of the first non-sky row. 0 for the whole frame if any column has none, so a part-sky frame cannot pass a lower limit |
| `edgeCounts(px, w, h)` | T03's decode. `ok`: G > 200, R < 60. `bad`: R > 200, G < 60, B < 60. `clear`: the sky predicate. `interior`: all channels within 26 ± 6. `other`: the rest |
| `washout(px, w, h)` | `nearWhitePct` is the share with `min(r, g, b) > 235`. `meanChroma` is the mean of `max - min`. `meanLuma` is Rec.709 on 8-bit values. `blackP10` is the nearest-rank 10th percentile of rounded luma. The first three match T06's definitions and the art prototype's `__stats` |
| `hazeLift(on, off, w, h)` | `mean luma(on) - mean luma(off)`, whole frame, with `off` the same frame under `forceFeel({ bloomGain: 0 })` (§8.1) |
| `percentile(values, q)` | Nearest rank on a sorted copy |
| `windowMedian(deltas, per)` | Median of the non-negative entries divided by `per`, plus the count dropped |
| `leakStats(samples)` | `{ growth, lastThreeSpread, max }`, with growth `last - first` |

**Thresholds in one place:**

| Gate | Limit | Basis |
|---|---|---|
| Identity, post off, MSAA off | Within the same-state bound, one try, after a 1 s settle: on `gpu` at most 64 bytes and none over 1 level, on `software` 0 bytes. A byte over 1 level fails at once | §11.3 as amended by DI-58. The settle follows T03's flip: 13 and 18 of 20 loads dirty at 0 ms, 0 of 20 after 1 s [T03 O] |
| Identity, post on, MSAA 0 | Within the same-state bound in some attempt of 5. A byte over 1 level fails at once, and so does a cross-compare past the bound with a matching self-compare | §11.3, DI-58 and DI-67, plus section 10's flake |
| Identity under Vulkan, post on, MSAA 2 | Printed, not gated. Only the renderer string is asserted, so the print cannot be mislabelled | DI-67 |
| Art stack with objects | Max diff at most 1 over every attempt, read as `worstCrossMax` | §11.3 |
| 120-frame sequence | As post on, at MSAA 0, 3 attempts | §11.3, DI-58, DI-67 |
| Context loss, B12 | Post off and `full`, both at MSAA 0, within the same-state bound across a loss with the sim held; travel rising through a second loss with the loop running | DI-58, DI-65, DI-67 |
| Wash-out controls off, A14 | The frame before both controls and after both are off, at MSAA 0 post off, within the same-state bound. The frame with them on differs by over 1000 bytes | DI-58, DI-68 |
| Fake host, A6 | `distant` and `again` within the same-state bound; `nextRow` over 0 bytes | DI-58, DI-68 |
| Cracks | 0; control non-zero at every position; `silhouetteStd` at least 2 at tier 3 and at tier 1 | §11.3 |
| Edge paint | `bad` 0, `ok` at least 1000 [A] | §11.3, T03 seam |
| Aperiodic shimmer | At most 1.25x world 0 [A] | §11.3 |
| Shimmer | Props hidden (DI-74): at most 8 [A], and at most `baseline * 1.02` [A]. Over 1, a liveness floor. All layers printed, not gated | §11.3, scoped by DI-74 to the floor: props moving through the band differ frame to frame whether they alias or move truly, and their own check is T05's. Repeat runs agreed to all printed digits [O], so 2% is margin for noise, not drift. A zero step reads 0 [O], so without the floor a band where nothing moves passes |
| Wash-out, default frame | Near-white under 0.5%, chroma over 55, haze lift at most 20 [A], `blackP10` at most 25 [A] | §6.7 (DI-01), T06's 20, section 10's clean maximum of 18 |
| Soak | Growth at most 1 MB, last three within 64 KB, heap at most 64 MB, geometries, textures, programs and objects constant, 0 links. At least 700 km, measured from before batch 0 | §9.3, §11.3. No assumed distance for the warm-up batch (V1 ruling) |
| Frame | p95 at most 2.0 ms | §9.2 proxy |
| Streaming, terrain plus props `frame` | p99 at most 2 ms | §9.2 |
| Sim per frame, dt 1/60 | p95 at most 0.5 ms [A] | §9.2 |
| Layers `frame` | p50 at most 1 ms [A] | §9.2 |
| Residual: loop minus sim, layers, post | p95 at most 0.5 ms [A] | §9.2's UI plus audio; it also holds input, feel and uniforms, so a failure there means look at T07's and T08's own numbers first |
| Warp or refill | Max at most 30 ms | §9.2 |
| Draws, triangles, tier 3 | At most 68, at most 1.5M | §9.2 |
| Tier 0, SwiftShader | p95 at most 50 ms | §9.2 |
| Allocation, `other` project code | At most 512 B/frame [A] (DI-78; 128 before it) | §9.2 (DI-16, DI-78). The 128 was assumed from the profiler's noise floor, 8 to 31 B/frame attributed to a function that allocates nothing [O]. The app reads 296 to 377 B/frame over post, sky, terrain, speed lines and props [T10 O], so DI-78 loosened it; a 1024 B allocation counted as project code still fails it |
| Allocation, stability before any limit | Three consecutive window medians within 5% of their mean (DI-77; 1 B before it) | The app's medians move with the route, 234 to 296 B over about 8.8 KB [T10 O]. Alone, a failure is a T09 measurement failure, not a §9.2 breach (V1) |
| Allocation, `src/world/` | At most 20 KB/frame [A] | §9.2 (DI-16). Section 10: 50 to 60 B per height sample today |
| Allocation, libraries | At most 32 KB/frame [A], recorded | §9.2 (DI-16). §14 risk 6: 3.7 KB/frame at about 18 draws on the probe [O] |
| Allocation, total median | At most 48 KB/frame [A] | Sum of the above, roughly |
| Instance attributes, height atlas | At most 0.2 MB, at most 1.6 MB | §9.3 |
| Dist JS, gzip, harness chunk excluded | At most 260 KB | §9.3 |

**Seams.** Places where another task must assume the same meaning and the types do not settle it. In this plan's tables, a backslash before a pipe inside a regex is only Markdown escaping; the regex itself has a plain pipe.

| Other task | Topic | T09's assumption |
|---|---|---|
| T10 | Import site | `app/` decides through its own URL parser, and imports dynamically. No static import under `src/app/` or `src/main.ts` |
| T10 | When | `createHarness` runs after boot: `precompile`, the first `rebuild`, and at least one rendered frame. `__mv` is undefined until then, and specs wait on `window.__mv?.ready`. A boot failure leaves it undefined, and the fatal page appears |
| T10 | Query | `?harness` means `periodChunks` 1024, `?harness&period=0` means aperiodic, no `?harness` means 0. `?seed` and `?tier` apply in any mode |
| T10 | `?harness` behaviour | The app is otherwise normal: real UI, title in DEMO, rAF running until `manual(true)`, autopilot flying, audio inert. No code path other than the import, `periodChunks` and the test hook looks at `?harness`, so a harness run measures the real thing. `app/` also installs its own test hook, which only reads |
| T10 | `setManual` | `true` cancels the rAF loop so no frame runs until `false`; `false` re-arms it and sets `lastMs` so the first delta is not huge |
| T10 | `runFrame(dt)` | All of §3.3 steps 1 to 15 with `rawDt = dt`, with `governor.sample(0)` in step 2, `sim.step`, UI and audio. Calls methods by property lookup on `sim`, `layers[i]` and `post`, never through a captured reference, and those objects are not frozen, because `lab.instrument` wraps them. A frozen object makes `instrument` throw |
| T10 | `renderState` | Per §8.1 |
| T10 | Overrides | Survive across frames until cleared. `overrideFeel` merges over `feel.out` in `runFrame` and over neutral feel in `renderState`; `overrideFov` wins on `fovDeg`. Camera pose per T00's `writeCameraPose`, so `shakeY: -CAMERA_PITCH` gives exactly zero pitch |
| T10 | Pending resize | Specs set the viewport before navigating, or before `manual(true)`. T09 never resizes in manual mode, so T10 need not apply resizes in `renderState` |
| T10 | Context | App's own listeners set `contextOk` and do §10.2's restore sequence including `await post.precompile()`. Harness listeners are additional and never call `preventDefault`. After `webglcontextrestored`, the spec waits for `[data-mv="context-lost"]` to hide before asserting. With `manual(true)` the overlay changes only on a frame (§3.3 step 13), so B12's held cycle renders the held position until the overlay is hidden after a frame, each wait frame at a tick 6 past the last, because T08 writes a changed panel view only once the tick has moved 6 since its last write (R3, V2-T09). The compare then goes back to the key's tick, which reopens T08's gate with nothing to write, so the overlay stays hidden. That assumes T10 sets `contextOk` and calls `showContextLost(false)` in one synchronous step, as T10's restore sequence does, and that a hidden overlay is hidden, not only transparent |
| T10 | Fatal | The 15 s restore timeout calls `ui.showFatal('context-lost-permanent')`. Spec looks for `[data-mv="fatal"]` (T08's hook) and then closes the page at once, since the never-restored state crashed a tab within 100 s (§10.2) |
| T10 | Console | A clean harness run logs no `console.error`, since T00's fixture fails on any. `debug.onShaderError` must `console.error`, per `Agents.md` |
| T10 | Done | T10's plan carries the B-list in section 7 as its own acceptance, and reports any defect in T09's paths through the reopen rule (§12) |
| T00 | Fake host, Node | T09 does not rely on the stub renderer's `getContext` details. `support/glStub.ts` wraps it with a recording `readPixels`, `drawingBufferWidth`, `isContextLost`, `forceContextLoss`, `forceContextRestore` and a `domElement` event target |
| T00 | Fake sim | `warpTo` obeys `canWarp` exactly, updates `state.travel`, and increments `warpSerial` only on success. `step` advances `travel` by `SPEED_CRUISE / SIM_HZ` and sets `stepDist`. §8.1's signature fence states it (C-29) |
| T00 | Routing | `*.timing.spec.ts` runs only under `gpu-timing`. `tests/forever` plain specs run under `gpu`. `tests/perf` plain specs run under `software`. `workers: 1`, `retries: 0`, per-test timeout 60 s, which T09 raises with `test.setTimeout` |
| T00 | `gc` and precise memory | Present only under `gpu-timing`. `heapCalibration()` and `typeof gc` are asserted at the start of each spec needing them, so a wrong project fails loudly rather than passing on bucketed numbers [O: 0 without the flag] |
| T00 | Vite serves `tests/**` | `/tests/forever/fixture/shell.html` is served by the dev server, as T00's own proof pages are [O in T00's rehearsal]. `appType: 'mpa'` gives a 404 on a wrong path |
| T00 | Dep URLs | Under `cacheDir: node_modules/.vite/p5109`, pre-bundled libraries appear in profiles with `/.vite/` and `/deps/` in the URL. The classifier uses `/\/\.vite\/(?:[^/]+\/)?deps\/\|\/node_modules\//`. T09's rehearsal saw `/.vite/deps/three.module-BFKXqa24.js`, with a different `cacheDir` |
| T01 | Periodic world | `k` and `k + 1024 * n` are byte-identical through every `WorldSource` function. Zone 10 is 24 chunks long and jumps at multiples of 1024, so identity tests stay away from the wrap: `c0 = 5`, and sequences stay under 100 chunks |
| T01 | Biome search | `zoneAt` is pure and allocation-free, so `findBiomeChunk` may call it 4096 times outside the frame loop. `biomeMix` is 0 outside the last 25 chunks of a zone. Uses `c = z * ZONE_CHUNKS + 5`. T09 does not import `findZoneChunk`, which is for `src/app` |
| T01 | `height` allocation | T09 measures it and reports, against the `src/world/` line above. If T01's internal `oct` returns a double through a non-inlined call, it costs 12 B per octave [O]. T01's Node probe guards only against a leak on a height row (DI-16) |
| T02 | Warp and signal | `warpTo` rebuilds its window, emits no event, leaves tick, mode and score alone, and `warpSerial` rises only on success. `forceSignalLost` in PLAY only |
| T02 | Soak speed | DEMO flies at cruise with periodic demo boost, so `stepFrames(n, .125)` is 15 steps a frame and about 10 u a frame or more. Not a physics claim; it matches §11.3's 600 u/s |
| T03 | Crack and edge paint | Per T03's seams and `DebugPaint`. Terrain's `setCrackControl(0)` restores the real mesh. Debug materials compile on first use, so the first frame in a debug mode links programs. Link gates exclude debug modes |
| T03 | Jumps | `renderAt` may jump with no `warpSerial` change, and `frame` self-heals with a full refill. A forward step inside the ring is incremental, which is what the sequence test exercises |
| T03 | Shimmer | Rows 615 to 650, step 1.17 u, mean over RGB. T09 owns the stored baseline. Terrain alone measured 6.27 to 7.42, and on the app 7.48 [T10 O]. From DI-74 the gated figure has props hidden, so it is terrain, sky and fx; props get T05's own temporal check |
| T04 | Purity | Sky is a pure function of zone, `tick mod 30720`, alpha, bend, camera, canvas height and quality. Identity compares equal ticks and equal zone. `setDebugMode` is a no-op on the sky, so debug modes hide it |
| T05 | Slot order after a jump | After a self-healing refill, two jumps to states differing only by `k * 1024` chunks give the same slot order in every ring, and so the same draw order, since rounding in additive blends depends on order. T05's `rebuild` must start from a fixed head (§8.1, S-37) |
| T05 | Ship | Pose and blink are pure functions of `v.sim`, `v.feel`, `v.alpha`, `v.phases`, and `renderState` leaves `v.sim` alone, so the ship cancels in identity |
| T05 | Pools and ranges | Rings are fixed at `attach`, so there is no pool to report. Hidden meshes accumulate ranges, capped at 64 by T05. T09's audit asserts `pendingVisible` is 0 after a render and `pendingHiddenMax` at most 64 |
| T05 | Collected shards | T05 hides a shard the sim collects until its ring refills, and refills only on a backward or multi-chunk move (`src/render/props/layer.ts`). So `compareAt` and `sequence` refill before every reference frame, and B12 refills before both captures (R3, V2-T09) |
| T06 | Variants | `forceVariant('off')` has `render` set `autoClear` true around the draw, reading false between frames. `forceVariant` and `forceMsaa` survive `setQuality`. `bare` has no vignette or bloom; `min` has bloom and vignette; scan and grain follow the variant |
| T06 | `bloomGain` | `bloomIntensity = .8 * clamp(gain, 0, 1.5)`, so `forceFeel({ bloomGain: 0 })` removes bloom with no recompile, and `washoutAt` uses that as its reference |
| T06 | Links | Precompile holds all programs, including the keep-alive, and after a restore T10 runs it again. T09's spy counts `gl.linkProgram`, because `info.programs.length` does not show recompiles |
| T07 | Audio | No member on `HarnessApi`. `audio.frame` runs inside `runFrame` and may see a backward tick under `renderState`, which T07 tolerates |
| T08 | Hooks and bests | `data-mv` values `context-lost`, `fatal`, `signal-lost`. UI never writes bests once `warpSerial` is non-zero. A boot test that runs no warp does not write bests either, since no PLAY happens |
| T08 | Panel throttle | `createGate` in `src/ui/slots.ts`: a changed view is written only when the tick has moved `SLOT_MIN_TICKS` (6) since the last write, and a tick that moves backward reopens the gate. `support/restore.ts` copies the 6 rather than importing T08 (R3) |
| T11 | Metrics | T11 takes its reference frames through `forceFeel`, uses its own pure metrics in `tests/art/support/metrics.ts` with a conformance test against `metrics.washout`, and takes shimmer from T09's suite. After art tuning, T11 re-writes the shimmer baseline with `TERRAIN_WRITE_BASELINE=1`, and records why. `findZoneChunk` plus `warp` shows a true biome |

## 5. Plan of work

Each milestone can be verified alone. M1 to M6 finish before T10. M7 writes the armed suites and proves as much of them as the shell allows. M8 is the hand-off.

### M0. Confirm the reconciled contracts

**Goal:** no assumption about contracts survives unchecked. **Work:** open `src/contracts/index.ts` and `src/testing/fakeHost.ts`, and confirm in Progress that the members named in section 4 and section 12 are there, as §8.1 states them. A missing member is a T00 defect, and the plan goes `blocked`. **Result:** the API surface to build is settled. **Proof:** `npm run contracts:check` exits 0, and the Progress entry exists.

### M1. Pure metrics

**Goal:** every number has one definition, tested on known inputs. **Work:** `metrics.ts` per section 4, no three, no DOM, no allocation concerns (not a hot path). `tests/unit/harness/metrics.test.ts` builds synthetic frames with exact expected output. Include mutation drills as ordinary tests: a copy of the array with one byte changed must change `byteDiff` by exactly one byte; a sky pixel placed under terrain must give `crackCount` 1, and a sky pixel only above terrain 0; `bandDiff` with rows swapped top for bottom must differ on an asymmetric frame, which pins the orientation. **Result:** T09 and T11 can trust the numbers. **Proof:** A2, A3.

### M2. The API over a fake host

**Goal:** `createHarness` maps every member correctly, and each guard fires. **Work:** `api.ts`, `sync.ts`, `index.ts`, `lab.ts` shell. `tests/unit/harness/api.test.ts` drives `createFakeHost()` plus `support/glStub.ts` and asserts on `FakeHost.calls`. `tests/forever/api.fake.spec.ts` loads a page with a real fake-host renderer and asserts `pixels()` and `stats()` on real GL. **Result:** the contract is implemented, before any pixel matters. **Proof:** A4, A5, A6.

### M3. The shell target

**Goal:** real GPU pixels and real allocation through the harness, with no T10.

**Work:** `tests/forever/fixture/shell.html`, a few inline lines importing `shellHost.ts`, then `createHarness(host)`.

`labPost.ts` implements `PostStack` with `new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling })`, `RenderPass`, and two `EffectPass`es: `full` is Bloom at §6.6 values, Neutral tone mapping and an alpha-1 effect; `bare` is Neutral and alpha-1. `dithering = true`; the `timeScale = 0` cast, here in the fixture; `render` honours `'off'` the way T06's does. `frame(v)` sets `bloom.intensity = .8 * clamp(v.feel.bloomGain, 0, 1.5)`. `full`, `noCa` and `min` all select `full`. `precompile` binds `composer.inputBuffer` first. T00's DevPost is not used because its bloom is not specified to read `bloomGain`.

`shellHost.ts` builds `startDevShell([createTrivialLayer()], labPost, { tier: 3 })` and returns a `HarnessHost`:

- `sim`, `governor`: from `createFakeHost()`.
- `ctx`, `layers`, `post`: from the shell.
- `setManual`: `shell.setManual`.
- `renderState(c, l, t)`: `shell.frameAt(0, { at: { chunk: c, local: l }, tick: t, palette, biome, hero, bend, feel })` with the overrides held.
- `runFrame(dt)`: `sim.step` repeated `floor(dt * 120)` times, then `renderState` at `sim.state.travel`, `sim.state.tick`, with allocation and timing wrappers working as on the app.
- Until `manual(true)`, its own rAF loop steps the sim on an accumulator (dt clamped to .25 s, at most 30 steps) and draws at the sim's travel, as §3.3 does, so travel rises through a context loss. The dev shell's scripted loop is stopped at boot.
- `?follow=1`: `renderState` passes `camX = .72 * 12 * sin(2 pi (tick - 1) / 1920)`, a weave that is a pure function of the sim's tick, standing in for DEMO autopilot. §8.1's `renderState` takes `camX` from `prevX`, so only a sim step can move the camera. Without it the shell pins `camX` at 0, which is why V1 found the shell could not show B12's and B14's defect. Off by default, so shimmer and wash-out keep one camera across pages.

**Result:** gates can be rehearsed on real pixels. **Proof:** A7: `shell.html` shows `ready` and `checkRasterizer` returns null under `gpu`; opened screenshot shows the sky and floor.

### M4. Traps, identity

**Goal:** the four false-result traps of §11.3 and the post-on flake have a mechanism and a test.

**Work:** `traps.spec.ts`. Each trap gets a positive drill that reproduces it, then the guard or check that stops it.

| Trap | Drill, what really happens | Guard and gate |
|---|---|---|
| 1. `autoClear` left false by the composer | `traps.rawDirectNoClear()`: after a composer frame, hide everything, magenta clear, direct `renderer.render` without touching `autoClear` [O: `autoClear` false, 2,873 of 2,073,600 magenta] | With `setPost('off')` and crack mode with terrain hidden too: every pixel is magenta (`count === w * h`), straight after a non-magenta frame. Run again with `setPost('bare')`. Proves the clear on both paths. The crack control (B6) then proves the clear is doing its job, since stale pixels would hide cracks |
| 2. `updateRanges` not cleared on warp | `controls.staleUpload(true)`: rewrite a probe attribute with a stale range kept. The frame must differ from a full upload's frame | `audit().pendingVisible === 0` after any render. On the app: hide `props`, `stepFrames(240, 1/60)` so hidden rings accumulate, warp far, show, render; must be byte-identical (post off) to a jump into the same state from a fresh page. Also `pendingHiddenMax <= 64` |
| 3. Reading pixels in a later task | `traps.rawReadLater()`: draw, wait for a macrotask, `gl.readPixels` [O: 0 non-zero pixels of 2,073,600]. Also recorded: a read in the next `page.evaluate` with no composite in between returned all of them [O], so the mistake passes sometimes, which is worse | `pixels()` after an `await` or in a later evaluate throws, tested by `.rejects`. In the same run it returns `w * h * 4` bytes, with a non-zero share above 0.9 |
| 4. Restoring inside the loss dispatch | `traps.restoreInDispatch()`: `await lost; forceContextRestore()` [O: no restore within 3 s, console `restoreContext: context restoration not allowed`; a second call restored at once]. Shell target only, inside `allowConsoleErrors`, with the bounded wait and the second call | `restoreContext()` before `loseContext()` resolved rejects with a message containing `loss event`, and `gl` calls are not made; the proper order restores in about 12 ms [O: lost at 6.1, restored at 11.8] |

`sweeps.ts`, identity part:

- `settle(key, ms)`: render `key` with a 1x1 sync in one task until `ms` elapses.
- `compareAt(a, b, { attempts, tolerance })`: up to `attempts` (default 5) triples of `A1 = frame(a)`, `B = frame(b)`, `A2 = frame(a)`, 64 settling frames between attempts. Each attempt starts with `refill(a)`, a frame two chunks ahead and one at `a`, so A1 cannot keep a shard that the jumps to B and back to A2 show (R3). `self = byteDiff(A1, A2)`, `cross = byteDiff(A1, B)`. `tolerance` defaults to `EXACT`; specs pass the same-state bound (DI-58). Pass as soon as a triple has both `self` and `cross` within the tolerance. **A byte over 1 level, in either compare, fails at once (DI-58). A cross-compare past `max(16, tolerance.bytes)` bytes in a triple whose self-compare is within the tolerance fails at once.** Otherwise the next attempt. Taking the best attempt is sound because the frame is a deterministic function of the state: a real difference repeats in every attempt, and only driver noise goes away (section 10). DI-58 adds the case where a flip persists, which no attempt removes, hence the bound. The result prints attempts used, and `worstCrossMax` is the largest `crossMax` over every attempt.
- `sequence(near, far, frames, stepU, stepTicks)`: one preallocated `Uint8Array(w * h * 4 * frames)` [O: 995,328,000 bytes allocated in 1.7 ms], then per attempt: `refill(near)` (R3), settle, jump to `near`, `frames` forward steps storing with `readPixels(..., store, offset)` [O: 4.2 ms a frame], jump to `far`, same steps comparing frame by frame [O: 7.9 ms a compare]. Any frame with a byte over 1 level, or past `max(16, tolerance.bytes)` bytes, fails at once. A frame outside the tolerance is dirty, and only an attempt with no dirty frame passes. 3 attempts. A `RangeError` on the allocation fails with a message suggesting a 960x540 viewport; do not fall back silently.

`identity.spec.ts`, which runs on the shell and on the app:

- Exact test: `setPost('off'); setMsaa(0)`, then `settle(near, 1000)`. One try per `k`, comparing `(5, 12.5, 28800)` with `(5 + 1024 * k, 12.5, 28800)`, `k` in `[977, 15259, 976562500, 15258789063]`, about 6.4e7, 1e9, 6.4e13 and 1e15 u, within the same-state bound (DI-58).
- Liveness: the same frame at chunk 6 differs by over 1000 bytes on the app. On the shell, `local` 13.5 is used, because T00's proof floor is periodic in `local`. Also `meanLuma > 1`. So a blank or static frame cannot pass.
- Post on: `setPost('full'); setMsaa(0)` (DI-67), settle 3 s, then `compareAt` with the same-state bound, and `worstCrossMax` at most 1.
- Sequence: 120 frames, 1.33 u, 2 ticks, post on at MSAA 0 (DI-67).
- Print-only, `identity-vulkan.spec.ts`: the post-on compare at MSAA 2 under `--use-angle=vulkan`, at all 4 `k`, with `EXACT` so the raw bytes print. Not gated (DI-67). It asserts only that the renderer string says Vulkan. A worker option such as `launchOptions` is refused inside a describe group [O: `node_modules/playwright/lib/common/index.js`, "because it forces a new worker"], so it is a top-level `test.use` in its own file, with T00's `findChromium` for the executable, and T00's config untouched. It skips in `beforeAll` under any project but `gpu`, so no other project launches that browser. Where the launched renderer is not hardware Vulkan it skips and prints why, with a message starting `NOT VULKAN (DI-71)`. The backend is read on a blank page before the harness opens, and a software rasterizer counts as not Vulkan, though SwiftShader's string names Vulkan (R3, DI-71(2)).
- Negative control: `controls.absCoord(true)` in the exact test, then in the post-on test, both under the same-state bound: `crossBytes` at least 100,000, attempts 1, `pass` false. Fails only for the right reason: the self-compare is within the bound [O: 0].

**Result:** a flake cannot fail the gate, and a real error cannot pass it. **Proof:** A8 to A11.

### M5. Shimmer, wash-out, baselines

**Goal:** the temporal and wash-out metrics work and can fail.

**Work: shimmer.** Every shimmer test first runs `lab.stepToTick(1200)`, so the camera pose is a function of a fixed sim tick, not of how long DEMO ran before `manual(true)` (R3, V2-T09). `lab.shimmer(start)`: frames 48, step 1.17 u. **Tick held fixed**, or it also measures grain changing (T06 seam). `local` advances through `chunk`, so jumps are avoided. Mean over `perFrame` of `bandDiff` on `shimmerBand(h)`. Evaluated under `setPost('full'); setMsaa(2)`, tier 3. Shimmer stays at MSAA 2 after DI-67: it is a look row, and its zero step and repeat are band means with their own limits, not byte compares (Decision log, R2).

`shimmer.spec.ts`. From DI-74 every gated figure on the app has the props layer hidden: B10's limit and baseline, and A12's repeat, zero step and naive-grid control. Props moving through the band produce frame differences whether they alias or move truly, and on the app they cover the floor in the band, so the naive grid added .87 with all layers and 11.2 with props hidden [T10 O]. The shell has no props layer, so nothing is hidden there and every shell number stands.

- Repeat: two runs agree within 2% [O: 8.102, 8.102, 8.102; on this shell 12.202 each].
- Zero step gives 0 [O: 0], which shows the metric sees motion, not noise. Allow at most .001 for driver noise.
- Control: `naiveGrid(true)` gives more than `max(8, 1.5 * clean)` [O: 19.569 vs 8.102; app, props hidden, 18.64 vs 7.44, T10]. Removing it returns to within 2% of clean [O: 8.102].
- Armed only: the absolute limit 8 and the baseline, props hidden. All layers, under `full` and `bare`, printed and not gated (DI-74(3)).

**Why a band and not a frame.** Near-field change reads as speed, and far-field change reads as shimmer (§6.4). T03's measurements give rows 650 to 720 at 12.8 and the mountain band at 13.9 with the same scene, so a whole-frame mean would mostly measure speed.

**Baseline** (`tests/forever/support/baseline.ts`): `test-refs/T09/shimmer.json`, keyed `"<renderer>|<target>|<w>x<h>|<r0>-<r1>"`, value `{ mean, frames, stepU, writtenUtc }`. Missing key: **the test fails** with `No shimmer baseline for this machine. Inspect a run, then set TERRAIN_WRITE_BASELINE=1`. With that env var set, the test writes and prints `BASELINE WRITTEN`, and marks itself as `test.info().annotations` so nobody mistakes it for a pass. A baseline written silently on first run would make the first run vacuous.

**Work: wash-out.** `washoutAt(key)`: render `key`, read; `forceFeel({ bloomGain: 0 })` and render, read; restore; compute. Section 10 has the measurement behind this: near-white and chroma pass both kinds of wash-out; haze lift catches a bloom flood and is blind to a veil, even going the good way; `blackP10` catches a veil and misses a flood. So all four are reported and gated together, and no single one is claimed sufficient.

`washout.spec.ts`:

- Control `floodLines(16)`: near-white under .5%, chroma over 55, **and** haze lift over 20. This is the case T06 reported, reproduced without reaching into T06's internals.
- Control `veil(.06)` (DI-76; `.05` under DI-72, `.1` before it): near-white under .5%, chroma over 55, haze lift under 20, **and** `blackP10` over 25. The controls-off check below uses the same strength.
- Both controls run under `forceZone(SUNSET_DRIVE, BOULEVARD, 0)`: the shell's zone 0, where their numbers were taken, and the palette B11's default frame gates, not the app's zone 0, Ultraviolet at day phase .007 (R3, V2-T09). Section 10 has R3's finding that on the real layers `veil(.1)` reads chroma under 55 on either palette, which is why DI-72 set the control at `.05`; with T06's post on the app `.05` read `blackP10` 25 to 27, on the limit, which is why DI-76 sets `.06`.
- Every wash-out test first runs `lab.stepToTick(1200)`, as the shimmer tests do, and asserts the tick, so B11's frames are at a fixed camera pose rather than wherever DEMO was at `manual(true)` (DI-76).
- Controls off, post off, MSAA 0: the frame with both controls on differs from the frame before by over 1000 bytes, and the frame after both are off matches the frame before within the same-state bound (DI-68). Other states are rendered in between, which is DI-58's case.
- Armed: the default frame, palette 0, passes all four. Palettes 1 to 5 are printed and not gated here, because T11 gates every palette on real samples (§6.7).

**Result:** the metrics T11 conforms to work and can fail. **Proof:** A12 to A14.

### M6. Allocation and leak gates

**Goal:** a gate that sees short-lived allocation, attributes it, and has a negative control. Section 10 holds the experiment. The design that came out of it:

| Question | Tool | Why this one |
|---|---|---|
| How many bytes per frame in total, exactly? | **Windows:** `usedJSHeapSize` delta over 10 frames, 300 times, median of non-negative windows, `lab.allocWindows` | Exact and deterministic: 3773.6 three times, +28.0 for a 28-byte object, +136.0, +520.0 [O]. A window holding a scavenge goes negative and is dropped. Needs `--enable-precise-memory-info`, so the spec first asserts `heapCalibration() >= 1000` [O: 1032 with, 0 without] |
| Who allocates it? | **Sampling profiler:** CDP `HeapProfiler.startSampling` with `samplingInterval: 1024`, both `includeObjectsCollectedBy*` flags, summing `selfSize` by URL class | Attribution by function, accurate to a few percent: 534 for a true 520; total 3770 to 3972 for a true 3774 [O]. Overhead .611 vs .601 ms a frame [O]. First profile after warm-up is discarded, as it runs high [O: 3972 vs 3770; T08 saw the same] |
| Is anything retained? | **Heap slope** across `gc(); gc();` over long windows | Sees a leak [O: 40.4 B/frame]. Blind to the rest [O: -0.14 to .34 B/frame for true 28 to 520 B, and 0 for 15.5 KB]. Kept for leaks only, as §9.3 uses it |
| Who retains it? | **Sampling profiler with both flags off** | Only live objects count: leak 50.5 B/frame at the right URL, clean .3 [O]. Runs only when the slope gate fails, or as its control |

**Rejected:** GC count as a gate. CDP tracing `MinorGC` over 4000 frames read 8, 7 and 8 for true added 0, 28 and 520 B/frame, and 32 for 15.5 KB [O]. Three's own allocation dominates, so the count only moves on a large change. T05's Node GC-count method stays valid for T05, in isolated code with no three.

`tests/perf/support/heap.ts`: `sampleHeap(page, cdp, run, { collected, interval })`, walks `profile.head`, returns `{ frames, classes, top }`. URL classes, first match wins:

| Class | Regex on `callFrame.url` | Treatment |
|---|---|---|
| `probe` | `/\/src\/harness\/hotProbe\.ts/` | Controls only; must be 0 in clean runs |
| `harness` | `/\/src\/(harness\|testing)\/\|\/tests\//` | Excluded from limits, printed |
| `world` | `/\/src\/world\//` | Its own limit |
| `other` | `/\/src\//` | "Our" code: sim, feel, render, ui, input, app, core |
| `libs` | `/\/\.vite\/(?:[^/]+\/)?deps\/\|\/node_modules\//` | Recorded and limited |
| `engine` | empty URL | Native: `sort`, `(V8 API)`, idle. Printed, counted in total only |

`alloc.timing.spec.ts`, on the dev server, since built chunks would lose the URLs. Steps, in one page:

1. `typeof gc === 'function'`, and `heapCalibration() >= 1000`.
2. Opened with `tier: 3`. `manual(true)`, warm with 3000 `stepFrames(1, 1/60)`.
3. `allocWindows(300, 10, 1/60)`, each after 3000 more frames, until at least 5 runs have been made (repair D) and the last three lie within 5% of their mean (DI-77; within 1 B before it), at most 17 runs: the clean median. `windowStability` in `metrics.ts` is the line, unit-tested on T10's app series and on truly unstable ones. Then the windows control below, before any profile, see section 10: on the shell after 3000 warm frames, on the app interleaved straight away (DI-84).
4. Discarded profile of 4000 frames, then the real one: per class, plus the top 12 functions, printed. This output is §14 risk 6's answer and goes into Outcomes.
5. Limits per section 4 on `other` (512 B, DI-78), `world`, `libs`, and the median, through `classLimitProblems` in `tests/perf/support/heap.ts`, so the gate and its control run one check.

Controls, same page:

- The windows control, in DI-84's form for the target with DI-86(2)'s probe sizes, through `windowsControlCheck` in `tests/perf/support/heap.ts`, which calls `probeShift` in `metrics.ts`. On the shell, `allocProbe(256)`: after 3000 warm frames, `allocWindows` median rises by 256 ± 16 over the clean median. On the app, whose clean medians drift with the route, `allocPairs(300, 10, 1/60, 1024)` alternates probe-on and probe-off windows over one stretch, and the on median exceeds the off median by 1024 ± 256 (DI-86(2); 256 ± 64 with a 256 B probe before it). In the profile section, after 1000 warm frames, `probe` reads at least 180 B/frame. With `allocProbe(1024)`, `probe` reads at least 700 B/frame. So a real allocation of that size in our code would show.
- The `other` line's own control (DI-78): the `allocProbe(1024)` profile with the probe's bytes counted as `other` fails `classLimitProblems` on `other`. The 256 B case is printed.
- Slope blindness, written down as a test: with `allocProbe(1024)`, slope across `gc(); gc();` over 4000 frames reads under 10 B/frame. If this ever reads high, the slope gate has changed behaviour and the table above needs re-reading.
- `leakProbe(256)` over 4000 frames: slope at least 200 B/frame; retained-only profile puts at least 150 B/frame in `probe`, and the clean retained-only profile under 10. Then off.

**Result:** §9.2's allocation line has a working gate, and §14 risk 6 can be answered from data. **Proof:** A15.

### M7. Isolation

**Goal:** a normal visit cannot fetch the harness, and this test can tell.

**Work:** `tests/forever/fixture/iso/`. `dynamic/main.ts` mirrors §10.1's chain and the seam: it dynamically imports `./app.ts`, which reads the query and only then dynamically imports the real `src/harness/index.ts`. `static/main.ts` imports it statically. Both import a three symbol so shared chunks are exercised. `vite.config.ts` uses `root` from `ISO_MODE`, `base: './'`, `outDir: test-results/T09-iso/<mode>`, `resolve` defaults, and no `rollupOptions`.

`isolation.spec.ts`:

1. Build each mode with `node node_modules/vite/bin/vite.js build --config tests/forever/fixture/iso/vite.config.ts`. Serve through `distServer.ts` from `/some/nested/path/`.
2. **Marker check:** scan `assets/*.js` for `MV-HARNESS-CHUNK`. Exactly one file must hold it. Zero means the marker was tree-shaken and the test would be vacuous [O: an unused exported constant was removed], so it fails.
3. Dynamic build, visits `''`, `?harnessx=1`, `#harness`: 0 requests for the marked file, `globalThis.__mvHarnessChunk` undefined, `window.__mv` undefined [O].
4. Dynamic build, `?harness`: exactly 1 request for it, marker global set [O]. This is the positive control.
5. **Negative control:** static build, visit `''`: marker file requested, global set, so the assertion in step 3 must fail here, tested by asserting the opposite [O: the marked file is the app chunk].
6. Armed: the same checks on the real `npm run build` output (`dist/`) and on the dev server: `/` has no request matching `/\/src\/harness\//`, and `/?harness` has at least one.

**Result:** the requirement is observed, not assumed. **Proof:** A16.

### M8. Timing and budgets, on the shell

**Goal:** the timing machinery proves it tracks load.

**Work:** `budget.ts`. `timedFrames(n, dt)` is a tight loop of `host.runFrame(dt)` and a 1x1 sync with a scratch buffer (§11.4). Never rAF deltas or `page.clock`. `instrument(true)` wraps `sim.step`, every `layer.frame`, `post.frame`, `post.render` and `host.runFrame`, adding elapsed time per frame to preallocated arrays. Throws if any object is frozen. `performance.now()` here has 100 us resolution, and pages are not cross-origin isolated [O], so per-frame values are quantised to .1 ms. Means are fine; p50 of a 20 us function reads 0. That is why §9.2's sim line is gated on p95 of the per-frame sum rather than per step, and T02's Node benchmark remains the precise number for a step.

`frame.timing.spec.ts`: control `gpuLoad(1024)` raises p50 by at least 3 ms [§11.4: 5.8 ms at 1080p], and removing it restores within 20%. Shell values are printed and not gated. Armed gates are in M9.

**Result:** the proxy gate cannot pass because the clock is wrong. **Proof:** A17.

### M9. Armed suites and hand-off

**Goal:** the whole of §9 and §11.3 is written, and the unarmed state is visibly unarmed.

**Work:** `tests/forever/support/open.ts`:

```ts
export function target(): 'app' | 'shell';   // TERRAIN_HARNESS_TARGET, else 'app' when index.html exists, else 'shell'
export async function openHarness(page: Page, info: TestInfo, q?: { period?: number; tier?: Tier; seed?: number }): Promise<void>;
export function armedOnly(): void;           // test.skip(target() !== 'app', 'UNARMED: needs T10')
```

`openHarness` installs the spies with `addInitScript`, navigates, waits for `window.__mv?.ready` up to 60 s, and asserts `checkRasterizer` returns null.

`armed.spec.ts`: under `shell`, asserts `index.html` is absent and prints `TARGET shell: armed suites skipped`. Under `app`, asserts `/?harness` reaches `ready` and a normal visit has no `__mv`.

The armed specs, method only; expected results are in section 7. Budget and other tier-3 perf specs pass `tier: 3`, since auto boot on the RTX may start at tier 4. Any spec that reads pixels right after `setTier` renders one extra frame first:

- **`cracks.spec.ts`**, at chunks `0`, `15625000`, `15625000000000` (world 0, 1e9, 1e15), periodic page. `setCrackMode(true); forceBend(0, 0)`, 900 frames of 2.5 u (150 u/s at 60 fps), counting `crackCount` per frame. Paths: `setPost('off'); setMsaa(0)`, then `setPost('bare'); setMsaa(0)`. `bare` rather than `full`: the vignette darkens magenta corners below the sky predicate, and MSAA blends a thin crack toward non-magenta (T03). Repeat at full bend `(8e-5, -1.2e-5)`. Then `setCrackControl(true)`: 300 frames at each position, non-zero at each, then `false`, then 0 again. Save and view one PNG of a control frame. Also `silhouetteStd` printed at each position, at least 2 px [A]; a flat atlas at distance would read near 0. Then `tier: 1` (stride 2), chunk `15625000000000`, full bend, 300 frames, both paths, 0 bad and `silhouetteStd` at least 2, since §6.4's `DoubleSide` matters there and T03's evidence is only on its dev page. Without the second check a tier 1 with no terrain would read 0 cracks and pass [O: on the shell, which has no terrain, it did].
- **`edgepaint.spec.ts`**, `page.setViewportSize({ width: 2520, height: 1080 })` before navigation, opened at `tier: 4`, since tier 3's pixel cap would scale the buffer to 2199x943, `setEdgePaint(true); forceBend(8e-5, 0); forceFov(CAMERA_FOV_MAX); setPost('off')`, 30 positions along a chunk at world 0 and 1e9. T03 notes the worst row of §6.4 is camera x -28.8, which `renderState` cannot reach here because it does not set `sim.x`; T03's A-test covers that, and this is recorded as a gap.
- **`warp.spec.ts`**, `period: 0`. Guard: `warp(CHUNK_LIMIT, 0)`, `warp(2 ** 48, 0)`, `warp(1.5, 0)`, `warp(5, 64)`, `warp(-1, 0)`, `warp(NaN, 0)` all false, with `stats()` chunk, local and `warpSerial` unchanged. `warp(CHUNK_LIMIT - 1, 0)` true and `warpSerial` up by 1; then `nonFlat`, `finite`, one `renderAt` non-blank, 10 `stepFrames(1, 1/60)` with `between` rising. Distances: for each of 1e9, 1e12, 1e15, 1e16, chunk `findBiomeChunk(0, round(world / 64))`, warp, `forceZone(0, 0, 0); forceBend(0, 0)`, `shimmer` at tick 28800 compared to the same at `findBiomeChunk(0, 12 * ZONE_CHUNKS)`: home at or past T01's difficulty cap, zone 12, as every far zone is, and asserted so (R3, V2-T09), plus `finite`, `nonFlat` and crack-mode `silhouetteStd`. Same biome on purpose: comparing across biomes would measure the biome.
- **`shimmer.spec.ts`**, armed part: `tier: 3`, chunk 5, periodic, `full`, MSAA 2, props hidden (DI-74): a liveness floor of 1, then the limit and baseline. All layers printed, not gated, so T05 and T11 can see what props add. Also with `setPost('bare')`, both scopes printed.
- **`context.spec.ts`**, two loss cycles in two tests (DI-65), both opened at `tier: 3`. On the app `renderState` takes `camX` and `camY` from `prevX` and `prevY` (§8.1), and DEMO autopilot moves them, so a compare across a loss with the loop running fails whatever the restore does (V1).
  - *Sim held:* `manual(true)` from the first capture to the last compare. Post off after `refill(key)` and `settle(key, 1000)`, then `full` after a 3 s settle, captured, both at MSAA 0 (DI-67). `loseContext()`; `renderAt` reads `NaN`. `restoreContext()`. With the loop held the overlay changes only on a frame (§3.3 step 13), so the spec renders the held position until the overlay is hidden after a frame, at most 20 s, each frame at a tick 6 past the last, T08's panel throttle (R3, `support/restore.ts`); `contextOk` and the overlay flip together. Then the same two frames, settled the same way: both within the same-state bound (DI-58). Last, `stats()` chunk, local and tick equal to before the loss, so the compare is at one sim state. Both sides refill first, because the restore rebuilds every ring. The overlay must still be hidden after the compare frames, which run at the key's own tick again (R3).
  - *Loop running:* `[data-mv="context-lost"]` visible, `between` rises across 500 ms, `setTier(2)` during the loss, `restoreContext()`, overlay gone. Then `manual(true)`: the buffer width shows the forced tier applied, back to tier 3, every variant non-blank, and 0 links across a tier cycle after the post-restore precompile (T06). The shell has no UI, so the overlay lines run on the app only.
  - Never-restored, in its own test: `loseContext()`, wait up to 20 s for `[data-mv="fatal"]`, close the page at once.
- **`tierswitch.spec.ts`**, §14 risk 10. Fixed position, `tick` + 2 per `renderAt`, tier cycle 4, 3, 2, 1, 0, 1, 2, 3, 90 frames per tier, because T05's density ramp runs on `v.tick`. Asserts: 0 `linkProgram` calls, no console error, `stats().tier` as asked, and the tier really applied: after each tier's second frame the buffer fits that tier's `maxPixels`, and is larger than the tier below allows wherever the full-size buffer is (`fakeProfile`, equal to T06's table). `stats().tier` alone cannot fail, since `governor.force` moves it at once (V1). Per-frame `bandDiff` over the whole frame is printed; frames where the canvas size changes are reported and skipped. The printed diff includes time-based animation, because `tick` moves. Max at most 16 [A]. T03 expects ramp frames, not one step.
- **`soak.timing.spec.ts`**, `TERRAIN_SOAK_FRAMES` default 72000. Opened with `period: 0, tier: 3`, `manual(true)`, batches of 3600 `stepFrames(3600, .125)`, one `page.evaluate` per batch. After each: `gc(); gc();`, then sample heap, `stats`, `audit`, `links`, `finite`, chunk and local. Warm-up is the first batch; the gate reads from sample 1 on, and with only 2 samples compares sample 1 with sample 0, which is already past the warm-up. Distance is read from `stats()` before batch 0, so the 700 km gate measures every frame flown and assumes nothing. `test.setTimeout(45 * 60_000)`. Control test on a fresh page: `leakProbe(512)` for 2 batches, `leakStats.growth` over 1 MB.
- **`soak-realtime.timing.spec.ts`**, skipped unless `TERRAIN_SOAK_MINUTES` is set: the rAF loop, in real time, sampling every 5 minutes. Operator's §14 risk 7 run.
- **`frame.timing.spec.ts`**, armed: builds with `npm run build`, serves `dist/` through `distServer.ts`, opens `?harness&period=0&tier=3`. For each biome: `warp(findBiomeChunk(b, 0), 0)`, 200 `stepFrames(1, 1/60)`, record `stats()`. Calls and triangles limits at each. On the biome with most triangles: `timedFrames(300, 1/60)` discarded, then `timedFrames(1800, 1/60)`, p50, p95, p99. That is 35 s of sim, about 2.8 km at cruise and 3.2 km at DEMO's mean, and T02's DEMO read 3.13 to 3.16 km [O: R3 probe]: inside the 4.48 km from chunk 5 of the zone to its fade at chunk 75. R3 corrects an earlier "under 2.4 km".
- **`budgets.timing.spec.ts`**, armed, dev server, `tier: 3`. `instrument(true)`, which counts wrapper calls per frame: every gated line first asserts at least one `sim.step`, one terrain or props `frame` and one `post.render` in every instrumented frame, so a host holding a captured method cannot pass on zeros (V1). Streaming counts terrain and props together, so R3 also holds `minCalls.layers` to `layerCount`, every wrapped layer's frame in every frame, through the unit-tested `callCountProblems` in `budget.ts` (V2-T09). Heaviest biome at `dt = 1/60`: sim, layers, residual. At `dt = 1/32`, 2.5 u a frame, the same travel per frame as 150 u/s: streaming p99, over 1800 frames. Warp: 20 `warp` plus `stepFrames(1, 1/60)` at distinct aperiodic chunks, dropping the first two, max at most 30 ms. `audit()`: `instanceBytes` and `dataTextureBytes` limits. Heap after `gc()`: at most 64 MB.
- **`software.spec.ts`**, `software` project. `stats().tier === 0`, `timedFrames(120, 1/60)` p95 at most 50 ms, printing calls and triangles. Failing means T04's `HERO_SUN_ONLY` path (T04 seam) before any threshold discussion.
- **`bundle.spec.ts`**: builds `index.html` with `vite build --outDir <its own test output folder>`, then gzips each `assets/*.js` there with `node:zlib` at level 9, except the marked harness chunk. Sum at most 260 KB, and over 100 KB, so an empty build fails. With no `index.html`, or a build that fails or writes no `index.html`, it fails with a message; it never skips for a missing build (repair G, VI-gates). Until repair G it skipped unless `dist/index.html` existed.

Then `npm run check:task -- T09`, Outcomes, `status: done`. T10 inherits the B-list.

**Result:** T10 has one list to arm. **Proof:** A18 to A21.

## 6. Concrete steps

```powershell
cd C:\highsierralabs\terrain
$env:TERRAIN_PORT = '5109'

# Every change
npx vitest run tests/unit/harness
npm run check:task -- T09

# Forever, normal specs, under gpu
npx playwright test tests/forever --project=gpu --output=test-results/T09

# One spec, or one test
npx playwright test tests/forever/identity.spec.ts --project=gpu --output=test-results/T09
npx playwright test tests/forever/traps.spec.ts --project=gpu --output=test-results/T09 -g "trap 3"

# Print-only post-on MSAA 2 identity under Vulkan (DI-67); its launch option is in the spec file
npx playwright test tests/forever/identity-vulkan.spec.ts --project=gpu --output=test-results/T09

# Timing: alone on the machine, per Agents.md
npx playwright test tests/forever/soak --project=gpu-timing --output=test-results/T09-soak
npx playwright test tests/perf --project=gpu-timing --output=test-results/T09-perf

# Software
npx playwright test tests/perf --project=software --output=test-results/T09-sw

# Run armed specs on the shell, to find mistakes in a spec. Proves nothing about the game, and failures are expected where the shell has no terrain, props or UI
$env:TERRAIN_ARMED_ON_SHELL = '1'; npx playwright test tests/forever/warp.spec.ts --project=gpu --output=test-results/T09; Remove-Item Env:TERRAIN_ARMED_ON_SHELL

# Short soak while developing
$env:TERRAIN_SOAK_FRAMES = '7200'; npx playwright test tests/forever/soak --project=gpu-timing --output=test-results/T09-soak; Remove-Item Env:TERRAIN_SOAK_FRAMES

# First shimmer baseline on this machine, after looking at a run
$env:TERRAIN_WRITE_BASELINE = '1'; npx playwright test tests/forever/shimmer.spec.ts --project=gpu --output=test-results/T09; Remove-Item Env:TERRAIN_WRITE_BASELINE

# Force the shell target once T10 exists
$env:TERRAIN_HARNESS_TARGET = 'shell'; npx playwright test tests/forever/identity.spec.ts --project=gpu --output=test-results/T09; Remove-Item Env:TERRAIN_HARNESS_TARGET

# After the whole T01-T09 batch has finished, not before
npm run check
npm run plans:check
```

PowerShell 5.1 has no `&&`. Use `;` or `A; if ($?) { B }`. Never `npx playwright install`.

## 7. Validation and acceptance

Paste short output into Progress as each one passes. Bracketed values came from the rehearsal in section 10, on different code, and are expectations rather than proof.

### A. T09's own, before T10

| # | Command or action | Expected |
|---|---|---|
| A1 | `npm run check:task -- T09` | Final line `check:task T09 PASS`, exit 0, with no `VACUOUS` |
| A2 | `npx vitest run tests/unit/harness/metrics.test.ts` | All pass. `byteDiff` of a one-byte change: `{ bytes: 1, max: d }`. `washout` on a synthetic 4-pixel frame: exact counts, with `min(r,g,b)` at 235 not near-white and 236 near-white. `hazeLift` exact to 1e-9. `shimmerBand(1080)` is `[615, 650]`, `shimmerBand(900)` is `[513, 542]` |
| A3 | Same file, drills | `crackCount`: sky pixel under terrain 1, sky above only 0, all sky 0, all terrain 0. `silhouetteStd` on a flat line 0, on a sawtooth over 0. `bandDiff` flipped top for bottom differs, pinning orientation. `edgeCounts` classify `DebugPaint`'s exact values. `leakStats` known array exact. `windowMedian` drops negatives |
| A4 | `npx vitest run tests/unit/harness/api.test.ts` | For each row of section 4's table, the expected `FakeHost.calls` entry. `setCrackMode(true)` then `false`: `debugMode` shows `crack` then `none` on every layer, `layerVisible` shows only terrain on, then all on. `stats()` shape complete |
| A5 | Same file, guards | Each of these throws or rejects with the stated text: `renderAt` not manual (`manual`), `renderAt` at a chunk outside [0, CHUNK_LIMIT + 1024), including 2^48, 2^49 + 5, -1, 1.5, NaN and both infinities, a `RangeError` naming `CHUNK_LIMIT + 1024` with no host call and no read, also while the context is lost; the same from the core's `renderState` and from `compareAt`, `refill`, `settle` and `sequence` past the range, and both ends, 0 and CHUNK_LIMIT + 1023, accepted (DI-93), `stepFrames(1.5, ...)`, `stepFrames(1, 0)`, `pixels()` with no render (`same run`), `pixels()` after an `await` (`same run`), `setCrackControl(true)` with no implementing layer (`no layer`), `restoreContext()` before loss (`loss event`), a second `loseContext()` while lost. Each passes in the right order. **The unit tests must fail if the guard is removed:** verified by a temporary edit, once, with the failure pasted |
| A6 | `npx playwright test tests/forever/api.fake.spec.ts --project=gpu` | Real GL through the fake host: `pixels().length === w * h * 4`; `renderState(1029, 3, 120)` and a second `renderState(5, 3, 120)` match `renderState(5, 3, 120)` within the same-state bound (DI-68), and `renderState(6, 3, 120)` differs, as T00's A12; `stats()` numeric; `window.__mv.ready` true; `__mvHarnessChunk` set |
| A7 | `npx playwright test tests/forever/armed.spec.ts --project=gpu`, then open the screenshot | `TARGET shell`. `checkRasterizer` null with the RTX string. Viewed: gradient sky, banded sun, grid floor. State in Progress what you saw |
| A8 | `-g "identity exact"` on the shell | Post off, MSAA off, after a 1 s settle: within the same-state bound (DI-58; on `gpu` at most 64 bytes, none over 1) at all 4 `k`, one try, with `meanLuma > 1`, and `local` 13.5 differing by more than 1000 bytes [O: 0 bytes] |
| A9 | `-g "identity control"` | `absCoord` on, under the same-state bound: `crossBytes >= 100000` [O: 2,499,165, max 207], self-compare within the bound [O: 0], `pass` false, in the exact test and the post-on test, with attempts 1 |
| A10 | `-g "identity post on"` | Post on at MSAA 0 (DI-67). `pass` true under the same-state bound, attempts printed, at most 5, `worstCrossMax` at most 1. Run the spec 5 times in a row: 5 passes. Record any attempt count over 1 in section 10. Also, printed and not gated: `identity-vulkan.spec.ts`, post on at MSAA 2 under `--use-angle=vulkan`, renderer string hardware Vulkan; where the launched renderer is not Vulkan, or is SwiftShader, the print skips with `NOT VULKAN (DI-71)` and says why (DI-71(2), R3) |
| A11 | `-g "sequence"` and `traps.spec.ts` | Sequence `pass` true at both distances, post on at MSAA 0 (DI-67). Trap 1: `rawDirectNoClear` under 1% magenta [O: .14%], guarded path 100%, on `'off'` and `bare`. Trap 2: `staleUpload` frame differs, `pendingVisible` 0. Trap 3: `rawReadLater` 0 non-zero pixels [O], `pixels()` in a later evaluate rejects, in the same run over 90% non-zero. Trap 4: `restoreInDispatch` reports `restoredWithin3s: null`, and the second call restored [O]; API order restores with `gl.isContextLost()` false and `gl.getError()` 0 [O] |
| A12 | `npx playwright test tests/forever/shimmer.spec.ts --project=gpu` | On the app with props hidden (DI-74), on the shell as is. Repeat within 2%. Zero step at most .001 [O: 0]. Control over `max(8, 1.5x clean)` [O: 19.57 vs 8.10; app, props hidden, 18.64 vs 7.44, T10]. After removal within 2% |
| A13 | Baseline: delete `test-refs/T09/shimmer.json`, run, set the env var, run, run | First: FAIL with `No shimmer baseline`. Second: `BASELINE WRITTEN`. Third: PASS. Then edit the value to half, run: FAIL. Restore. Runs under `TERRAIN_HARNESS_TARGET=shell` or `app` key separately Every run measures at sim tick 1200, asserted (R3) |
| A14 | `npx playwright test tests/forever/washout.spec.ts --project=gpu` | Every test at sim tick 1200 by `stepToTick`, asserted (DI-76). Both controls under `forceZone(SUNSET_DRIVE, BOULEVARD, 0)` (R3). `floodLines(16)`: near-white under .5, chroma over 55, haze over 20 [O: .006, 152.4, 35.34]. `veil(.06)` (DI-76; `.05` under DI-72): near-white under .5, chroma over 55, haze under 20, `blackP10` over 25 [at `.05`: O, shell: 0, 84.64, 8.40, 43; real layers with `labPost`: 64.4 to 65.3 chroma, `blackP10` 35; at `.06` on the app with T06's post: `blackP10` 32, chroma 59.6, T10]. Removing the veil fails it on `blackP10` (15). Controls off, post off, MSAA 0: with both on, over 1000 bytes differ; after both are off, within the same-state bound (DI-68). Save and open the flood frame, and say what you saw |
| A15 | `npx playwright test tests/perf/alloc.timing.spec.ts --project=gpu-timing` | `heapCalibration` at least 1000 [O: 1032]. Clean median printed, after at least 5 runs, three runs in a row within 5% of their mean (DI-77; within 1 B before it) [O: 3773.6 three times]. `windowStability` unit-tested on T10's app series, which pass, and on climbing and outlier series, which fail. `allocProbe(256)` moves it by 256 ± 16, sequential, on the shell (DI-84) [O: method gave +28.0, +136.0, +520.0 exactly]. `probeShift`, `allocPairs` and `windowsControlCheck` unit-tested, and a probe of 0 fails the app's interleaved form at 1024 ± 256 (DI-86(2)). `probe` reads at least 180, and at least 700 for 1024 [O: 155 for true 136, 534 for true 520]. Slope under 10 with `allocProbe(1024)` on [O: -0.01]. `leakProbe(256)`: slope at least 200, retained-only `probe` at least 150, clean retained-only under 10 [O: 40.4; 50.5 and .3, at a smaller size] |
| A16 | `npx playwright test tests/forever/isolation.spec.ts --project=gpu` | Marker in exactly one file. Dynamic, normal visits: 0 fetches, no globals [O]. `?harness`: 1 fetch [O]. Static build, normal visit: marker file fetched, global set [O]. Replacing the marker with an unused export: marker count 0, and the test fails, verified once with a temporary edit [O] |
| A17 | `npx playwright test tests/perf/frame.timing.spec.ts --project=gpu-timing` | `gpuLoad(1024)` raises p50 by at least 3 ms [§11.4]; off returns within 20%. Shell p50 and p95 printed. 20% of a 1 ms p50 is 2 quanta of the .1 ms timer; if the restore check fails on a quiet machine, a floor of `max(20%, .3 ms)` needs a reviewer's agreement first (V1). No change now |
| A18 | `$env:TERRAIN_SOAK_FRAMES='7200'`, `tests/forever/soak` under `gpu-timing` | Shell: 2 samples, all gates evaluated, `between` rising, distance printed from before batch 0. At 2 samples the constant-resource checks compare sample 1 with sample 0 (before R1 they compared sample 1 with itself, V1). **Control:** `leakProbe(512)` breaches growth at 2 batches, 3.7 MB [arithmetic] |
| A19 | `npx playwright test tests/forever --project=gpu` before T10 | Every armed test reports skipped with `UNARMED`. No unexpected failures. Count of skips printed and recorded |
| A20 | `npm run plans:check` | Exit 0. T09's `owns` equals its §12 row |
| A21 | `npm run check` after the batch | Exit 0 |

### B. Armed at T10, on the integrated build

T10 is not done until these pass. T10's executor runs them, pastes the short output into T10's plan, and reports a T09 defect through the reopen rule.

| # | Command or action | Expected |
|---|---|---|
| B1 | `npx playwright test tests/forever --project=gpu` | **Zero skipped,** with one exception: `identity-vulkan.spec.ts` skipping with `NOT VULKAN (DI-71)` on a machine whose launched renderer is not hardware Vulkan, which DI-71(2) requires. Any other skip means a suite is not armed, and fails B1. `armed.spec` prints `TARGET app` |
| B2 | `isolation.spec.ts` | On `dist/` from a nested path and on the dev server: 0 harness fetches on a normal visit, at least 1 under `?harness`, `window.__mv` undefined normally. `dist/` marker in exactly one file |
| B3 | `identity.spec.ts` | Post off, MSAA off, all layers, after a 1 s settle: within the same-state bound at all 4 `k`, one try (DI-58: on `gpu` at most 64 bytes, none over 1). Liveness: chunk 6 differs by over 1000 bytes |
| B4 | `identity.spec.ts`, post on | `full`, MSAA 0 (DI-67), all layers: `pass` under the same-state bound, attempts printed. Max diff at most 1 even in failed attempts (art-stack row), asserted as `worstCrossMax`. Sequence 120 frames at MSAA 0, both distances, `pass`. Control `absCoord` fails at once. Printed, not gated: `identity-vulkan.spec.ts`, `full` at MSAA 2 under Vulkan on the app; a difference there that MSAA 0 does not show is a finding for T05 and T06, not a gate failure |
| B5 | `cracks.spec.ts` | 0 bad over 900 frames at world 0, 1e9, 1e15, both paths, flat and full bend. Then `tier: 1` (stride 2), chunk `15625000000000`, full bend, 300 frames, both paths, 0 bad and `silhouetteStd` at least 2, since §6.4's `DoubleSide` matters there and T03's evidence is only on its dev page |
| B6 | Same | `setCrackControl(true)` non-zero at every position [T03 O: 1.2M to 1.4M per 900 frames]; back to 0 after. PNG viewed. **Reset:** the last frame in control-off is clean |
| B7 | `edgepaint.spec.ts` | 21:9 at FOV 68, bend 8e-5: `bad` 0, `ok` at least 1000, at both distances |
| B8 | `warp.spec.ts`, distances | Shimmer within 1.25x of home at 1e9, 1e12, 1e15, 1e16, home being the first biome-0 zone from zone 12, at or past the difficulty cap, asserted (R3). Day phase, gate phase and landmarks can still differ between home and far. `finite` ok. `nonFlat` std at least 1 u [A]. `silhouetteStd` at least 2 px [A] |
| B9 | `warp.spec.ts`, guard | Six falses with state unchanged, `CHUNK_LIMIT - 1` true, travel rises, no crash |
| B9b | `warp.spec.ts`, render range (DI-93) | On the app, after one warm-up frame: `renderAt(CHUNK_LIMIT + 1024)` is a `RangeError` naming `CHUNK_LIMIT + 1024`, alone in its own evaluate, so code without the guard fails there before any call that could hang. Then, raced against 15 s so a hang is reported: `renderAt` at 2^49 + 5, -1, 1.5, NaN and Infinity, and `compareAt`, `settle` and `refill` at 2^49 + 5, all `RangeError`. `renderAt(CHUNK_LIMIT + 1023)` and a return to chunk 5 render finite, with non-zero pixels, and chunk, local, tick and `warpSerial` unchanged. A6's guard test shows the same refusal on the fake page |
| B10 | `shimmer.spec.ts` | At sim tick 1200, so the pose is fixed (R3). Props hidden, `full` (DI-74): over 1, a liveness floor, then at most 8 [A], at most `baseline * 1.02`. The naive-grid control, also props hidden, over the limit (A12). Printed, not gated: all layers under `full` and `bare`, and props hidden under `bare`. What props add is T05's own temporal check (DI-74(2)), and §14 risk 4 stays open until that is gated. Any threshold change needs a Decision log entry and the reviewer's agreement (`Agents.md`) |
| B11 | `washout.spec.ts` | At sim tick 1200 by `stepToTick`, asserted (DI-76). Default frame, palette 0: under .5, over 55, at most 20, at most 25 [all A]. Palettes 1 to 5 printed. Controls still trip, on forced Sunset Drive, the veil at `.06` (R3, DI-72, DI-76) |
| B12 | `context.spec.ts`, two tests (DI-65) | Sim held, refilled before both captures, waiting at an advancing tick, compared back at the key's tick with the overlay still hidden (R3): post off and `full`, both at MSAA 0 (DI-67), within the same-state bound across a loss and restore (DI-58), and `stats()` chunk, local and tick unchanged. Loop running: overlay shows and hides, travel rises during the loss, a tier forced in the loss applies, all four variants non-blank, 0 links in a tier cycle after restore. No console error |
| B13 | Same, never-restored | `[data-mv="fatal"]` within 20 s [§10.2: 15 s]. Page closed at once |
| B14 | `traps.spec.ts` | As A11 on the app, except `restoreInDispatch`, which is shell-only. Trap 2's warp-after-hidden frame matches, within the same-state bound, a self-healing refill of the same state on the same page (a jump to chunk 5 and back), with no sim step between them; `pendingHiddenMax` at most 64 and `pendingVisible` 0 |
| B15 | `npx playwright test tests/forever/soak --project=gpu-timing` | 72,000 frames. At least 700 km [§11.3: 723 km], measured from before batch 0 with nothing assumed. Growth at most 1 MB, last three within 64 KB, heap at most 64 MB. Geometries, textures, programs, objects constant from sample 1. 0 links. `pendingVisible` 0 and `pendingHiddenMax` at most 64 at every sample. `finite` ok. Calls at most 68, triangles at most 1.5M at every sample. Print wall time |
| B16 | `tierswitch.spec.ts` | 0 links, tiers as asked, read from the buffer: after each tier's second frame it fits that tier's `maxPixels` and exceeds the tier below's where the full-size buffer does. Max frame diff at most 16 [A], printed per transition. The diff includes time-based animation, as M9 notes |
| B17 | `npx playwright test tests/perf/frame.timing.spec.ts --project=gpu-timing` on a quiet machine | Real build, tier 3, heaviest biome: p95 at most 2.0 ms [§9.2; art prototype 1.1 ms]. Calls at most 68 and triangles at most 1.5M on all 6 biomes. Control trips. Print p50, p95, p99 and the biome |
| B18 | `budgets.timing.spec.ts` | At least one `sim.step`, one terrain or props `frame` and one `post.render` in every instrumented frame, at both dt, and `minCalls.layers` at least `layerCount` (R3), all through `callCountProblems`. Streaming p99 at most 2 ms. Sim p95 at most .5. Layers p50 at most 1. Residual p95 at most .5. Warp max at most 30. `instanceBytes` at most .2 MB, `dataTextureBytes` at most 1.6 MB. Heap at most 64 MB |
| B19 | `alloc.timing.spec.ts` | Limits per section 4, `other` at 512 B/frame (DI-78). Top 12 functions pasted into this plan's Outcomes, which resolves §14 risk 6. `probe` under 10 in clean runs. Controls trip, including the `other` line on a 1024 B allocation counted as project code. The windows control is interleaved on the app, probe-on against probe-off windows over one stretch, with `allocProbe(1024)` at 1024 ± 256 (DI-84, DI-86(2)). At least 5 window runs before the stability line may be met, and the stability line and windows control soft (DI-84). A failure on the stability line alone, three consecutive window medians within 5% of their mean (DI-77), is a T09 measurement failure, reported to T09, not a §9.2 breach (V1 ruling) |
| B20 | `npx playwright test tests/perf --project=software` | Renderer matches SwiftShader. Tier 0. p95 at most 50 ms. Printed calls and triangles |
| B21 | `bundle.spec.ts` | Builds `index.html` with the project's config into the test's own output folder, never `dist/`, then: sum at most 260 KB, over 100 KB, harness chunk excluded. Never skips for want of a build: no `index.html`, a failed build or a build with no `index.html` each fail with a message saying so. Runs under `software` only, as `test:perf` routes it |
| B22 | Human check. Operator, before release: `$env:TERRAIN_SOAK_MINUTES='120'`, `soak-realtime` | Heap samples every 5 minutes within §9.3, travel rising. Operator-run, §14 risk 7 |

## 8. Idempotence and recovery

- Safe to re-run: every test and `check:task`. Output stays under `test-results/T09*`, plus `test-refs/T09/shimmer.json` only when `TERRAIN_WRITE_BASELINE=1`. `isolation.spec.ts`'s fixture builds write only under `test-results/T09-iso/`. Armed `frame.timing` and isolation's B2 run `vite build`, which rewrites `dist/`; run them only while nothing else is using `dist/`. B21 (`bundle.spec.ts`) builds into its own test output folder under `--output`, and never reads or writes `dist/`.
- Clean state without git: `Remove-Item -Recurse -Force src\harness, tests\forever, tests\perf, tests\unit\harness, test-results\T09*, test-refs\T09 -ErrorAction SilentlyContinue`.
- Before a risky rewrite: `Copy-Item -Recurse src\harness $env:TEMP\t09-harness-backup`.
- A baseline is per machine and per target. Deleting it makes the shimmer test fail until it is written again, on purpose.
- Never install packages, never run `npx playwright install`, never edit outside the owned paths. A defect in a contract, the shell or a sibling goes in section 10 with evidence, and the plan goes `blocked`.
- If a browser test hangs, the page has probably lost its context without a restore (§10.2). Close it. The never-restored state crashed a tab within 100 s, so no spec lingers in it.
- Run one `gpu-timing` suite at a time on a machine (`Agents.md`). A timing failure while siblings are running proves nothing: record it and re-run when quiet.
- The identity sequence allocates about 1 GB in the page. If several Chromium instances run at once it may fail with `RangeError`, and the message says so.
- Never edit a threshold or expected output to get a pass without a Decision log entry and the reviewer's agreement.

## 9. Progress

- [x] 2026-11-05T07:23Z Plan drafted, rehearsals in the session scratchpad, no project code. No acceptance has run.
- [x] 2026-11-05T14:45Z M0. `npm run contracts:check`: `contracts:check PASS, 7 files`, exit 0. Read `src/contracts/index.ts`, `src/testing/fakeHost.ts`, `devShell.ts`, `devPost.ts`, `scriptedFrame.ts`, `fakeWorld.ts`, `tests/support/*`. Every member named in sections 4 and 12 is on disk as §8.1 states it: `HarnessStats` fields, `forceFeel`, `setTier`, `forceSignalLost`, `loseContext`, `restoreContext`, `overrideFeel`, `CRACK_CONTROL_GROW`, `DebugPaint`, `setCrackControl?`, `FakeHostCalls.overrideFeel`, `governorForce`.
- [x] 2026-11-05T15:05Z M1, A2, A3. `npx vitest run tests/unit/harness`: every metric on synthetic frames with exact output. Final: 6 files, 139 tests pass.
- [x] 2026-11-05T15:05Z M2, A4, A5, A6. Guard drill below. A6: `FAKE {"ready":true,"marker":"MV-HARNESS-CHUNK","length":230400,"expected":230400,"distant":0,"again":0,"nextRow":172800,"nonZero":57600,"numeric":true,"calls":1,"width":320,"height":180}`, and a read in a later evaluate rejects with `same run`.
- [x] 2026-11-05T15:06Z M3, A7. `armed.spec.ts`: `TARGET shell: armed suites skipped`, `RENDERER ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)`, 15 calls, 12,302 triangles, 9 links. **Viewed `harness-shell.png`:** purple-to-red gradient sky, a yellow-to-pink sun with horizontal bands cut into its lower half, a magenta grid floor converging on the vanishing point with bright glowing lines. What looks wrong: the floor meets the sky at a hard horizontal edge at about row 606, with the sun cut off straight by it. That is T00's proof floor, not a harness matter.
- [x] 2026-11-05T15:06Z M4, A8, A9, A11, on the shell, GPU shared with siblings:
  ```
  IDENTITY exact k=977|15259|976562500|15258789063  pass true, attempts 1, selfBytes 0, crossBytes 0, meanLuma 22.93
  IDENTITY liveness {"bytes":363488,"max":255,"first":1556}
  IDENTITY post-on k=977|15259|976562500|15258789063  pass true, attempts 1, selfBytes 0, crossBytes 0, meanLuma 46.37
  IDENTITY sequence k=15259 and k=15258789063  {"pass":true,"attempts":1,"worstBytes":0,"worstMax":0,"worstFrame":-1,"store":"ok"}
  IDENTITY control exact {"pass":false,"attempts":1,"selfBytes":0,"crossBytes":1250882,"crossMax":255}
  IDENTITY control post-on {"pass":false,"attempts":1,"selfBytes":0,"crossBytes":3374549,"crossMax":201}, then after removal pass true
  TRAP1 raw {"autoClear":false,"magenta":0,"total":2073600}; off {"before":67535,"after":2073600}; bare {"before":0,"after":2073600}
  TRAP2 {"differ":6123600,"pendingVisible":0}
  TRAP3 later {"nonZero":0,"total":2073600}; same {"length":8294400,"nonZero":2073600,"total":2073600}; later evaluate and after await both reject with "same run"
  TRAP4 drill {"restoredWithin3s":null,"secondCallRestoredAt":3021.5}, console warning "WebGL: INVALID_OPERATION: restoreContext: context restoration not allowed"
  TRAP4 api lost at 4.8 ms, restored in 7.3 ms, wrong order rejects with "loss event", second loss rejects with "not live", then gl.isContextLost() false, gl.getError() 0
  ```
- [x] 2026-11-05T15:18Z A10. `-g "identity post on"` five times in a row: 5 passes, every attempt count 1 at all 4 `k`. No flake seen.
- [x] 2026-11-05T15:07Z M5, A12, A13, A14.
  ```
  SHIMMER {"first":12.202159743329958,"second":12.202159743329958,"zero":0,"naive":20.339474417426548,"after":12.202159743329958}
  A13 first: Error: No shimmer baseline for this machine. Inspect a run, then set TERRAIN_WRITE_BASELINE=1
  A13 second: BASELINE WRITTEN ANGLE (...)|shell|1920x1080|615-650 12.202159743329958
  A13 third: SHIMMER baseline 12.202159743329958, limit 12.446202938196556, passed
  A13 halved: Expected: <= 6.223101469098278, Received: 12.202159743329958, failed. Restored: passed
  WASHOUT clean {"nearWhitePct":0,"meanChroma":112.24,"blackP10":15,"meanLuma":46.37,"hazeLift":10.25}
  WASHOUT flood {"nearWhitePct":0,"meanChroma":173.95,"blackP10":42,"meanLuma":79.59,"hazeLift":32.14}
  WASHOUT veil  {"nearWhitePct":0,"meanChroma":65.31,"blackP10":75,"meanLuma":98.12,"hazeLift":6.27}
  WASHOUT off {"during":5916110,"after":0}
  ```
  **Viewed `washout-flood.png`:** thin white horizontal lines every 16 px across sky and floor, hot pink glow filling every gap, the dark purple of the clean sky entirely gone, floor cells pink rather than near-black. It reads as flooded. **Viewed `washout-veil.png`:** the same scene through a grey film: sky a muddy mauve, floor cells flat grey-brown where they were near-black, grid lines still bright. It reads as washed out. Neither has anything wrong beyond what each control is for. The `app` baseline key cannot be exercised before T10; the key string includes the target.
- [x] 2026-11-05T15:17Z A5, drill. Each guard removed by a temporary edit, once, then restored:
  ```
  renderAt, stepFrames: requireManual removed: exit 1, 3 failed | 39 passed (42)
  pixels: same-run guard removed: exit 1, 4 failed | 38 passed (42)
  stepFrames: count check removed: exit 1, 1 failed | 41 passed (42)
  stepFrames: dt check removed: exit 1, 1 failed | 41 passed (42)
  setCrackControl: vacuous-control throw removed: exit 1, 1 failed | 41 passed (42)
  restoreContext: loss-event guard removed: exit 1, 2 failed | 40 passed (42)
  loseContext: second-call guard removed: exit 1, 2 failed | 40 passed (42)
  setLayerVisible: unknown-name throw removed: exit 1, 1 failed | 41 passed (42)
  renderAt: arm removed, so a same-run read would throw: exit 1, 2 failed | 40 passed (42)
  ALL GUARDS CAUGHT
  ```
- [x] 2026-11-05T15:28Z M6, A15, through the shared lock, GPU shared with siblings (allocation is not a GPU-time number):
  ```
  ALLOC calibration 1032
  ALLOC clean windows 3847.2, 3761.6, 3761.6, 3761.6, dropped 3 to 6 of 300. Clean median 3761.6
  ALLOC allocProbe(256) windows 4022.4, moved 260.8; clean again 3761.6. An earlier run moved exactly 256.0
  HEAP clean: total 4144.8 B/frame, probe 0.0, harness 367.3, world 0.0, other 11.3, libs 3617.2, engine 149.0
  HEAP allocProbe(256): probe 305.9; allocProbe(1024): probe 1037.6. Earlier run: 263.4, 1049.6
  ALLOC slope with allocProbe(1024) 3.733 B/frame
  HEAP retained, clean: probe 0.0. leakProbe(256): probe 272.1
  ALLOC slope with leakProbe(256) 260.865 B/frame
  ```
- [x] 2026-11-05T15:18Z M7, A16.
  ```
  ISO marked dynamic ["assets/harness-BrtY1q9E.js"] static ["assets/index-JYLY51a_.js"]
  ISO dynamic "": 3 requests, marked file 0; "?harnessx=1": 3, 0; "#harness": 3, 0
  ISO dynamic "?harness": 4 requests, marked file 1
  ISO static "": 2 requests, marked file 1
  Unused-export drill, temporary edit of src/harness/index.ts: static marked [], "zero means the marker was tree-shaken", Received 0, 3 failed. Restored: 4 passed
  ```
- [x] 2026-11-05T15:26Z M8, A17, through the lock. Five runs, GPU shared with siblings, so the numbers are contaminated. Utilization read 0 to 36% around them, from `nvidia-smi`, which is a snapshot and not a proof of quiet.
  ```
  run 1: clean p50 1.0, load256 2.6, gpuLoad(1024) 7.2, after 0.7   FAILED the restore check: Received 0.30, limit 0.20
  run 2: clean p50 0.8, load256 2.9, gpuLoad(1024) 7.6, after 0.9   passed
  run 3: clean p50 0.9, load256 2.4, gpuLoad(1024) 7.1, after 0.8   passed
  run 4: clean p50 0.9, load256 2.4, gpuLoad(1024) 7.3, after 0.9   passed
  run 5: clean p50 1.0, load256 2.5, gpuLoad(1024) 7.7, after 1.0   passed
  ```
  The raise is 6.2 to 6.8 ms, where §11.4 reads 5.8 ms absolute. Run 1's restore check read 30% against a 20% limit, which is .3 ms on a p50 near 1 ms at .1 ms resolution, on a shared GPU. The plan says such a failure proves nothing, and it is recorded here. Neither the failure nor the passes have been shown on a quiet machine. Shell p95: 1.0 to 1.4 ms clean.
- [x] 2026-11-05T15:28Z M9, A18: `TERRAIN_SOAK_FRAMES=7200`, through the lock.
  ```
  SOAK 0 heap 24.920 MB, chunk 563, geo 3, tex 13, prog 9, objects 4, links 9, calls 15, tris 12302, 2566 ms
  SOAK 1 heap 24.954 MB, chunk 1125, geo 3, tex 13, prog 9, objects 4, links 9, calls 15, tris 12302, 2261 ms
  SOAK wall 4844 ms, 7200 frames, target shell. Travelled 36.0 km after warm-up. Growth 35,686 B
  SOAK control {"growth":1894326,...}: 512 B over 3600 frames is 1.8 MB a batch. Passed: over the 1 MB limit
  ```
- [x] 2026-11-05T15:31Z A19: `npx playwright test tests/forever --project=gpu`: `15 skipped, 24 passed (41.5s)`, exit 0. From the JSON reporter at 15:24Z, all 15 skip annotations read `UNARMED: needs T10`.
- [x] 2026-11-05T15:31Z A1: `npm run check:task -- T09`: `tsc: 47 owned files, 2 configs, 0 problems`, `eslint: 47 owned files, 0 errors, 0 warnings`, `vitest: 6 owned files, exit 0`, `glsl: 51 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0.
- [x] 2026-11-05T15:31Z A20: `npm run plans:check`: `plans:check: 12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [ ] A21: `npm run check`. Not yet run: it runs after the batch. So Definition of done item 2 is still open for the whole repo.
- [ ] Armed at T10: B1 to B21 pass, recorded in T10's plan; §14 risk 6 answer pasted into Outcomes

Armed specs were also dry-run once on the shell with `TERRAIN_ARMED_ON_SHELL=1`, to find mistakes in the specs themselves. **This proves nothing about the game, and no B row has run.** Of the 20 tests that run selected, 9 ran to the end, including the warp guard on the fake sim. The other 11 stopped where the shell has no `index.html`, terrain, props or UI: no overlay, `setCrackControl` has no layer, no `props` layer, `silhouetteStd` 0 with no terrain, 12 links in a tier cycle with no keep-alive pass. It found one real spec error, a width assertion that tier 3's pixel cap broke, now fixed. `budgets.timing` ran its machinery to the residual check, which on the shell holds the shell's own 1x1 sync. `software.spec` ran to the tier check, because the shell does not pin tier 0.

### Repair R1, after the V1 verifier

- [x] 2026-11-05T20:09Z Status `in-progress`. Read `Agents.md`, this plan, V1's verdict (2 blocking and 11 low for T09, 13 rulings) and DI-58 to DI-66; DI-58 and DI-65 name T09. All 52 owned files copied and hashed to the scratchpad `T09/backup` before any change.
- [x] 2026-11-05T20:16Z Lab: `compareAt` and `sequence` take `{ tolerance }` (DI-58), `compareAt` reports `selfMax` and `worstCrossMax`, and `instrument` counts wrapper calls per frame (`minCalls`). `npx vitest run tests/unit/harness/sweeps.test.ts tests/unit/harness/budget.test.ts`: 55 passed.
- [x] 2026-11-05T20:18Z Unit mutation drills, one at a time, each file restored and its sha256 confirmed:
  ```
  sequence `dirty >= 0` (V1's survivor)       exit 1    compareAt worstCrossMax = last only     exit 1
  sequence dirty ignores the tolerance         exit 1    compareAt no fail-at-once over 1 level  exit 1
  compareAt tolerance forced to EXACT          exit 1    within() allows 65 bytes                exit 1
  instrument post.render not counted           exit 1    minCalls kept as a maximum              exit 1
  instrument sim.step count pinned at 1        exit 1
  ```
- [x] 2026-11-05T20:22Z `npm run check:task -- T09`: 154 tests (was 139), `tsc: 47 owned files, 2 configs, 0 problems`, `eslint: 47 owned files, 0 errors, 0 warnings`, `glsl: 51 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0.
- [x] 2026-11-05T20:23Z A8 to A14, A19 after every edit: `npx playwright test tests/forever --project=gpu --output=test-results/T09-R1/forever`: `16 skipped, 24 passed (42.5s)`, exit 0. One more skip than before, because B12 is two tests now.
  ```
  IDENTITY tolerance {"bytes":64,"max":1} (DI-58, project gpu)
  IDENTITY exact k=977..15258789063  pass true, attempts 1, selfBytes 0, selfMax 0, crossBytes 0, crossMax 0, meanLuma 22.93
  IDENTITY post-on, all 4 k          pass true, attempts 1, worstCrossMax 0, meanLuma 46.37
  IDENTITY sequence both k           pass true, attempts 1, worstBytes 0
  IDENTITY control exact             pass false, attempts 1, selfBytes 0, crossBytes 1250882, crossMax 255
  IDENTITY control post-on           pass false, attempts 1, selfBytes 0, crossBytes 3374549, crossMax 201; after removal pass true
  SHIMMER first 12.2022, second 12.2022, zero 0, naive 20.3395, after 12.2022; baseline 12.2022, limit 12.4462
  TRAP1-4, WASHOUT clean, flood, veil, off: the same numbers as at 15:06Z. No "HMR mock: also mocked" line
  ```
- [x] 2026-11-05T20:25Z New B12 and B14 as a dry run on the shell, `TERRAIN_ARMED_ON_SHELL=1`. Proves nothing about the game.
  ```
  CONTEXT held: before sim chunk 1, local 1.333, tick 2; lostDraw true; restoreFrames 1; off 0 bytes; full 0 bytes; sim unchanged  -> passed
  CONTEXT travel [{1, 2}, {1, 3.333}, {1, 44.667}]: 41.3 u in 500 ms, during the loss
  CONTEXT after restore: tierAfter 2, widthAfter 1600, variants 2073600 each, links 12  -> failed on links only, the shell's known lack of a keep-alive pass
  TRAP2 armed: pendingHiddenMax 0, pendingVisible 0, diff 0 bytes, meanLuma 22.94, simHeld true  -> passed
  ```
- [x] 2026-11-05T20:27Z **Failing before, shown.** The pre-repair B12 and B14 structures, copied into a temporary spec (`tests/forever/zz-t09-oldstructure.spec.ts`, deleted after) with only the overlay lines removed and `props` read as the shell's one layer:
  ```
  camera pinned (the shell as V1 ran it):   OLD B12 off 0, full 0  passed.   OLD B14 hashes 4245241100 = 4245241100  passed
  camera follows the sim (?follow=1):       OLD B12 off 324,024 bytes max 255, full 1,842,533  FAILED.   OLD B14 3255449984 != 1295407509  FAILED
  ```
  So the shell was blind to both defects, as V1 said, and once its camera follows the sim as the app's does, both old structures fail and both new ones pass.
- [x] 2026-11-05T20:29Z Spec mutants on the new B12 and B14, on the shell, each restored and hash-confirmed:
  ```
  B12 held, 240 sim frames after the restore, camera follows    exit 1  "post off across a loss: DI-58", 283,408 > 64
  the same, camera pinned                                       exit 1  "the sim was held through the loss"
  B12 loop, manual(true) before the loss                        exit 1  "travel must rise through a loss: R1", 0
  B12 held, shell restore without its rebuild                   exit 0  SURVIVED, see section 10
  B14, 240 sim frames between the frames, camera follows        exit 1  "the warp frame and the refill...: DI-58", 286,063 > 64
  the same, camera pinned                                       exit 1  "no sim step between the two frames"
  B14, a stale range left on the warp frame                     exit 1  6,123,600 > 64
  ```
- [x] 2026-11-05T20:31Z Low armed rows as shell dry runs, each with a mutant that removes the new check:
  ```
  cracks tier 1, new: FAILED "a missing or flat terrain reads near 0", silhouetteStd 0 (the shell has no terrain). Check removed: PASSED on nothing
  tierswitch, clean: FAILED on links 12 only. Host never applies a forced tier: FAILED "tier 2: 1920x1080 must fit its maxPixels 1440000". The same with the size checks removed: PASSED
  shimmer limit, clean: FAILED on the limit, 12.2022 > 8 (shell). Nothing moving in the band: FAILED "reads under 1", 0. The same with the floor removed: PASSED
  ```
- [x] 2026-11-05T20:33Z A18 and B15, B18 machinery, through `gpu-lock.mjs`, GPU shared with siblings (`nvidia-smi` 36 to 38%), so no timing number here counts:
  ```
  SOAK 0 heap 24.949 MB, chunk 563; SOAK 1 heap 24.982 MB, chunk 1126; constants equal, links 9
  SOAK travelled 72.0 km in all, measured from before batch 0; 36.0 km after warm-up; growth 34,790 B. Control growth 1,893,878 B. 2 passed
  700 km gate forced on this 7200-frame run: FAILED, 72.0 < 700, so it measures and can fail, with nothing assumed
  a mesh added in batch 2: new 2-sample reference FAILED "sample 1: objects", 5 against 4; old reference samples[1] PASSED
  BUDGET (shell, armed dry run): steady minCalls sim 2, layers 1, streaming 0, postFrame 1, postRender 1, streaming p99 0
  -> FAILED "steady: a frame with no terrain or props frame seen": the vacuous line V1 described, now caught
  ```
- [x] 2026-11-05T20:35Z A15 again, because the shell host changed, through the lock: `1 passed (58.1s)`, exit 0. Calibration 1032; clean windows 3848.4, 3761.8, 3761.6, 3761.6, median 3761.6; `allocProbe(256)` moved 263.6; profile clean probe 0.0, other 14.2, world 0.0, libs 3542.4; probe 295.6 and 1039.0; slope with `allocProbe(1024)` 1.996; retained clean probe 0.0, leak 271.2; leak slope 260.823.
- [x] 2026-11-05T20:35Z **Viewed `test-results/T09-R1/forever/.../harness-shell.png`** (A7, 1920x1080), since the shell host changed: purple-to-magenta gradient sky, the yellow-to-pink sun with horizontal bands in its lower half cut flat by a hard horizon near row 606, a magenta neon grid converging on a centred vanishing point, dense moire near the horizon. Same as before; the vanishing point is centred because A7 does not ask for `?follow=1`. No repaired row writes an image.
- [x] 2026-11-05T20:36Z Not re-run in R1: A10's five in a row, A13's delete-and-rewrite drill, A16, A17 (`frame.timing`, unchanged). A21 and the B rows still wait for the batch and for T10.
- [x] 2026-11-05T20:38Z Final, on the final code: `npm run check:task -- T09` `check:task T09 PASS`, exit 0; `npm run plans:check` `12 plans, 2648 pattern pairs, 0 problems`, exit 0; `npx playwright test tests/forever --project=gpu --output=test-results/T09-R1/forever-final` `16 skipped, 24 passed (41.0s)`, exit 0. Changed against the backup: 17 owned code and test files plus this plan, all inside `owns`; the temporary spec is gone. Status `done`: every repaired row that can run before T10 ran, and the B rows stay with T10.

### Repair R2, after DI-67 and DI-68

- [x] 2026-11-05T21:08Z Status `in-progress`. Read `Agents.md`, this plan, DI-58, DI-67 and DI-68, and §11.3's Pixel identity row (post on at MSAA 0). All 52 owned files copied and hashed to the scratchpad `T09/backup-R2` before any change.
- [x] 2026-11-05T21:10Z Survey of every frame comparison T09 gates, by `grep` for `byteDiff`, `compareAt`, `sequence(`, `bandDiff` and `setMsaa` over the owned specs:
  ```
  same state, MSAA 2 -> MSAA 0 (DI-67)   identity post on (A10, B4); identity sequence (A11, B4); the absCoord control's post-on half; B12 held `full`
  same state, already MSAA 0             identity exact (A8, B3); absCoord near control; B14 trap 2; washout controls off; cracks and edge paint are counts, not compares
  same state, exact -> DI-58 (DI-68)     washout controls off `after` (A14); A6 `distant` and `again` on the fake host
  same state, already DI-58              A8 to A11, B3, B4, B12, B14 (R1)
  not a byte compare, unchanged          shimmer repeat and zero step (band means at MSAA 2, own limits); tierswitch per-frame diff (tick moves); warp shimmer ratio (different chunks)
  no pixel compare at all                soak, soak control, alloc, frame, budgets
  ```
- [x] 2026-11-05T21:13Z `npm run check:task -- T09`: `tsc: 48 owned files, 2 configs, 0 problems`, `eslint: 48 owned files, 0 errors, 0 warnings`, `vitest: 6 owned files, exit 0` (154 tests), `glsl: 52 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. 48 files, one more than R1: `identity-vulkan.spec.ts`.
- [x] 2026-11-05T21:14Z Vulkan, print-only. `--project=software`: `1 skipped`, exit 0, skipped in `beforeAll`. `--project=gpu`: `1 passed (8.5s)`, exit 0:
  ```
  IDENTITY vulkan renderer ANGLE (NVIDIA, Vulkan 1.4.303 (NVIDIA NVIDIA GeForce RTX 4070 SUPER (0x00002783)), NVIDIA)
  IDENTITY vulkan post-on MSAA 2 k=977|15259|976562500|15258789063  exactPass=true withinDI58=true attempts 1, selfBytes 0, crossBytes 0, crossMax 0, meanLuma 46.3721
  ```
- [x] 2026-11-05T21:15Z Changed specs: `npx playwright test tests/forever/identity.spec.ts tests/forever/washout.spec.ts tests/forever/api.fake.spec.ts --project=gpu --output=test-results/T09-R2/changed`: `1 skipped, 11 passed (32.7s)`, exit 0. The skip is B11's armed default frame.
  ```
  FAKE distant {"bytes":0,"max":0}, again {"bytes":0,"max":0}, nextRow 172800, tolerance {"bytes":64,"max":1}
  IDENTITY exact, all 4 k            pass true, attempts 1, selfBytes 0, crossBytes 0, meanLuma 22.93
  IDENTITY post-on MSAA 0, all 4 k   pass true, attempts 1, selfBytes 0, crossBytes 0, worstCrossMax 0, meanLuma 46.3998 (46.3721 at MSAA 2, so MSAA 0 took effect)
  IDENTITY sequence MSAA 0, both k   pass true, attempts 1, worstBytes 0, worstMax 0
  IDENTITY control exact             pass false, attempts 1, selfBytes 0, crossBytes 1250882, crossMax 255
  IDENTITY control post-on MSAA 0    pass false, attempts 1, selfBytes 0, crossBytes 3360447, crossMax 201; after removal pass true, 0 bytes
  WASHOUT off {"during":5916110,"after":{"bytes":0,"max":0}} tolerance {"bytes":64,"max":1}
  WASHOUT clean, flood, veil         the same numbers as at 15:07Z and in R1
  ```
- [x] 2026-11-05T21:16Z B12 held, dry run on the shell (`TERRAIN_ARMED_ON_SHELL=1`, `-g "sim held"`), proves only the spec: `1 passed`, exit 0. `CONTEXT held` before and after sim `{chunk 1, local 2, tick 3}`, `lostDraw` true, `restoreFrames` 1, off 0 bytes, `full` at MSAA 0 0 bytes.
- [x] 2026-11-05T21:19Z **Negative controls,** `r2_mutants.mjs` in the scratchpad: each puts a real fault in front of a changed gate, runs it, restores the file from a byte copy and checks its sha256. 7 of 7 caught, 7 of 7 restored to the recorded hash:
  ```
  M1 identity post on, absCoord on in the gate      exit 1  pass false at all 4 k, attempts 1, selfBytes 0, crossBytes 2,173,248 (k=977) and 3,360,447, max 195 to 201
  M2 identity sequence, absCoord on                 exit 1  "worst frame 0: 3360447 bytes, max 201"
  M3 B12 held, floodLines on before the full frame  exit 1  "full across a loss: DI-58", 5,000,274 > 64; post off still 0 bytes
  M4a washout, floodLines(0) removed                exit 1  "the same state after the controls are off: DI-58, DI-68", 373,921 > 64, max 255
  M4b washout, veil(0) removed                      exit 1  the same message, 5,916,110 > 64, max 25
  M5 A6, distant frame at chunk 1030                exit 1  "distant: DI-58, DI-68", 172,800 > 64
  M6 Vulkan spec launched on D3D11                  exit 1  "the run must really be on Vulkan, or this print is mislabelled"
  restored: identity 93f637d6..., context ba8b9f42..., washout 629aa63c..., api.fake 58d28014..., identity-vulkan 3d27d23a..., all "OK" under sha256sum -c
  ```
- [x] 2026-11-05T21:19Z A8 to A14, A19: `npx playwright test tests/forever --project=gpu --output=test-results/T09-R2/forever`: `16 skipped, 25 passed (48.3s)`, exit 0. One more pass than R1, the Vulkan print. A JSON-reporter rerun at 21:21Z: 25 expected, 16 skipped, 0 unexpected, 0 flaky, and every skip annotation reads `UNARMED: needs T10`.
- [x] 2026-11-05T21:20Z A10, the changed gate five times in a row: `-g "identity post on" --repeat-each=5`: `5 passed (39.4s)`, exit 0, attempts 1 at all 4 `k` in every run, meanLuma 46.3998 each time.
- [x] Not re-run in R2, because nothing they read changed: A15 to A18 (allocation, frame timing, soak), A12 and A13 (shimmer), A16 (isolation). No `gpu-timing` run was needed, so the GPU lock was not used.
- [x] 2026-11-05T21:23Z Final, on the final code: `npm run check:task -- T09` `check:task T09 PASS`, exit 0 (48 owned files); `npm run plans:check` `12 plans, 2648 pattern pairs, 0 problems`, exit 0. Changed against `backup-R2` by sha256: `identity.spec.ts`, `context.spec.ts`, `washout.spec.ts`, `api.fake.spec.ts` and this plan; added: `identity-vulkan.spec.ts`; nothing removed, and nothing under `src/harness`, `tests/perf` or `tests/unit/harness` changed. All inside `owns`. A21 and the B rows still wait for the batch and for T10. Status `done`.

### Repair R3, after the V2 verifier and DI-71

- [x] 2026-11-05T22:02Z Status `in-progress`. Read `Agents.md`, this plan with V2's note in section 14, DI-58 to DI-71, and V2's probes in the scratchpad `V2-T09/`. All 54 owned files plus the shimmer baseline copied and hashed to the scratchpad `T09/backup-R3` (`r3-pre-edit.sha256`) before any change. Read T08's `createGate` (`src/ui/slots.ts` 18 to 33) and its use in `src/ui/index.ts` 148 to 155, T05's `layer.ts` 230 to 256 and `feeder.hideItem`, T10's restore order (its plan, M4).
- [x] 2026-11-05T22:13Z **Fix 1, failing first.** `T09/r3-probe-overlay.mjs`: a harness over `createFakeHost` whose `renderState` also runs T08's real `createUi().frame` at the tick it is given, as T10's does, with T10's restore order (`showContextLost(true)` on the loss; on the restore a 30 ms await standing in for `post.precompile`, V2's 25 to 27 ms, then `showContextLost(false)`), driving R2's wait loop copied verbatim from the backup:
  ```
  PROBE old precompile 30 ms: before the loss overlay hidden=true data-view="title"
  PROBE old: wait loop THREW after 20002 ms: Error: the overlay did not hide within 20000 ms of the restore, with the sim held
  PROBE old: overlay hidden=false data-view="title ctx" last ui tick 28800
  PROBE old: events [["lost",1635.8],["restored",1649.1],["contextOk",1679.7]]                         exit 1
  PROBE old precompile 0 ms: wait loop returned {"frames":1}                                            exit 0, the race won
  ```
- [x] 2026-11-05T22:15Z **Fix 1, passing.** `tests/forever/support/restore.ts`: `renderUntilRestored` renders the held position at `KEY.tick + 6 * frame`, T08's `SLOT_MIN_TICKS`. The same probe, driving that exact function:
  ```
  precompile 30 ms:  wait loop returned {"frames":2,"lastTick":28812}; frame 1 at 28806 showed the overlay, frame 2 hid it
  precompile 0 ms:   {"frames":1,"lastTick":28806}
  precompile 500 ms: {"frames":9,"lastTick":28854}
  each, after the compare (refill, 1 s settle and 300 ms at 28800): overlay hidden=true data-view="title", last ui tick 28800
  ```
  So the tick going back from 28806 or later to 28800 reopens T08's gate with nothing to write, and the compare frames run at the key's own tick. `context.spec.ts` also asserts the overlay is still hidden after the compare.
- [x] 2026-11-05T22:18Z **Fixes 2, 3 and 6, unit level.** `sweeps.ts`: `refill(key)` (a frame `REFILL_JUMP_CHUNKS` = 2 ahead, or behind past the warp limit, then key), called at the start of every `compareAt` attempt and every `sequence` attempt; `stepToTick(tick)`. `budget.ts`: `layerCount` in the report and `callCountProblems`. New unit tests model T05's hide and refill rule in the stub. `T09/r3-mutate.mjs` applies each mutant, runs, restores from a byte copy and checks sha256:
  ```
  U1  compareAt without refill                exit 1  4 failed   U6  minCalls.streaming kept as a maximum  exit 1  (V2's survivor)
  U2  sequence without refill                 exit 1  1 failed   U8  minCalls.sim kept as a maximum        exit 1  (V2's survivor)
  U3  refill one chunk behind                 exit 1  5 failed   U9  no minCalls.layers check              exit 1  3 failed
  U4  stepToTick without the overshoot check  exit 1             U10 layerCount pinned at 1                exit 1  3 failed
  U5  stepToTick without the already-past check exit 1           all restored: sweeps.ts c251977b814f, budget.ts 876aff0eebbb OK
  ```
- [x] 2026-11-05T22:23Z **Fix 2, on T05's real props.** `T09/r3-probe-shards.mjs`: T00's dev shell with `createPropsLayer()` on T01's real world (period 1024), `labPost`, T09's real lab. DEMO emulated as V2 found it: camera one chunk behind KEY, a SHARD event for each of the 6 shards ahead of KEY in chunks 6 and 7, then the step onto KEY's chunk.
  ```
  R2 procedure by hand, off:  A1 vs A2 7,531 bytes max 255; A1 vs far 7,531; far vs A2 0
  R2 procedure by hand, full: A1 vs A2 309,339 bytes max 245; far vs A2 0
  R3 lab: identity exact, near control, post on, 30-frame sequence: pass, attempts 1, 0 bytes each; B12-style capture after refill 0 bytes
  2026-11-05T22:24Z the same probe with both refill calls mutated out of the lab: exit 1, all four lab compares fail at 7,531 or 309,339 bytes. Restored, sweeps.ts c251977b814f OK
  ```
- [x] 2026-11-05T22:19Z **Fix 3.** `T09/r3-probe-shimmer-pose.mjs`, shell at tier 3, two page loads 0 ms and 1500 ms of DEMO apart:
  ```
  follow=1, R2:  sim tick at manual 1 -> 12.2022; tick 192 -> 12.2088   differ by 0.054%
  follow=1, R3:  both measured at tick 1200 -> 12.2038, 12.2038       differ by 0.000%
  no follow:     12.2022 in all four, so the shell's stored baseline still holds and was not rewritten
  ```
  The shell shows the dependence, but far under the 2% margin, because T00's proof floor barely changes with the lateral pose; on the app it is the real camera over real terrain [I]. The new assertion is the check: 2026-11-05T22:28Z mutant M2, the baseline test without `stepToTick`: exit 1, "measured at the fixed pose", Expected 1200, Received 2. Restored, shimmer.spec.ts 0c8b98ac7cc6 OK.
- [x] 2026-11-05T22:20Z **Fixes 4 and 7.** `T09/r3-probe-world.mjs` on T01's real aperiodic world and T02's real sim:
  ```
  home R2 findBiomeChunk(0, 0):           chunk 105,  zone 1,  difficulty 1,  day phase .14
  home R3 findBiomeChunk(0, 1200):        chunk 1305, zone 13, difficulty 12, day phase .74
  far 1e9, 1e12, 1e15, 1e16:              zones 156253 to 1562500000007, difficulty 12 each, day phase .74, .8733, .14, .2733
  frame.timing travel, 2100 frames at 1/60 from each biome's chunk: 3.125 to 3.157 km, mean 89.3 to 90.2 u/s, all before the fade at 4.48 km
  ```
  2026-11-05T22:27Z B8 on the shell, `TERRAIN_ARMED_ON_SHELL=1`: home zone 12, the new assertion passes, and the test fails where the shell has no terrain (`silhouette` 0). 2026-11-05T22:28Z mutant M1, home from world 0: exit 1, "home at or past the difficulty cap", Expected >= 12, Received 0. Restored, warp.spec.ts 76c1f2410013 OK. Fix 7 is the comment in `frame.timing.spec.ts`, now 2.8 km at cruise and 3.2 km at DEMO's mean, against R2's "under 2.4 km".
- [x] 2026-11-05T22:28Z **Fix 5.** Both control tests call `forceZone(SUNSET_DRIVE, BOULEVARD, 0)`. Sunset Drive's hex is the same in T00's fake world and T01's `palettes.ts` [O]. On the shell the frame was already that zone, so every number reproduced (A14 below). Mutant M3, the controls on Ultraviolet on the shell: exit 0, SURVIVED, veil chroma 65.56: the shell cannot show V2's case, because T00's proof sky has no night. So `T09/r3-probe-veil.mjs` ran both control bodies on T04's sky, T03's terrain and T05's props on T01's world, with `labPost`, not T06's post:
  ```
  R2, zone 0 = Ultraviolet, day .0069:  flood passes (chroma 151.74, haze 34.41); veil FAILS, chroma 53.90 (haze 4.10, blackP10 70)
  R3, forced Sunset Drive, day .0069:   flood passes (chroma 160.38, haze 28.24); veil FAILS, chroma 51.34 (haze 4.40, blackP10 70)
  R3 veil at day .2536, .5069, .7536:   chroma 54.56, 51.03, 53.14: FAILS at every day phase
  veil(.05) instead of .1, day .0069:   Ultraviolet chroma 65.34, Sunset 64.37, blackP10 35, haze 5.5: passes on both
  ```
  So V2's case is real, and the fix as specified does not remove it: on the real layers a veil of .1 takes chroma under 55 on either palette, at any day phase. Not changed: the veil's strength is the control's input and moving it is an acceptance change, which needs a reviewer. Recorded in sections 10 and 11 and for T10 in Outcomes; ruled as DI-72 at 22:41Z, below.
- [x] 2026-11-05T22:25Z **Fix 8 and the coordinator's SwiftShader item.** `tests/forever/support/backend.ts`: `notVulkanReason` rejects no WebGL2, then a software rasterizer by T00's own pattern, then a non-Vulkan string. The spec reads the backend on the blank page before the harness opens, and skips with `NOT VULKAN (DI-71)`. Mutants through `r3-mutate.mjs`:
  ```
  V0  R2 spec on --use-angle=d3d11          exit 1  "the run must really be on Vulkan, or this print is mislabelled"
  V0b R2 spec on swiftshader                exit 1  openHarness: "renderer string: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
  V1  R3 spec on d3d11                      exit 0  1 skipped, "IDENTITY vulkan SKIPPED NOT VULKAN (DI-71): the launched renderer is not Vulkan: ANGLE (NVIDIA, ... Direct3D11 ...)"
  V2  R3 spec on swiftshader                exit 0  1 skipped, "... NOT VULKAN (DI-71): a software rasterizer, whose string may still name Vulkan: ANGLE (Google, Vulkan 1.3.0 (SwiftShader ...)"
  V3  R3 on swiftshader, software check out exit 1  /vulkan/ passed SwiftShader, and openHarness failed instead of a skip
  restored: identity-vulkan.spec.ts c4c1bb8f2e22 OK, backend.ts b89ba621576e OK
  ```
  `tests/unit/harness/backend.test.ts` holds it to the three observed strings.
- [x] 2026-11-05T22:28Z **Spec mutants on the restore helper,** with the overlay probe on T08's real UI: P1, every wait frame at the held tick: exit 1, "did not hide within 20000 ms ... (last tick 28800)", `data-view="title ctx"`. P2, a step of 5 ticks: exit 0, hid at frame 3, tick 28815, since a step under 6 still opens T08's gate every other frame. Restored, restore.ts d6930321bee9 OK.
- [x] 2026-11-05T22:26Z A8 to A14, A19: `npx playwright test tests/forever --project=gpu --output=test-results/T09-R3/forever`: `16 skipped, 25 passed (42.8s)`, exit 0.
  ```
  FAKE distant {"bytes":0,"max":0}, again {"bytes":0,"max":0}, nextRow 172800
  IDENTITY exact, all 4 k            pass true, attempts 1, selfBytes 0, crossBytes 0, meanLuma 22.93
  IDENTITY post-on MSAA 0, all 4 k   pass true, attempts 1, crossBytes 0, worstCrossMax 0, meanLuma 46.3998
  IDENTITY sequence, both k          pass true, attempts 1, worstBytes 0
  IDENTITY control exact / post-on   pass false, attempts 1, selfBytes 0, crossBytes 1250882 / 3360447; after removal pass true; near control pass true
  SHIMMER first 12.2022, second 12.2022, zero 0, naive 20.3395, after 12.2022; baseline test at sim tick 1200: 12.2022 against limit 12.4462
  WASHOUT clean, flood, veil, off    the same numbers as R1 and R2, so forcing Sunset Drive changed nothing on the shell
  IDENTITY vulkan renderer ANGLE (NVIDIA, Vulkan 1.4.303 (...)), post-on MSAA 2: 0 bytes at all 4 k
  ```
- [x] 2026-11-05T22:27Z Armed rows on the shell, `TERRAIN_ARMED_ON_SHELL=1`, which proves only the specs: B12 held `1 passed`: `restoreWait {"frames":1,"lastTick":28806}`, off and `full` 0 bytes, `overlayHiddenAfterCompare` true, sim unchanged. B10 failed on the shell's known 12.2022 > 8. B8 failed on the shell's `silhouette` 0, after the new home assertion passed.
- [x] 2026-11-05T22:31Z `npx playwright test tests/perf --project=gpu --output=test-results/T09-R3/perf-gpu`: `2 skipped`, exit 0, both `UNARMED` (bundle, software).
- [x] 2026-11-05T22:33Z Through `gpu-lock.mjs`, GPU shared with siblings: `tests/perf --project=gpu-timing`: `2 skipped, 2 passed (1.4m)`, exit 0. A15: calibration 1032, clean median 3761.6, `allocProbe(256)` moved 256, probe 270.8 and 1057.8, slope with `allocProbe(1024)` 2.658, leak slope 261.006. A17: clean p50 0.9, `gpuLoad(1024)` 7.0, after 0.8. B18 dry run on the shell: `minCalls {"sim":2,"layers":1,"streaming":0,...} layerCount 1`, and `callCountProblems` returned `["a frame with no terrain or props frame seen"]`, the shell's known gap: exit 1, as in R1.
- [x] 2026-11-05T22:34Z A10 again, since `compareAt` changed: `-g "identity post on|identity exact" --repeat-each=5`: `10 passed (32.4s)`, all 40 compares attempts 1.
- [x] 2026-11-05T22:34Z `npm run check:task -- T09`: `tsc: 51 owned files, 2 configs, 0 problems`, `eslint: 51 owned files, 0 errors, 0 warnings`, `vitest: 7 owned files, exit 0` (180 tests), `glsl: 55 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [x] 2026-11-05T22:35Z JSON-reporter rerun of `tests/forever --project=gpu`: expected 25, skipped 16, unexpected 0, flaky 0; every skip reads `UNARMED: needs T10`. Changed against `backup-R3` by sha256: `src/harness/budget.ts`, `lab.ts`, `sweeps.ts`; `tests/forever/context.spec.ts`, `identity.spec.ts`, `identity-vulkan.spec.ts`, `shimmer.spec.ts`, `warp.spec.ts`, `washout.spec.ts`; `tests/perf/budgets.timing.spec.ts`, `frame.timing.spec.ts`; `tests/unit/harness/budget.test.ts`, `sweeps.test.ts`; this plan. Added: `tests/forever/support/restore.ts`, `support/backend.ts`, `tests/unit/harness/backend.test.ts`. Nothing removed. `test-refs/T09/shimmer.json` unchanged (57c61986...). A13's delete-and-rewrite drill was not run: the baseline is outside this repair's write list, and its value did not move.
- [x] 2026-11-05T22:39Z Status `done`: `check:task` exits 0, `tests/forever` and `tests/perf` pass on `gpu`, and every armed row still skips `UNARMED`. The B rows stay with T10.
- [x] 2026-11-05T22:41Z The T00 owner ruled on the open veil row as DI-72. Status `in-progress`. `washout.spec.ts` and this plan copied and hashed to the scratchpad `T09/backup-R3b` (`washout.spec.ts` 3f1a9f7e5a35...).
- [x] 2026-11-05T22:42Z DI-72 applied: `VEIL_L = 0.05` in `washout.spec.ts`, for the veil control and the controls-off check, under the forced Sunset Drive zone. A14 on the shell: `npx playwright test tests/forever/washout.spec.ts --project=gpu --output=test-results/T09-R3/di72`: `1 skipped, 3 passed (4.0s)`, exit 0. The skip is B11, armed.
  ```
  WASHOUT clean      {"nearWhitePct":0,"meanChroma":112.24,"blackP10":15,"meanLuma":46.37,"hazeLift":10.25}
  WASHOUT flood      {"nearWhitePct":0,"meanChroma":173.95,"blackP10":42,"meanLuma":79.59,"hazeLift":32.14}
  WASHOUT veil(0.05) {"nearWhitePct":0,"meanChroma":84.64,"blackP10":43,"meanLuma":71.78,"hazeLift":8.40}
  WASHOUT off        {"during":5916110,"after":{"bytes":0,"max":0}}
  ```
- [x] 2026-11-05T22:42Z Negative control, `r3-mutate.mjs`: the veil test with `lab.controls.veil(veilL)` removed: exit 1, `blackP10` Expected > 25, Received 15, near-white 0, chroma 112.24, haze 10.25, so the frame is clean and only the veil's absence fails it. Restored, `washout.spec.ts` 21779cacec4e OK against its post-edit hash.
- [x] 2026-11-05T22:43Z `npm run check:task -- T09`: `tsc: 51 owned files, 2 configs, 0 problems`, `eslint: 51 owned files, 0 errors, 0 warnings`, `vitest: 7 owned files, exit 0` (180 tests), `glsl: 55 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [x] 2026-11-05T22:44Z `npx playwright test tests/forever --project=gpu --output=test-results/T09-R3/forever-di72 --reporter=json`: exit 0, expected 25, skipped 16, unexpected 0, flaky 0, every skip `UNARMED: needs T10`.
- [x] 2026-11-05T22:45Z Status `done`. Changed since `backup-R3b`: `tests/forever/washout.spec.ts` and this plan only.
- [ ] A21 and the B rows still wait for the batch and for T10.

### Repair D, after T10's D-003, D-004, D-005, D-008 and DI-74, DI-76, DI-77, DI-78

- [x] 2026-11-06T01:31Z Read `Agents.md`, this plan, T10's register rows D-002 to D-008 and their evidence under `test-results/T10-defects/`, T10's regressions `tests/e2e/defects/D-002`, `D-003`, `D-004`, `D-005.timing` and `alloc-other.timing` (read and run only, not edited), and DI-74 to DI-81. All owned files plus the shimmer baseline copied to the scratchpad `T09/backup-D` and hashed (`d-pre-edit.sha256`, 57 files). 01:33Z status `in-progress`, revision note in section 14.
- [x] 2026-11-06T01:32Z to 01:33Z **Failing before, gpu, on the app** (`index.html` exists, so `target()` is `app`): `npx playwright test tests/e2e/defects/D-002.spec.ts D-003.spec.ts D-004.spec.ts tests/forever/shimmer.spec.ts tests/forever/washout.spec.ts --project=gpu --output=test-results/T09-D/before`: `7 failed, 3 passed`, exit 1.
  ```
  D-004  T10's regression     {"clean":25.8678,"naive":26.7342}, needs naive > 38.8017              FAILED
  A12    shimmer.spec.ts      {"first":25.8678,"second":25.8678,"zero":0,"naive":26.7342,"after":25.8678}  FAILED, Expected > 38.8017
  B10    shimmer limit        {"all":25.8678,"noProps":7.4353,"bare":31.7562}                       FAILED, Expected <= 8, Received 25.8678
  B10    shimmer baseline     at sim tick 1200, key ...|app|1920x1080|615-650                      FAILED, No shimmer baseline (no app key exists; by design until written)
  D-002  T10's regression     all 25.8678, noProps 7.4353; naive props hidden 18.6374 vs 7.4353     FAILED, Expected <= 8
  D-003  T10's regression     veil(.05) by pose: blackP10 25 at tick 1200, 26 or 27 at the other 12 FAILED, Expected > 25, Received 25
  B11    washout veil(.05)    {"nearWhitePct":.0003,"meanChroma":62.23,"blackP10":25,"hazeLift":5.17}  FAILED, Expected > 25, Received 25
  B11    flood, controls off, default frame                                                         passed
  ```
- [x] 2026-11-06T01:34Z to 01:38Z **Failing before, timing, on the app,** through `gpu-lock.mjs`, alone in the lock:
  ```
  B19 alloc.timing.spec.ts   16 window runs 9286.2 .. 8850.8, last three 8761.6, 8596, 8850.8   FAILED "agree within 1 B", Received 254.8   exit 1  01:36:17Z
  D-005 T10's regression     17 medians, last three spread 257.6 B; clean profile other 307.4  FAILED Expected <= 1, Received 257.6    exit 1  01:38:16Z
  D-008 alloc-other test 1   other 318.5 and 320.1 B/frame over two profiles                   FAILED Expected <= 128, Received 320.1  exit 1  01:38:41Z
  ```
- [x] 2026-11-06T01:39Z New unit rows. `metrics.ts`: `windowStability(medians, frac)` (DI-77). `tests/perf/support/heap.ts`: `classLimitProblems(classes, limits)` (DI-78). New `tests/unit/harness/heap.test.ts`; `metrics.test.ts` gains `windowStability` with T10's three app series (pass), the shell's (pass), and climbing, outlier and just-past-5% series (fail). `npx vitest run tests/unit/harness/metrics.test.ts tests/unit/harness/heap.test.ts`: `2 passed (2)`, `46 passed (46)`, exit 0.
- [x] 2026-11-06T01:40Z to 01:44Z Windows-control probe, through the lock, a temporary `tests/perf/zz-t09-pairs.timing.spec.ts`, deleted at 01:44Z: on the app the sequential control moved 516.4, 564.4 and 88.8 B for a true 256, interleaved 207.6 to 264.2; on the shell 256.0 and 256.4 either way. Section 10 has the table. Decision: the control is unchanged, its assertion soft, and the finding goes to the T00 owner (Decision log, Outcomes).
- [x] 2026-11-06T01:45Z to 01:47Z **Passing after, gpu.** On the app, `npx playwright test tests/forever/shimmer.spec.ts tests/forever/washout.spec.ts --project=gpu --output=test-results/T09-D/after-app`: `1 failed, 6 passed`, exit 1, the failure being B10's baseline half, `No shimmer baseline`, which waits for T10 to write the app key (Outcomes):
  ```
  A12   SHIMMER {"hidden":"props","first":7.4353,"second":7.4353,"zero":0,"naive":18.6374,"after":7.4353}   passed (18.64 > max(8, 11.15))
  B10   SHIMMER armed {"hidden":"props","floor":7.4353,"all":25.8678,"floorBare":9.6637,"allBare":31.7562}   passed (floor 7.44 <= 8, > 1)
  B10   baseline: mean 7.4353 at sim tick 1200, hidden props, key ...|app|1920x1080|615-650                  FAILED No shimmer baseline
  B11   WASHOUT clean   {"nearWhitePct":.0016,"meanChroma":78.74,"blackP10":3,"hazeLift":4.25} at sim tick 1200
  B11   WASHOUT flood   {"nearWhitePct":.0014,"meanChroma":139.44,"blackP10":34,"hazeLift":20.47}             passed
  B11   WASHOUT veil(0.06) {"nearWhitePct":.0016,"meanChroma":58.34,"blackP10":31,"hazeLift":4.83} at sim tick 1200   passed
  B11   WASHOUT off {"during":5965962,"after":{"bytes":0,"max":0}}                                               passed
  B11   WASHOUT palette 0 {"nearWhitePct":.0016,"meanChroma":78.74,"blackP10":3,"hazeLift":4.25}               passed
  ```
  T10's regressions, run read-only, `--output=test-results/T09-D/after-t10`: `2 failed, 1 passed`, exit 1. D-003 passed at `VEIL_L` .06 read from this spec: standalone pose `blackP10` 32, chroma 59.43, haze 4.69; by pose, ticks 600 to 4200, `blackP10` 31 to 32 and chroma 58.34 to 60.62, the lowest at tick 1200, which is B11's tick now. D-002 failed on its `all` assertion (25.8678 > 8) and D-004 on all layers (26.7342 against 38.8017), both of which assert the scope DI-74 retired; the figures each should assert are in Outcomes. On the shell, `TERRAIN_HARNESS_TARGET=shell`, `--output=test-results/T09-D/after-shell`: `2 skipped, 5 passed`, exit 0, the skips being the armed B10 limit and B11 default frame. Shell numbers unchanged: shimmer 12.2022, naive 20.3395, baseline 12.2022 against 12.4462, flood haze 32.14; veil(.06) `blackP10` 50, chroma 79.70, haze 7.92. **Viewed** `after-app/.../washout-veil.png`: the title screen at tick 1200 on Sunset Drive with the DOM title and prompt on top, the sun, mountains and props as normal, and the dark floor cells and sky lifted to a dark purple-grey rather than near-black, a mild even haze; nothing looks broken. **Viewed** `after-app/.../washout-flood.png`: thin pink horizontal lines every 16 px over sky and floor, with magenta glow filling the gaps, the dark sky gone; it reads as flooded, which is that control's job.
- [x] 2026-11-06T01:48Z to 01:49Z **Negative controls,** `r3-mutate.mjs` with `d-mutants.json`: each mutant applied, run, the file restored from a byte copy and its sha256 checked. 8 of 8 caught, 8 of 8 restored:
  ```
  D1 windowStability always stable              exit 1  2 failed: "fails a truly unstable series", "reads only the last three"
  D2 windowStability back to the 1 B line       exit 1  4 failed, incl. "passes the app series T10 measured"
  D3 classLimitProblems skips other             exit 1  3 failed, incl. "expected [] to deeply equal ['other 1333.6 B/frame over 512']"
  D4 classLimitProblems lets NaN pass           exit 1  1 failed: "expected [] to deeply equal ['other NaN B/frame over 512']"
  D5 veil test without stepToTick (app)         exit 1  "measured at the fixed pose (DI-76)", Expected 1200, Received 36 (blackP10 32 there, so only the tick check caught it)
  D6 veil test with the veil removed (app)      exit 1  blackP10 Expected > 25, Received 3
  D7 veil at DI-72's .05, fixed pose (app)      exit 1  blackP10 Expected > 25, Received 25, chroma 61.43
  D8 A12 with props shown (app)                 exit 1  naive 26.7342, Expected > 38.8017
  restored: metrics.ts d46f03186277, heap.ts 65cff50284b7, washout.spec.ts 071cb3d4713c, shimmer.spec.ts 60eae37fde32, all OK
  ```
- [x] 2026-11-06T01:49Z to 01:58Z First after-fix timing attempt: the lock stayed busy for 8 minutes, held by T03 and then T02, and `gpu-lock.mjs` exited 75. Queued again; acquired at 01:58:16Z.
- [x] 2026-11-06T01:58Z to 02:00Z **After, first pass, through the lock.** B19 on the app, `--output=test-results/T09-D/after-alloc-app`: exit 1, `1 failed`, on the windows control only (soft): stability met at the first three, 9671.6, 9198.8, 9659.8, 3.27%; `allocProbe(256)` moved -948.6. Every line after it passed: `other` 346.2, probe 255.9 and 1014.7, other-line control `["other 1348.0 B/frame over 512"]`, slope 1.934, leak 259.66, retained probe 271.0. A15 on the shell, `--output=test-results/T09-D/after-alloc-shell`: exit 1, on **slope with `allocProbe(1024)` 12.042 against 10**, after stability was met at 4067.2, 3847.2, 3761.6 (4.5%), the plateau the 1 B line used to wait out. R1 to R3 read 1.996 to 3.733 there after five or more runs. So DI-77's line alone ends the warm-up three runs in, and the page is not warm enough for the slope check. Fix: `MIN_WINDOW_RUNS = 5`, the run count the 1 B line took on the shell, before the 5% line may be met; asserted. Stricter, no threshold moved (Decision log).
- [x] 2026-11-06T02:07Z to 02:11Z **After, final, through the lock,** alone in it:
  ```
  A15 shell  exit 0, 1 passed (1.1m): runs 5, last 3761.6, 3761.6, 3770.6, 0.16%; allocProbe(256) moved 259; other 15.4; probe 301.7 and 1054.0;
             other-line control ["other 1067.2 B/frame over 512"], 256 B printed []; slope 2.772; retained clean probe 0.0, leak probe 274.1; leak slope 260.823
  D9 mutant  MIN_WINDOW_RUNS 1 on the shell: exit 1, CAUGHT, runs 3, 4067.2, 3848.4, 3761.6 (4.49%), slope 12.057 against 10; restored alloc.timing.spec.ts a4d9f0dd3bfe OK
  B19 app    exit 1, 1 failed (1.3m), the windows control alone, soft: runs 6, last 8450, 8528.8, 8636.8, 1.15%; allocProbe(256) moved 486, Received 230 against 16
             clean: total 7986.4 B/frame, probe 0.0, harness 29.1, world 2.4, other 289.2, libs 6619.4, engine 1046.3: classLimitProblems []
             probe 262.0 and 1027.5; other-line control ["other 1343.1 B/frame over 512"]; 256 B printed ["other 564.0 B/frame over 512"]
             slope with allocProbe(1024) -0.2; retained clean probe 0.0; leakProbe(256) retained probe 253.3, slope 266.717
  ```
- [x] 2026-11-06T02:11Z `npm run check:task -- T09`: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. `npx vitest run tests/unit/harness`: `8 passed (8)`, `192 passed (192)` (180 in R3). `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [x] 2026-11-06T02:12Z Changed against `backup-D` by byte compare: `src/harness/metrics.ts`, `tests/forever/shimmer.spec.ts`, `tests/forever/washout.spec.ts`, `tests/perf/alloc.timing.spec.ts`, `tests/perf/support/heap.ts`, `tests/unit/harness/metrics.test.ts`, and this plan; added `tests/unit/harness/heap.test.ts`; nothing removed. The temporary probe spec is gone. `test-refs/T09/shimmer.json` unchanged. All inside `owns`; no T10 or sibling file was edited.
- [x] Not re-run in repair D, because nothing they read changed: identity, traps, context, cracks, edgepaint, warp, tierswitch, isolation, soak, frame and budgets timing, bundle, software. T10's `D-005.timing` and `alloc-other.timing` were not run after the fix: both assert the old 1 B and 128 B lines in T10's own files, and still would fail on them.
- [x] 2026-11-06T02:13Z Status `done`. Open with the T00 owner: B19's windows control on the app (section 10).

### Repair E, after DI-84

- [x] 2026-11-06T03:50Z Read `Agents.md`, this plan's Progress and section 13, and DI-82 to DI-85. DI-84 is the only one naming T09. All owned files plus the shimmer baseline copied to the scratchpad `T09/backup-E` and hashed (`e-pre-edit.sha256`, 58 files); `metrics.ts` d46f03186277 and `alloc.timing.spec.ts` a4d9f0dd3bfe match repair D's restored hashes, so nothing moved since. 03:51Z status `in-progress`, revision note in section 14.
- [x] 2026-11-06T03:51Z **Failing before, units.** New rows written first: `metrics.test.ts` gains `probeShift` (DI-84's line, on repair D's recorded on/off medians: the six interleaved app readings pass at ± 64; the two interleaved null readings and the shell's null fail; the three sequential app readings fail at ± 64 as well; the shell passes at ± 16 and fails 0.5 B past either edge; NaN and infinity fail; a control no larger than its tolerance throws). `budget.test.ts` gains `allocPairs` over a modelled heap (alternation, probe left off, a probe of 0 moves nothing, a scavenge dropped on its own side, NaN without memory info). `npx vitest run tests/unit/harness/metrics.test.ts tests/unit/harness/budget.test.ts`: `2 failed (2)`, `11 failed | 67 passed (78)`, exit 1, every failure `probeShift is not a function` or `lab.allocPairs is not a function`.
- [x] 2026-11-06T03:52Z Implemented: `probeShift(withProbe, without, bytes, tol)` in `metrics.ts`; `allocPairs(pairs, per, dt, set)` in `budget.ts`, sharing one window routine with `allocWindows`, with `set(false)` in a `finally`; `lab.allocPairs(pairs, per, dt, bytes)` toggling `controls.allocProbe` by property lookup. **Passing after:** the same command, `2 passed (2)`, `78 passed (78)`, exit 0.
- [x] 2026-11-06T03:53Z `alloc.timing.spec.ts`: `WINDOWS_CONTROL` by `target()`, shell `sequential` at ± 16, app `interleaved` at ± 64, both through `probeShift` and both `expect.soft`; `PROBE_BYTES = 256`. The interleaved form runs `allocPairs(300, 10, 1/60, 256)` where the sequential one ran, before any profile. `npm run check:task -- T09`: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0.
- [x] 2026-11-06T03:54Z to 03:55Z **Failing first, the new interleaved form, on the app,** through `gpu-lock.mjs` (queued behind T07, acquired 03:54Z): mutant E1, `r3-mutate.mjs` with `e-mutant-E1.json`, `bytes: PROBE_BYTES` replaced by `bytes: 0` in the `allocPairs` call only, so the expectation stays 256. Exit 1, `1 failed`, CAUGHT; restored `alloc.timing.spec.ts` 2f87ed86fce8 OK.
  ```
  ALLOC stability {"runs":6,"last":[8442,8549.2,8632],"worstPct":1.16}
  ALLOC windows control (DI-84, app, interleaved): 300 pairs, allocProbe(256) on {"median":8923.6,"dropped":2}, off {"median":8845.6,"dropped":3}, moved 78.0
  Error: windows control (DI-84, app, interleaved): moved 78.0 for a true 256, off by 178.0, allowed 64
  ```
  Only that line failed; every line after it ran (soft). The null read +78.0, where repair D's 300-pair null read -4.6 and its 150-pair null -96.4 (section 10).
- [x] 2026-11-06T03:56Z to 03:57Z **Passing after, B19 on the app,** through the lock, `npx playwright test tests/perf/alloc.timing.spec.ts --project=gpu-timing --output=test-results/T09-D2/alloc-app-1`: `1 passed (1.2m)`, exit 0. B19's first full pass on the app.
  ```
  ALLOC stability {"runs":6,"last":[8443.8,8540,8630.8],"worstPct":1.11}          clean median 8630.8
  ALLOC windows control (DI-84, app, interleaved): 300 pairs, allocProbe(256) on {"median":9134.6,"dropped":2}, off {"median":8909.2,"dropped":4}, moved 225.4   (off by 30.6, allowed 64)
  HEAP clean: total 8107.7, probe 0.0, harness 6.5, world 3.0, other 330.8, libs 6709.1, engine 1058.2       classLimitProblems []
  HEAP allocProbe(256) probe 247.0; allocProbe(1024) probe 1017.0; other-line control ["other 1315.9 B/frame over 512"], 256 B printed ["other 534.0 B/frame over 512"]
  ALLOC slope with allocProbe(1024) 0.779; retained clean probe 0.0; leakProbe(256) retained probe 270.8, slope 262.241
  ```
- [x] 2026-11-06T03:58Z to 03:59Z **The shell's form, A15,** `$env:TERRAIN_HARNESS_TARGET='shell'`, through the lock, `--output=test-results/T09-D2/alloc-shell-1`: `1 passed (59.9s)`, exit 0.
  ```
  ALLOC stability {"runs":5,"last":[3773.6,3772.4,3761.6],"worstPct":0.20}          clean median 3761.6
  ALLOC windows control (DI-84, shell, sequential): allocProbe(256) windows {"median":4017.6,"dropped":2}, moved 256.0; clean again 3761.6   (allowed 16)
  HEAP clean: other 13.8; allocProbe(256) probe 308.0; allocProbe(1024) probe 1040.2; other-line control ["other 1052.3 B/frame over 512"], 256 B printed []
  ALLOC slope with allocProbe(1024) 2.808; retained clean probe 0.0; leakProbe(256) retained probe 264.0, slope 261.147
  ```
- [x] 2026-11-06T03:59Z to 04:03Z Scatter diagnostic, because E1's null of +78.0 sat far from repair D's -4.6: a temporary `tests/perf/zz-t09-scatter.timing.spec.ts`, through the lock, `--output=test-results/T09-D2/scatter-app`, `1 passed (3.1m)`, exit 0; copied to the scratchpad as `T09/e-zz-t09-scatter.timing.spec.ts.keep` and deleted from the project at 04:03Z. In one page after B19's warm-up, the gate's own `allocPairs(300, ...)`: no probe +9.0, +127.8, -58.4; 256 B +273.6, **+323.2**, +237.0. So one real reading lies outside 256 ± 64, by 67.2. Section 10 has the table and the two per-window variants. Not acted on: the tolerance is DI-84's, and this goes to the T00 owner (Outcomes).
- [x] 2026-11-06T04:03Z **Unit mutants,** `r3-mutate.mjs` with `e-mutants-units.json`, each restored from a byte copy and its sha256 checked. 6 of 6 caught, 6 of 6 restored:
  ```
  E2 probeShift always ok                 exit 1  4 failed, incl. "a probe of 0 fails the interleaved form" and "fails the sequential app readings at +/- 64"
  E3 probeShift without the size guard    exit 1  1 failed: "refuses a control no larger than its tolerance"
  E4 probeShift lets NaN pass             exit 1  1 failed: "a reading that measured nothing fails"
  E5 allocPairs never turns the probe on  exit 1  3 failed, incl. "expected [ +0, +0 ] to deeply equal [ 256, +0 ]"
  E6 allocPairs without the finally       exit 1  2 failed, incl. "expected [ 256 ] to deeply equal [ 256, +0 ]"
  E7 allocPairs with the sides swapped    exit 1  1 failed: "expected -256 to be 256"
  restored: metrics.ts fefe847d5fcc, budget.ts 900ff6522297, all OK
  ```
- [x] 2026-11-06T04:03Z `npm run check:task -- T09`: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. `npx vitest run tests/unit/harness`: `8 passed (8)`, `204 passed (204)` (192 in repair D). `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [x] 2026-11-06T04:04Z Changed against `backup-E` by byte compare: `src/harness/budget.ts`, `src/harness/lab.ts`, `src/harness/metrics.ts`, `tests/perf/alloc.timing.spec.ts`, `tests/unit/harness/budget.test.ts`, `tests/unit/harness/metrics.test.ts`, and this plan; nothing added or removed, and the temporary spec is gone. `test-refs/T09/shimmer.json` unchanged. All inside `owns`; no T10 or sibling file edited.
- [x] Not re-run in repair E, because nothing they read changed: every `tests/forever` spec, and `frame`, `budgets`, `bundle` and `software` in `tests/perf`. `budget.ts` and `lab.ts` load on every harness page, and both alloc runs loaded them on both targets. `allocWindows` changed only by moving its window into `oneWindow`; its unit test, which counts the exact heap reads, passes. T10's `D-005.timing` also calls it, and was not run: it still asserts the old 1 B line in T10's file (repair D's list).
- [x] 2026-11-06T04:05Z Status `done`: DI-84 applied, B19 passed on the app and A15 on the shell, a probe of 0 fails the interleaved form, and `check:task` exits 0. Open with the T00 owner: the one reading of +323.2 against 256 ± 64 (section 10, Outcomes).

### Repair F, after DI-86(2)

- [x] 2026-11-06T04:38Z Read `Agents.md`, this plan's Progress, sections 10, 11, 13 and 14, and DI-83, DI-84 and DI-86. DI-86(2) is the part naming T09. All owned files plus the shimmer baseline copied to the scratchpad `T09/backup-F` and hashed (`f-pre-edit.sha256`, 58 files); `metrics.ts` fefe847d5fcc, `alloc.timing.spec.ts` 2f87ed86fce8 and `heap.ts` 65cff50284b7 match repair E's restored hashes, so nothing moved since. 04:39Z status `in-progress`, revision note in section 14.
- [x] 2026-11-06T04:39Z to 04:40Z **Failing before, units.** New rows in `tests/unit/harness/heap.test.ts`, `WINDOWS_CONTROL, B19s windows control by target (DI-86(2))`, on recorded medians: the table is `{ interleaved, 1024, 256 }` on the app and `{ sequential, 256, 16 }` on the shell; repair D's two interleaved 1024 B readings (999.6, 998.8) pass the app form; the three recorded no-probe readings, the widest scatter null (+127.8) and a zero difference fail it; three 256 B app readings (+225.4, +264.2, +323.2) fail it; the edges 768 and 1280 hold and 767.5 and 1280.5 fail; the shell passes 256.0, fails no probe and fails a 1024 B reading; NaN fails either. To make them fail on values and not only on a missing export, the table first moved from `alloc.timing.spec.ts` into `tests/perf/support/heap.ts` as `WINDOWS_CONTROL` plus `windowsControlCheck(target, with, without)`, which calls `probeShift`, with DI-84's values unchanged (app 256 ± 64), and the spec read it from there. `npx vitest run tests/unit/harness/heap.test.ts` at 04:40:20Z: `1 failed (1)`, `4 failed | 9 passed (13)`, exit 1:
  ```
  x is interleaved at allocProbe(1024), 1024 +/- 256, on the app ...   expected { form: 'interleaved', ...(2) } to deeply equal ...
  x passes the interleaved 1024 B readings on the app                  expected false to be true
  x fails the 256 B readings on the app, so the probe size is ...      expected true to be false
  x holds the app line at 768 and 1280, and fails it just past ...     expected false to be true
  ```
  So on DI-84's line the real 1024 B readings fail and a 256 B reading passes. The no-probe and shell rows passed on both values, as they should.
- [x] 2026-11-06T04:40Z **Passing after.** `WINDOWS_CONTROL.app` set to `{ form: 'interleaved', bytes: 1024, tol: 256 }` (DI-86(2)); the shell row unchanged. The spec's sequential and interleaved branches take `control.bytes` for the probe and judge through `windowsControlCheck`; `PROBE_BYTES` is gone. The `probeShift` comments in `metrics.ts` and `metrics.test.ts` now point at the per-target table; no function changed. `npx vitest run tests/unit/harness/heap.test.ts tests/unit/harness/metrics.test.ts` at 04:40:50Z: `2 passed (2)`, `60 passed (60)`, exit 0. 04:41:09Z `npm run check:task -- T09`: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0.
- [x] 2026-11-06T04:41Z to 04:42Z **Control: a probe of 0 fails the app form,** through `gpu-lock.mjs`, acquired at once: mutant F1, `r3-mutate.mjs` with `f-mutant-F1.json`, `bytes: control.bytes` replaced by `bytes: 0` in the `allocPairs` call only, so the expectation stays 1024 ± 256, `--output=test-results/T09-D3/mut-F1`. Exit 1, `1 failed` (57.2s), CAUGHT; restored `alloc.timing.spec.ts` eb2083c14049 OK. The print labels the pairs with the configured size, so it reads `allocProbe(1024)` although the mutant passed 0:
  ```
  ALLOC stability {"runs":6,"last":[8438,8545.6,8630],"worstPct":1.17}
  ALLOC windows control (DI-84, app, interleaved): 300 pairs, allocProbe(1024) on {"median":8907.2,"dropped":1}, off {"median":8911.2,"dropped":5}, moved -4.0
  Error: windows control (DI-84, app, interleaved): moved -4.0 for a true 1024, off by 1028.0, allowed 256
  ```
  It was the only error; every line after it ran and held: `other` 335.6, other-line control `["other 1346.9 B/frame over 512"]`, slope 0.816, leak slope 262.206.
- [x] 2026-11-06T04:42Z to 04:44Z **Passing after, B19 on the app,** through the lock, `npx playwright test tests/perf/alloc.timing.spec.ts --project=gpu-timing --output=test-results/T09-D3/alloc-app-1`: `1 passed (1.1m)`, exit 0 at 04:44:43Z.
  ```
  ALLOC stability {"runs":6,"last":[8447.2,8541,8630.4],"worstPct":1.08}          clean median 8630.4
  ALLOC windows control (DI-84, app, interleaved): 300 pairs, allocProbe(1024) on {"median":9932.2,"dropped":4}, off {"median":8905.2,"dropped":3}, moved 1027.0   (off by 3.0, allowed 256)
  HEAP clean: total 8083.2, probe 0.0, harness 8.0, world 8.8, other 342.6, libs 6686.2, engine 1037.7
  HEAP allocProbe(256) probe 248.9; allocProbe(1024) probe 1031.6; other-line control ["other 1321.6 B/frame over 512"], 256 B printed ["other 545.7 B/frame over 512"]
  ALLOC slope with allocProbe(1024) 1.965; retained clean probe 0.0; leakProbe(256) retained probe 263.5, slope 262.241
  ```
- [x] 2026-11-06T04:44Z to 04:47Z **App readings, two more page loads,** through the lock: a temporary `tests/perf/zz-t09-di86.timing.spec.ts` that warms exactly as B19 does (3000 frames, then at least 5 window runs and DI-77's 5% line) and then reads the gate's own `allocPairs(300, 10, 1/60, bytes)` five times, alternating `WINDOWS_CONTROL.app.bytes` and 0, each judged by `windowsControlCheck('app', ...)`. `npx playwright test tests/perf/zz-t09-di86.timing.spec.ts --project=gpu-timing --repeat-each=2 --output=test-results/T09-D3/readings`: `2 passed (2.2m)`, exit 0 at 04:47:29Z. Each repeat is a new page. Copied to the scratchpad as `T09/f-zz-t09-di86.timing.spec.ts.keep` (85bde461434c) and deleted from the project at 04:49Z.
  ```
  page 2  warm-up runs 6, last 8453, 8544.4, 8629.6 (1.05%)
          1024: on 9929   off 8919.2  moved 1009.8  error  14.2  PASS     0: on 8673.2 off 8707.4 moved -34.2  FAIL
          1024: on 9284.8 off 8270.6  moved 1014.2  error   9.8  PASS     0: on 8795.2 off 8804.8 moved  -9.6  FAIL
          1024: on 9660.8 off 8452.4  moved 1208.4  error 184.4  PASS
  page 3  warm-up runs 6, last 8447, 8536.2, 8622.8 (1.03%)
          1024: on 9977.6 off 8882    moved 1095.6  error  71.6  PASS     0: on 8725.6 off 8653.2 moved +72.4  FAIL
          1024: on 9301   off 8257.6  moved 1043.4  error  19.4  PASS     0: on 8777.2 off 8801.2 moved -24.0  FAIL
          1024: on 9635.4 off 8472    moved 1163.4  error 139.4  PASS
  ```
  With B19's own reading, page 1, that is **7 readings of the real 1024 B probe through the gate's routine over 3 page loads, all 7 inside 1024 ± 256**, worst 1208.4, off by 184.4. With F1's, 5 probe-0 readings, all failing, the nearest at +72.4, 695.6 B short of the line's floor. Section 10 has the table.
- [x] 2026-11-06T04:47Z to 04:49Z **The shell's form, A15, unchanged,** `TERRAIN_HARNESS_TARGET=shell`, through the lock, `--output=test-results/T09-D3/alloc-shell-1`: `1 passed (56.1s)`, exit 0 at 04:49:07Z.
  ```
  ALLOC stability {"runs":5,"last":[3773.6,3773.6,3761.6],"worstPct":0.21}          clean median 3761.6
  ALLOC windows control (DI-84, shell, sequential): allocProbe(256) windows {"median":4017.6,"dropped":2}, moved 256.0; clean again 3761.6   (allowed 16)
  HEAP clean: other 10.8; allocProbe(256) probe 292.9; allocProbe(1024) probe 1052.7; other-line control ["other 1064.3 B/frame over 512"], 256 B printed []
  ALLOC slope with allocProbe(1024) 2.023; leakProbe(256) retained probe 271.2, slope 261.147
  ```
- [x] 2026-11-06T04:49Z `npm run check:task -- T09` at 04:49:35Z: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0. `npx vitest run tests/unit/harness`: `8 passed (8)`, `211 passed (211)` (204 in repair E, plus the 7 new rows). `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [x] 2026-11-06T04:50Z Changed against `backup-F` by sha256 (`f-backup.mjs compare`): `src/harness/metrics.ts` (comment only), `tests/perf/alloc.timing.spec.ts`, `tests/perf/support/heap.ts`, `tests/unit/harness/heap.test.ts`, `tests/unit/harness/metrics.test.ts` (comment only), and this plan; nothing added or removed, and the temporary spec is gone. `test-refs/T09/shimmer.json` unchanged. All inside `owns`; no T10 or sibling file edited.
- [x] Not re-run in repair F, because nothing they read changed: every `tests/forever` spec, and `frame`, `budgets`, `bundle` and `software` in `tests/perf`. `metrics.ts` changed in a comment only. The unit mutants E2 to E7 were not re-run: `probeShift` and `allocPairs` did not change, and the new rows failed before the value change. T10's `D-005.timing` was not run (repair D's list).
- [x] 2026-11-06T04:52Z Status `done`: DI-86(2) applied, a probe of 0 fails the app form, 7 real readings over 3 page loads lie inside 1024 ± 256, B19 passed on the app and A15 on the shell, and `check:task` exits 0. Recorded for the T00 owner, no action asked: the worst reading's margin of 71.6 B (section 10, Outcomes).

### Repair G, after the integrated review (DI-93, B21)

- [x] 2026-11-06T10:18Z Read `Agents.md`, this plan, DI-90 to DI-96 and the three reviewers' verdicts in the scratchpad `VI.json`. T09's items: VI-r1 defect 1 (DI-93, `renderAt` past the R1 range hangs the tab) and VI-gates defect 5 (B21 skips when `dist/` is absent). All owned files plus the shimmer baseline copied to the scratchpad `T09/backup-G` and hashed (`g-pre-edit.sha256`, 58 files): `api.ts` a718173fe91c, `bundle.spec.ts` 5f71bcfaf59d, `warp.spec.ts` 76c1f2410013, `api.fake.spec.ts` 58d28014d775, `api.test.ts` 32b234ae31b9. 10:19Z status `in-progress`, revision note in section 14.
- [x] 2026-11-06T10:19Z to 10:20Z **Failing before, units.** Five new rows in `tests/unit/harness/api.test.ts`, written before any fix, over `OUT_OF_RANGE` = CHUNK_LIMIT + 1024 (2^48), 2^49 + 5, `MAX_SAFE_INTEGER`, -1, -0.5, 1.5, NaN and both infinities: `renderAt` refuses each with a `RangeError` naming `CHUNK_LIMIT + 1024`, with no host call and no read; both ends accepted; a `RangeError` while the context is lost, not `NaN`; the core's `renderState` refuses the same; `compareAt`, `refill`, `settle` and `sequence` past the range throw and never ask the host for that chunk. On the old code, `npx vitest run tests/unit/harness/api.test.ts` at 10:20:18Z: exit 1, `4 failed | 37 passed (41)`, the four refusal rows (`AssertionError: 281474976710656`, `expected function to throw an error, but it didn't`); the both-ends row passed, as it should.
- [x] 2026-11-06T10:20Z to 10:22Z **Failing before, browser, through `gpu-lock.mjs`.** New B9b in `tests/forever/warp.spec.ts` and a range row in A6's guard test in `api.fake.spec.ts` (section 7), run on the old `api.ts`. B9b, `-g B9b --output=test-results/T09-VI/before-b9b`, 10:20:59Z to 10:21:12Z: exit 1, `1 failed`, `WARP range edge returned after 5210.199999809265 ms`, `Expected pattern: /^RangeError: .*CHUNK_LIMIT \+ 1024/`. It failed at the edge, as designed, and made no call past 2^49. A6, `--output=test-results/T09-VI/before-fake`, 10:21:45Z to 10:22:04Z: exit 1, `1 failed, 1 passed`, `Received string: "no throw"`.
- [x] 2026-11-06T10:22Z **Fix.** `src/harness/api.ts`: `requireRenderChunk(what, chunk)` throws `RangeError("<what>: chunk must be an integer in [0, CHUNK_LIMIT + 1024), got <c>. Past 2^48 a frame is not exact, and from about 2^49 a render cannot finish (DI-93)")` unless `Number.isInteger(chunk) && chunk >= 0 && chunk < CHUNK_LIMIT + 1024`. Called in `renderAt` after `requireManual` and before the loss check, and in the core's `renderState` before `onRender` and the host call. `npx vitest run tests/unit/harness` at 10:22:31Z: exit 0, `8 passed (8)`, `216 passed (216)`, against 211 at repair F.
- [x] 2026-11-06T10:22Z to 10:26Z **Passing after, B9b on the app,** through the lock. First run 10:22:50Z to 10:23:03Z: exit 0, `1 passed`, but the refusals took 5374.8 ms inside the 15 s race, because `compareAt`'s near frames were the first frames of the browser (section 10). B9b now renders one warm-up frame at chunk 5 before the edge (Decision log). Second run, `--output=test-results/T09-VI/after-b9b-2`, 10:23:33Z to 10:26:11Z (lock queued about 2.5 min): exit 0, `1 passed (11.2s)`:
  ```
  WARP range first frame 5202.7 ms, edge RangeError: renderAt: chunk must be an integer in [0, CHUNK_LIMIT + 1024), got 281474976710656. Past 2^48 a frame is not exact, and from about 2^49 a render cannot finish (DI-93)
  WARP range refused {"renderAt 2^49 + 5":"RangeError","renderAt -1":"RangeError","renderAt 1.5":"RangeError","renderAt NaN":"RangeError","renderAt Infinity":"RangeError","compareAt to 2^49 + 5":"RangeError","settle at 2^49 + 5":"RangeError","refill at 2^49 + 5":"RangeError"} in 60.1 ms
  WARP range inside {"lastIn":23.199999809265137,"back":17.59999990463257,"nonZero":1898427}
  ```
- [x] 2026-11-06T10:28Z **Unit mutants on the guard,** `r3-mutate.mjs` with `g-mutants-units.json`, 10:28:20Z to 10:28:48Z, each restored from a byte copy to `api.ts` 45201589e33f, sha256 checked. 6 of 6 caught, 6 of 6 restored:
  ```
  G1 core renderState guard removed:       exit 1, 1 failed | 40 passed, the core row
  G2 renderAt guard removed:               exit 1, 1 failed | 40 passed, the lost-context row (the core still refuses while live)
  G3 off by one, chunk <= end:             exit 1, 2 failed | 39 passed, AssertionError: 281474976710656
  G4 Number.isInteger dropped:             exit 1, 2 failed | 39 passed, AssertionError: 1.5
  G5 plain Error, not RangeError:          exit 1, 4 failed | 37 passed, expected error to be instance of RangeError
  G6 range check moved after loss check:   exit 1, 1 failed | 40 passed, the lost-context row
  ```
- [x] 2026-11-06T10:29Z **Spec mutants: the whole old `api.ts`** (`wholeFrom` backup-G, a718173fe91c) under the final specs, through the lock, 10:29:08Z to 10:29:26Z, restored to 45201589e33f, sha256 checked. G7, B9b on the app: exit 1, `WARP range first frame 5104.4 ms, edge returned after 21.699999809265137 ms`, failed at the edge. G8, A6: exit 1, `Received string: "no throw"`. 2 of 2 caught.
- [x] 2026-11-06T10:26Z **Failing before, B21.** The shared `dist/` must not be moved while four owners work, so the old spec was mutated to look for its build in a folder that does not exist: G0, `resolve('dist/index.html')` to `resolve('test-results/T09-VI/no-dist/index.html')`, 10:26:31Z to 10:26:36Z: exit 0, `1 skipped`. That is VI-gates' finding: the budget gate exits 0 having measured nothing. Restored to 5f71bcfaf59d, sha256 checked.
- [x] 2026-11-06T10:27Z **Passing after, B21.** `tests/perf/bundle.spec.ts` rewritten: it fails without `index.html`, runs `vite build --outDir <testInfo.outputPath('dist')> --emptyOutDir`, fails if the build fails or writes no `index.html`, and measures that folder. Through the lock, `--project=software --output=test-results/T09-VI/after-b21`, 10:27:11Z to 10:27:54Z: exit 0, `1 passed (3.5s)`:
  ```
  BUNDLE built C:\highsierralabs\terrain\test-results\T09-VI\after-b21\perf-bundle-dist-JS-gzip-a-449e7-harness-chunk-excluded-B21--software\dist
  BUNDLE app-CvL6-fBJ.js 240064 B gzip
  BUNDLE harness-D-g3fiM1.js 9998 B gzip, harness chunk, excluded
  BUNDLE index-By-zlZO0.js 1591 B gzip
  BUNDLE testHook-DMG-gi9O.js 80 B gzip
  BUNDLE sum 236.1 KB, harness 9.8 KB
  ```
- [x] 2026-11-06T10:29Z to 10:34Z **B21 mutants,** `g-mutants-b21.json`, through the lock (queued about 4.5 min), each restored to 5eba9c296223, sha256 checked. 3 of 3 caught, 3 of 3 restored. G9, no `index.html`: exit 1, `Error: B21 builds the site from index.html (T10), and there is none: nothing to build or measure`. G10, the build fails (`--config no-such.config.ts`): exit 1, `Error: the build failed, so B21 has nothing to measure: ... failed to load config from C:\highsierralabs\terrain\no-such.config.ts`. G11, built elsewhere so the measured folder is empty: exit 1, `Error: the build wrote no index.html to C:\...\mut-G11\...\dist`. `dist/index.html` read 08:35:35Z before and after these runs.
- [x] 2026-11-06T10:34Z to 10:39Z **Rerun of every section 7 row the change can touch on `gpu`:** `npx playwright test tests/forever --project=gpu --output=test-results/T09-VI/forever`, through the lock, 10:34:56Z to 10:39:36Z: exit 0, `42 passed (4.5m)`, 0 skipped, `TARGET app`. That is A6, A7, A8 to A14, A16 and B1 to B14 and B16, including B9b; the Vulkan print passed rather than skipped (renderer Vulkan under its own launch option). Lines: `FAKE ... "distant":{"bytes":0,...},"again":{"bytes":0,...},"nextRow":172800`; `IDENTITY exact` 4 of 4 `k` pass, attempts 1, 0 bytes; `IDENTITY post-on` 4 of 4 attempts 1, 0 bytes; `SHIMMER` floor 7.4270 against baseline 7.4353, limit 7.5840; naive 18.6321; B9b `first frame 78.1 ms`, refusals 33.8 ms, `lastIn` 15.6, `back` 10.1. B2 rebuilt `dist/` at 10:38:48Z, as it does by design (section 8); whether a sibling was using `dist/` then is not known.
- [x] 2026-11-06T10:35Z `npm run check:task -- T09`, 10:35:16Z to 10:35:27Z: exit 1, `eslint: 52 owned files, 1 errors`, `check:task T09 FAIL`: `warp.spec.ts 98:32 'end' is defined but never used`, left in B9b's raced evaluate when its in-range frames moved out. Fixed at 10:40Z after the suite had finished, so that run did not mix file versions: that evaluate takes `{ tick }` only. `npx eslint tests/forever/warp.spec.ts`: exit 0. `npm run check:task -- T09`, 10:40:27Z to 10:40:39Z: `tsc: 52 owned files, 2 configs, 0 problems`, `eslint: 52 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 56 owned files scanned, 0 hits`, `check:task T09 PASS`, exit 0.
- [x] 2026-11-06T10:40Z to 10:46Z `warp.spec.ts` after the lint fix, through the lock, `--output=test-results/T09-VI/warp-final`: exit 0, `3 passed (14.6s)`: B9 8.2 s (first in its browser), B9b `first frame 76.2 ms`, refusals 40.4 ms, B8 2.1 s.
- [x] 2026-11-06T10:46Z to 10:51Z `npx playwright test tests/perf --project=software --output=test-results/T09-VI/perf-sw`, through the lock, 10:46:47Z to 10:51:10Z: exit 0, `2 passed (10.7s)`. B21 `BUNDLE sum 236.6 KB, harness 9.8 KB` (`app` 240,597 B, so sources changed since 10:27Z, section 10). B20 `SOFTWARE ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver): tier 0, p50 35.1, p95 38.4 ms, 28 calls, 77456 triangles`. `dist/index.html` still 10:38:48Z.
- [x] 2026-11-06T10:51Z `npm run plans:check` at 10:51:24Z: `plans:check: 12 plans, 2648 pattern pairs, 0 problems`, exit 0. Changed against `backup-G` by sha256 (`g-backup.mjs compare`): `plans/T09-harness.md`, `src/harness/api.ts` (45201589e33f), `tests/forever/api.fake.spec.ts` (33e767a1680a), `tests/forever/warp.spec.ts`, `tests/perf/bundle.spec.ts` (5eba9c296223), `tests/unit/harness/api.test.ts` (af8fdbd26b04); 0 added, 0 removed.
- [x] 2026-11-06T10:52Z to 10:56Z B9b's comment corrected to section 10's reading, then `warp.spec.ts` (e1f87f5d0272) once more through the lock, `--output=test-results/T09-VI/warp-final2`, 10:52:00Z to 10:55:55Z: exit 0, `3 passed (14.0s)`, B9b first frame 59.3 ms, refusals 30.2 ms, `nonZero` 1,307,467 at chunk 5 where earlier runs read about 1.9M, which fits sources changing under a sibling [I]; the gate asks only for non-zero. `npm run check:task -- T09`, 10:56:14Z to 10:56:26Z: the same five lines, `check:task T09 PASS`, exit 0; `npx vitest run tests/unit/harness`: `216 passed (216)`.
- [x] Not re-run in repair G, because the changed code cannot reach them: `tests/perf` under `gpu-timing` (A15, A17, B17, B18, B19) and the soak (A18, B15). They reach the harness only through `warp`, `stepFrames`, `timedFrames` and `runFrame`, and the change runs only in `renderAt` and the core's `renderState`; `grep` over `tests/perf/*.ts` and `tests/forever/soak*.ts` finds no `renderAt` or lab sweep. `api.ts` does load on their pages.
- [x] 2026-11-06T10:59Z Status `done`: DI-93's guard in `renderAt` and the core's `renderState`, B9b on the app and A6 on the fake page; B21 builds what it measures and never skips for a missing build; each shown failing before and passing after, with 11 of 11 mutants caught and restored by sha256; `tests/forever --project=gpu` 42 passed, `tests/perf --project=software` 2 passed, `check:task T09 PASS`. Recorded for the T00 owner, no action asked: the 5 s first harness frame after a browser launch (section 10).

## 10. Surprises and discoveries

### Found in repair G, 2026-11-06, on the app

**The first harness frame after a browser launch takes about 5 s on the app, at any chunk.** With B9b run alone (`-g B9b`, so it is the first test in a fresh browser), the first `renderAt` after `openHarness(page, info, { period: 0 })`, `manual(true)`, `setPost('off')` and `setMsaa(0)` took 5210.2 ms at chunk 2^48 on the old code, and 5202.7 ms and 5104.4 ms at chunk 5 [O, three launches]. On the same page the next frames took 21.7 ms at 2^48 (old code), 23.2 ms at CHUNK_LIMIT + 1023 and 17.2 to 17.6 ms at chunk 5 [O], so it is the first frame, not the chunk. In the full `tests/forever` run, where 35 tests ran in the same browser first, B9b's first frame took 78.1 ms; in the final `warp.spec.ts` run B9, first in its browser, took 8.2 s against 0.75 s in the suite, and B9b's first frame read 76.2 ms [O]. So the cost belongs to a browser launch, not a page load [I, from 5 launches and 2 warm pages]. Where it goes is not known: no profile was taken, and a first-in-process shader compile in the GPU process is a guess [I]. No T09 gate times a first frame; B9b spends it before its 15 s race. Recorded for the T00 owner, since a spec that times the first harness frame of a run would read it.

**B21's own build measures the current sources, and they moved during this repair.** The private build at 10:27Z: `app` 240,064 B, `index` 1,591 B, `testHook` 80 B gzip, sum 236.1 KB; at 10:51Z, `app` 240,597 B, `index` 1,589 B, sum 236.6 KB; harness 9,998 B excluded both times [O]. A sibling changed sources in between, which a stale `dist/` would not have shown. VI-r1 read 235.9 KB from `dist/` at 00:47Z, and T10 233.30 KB at 00:40Z, on earlier sources. `dist/index.html` kept its 08:35:35Z timestamp through the B21 runs at 10:27Z and 10:29Z to 10:34Z, and its 10:38:48Z one through the B21 run at 10:51Z [O]: B21 did not touch it. The 10:38:48Z rebuild was B2 (`isolation.spec.ts`) inside the `tests/forever` run, which rewrites `dist/` by design (section 8).

### Found in repair F, 2026-11-06, on the app

**DI-86(2)'s 1024 ± 256 held in every reading, and its noise was wider than the ruling's estimate.** The gate's own statistic, `allocPairs(300, 10, 1/60, bytes)`'s on median minus off median, after B19's warm-up [O]:

| Page load | Reading 1 | Reading 2 | Reading 3 | No probe |
|---|---|---|---|---|
| 1, B19 itself | 1027.0 | | | |
| 1', F1 mutant (B19 with 0) | | | | -4.0 |
| 2, diagnostic | 1009.8 | 1014.2 | 1208.4 | -34.2, -9.6 |
| 3, diagnostic | 1095.6 | 1043.4 | 1163.4 | +72.4, -24.0 |

All 7 readings with the probe lie inside 768 to 1280. The worst is 1208.4, off by 184.4, which leaves 71.6 B of margin; that is 18% of the signal, where DI-86(2) estimated about 12%. All 5 without the probe fail, the nearest at +72.4, 695.6 B under the floor, so the control separates probe from no probe by a wide gap. The pattern repeats by position between pages 2 and 3: the third reading is the highest in both (1208.4, 1163.4), and the off medians run 8919.2, 8270.6, 8452.4 and 8882, 8257.6, 8472. So the reading depends on where on the route it is taken [I: the route repeats between page loads, as repair D found for the clean medians]. In absolute terms the 1024 B readings spread over 198.6 B (1009.8 to 1208.4), wider than the 256 B ones at 300 pairs, 102.4 B (220.8 to 323.2, repair D and E), so part of the error seems to grow with the probe [I: 7 readings at each size, not a measured scaling]. Not acted on: the line is DI-86(2)'s and every reading passed; the margin is recorded for the T00 owner (Outcomes).

### Found in repair E, 2026-11-06, on the app

**DI-84's interleaved control does not always hold 256 ± 64 on the app with a real probe.** The gate's own statistic, `allocPairs`'s on median minus off median, read on the app after B19's warm-up [O]:

| Probe | 300 pairs | 150 pairs |
|---|---|---|
| None | +9.0, +127.8, -58.4 (scatter page); +78.0 (E1's page); -4.6 (repair D's page) | -96.4 (repair D) |
| 256 B | +273.6, **+323.2**, +237.0 (scatter page); +225.4 (app-1); +220.8, +264.2, +229.0 (repair D) | +207.6, +227.4, +247.8 (repair D) |

With a real 256 B probe, 1 of the 7 readings at 300 pairs lies outside the line, +323.2, off by 67.2; the 3 at 150 pairs lie inside. Every reading without a probe fails the line, by at least 128.2, so the control has told probe from no probe in every run so far. The no-probe readings spread from -58.4 to +127.8 at 300 pairs, wider than the 256 B ones; why is not established [I: whatever differs between adjacent 10-frame windows on the route]. In the same page, two variants were read through per-window calls, `allocWindows(1, 10, dt)` with the toggle between: the order flipped every pair (on, off, off, on), and the median of the 300 pair differences in place of the difference of medians. Neither was consistently tighter. With no probe, per-window readings ran from -153.4 to +73.8 by difference of medians and from -60.8 to +42.0 by pair differences. With 256 B the flipped order read +415.8 and +408.4, about 150 high, and then +219.4 [O]. Per-window calls allocate between windows, so these are not the gate's routine and settle nothing about it; they show only that neither obvious change fixed it here. Not changed: DI-84 sets the method and the 64, so this goes to the T00 owner (Outcomes). Until then B19 on the app can fail on this soft line alone in some runs, with every §9.2 line after it still run and printed. It passed in its one full run here.

### Found in repair D, 2026-11-06, on the app

**B19's windows control cannot hold 256 ± 16 on the app, by either method tried.** DI-77 fixes the line before it, and leaves the controls unchanged. A throwaway probe (`tests/perf/zz-t09-pairs.timing.spec.ts`, deleted after use) through the lock, after B19's warm-up [O]:

| Method, true +256 B/frame | App | Shell |
|---|---|---|
| Sequential, as B19 runs it: clean, then 3000 frames later the probe | moved 516.4, 564.4, 88.8 | 256.4, 256.0, 256.0 |
| Interleaved, the probe toggled every 10-frame window, one stretch of route | 207.6, 220.8, 227.4, 264.2, 247.8, 229.0 | 256.0 each |
| Interleaved null, no probe either side | -96.4 (150 pairs), -4.6 (300 pairs) | 0.0 |
| Interleaved, true +1024 | 999.6, 998.8 | |

The app's clean medians move with the route, 8415.6 to 9912.4 over 16 runs in this repair's own before-fix run, in a pattern that repeats between page loads, so the allocation per frame depends on where the camera is [I: streaming and items, as T10 inferred]. Sequential runs 3000 frames apart carry that movement into the control. Interleaving removes most of it, and its 1024 B case reads within 3%, so the instrument still measures; but its 256 B case scatters by about ±30 around a mean near 233, so ±16 fails there too. So the control is valid on the shell, where A15 runs it, and not on the app at that tolerance. Not changed here: DI-77 keeps the controls, and a tolerance or a method change for the app is the T00 owner's call. Recorded in Outcomes as open. Meanwhile the line is `expect.soft`, so B19 still fails on it but runs every §9.2 line after it. B19 itself then read -948.6 after a 3-run warm-up and +486 after 6 runs [O].

**DI-77's line alone ends the warm-up too early.** The 1 B line also kept the page warming until the JIT plateaus passed. At 5% the shell's plateau 4067.2, 3848.4, 3761.6 already qualifies (4.49%), and the slope check that follows read 12.042 and then 12.057 B/frame against its 10, twice, where five or more runs read 2.0 to 3.7 [O]. On the app the first three, about 9.2 to 9.7 KB, qualify at 3.27%, while the route later settles near 8.5 to 8.9 KB [O]. With five runs before the line may be met, A15 passed with slope 2.772, and the app stopped at run 6 on 8450, 8528.8, 8636.8 [O]. Whether 5 is the right count on the app, beyond the shell's history, is not established; the app's profile lines did not depend on it in these runs (`other` 346.2 after 3 runs, 289.2 after 6).

**B11's flood control has little margin on the app.** Haze lift read 20.47 at tick 1200 and 20.05 at the old unfixed pose, against `> 20` [O]. It passes; it is recorded because T11 re-derives the wash-out limits.

### Found in repair R3, 2026-11-05

**B12's old wait was a race, not a certain failure.** With T08's real UI and a 0 ms precompile, R2's loop returned at frame 1; with 30 ms it never returned [O]. It fails whenever the first frame after the restore event runs before T10's `await post.precompile()` resolves, which V2 put at 25 to 27 ms against a 3 ms round trip. The new wait cannot lose it: at 30 ms its frame 1 showed the overlay and frame 2 hid it [O].

**A step under T08's 6 ticks still finishes, slower.** At 5 ticks the gate opens every other frame, and the wait hid at frame 3 [O]. Only a step of 0, the held tick, never finishes. The spec uses 6, so every frame can write.

**On the real layers, a veil of .1 takes chroma under 55 on any palette and day phase.** T04's sky, T03's terrain and T05's props on T01's world, with `labPost`: chroma 51.03 to 54.56 on Sunset Drive at four day phases, and 53.90 on Ultraviolet, at `blackP10` 70 and haze about 4 [O]. The shell read 65.3 because T00's proof scene is not the game. At `veil(.05)` chroma read 64.4 and 65.3 with `blackP10` 35, so the control would show the same thing with margin [O]. Not the app either: T06's real post adds CA, Crt and vignette, and those were not in the probe. So at `.1` B11's veil control would have failed at T10 on its chroma line, and only a reviewer could change the control. V2's palette point stands as a fix: whatever the control's strength, it now runs on the palette its numbers came from. **Ruled by the T00 owner as DI-72:** the control is `veil(.05)` in A14 and B11, under the forced Sunset Drive zone, with no gate threshold moved. On the shell `.05` reads chroma 84.64, haze 8.40, `blackP10` 43 [O], so it still shows the blind spot there, and with the veil removed `blackP10` reads 15 and the control fails [O].

**SwiftShader's renderer string names Vulkan.** `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` [O: `--use-angle=swiftshader --enable-unsafe-swiftshader`]. A `/vulkan/` check alone would take it for hardware; T00's `SOFTWARE_RENDERER` pattern catches it first.

**`stepToTick` relies on one sim step per frame at dt 1/120.** Exact on the shell and the fake host, whose `runFrame` steps `floor(dt * 120)`. On the app T10's step 4 accumulator gives one step per frame as long as its residual stays under 1/120, which it should [I]; if a frame ever steps twice, `stepToTick` throws "overshot" rather than measuring at another pose.

**Node 24 strips types on import,** so a probe could drive `support/restore.ts`, the spec's own function, from a plain `.mjs` [O]. That is why the file has no runtime import.

### Found in repair R2, 2026-11-05

**The shell does not show DI-67's noise, even on D3D11.** With the Vulkan spec relaunched on D3D11 as a mutant (M6), post on at MSAA 2 read 0 bytes at all 4 `k`, as Vulkan did [O]. DI-67's 29 to 173 B came from blended beams and the road scene at MSAA 2 or 4 [T05 O], which the shell does not have: T00's proof floor, the sky and `labPost`. So on the shell, R2's move to MSAA 0 changes no compare's result, and only its frames: post-on `meanLuma` 46.3721 at MSAA 2 against 46.3998 at MSAA 0 [O], which shows the setting took effect. Whether MSAA 0 is needed on the app is DI-67's evidence, not T09's [I].

**Playwright refuses a launch option inside a describe group.** `launchOptions` is a worker fixture [O: `node_modules/playwright/lib/index.js` line 191, `scope: "worker"`], and `test.use` of a worker fixture in a describe group is a load error, "because it forces a new worker" [O: `lib/common/index.js` line 1603]. Hence the Vulkan run is a file of its own, with a top-level `test.use`. That value replaces the project's launch options for that file, not merges, so the executable comes from T00's `findChromium` and `--ignore-gpu-blocklist` is repeated.

### Found in repair R1, 2026-11-05

**The shell could not show either blocking defect, for two reasons.** Its rAF loop was the dev shell's scripted one, which steps no sim, and its `renderState` pinned `camX` at 0. Old B12 and old B14 both passed there [O], and both fail once the shell's own loop steps the sim and `?follow=1` takes `camX` from it: 324,024 bytes and two different hashes [O]. The loop change is on by default, since nothing ran in that window before `manual(true)`; every pre-existing shell number reproduced to the printed digit [O]. `follow` stays opt-in, because it would give each page a different camera and move shimmer and wash-out between page loads [I].

**A missing restore rebuild does not show on the shell.** The mutant that drops `shell.rebuild(); post.rebuild()` from the shell's restore passed B12's held cycle [O]. three re-uploads geometry and data textures from CPU state after a restore, and the shell bakes nothing into a render target, so the frame is the same. On the app, terrain's atlas and the props rings are rebuilt from pure state on restore, so B12 is the check that would see it there [I: not run on the app]. The held compare itself does see a state or camera change: 283,408 bytes for 240 sim frames [O].

**`stats().tier` and the old B16 could not fail.** With a host that never applies a forced tier and no links happening, the old B16 passed in full on the shell [O]. The buffer check fails it at tier 2.

**DI-58 removes retries from the gpu sequence.** Under the bound, every frame either matches or is past it, and past it fails at once, so on `gpu` a sequence passes or fails on its first attempt. Attempts are kept, as DI-58 says. A self-compare with a byte over 1 level now fails at once where it retried before; that is stricter, and no run has ever shown it.

**The fake sim starts at chunk 1, local 0, and moves .667 u a step.** B12's held cycle saw tick 2 at `manual(true)`, because `openHarness` returns within a few frames of boot. Harmless; noted so nobody reads the small numbers as a stall.

### Found while building T09, on project code, 2026-11-05

**The sampling profiler charges an inlined function to its caller.** With a small `allocTick` called from `probeHook`, a true 256 B/frame read `probe 0.0` and `probeHook /src/harness/controls.ts 270.3`. The rehearsal's probe happened not to inline. Keeping `probeFrame` over V8's inlining limit, with a dead branch, moved it back: `probe 263.4`. **This matters at B19 [I]:** if T01's `height` or `oct` inlines into T03's `frame`, the bytes read as `other`, whose limit is 128 B/frame, not as `world`. Read the top 12 functions before treating an `other` breach as new allocation. What V8 inlines is not stable across builds.

**A JSArray is 4n + 24 bytes, not 4n + 40.** Calibration read 1016 for `new Array(248)`, and windows moved by exactly 240 for 54 slots and 1008 for 246. The rehearsal's own table agrees: 136 for 28 slots, 520 for 124. Only its "`new Array(248)` is exactly 1032" did not, cause not established. `slotsFor` and the calibration now use 4n + 24, so 256 asks for 58 slots and calibration reads 1032.

**Windows have JIT plateaus, and 3000 warm frames is not enough.** Clean medians on one page: 4067.2, 3848.4, 3761.6, then mostly 3761.6. Two equal readings can sit on a false plateau: one run read 3848.4 twice and stopped there, while others went on from 3848.4 to 3761.6. Even after that an occasional reading is 3769.2, 3771.2 or 3773.6, so "within 1 B" holds only most of the time. Hence three in a row, at most 17 runs, and the control's margin of ±16. 3761.6 came back in all four page sessions that warmed past the plateau, which is the stability across runs A15 asks for.

**A windows reading straight after profiles read far too high.** After two profiles and 1000 warm frames, `allocProbe(256)` read 4279 where about 4018 was due. The sampler or the probe's own deopt, with only 1000 frames to recover, could each explain it, and the run was also on the false plateau, so these were not separated. The windows control now runs before any profile, with 3000 warm frames, and moved by 256.0 and 260.8.

**A sibling's write reloads a dev page mid-test.** The allocation suite died 29 s in with `Execution context was destroyed, most likely because of a navigation`. Proven with a throwaway: touching `tests/forever/fixture/labPost.ts` under an open page gave `navigations=1 stamp=0` unisolated, and `navigations=0 stamp=1` with the socket mocked. Which sibling write caused the first one is inferred: T04 owns `hero.glsl`, which every page with `COMMON_FRAG` imports. `openHarness` now mocks the HMR socket through `page.routeWebSocket`. Other tasks' dev pages stay exposed, which the orchestrator should know: such a failure in a sibling's run proves nothing about its code.

**My first `gpuLoad` was too light.** A one-`sin` iteration raised p50 by 2.0 ms at 1024, under the 3 ms gate, and that was the control's fault, not the clock's. A heavier iteration reads +6.2 to +6.8 ms at 1024 and +1.5 to +2.1 at 256, where §11.4 reads 5.8 and 1.6 absolute. The threshold did not move.

**The shell's shimmer is 12.20, not the rehearsal's 8.10.** Same band and step, with T00's proof floor at L 1.9. Repeats agree to all printed digits. Naive grid 20.34 against `max(8, 1.5 * 12.20) = 18.30`, so the control's margin here is thin, 11%. The absolute limit of 8 is armed-only, so the shell's value does not breach anything, and it says nothing about B10.

**Post-on flake: not reproduced.** Over this session's runs, attempts read 1 at all 4 `k` in every post-on identity and both sequences, on `full` MSAA 2 and on this shell's own stack. That is absence on this stack only, so the attempts stay.

**An unused export is only removed from the static build.** The drill left the marker in the dynamic build's chunk, because a dynamic entry keeps its exports, and removed it from the static one. The test still failed, on `static` count 0, as A16 asks. The side effect stays the right marker, since the static case is the one that must be seen.

**Rehearsal numbers that differ, none of them against a limit:** `rawDirectNoClear` read 0 magenta rather than 2,873, under the same under-1% limit. Flood near-white read 0 rather than .006, chroma 173.9 rather than 152.4, haze 32.14 rather than 35.34. Veil chroma 65.3, `blackP10` 75 rather than 58, using `emit(vec3(1.), L)`, since the rehearsal's veil colour is not recorded.

**The shell cannot gate three things, so they stay armed-only:** a tier cycle links 12 programs here, since `labPost` has no keep-alive blur pass and T06 does. `residual` holds the shell's own sync inside `frameAt`, p95 about 1.1 ms. The `libs` line is three.js on a two-mesh scene, so it is a lower bound.

**§14 risk 6, on the shell stack only, 15 draws, not the answer.** Bytes per frame from the clean profile: `WebGLRenderer.render` 1420, `projectObject` 1056, `setValueV2f` 680, `renderBufferDirect` 356, `setValueV1f` 99, native `sort` 78. Close to the rehearsal's 1400, 1050, 700, 370, 180, 70. B19 gets the real answer.

### Rehearsal, 2026-11-05, on T06's probe stack, before any project code

All from rehearsals on T06's probe stack, on the RTX, Chromium 151. None of this block has run against project code.

**A heap-slope gate is blind to what §9.2 asks it to see.** 4000 frames at 1080p, MSAA 2, composer with five effects. Added allocation came from a separate module, so the profiler could attribute it.

| Added, true bytes per frame | Slope across `gc(); gc();` | Sampled total | Sampled in that module | Windows median |
|---|---|---|---|---|
| None, 3 runs | 5.87, .77, 0 | 3972, 3770, 3846 | 30.7, 8.3, 17.3 | 3773.6 each |
| 28 (`{ i, a, b, c }`) | -.14 | 3775 | 41.4 | 3801.6 |
| 136 (`new Array(28)`) | .34 | 3908 | 155.1 | 3909.6 |
| 520 (`new Array(124)`) | -.01 | 4285 | 534.4 | 4293.6 |
| 0, 2 rows of constant `height` | 1.15 | 3802 | 18.5 | 3773.6 |
| 15,552, 2 rows of §4.4 `height` | 0 | 19259 | 15485 | 19326 |

A 15.5 KB/frame allocator read 0 B/frame by slope. Sizes reflect V8's pointer compression in Chrome: 4 bytes per slot, so Node's numbers differ (`new Array(248)` is exactly 1032 bytes here).

- **Windows are exact.** Median of 300 windows of 10 frames, reading `performance.memory.usedJSHeapSize`, under `--enable-precise-memory-info`. Differences from clean are exactly +28.0, +136.0 and +520.0. 5 or 6 of 300 windows went negative through a scavenge and are dropped. Without the flag the reading is bucketed: a known allocation read 0, so the spec asserts calibration first.
- **Windows are a median, and a median describes the typical window.** With one allocation every third frame the median read +406 for a true mean of +344, and the mean of non-negative windows wandered between +262 and +354 between runs. So the profiler supplies the mean, and windows supply exactness for uniform per-frame work and for controls. If the real frame allocates so much that most 10-frame windows hold a scavenge, windows read high in `dropped`, and the profile is the number to trust.
- **Leaks:** a retained object read 40.42 B/frame by slope. Sampling with both flags off gave 50.5 B/frame at the right URL, and .3 when clean.
- **GC count does not separate:** `MinorGC` per 4000 frames was 8, 7, 8 and 32 for true 0, 28, 520 and 15,552 B/frame. Three's own allocation sets the base rate.
- **Who allocates, §14 risk 6.** On this stack: `WebGLRenderer.render` about 1400 B/frame, `projectObject` 1050, `setValueV2f` 700, `renderBufferDirect` 370, `setValueV1f` 180, native `sort` 70, all three.js. About 3.7 KB/frame at about 18 draws, against §9.2's unattributed 1.2 KB in the spike. Why those functions allocate is not established; boxed doubles are a guess [I]. The real scene will differ, and B19 gets the real answer.
- **`height` allocates in Chrome, confirming T03's inference and worse than it.** T01's rehearsal `height` through a contract-style call: **50.3 to 60.3 bytes per sample**. The profile puts 12,879 B/frame in `oct` and 2,590 in `height`, for 216 non-valley samples: 12 bytes per octave return plus 12 at the boundary. A sine `height` read exactly 12.06 B/sample, one heap number per call. At T03's 310 samples per frame at 150 u/s that is about 15 to 19 KB/frame. So "zero" in §9.2 cannot hold across the frozen `height`, and T01's internal `oct` adds five times the boundary's cost. T01's stated gate of under 4 B per call on a height row needs re-reading against this. Whether a local inline in T01 removes the inner part was not tested. (closed by DI-16)

**The post-on identity flake is real, and is not distance, not post, and not random.**

- **Reproduced on a different stack:** `bare`, MSAA 0, hit T00's exact pixel, row 560, col 513, channel 2. `full` at MSAA 2 used row 806, col 794. Always 3 or 4 bytes, by 1.
- **It arises in the scene pass.** Hashing the half-float `composer.inputBuffer` and the canvas per frame: the scene target has two states, and the canvas follows it in lockstep.
- **Sky only.** Sky plus post flips; sticks plus post never did (160 + 60 + 180 frames); direct to the 8-bit canvas never did, with or without sky.
- **Tiny.** Within the state the scene target differs by 4 half-float channel values, by 1 half-float ulp each, in rows 420 to 599.
- **It has a time signature.** After an idle of 2 s or 4 s, the other state lasts about 2 s: boundaries at 2012, 2019, 2020, 2022, 2025 and 2030 ms. After idle of 50 or 500 ms, it never appeared (6 of 6). From a cold start the flip comes within the first 100 to 250 ms, and it goes back by 2.3 s.
- **Settling alone is not enough.** 3 s of continuous frames then 6 evaluates of 20 frames with 200 ms gaps: 7 of 8 runs clean, and the failure was 5 frames in one evaluate that then cleared. With no settle: 6 of 8.
- **Cause not established.** The evidence fits a driver or GPU state changing the sky shader's result by under 1 half-float ulp [I]. What would separate the hypotheses: `--use-angle=gl`, a second GPU, or dumping both compiled shader binaries. None was run. T00 saw none on SwiftShader in 4 repeats.
- **So:** the frame is a function of the state plus a short-lived driver state. A real error repeats in every attempt, and this noise does not. Hence best-of-attempts with a self-compare, a signature limit, and no general tolerance. Post off stays at exact 0, one try.

**Wash-out takes two metrics, and they catch different things.** T06's flood reproduced, plus an additive veil:

| Frame | Near-white % | Chroma | Haze lift | `blackP10` |
|---|---|---|---|---|
| Clean, six palettes | .000 to .006, Arctic .966 | 64.6 to 116.1 | 7.76 to 11.33 | 8 to 18 |
| Bloom gain 1.5 / 2 | .002 / .003 | 95.8 / 98.3 | 13.2 / 16.11 | 12 / 12 |
| Flood, threshold .1, intensity 3 | .063 | 108.7 | **33.03** | 14 |
| Lines every 32 px / 16 px, L 2.4 | .007 / .006 | 145 / 152.4 | **25.09 / 35.34** | 33 / 50 |
| Veil L .02 / .05 / .1 / .2 | .002 / .003 / .003 / .002 | 88.2 / 76.3 / 63.4 / **54.1** | 9.71 / 8.5 / 6.54 / 4.37 | 15 / **32 / 58 / 91** |

A flood raises chroma, so chroma passes it. A veil lowers haze lift, since tone mapping compresses the difference, so haze lift improves as the frame gets worse. Dark-pixel share was tried and rejected: Toxic Arcade and Arctic Laser read lower when clean (d32 of 31.5, 32.0) than the flood on Sunset (38.3), so no absolute limit separates them across palettes. `blackP10` at 25 separates veils of L .05 and up. These are probe numbers, so T11 must re-derive both limits on the real scene.

**Haze lift needs no contract if the crop is right.** Central 50% crop, `min` minus `bare`, gave 16.05, identical to `min` minus `min` at bloom 0, so the vignette does not reach there. Kept as the fallback for CCR-T09-3. (closed by C-28, which needs no fallback)

**Trap 3 is worse than §11.3 says.** A read in the **next** `page.evaluate`, with no composite between, returned all 2,073,600 pixels. After a rAF, or a macrotask, it returned 0. So the mistake sometimes passes, and depends on timing. That is why `pixels()` throws rather than relying on a blank result to catch it.

**Trap 4 reproduced as written:** `WebGL: INVALID_OPERATION: restoreContext: context restoration not allowed` in the console, no restore within 3 s, and a second call restored at 3011 ms. Correct order: lost at 6.1 ms, restored at 11.8 ms.

**Shimmer.** Repeats agree to every printed digit (8.102 three times), so a stored baseline with 2% is safe on one machine. On the probe's `full` stack it reads 8.10, already over the limit of 8, on an analytic floor. T03 read 6.27 to 7.42 with DevPost. Crt and CA may add to it [I]. Expect B10 to be tight, and treat a failure as a finding for T11.

**The build keeps the harness out, if the marker survives.** Vite 8.3.5 named the chunks `harness-*.js` and `app-*.js`, with no `modulepreload` for either. A normal visit made 3 requests, and `?harness` made 4. `?harnessx=1` and `#harness` fetched nothing. A static import moved the marker into `app-*.js`, and a normal visit fetched it, so the test can tell. An unused exported constant was tree-shaken, leaving 0 files with the marker: without a count check the test would pass on nothing.

**Scale of an identity sequence.** 120 frames at 1080p is 995 MB. One `Uint8Array` allocated in 1.7 ms, `readPixels` with an offset took 4.2 ms a frame, and a byte compare 7.9 ms.

**Timer.** `performance.now()` stepped by 0.1 ms, with `crossOriginIsolated` false. §9.2's sub-millisecond budgets are close to its resolution, which is why per-frame sums and p95s are gated.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| Allocation gate is the sampling profiler for attribution, plus windows of `usedJSHeapSize` for exact totals and controls | Experiment in section 10: slope read 0 for a 15.5 KB/frame allocator | 2026-11-05 | T09 planner |
| Heap slope kept for leaks only | Sees a retained 40 B/frame, and §9.3 is about retention. §9.2 states this (DI-16) | 2026-11-05 | T09 planner |
| GC count rejected as a gate | 8, 7, 8 for 0, 28, 520 B/frame. T05's Node use is unaffected, as its loop has no three | 2026-11-05 | T09 planner |
| Allocation limits per URL class, with `src/world/` separate | "Zero" for all our code fails on `height` by construction. Separate lines keep a real allocation in T05 or T08 visible behind 15 KB of boxed doubles | 2026-11-05 | T09 planner |
| `other` limit 128 B/frame, not 0 | Sampling attributes 8 to 31 B/frame to a function that allocates nothing, on a 3.7 KB frame. It may grow with total allocation [I]. Control at 256 and 1024 proves the line can trip | 2026-11-05 | T09 planner |
| Post-on identity: best of 5 attempts with self-compare and a signature limit; no tolerance | Keeps §11.3's 0 bytes. The frame is deterministic in the state, so real errors repeat and driver noise does not. A tolerance, as T00's shell test uses, would also pass a real 1/255 error | 2026-11-05 | T09 planner |
| Post-off identity stays exact, one try | Direct path never flipped [O], and §11.3 requires it | 2026-11-05 | T09 planner |
| Settle 3 s before post-on compares | Removes the longest state window (about 2 s) before a run. It does not make the noise go away, so retries stay | 2026-11-05 | T09 planner |
| `pixels()` throws outside the same run; returns bottom-up rows, a fresh array | The trap sometimes passes silently. Bottom-up matches `DevShell.pixels` and T03's helper. A shared buffer would let two reads compare equal by aliasing | 2026-11-05 | T09 planner |
| `renderAt` and `stepFrames` throw unless manual | A rAF frame between a render and a read would give a false result | 2026-11-05 | T09 planner |
| `loseContext` and `restoreContext` are API members, with a guard | Trap 4 hung a driver in the spikes. T10's motion test needs the same path. A spec-side helper would leave the trap reachable | 2026-11-05 | T09 planner |
| `overrideFeel` instead of a narrow `overridePitch` and `overrideBloomGain` | One method covers zero pitch, haze reference and T11's peak-feel frames (§7.4). `overrideFov` stays as frozen | 2026-11-05 | T09 planner |
| Negative controls are injected into `ctx.scene` from `src/harness/controls.ts` | They work at integration on any layer set, with no access to T03, T05 or T06 internals, so §3.2 holds. They also exercise the real composer path | 2026-11-05 | T09 planner |
| Shell target with T09's own `labPost.ts` | `createFakeHost` draws one triangle and cannot rehearse bloom, shimmer or allocation. T00's DevPost is not specified to honour `bloomGain` | 2026-11-05 | T09 planner |
| Armed specs skip before T10, and B1 requires zero skips | A skip is honest before T10 and a failure after. `test:forever` then cannot look green while unarmed at T10 | 2026-11-05 | T09 planner |
| Allocation runs on the dev server; frame timing on `dist/` | Attribution needs `/src/...` URLs. §9.2's proxy says "real build". Budgets stay on the dev server: a sub-millisecond difference there would not change a decision | 2026-11-05 | T09 planner |
| Aperiodic shimmer compares the same biome, with forced palette and no bend | A comparison across zones would measure biome differences, not distance. T01: terrain and props follow the real biome | 2026-11-05 | T09 planner |
| Crack post-on path uses `bare`, MSAA 0 | Vignette darkens magenta corners below the sky predicate [I], and MSAA blends cracks toward non-magenta (T03) | 2026-11-05 | T09 planner |
| Missing baseline fails; writing needs an env var | First-run auto-write would make the gate vacuous on any new machine | 2026-11-05 | T09 planner |
| Baseline tolerance 2% | Repeats agreed to 3 decimals, on one machine. It covers driver noise. It is a margin, not a measured spread across a reboot | 2026-11-05 | T09 planner |
| `createHarness` installs `__mv` and `__mvLab`; `app/` only calls it | Keeps T10's import site to the 2 lines in the seam | 2026-11-05 | T09 planner |
| Marker is a side-effecting global write | An unused export was removed [O] | 2026-11-05 | T09 planner |
| Use `checkRasterizer`, not `expectRasterizer` | T00 specifies the latter around `__shell`. The former is pure | 2026-11-05 | T09 planner |
| `probeFrame` carries a dead branch to stay over V8's inlining limit | The profiler charges an inlined function to its caller, so a small probe read 0 at its own URL [O]. Ugly, and it is why the file is alone. Moving it to the caller's class would have hidden the same thing in real code | 2026-11-05 | T09 executor |
| Probe size is 4n + 24, plan text corrected | Measured, and the rehearsal's own 136 and 520 agree. Disk wins | 2026-11-05 | T09 executor |
| A15's "stable within 1 B between two runs" reads three in a row, on one page, after warming | Two equal readings can be a false plateau [O: 3848.4 twice, then 3761.6]. Stricter than the row, and no number moved | 2026-11-05 | T09 executor |
| Windows control before any profile, with 3000 warm frames | Read after profiles and 1000 frames it was 261 B too high [O], cause not separated. Same ±16 | 2026-11-05 | T09 executor |
| `openHarness` mocks Vite's HMR socket | A reload kills a sweep, and the parallel batch writes to files in this page's graph [O]. A harness page must not reload mid-test at T10 either | 2026-11-05 | T09 executor |
| `gpuLoad` iteration made heavier, gate stays 3 ms | The 3 ms comes from §11.4's 5.8 ms calibration, and my first loop cost about a third of that. The control was wrong, not the clock | 2026-11-05 | T09 executor |
| `Controls.staleRewrite`, `TrapDrills.rawStaleUpload`, `lab.heapAfterGc` added | A boolean `staleUpload` cannot express the three frames the drill needs. The lab is T09's, not a contract | 2026-11-05 | T09 executor |
| `silhouetteStd` reads 0 for a frame with any all-sky column | The plan's "0 if a column has none" has two readings. This one fails a lower limit; the other mixes a sentinel into the spread and can pass one | 2026-11-05 | T09 executor |
| `rawReadLater` waits for a rAF and then a macrotask | The plan said a macrotask. The rehearsal saw both read 0, and a presented frame leaves no doubt the buffer has gone | 2026-11-05 | T09 executor |
| Trap 4's drill opens `shell.html` by path on any target | A skip on the app would break B1's zero skips. The dev server keeps serving the shell page after T10, and B14 says shell-only | 2026-11-05 | T09 executor |
| `edgepaint.spec.ts` opens at tier 4, `context.spec.ts` at tier 3 | Tier 3's cap scales 2520x1080 to 2199x943 [O], and T03 uses tier 4 for this. A frame compared across a loss must be at one tier | 2026-11-05 | T09 executor |
| `TERRAIN_ARMED_ON_SHELL=1` runs armed specs on the shell | Spec mistakes should not wait for T10. It found one. It proves nothing about the game, and `armedOnly` says so | 2026-11-05 | T09 executor |
| A short soak's growth gate reads all samples | With 2 samples, "from sample 1 on" leaves one, and growth 0 would be vacuous. From 3 samples on it reads from sample 1 as written | 2026-11-05 | T09 executor |
| The isolation build's `cacheDir` is under `test-results/T09-iso` | It must not write in `node_modules` while siblings run | 2026-11-05 | T09 executor |
| Pool sizes replaced by a scene audit | §9.3 states this (DI-17). T05, T03 and T04 have no growable pool. Objects, attribute bytes and pending ranges are what could actually grow, and `info.memory` does not cover them | 2026-11-05 | T09 planner |
| R1: B12 is two loss cycles. The byte compare runs with the sim held by `manual(true)`; travel rising runs in a second cycle with the loop on | V1 blocking: `renderState` takes `camX` from `prevX` (§8.1), so the one-cycle compare fails at T10 by construction. Old structure with the shell's camera following the sim: 324,024 bytes off [O] | 2026-11-05 | T09 executor. Fix proposed by the V1 verifier; approved by the T00 owner as DI-65 |
| R1: B14 compares the warp frame with a self-healing refill of the same state on the same page, a jump to chunk 5 and back | V1 blocking: a fresh page ran its DEMO loop for a different time, so its camera differs. Old structure: hashes differ [O]. A stale range still fails it at 6,123,600 bytes [O] | 2026-11-05 | T09 executor. The V1 verifier's fix, so agreed by the V1 verifier |
| R1: DI-58's same-state bound in `compareAt`, `sequence`, A8 to A11, B3, B4 and B12. On `gpu` at most 64 bytes and none over 1 level; on `software` 0 bytes. A byte over 1 level fails at once, in either compare | The T00 owner's DI-58, which names T09's identity gates, B3 and B12. The absCoord control still fails at once, 1.25M and 3.37M bytes at max 255 and 201 [O] | 2026-11-05 | T00 owner (DI-58); applied by the T09 executor |
| R1: DI-58's bound also on B14's trap-2 compare | It is a same-state identity compare, "byte-identical" in its row, with other states rendered in between, which is the case DI-58 describes. DI-58 names "T09's identity gates" without listing B14, so confirmation is asked of the T00 owner. A stale range reads millions of bytes [O], far past 64 | 2026-11-05 | T09 executor. Not yet confirmed by a reviewer |
| R1: `lab.settle(key, 1000)` before identity exact's reference, and on both sides of B12's loss for post off | V1 low, from T03's flip: 13 and 18 of 20 loads dirty at 0 ms, 0 of 20 after 1 s. No limit changes, and one try stays one try | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: `worstCrossMax` over every attempt, asserted at most 1 in post-on (B4) | V1 low. A unit test fails if only the last attempt is kept [O] | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: a unit test for `sequence` with a noisy byte in every attempt | V1's mutant `dirty >= 0` survived; now exit 1 [O] | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: `instrument` counts calls per frame, and B18 asserts at least one `sim.step`, terrain or props `frame`, and `post.render` per frame | V1 low. On the shell the streaming line read p99 0 with 0 calls, and the new check fails it [O] | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: B16 reads tiers from the buffer against `fakeProfile(t).maxPixels`, and above the tier below where the full-size buffer is | V1 low: `stats().tier` moves at the force. A host that never applies a tier passed the old B16 and fails the new one [O] | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: B10 liveness floor, shimmer over 1 | V1 low. It adds a failure and loosens nothing: a zero step reads 0, terrain 6.27 to 7.42 [T03 O], the shell 12.20 [O] | 2026-11-05 | T09 executor. The V1 verifier proposed a floor; the value 1 is the executor's |
| R1: B5's tier-1 sweep asserts `silhouetteStd` at least 2 | V1 low. With no terrain the old test passed and the new one fails [O: shell] | 2026-11-05 | T09 executor. The V1 verifier's fix |
| R1: the soak's 700 km is measured from `stats()` before batch 0 | V1 **rejected** the deviation that added an assumed 36 km for the warm-up. Measured 72.0 km over 2 batches against 36.0 from sample 0 [O] | 2026-11-05 | T09 executor. Rejected by the V1 verifier; the work was changed to what V1 accepts |
| R1: with 2 samples, the soak's constant-resource checks compare sample 1 with sample 0 | V1's condition on the short-soak ruling, recorded and closed. A mesh added in batch 2 passed the old reference and fails the new [O] | 2026-11-05 | T09 executor. Condition set by the V1 verifier |
| R1: the shell host steps its sim in its own loop until `manual(true)`, and `?follow=1` takes `camX` from the sim | V1 found the shell pinned `camX` and stepped no sim, so it could not show either blocking defect. With both, the old structures fail on the shell and the new pass [O]. A fixture change; no threshold | 2026-11-05 | T09 executor |
| V1 rulings, accepted: probe 4n + 24; `staleRewrite`, `rawStaleUpload`, `heapAfterGc`; `rawReadLater`'s rAF plus macrotask; trap 4 on `shell.html`; edgepaint at tier 4 and context at tier 3; `silhouetteStd` 0 for any all-sky column; `TERRAIN_ARMED_ON_SHELL`; the heavier `gpuLoad` at the same 3 ms gate; the windows control before any profile | V1's reasons are in its verdict, each with a run or a mutation. The rows above for each stay as written | 2026-11-05 | Agreed by the V1 verifier |
| V1 ruling, accepted with condition: A15's three runs in a row within 1 B | Condition met: the assertion's message and B19's row say a failure on it alone goes to T09, and is not a §9.2 breach | 2026-11-05 | Agreed by the V1 verifier |
| V1 ruling, accepted with condition: the HMR mock covers every socket | Condition met: a mocked socket without Vite's `token=` is printed as `HMR mock: also mocked ...`, so an app socket would be seen and the pattern narrowed. None in the full forever run [O] | 2026-11-05 | Agreed by the V1 verifier |
| V1 ruling, accepted with condition: the short soak's growth gate reads all samples | Condition met: recorded in A18, and the 2-sample constant checks now compare with sample 0 | 2026-11-05 | Agreed by the V1 verifier |
| V1 low, no change: frame.timing's 20% restore check | V1: fragile on a 1 ms p50 at .1 ms resolution; if it fails on a quiet machine, a floor of `max(20%, .3 ms)` needs a reviewer's agreement first. Not re-run in R1 | 2026-11-05 | The V1 verifier's ruling |
| R2: every same-state compare T09 gates on `gpu` runs at MSAA 0: identity post on (A10, B4), the sequence (A11, B4), the absCoord control's post-on half, and B12's held `full`. Attempts, self-compare and DI-58's bound are kept | DI-67: through D3D11 a blended MSAA resolve differs between identical renders by up to 173 B, past DI-58's bound, and MSAA 0 and Vulkan read 0 [T05 O]. §11.3's Pixel identity row now says post on at MSAA 0. The control still fails the gate as it now runs: 3,360,447 bytes, attempts 1 [O] | 2026-11-05 | T00 owner (DI-67); applied by the T09 executor |
| R2: a print-only post-on MSAA 2 identity run under `--use-angle=vulkan`, in `tests/forever/identity-vulkan.spec.ts` | DI-67 allows it. It needs no T00 file: a top-level `test.use({ launchOptions })` in a T09 spec, since a describe group cannot hold one [O]. It asserts only the renderer string, so a run on the wrong backend cannot print as Vulkan (M6 caught that) | 2026-11-05 | T09 executor, under DI-67 |
| R2: DI-58's bound on A14's controls-off `after`, which was exact | DI-68 names it. A control left on reads 373,921 or 5,916,110 bytes [O], so the bound gives up nothing a real fault would show | 2026-11-05 | T00 owner (DI-68); applied by the T09 executor |
| R2: DI-58's bound on A6's `distant` and `again`, which were exact | DI-68 covers "any comparison on the `gpu` project between two renders of one state", and these are two, with other states in between. DI-68 does not name A6, so this is the executor's reading of its text. A frame one chunk off the period reads 172,800 bytes [O] | 2026-11-05 | T09 executor, reading DI-68. Not named by the T00 owner |
| R2: B14's trap-2 bound, asked for confirmation in R1, is confirmed | DI-68 names it | 2026-11-05 | T00 owner (DI-68) |
| R2: shimmer stays at MSAA 2, including its repeat and zero-step checks | DI-67 keeps MSAA in "the cost, look and tier rows, which do not compare bytes". Shimmer is a look row, its zero step is a band mean with its own .001 limit, which DI-58 lets a row keep, and moving it to MSAA 0 would no longer test the conditions the shimmer number is taken under. The executor's reading; if the T00 owner counts the zero step as a same-state compare, it moves | 2026-11-05 | T09 executor, reading DI-67 |
| R2: unchanged because they compare different states: identity liveness, the `during` frames of A14, A6's `nextRow`, trap 2's stale drill, tierswitch's per-frame diff, warp's shimmer ratio | DI-68: "a row whose comparison is between different states ... is unaffected" | 2026-11-05 | T00 owner (DI-68) |
| R3: B12's held wait renders at `KEY.tick + 6 * frame`, then compares back at `KEY.tick`, and asserts the overlay is still hidden after | V2 blocking: T08's gate writes a changed view only once the tick moved 6, so with every frame at 28800 the overlay could never hide [O: 20 s timeout on T08's real UI]. The fix V2 proposed. T10's `__mvE2e.contextOk()` was not used: T10's plan says only T10's and T11's specs read it | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: `compareAt` refills before every attempt's A1, `sequence` before every attempt's near run, and B12 before both captures. `compareAt` therefore draws two more frames per attempt, and its unit test for frame counts reads `2 + 3 + 2 + 64 + 3` | V2 low: T05 keeps a shard DEMO hid until a ring refills. On T05's real props the R2 procedure read 7,531 and 309,339 bytes, R3's 0 [O]. No limit moved; the extra frames are not compared | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: every shimmer test runs `lab.stepToTick(1200)` first, and the baseline test asserts the tick | V2 low: the baseline compared page loads at uncontrolled DEMO poses. 1200 is past any boot, and the call throws if a page is beyond it. The stored shell baseline did not move: 12.2022 at tick 1200 [O] | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: B8's home is `findBiomeChunk(0, 12 * ZONE_CHUNKS)`, asserted at or past zone 12 | V2 low: R2's home was zone 1, difficulty 1, against 12 far [O: T01's world]. Day phase, gate phase and landmarks still differ; not reachable through `forceZone` | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: the two wash-out control tests run under `forceZone(SUNSET_DRIVE, BOULEVARD, 0)` | V2 low. The shell's zone 0, where the controls were measured, and B11's default palette. Shell numbers unchanged [O] | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: the veil control is `veil(.05)` in A14 and B11, under `forceZone(SUNSET_DRIVE, BOULEVARD, 0)`, and the controls-off check uses the same strength. Decided | On the real layers `veil(.1)` reads chroma 51 to 55 on either palette at any day phase, so chroma catches it too and it no longer shows the blind spot the control is for; `veil(.05)` reads 64 to 65 with `blackP10` 35 [O, without T06's post]. On the shell `.05` passes A14, and removing the veil fails it on `blackP10` 15 [O]. No gate threshold moved. If B11 on the app reads chroma at or under 55 at `.05`, T10 records a seam row rather than changing the strength | 2026-11-05 | T00 owner (DI-72), on the T09 executor's R3 row; applied by the T09 executor |
| R3: `budget.ts` reports `layerCount`, and B18's counts go through `callCountProblems`, which also holds `minCalls.layers` to `layerCount` | V2 low: streaming counts terrain and props together, and V2's `minCalls` mutants for sim and streaming survived. Now caught, with props bypassed caught as well [O] | 2026-11-05 | T09 executor. V2-T09's fix |
| R3: `identity-vulkan.spec.ts` skips, printing why, where the launched renderer is not hardware Vulkan, including SwiftShader, whose string names Vulkan | DI-71(2), and the coordinator's item from T05's repair. Acceptance change: B1's zero skips now excepts this one skip, whose message starts `NOT VULKAN (DI-71)`, so it cannot be mistaken for `UNARMED` | 2026-11-05 | T00 owner (DI-71); applied by the T09 executor |
| R3: `frame.timing.spec.ts`'s comment says 2.8 km at cruise and 3.2 km at DEMO's mean | V2 low, cosmetic. T02's DEMO read 3.13 to 3.16 km, inside 4.48 km [O] | 2026-11-05 | T09 executor. V2-T09's correction |
| D: B10's limit and baseline, and A12's repeat, zero step and naive-grid control, are measured with the props layer hidden on the app; the all-layers figures, under `full` and `bare`, are printed and not gated. No threshold moved | DI-74, after T10's D-002 and D-004: all layers 25.87, props hidden 7.44, and the naive grid added .87 with all layers and 11.2 with props hidden, since props cover the floor in the band [T10 O]. The shell has no props layer, so nothing is hidden there and its numbers stand | 2026-11-06 | T00 owner (DI-74); applied by the T09 executor |
| D: the veil control is `veil(.06)`, and every wash-out test steps to sim tick 1200 first and asserts it, the shimmer tests' tick | DI-76, after T10's D-003: `.05` read `blackP10` 25 to 27 over 13 poses with T06's post, on the limit, so the control passed or failed by load timing [T10 O]. No threshold moved | 2026-11-06 | T00 owner (DI-76); applied by the T09 executor |
| D: B19's stability line is `windowStability(last three, .05)`, each median within 5% of their mean; fewer than three, a non-finite median or a non-positive mean is not stable | DI-77, after T10's D-005: spreads of 234 to 296 B over about 8.8 KB never met 1 B [T10 O]. The function is unit-tested on T10's series and on climbing and outlier series, which fail | 2026-11-06 | T00 owner (DI-77); applied by the T09 executor |
| D: B19's `other` line is 512 B/frame, checked with `world` and `libs` through `classLimitProblems`, and its control counts the `allocProbe(1024)` profile's probe bytes as `other`, which must fail the line | DI-78, after T10's D-008: the app reads 296 to 377 B/frame [T10 O]. The old control showed only that the probe class sees 256 and 1024 B; with the line at 512 a 256 B case no longer trips on the shell, whose `other` is about 14, so the 1024 B case is the one gated and 256 B is printed | 2026-11-06 | T00 owner (DI-78) for the limit; the control's form is the T09 executor's |
| D: B19 warms for at least 5 window runs (`MIN_WINDOW_RUNS`) before DI-77's 5% line may be met, asserted | The 1 B line also bought warm-up. 5% alone stopped the shell at run 3, on a JIT plateau, and the slope check then read 12.04 and 12.06 against 10; with 5 runs it read 2.77 and passed, and the mutant without the minimum was caught [O]. 5 is the count the 1 B line took on the shell. Stricter than DI-77, no threshold moved | 2026-11-06 | T09 executor. Reviewed and accepted by the T00 owner in DI-84 |
| D: B19's stability line and its windows control are `expect.soft`. A failure still fails the test; it no longer stops the class lines, profile controls, slope, leak and top 12 from running and printing | D-005's symptom was that one measurement-validity line hid every §9.2 line after it. The windows control fails on the app by route noise (section 10), so a hard assertion there would recreate D-005 one line further on. No limit or tolerance moved | 2026-11-06 | T09 executor. Reviewed and accepted by the T00 owner in DI-84 |
| E: B19's windows control takes its form from `target()`. On the app, `allocPairs(300, 10, 1/60, 256)`: 300 pairs of 10-frame windows over one stretch, the probe on in the first of each pair and off in the second, and `probeShift` must read 256 ± 64. On the shell, the sequential form as before, clean and probe runs 3000 frames apart, at 256 ± 16. Both soft | DI-84: on the app the clean medians drift with the route, so the sequential form read +88.8 to +564.4 for a true 256, and interleaved runs +207.6 to +264.2 [O: repair D]. The shell's scene is constant and keeps ± 16. Loosened on the app only, by the ruling's 64 and no further | 2026-11-06 | T00 owner (DI-84); applied by the T09 executor |
| E: the interleaved form's details: 300 pairs, the same 300 windows per side as B19's clean windows; strict alternation, probe-on first; no probe warm-up before it; one definition, `probeShift`, for both forms, which throws when the control is no larger than its tolerance, so a probe of 0 can never be configured to pass | DI-84 names the method and the tolerance, not these. 300 pairs because repair D's 150-pair null read -96.4 against -4.6 at 300 [O]. A pair is 20 frames, so a route drift of hundreds of bytes over thousands of frames biases a pair by a few bytes at most [I]. The guard turns a misconfigured control into an error rather than a pass | 2026-11-06 | T09 executor, within DI-84 |
| E: after the scatter diagnostic, the method and the 64 stay as ruled, and the reading of +323.2 goes to the T00 owner | A wider line is a loosening only the ruling can make. Neither variant tried, a flipped order or the median of pair differences, was consistently tighter, and neither was measured through the gate's own routine, so switching to one would trade a measured method for an unmeasured one (section 10) | 2026-11-06 | T09 executor. For the T00 owner |
| F: B19's windows control on the app uses `allocProbe(1024)` in the interleaved form, `allocPairs(300, 10, 1/60, 1024)`, accepted at 1024 ± 256; the shell keeps `allocProbe(256)`, sequential, at 256 ± 16. The per-target table moved from `alloc.timing.spec.ts` to `WINDOWS_CONTROL` and `windowsControlCheck` in `tests/perf/support/heap.ts`, so the unit suite holds the gate's own values | DI-86(2), on repair E's +323.2: with 256 B, no-probe readings ran from -58.4 to +127.8 and one real reading was +323.2 [O], so 256 ± 64 could not separate the probe from the noise. Applied: 4 new unit rows failed on DI-84's values and passed on DI-86(2)'s; a probe of 0 failed the app form at -4.0 through the gate (F1); 7 real readings over 3 page loads lay inside, worst 1208.4 [O]. The tolerance rose with the probe by the ruling, no further; the shell's line did not move | 2026-11-06 | T00 owner (DI-86(2)); applied by the T09 executor |
| G: `renderAt` and the core's `renderState` throw a `RangeError` unless the chunk is an integer in [0, CHUNK_LIMIT + 1024), through one function, `requireRenderChunk` in `api.ts`. `renderAt` checks after `manual` and before the loss check; the core checks before `onRender` and the host call | DI-93. The core's `renderState` is the only route to `host.renderState`, so every lab sweep, trap drill and control frame is covered, not only the call a spec makes. The check sits before the loss check so a bad argument is an exception whether or not the context is live, as `stepFrames` validates `n` and `dt` before it runs. Two checks, so a mutant that removes either is caught (G1, G2, G6) | 2026-11-06 | T00 owner (DI-93); applied by the T09 executor |
| G: the range covers the chunk only. `local` and `tick` are not checked, and `stepFrames` is not guarded | DI-93 names the chunk and `renderAt` and `renderState`. `stepFrames` renders where the sim is: `warp` bounds that below CHUNK_LIMIT, and flight cannot carry it to 2^49, where the hang begins, in any run (2^48 chunks). Frames between 2^48 and 2^49 after a warp and a long flight are degraded, not hung, which is DI-93's accepted cost. Guarding `stepFrames` would be a harness-only stop of the sim, which R1 forbids for the game and no ruling asks for | 2026-11-06 | T09 executor |
| G: B9b's first evaluate renders one warm-up frame at chunk 5, then tries `renderAt(CHUNK_LIMIT + 1024)` alone; every out-of-range call after it is raced against 15 s; the in-range frames at CHUNK_LIMIT + 1023 and chunk 5 come after, bounded only by the test timeout | Without the guard, 2^48 renders and returns (VI-r1: 2^48 + 5 to + 65541; here 21.7 ms on a warm page, G7), so a regression fails at the edge and never makes a call that would hang the tab. The first harness frame after a browser launch took 5.1 to 5.2 s (section 10), which inside the race used 5.4 of the 15 s; the warm-up spends it before the race starts. A slow in-range frame is a layer's matter, so it is not raced | 2026-11-06 | T09 executor |
| G: B21 runs `vite build --outDir <testInfo.outputPath('dist')> --emptyOutDir` and measures that folder, never `dist/`. With no `index.html` it fails with a message. The project skip (`software` only) stays | VI-gates offered "build it, or fail". Building is the stronger gate: it always measures the current sources, where a `dist/` can be stale or absent. Its own folder because `dist/` is shared: T10's A27, B2 and B17 rebuild it, and four owners run beside T09, so B21 neither reads a half-written `dist/` nor empties one another run is serving. The bytes measured are the same build, same config. The project skip is routing, not a missing build: `test:perf` runs B21 under `software`, and one build per run is enough | 2026-11-06 | T09 executor |
| V2 rulings, recorded: DI-68 on A6 accepted; shimmer's zero step at MSAA 2 accepted as DI-71(1)'s exception; B10's floor of 1 accepted; the shell's loop and `?follow=1` accepted; the Vulkan spec accepted | V2's verdict, section 14 | 2026-11-05 | V2-T09; DI-71 by the T00 owner |

## 12. Contract change requests

All additive. Prefixed `T09` because T00's plan has its own numbering. The text below is kept as a record. T09 also depends on T03-CCR-1, T03-CCR-2, CCR-T02-2 and CCR-T01-3, which are C-18, C-19, C-14 and C-10 in `plans/RECONCILIATION.md`.

**CCR-T09-1. More fields in `HarnessStats`. Amended,** C-26, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. Specs need the frame's shape to read `pixels()`, and T10's §11.5 motion test needs mode and tick through `__mv`. `src/contracts/index.ts`, inside `HarnessStats`, after `chunk: number; local: number; tier: Tier;`:

```ts
  /** Drawing buffer size in pixels, the shape of pixels(). */
  width: number; height: number;
  tick: number; warpSerial: number; mode: SimMode;
```

**CCR-T09-2. More members in `HarnessApi`. Amended,** C-27, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. §11.3's context test, §9.2's "tier 3", §14 risk 10's forced switch and §11.5's SIGNAL_LOST crossing have no contract path. Zero pitch for §11.3's crack test has none either. `src/contracts/index.ts`, inside `HarnessApi`, after `forceFov`:

```ts
  /** Overrides feel fields, including under renderAt; null clears. { shakeY: -CAMERA_PITCH } gives zero pitch, { bloomGain: 0 } removes bloom. */
  forceFeel(o: Partial<FeelState> | null): void;
  /** Calls governor.force; applies at the next frame. 'auto' returns control to the governor. */
  setTier(t: Tier | 'auto'): void;
  /** Reaches SIGNAL_LOST through sim.forceSignalLost(). PLAY only. */
  forceSignalLost(): void;
  /** Resolves one macrotask after webglcontextlost. Rejects if already lost. */
  loseContext(): Promise<void>;
  /** Resolves on webglcontextrestored. Rejects, touching no GL, unless a loseContext promise has resolved (§11.3). */
  restoreContext(): Promise<void>;
```

Above `pixels(): Uint8Array;`, a second comment line:

```ts
  /** Rows are bottom-up, as gl.readPixels gives them. Throws unless in the same synchronous run as renderAt or stepFrames. renderAt and stepFrames throw unless manual(true). */
```

**CCR-T09-3. `overrideFeel` in `HarnessHost`, and comments on its frame methods. Amended,** C-28 and C-31, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. `overrideFeel` went in as filed, and C-31's block replaced the two comments below. The harness cannot reach pitch or bloom gain, because `renderState` writes pose and feel inside the call. `src/contracts/index.ts`, inside `HarnessHost`, after `overrideFov`:

```ts
  /** Merged over feel.out in runFrame and over neutral feel in renderState; overrideFov wins on fovDeg. null clears. */
  overrideFeel(o: Partial<FeelState> | null): void;
```

Above `runFrame(dt: number): void;`:

```ts
  /** Reaches sim, layers and post by property lookup, never a captured method, so the harness may wrap them. */
```

Above `renderState(chunk: number, local: number, tick: number): void;`:

```ts
  /** view.dt is 1/60. Applies a tier pending from governor.force before drawing, and step 10's rebuild if warpSerial changed. v.sim is untouched. */
```

**CCR-T09-4. Fake host surface. Approved,** C-29, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. T09's unit tests inspect what the harness asked for. `src/testing/fakeHost.ts`, in `FakeHostCalls`, extending T00's CCR-6:

```ts
  overrideFeel: unknown[]; governorForce: (Tier | 'auto')[];
```

`createFakeHost`'s `sim`: `warpTo` obeys `canWarp`, updates `state.travel`, and increments `warpSerial` only on success. `step` advances `state.travel` by `SPEED_CRUISE / SIM_HZ`, sets `stepDist`, and increments `tick`. `forceSignalLost` exists, per CCR-T02-2. `overrideFeel` records.

**CCR-T09-5. Lint: no static harness import from the app. Approved,** C-30, in T00's lint table. A static import is the one way a normal visit would fetch the harness, and it would otherwise surface only in a browser test at T10. Not a contract, but T00 owns `eslint.config.js`. In T00's table, the row `src/app/**`, `src/main.ts`: forbid `harness` through `no-restricted-imports` as well as `testing`, leaving the `ImportExpression` selector for `testing` only. Add to `tests/boundaries/boundaries.test.ts`: `import { createHarness } from '../harness/index'` in `src/app/x.ts` fails; `export * from '../harness/index'` in `src/app/x.ts` fails; `await import('../harness/index')` in `src/app/x.ts` passes.

## 13. Outcomes and retrospective

**Result against Purpose, on the shell target, before T10:**

1. `test:forever`'s machinery runs and can fail. Pixel identity is 0 bytes at 6.4e7, 1e9, 6.4e13 and 1e15 u, post off and post on, plus 120-frame sequences, on T00's proof layer and `labPost`. Warp limit, cracks, fog edge, restore with the overlay and the full soak are written and **not run**: they arm at T10.
2. `test:perf`'s machinery runs. Sync frame time tracks a known load, and bytes per frame are exact for uniform work and attributed by function. Bundle, software and sub-budget gates are written and **not run** on a real build.
3. Every gate shown able to fail, on real pixels where the shell allows: `absCoord` fails identity at 1.25M and 3.37M bytes with `selfBytes` 0 and attempt 1. Naive grid trips shimmer, 20.34 against 18.30. `floodLines(16)` fails haze lift at 32.14 with near-white 0 and chroma 173.9. `veil(.1)` fails `blackP10` at 75 with haze 6.27. `allocProbe(256)` moves windows by 256.0 and 260.8. A static import fails isolation, by a request for the marked file on a normal visit.
4. A normal visit never fetches the harness, on a built fixture from a nested path: 0 requests for the marked file on `''`, `?harnessx=1` and `#harness`, 1 on `?harness`. The real `dist/` waits for B2.
5. A careless test gets an exception: `pixels()` outside the run throws, `renderAt` outside manual throws, and `restoreContext()` inside the loss dispatch rejects with no GL call, each with a test that failed when the guard was removed.

**Evidence at the close:** see Progress. `npm run check:task -- T09` exits 0 with `check:task T09 PASS`.

**After repair R1 (V1 verifier, DI-58, DI-65).** Both blocking defects are fixed. B12 is two loss cycles: frames compared with the sim held, and travel rising with the loop running. B14 compares the warp frame with a self-healing refill of the same state on one page. The old structures were shown to fail once the shell's camera follows its sim, which is how the app behaves, and the new ones pass there; the shell could not show this before, because it stepped no sim and pinned `camX`. DI-58's same-state bound is in every identity gate, and the absCoord control still fails at once. All eleven T09 low items are done or recorded: the 1 s settles, `worstCrossMax`, the sequence unit test that kills V1's surviving mutant, B18's call counts, B16's buffer check, B10's floor, B5's tier-1 liveness, the soak measured from before batch 0 (the rejected ruling), the 2-sample reference, the B19 stability message, and frame.timing left as ruled. Each new check failed in a run before it passed, or caught a mutant that was then restored by hash. Nineteen of twenty mutants were caught (9 unit, 6 of 7 on B12 and B14, 2 on B16 and B10, 2 on the soak); the one survivor, a shell restore without its rebuild, is explained in section 10. Four runs with a new check removed passed on nothing, which is the state before R1.

**After repair R2 (DI-67, DI-68).** Every same-state compare T09 gates on `gpu` runs at MSAA 0: identity post on, the 120-frame sequence, the absCoord control's post-on half, and B12's held `full`. Attempts, the self-compare and DI-58's bound are unchanged. DI-58's bound now also covers A14's controls-off check and A6's two same-state compares, so every same-state compare in T09 uses one definition. Each changed gate was shown to fail on a real fault, 7 of 7 mutants, each restored by hash: absCoord on in the post-on gate and in the sequence, a flood before B12's `full` frame, each wash-out control left on, A6's frame one chunk off the period, and the Vulkan print launched on D3D11. The optional post-on MSAA 2 identity under `--use-angle=vulkan` exists as a print-only spec of T09's own and read 0 bytes at all 4 `k`. The soak has no pixel compare, so nothing there moved. No threshold moved except by DI-58, DI-67 and DI-68.

**After repair R3 (V2-T09, DI-71).** The blocking defect is fixed: B12's held wait renders at a tick that moves 6 a frame, T08's panel throttle, and compares back at the key's tick with the overlay still hidden. R2's loop timed out on T08's real UI and the new one hid the overlay at frame 2, and holding the tick again was caught. The six low items: a refill before every reference frame, which on T05's real props turned 7,531 and 309,339 differing bytes into 0; shimmer at a fixed sim tick; B8's home at difficulty 12; the wash-out controls on Sunset Drive, with the veil at `.05` by DI-72; B18's counts through `callCountProblems`, which kills V2's two surviving mutants and catches a bypassed layer; the corrected travel comment. DI-71(2): the Vulkan print skips with `NOT VULKAN (DI-71)` on D3D11 and on SwiftShader, whose string names Vulkan, where R2 failed on both. Mutants: 9 of 9 unit caught, 1 of 1 on real props, 3 of 3 on the Vulkan spec plus 2 launches that must skip and did, and 3 of 4 spec mutants caught (a fifth, a 5-tick step, was expected to finish and did). The survivor, wash-out on Ultraviolet on the shell, shows the shell cannot model the case, and the real-layer probe shows the case is real.

**After repair D (T10's D-003, D-004, D-005, D-008; DI-74, DI-76, DI-77, DI-78).** Each defect was shown failing on the app before any edit, by T10's regression and by T09's own row, and each new row passed after, with its control failing in a run.

- **D-004 and B10's half of D-002 (DI-74).** A12 and B10 measure with props hidden on the app. A12: clean 7.4353, repeat equal, zero step 0, naive grid 18.6374 against `max(8, 11.15)`, back to 7.4353 after. B10: floor 7.4353 against 8, liveness over 1; printed, not gated: all layers 25.8678, floor under `bare` 9.6637, all layers under `bare` 31.7562. Control: A12 with props shown fails at 26.7342 against 38.8017 (D8). The shell has no props layer and its numbers did not move.
- **D-003 (DI-76).** `veil(.06)` at sim tick 1200, asserted: near-white .0016%, chroma 58.34, haze 4.83, `blackP10` 31. Against T10's D-003 figures, `blackP10` 32 and chroma 59.6 at the standalone pose: T10's own spec, now reading .06 from this file, read 32 and 59.43 there and passed, and its 13-pose sweep read `blackP10` 31 to 32, lowest at tick 1200. So B11 now runs at the sweep's worst pose, 6 over the line, where `.05` read 25, on it (D7). Controls: veil removed, `blackP10` 3 (D6); no `stepToTick`, the tick check fails at 36 (D5).
- **D-005 (DI-77).** The stability line is `windowStability`, three medians within 5% of their mean. Unit control: climbing, outlier and just-past-5% series fail, and both a constant-true mutant and the old 1 B line are caught (D1, D2). DI-77's line alone ended warm-up too early (section 10), so B19 now warms for at least 5 window runs first; without that A15's slope check failed twice at 12.04 and 12.06, with it 2.77 (D9). B19 on the app, final run: stability at run 6, 8450, 8528.8, 8636.8, 1.15%; every §9.2 line and control after it ran and passed, and only the windows control failed, moving 486 for 256 (open, below). A15 on the shell passed in full.
- **§14 risk 6, answered on the app,** B19's clean profile at tier 3, `full`, MSAA 2, 4000 frames: total 7986.4 B/frame; `libs` 6619.4, `engine` 1046.3, `other` 289.2, `harness` 29.1, `world` 2.4, `probe` 0.0. Top 12: `setValueV1f` 1863.0, `WebGLRenderer.render` 1531.9, `projectObject` 1372.5, native `sort` 971.1, `setValueV2f` 811.1, `setValueV3f` 454.6, `renderBufferDirect` 421.8, `writePair` (`src/render/terrain/atlas.ts`) 71.8, `frame` (`src/render/sky/skyLayer.ts`) 70.0, `drawStep` (`src/app/loop.ts`) 59.2, native `join` 51.5, `initTexture` 38.9. So about 83% of the frame's allocation is three.js's own render path, mostly its uniform setters and object projection, and project code is about 3.6%. Why three's setters allocate is not established here [I: boxed numbers, as before].
- **D-008 (DI-78).** `other` at 512 B/frame through `classLimitProblems`, with `world` and `libs`. Control: the `allocProbe(1024)` profile with its probe bytes counted as project code fails the `other` line, in the spec and in the unit suite (D3, D4).

**What T10's regressions should assert now** (T10's files; not edited here):

- `tests/e2e/defects/D-002.spec.ts`: `noProps <= 8`, which reads 7.4353, and print `all` (25.8678) without asserting it, per DI-74(3). Its `all <= LIMIT` line asserts the retired scope and will stay red. What props add belongs to T05's new supersampled check (DI-74(2)), so D-002's props half is T05's.
- `tests/e2e/defects/D-004.spec.ts`: hide props before both measurements (`mv.setLayerVisible('props', false)` after `setMsaa(2)`), then `naive > max(8, 1.5 * clean)` on those: 18.6374 against `max(8, 11.15)`. That is D-002's printed `naiveNoProps` against `noProps`.
- `tests/e2e/defects/D-003.spec.ts`: unchanged; it reads `VEIL_L` from `washout.spec.ts`, and passed at .06.
- `tests/e2e/defects/D-005.timing.spec.ts`: replace the 1 B condition, in the loop and the assertion, with `windowStability(recent, 0.05).stable` from `src/harness/metrics.ts`.
- `tests/e2e/defects/alloc-other.timing.spec.ts` test 1: `OTHER_LIMIT` 512 (DI-78), or read it from `tests/perf/alloc.timing.spec.ts` as D-002 does `LIMIT`; it read 318.5 and 320.1 here.

**Open from repair D, for the T00 owner:**

- **B19's windows control on the app** (section 10). DI-77 left the controls unchanged, and the sequential 256 ± 16 control moved 516.4, 564.4 and 88.8 on the app, because the clean medians move with the route; interleaving got 207.6 to 264.2, still outside ±16. It is exact on the shell (A15). Options for a ruling, none applied: run it on the shell only, with the app keeping the profiler controls; or an interleaved method with a stated tolerance; or a tolerance stated against the measured route noise. Until then B19 fails on this line alone, as a soft assertion, after running and printing every §9.2 line. **Ruled as DI-84 and closed in repair E,** below.
- **B11's flood control margin on the app.** Haze lift read 20.47 at tick 1200 against `> 20`, and 20.05 at the unfixed pose before this repair. Not changed by DI-76 and not a T09 item here; recorded so the margin is known before T11 re-derives the wash-out limits.
- **B10's baseline on the app** has no key yet. Writing it is the hand-off's item 4, after a look at a run, and it must be written by this spec, which now measures props hidden (7.4353 on this machine).

**Not verified, from repair D:**

- **That 5 warm-up runs is right on the app.** It is the shell's history; the app passed its slope line at both 3 and 6 runs, so the app did not show the need.
- **The windows control's cause on the app** is inferred from the route-dependent medians, not traced to a module.
- **Sibling activity.** T03 and T02 held the GPU lock between my runs, so siblings were active. The pixel rows read the same figures before and after, to every printed digit (7.4353, 25.8678, 18.6374), so no sibling change showed in them. The allocation runs were alone in the lock, and they are heap bytes, not frame time.
- **B10's baseline half on the app** cannot pass until T10 writes the app key. T10's D-002, D-004, D-005 and alloc-other regressions stay red until T10 updates them as listed above.
- Every spec this repair did not touch was not re-run (Progress).

**After repair E (DI-84).** B19's windows control takes DI-84's form for its target, through one definition, `probeShift` in `metrics.ts`.

- **App, interleaved, 256 ± 64.** `allocPairs(300, 10, 1/60, 256)` alternates probe-on and probe-off windows over one stretch. B19 on the app moved 225.4, off by 30.6, and **passed in full, exit 0**, its first full pass on the app. Every §9.2 line held: `other` 330.8 against 512, `world` 3.0, `libs` 6709.1, total 8107.7, `probe` 0.0 clean, `classLimitProblems` []. The top 12 match repair D's to within a few percent: `setValueV1f` 1883.6, `WebGLRenderer.render` 1513.0, `projectObject` 1413.0, native `sort` 971.4, `setValueV2f` 811.7, `setValueV3f` 469.5, `renderBufferDirect` 437.0, `frame` (`src/render/sky/skyLayer.ts`) 75.2, `writePair` (`src/render/terrain/atlas.ts`) 72.7, `drawStep` (`src/app/loop.ts`) 62.8, native `join` 58.7, `updateTexture` 39.5.
- **Control: a probe of 0 fails the interleaved form,** at +78.0, off by 178.0, exit 1, with every line after it still run (E1). Each of the six readings without a probe fails it.
- **Shell, sequential, 256 ± 16, as before.** Moved 256.0, A15 passed, exit 0.
- **`MIN_WINDOW_RUNS = 5` and the soft assertions:** reviewed and accepted by the T00 owner in DI-84 (Decision log).
- **Units.** `probeShift` and `allocPairs` failed before they existed (11 failed), then passed (78; 204 across the harness suite), and 6 of 6 unit mutants were caught and restored by sha256 (E2 to E7).

**Open from repair E, for the T00 owner:**

- **DI-84's ± 64 is not always met on the app with a real probe** (section 10). Of the 7 readings with the probe at 300 pairs, across all runs, 1 read +323.2, off by 67.2, in the diagnostic run of the gate's own routine; B19 itself passed in its one run. Readings without a probe range from -58.4 to +127.8. Options for a ruling, none applied: more pairs per control, if the scatter shrinks with them, which is not shown; a tolerance stated against the measured scatter; or a probe of what differs between adjacent windows on the app. Until then a B19 failure on this line alone is a T09 measurement failure, not a §9.2 breach (hand-off item 5). **Ruled by the T00 owner as DI-86(2)** (a 1024 B probe at 1024 ± 256 on the app), applied in repair F below.
- B11's flood margin and B10's app baseline stay as repair D left them; DI-84 also notes the flood margin for T11.

**Not verified, from repair E:**

- **B19's pass rate on the app.** B19 ran in full once on the app after the change, and passed. Its control statistic was read 12 times at 300 pairs over four page loads, counting repair D's: 7 with the probe, 1 of them outside the line, and 5 without. That is a count, not a rate.
- **The cause of the no-probe scatter,** and whether the per-window variants' results carry over to the gate's routine.
- **Sibling activity.** T07 held the lock until just before E1, and every run here held it alone. These are heap bytes, not frame time.
- Every spec this repair did not touch was not re-run (Progress), and T10's `D-005.timing`, which calls `allocWindows`, was not run.

**After repair F (DI-86(2)).** B19's windows control on the app is interleaved with `allocProbe(1024)`, held to 1024 ± 256; the shell keeps `allocProbe(256)`, sequential, at 256 ± 16. Both read their probe size and line from one table, `WINDOWS_CONTROL` in `tests/perf/support/heap.ts`, through `windowsControlCheck`.

- **App, B19 passed in full, exit 0.** Moved 1027.0, off by 3.0. Every §9.2 line held: `other` 342.6 against 512, `world` 8.8, `libs` 6686.2, total 8083.2, `probe` 0.0 clean, `classLimitProblems` [].
- **Control: a probe of 0 fails the app form,** at -4.0, off by 1028.0, exit 1, with every line after it still run (F1). All 5 no-probe readings through the gate's routine in this repair failed, the nearest at +72.4.
- **7 readings of the real probe through the gate's routine, over 3 page loads:** 1027.0; 1009.8, 1014.2, 1208.4; 1095.6, 1043.4, 1163.4. All inside 768 to 1280.
- **Shell, A15 passed, exit 0,** moved 256.0 against 256 ± 16, as before.
- **Units.** 4 new rows failed on DI-84's values and passed on DI-86(2)'s; 211 pass across the harness suite.

**Open from repair F, for the T00 owner, no action asked:** the worst real reading, 1208.4, used 184.4 of the 256, leaving 71.6 B. That is 18% of the signal, where DI-86(2) estimated about 12%, and the high readings came at the same point on the route in both diagnostic pages (section 10). Every reading passed, so nothing is changed. If B19 fails on this line alone in a later run, it is a T09 measurement failure, not a §9.2 breach (hand-off item 5).

**Not verified, from repair F:**

- **B19's pass rate on the app.** 7 of 7 readings passed, B19 itself once. That is a count over 3 page loads, not a rate, and the margin at one route position was 71.6 B.
- **Why the reading depends on route position,** and whether the error grows with the probe size. Both are inferred from 7 readings at each size.
- **Sibling activity.** The lock was free at every acquisition here and each run held it alone. These are heap bytes, not frame time.
- Every spec this repair did not touch was not re-run (Progress), and T10's `D-005.timing` was not run.

**After repair G (integrated review: VI-r1's DI-93, VI-gates' B21).** Both items are fixed, each shown failing on the old code first and passing after, with its mutants caught and restored by sha256.

- **DI-93.** `renderAt` and the core's `renderState`, the one route to the host for every harness frame and lab sweep, throw a `RangeError` unless the chunk is an integer in [0, CHUNK_LIMIT + 1024), the same check `warp` makes below CHUNK_LIMIT. `renderAt` checks before the loss check, so a bad chunk is an exception while lost too. On the app, B9b: CHUNK_LIMIT + 1024 refused; 2^49 + 5, -1, 1.5, NaN and Infinity through `renderAt`, and 2^49 + 5 through `compareAt`, `settle` and `refill`, all `RangeError`, in 30.2 to 60.1 ms over the 4 runs with the warm-up frame, where VI-r1's `compareAt` to 2^49 + 5 did not return in 20 s; CHUNK_LIMIT + 1023 and chunk 5 still render. On the old code B9b failed at the edge (2^48 rendered and returned), so the spec cannot itself hang on the regression it guards. Units: 5 new rows, 4 failing before; 6 of 6 unit mutants and 2 of 2 whole-file spec mutants caught.
- **B21.** It builds `index.html` with the project's config into its own test output folder and measures that, so it always measures the current sources and never reads or rewrites the shared `dist/`. Without `index.html`, or when the build fails or writes no `index.html`, it fails with a message; it never skips for want of a build. Before: the old spec with no build exited 0 with `1 skipped`. After: 236.1 KB and then 236.6 KB of 260, harness 9.8 KB excluded, as sources moved under a sibling. 3 of 3 mutants caught.
- Rerun on the final code: `tests/forever --project=gpu` 42 passed, 0 skipped, on the app; `warp.spec.ts` 3 passed after its last edit; `tests/perf --project=software` 2 passed (B20 p95 38.4 ms, B21); `check:task T09 PASS`; `plans:check` 0 problems. No threshold moved.

**Not verified, from repair G:**

- **The guard on any page but the app, the fake page and Node.** The shell target was not run in this repair; the guard lives in `api.ts`, which every target loads.
- **`stepFrames` past 2^48 is not guarded** (Decision log): after a warp near CHUNK_LIMIT and about 65,536 u of flight, `runFrame` renders degraded frames, DI-93's accepted cost. Not run.
- **The hang itself was not reproduced here.** It is VI-r1's [O: 2^49 + 5 hung over 20 s], attributed by VI-r1 to T03's atlas loop from the code and a pinned CPU. This repair shows that no harness frame can now ask the host for that chunk; T03's optional progress assertion is T03's.
- **The 5 s first frame after a browser launch** (section 10) is observed, not explained. No profile.
- **`tests/perf` under `gpu-timing` and the soak** were not re-run, because the change cannot reach them (Progress). Their last runs are repair F's.
- **Concurrent `dist/` users.** B2, in this repair's `tests/forever` run, rebuilt `dist/` at 10:38:48Z by design; whether a sibling was serving it then is not known. B21 no longer touches it.

**Not verified, from R3:**

- **The veil control at B11 on the app.** At `.1` it would have failed on chroma over 55 on either palette (section 10). DI-72 set it at `.05`, which passed on the real layers with `labPost` [O] and on the shell [O], but not yet with T06's post or on T10. If it reads chroma at or under 55 there, T10 records a seam row (DI-72).
- **B12's new wait on the app.** Shown on T08's real UI through a fake host with T10's restore order modelled, not on T10. It assumes T10 flips `contextOk` and calls `showContextLost(false)` in one step, as its plan says.
- **The refill on the app.** Shown on T05's real props with an emulated DEMO, not T02's real one through T10.
- **Shimmer's pose dependence on the app.** On the shell it was 0.054%, far under 2%; how large it is on real terrain is not measured. `stepToTick` assumes T10's `runFrame(1/120)` steps once, and throws if not.

**Not verified, plainly:**

- **No B row has run.** Nothing here is about the game. The dry run on the shell is not evidence about it. That includes R1's B12 and B14: their fix rests on §8.1's `renderState` text, T10's host table and V1's measurement of the real T02 sim, and on the shell modelling that with `?follow=1`. None of it ran against the app.
- **B12's held cycle assumes T10 flips `contextOk` and the overlay in one synchronous step,** and hides the overlay rather than fading it. Inferred from T10's plan, M4. If T10 does otherwise, B12's held wait times out at 20 s and reports it.
- **DI-58 on B14** was the executor's reading in R1; DI-68 has since confirmed it. **DI-58 on A6** is the executor's reading of DI-68's "any comparison", since DI-68 does not name A6. **Shimmer at MSAA 2** is the executor's reading of DI-67's "look rows" (Decision log, R2).
- **MSAA 0 on the shell changes no result.** The shell read 0 bytes post on at MSAA 2 on D3D11 as well as Vulkan, so it cannot show DI-67's resolve noise or prove the move was needed. That rests on T05's evidence [T05 O], and on the app at B4 and B12.
- **A restore that skips its rebuild** cannot be caught on the shell, since nothing there is baked into a render target. On the app it is B12's job [I].
- **A21, whole-repo `npm run check`:** not yet run, by instruction, since it runs after the batch. `npm run typecheck`, `lint`, `test` and `test:browser` likewise.
- **Timing on a quiet machine: unmeasured.** Every A15, A17 and A18 run shared the GPU with siblings. A15 is heap bytes, so that does not touch it [I]. A17 is contaminated: 4 of 5 runs passed, and one failed the restore check by .1 ms on a 1 ms p50. Rerun it alone before trusting the restore line. B17 must be alone regardless.
- A13's `app` key: the key contains the target, but no `app` run can happen before T10.
- `gpu-timing` on the real `dist/`: `frame.timing`'s armed test, `bundle.spec` and `software.spec` have never reached their assertions. `software.spec` stopped at the tier check on the shell; `frame.timing`'s armed test needs `index.html` to build at all.
- Known not verifiable by T09 regardless: anything on a non-RTX GPU or a phone, including the post-on flake's cause. GPU target memory (§9.3), which stays arithmetic. Real driver resets (§14 risk 5), since `WEBGL_lose_context` is a simulation. Soak beyond 72,000 frames until the operator runs B22. Whether the shell's thresholds carry over: haze, `blackP10` and shimmer limits stay [A] until B10 and B11, and T11 may re-derive them. §6.4's worst fog row, camera x -28.8, not reachable under `renderAt`; T03 covers it on its dev page.

**Human checks:** B22, the operator's 2-hour real-time soak, `$env:TERRAIN_SOAK_MINUTES='120'`, open and not verified. *[Closed 2026-11-08 by the operator's run, recorded in T11's progress log: passed, growth 72,224 bytes, max 34.96 MB.]*

**Hand-off to T10, in order:**

1. `HarnessHost` per §8.1, with `sim`, `layers[i]` and `post` not frozen, or `instrument` throws. The host object itself may be anything, because T09 wraps nothing on it.
2. `createHarness(host)` after boot and one real frame, then `console.info('MV_READY')`.
3. Once `index.html` exists, `target()` returns `app`, the 15 skips must become 0, and B1 fails on any skip. Trap 4's drill keeps using `/tests/forever/fixture/shell.html`, so `labPost` and `shellHost` must keep working.
4. Write the app's shimmer baseline after looking at a run: `$env:TERRAIN_WRITE_BASELINE = '1'; npx playwright test tests/forever/shimmer.spec.ts --project=gpu -g "shimmer baseline"`. Until then that test fails by design. The stored file now holds only the `shell` key. From DI-74 the spec measures the app with props hidden, so the app key it writes is that scope (7.4353 on this machine in repair D).
5. If `other` breaches 512 B/frame at B19 (DI-78), read the top 12 first: see section 10 on inlining. Paste the classes and the top 12 here, which is §14 risk 6's answer. A B19 failure on the stability line alone (5% of the mean, DI-77), or on the windows control alone (interleaved, `allocProbe(1024)` at 1024 ± 256 on the app, DI-84 and DI-86(2)), goes back to T09, not to §9.2.
6. B12 is two tests now. The held one renders the held position until `[data-mv="context-lost"]` is hidden after a frame, each frame at a tick 6 past the last for T08's panel throttle, so the overlay must update in `ui.frame` and `contextOk` must turn true in the same step that hides it (seams table). B11's veil control runs at `.06` (DI-76, amending DI-72's `.05`), and every B11 frame at sim tick 1200; a chroma at or under 55 there goes to the T00 owner as a seam row, not a strength change.
7. Identity, B12 and B14 compare under DI-58's bound on `gpu`, taken from the project name. A run of them under another project name would compare at 0 bytes. So do A6 and A14's controls-off check (DI-68). Every one of them runs at MSAA 0 (DI-67).
8. `identity-vulkan.spec.ts` runs under `--project=gpu` with its own launch option, so `test:forever` launches a second browser for it. It prints and does not gate the frames. Where the launched renderer is not hardware Vulkan, SwiftShader included, it skips with `NOT VULKAN (DI-71)` and says why (DI-71(2)); B1 accepts that one skip.

**Lessons.** A control has to be checked against what it claims to be, not only against the gate: the too-light `gpuLoad` and the inlined probe both failed in a way that first looked like the gate's fault. The windows' false plateau would have passed as stable with the plan's two readings. Testing a spec on the shell before its target exists caught a real mistake cheaply. From R1: a stand-in target is only as good as the contract terms it models. The shell modelled the frame but not "the camera follows the sim", so a whole class of spec mistakes passed there; making it model that term turned both blocking defects into failing runs.

## 14. Revision notes

- 2026-11-05T15:32Z Executed. Corrected to what is on disk: probe size 4n + 24, `staleRewrite`, `rawStaleUpload`, `heapAfterGc`, `silhouetteStd`'s all-sky rule, three clean readings with the windows control before any profile, the tiers `edgepaint` and `context` open at. No threshold changed. Each has a Decision log entry. Status set to `done`: A1 to A20 ran. A21 and all B rows have not, as Outcomes says.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: C-10, C-14, C-18, C-19, C-26 to C-31, S-37, S-38, S-46 to S-50, S-53, S-55, DI-01, DI-09, DI-16, DI-17, DI-20, DI-28.
- 2026-11-05T19:40Z Independent verifier V1-T09, review only, no code changed. Verdict: not passed. Two blocking defects for T10: `context.spec.ts` (B12) and the armed trap-2 test in `traps.spec.ts` (B14) byte-compare frames taken before and after sim steps. On the app, `renderState` takes `camX` and `camY` from `prevX` and `prevY` (§8.1, T10 host table), and DEMO autopilot moves them: the real T02 sim read `prevX` 13.04 after 240 frames, against 0 when fresh. So both compares fail by construction. The shell's scripted frame holds `camX` at 0, so it could not show this. Reproduced: A1, A16, A19 (15 skipped, 24 passed), A20, and A15, A17 twice and A18 through the lock with siblings on the GPU. 14 restored mutations: 13 caught, and the one that survived made `sequence` pass with no clean attempt. Rulings: probe 4n + 24 accepted, since it was measured and the rehearsal's 136 and 520 agree. A15 three in a row accepted, on condition that a B19 failure on 1 B stability alone goes to T09, because B19 does not ask for it. `staleRewrite`, `rawStaleUpload` and `heapAfterGc` accepted: they are lab only, and removing the stale range failed trap 2. The HMR mock accepted, on condition that `routeWebSocket(/.*/)` is narrowed if the app ever opens a socket. `rawReadLater` waiting for a rAF and a macrotask accepted: with no wait it read 2,073,600 and the test failed. Trap 4 on `shell.html` accepted, since B14 says shell-only. Edgepaint at tier 4 and context at tier 3 accepted. `silhouetteStd` reading 0 for any all-sky column accepted. The short-soak growth gate reading all samples accepted, on condition that A18's constant-resource checks be recorded as vacuous at 2 samples. `TERRAIN_ARMED_ON_SHELL` accepted, since it can only un-skip. Soak's 700 km check adding an assumed 36 km for the warm-up batch rejected: measure that batch instead. T03's seam was not reproduced: 0 of 40 shell loads and 0 of 28 loads on T03's page with no settle, against T03's 13 and 18 of 20. B3's exposure therefore rests on T03's evidence, and a 1 s settle is recommended.
- 2026-11-05T20:40Z Repair R1, by the T09 executor, after V1's verdict and the T00 owner's DI-58 and DI-65. Blocking: B12 split into a sim-held cycle for the byte compare and a loop-running cycle for travel (DI-65); B14 compares on one page against a self-healing refill. DI-58's same-state bound applied to A8 to A11, B3, B4, B12 and, pending confirmation, B14; `compareAt` and `sequence` take a tolerance, and a byte over 1 level fails at once. Low: settles before the post-off references, `worstCrossMax`, a `sequence` unit test, `instrument` call counts and B18's checks, B16 on the buffer, B10's floor, B5's tier-1 `silhouetteStd`, the soak measured from before batch 0 (V1 rejected the padding), the 2-sample reference, and B19's stability message. The shell host now steps its sim in its own loop and takes `camX` from it under `?follow=1`, which is what let both blocking defects fail on the shell. Sections 2, 3, 4, 5, 7, 9, 10, 11 and 13 updated; every V1 ruling is in the Decision log with its reviewer. No threshold was loosened except by DI-58, the T00 owner's ruling.
- 2026-11-05T21:25Z Repair R2, by the T09 executor, after the T00 owner's DI-67 and DI-68. DI-67: identity post on, the sequence, the absCoord control's post-on half and B12's held `full` moved from MSAA 2 to MSAA 0, with attempts, self-compare and DI-58's bound kept; a print-only post-on MSAA 2 identity under `--use-angle=vulkan` added as `tests/forever/identity-vulkan.spec.ts`, which needed no T00 file. DI-68: DI-58's bound applied to A14's controls-off check and, on the executor's reading, A6's two same-state compares; B14's bound is now confirmed. Shimmer stays at MSAA 2, as a look row. Sections 2, 3, 4, 5, 6, 7, 9, 10, 11 and 13 updated. Every changed gate failed on a real fault, 7 of 7 mutants, each restored by sha256. No other threshold changed.
- 2026-11-05T21:58Z Independent verifier V2-T09, review only, no code changed. Verdict: not passed, one blocking defect for T10. B12's held cycle (`context.spec.ts`, `renderUntilRestored`) cannot finish on the app: T08's panel gate writes a changed view only once the tick has moved 6 or more since its last write, and the held cycle renders every frame at tick 28800. So the first post-restore frame shows the context-lost overlay at that tick, and no later frame at that tick can hide it. Shown on T08's real `createUi`: with the view written once at 28800, 400 more frames at 28800 left it visible, and one frame at 28806 hid it. The race is lost whenever T10's `await post.precompile()` outlasts one evaluate round trip: T06's precompile after a restore took 25 to 27 ms on its dev page, against 3 ms for a round trip. Low: a frame at KEY taken straight after DEMO keeps the shards DEMO already collected hidden, because T05 refills only on a backward or multi-chunk move, while any jump and return shows them. The real DEMO holds 1 to 5 such shards ahead of KEY from 1.3 to 2.0 s, so B3, B4 and B12's held compare fail in that window. Also low: B10's baseline compares page loads at an uncontrolled DEMO pose; B8's home and far zones differ in difficulty and day phase; A14's veil control asserts chroma on zone 0's Ultraviolet at deepest night, not on the shell's palette; unit mutants of `minCalls` for sim and streaming survive. Every R1 and R2 claim was reproduced: A1, A6 to A20 and A10 five in a row; 6 unit, 11 spec and 3 timing mutants, all caught but two `minCalls` survivors, each restored by sha256. Rulings: DI-68 on A6 is accepted, because "any comparison between two renders of one state" covers `distant` and `again`, and a frame one chunk off the period still reads 172,800 bytes. Shimmer's zero step at MSAA 2 is accepted on a corrected reading: it is a same-state compare, but its own .001 band mean allows about 201 one-level values a frame pair, above DI-58's 64 and above T05's worst D3D11 MSAA figure of 173 B, so the T00 owner should record it as DI-67's one exception. B10's liveness floor of 1 is accepted, since its mutant fails at 0. The shell host's loop and `?follow=1` are accepted, since every earlier shell number reproduced and a sim step under follow reads 281,849 and 286,063 bytes. The Vulkan print-only spec is accepted, and whether it skips on a machine without Vulkan stays the T00 owner's call.
- 2026-11-05T22:39Z Repair R3, by the T09 executor, after V2-T09 and the T00 owner's DI-71. Blocking: B12's held wait renders at an advancing tick for T08's panel throttle (`tests/forever/support/restore.ts`), shown failing and then passing on T08's real UI. Low: `refill` before every reference frame in `compareAt`, `sequence` and B12, shown on T05's real props; `stepToTick(1200)` before every shimmer measurement; B8's home from zone 12; the wash-out controls on Sunset Drive; `layerCount` and `callCountProblems` for B18; the travel comment. DI-71(2) plus the coordinator's SwiftShader item: the Vulkan print skips where the renderer is not hardware Vulkan, and B1's zero-skip row now excepts that skip, an acceptance change logged under DI-71. New finding, open: on the real layers `veil(.1)` reads chroma under 55 on any palette, so B11's veil control needs a reviewer's ruling. Sections 3, 4, 5, 7, 9, 10, 11, 13 and 14 updated. No threshold changed.
- 2026-11-05T22:45Z DI-72, by the T09 executor, after the T00 owner's ruling on R3's open veil row. The veil control is `veil(.05)` in A14 and B11, and in A14's controls-off check, under the forced Sunset Drive zone; no gate threshold moved. A14 passed on the shell, and the control failed with the veil removed (`blackP10` 15), restored by sha256. Sections 4, 5, 7, 9, 10, 11 and 13 updated.
- 2026-11-06T01:33Z Reopened by T10's first pass under the defect process, for D-003, D-004, D-005 and D-008 in `plans/T10-integrate.md` section 10, with the T00 owner's rulings DI-74, DI-76, DI-77 and DI-78. Status `in-progress`. Scope: B10's gated shimmer and A12's naive-grid control measured with props hidden, the all-layers figure printed ungated (DI-74, D-004, and D-002's B10 half); the veil control at `.06` with B11's pose fixed by `stepToTick` (DI-76, D-003); B19's stability line as three consecutive window medians within 5% of their mean (DI-77, D-005); B19's `other` class line at 512 B per frame (DI-78, D-008). Owned files and the shimmer baseline copied and hashed to the scratchpad `T09/backup-D` (`d-pre-edit.sha256`) before any change.
- 2026-11-06T02:13Z Repair D done, by the T09 executor. DI-74: A12 and B10 gate the floor with props hidden, all layers printed. DI-76: `veil(.06)`, every wash-out test at sim tick 1200, asserted. DI-77: `windowStability` in `metrics.ts`, with a unit control on unstable series. DI-78: `other` at 512 through `classLimitProblems` in `tests/perf/support/heap.ts`, with a control that fails the line on 1024 B counted as project code. Executor decisions beyond the rulings, both stricter or neutral, logged and not yet seen by a reviewer: a minimum of 5 window runs before DI-77's line may be met, because 5% alone ended warm-up early and broke A15's slope check; and soft assertions on B19's two measurement-validity lines, so neither can hide the §9.2 lines again. Each defect was shown failing before, through T10's regression and T09's own row, and each new row passed after, with 9 of 9 mutants caught and restored. New and open with the T00 owner: B19's windows control cannot hold 256 ± 16 on the app (section 10). Sections 4, 5, 7, 9, 10, 11, 13 and 14 updated. No threshold moved except by DI-74, DI-76, DI-77 and DI-78.
- 2026-11-06T03:51Z Reopened for the T00 owner's DI-84, which rules on repair D's open windows-control row. Status `in-progress`. Scope: on the app, B19's windows control interleaves probe-on and probe-off windows and requires a shift of 256 ± 64 B; the shell keeps its sequential control at ± 16; `MIN_WINDOW_RUNS = 5` and the soft assertions recorded as reviewed. Owned files and the shimmer baseline copied and hashed to the scratchpad `T09/backup-E` (`e-pre-edit.sha256`) before any change.
- 2026-11-06T04:05Z Repair E done, by the T09 executor. DI-84: on the app, B19's windows control is interleaved, `allocPairs(300, 10, 1/60, 256)`, held to 256 ± 64 by `probeShift`; the shell keeps the sequential form at 256 ± 16; both soft. `MIN_WINDOW_RUNS = 5` and the soft assertions recorded as reviewed and accepted by the T00 owner in DI-84. New units failed before and passed after, and 6 of 6 unit mutants were caught. On the app, a probe of 0 failed the interleaved form (+78.0), and B19 then passed in full, at +225.4. On the shell, A15 passed at 256.0. New and open with the T00 owner: in a diagnostic run, one real reading of +323.2, outside ± 64 (section 10). Sections 4, 5, 7, 9, 10, 11, 13 and 14 updated. No threshold moved except by DI-84.
- 2026-11-06T04:39Z Reopened for the T00 owner's DI-86(2), which rules on repair E's open +323.2 row. Status `in-progress`. Scope: on the app, B19's interleaved windows control uses `allocProbe(1024)`, accepted at 1024 ± 256 B; the shell keeps `allocProbe(256)` at ± 16. A probe of 0 must fail the app form, and at least 5 app readings of the real probe through the gate's own routine, over at least 2 page loads, are to be reported. DI-86(1) and (3) name T07 and T05, not T09. Owned files and the shimmer baseline copied and hashed to the scratchpad `T09/backup-F` (`f-pre-edit.sha256`, 58 files) before any change.
- 2026-11-06T04:52Z Repair F done, by the T09 executor. DI-86(2): on the app, B19's windows control is interleaved with `allocProbe(1024)`, `allocPairs(300, 10, 1/60, 1024)`, held to 1024 ± 256; the shell keeps `allocProbe(256)`, sequential, at 256 ± 16. The per-target table moved from the spec into `tests/perf/support/heap.ts` as `WINDOWS_CONTROL` and `windowsControlCheck`, so the unit suite tests the gate's own values. Its 4 new value rows failed on DI-84's values and passed on DI-86(2)'s. On the app a probe of 0 failed the form at -4.0 (F1), B19 passed in full at 1027.0, and 7 real readings over 3 page loads lay inside the line, the worst at 1208.4. On the shell, A15 passed at 256.0. Recorded for the T00 owner, no action asked: a margin of 71.6 B at one route position (section 10). Sections 3, 5, 7, 9, 10, 11, 13 and 14 updated. No threshold moved except by DI-86(2).
- 2026-11-06T10:19Z Reopened by the integrated review (VI-game, VI-r1, VI-gates), whose T09 items are VI-r1's defect 1 (ledger DI-93) and VI-gates' defect 5. Status `in-progress`. Scope: (1) DI-93: `renderAt`, and the core's `renderState` that every harness frame goes through, throw a `RangeError` unless the chunk is an integer in [0, CHUNK_LIMIT + 1024), as `warp` refuses past CHUNK_LIMIT; VI-r1's `compareAt` to chunk 2^49 + 5 hung the app's tab for over 20 s. New unit and spec rows. (2) B21 (`tests/perf/bundle.spec.ts`) skipped silently, with the stale reason `UNARMED: needs T10`, whenever `dist/` was absent, so run alone it exited 0 having measured nothing; it must build what it measures, or fail with a clear message, and never skip for a missing build. Owned files and the shimmer baseline copied and hashed to the scratchpad `T09/backup-G` (`g-pre-edit.sha256`, 58 files) before any change.
- 2026-11-06T10:59Z Repair G done, by the T09 executor, after the integrated review. DI-93: `renderAt` and the core's `renderState` throw a `RangeError` unless the chunk is an integer in [0, CHUNK_LIMIT + 1024), through `requireRenderChunk` in `api.ts`; `renderAt` checks before the loss check. New rows: five units in `api.test.ts`, B9b in `warp.spec.ts` on the app, and a range row in A6's guard test. On the old code 4 unit rows, B9b and A6 failed, B9b at the edge without making a call that could hang; 6 of 6 unit mutants and 2 of 2 whole-file mutants were caught. B21: `bundle.spec.ts` builds `index.html` into its own test output folder and measures that, and fails with a message without `index.html` or a good build; the old spec with no build exited 0 with `1 skipped`, and 3 of 3 mutants of the new one were caught. Reruns: `tests/forever --project=gpu` 42 passed, 0 skipped; `tests/perf --project=software` 2 passed; `check:task T09 PASS`; `plans:check` 0 problems. Decisions beyond the rulings, logged and not yet seen by a reviewer: the chunk alone is checked and `stepFrames` is not guarded; B9b's warm-up frame, edge-first order and 15 s race; B21 builds into its own folder rather than `dist/`. New observation for the T00 owner: the first harness frame after a browser launch takes about 5 s on the app (section 10). Sections 4, 5, 7, 8, 9, 10, 11, 13 and 14 updated. No threshold moved.
