---
id: T06-post-quality
title: Post stack and quality - composer, variants, Crt, speed lines, tier table, governor
status: done
owner: T06 executor
depends_on: [T00]
owns: [src/render/fx/**, dev/fx.html, tests/visual/fx.spec.ts, tests/unit/fx/**, plans/T06-post-quality.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/testing/**, tests/support/**, plans/T00-foundation.md, plans/T02-sim-feel.md]
updated: 2026-11-05T22:58Z
---

## 1. Purpose

After T06, whatever the scene layers draw reaches the canvas looking like neon on a dark CRT, at every quality tier, without a stall from a shader compile. Observable outcomes:

1. A frame through the stack keeps deep colour: thin neon lines glow, the sky and surfaces do not, and a viewer sees scanlines and fine grain only when looking for them. On T06's test card, near-white is under 0.5% of pixels, mean chroma over 55, and bloom's haze lift stays near its measured baseline (§6.7).
2. Every pixel of the canvas has alpha 255 in all four variants and at every MSAA level, even when the scene writes alpha 0.25. The page behind the canvas never shows through.
3. Zero `gl.linkProgram` calls happen after boot, across every variant and tier change, including after a context restore.
4. Speed lines streak toward the vanishing point, thicken in number with `feel.speedLines`, respect depth, never cross the sun, and stay continuous at any travel distance because they derive from `uTravel`.
5. The tier table of §6.10 exists as data, and a pure governor picks and changes tiers by the rules in §6.10. It is proven with synthetic frame series, including the display-limit hold, the slow upshift, the 5 s rate limit and the 5 minute lockout.
6. Scanlines keep an integer period at DPR 1, 1.25, 1.5 and 2 with no visible moire, answering the open half of §14 row 11.

## 2. Context and orientation

Working directory for every command: `C:\highsierralabs\terrain`. It is not a git repository. `§n` means a section of `architecture.md`. T06 starts only after T00 is `done`, and runs in parallel with T01 to T09, so sibling files may be half-written. T06 never imports them, and uses `npm run check:task -- T06`, port 5106 and `--output=test-results/T06`.

Terms:

- **Variant:** one prebuilt `EffectPass`, named `full`, `noCa`, `min` or `bare` (§6.6). Exactly one is enabled at a time.
- **Tier:** one row of §6.10. `QualityProfile` in `src/contracts/index.ts` is its type.
- **Governor:** the pure state machine that turns rAF deltas into tier changes.
- **Card:** T06's own test scene, `src/render/fx/dev/testCard.ts`. It exists so the post stack has known inputs while the real sky, terrain and props are being written by siblings. Tune the stack against it. Do not polish the card itself.
- **REF frame:** `frameAt(0, { at: { chunk: 1, local: 12.5 }, tick: 0, palette: p, bend: { a: 0, c: 0 } })` on `window.__shell`.
- **Link count:** calls to `gl.linkProgram`, counted by a spy on `WebGL2RenderingContext.prototype`. `renderer.info.programs.length` is not a compile detector; see section 10.
- **Code value:** one step of the final 8-bit channel, 0 to 255.
- **Near-white:** `min(r, g, b) > 235` on the final 8-bit pixel. **Mean chroma:** mean of `max(r, g, b) - min(r, g, b)` over all pixels. These are the definitions the prototype's 70.9 and 0.003% were measured with [O: `window.__stats` in the art prototype's `index.html`].
- **Haze lift:** mean Rec.709 luma of the final 8-bit frame minus the same for the same frame at `bloomGain = 0`, in code values, per §8.1's comment above `HarnessApi`. §6.7 gates it because near-white and chroma pass a visibly flooded frame (DI-01); see section 10.

**Where the evidence comes from.** Every `[O]` below was run on 2026-11-05 in a throwaway page in the session scratchpad, with the pinned `three`, `postprocessing` and Chromium 1234, on the RTX 4070 SUPER and SwiftShader, using §8.2's GLSL. The page used a stack and card like the ones specified here. It is not project code and may be gone, so none of it counts as acceptance, and the executor runs everything again. `[A]` is an untested starting value. Numbers measured on the card describe the card, not the finished game; T11 owns the real-scene gates.

## 3. Scope

**Owned, and the complete file list:**

| Path | Contents | three? |
|---|---|---|
| `src/render/fx/index.ts` | Exports exactly `createPost`, `createGovernor`, `createFxLayer` (§8.1) | yes |
| `src/render/fx/quality.ts` | `TIERS`, `pixelRatioFor`, `scanPeriodFor`, `scanAmpFor` | no, pure |
| `src/render/fx/governor.ts` | `createGovernorImpl`, `bootTier`, constants | no, pure |
| `src/render/fx/postParams.ts` | `PostParams`, `createPostParams`, `computePostParams`, constants | no, pure |
| `src/render/fx/speedLineParams.ts` | `writeLineSeeds`, `lineLength`, `LINE_CAPACITY`, `LINE_PERIOD` | no, pure |
| `src/render/fx/asyncGuard.ts` | `withTimeout` | no, pure |
| `src/render/fx/crt.ts`, `crt.frag.glsl` | `CrtEffect` | yes |
| `src/render/fx/post.ts` | `createPostStack(o?)`, `PostOptions`, `PostDebug`, the `freezeTime` helper | yes |
| `src/render/fx/speedLines.ts`, `speedLines.vert.glsl`, `speedLines.frag.glsl` | `createSpeedLinesLayer(o?)` | yes |
| `src/render/fx/dev/metrics.ts` | `washout`, `hazeLift`, `byteDiff`, `rowMeans`, `spectrum`, `maxRowStep` | no, pure |
| `src/render/fx/dev/testCard.ts` | `createTestCard(q)` | yes |
| `src/render/fx/dev/fxDev.ts` | `createFxDev(q)`, `window.__fx`, link spy, PNG decode | yes |
| `dev/fx.html` | Dev page, a few inline lines | |
| `tests/visual/fx.spec.ts` | All browser tests, named `M2 ...` to `M7 ...` so `-g` selects a milestone | |
| `tests/unit/fx/` | `quality`, `governor`, `postParams`, `speedLineParams`, `asyncGuard`, `metrics`, `crtSource`, `isolation`, `.test.ts` | |
| `plans/T06-post-quality.md` | This plan | |

`index.ts` and `post.ts` must never import `dev/`, so nothing under `dev/` reaches a production bundle. `isolation.test.ts` enforces it.

**Read-only:** `architecture.md`, `Agents.md`, `src/contracts/**`, `src/core/**`, `src/testing/**`, `tests/support/**`, other plans.

**Non-goals:**

- No sky, terrain, props, ship or nebula. The density and terrain-stride ramps of §6.10 live in T05 and T03, inside their own `setQuality` and `frame`.
- No frame loop, boot timing, renderer creation, canvas or `ResizeObserver`. Those are T10's, and the dev shell's until then. T06 consumes `RenderContext`.
- No `window.__mv`. T09 calls `forceVariant` and `forceMsaa`.
- No palette values. A palette that fails a gate is reported, not fixed (section 10 has the Arctic Laser case, closed by DI-02).
- No final numeric sign-off of the look across zones. T11 does that on the real scene with the operator.

## 4. Interfaces

**Consumed, from `src/contracts/index.ts`:** `PostStack`, `CreatePost`, `Governor`, `CreateGovernor`, `RenderLayer`, `CreateLayer`, `RenderContext`, `FrameView`, `FeelState`, `QualityProfile`, `Tier`, `PostVariant`, `RenderOrder`, `LayerName`, `DebugMode`, `SPEED_FLOOR` and `SPEED_MAX`. From `src/contracts/glsl.ts`: `COMMON_VERT`, `COMMON_FRAG`. From `src/core/hash.ts`: `hash01`.

**Consumed from T00 for testing only (dev page and specs, per T00 section 4):** `startDevShell(layers, post, o)`, `window.__shell` (`frameAt`, `pixels`, `stats`, `ctx`, `setManual`), `scriptedFrame`, `fakeProfile`, and `test`, `expect`, `openDevPage`, `saveShot` from `tests/support/pw.ts`.

**Provided, public:** only the three factories, typed with the contract's own aliases:

```ts
export const createPost: CreatePost = () => createPostStack();
export const createGovernor: CreateGovernor = (o) => createGovernorImpl(o);
export const createFxLayer: CreateLayer = () => createSpeedLinesLayer();
```

**Internal, specified so the milestones can be checked separately:**

```ts
// quality.ts
export const TIERS: readonly Readonly<QualityProfile>[];              // index = tier, Object.freeze on each row
export function pixelRatioFor(q: Readonly<QualityProfile>, cssW: number, cssH: number, dpr: number): number;
export function scanPeriodFor(pixelRatio: number): number;            // Math.max(2, Math.round(3 * pixelRatio))
export function scanAmpFor(period: number): number;                   // SCAN * (1/3) / (dark / period), dark = Math.floor(period / 3 + .5)

// postParams.ts
export interface PostParams {
  caX: number; caY: number; bloomIntensity: number; exposure: number;
  scan: number; scanPeriod: number; grain: number; grainFrame: number;
  flash: number; flashR: number; flashG: number; flashB: number; glitch: number;
}
export function createPostParams(): PostParams;
export function computePostParams(v: Readonly<FrameView>, variant: PostVariant, pixelRatio: number, gainMax: number, out: PostParams): void;

// post.ts. Every option below is a dev-only negative control. createPost() passes none.
export interface PostOptions {
  bindTarget?: boolean;      // false: compile with no target bound
  renderVariants?: boolean;  // false: precompile renders only the active variant
  keepAlive?: boolean;       // false: no keep-alive blur pass
  crtAlpha?: 'one' | 'keep'; // 'keep': Crt writes inputColor.a
  dithering?: boolean;       // false: no dithering on the passes
  gainMax?: number;          // replaces BLOOM_GAIN_MAX
  flashWhite?: boolean;      // flash colour is white at luma .18
  scanPeriod?: number;       // replaces scanPeriodFor, for the moire control and the look comparison
}
export interface PostDebug {
  composer: EffectComposer; variants: Record<PostVariant, EffectPass>;
  bloom: BloomEffect; ca: ChromaticAberrationEffect; tone: ToneMappingEffect; vignette: VignetteEffect; crt: CrtEffect;
  readonly activeVariant: PostVariant | 'off'; readonly pixelRatio: number;
}
export function createPostStack(o?: PostOptions): PostStack & { readonly debug: PostDebug };
```

**Seams.** Places where another task must assume the same meaning and the types do not settle it.

| Other task | Topic | T06's assumption |
|---|---|---|
| T02 | Feel ranges | As T02's section 4 table. `aberration` in `[0, 1]`: `offset = mix(low, high, aberration)`. `flash` in `[0, 0.6]`. `speedLines` in `[0, 1]`, the fraction of instanced lines shown, about 0.125 at cruise. `bloomGain` in `[1, 1.25]`. `glitch` in `[0, 1]`, held at 0.35 for 3 s during `SIGNAL_LOST`. T06 clamps `bloomGain` to `[0, 1.5]` as a last defence, and otherwise trusts the values |
| T02 | Reduced motion | Gating lives in feel: under `reducedMotion`, feel writes 0 for `flash`, `speedLines`, `aberration` and `glitch`, and 1 for `bloomGain`. T06 adds only what feel cannot express: CA offset exactly 0, and grain 0, when `v.reducedMotion`. Scan stays on |
| T02, T10, T09 | `v.tick` | Integer-valued, never reset. `grainFrame = floor((tick % 7680) / 5)`, so grain steps at 24 Hz and repeats every 64 s. Grain is a pure function of `tick`, so `renderState` at equal `tick` gives equal grain |
| T09 | Identity and shimmer | Identity runs compare frames at equal `tick`. Shimmer with post on should step `local` with `tick` fixed, or the metric also measures grain changing (flat 0.2 grey: std 1.4 code values per frame [O]). A repeated identical frame may still differ by a few bytes by 1 (T00 section 10); T06 does not claim otherwise |
| T09 | Compile detection | `renderer.info.programs.length` stayed at 8 while 12 links happened [O]. Any "no mid-game compile" gate must spy on `linkProgram`. T06 exposes nothing extra for this; the spy is three lines |
| T09, T03 | `forceVariant('off')` | `render(dt)` sets `renderer.autoClear = true`, draws scene to the canvas, then sets it back to `false` in the same call. So `autoClear` reads `false` between frames. A harness that needs a magenta clear sets the clear colour itself and restores it. Effect params are still computed but unused |
| T09 | Forces | `forceVariant(v)` and `forceMsaa(n)` survive `setQuality`, take effect at the next `frame` or `render`, and `null` returns to the profile. `forceVariant('min')` has scan and grain 0, since they follow the active variant, not the tier |
| T10, T00 | Lifecycle | As T00's seam: layers `attach`, `setQuality`, then `post.attach`, `post.setQuality`, `post.resize`, `await post.precompile()`, then layer `rebuild`. All meshes exist before `precompile`. T06 uses `ctx.scene` and `ctx.camera` as given and never replaces them |
| T10, T00 | Deferred application | `setQuality` and `resize` only record. Bloom levels, MSAA, variant, pixel ratio and sizes apply at the start of the next `frame`, `render` or `precompile`. That is always before drawing, coalesces several resizes in a frame, and never touches GL during a context loss (section 11). So T10's step 15 only needs `layer.setQuality(q); post.setQuality(q)`, and a redundant `post.resize` is free. Reads of canvas size straight after either call see the old size |
| T10, T00 | What post does not own | `renderer.info.reset()`, `info.autoReset`, `debug.onShaderError`, renderer flags, and `camera.aspect` with `updateProjectionMatrix` all belong to the frame owner. `post.resize` touches only pixel ratio, renderer size and composer size. T06 sets `renderer.toneMappingExposure` each `frame`; nothing else may |
| T10 | Boot profile | To time 30 frames at tier 3 before the real governor exists: `createGovernor({ software: false, bootP95Ms: 0, forced: 3 }).profile`. Then build the real one with the measured p95 in ms. Software path: `{ software: true, bootP95Ms: 0, forced: null }`, no timing. `bootP95Ms` that is not finite or not above 0 means "no measurement": boot tier 3, and the display-limit hold never applies |
| T10 | Feeding the governor | One `sample(rawDt * 1000)` per rAF, unclamped, from step 2. A non-null return means read `governor.profile` and apply at step 15. T10 does not need its own rate limit. Deltas of 1000 ms or more are ignored as stalls. `runFrame` and `renderState` send `sample(0)` |
| T10, T09 | Restore | After `webglcontextrestored`: layers `rebuild`, `post.rebuild()`, `await post.precompile()`. `precompile` must run again, or the first tier change after a restore links 4 programs [O]. A warp calls only `post.rebuild()`, which allocates nothing and does no GL work |
| T10 | Lost context | `precompile` is only called with a live context. It has a 10 s guard, resolving with a `console.warn`, because `compileAsync` can poll forever on a program that never reports ready [I: `WebGLProgram.js:956`, `WebGLRenderer.js:1535`] |
| T08 | Quality menu | `setQuality(t)` means `governor.force(t)`, `'auto'` means `force('auto')`, and `v.quality.tier` is what the menu shows, as T08 states. `force` updates `profile` at once; the next `sample` returns the tier once, so T10 applies every change in one place. `force('auto')` keeps the current tier, except on `software`, which returns to 0 |
| T03, T05, T04 | Emission | All light goes through `emit(c, L)` with `L` from §6.7. Scene output is linear HDR with no tone mapping or dithering of its own. Scene alpha never reaches the canvas, because Crt overwrites it |
| T03, T05 | Program keys | Nothing adds a mesh or flips a program-key flag (`transparent`, `side`) after `precompile`. Hidden meshes are compiled, since `compile` walks `scene.traverse` [O: Agents.md] |
| T03, T05 | Ramps and call rate | `setQuality` is a request, called from T10's step 15, outside rendering. A density or stride ramp runs in the layer's own `frame`. Automatic changes are at least 5 s apart, and the governor does not wait for a ramp. `force` from T08's menu has no rate limit, so a ramp must accept a new request at any moment |
| T04 | Materials outside the scene | `post.precompile` compiles only `ctx.scene`. The nebula's fullscreen material is T04's to compile before first use, at any tier, which T04 does in `rebuild` per its own seam. After a restore that order still holds: layers `rebuild`, then `post.precompile` |
| T04, T01 | `dayPhase` | A sawtooth in `[0, 1)`, 0 being deepest night (§8.1). Only `cos(TAU * dayPhase)` is used, so the wrap cannot pop. T06 applies §5.4's exposure as `renderer.toneMappingExposure = 1 - .12 * (.5 + .5 * cos(TAU * dayPhase))`, so .88 at phase 0 and 1 at phase .5 [A]. T04 applies day phase only to stars, nebula, aurora and meteors, and leaves `skyGrad` alone. §5.4 no longer lists sky saturation (DI-03) |
| T01 | Palette layout | `zone.palette` holds 21 linear floats in §8.1's order. Flash colour reads the grid colour at offsets 15 to 17 (T11 r09, ledger 8; it read the accent at 18 to 20 before, DI-105). Speed lines read `uPal[5]` and `uPal[6]` |
| T00 | `fakeProfile` | Equal field by field to `TIERS`, including tier 0 `dprCap` 1, `nebulaWidth` 384, 384, 192, 0, 0 and `bloomLevels` 0 at tier 0. `quality.test.ts` compares them. A mismatch is reported to T00, since the shell calls `post.setQuality(fakeProfile(t))` |
| T00 | Shell behaviour | `frameAt` calls layer `frame`, `post.frame`, `post.render` in that order. `?post=off` means `post.forceVariant('off')`. `?tier=` selects the initial profile |
| T09, T11 | Metric definitions | Near-white, mean chroma and haze lift per §8.1's comment above `HarnessApi`, with limits in §6.7 |

## 5. Plan of work

Milestones run in order. Each can be verified alone.

### M0. Pre-flight

**Goal:** the foundation is what this plan assumes. **Work:** confirm T00 is `done`, `npm run contracts:check` exits 0, and `startDevShell`, `tests/support/pw.ts` and `src/core/hash.ts` exist. Section 12's requests are in §8. If `frameAt` lacks the `feel` or `reducedMotion` overrides §8.1 gives it, report a T00 defect and set `blocked`. **Result:** go or blocked. **Proof:** A0.

### M1. Pure core

**Goal:** the table, the governor and all parameter arithmetic, proven with no browser. **Work:**

`quality.ts`, with §6.10's exact pixel counts:

| Tier | dprCap | maxPixels | msaa | mirror | post | bloomLevels | nebulaWidth | propDensity | terrainStride | speedLines |
|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 2 | 3686400 | 4 | true | full | 7 | 384 | 1 | 1 | 96 |
| 3 | 1.5 | 2073600 | 2 | true | full | 6 | 384 | 1 | 1 | 64 |
| 2 | 1 | 1440000 | 0 | false | noCa | 5 | 192 | .7 | 1 | 32 |
| 1 | .75 | 921600 | 0 | false | min | 3 | 0 | .4 | 2 | 0 |
| 0 | 1 | 230400 | 0 | false | bare | 0 | 0 | .08 | 2 | 0 |

`pixelRatioFor` is §6.10's formula, returning a value whose `floor(cssW * r) * floor(cssH * r)` is within `maxPixels`. Tier 0 is the 640x360 pixel budget with `dprCap` 1.

`governor.ts` imports only `quality.ts` and contract types. No `Date`, `performance` or `Math.random`. Its only clock is the sum of `frameMs`. Constants, all [A] unless §6.10 gives them:

| Name | Value | Source |
|---|---|---|
| `WINDOW_MS` | 2000 | §6.10 "over 2 s" |
| `SETTLE_MS` | 3000 | With the window this makes the 5 s rate of §6.10 structural |
| `MIN_WINDOW_SAMPLES` | 5 | A 2 s window of 400 ms frames still decides |
| `STALL_MS` | 1000 | Longer deltas are stalls, not load |
| `DOWN_P95_MS`, `UP_P95_MS` | 20, 17.5 | §6.10 |
| `UP_CHAIN_MS` | 60000 | §6.10 |
| `STEADY_SPREAD_MS` | 2 | `p95 - p50` at or under this counts as "steady" |
| `TIER0_ENTRY_P95_MS` | 50 | Below tier 1 only when under 20 fps, §9.2's tier 0 budget |
| `REVERSAL_MS`, `LOCKOUT_MS` | 30000, 300000 | §6.10 "5 minutes"; "reversed" means a downshift within 30 s of the upshift into that tier |
| `HIST_BIN_MS`, `HIST_BINS` | 0.25, 512 | Bin `i` holds `(i-1) * .25 < ms <= i * .25`, top bin is overflow. Reports the bin's upper edge, so 17.5 and 20.0 sit exactly on the thresholds. No sort and no allocation, at any refresh rate |

State machine, rehearsed as a prototype [O: series in A3]:

```text
create: tier = forced ?? (software ? 0 : bootTier(bootP95Ms)); pinned = forced !== null; settle = SETTLE_MS
bootTier(p): not finite or p <= 0 -> 3; p < 2 -> 4; p < 14 -> 3; p < 28 -> 2; else 1
sample(ms):
  clock += ms
  if pending !== null: return it once, clear it
  if ms <= 0: return null
  if pinned or software: return null
  if ms >= STALL_MS: chain = 0; clear window; return null
  if settle > 0: settle -= ms; return null
  add ms to histogram; winMs += ms; winN += 1
  if winMs < WINDOW_MS or winN < MIN_WINDOW_SAMPLES: return null
  p50, p95 from histogram; span = winMs; clear window
  if p95 > DOWN_P95_MS:
    chain = 0
    if p95 - p50 <= STEADY_SPREAD_MS and boot < p95 / 2: return null        // display or power limit, §6.10
    if tier > 1 or (tier == 1 and p95 > TIER0_ENTRY_P95_MS): return change(tier - 1)
    return null
  if p95 <= UP_P95_MS: chain += span else chain = 0
  if chain >= UP_CHAIN_MS and tier < 4 and lockUntil[tier + 1] <= clock: return change(tier + 1)
  return null
change(next):
  if next < tier and lastUpTo == tier and clock - lastUpAt <= REVERSAL_MS: lockUntil[tier] = clock + LOCKOUT_MS
  if next > tier: lastUpAt = clock; lastUpTo = next
  tier = next; settle = SETTLE_MS; chain = 0; clear window; return tier
force(t):
  t === 'auto': pinned = false; re-arm settle, chain, window; if software and tier != 0: tier = 0, pending = 0
  otherwise: pinned = true; if t != tier: tier = t, pending = t; re-arm settle, chain, window
profile: TIERS[tier]
```

`boot` is `bootP95Ms` if finite and above 0, otherwise `Infinity`, so a missing measurement never triggers the hold.

`postParams.ts`, pure, no allocation, values from §6.6 unless marked:

| Field | Rule |
|---|---|
| `caX`, `caY` | `v.reducedMotion` or variant not `full`: 0, 0. Otherwise `mix(.0006, .0014, a)`, `mix(.0003, .0007, a)`, `a` = `feel.aberration` clamped to `[0, 1]` |
| `bloomIntensity` | `.8 * clamp(feel.bloomGain, 0, gainMax)`, `BLOOM_GAIN_MAX = 1.5` [A] |
| `exposure` | Section 4's `dayPhase` curve [A] |
| `scanPeriod`, `scan` | `scanPeriodFor(pixelRatio)`, `scanAmpFor(period)` with `SCAN = .10` for `full` and `noCa`. `scan = 0` for `min` and `bare` |
| `grain` | `.07` for `full` and `noCa`. 0 under `reducedMotion`, and for `min` and `bare` |
| `grainFrame` | `Math.floor((v.tick % 7680) / 5)`, an integer below 1536. 7680 is phase 6's period, so this is a harmonic of an existing phase |
| `flash` | `feel.flash` |
| `flashR/G/B` | Palette grid colour (offsets 15 to 17; the accent, 18 to 20, before T11 r09, DI-105) scaled to luma `FLASH_LUMA = .2` [O: at T02's cap of .6 this adds luma .12, the value measured in A17]. Guard luma below 1e-3 |
| `glitch` | `feel.glitch` |

`speedLineParams.ts`: `LINE_CAPACITY = 96`, `LINE_PERIOD = 256`, which divides `WORLD_PERIOD` (§4.3). `writeLineSeeds(out)` fills 4 floats per line from `hash01(1985, 0, i, k)`, `k` 0 to 3. `lineLength(speed) = 8 + 32 * sat((speed - SPEED_FLOOR) / (SPEED_MAX - SPEED_FLOOR))` [A].

`asyncGuard.ts`: `withTimeout(p, ms, onTimeout)` resolves when `p` does, or after `ms` calling `onTimeout`, clearing its timer.

`dev/metrics.ts`: pure functions over `Uint8Array`, so the page and Node run the same code. `spectrum(rows)` is a plain DFT returning the top `{ period, amp }` and the largest amplitude among periods above 1.8 times the top period.

**Result:** `tests/unit/fx` passes without a browser. **Proof:** A1 to A6.

### M2. Crt, the stack and the card

**Goal:** a real frame through all four variants, seen with eyes. **Work:**

`crt.frag.glsl`, starting text [O: compiled on D3D11 and SwiftShader, measured in section 10, with the scan amplitude supplied by `scanAmpFor`]. It defines only `mainImage`, and the string `mainUv` must not appear, even in a comment, or the pass cannot merge with CA (`Agents.md`):

```glsl
uniform float uScan;        // darkening of a dark row; 0 is off
uniform float uScanPeriod;  // integer >= 2, drawing-buffer pixels
uniform float uGrain;       // 0 is off
uniform float uGrainFrame;  // integer below 1536
uniform float uFlash;       // 0 to .6
uniform vec3  uFlashColor;  // the palette grid colour (T11 r09) at luma .2, linear
uniform float uGlitch;      // 0 to 1
uint crtHash(uint x, uint y, uint z) {
  uint v = x * 1597334677u ^ y * 3812015801u ^ z * 2798796415u;
  v = (v ^ (v >> 16u)) * 2246822519u; v = (v ^ (v >> 13u)) * 3266489917u; return v ^ (v >> 16u);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  uint px = uint(gl_FragCoord.x), py = uint(gl_FragCoord.y), fr = uint(uGrainFrame);
  if (uGlitch > 0.) { float f = float(crtHash(py / 12u, fr, 7u) >> 8u) / 16777216.; c = mix(c, c.brg, uGlitch * step(.72, f)); }
  c += uFlashColor * uFlash;
  if (uScan > 0.) { float s = mod(floor(gl_FragCoord.y), uScanPeriod); float dark = floor(uScanPeriod / 3. + .5); c *= 1. - uScan * step(uScanPeriod - dark - .5, s); }
  if (uGrain > 0.) { float g = float(crtHash(px, py, fr) >> 8u) / 16777216. - .5; c += c * g * uGrain + g * uGrain * .05; }
  outputColor = vec4(max(c, vec3(0.)), 1.);
}
```

The `max` is load-bearing: three's `sRGBTransferOETF` is `mix(pow(rgb, ...), rgb * 12.92, vec3(lessThanEqual(...)))`, which evaluates `pow` of a negative value, undefined in GLSL, and a NaN survives a float `mix` [I: `colorspace_pars_fragment.glsl.js:12`; the art prototype had no `max`, and was fine on the RTX].

The grain formula is the art prototype's, `c += c * g * .07 + g * .0035`, so it is mostly multiplicative and does not lift black [O: flat black gives mean 1.4, max 6 code values].

`CrtEffect` extends `Effect` with `blendFunction: BlendFunction.SRC` and a `Map` of `Uniform`s, holding direct references to them so `frame` does no Map lookups. Use `Vector3` for the colour, since `Color` setters may convert (`Agents.md`). One instance is shared by all four variants, as Bloom, Tone and Vignette are, and `computePostParams` zeroes scan and grain for `min` and `bare`.

`post.ts`, `attach(ctx)`:

```ts
composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
composer.autoRenderToScreen = false;
composer.addPass(new RenderPass(scene, camera));
// one instance each, shared:
ca = new ChromaticAberrationEffect({ offset: new Vector2(.0006, .0003), radialModulation: true, modulationOffset: .35 });
bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: .95, luminanceSmoothing: .25, intensity: .8, radius: .68, levels: 6 });
tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
crt = new CrtEffect(o.crtAlpha);
vignette = new VignetteEffect({ offset: .3, darkness: .55 });
// variants: full(ca, bloom, tone, crt, vignette), noCa(bloom, tone, crt, vignette),
//           min(bloom, tone, crt, vignette), bare(tone, crt)
// each: freezeTime(pass), pass.dithering = true, pass.renderToScreen = true, pass.enabled = false, composer.addPass(pass)
```

This whole shape compiled under §8.3 with zero diagnostics, with `timeScale` as the only cast [O]. `freezeTime` is the single sanctioned cast helper (`Agents.md`).

`flushPending()` runs at the start of `frame`, `render` and `precompile`: apply bloom levels when `bloomLevels > 0` and different (a `bare` profile leaves them alone), `composer.multisampling`, the enabled variant from force or profile, then pixel ratio and size if they differ from what is applied: `renderer.setPixelRatio(r); renderer.setSize(w, h); composer.setSize(w, h)`. `resize` ignores sizes under 1 px.

`frame(v)`: `flushPending`, `computePostParams`, then write `ca.offset.set`, `bloom.intensity`, Crt uniforms, `renderer.toneMappingExposure`. No allocation.

`render(dt)`: `flushPending`. Off path per section 4, otherwise `composer.render(dt)`.

`rebuild()`: `renderer.autoClear = false`, then mark pending so the next flush re-asserts state. `dispose()`: `composer.dispose()` plus the keep-alive pass. Shared effects are disposed more than once, which did not throw [O].

`dev/testCard.ts`, a `RenderLayer` named `sky` driven by the query string. Its numbers in this plan are only comparable if it is built exactly like this. A fullscreen triangle at `RenderOrder.SKY`, no depth test, ray from `inverse(projectionMatrix)` and `inverse(viewMatrix)` as in T00's `trivialLayer`:

```glsl
vec3 rd = normalize(vRay);
vec3 c = skyGrad(rd.y); vec4 s = sunDisc(rd, 1.); c = c * (1. - s.a) + s.rgb;
float d = 7. / max(-rd.y, 1e-4); vec2 uv = rd.xz * d / 8.; uv.y += uTravel.x / 8.;
float g = pristineGrid(uv, vec2(.03)); float f = fogK(d);
vec3 fl = mix(mix(uPal[0] * .16, uPal[1] * .2, .3) + emit(uPal[5], 1.45) * g * (1. - .72 * f), skyGrad(0.), f);
c = rd.y < 0. ? fl : c;
gl_FragColor = vec4(c * uOver, uAlpha);
```

`pristineGrid` stays outside any branch. `Agents.md` now bans only an early exit above derivative code, so this is not required, and it stays because it changed 0 bytes (DI-51). The probe's `if (rd.y < 0.)` form gave the same bytes as this one [O: 0 differing in `bare`, palettes 0 and 3, D3D11 and SwiftShader], so the [O] numbers in this plan still describe this card.


Plus 400 instanced depth-writing neon sticks at `RenderOrder.PROP`: Lehmer PRNG seed 1 (`s = s * 16807 % 2147483647`), side alternating, `x = side * (30 + 260r)`, `z = -(20 + 1800r)`, height `4 + 60r`, half-width `.08 + .0012 * dist`, colour `step(.5, t)` between `uPal[5]` and `uPal[6]`, `L = mix(1.4, 2.4, fract(7t))`, through `bendV` then `projectionMatrix * viewMatrix`.

| Query | Effect |
|---|---|
| `card=scene` (default) | As above |
| `card=flat&v=0.2` | `gl_FragColor = vec4(vec3(v), 1.)`, sticks hidden |
| `card=hue` | Black, with bars at buffer x 480 and 1440 (half-width 40), y 540 (half-height 300), of `emit(uPal[4], 1.4)` and `emit(uPal[6], 1.4)`. Sticks hidden. `&equal=1`: `uPal[4] * 2.` and `uPal[6] * 2.` |
| `card=surfaces` | `skyGrad` above the horizon, the floor's base colour below, no disc, grid or sticks |
| `over=<n>`, `alpha=<a>` | The `uOver` and `uAlpha` above. `over` also scales sticks |
| `wall=1` | A depth-writing dark quad over the left half of the view, at z = -6 |
| `hidden=1` | One extra mesh with its own material, `visible = false` at `precompile`. `__fx.showHidden()` shows it |

`dev/fxDev.ts`: `createFxDev(q)` installs the link spy, builds the card, the speed lines layer and `createPostStack(options from q)`, and sets `window.__fx`. The query maps to options as `bindtarget=0`, `rendervariants=0`, `keepalive=0`, `crtalpha=keep`, `dither=0`, `gainmax=<n>`, `flashwhite=1`, `scanperiod=<n>`, `lineperiod=<n>`; `governor=1` with `bootp95=<ms>` adds M7's loop. `__fx` offers `post`, `debug`, `fx`, `TIERS`, `metrics`, `links()`, `setTier(t)` (real table, on post and the fx layer), `showHidden()`, `compositeTo(w, h)` and `decodePng(b64)`. It cannot import `src/testing` (lint), so `dev/fx.html` does the wiring in its few inline lines:

```html
<script type="module">
  import { startDevShell } from '/src/testing/devShell.ts';
  import { createFxDev } from '/src/render/fx/dev/fxDev.ts';
  const d = createFxDev(new URLSearchParams(location.search));
  startDevShell(d.layers, d.post, d.shellOptions);
</script>
```

**Visual iteration.** Run `M2 picture`. Open the PNG with the Read tool and write what you saw into Progress. The reference [O], the same card and stack: deep purple top falling through magenta to a hot pink horizon, a yellow-to-pink sun with thin dark bands low on the disc, bright magenta grid converging without moire, neon sticks with a tight glow, a soft dark vignette, scanlines visible only up close. If it does not look like that, stop and fix the stack before measuring anything.

**Result:** frames render. **Proof:** A7 to A10.

### M3. Precompile

**Goal:** no compile after boot. **Work:** `precompile()`:

```ts
flushPending();
if (o.bindTarget !== false) renderer.setRenderTarget(composer.inputBuffer);
const compiled = renderer.compileAsync(scene, camera);   // compile() runs synchronously inside this call
renderer.setRenderTarget(null);                          // do not hold the binding across the await
await withTimeout(compiled, 10_000, warn);
for (each variant, the active one last) { enable only it; composer.render(0); }
renderKeepAlive();                                       // see below; draws to its own target
renderer.setRenderTarget(null);
```

The active variant goes last in one task, so only it is ever presented. `Agents.md`'s snippet resets the target after the `await`. Releasing it before gives the same result [O: 2 scene links at compile, none again at render], and leaves no window for anything else to draw into the wrong target.

**Keep-alive.** The `levels` setter calls `MipmapBlurPass.dispose()`, whose `Pass.dispose` disposes the two blur materials, so three frees their programs and the next render links them again: 2 links per level change, 12 over a tier cycle, invisible in `info.programs.length` [O]. T06 holds one extra `MipmapBlurPass` with `levels = 2`, `initialize(renderer, true, HalfFloatType)`, `setSize(4, 4)`, never disposed before `post.dispose`. Rendering it once keeps both programs alive through their cache key, and the tier cycle then links 0 [O]. It must be rendered in every `precompile`, because a restore empties the program cache [O: 4 links without, 0 with]. Its 3 draws at 4x4, two down and one up [O], happen only at boot and restore.

**Result:** link count is flat after boot. **Proof:** A11 to A13.

### M4. Photometric budget

**Goal:** wash-out is a measured property with detectors shown to fail. **Work:** implement the tests in A14 to A19 on the card. Tune only if a gate fails or the picture looks wrong, and only §6.6's starting values, each change in the Decision log. Never move a threshold to get a pass without a Decision log entry and the reviewer (`Agents.md`).

**Visual iteration.** Save and open: the six palettes, REF frame, tier 3. The peak feel frame `aberration 1, bloomGain 1.25`. The hit frame `flash .6, glitch 1`, and `glitch .35`. A 1:1 crop of dark sky (`page.screenshot({ clip })`) to judge grain and banding. The negative `gainmax=9` flood, so the executor knows what failing looks like. Write one sentence per image into Progress. Reject on: a sun that reads as flat white, glow filling grid cells, grain visible at normal viewing distance, a flash that turns the frame grey, glitch that looks like a broken driver instead of a hit. The first glitch shot [O, `.35`] read as a CRT signal fault, in bands of 12 to 36 px, but `c.brg` turned the sky a muddy olive; since T02 holds `.35` for 3 s during `SIGNAL_LOST`, expect to tune this.

Knobs, in order of preference: Crt amplitudes, `FLASH_LUMA`, `BLOOM_GAIN_MAX`, bloom `radius`, bloom `intensity`. Keep `luminanceThreshold` below the disc's L of 1.05, so the disc keeps a little bloom as §6.7's table implies [I].

**Result:** the gates pass for reasons you can see. **Proof:** A14 to A19.

### M5. Speed lines

**Goal:** the fx layer. **Work:** `createSpeedLinesLayer()`, a `RenderLayer` named `fx`.

`attach`: one `InstancedBufferGeometry`, 6 vertices, `position` holding `(side in {-1, 1}, along in {0, 1}, 0)`, instanced `aSeed` vec4 from `writeLineSeeds`, capacity `LINE_CAPACITY`, fixed. `ShaderMaterial`, `glslVersion` unset, `uniforms: { ...ctx.shared, uLineK, uLineLen, uLineCam }`, `transparent: true`, `depthWrite: false`, `blending: AdditiveBlending`, `side: DoubleSide` (a first attempt was culled and invisible [O]). `frustumCulled = false`, `renderOrder = RenderOrder.SPEED_LINES`. `mesh.visible` stays at its default `true` until the first `frame`, so precompile renders it, with `uLineK` 0.

Vertex shader, `COMMON_VERT` prepended. Starting text [O: rendered with these numbers, except that the rank fade and sun fade are new]:

```glsl
#define LINE_PERIOD 256.
uniform float uLineLen; uniform vec2 uLineCam;
in vec4 aSeed;           // angle, radius, forward, rank; each in [0, 1)
out float vEdge; out float vAlong; out float vFade; out float vRank; out vec3 vRel;
void main() {
  float fwd = mod(aSeed.z * LINE_PERIOD - uTravel.y, LINE_PERIOD);   // approaches as travel rises; no accumulator
  float ang = TAU * aSeed.x, rad = 14. + 76. * aSeed.y;
  vec2 off = vec2(cos(ang), .55 * sin(ang) + .25) * rad;
  float y = max(.5, uLineCam.y + off.y);
  vec3 pa = bendV(vec3(uLineCam.x + off.x, y, -fwd));
  vec3 pb = bendV(vec3(uLineCam.x + off.x, y, -(fwd + uLineLen)));
  vec3 va = (viewMatrix * vec4(pa, 1.)).xyz, vb = (viewMatrix * vec4(pb, 1.)).xyz;
  vec3 v = mix(va, vb, position.y);
  v += normalize(cross(vb - va, v)) * position.x * (.02 + .0016 * -v.z);
  vRel = mix(pa, pb, position.y) - vec3(uLineCam, 0.);
  vEdge = position.x; vAlong = position.y; vRank = aSeed.w;
  vFade = smoothstep(2., 14., fwd) * (1. - smoothstep(170., 256., fwd));
  gl_Position = projectionMatrix * vec4(v, 1.);
}
```

Fragment shader, `COMMON_FRAG` prepended, which supplies `HERO_C` and `HERO_R` so no constant is duplicated:

```glsl
uniform float uLineK;
in float vEdge; in float vAlong; in float vFade; in float vRank; in vec3 vRel;
void main() {
  float on = smoothstep(vRank, vRank + .06, uLineK * 1.06);          // T02: fraction of lines shown
  float e = 1. - smoothstep(.2, 1., abs(vEdge));
  float t = vAlong * (1. - vAlong) * 4.;
  float sun = smoothstep(1.15, 1.6, length(vRel.xy / max(-vRel.z, 1.) - HERO_C) / HERO_R);   // never over the disc
  vec3 c = emit(step(.5, fract(vRank * 7.)) > .5 ? uPal[6] : uPal[5], 1.4);
  gl_FragColor = vec4(c * on * e * t * vFade * sun, 1.);
}
```

`setQuality(q)`: `geometry.instanceCount = q.speedLines`. `frame(v)`: `uLineK = v.feel.speedLines`, `uLineLen = lineLength(v.sim.speed)`, `uLineCam = (v.camX, v.camY)`, `mesh.visible = shown && k > 0 && count > 0`. So a tier with 0 lines, or a neutral frame, costs no draw. `rebuild`: nothing, since no uniform is world-absolute and the attribute re-uploads by itself after a restore [I, proven by A29]. `setVisible(on)` stores `on` in `shown`, initially true, and hides the mesh at once when `on` is false, so a later `frame` cannot bring it back (§8.1: "Hides every mesh of this layer", and T09's crack mode relies on that). `setDebugMode` ignores its argument. `dispose` frees geometry and material.

`?lineperiod=250` replaces `LINE_PERIOD` with 250, as the negative control for the wrap test. Nothing else reads it.

**Visual iteration.** Save and open at `speedLines` .125 (cruise), .5, 1, at tiers 4, 3, 2, plus a strip of 6 consecutive frames at `speed` 150. The first probe shot [O], with no sun fade, looked right in style but had lines crossing the disc, which is why the fade exists. Reject on: lines over the sun, lines that read as rain or a starburst more than speed, bloom halos flickering along the far ends, a frame busier than the scene behind it. Knobs: `rad` range, fade distances, `L`, line width.

**Result:** lines exist and cost 1 draw. **Proof:** A20 to A23.

### M6. Tiers, DPR, forces and restore

**Goal:** every switch is correct and cheap. **Work:** tests A24 to A30. A tier change goes through `post.setQuality(TIERS[t])`, not the fake.

Scan period: the first reading of "integer 3 px" fixes it in buffer pixels, but that shrinks the lines to 1.5 CSS px at pixel ratio 2. T06 uses `max(2, round(3 * pixelRatio))`, so a line stays about 3 CSS px at any tier and is always an integer in the buffer. A scan row profile on flat grey showed under 0.2 code value of low-frequency beat at every DPR tried, with either rule [O: section 10], so the choice is by look. **Open** 1:1 crops at DPR 1, 1.5 and 2 for both rules before keeping it (§14 row 11). If the fixed 3 looks better, change `scanPeriodFor`, keep the integer test, and log it.

**Result:** switches are verified. **Proof:** A24 to A30.

### M7. Governor in the loop, final review and hand-off

**Goal:** the pure governor drives the real stack. **Work:** `fxDev` adds `?governor=1`: a real `createGovernorImpl` is fed a scripted series, one delta per `frameAt`, and any non-null result calls `post.setQuality(governor.profile)`. Open a final image per tier of the same REF frame and say what changed between them. Run `check:task`. Write Outcomes. Whole-repo `npm run check` waits for the batch to finish; `done` waits for that.

**Result:** T06 is ready for T10. **Proof:** A31 to A34.

## 6. Concrete steps

PowerShell 5.1, in `C:\highsierralabs\terrain`. Run these first in each shell:

```powershell
$env:TERRAIN_PORT = '5106'
$env:TERRAIN_TASK = 'T06'
```

```powershell
# M0
npm run contracts:check

# M1
npx vitest run tests/unit/fx

# Any browser milestone: start the server once in the background, or let Playwright start it
npx vite --port 5106 --strictPort

# M2 to M7, GPU
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M2"
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M3"
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M4"
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M5"
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M6"
npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06 -g "M7"

# Software tier 0
npx playwright test tests/visual/fx.spec.ts --project=software --output=test-results/T06-sw -g "software"

# Gate for this task. Does not run Playwright
npm run check:task -- T06

# After the whole batch only
npm run check
npm run test:browser -- --output=test-results/T06-all
```

Playwright clears its `--output` folder at the start of each run, so open each `SCREENSHOT <path>` line's image before the next run. To stop a leftover server: `Get-NetTCPConnection -LocalPort 5106 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

Spec shape: `import { test, expect, openDevPage, saveShot } from '../support/pw'`. `import type {} from '../../src/render/fx/dev/fxDev'` brings in the `window.__fx` declaration. GPU-only tests call `test.skip(({}, i) => i.project.name !== 'gpu')`. DPR tests use `test.describe` blocks with `test.use({ deviceScaleFactor })`. Read pixels in the same `page.evaluate` as `frameAt` (§11.3). Timing printed by a test is informational, since sibling tasks may be using the GPU.

## 7. Validation and acceptance

Paste short output into Progress as each one passes. `[O]` beside an expected value is from the probe, so expect close, not equal. Thresholds marked `[A]` were chosen from those measurements.

| # | Command or action | Expected |
|---|---|---|
| A0 | `npm run contracts:check` | Exit 0. `frameAt` accepts `feel`, `reducedMotion`, `palette`, `at`, `tick`, `bend`, `zone` |
| A1 | `quality.test.ts` | `TIERS` equals section 5's table literally. Non-increasing downward: `maxPixels`, `msaa`, `bloomLevels`, `propDensity`, `speedLines`. `pixelRatioFor`: 1920x1080 at DPR 1 gives exactly 1 at tiers 4 and 3, 0.8333 and a 1600x900 buffer at tier 2 [O], 0.6667 at tier 1, 0.3333 at tier 0; 1920x1080 at DPR 2, tier 4 gives 1.3333 [O]; DPR 1 is never above 1 at any size; 200 random sizes stay within `maxPixels`. `scanPeriodFor(1)` 3, `(1.5)` 5, `(2)` 6, `(1.3333)` 4, `(0.5)` 2, always an integer at least 2. `scanAmpFor(p) * dark / p` equals `.10 / 3` within 1e-9 for p in 2 to 8. Each `TIERS` row equals `fakeProfile(t)`; a mismatch is reported to T00 |
| A2 | `governor.test.ts`, boot | `bootTier`: 1.99 to 4, 2 to 3, 13.99 to 3, 14 to 2, 27.99 to 2, 28 to 1, 500 to 1, 0 to 3, NaN to 3 [O]. `software: true` gives 0. `forced: 3` with `software: true` gives 3 and stays there through 120 s of 100 ms frames [O] |
| A3 | `governor.test.ts`, series | Each row is frame time in ms, then `[seconds of summed frame time, tier]` events, to 0.1 s [O: all from the prototype]. See the table below |
| A3n | `governor.test.ts`, fuzz | 200 seeds of mixed series over 600 s: any two changes at least 5000 ms apart [O: min 5003.7 over 367 changes], each automatic change is one step, the returned tier equals `profile.tier`, and two runs on one series are identical |
| A4 | `governor.test.ts`, allocation | With `v8.setFlagsFromString('--expose-gc')` and `vm.runInNewContext('gc')` [O: works under Vitest 5.1.0]: heap after GC grows under 64 KB over 2e6 `sample` calls [O: -22 KB], and the same for 2e6 `computePostParams` calls. **Negative control in the same file:** retaining 1e5 small objects grows it over 1 MB [O] |
| A5 | `postParams.test.ts`, on `scriptedFrame` | Neutral feel, `full`: CA `.0006`, `.0003`; `aberration 1`: `.0014`, `.0007`. `noCa` or `reducedMotion`: 0, 0. `bloomGain` 1 gives .8, 1.25 gives 1.0, 9 gives 1.2, 0 gives 0. `min` and `bare`: scan and grain 0, period still set. `reducedMotion`: grain 0, scan kept. `grainFrame` at tick 0 is 0, ticks 0 to 4 equal, tick 5 is 1, tick 7679 is 1535, tick `7680 * 2**39` is 0, always an integer below 1536. Exposure .88 at phase 0, 1 at .5, equal at `dayPhase` .001 and .999 within 1e-3. Flash colour has luma .2, and hue ratio equal to the grid colour's (the accent's before T11 r09, DI-105) |
| A6 | `speedLineParams`, `asyncGuard`, `metrics`, `crtSource`, `isolation` tests | Seeds in `[0, 1)`, same on repeat. `LINE_PERIOD` divides 4096. `lineLength` 8 at floor, 40 at max. `withTimeout`: resolves on time, on a never-resolving promise calls `onTimeout` and resolves, leaves no timer. `washout` on synthetic arrays: exact counts. `hazeLift` exact. `litSaturation`, `darkSaturation`, `rowChanges` and `lightRadius` exact on synthetic arrays, including their cut-offs (added in the V1 repair). `spectrum` on a synthetic 3-row pattern finds period 3 and low amplitude under 0.01, and on a period-2.2 hard pattern finds low amplitude over 0.5. `crt.frag.glsl` contains `mainImage`, does not contain `mainUv`, `uTime`, `time`. **`index.ts` exports exactly the three factories.** `governor.ts`, `quality.ts`, `postParams.ts`, `speedLineParams.ts`, `asyncGuard.ts`, `dev/metrics.ts` have no `three` or `postprocessing` import and no `Date.now`, `performance.now`, `Math.random`. `index.ts` and `post.ts` have no `dev/` import. The checker flags a sample string with each forbidden token |
| A7 | `M2 picture` | Clean console. Canvas 1920x1080. **Open the PNG and write what you saw in Progress** |
| A8 | `M2 order` | In `full`'s `fullscreenMaterial.uniforms`, keys `e0ModulationOffset`, `e1Intensity`, `e2WhitePoint`, `e3UScan`, `e4Darkness` all exist, proving CA, Bloom, Tone, Crt, Vignette whatever the argument order. `bloom.blendMode.blendFunction` is `SCREEN`, `tone.mode` is `NEUTRAL`, `renderer.toneMapping` is `NoToneMapping`. After 50 frames at `dt` 1/60, `uniforms.time.value` is 0 on all four passes, and `dithering` is true on all four |
| A9 | `M2 draws` | Calls minus scene draws equal `2 * levels + 1` per tier: 15, 13, 11, 7, and 1 for tier 0 [O]. Exactly one variant `enabled` after each `setQuality` |
| A10 | `M2 alpha` | `?alpha=0.25`, for each variant at MSAA 0, 2, 4: alpha is 255 on every pixel, 2,073,600 of 2,073,600 [O]. **Negative control `&crtalpha=keep`:** minimum alpha 64, 35,848 at 255 [O]. **Composite:** screenshots with `body` background `#00ff00` and `#ff00ff` are byte-identical; under `crtalpha=keep` they differ |
| A11 | `M3 links` | After `precompile`, link count is scene materials + 6 (blur 2, luminance 1, effect 3) [O: 8 with 2 scene materials; `noCa` and `min` share one program]. Here scene materials are sky, sticks, speed lines. Cycling all variants, then tiers `4,3,2,1,0,1,2,3`, then `forceMsaa` 0, 2, 4: **0 further links** [O]. With `?hidden=1`, showing the mesh that was hidden through `precompile`: 0 further links |
| A12 | `M3 negative controls` | Each on a fresh page. `?bindtarget=0`: link count after `precompile` is higher than A11's by the scene material count, because rendering the variants compiles them a second time [O: 4 unnamed programs instead of 2]. **`?bindtarget=0&hidden=1`: showing the hidden mesh adds at least 1 link** [I: a hidden mesh is not rendered at boot, so only the bound compile can give it the right key; this is the mid-game stall the binding exists to stop]. `?rendervariants=0`: first use of a non-active variant adds at least 1. `?keepalive=0`: the tier cycle adds at least 2 per level change [O: 12] while `info.programs.length` is unchanged [O], which shows why the spy is needed |
| A13 | `M3 present` | After a REF frame, call `await post.precompile()` from the page: exactly the active variant is `enabled`, and pixels read straight after the `await`, in the same task, equal a fresh REF frame of that variant, at most 16 bytes differing by at most 1. The compare stays at tier 3's MSAA 2 under DI-73's exemption, so the speed lines mesh (`RenderOrder.SPEED_LINES`, the one blended mesh) reads `visible` false at both compared frames, found exactly once each time |
| A14 | `M4 washout` | Tier 3, palettes 0 to 5, at REF (`chunk: 1`, deepest night, exposure .88) and at `chunk: 375` (exposure 1): near-white under 0.5%, mean chroma over 55 [O, night: Sunset .001, 88.7; Miami .002, 111.3; Ultraviolet .001, 89.8; Toxic .002, 61.8; Ember 0, 96.8. O, day: .002, 92.2; .006, 116.1; .001, 93.5; .003, 64.6; 0, 100.3]. Palette 5's disc top changed, so its old readings, .347 night and .966 day, no longer apply. The new value, on a re-run of this card [O: night .002, 76.3; day .011, 79.7] |
| A15 | `M4 haze` | Haze lift at most 20 [A] on palettes 0 to 5 [O: 7.2 to 11.3], and at `bloomGain` 1.25 and 1.5 [O: 11.1, 13.2]. **Negative control `?gainmax=9` with `luminanceThreshold` .1 through `debug` and `bloomGain` 3.75:** over 25 [O: 33.03], near-white and chroma both still passing [O: .063, 108.7], and the image looks flooded |
| A16 | `M4 near-white control` | `?over=5`: near-white over 0.5% [A; O: .524 at `over=4`, too close to rely on] |
| A17 | `M4 chroma control` | `?flashwhite=1`, `flash .6`: mean chroma under 55 [A], and normal `flash .6`: Sunset over 55, near-white under 0.5% [O: 57.7, .019 at exposure 1; 56.3, .013 at .88 with a 5% saturation cut that was then dropped]. Other palettes printed, not gated, since a flash is transient [O: Toxic .914, Arctic 2.2 near-white with its old disc top]. **Guard (V1):** on Sunset at flash .6, dark-surface saturation, the mean of `(max - min) / max` over pixels whose largest channel was under 64 in the same frame at flash 0, is at least .62 night and day [A; O: .696, .690]. The additive flash it replaced reads .560 and .552 and fails. Lit saturation is printed for T11 [O: .511 from .904] |
| A18 | `M4 hue` | `?card=hue`, forced `min`, MSAA 0, tier 3 levels: ratio of magenta to cyan linear luma at 60, 100 and 160 px from the bar centre within `[0.8, 1.25]` [O: 1.05, 1.06, 1.10]. **Negative control `&equal=1`:** magenta under 1% of cyan [O: 0 against .077] |
| A19 | `M4 no-bloom sources` | `?card=surfaces`, palettes 0 to 5, `bloomGain` 1 against 0: at most 1 code value on any pixel, with the count printed. **Negative control** palette 5 with `over=1.6`: some pixel differs by over 3 [I: sky luma .76 times 1.6 is over the mask] |
| A19b | `M4 dither` | `?card=surfaces`, forced `bare`, palette 2, x 928 to 991, rows 0 to 240: largest step between adjacent 64-pixel row means, over the three channels, at most .75 code value [A; O: .34]. **Negative control `?dither=0`:** at least 1 [O: 1]. The crop matters. Down to the horizon, the gradient's own slope reads .91 with dither on [O], and at x 64 or x 400 curved rows average the undithered step down to .19 and .23 [O] |
| A19c | `M4 grain` | `?card=flat`, `noCa`, central 800 by 400 px. Std is of the green channel over every third row, one scan phase, as the probe measured it. Over all rows the scan pattern counts too, and `v=.2` reads 2.76, and 2.39 under `reducedMotion`, which fail their limits [O]. `v=0`: mean at most 2, max at most 8 [O: 1.41, 6]. `v=.2`: std in `[.8, 2.5]` [O: 1.43]. `v=.02`: std at most 5 [O: 3.46]. Same with `reducedMotion`: std at most .6 [O: .47]. Ticks 0 and 1, same `grainFrame`: at most 16 bytes differ. Ticks 0 and 5: over 1e6 bytes differ [O: 5,000,555]. The tick pair stays at tier 3's MSAA 2 under DI-73's exemption, so the speed lines mesh reads `visible` false at all three frames |
| A19d | `M4 exposure` | `?card=flat&v=.2`, `reducedMotion`, `at.chunk` 0 against 375, which is `dayPhase` 0 and .5 in the fake world: central value rises by 5 to 15 code values [A; O: `toneMappingExposure` 1 to .5 moved 112 to 70, proving the uniform reaches `NeutralToneMapping` under the composer]. Link count unchanged |
| A19e | `M4 glitch` | On Sunset, `glitch 1` and `.35`: alpha still all 255, near-white under 0.5%, chroma over 55 [O at .35: .001, 71.2; 66.9 with a 5% saturation cut since dropped]. Other palettes printed, not gated, since a glitch is transient, as in A17 [O at .35: Toxic Arcade 51.2, the rest over 60]. `full` still renders, so Crt still merges with CA. **Preservation (V1):** on all six palettes, chroma at glitch 1 and .35 within 1 code value of the same frame at glitch 0 [O: 0.00 on all six], since a band swap is a channel permutation. **Liveness (V1), `M4 glitch liveness`:** Sunset at ticks 0, 5, ... 35 (grain frames 0 to 7), the fraction of rows where more than half the pixels differ from glitch 0 by more than 1 level is in `[.06, .14]` at .35 and `[.22, .34]` at 1 [A, about 3.5 binomial standard deviations around the design rate `.28 * glitch` over 720 bands; O: .107, .286]. A dead glitch fails liveness, a mix or grey bands fail preservation, and a glitch whose coverage ignores `uGlitch` fails the .35 range |
| A20 | `M5 presence` | `speedLines 0`: 0 line pixels and no draw, so calls drop by 1. `speedLines 1`, tier 3: calls up by 1 [O], over 500 pixels changed. `.125` shows about 1/8 of the changed pixels of 1, within a factor of 3. `instanceCount` 96, 64, 32, 0, 0 by tier, with `visible` false at the last two |
| A21 | `M5 wash` | `speedLines 1` at tier 4, Sunset: near-white under 0.5%, chroma over 55, haze lift at most 20 [O: .003, 92.7 at L 1.3, length 30] |
| A22 | `M5 depth and sun` | Forced `bare`, because bloom carries line light across both boundaries and flips single code values [O, with stand-in seeds: `full`, `noCa` and `min` change about 2,030 wall pixels by 1 at x under 920, and .33% of the disc's circle by 1; `bare` changes 0 and 0]. `?wall=1`: `speedLines 1` changes no pixel in the wall's interior, and over 200 outside it [O: 11,158]. Sun (V1): `speedLines 1` against 0, inside the whole disc, `k <= 1`, where `k = abs(g - HERO_C) / HERO_R` with `g = rd.xy / -rd.z` from each pixel's camera ray. That is the metric of both `sunDisc` and the lines' fade, with `HERO_C` and `HERO_R` read from `src/contracts/glsl/hero.glsl`. No pixel changes by more than 1, and at most 16 change at all [O: 0 of 135,798; the rim from 1 to 1.15 also 0 of 43,812]. This replaces "at most 0.2% of a circle of radius 187 at (960, 470)", which a fade starting at .85 R passed with 126 changed pixels |
| A23 | `M5 continuity` | On `?card=flat&v=.02`, so only lines change, `tick`, palette and `zone: { dayPhase: 0 }` pinned, `speedLines 1`. The pin matters: the fake world's `dayPhase` is `(chunk % 750) / 750`, so without it `chunk: 2**40` runs at exposure .958 against .88 [arithmetic; O: 5,732,213 bytes differ, max 13]. `at: { chunk: 2**40, local: 12.5 }` against `chunk: 0`: at most 16 bytes differ by at most 1 [O: 0]. This far pair is a same-state compare, so it renders at MSAA 0 (`forceMsaa(0)`, DI-67, DI-70), and `composer.multisampling` reads 0 at both frames. The wrap and step pairs below compare different states and keep tier 3's MSAA 2. Across the 4096 wrap, pair `chunk 63, local 63.9` and `chunk 64, local .2`: pixels changed within 2x of a same-size step away from the wrap, `chunk 10, local 10` and `10.3`. **Negative control `?lineperiod=250`:** the wrap pair changes over 2x more than the non-wrap pair. **Open a strip of 6 consecutive frames** and describe the motion direction |
| A23d | `M5 direction` (V1) | `?card=flat&v=.02`, forced `bare`, tick 0, `dayPhase` 0. Lines 0 to 5 are isolated one at a time by instance count: blending is additive, so frame `n + 1` over frame `n` is line `n` alone. At 8 travels 32 u apart from 650, each stepped by .3, the line's light-weighted radius from the vanishing point of world `-z` grows in every pair where it adds at least 1000 code values in both frames, and at least 15 such pairs exist [O: 21 of 21]. Reversed lines (`+ uTravel.y`): 0 of 21. Over all lines at once the same radius is no test, since it fell at 10 to 10.3 on correct code (section 10) |
| A24 | `M6 DPR scan` | `?card=flat&v=.2`, `reducedMotion`, central 64 by 512 device px, where the vignette is exactly 1 [arithmetic: `d <= .282`]. For (DPR, tier) in (1,3) (1,2) (1.25,3) (1.25,2) (1.5,4) (1.5,3) (1.5,2) (2,4) (2,3) (2,2): buffer size as `pixelRatioFor`, top period equals `scanPeriodFor(r) * dpr / r` within 3%, low-frequency amplitude at most 0.5 code value [A; O: all at most 0.16]. **Negative control `?scanperiod=2.2`** at DPR 1: over 0.5 [O: 1.20] |
| A25 | `M6 DPR look` | **Open** 1:1 crops at DPR 1, 1.5, 2, tier 3 and 4, by default and with `?scanperiod=3`. Say in Progress whether lines read at the same scale, and record the rule kept |
| A26 | `M6 tier switch` | For each adjacent pair, tier `a` then `b` at the REF frame: alpha all 255 in `b`, program links 0, `pixels()` size equals `pixelRatioFor`. 4 to 3 and 3 to 2: mean absolute difference, both composited to 960x540, at most 6 code values [A]. All pairs, including the intended jumps at 2 to 1 and 1 to 0, print their difference and the frame cost; cost is informational [O: `setQuality` plus first frame at most about 12 ms on the RTX, idle GPU] |
| A27 | `M6 forces` | `forceVariant('off')`: canvas shows the scene, `renderer.autoClear` reads false after the call, no pass ran. `forceVariant('bare')` under a tier 3 profile: scan and grain 0. `setQuality` under a force keeps it. `null` returns to the profile. `forceMsaa(4)`, then `null`: `composer.multisampling` tracks. `composer.inputBuffer.width` equals `renderer.domElement.width` after every step |
| A28 | `M6 resize` | `post.resize` twice with equal values, with a counting wrapper on `debug.composer.setSize`: 0 further calls at the next frame. `resize(0, 0, 1)`: ignored, next frame fine. `page.setViewportSize` to 1280x720 with the shell's resize: `pixels()` size matches, alpha 255, no console error |
| A29 | `M6 restore` | Capture pre-loss frames at tier 3, then `post.setQuality(TIERS[2])` and one frame. Lose, wait for the event, yield a task, restore (§11.3 trap). During the loss, call `post.setQuality(TIERS[3])`. Then `post.rebuild(); await post.precompile()`. **State:** `composer.multisampling` is 2 straight after `precompile`, before any force [I: `getSafeSamples` reads `gl.getParameter`, so setting it during a loss would give 0]. **Bytes:** the pre-loss and post-restore compare frames render at MSAA 0 (`forceMsaa(0)`, then `null`; DI-67, DI-70), since the lines blend additively, and `composer.multisampling` reads 0 at each of the eight. All four variants with `speedLines 1` at most 16 bytes from their pre-loss frames, by at most 1 [O: 0 bytes, without lines]. **MSAA 2 liveness (DI-73 (3)):** `forceMsaa(0)` disposes the composer's buffers (`postprocessing` `index.js:985-994`), so the byte compare never reads the restored multisampled targets. So each variant also renders once at tier 3's own MSAA, with no force, before the loss and straight after `precompile`, both reading `composer.multisampling` 2. Per variant: the pre-loss frame has over half its pixels lit (largest channel at least 32, as `litSaturation`), mean Rec.709 luma moves by at most 0.5 code value, and the lit count by at most 1% of the pre-loss count. Not a byte compare, so DI-67 does not apply. Limits: 20 repeats, run before the limits were written, read 0 and 0 on all four variants, as did 4 runs since [O: R3]. DI-67's worst same-state D3D11 MSAA reading on this machine, 173 B, can move mean luma by at most 173 * .7152 * 255 / 2,073,600 = .0152 and the lit count by at most 173 [arithmetic], so the limits are 33 and 78 times that. A dead multisampled target reads -35.7 to -44.2 [O: R3 mutants]. Tier cycle afterwards: 0 links [O]. `allowConsoleErrors` stays false. Expected `console.warn`s `WebGL: INVALID_OPERATION: delete: object does not belong to this context` are not errors [O: 30] |
| A30 | `software`, on its own project | `?tier=0`, 640x360: variant `bare`, alpha 255, clean console (a `KHR_parallel_shader_compile` warn is expected [O]), `frameAt` ms printed, informational against §9.2's 50 ms [O: 16 ms on the card]. **Open the PNG.** Grid and disc must still read |
| A31 | `M7 governor loop` | `?governor=1&bootp95=20`, scripted series from tier 2: 300 deltas of 33 ms, then 4200 of 16.667 ms. `setQuality` fires twice, to tier 1 and back to tier 2, the buffer size follows each, and 0 links |
| A32 | `M7 tiers` | **Open** REF frame at tiers 4, 3, 2, 1, 0 and say what changed. §6.10: grid, disc and palette must not degrade, except for the resolution |
| A33 | `npm run check:task -- T06` | Exit 0, non-zero counts for tsc, ESLint, Vitest and GLSL. Before any owned file exists it fails with `VACUOUS`, which is the expected fail-before |
| A34 | After the batch: `npm run check`, then `npm run test:browser -- --output=test-results/T06-all` | Exit 0 with T06's spec included, or a sibling's failure recorded, and T06 not called done until green |

A3's series. All at `software: false`. Frames repeat the stated value unless noted. `16.667` means `1000 / 60`, which is what the prototype ran: a literal 16.667 moves the later events by up to .08 s, and `[117.2, 1]` then misses by .105 [O]:

| Boot p95 | Frames | Duration | Expected events [O] |
|---|---|---|---|
| 5 (tier 3) | 16.667 | 3600 s | `[63.0, 4]`, then none |
| 20 (tier 2) | 16.667 | 200 s | `[63.0, 3]`, `[126.0, 4]` |
| 1 (tier 4) | 16.667 | 300 s | none |
| 5 | 18 | 300 s | none (between the thresholds) |
| 5 | 20.0 | 120 s | none (not above 20) |
| 5 | 20.2 | 120 s | none (steady, boot under half, held) |
| 13 | 20.2 | 30 s | `[5.0, 2]`, `[10.1, 1]` (boot not under half) |
| 8 | 33.3 | 120 s | none (held, the 30 Hz cap) |
| 20 | 33.3 | 120 s | `[5.1, 1]`, then none (floor: not above 50) |
| 40 (tier 1) | 60 | 30 s | `[5.0, 0]` |
| NaN or 0 | 33.3 | 30 s | starts tier 3, `[5.1, 2]`, `[10.1, 1]` (no measurement, never held) |
| 5 | 40 on every 17th, else 16.7 (5.9%) | 20 s | `[5.0, 2]`, `[10.0, 1]` |
| 5 | 40 on every 25th, else 16.7 (4%) | 600 s | `[63.3, 4]` |
| 20 | 16.667 for 70 s, 33.3 for 10 s, 16.667 for 400 s | | `[63.0, 3]`, `[72.1, 2]`, `[77.1, 1]`, `[140.2, 2]`, `[373.2, 3]`, `[436.2, 4]`: the reversal locks tier 3 until 372 s |
| 20 | 16.667 for 110 s, 33.3 for 10 s, 16.667 for 70 s | | `[63.0, 3]`, `[112.1, 2]`, `[117.2, 1]`, `[180.2, 2]`: 49 s after the upshift is not a reversal |
| 13 | 16.667 for 4 s, one 5000, 16.667 for 6 s | | none, tier stays 3. This row cannot fail from the stall rule: one 5000 among about 60 samples cannot move a nearest-rank p95 (V1). The next three rows can |
| 5 | 16.667 for 30 s, one 40,000, 16.667 for 40 s | | none, tier stays 3. Without the rule: `[70.0, 4]`, an upshift straight after the stall [O: V1 and the 2026-11-05 repair] |
| 5 | 120 frames of 16.667 then one 3000, repeated, 120 s | | none. Without the rule: `[10.1, 2]`, `[20.1, 1]`, `[30.1, 0]` [O] |
| 5 | 16.667 for 10 s, then 1000 on every 4th frame, else 16.667, for 30 s, then 16.667 for 10 s | | none. Exactly `STALL_MS` is a stall. Without the rule, or with `>` for `>=`: `[13.2, 2]`, `[18.4, 1]`, `[23.7, 0]` [O]. Stalls on every frame would prove nothing, because the display-limit hold keeps a window of stalls alone |
| 13 | 16 for 188 frames (the settle), 25 for 60 frames (an open 1500 ms window), one 40,000, then 16 for 10 s | | none, tier stays 3. A stall clears the window. Kept, the 60 slow frames make the first window after the stall p95 25, boot 13 is not under half of it, and the governor sheds a tier: V2's mutant that drops `clearWindow()` reads `[45.0, 2]`, and the branch deleted reads `[44.5, 2]` [O: V2 repair] |
| 5 | `force(1)`, then 16.667 for 100 s, `force('auto')`, then 70 s | | `profile.tier` 1 at once; first `sample` returns 1, second null; none for 100 s; `[163.1, 2]` |
| 5 | `force(3)` on tier 3 | | next `sample` null |
| 5 | 10,000 `sample(0)`, then 16.667 for 200 s | | `[63.0, 4]`, the same as the real series alone [O: reconciliation prototype] |
| 13 | 20.2 for 4 s, 10,000 `sample(0)`, then 20.2 for 26 s | | `[5.0, 2]`, `[10.1, 1]`, the same as 20.2 for 30 s. **This row is the one that can fail:** in the row above, `settle` discards the zeros even with no guard, and with the guard removed this row reads `[7.0, 2]`, `[12.1, 1]` [O: reconciliation prototype] |
| 5 | `force(1)`, then `sample(0)` twice | | First returns 1, second null [O: reconciliation prototype] |
| 1, `software: true` | 5 for 120 s, 100 for 60 s | | none, tier 0. `force(2)`: tier 2, next `sample` 2. `force('auto')`: tier 0, next `sample` 0, then null |

**Human checks.** They do not block `done`. Outcomes reports them as not verified, and T11's operator pack collects them (`Agents.md`).

- **HC1.** The stack on any non-RTX GPU or a phone, including the library vignette's reversed `smoothstep` and mediump behaviour (§14 risk 1).
- **HC2.** Scanline moire in any browser but headless Chromium.
- **HC3.** A real GPU reset, since every restore here is simulated (§14 risk 5).
- **HC4.** Whether the governor's thresholds suit real devices.
- **HC5.** Whether the display-limit hold masks thermal throttling, through the operator's Q12 on a real device (§14 risk 17, DI-33).
- **HC6.** The look on the real scene, since the card is not the game, through the operator's review at T11 (§14 risk 2).

## 8. Idempotence and recovery

- Safe to re-run: every test and `check:task`. Nothing here writes outside `test-results/T06*`. T06 uses no `toHaveScreenshot` references, so no `test-refs` to reset.
- Clean state without git: `Remove-Item -Recurse -Force src\render\fx, dev\fx.html, tests\visual\fx.spec.ts, tests\unit\fx, test-results\T06* -ErrorAction SilentlyContinue`.
- Before a risky rewrite of `post.ts` or the Crt: `Copy-Item -Recurse src\render\fx $env:TEMP\t06-fx-backup`.
- Never install packages or run `npx playwright install`. Never edit outside the owned paths. A defect in a contract, the shell or a sibling goes in section 10 with evidence and the plan goes `blocked`.
- If a browser test hangs, the page has probably lost its context without a restore (§10.2). Close it; do not retry in a loop.
- Tuned values live in three files (`postParams.ts`, `crt.frag.glsl`, `post.ts`), so a bad tune is reverted by restoring the §6.6 numbers, listed in this plan.

## 9. Progress

- [x] 2026-11-05T06:34Z Plan drafted. Throwaway probes ran in the scratchpad. No project file exists from this task apart from this plan.
- [x] 2026-11-05T14:48Z M0 pre-flight. T00 `status: done`. `npm run contracts:check` exit 0: `contracts:check PASS, 7 files`. `startDevShell`, `tests/support/pw.ts` and `src/core/hash.ts` exist, and `ScriptedFrameOptions` has `feel`, `reducedMotion`, `palette`, `at`, `tick`, `bend`, `zone`. A0 passed.
- [x] 2026-11-05T14:52Z M1 pure core. A1 to A6 pass on first real run, after one test bug (below). `A3n changes 376, min gap 5006.7 ms` [plan's O: 5003.7 over 367]. `A4 governor heap delta -29320 bytes over 2e6 samples`, `A4 postParams heap delta -9112 bytes over 2e6 calls`, `A4 control heap delta 4921288 bytes`. Guard control below.
- [x] 2026-11-05T15:01Z M3 precompile, first pass. Output as in the final run below.
- [x] 2026-11-05T15:06Z M7 and the software test, first pass. Output as in the final run below.
- [x] 2026-11-05T15:09Z **Full run of everything below; the images below are from this run.** `npx playwright test tests/visual/fx.spec.ts --project=gpu --output=test-results/T06`: `69 passed (1.1m)`, `1 skipped` (the software test), exit 0. `--project=software -g "software tier 0"`: `1 passed`, exit 0. `npm run check:task -- T06`: `tsc: 21 owned files, 2 configs, 0 problems`, `eslint: 21 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0` (93 tests), `glsl: 25 owned files scanned, 0 hits`, `check:task T06 PASS`, exit 0.
- [x] 2026-11-05T15:09Z M2 Crt, stack, card, first image viewed
  - A7: canvas 1920x1080, clean console, `active full`, 15 calls, near-white .001%, chroma 88.7.
  - A8: all five keys present, `blend 28` (`SCREEN`), `tone 8` (`NEUTRAL`), `rendererTone 0`, time 0 and dithering true on all four passes after 50 frames.
  - A9: post draws 15, 13, 11, 7, 1 at tiers 4 to 0, one variant enabled each.
  - A10: 2073600 of 2073600 opaque in all 12 variant and MSAA cases, and `composer.multisampling` tracked. Control `crtalpha=keep`: `{"opaque":35848,"min":64}`, the probe's exact numbers. Composite over `#00ff00` and `#ff00ff`: identical true; under `keep`, false.
  - **Saw, `M2-picture`:** deep purple top falling through magenta to a hot pink horizon; a yellow-to-pink sun with thin dark bands low on the disc; a bright magenta grid converging with no moire; neon sticks with a tight glow; a soft dark vignette; scanlines only up close. It matches the plan's reference. Nothing wrong.
- [x] 2026-11-05T15:09Z M3 Precompile and negative controls
  - A11: `boot 9, cycle {"added":0,"programs":[9,9]}`. With `?hidden=1`: `{"boot":10,"added":0}`.
  - A12: `bindtarget=0` boot 12, so +3. `bindtarget=0&hidden=1`: `{"boot":13,"added":1}`. `rendervariants=0`: `{"boot":7,"added":1}`. `keepalive=0`: `{"added":12,"programs":[9,9]}`.
  - A13: `{"enabled":["full"],"active":"full","diff":{"bytes":0,"max":0,"sum":0}}`.
- [x] 2026-11-05T15:09Z M4 Photometric gates and palette images viewed
  - A14, near-white %, chroma, night then day: Sunset .001, 88.7; .002, 92.2. Miami .002, 111.3; .006, 116.1. Ultraviolet .001, 89.8; .001, 93.5. Toxic .002, 61.8; .003, 64.6. Ember 0, 96.8; 0, 100.3. Arctic .002, 76.3; .011, 79.7. All equal the probe's to the printed digit.
  - A15: 9.14, 9.07, 9.98, 10.55, 7.24, 9.78 by palette; gain 1.25 10.80; gain 1.5 12.34. Control `gainmax=9`, threshold .1, gain 3.75: haze 31.1 over 25, near-white .045%, chroma 106.2, both still passing.
  - A16 `over=5`: near-white .688%. A18: ratios 1.042, 1.045, 1.049; control magenta 0 against cyan .068. A19: max 1 on every palette, 0, 0, 0, 0, 3, 1 bytes; control max 145. A19b: .344; `dither=0` 1. A19c: v0 mean 1.42, max 6; v.2 std 1.41; v.02 std 3.48; reduced .2 std .28, reduced .02 std .47; ticks 0 and 1 differ by 0 bytes; ticks 0 and 5 by 4,887,976. A19d: 101.4 to 109.5, +8.1, 0 links.
  - A17 after the flash tune, night then day: Sunset .013, 61.2; .019, 61.0. Miami .084, 140.5; .141, 140.2. Ultraviolet .001, 76.2; .005, 75.5. Toxic .300, 116.8; .914, 113.7. Ember 0, 127.8; 0, 127.8. Arctic .545, 109.3; 1.620, 106.9. Only Sunset is gated. Control `flashwhite=1`: chroma 32.5.
  - A19e after the glitch tune: chroma is unchanged from the unglitched frame on every palette at both 1 and .35, alpha 2073600/2073600, `full` still renders. Sunset .001, 88.7.
  - **Saw, palettes:** Sunset as above. Miami: violet sky, cyan grid, pink and cyan sticks, gold sun. Ultraviolet: indigo sky, violet grid, a pale lavender disc with teal sticks, the least coloured sun but not flat white, since its bands read. Toxic: teal-black sky with a mint disc and pink sticks, a strong green horizon. Ember: maroon sky, orange horizon, gold sun, red grid. Arctic: navy sky, pale cyan disc, pink sticks; its disc is near white but the bands read and it does not blow out. No palette fails the reject list. Toxic is the flattest overall, which its chroma of 61.8 agrees with.
  - **Saw, peak feel** (`aberration 1, bloomGain 1.25`): visible colour fringing on the outer sticks and grid, glow a little stronger, still clean.
  - **Saw, flash .6 before the tune:** the frame went slate. A floor cell read 72, 91, 104, saturation .31 from 1.0, and top sky 66, 94, 106, saturation .38. This is the plan's "flash that turns the frame grey", and chroma 57.4 still passed. **After the tune:** a clean teal wash, floor cell 47, 91, 97, saturation .52; sun and neon keep their colour. It reads as a coloured flash.
  - **Saw, glitch .35 before the tune:** the bands the plan warned of: horizon pink turned tan, 192, 137, 106, saturation .45, the sky olive and muddy. Rejected. **After the tune:** thin hard-edged false-colour bands, lime on Sunset, violet on Toxic, sharp and saturated, reading as a CRT signal fault rather than a broken driver. The thin bands in dark sky are a dark olive, narrow enough not to read as mud.
  - **Saw, glitch .35 on the others, after the tune** (A19e's printed palettes): Miami: lime and teal bands across a violet sky. Ultraviolet: mauve bands and a pale lavender disc with pink stripes. Toxic: violet bands on teal. Ember: olive and gold bands on maroon. Arctic: mauve bands on navy. All read as faults, none as grey. T11 may still want a palette-specific look; not a gate.
  - **Saw, hit** (`flash .6, glitch 1`): teal sky with broad mint and lime bands through the disc and a pink band at the horizon, the grid broken into pink and lime. Loud, as a 0.2 s hit should be.
  - **Saw, sky crop 1:1:** a fine even texture from scan and grain, no bands. Grain is not visible at normal distance in the full frame.
  - **Saw, flood control:** glow fills the grid cells near the horizon, the disc is washed to pale peach, sticks are fat with halo, and it still scores chroma 106. That is what failing looks like.
- [x] 2026-11-05T15:09Z M5 Speed lines, images and frame strip viewed
  - A20: calls 15 to 16, `changedOne` 371,389, `changedEighth` 50,310, ratio .135, `instanceCount` 96, 64, 32, 0, 0 with `visible` false at the last two. `setVisible(false)` holds through two frames, and `true` restores: 16, 15, 15, 16.
  - A21: near-white .001%, chroma 89.2, haze 9.24. A22: wall inside 0, outside 7,829; sun 0 of 109,845 pixels changed. A23: far pair 0 bytes; wrap 226,346 against step 178,535, ratio 1.27. Control `lineperiod=250`: 1,164,818 against 208,835, ratio 5.6.
  - **Saw, stills** (.125, .5, 1 at tiers 4, 3, 2): thin neon streaks radiating from the vanishing point, cyan and magenta, tapering at both ends. None crosses the disc. Cruise .125 shows two or three and is quiet. At 1 on tier 4 it is a clear rush, busy but still behind the sun and the grid. Tier 2 has fewer and looks the same in style. Lines near the floor hug it and read as ground streaks. A line at camera height runs dead level on the horizon on the right, which is geometry, not a bug. No rain, no starburst.
  - **Saw, strip of 6 at 150 u/s, flat card:** each line's outer end moves outward from the vanishing point frame to frame, so lines approach the viewer, matching forward travel. Lines enter faded and leave off screen, and no line pops.
  - **Saw, strip of 6, scene card:** lines move outward as above, while the card's own near grid rows move upward, away from the viewer. That is the card's sign, not the lines'; see section 10.
- [x] 2026-11-05T15:09Z M6 Tier switches, DPR crops viewed, forces, restore, software
  - A24, low-frequency amplitude: dpr 1 tier 3 .013, tier 2 .090; dpr 1.25 .184, .016; dpr 1.5 tier 4 .135, tier 3 .018, tier 2 .093; dpr 2 tier 4 .026, tier 3 .020, tier 2 .091. Every top period within .5% of the expected value. Control `scanperiod=2.2`: low .667, over .5.
  - A25 **saw, 1:1 crops at DPR 1, 1.5, 2:** the default rule gives 3 CSS px at every tier. DPR 2 tier 3 and tier 4 under the rule both show lines 6 device px apart, so a tier change does not change their scale. The fixed 3 gives 4.5 device px at tier 4 and 6 at tier 3, so the texture jumps at that tier change, and reads finer. No moire in any crop. **Kept:** `max(2, round(3 * pixelRatio))`.
  - A26: 4 to 3 .81, 3 to 2 4.14, both gated at 6 and passing; 2 to 1 5.86; 1 to 0 15.71, printed; buffer sizes follow, alpha all 255, links +0. Cost 2.6 to 9.9 ms over two runs, with siblings on the GPU, so contaminated and informational.
  - A27: `offAutoClear false`, no pass enabled, 2 calls, scene visible, and the first `off` frame linked 2 programs, the direct-to-canvas keys of the two materials it drew. Booting under `?post=off`: scene visible, no pass enabled, and returning with `forceVariant(null)` links 0. `bare` under tier 3: scan 0, grain 0. A force survives `setQuality` and `null` returns to the profile. `forceMsaa(4)` then `null`: 4, 2. Input buffer width equal to canvas at all six steps. **Saw, `M6-post-off`:** the raw scene: saturated, unbloomed, no vignette, aliased sticks. Expected.
  - A28: 0 further `setSize` calls on equal resize and on `resize(0, 0, 1)`; viewport 1280x720 gives a 1280x720 buffer, alpha 255. A29: `msaa 2`, all four variants 0 bytes from their pre-loss frames with lines on, cycle links 0, 0 shader errors. M6 dispose: no throw, clean console.
  - A30 on SwiftShader: `bare`, 640x360, alpha 230400/230400, 24 and 21.4 ms, informational against 50. **Saw:** grid, disc and bands read well; sticks are thin and jagged at 640x360.
- [x] 2026-11-05T15:09Z M7 Governor loop, tier images viewed, check:task
  - A31: starts tier 2 at 1600 wide; `[{"tier":1,"deltaIndex":151,"w":1280,"h":720,"active":"min"},{"tier":2,"deltaIndex":3907,"w":1600,"h":900,"active":"noCa"}]`, 0 links.
  - A32 **saw, REF at tiers 4 to 0:** tier 4 and 3 nearly the same, tier 4 a little cleaner on stick edges; tier 2 loses CA, and sticks step visibly from no MSAA; tier 1 loses scan and grain and is softer at 1280x720, and its glow looks tighter and a little stronger from 3 bloom levels; tier 0 is 640x360 upscaled with no bloom, jagged sticks, a clean hard pink grid and dark navy cells. Grid, disc and palette hold at every tier, except the resolution, as §6.10 says.
- [x] 2026-11-05T15:09Z A33 `check:task` as above. The `VACUOUS` fail-before was not captured: owned files already existed at the first gate run.
- [x] 2026-11-05T15:09Z Negative controls beyond the plan's list, by temporarily mutating T06's own files, each restored and checked: `sample(0)` guard removed: `event 0 of 7.050:2 12.080:1` fails, matching the plan's `[7.0, 2]`, `[12.1, 1]`. Sun fade removed: `.699%` over .2. `depthTest: false`: wall inside 4,928. Lines driven from `uTravel.x * 3.7`: wrap 1,017,830 over the 2x limit.
- [x] 2026-11-05T15:14Z Re-run after adding `M6 boots under post=off` and a link count to A27; no source file under `src/render/fx` changed between the runs, so the images viewed at 15:09Z still stand. `--project=gpu`: `70 passed (1.2m)`, `1 skipped`, exit 0. `--project=software -g "software tier 0"`: `1 passed`, exit 0, 21.4 ms. `npm run check:task -- T06`: `tsc: 21 owned files, 2 configs, 0 problems`, `eslint: 21 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 25 owned files scanned, 0 hits`, `check:task T06 PASS`, exit 0. `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`.
- [ ] Whole-repo `npm run check`, then `npm run test:browser`: **not run**, by the batch's rule that only `check:task` runs while siblings are mid-flight. A34 is open.
- [x] 2026-11-05T20:10Z **V1 repair started.** `status: in-progress`. Starting hashes equal the verifier's: `governor.ts` 873af3d1, `crt.frag.glsl` ab8c0998, `speedLines.vert.glsl` 88568625, `speedLines.frag.glsl` b63293a9. Every mutation below was applied to one of these four files, run, and restored, and the restored hash printed equal to these.
- [x] 2026-11-05T20:12Z **Blocking 2, A3 stall rows.** Three rows added to `governor.test.ts`. Real code: `Tests 34 passed (34)`, exit 0. Stall branch deleted: `events were 70.000:4`, `events were 10.067:2 20.067:1 30.067:0`, `events were 13.167:2 18.417:1 23.667:0`, `3 failed`, exit 1. `>=` changed to `>`: the `STALL_MS` row fails with `13.167:2 18.417:1 23.667:0`, exit 1. `chain = 0` deleted from the branch: the 40 s row fails with `104.000:4`, exit 1. First attempt at the `STALL_MS` row used stalls on every frame and passed with the branch deleted; see section 10.
- [x] 2026-11-05T20:14Z Metrics added to `dev/metrics.ts`: `litSaturation`, `darkSaturation`, `rowChanges`, `lightRadius`, with exact unit tests. `metrics.test.ts` first failed on my own wrong expected value (`100, 50, 0` is saturation 1, not .5); the fixture was corrected, and the function was unchanged. `Tests 16 passed` alone; the 18 with `darkSaturation` ran inside `check:task`'s 103.
- [x] 2026-11-05T20:17Z **Blocking 1, A19e.** Real code, every palette: chroma at glitch 1 and .35 equals glitch 0 to 0.00 (Sunset 88.70, Miami 111.35, Ultraviolet 89.75, Toxic 61.80, Ember 96.81, Arctic 76.31). Liveness `{"swapped":924,"partial":0,"rows":8640}` (.107) at .35 and `{"swapped":2472,...}` (.286) at 1. Mutants, each `exit 1`: dead (`c = c`) liveness 0 against `>= 0.06`; mix (`mix(c, c.brg, uGlitch * step(.72, f))`) Sunset .35 at 73.11, `-15.59`, and liveness .286 against `<= 0.14`; grey bands Sunset 1 at 61.08, `-27.62`; fixed coverage (`f > .72`) liveness .286 at .35 against `<= 0.14`.
- [x] 2026-11-05T20:18Z **Low, A17 flash guard.** Sunset dark-surface saturation `night 0.696 over 675940 px, day 0.690`, lit saturation `.511 from .904`, `.499 from .899`. Additive flash mutant: chroma 57.4 and 57.7, as V1 measured, dark-surface `.560` and `.552`, `Expected: >= 0.62, Received: 0.5597`, exit 1.
- [x] 2026-11-05T20:19Z **Low, A22 sun.** Real code `{"hero":{"cx":0,"cy":0.125,"r":0.215},"disc":135798,"changed":0,"over1":0,"rim":43812,"rimChanged":0}`. Fade at `.85, 1.05` (V1's mutant): `changed 535, over1 494`, exit 1. Fade at `.98, 1.4`, nearer the rim: `changed 12, over1 3`, exit 1.
- [x] 2026-11-05T20:19Z **Low, A23d direction.** Real code `A23d 21 of 21 visible pairs moved outward`, growth +0.34 to +7.11 px per .3 u, vanishing point (960.0, 491.3) in readPixels coordinates. Reversed lines: `0 of 21`, exit 1. A first form over all lines at once fell on correct code; see section 10.
- [x] 2026-11-05T20:20Z `npm run check:task -- T06`: `vitest: 8 owned files, exit 0` (`Tests 103 passed (103)`), `tsc: 21 owned files, 2 configs, 0 problems`, `eslint: 21 owned files, 0 errors, 0 warnings`, `glsl: 25 owned files scanned, 0 hits`, `check:task T06 PASS`, exit 0.
- [x] 2026-11-05T20:21Z Full gpu run, `--output=test-results/T06-R1`: `71 passed (1.4m)`, `1 skipped`, `1 failed`: `M7 tiers`, `page.evaluate: Execution context was destroyed`, the Vite reload the batch notes warn of. Rerun alone, `--output=test-results/T06-R1m7`: `1 passed`, exit 0. No source under `src/render/fx` changed between the two runs. Software, `--output=test-results/T06-R1sw -g "software tier 0"`: `1 passed`, exit 0, `bare` 640x360, alpha 230400/230400, 24.1 ms (contaminated, informational). A23 unchanged: wrap 226,346 against step 178,535; control 1,164,818 against 208,835.
- [x] 2026-11-05T20:21Z **Saw**, from that run. `M4-flash-60`: a teal wash over sky and floor cells, pink grid, yellow-to-pink banded sun, pink and cyan sticks; the dark surfaces are teal, not grey, and the frame is pastel, as V1 saw. `M4-hit`: teal with broad mint, lime and pink bands through the sun and horizon, the grid broken into pink and lime. `M4-glitch-35-Sunset`: about eight thin, hard-edged, full-width bands, lime on the sky and floor and mint across the sun, no mud; eight of 90 bands agrees with liveness .107. `M5-strip-flat`: six frames on the black card, lines radiating from the centre, each outer end further out frame to frame, so lines approach, with no pop.

- [x] 2026-11-05T20:24Z Final `npm run check:task -- T06` after the plan edits: `tsc` 0 problems, `eslint` 0 errors 0 warnings, `vitest: 8 owned files, exit 0`, `glsl` 0 hits, `check:task T06 PASS`, exit 0. Hash check against the start: only `dev/metrics.ts`, `governor.test.ts`, `metrics.test.ts` and `fx.spec.ts` differ. `status: done` at 20:26Z.

Remaining: A34 after the batch, which DI-64 makes the condition for T10 to count T06 done. Nothing else in section 7 is open. Human checks HC1 to HC6 are listed in section 13.

- [x] 2026-11-05T21:55Z **V2 repair started** (V2's four low items; DI-67, DI-68, DI-70). `status: in-progress`. Start hashes of all 25 T06 files recorded; `governor.ts` 873af3d1, `post.ts` bb17b7b4, `crt.frag.glsl` ab8c0998, `speedLines.vert.glsl` 88568625, `speedLines.frag.glsl` b63293a9, `fx.spec.ts` 8b008ec3, `governor.test.ts` 4ac2c311, equal to V2's where V2 listed them.
- [x] 2026-11-05T21:57Z **V2 low 3, a stall clears the window.** New A3 row in `governor.test.ts`, boot 13: 188 frames of 16 ms (the settle), 60 of 25 ms (an open 1500 ms window), one 40,000, then 16 ms for 10 s; expected none, tier 3. V2's mutant (stall branch keeps `chain = 0`, drops `clearWindow()`): `× a stall clears the window`, `events were 45.020:2`, `Tests 1 failed | 34 passed (35)`, exit 1; restored `873af3d1 MATCH`. Stall branch deleted: this row reads `44.508:2`, and the three earlier stall rows fail as before (`70.000:4`, `10.067:2 20.067:1 30.067:0`, `13.167:2 18.417:1 23.667:0`), `4 failed | 31 passed`, exit 1; restored `873af3d1 MATCH`. Real code: `Tests 35 passed (35)`, exit 0.
- [x] 2026-11-05T21:58Z **V2 low 1, DI-67 and DI-70: A23's far pair and A29 at MSAA 0.** Fail-before: with the new assertions that the compare frames read `composer.multisampling` 0, and no force yet, `-g "M6 restore|M5 continuity$"`: `A23 ... "far":{"bytes":0,...},"farMsaa":[2,2]`, `Error: far pair MSAA`; `A29 {"msaa":2,"preMsaa":[2,2,2,2],"postMsaa":[2,2,2,2],...}`, `Error: pre-loss compare frames`; `2 failed`, exit 1. With `forceMsaa(0)` around the compare frames and `null` after: `A23 {"wrap":226346,"step":178535,"far":{"bytes":0,"max":0,"sum":0},"farMsaa":[0,0]}`, control `1164818` against `208835`, `A29 {"msaa":2,"preMsaa":[0,0,0,0],"postMsaa":[0,0,0,0]}`, all four variants 0 bytes, `cycleLinks 0`, `3 passed`, exit 0. Mutant `post.ts` `forcedMsaa ?? q.msaa` to `q.msaa` (the force ignored): `farMsaa [2,2]` and `preMsaa [2,2,2,2]`, `2 failed`, exit 1; restored `bb17b7b4 MATCH`.
- [x] 2026-11-05T22:00Z **V2 lows 2 and 4, record only.** Section 11's DI-58 row now cites DI-68 and states V2's condition. The rulings 1 and 2 rows and the A3, A22 and A23d rows now say what V1 asked for and that V2 agreed to the numbers. These are plan text, so no check can fail on them; nothing was run for them.
- [x] 2026-11-05T22:00Z `npm run check:task -- T06`: `Tests 104 passed (104)`, `tsc: 21 owned files, 2 configs, 0 problems`, `eslint: 21 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 25 owned files scanned, 0 hits`, `check:task T06 PASS`, exit 0.
- [x] 2026-11-05T22:02Z Full gpu spec, `--output=test-results/T06-R2`: `72 passed (1.2m)`, `1 skipped`, exit 0; A13 0 bytes, A23 and A29 as above. Changed rows `-g "M6 restore|M5 continuity" --repeat-each=3`: `9 passed`, exit 0, every A29 variant 0 bytes in all 3, far pair 0 in all 3. Hash check against the start: only `governor.test.ts` (4ac2c311 to 83f08b5f) and `fx.spec.ts` (8b008ec3 to 60e7d45e) differ; no file under `src/render/fx` changed. No software run, since neither changed row runs there. `status: done` at 22:03Z.
- [x] 2026-11-05T22:47Z **R3 repair started** (DI-73 items 1 and 3). `status: in-progress`. Start sha256 of all 26 T06 files recorded; `post.ts` bb17b7b4, `speedLines.ts` e79d1bb4, `fx.spec.ts` 60e7d45e, `governor.test.ts` 83f08b5f, equal to the V2 repair's end hashes.
- [x] 2026-11-05T22:50Z **DI-73 (3), A29 measured before any limit was written.** The liveness frames were added print-only and the row run with `--output=test-results/T06-R3 -g "M6 restore" --repeat-each=20`: `20 passed`, exit 0. Every run, pre-loss against post-restore at MSAA 2 (`msaa [2,2]`): `full` luma 44.2675, lit 1,970,501; `noCa` 43.9852, 1,964,734; `min` 44.1775, 1,973,979; `bare` 35.7404, 1,349,544; `dLuma 0`, `dLit 0` on all four in all 20. Limits then written: mean luma within 0.5, lit count within 1%, reference lit over half the frame (section 7, A29, for the arithmetic).
- [x] 2026-11-05T22:52Z **DI-73 (1), A13 and A19c fail first.** Mutant `speedLines.ts` `mesh.visible = shown && count > 0` (the `k > 0` dropped, so the lines draw at `feel.speedLines` 0 and add no light): `-g "M3 present|M4 grain"`, `2 failed`, exit 1. `A13 {"msaa":2,"lines":[true,true],"diff":{"bytes":0,...}}`, `Error: speed lines hidden in both compared frames (DI-73)`; `A19c ticks {"msaa":2,"lines":[true,true,true],"sameFrame":{"bytes":0,...}}`, `Error: speed lines hidden in all three frames (DI-73)`. Both byte compares still read 0, so only the new assertions saw the lapse. Restored, `speedLines.ts e79d1bb4 MATCH` by sha256. Real code: `lines [false,false]` and `[false,false,false]`, `2 passed`, exit 0.
- [x] 2026-11-05T22:53Z **DI-73 (3), A29 fails first.** Mutant A, MSAA colour storage left unattached after the restore: a `webglcontextrestored` listener in `post.ts`, and in `precompile`, once restored and `multisampling > 0`, the multisampled scene framebuffer's `COLOR_ATTACHMENT0` set to null. `1 failed`, exit 1: `Error: full mean luma change after the restore`, `Expected: <= 0.5`, `Received: 43.05432240126215`. Liveness `dLuma` -43.05, -42.77, -44.18, -35.74, `dLit` -1,970,501, -1,964,734, -1,973,979, -1,349,544, so no pixel lit. Every older assertion passed first, in the same run: `msaa 2`, `preMsaa` and `postMsaa [0,0,0,0]`, all four MSAA 0 diffs 0 bytes, `cycleLinks 0`, `errors 0`. Restored, `post.ts bb17b7b4 MATCH`.
- [x] 2026-11-05T22:54Z Mutant B, a composer not rebuilt after the restore: `precompile` keeps the boot multisampled framebuffer handle and, once restored, writes it back over the new one, so the scene target points at an object from the lost context. `1 failed`, exit 1, the same message and the same four `dLuma` and `dLit` as mutant A; older assertions all passed again, and no console error was raised. Restored, `post.ts bb17b7b4 MATCH`.
- [x] 2026-11-05T22:54Z Real code, `-g "M3 present|M4 grain|M6 restore" --repeat-each=3`: `9 passed`, exit 0. A13 `lines [false,false]`, 0 bytes; A19c `lines [false,false,false]`, 0 bytes; A29 liveness `dLuma 0`, `dLit 0` on all four, MSAA 0 diffs 0 bytes, in all three.
- [x] 2026-11-05T22:55Z `npm run check:task -- T06`: `Tests 104 passed (104)`, `tsc: 21 owned files, 2 configs, 0 problems`, `eslint: 21 owned files, 0 errors, 0 warnings`, `vitest: 8 owned files, exit 0`, `glsl: 25 owned files scanned, 0 hits`, `check:task T06 PASS`, exit 0.
- [x] 2026-11-05T22:56Z Full gpu spec, `--output=test-results/T06-R3`: `72 passed (1.1m)`, `1 skipped`, exit 0; A13, A19c and A29 as above. Hash check against the start: only `fx.spec.ts` (60e7d45e to 59e5d31e) and this plan differ; no file under `src/render/fx` changed. No software run, since none of the three rows runs there. No image to view: no source or picture changed.
- [x] 2026-11-05T22:58Z Final `npm run check:task -- T06` after the plan edits: `Tests 104 passed (104)`, `tsc` 0 problems, `eslint` 0 errors 0 warnings, `vitest: 8 owned files, exit 0`, `glsl` 0 hits, `check:task T06 PASS`, exit 0. `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0. `status: done` at 22:58Z. Remaining: A34 under DI-64, unchanged.

## 10. Surprises and discoveries

**From execution, on project code:**

- **Additive accent greys a complementary surface.** Sunset's sky and floor are magenta, its accent is cyan, and cyan on magenta sums toward white. At flash .6 a floor cell read 72, 91, 104, while A17 still passed at 57.4. A lower `FLASH_LUMA` does not help: it spends more of the decay in the grey part [arithmetic]. See the Decision log.
- **`mix(c, c.brg, .35)` is what makes the mud.** A mix of a colour with its own rotation moves toward its grey mean, and horizon pink became 192, 137, 106. A full swap is a channel permutation, so chroma cannot move. **Consequence:** A19e's absolute chroma limit can no longer fail from glitch. **Corrected by V1:** this bullet called the limit "a regression guard against a return to mixing". It was not one: mixing reads 73.1 on Sunset, over the gated 55, and only Toxic, which is not gated, fell to 51.5. A dead glitch and grey bands passed too. A19e now compares chroma with the same frame at glitch 0, where a permutation moves it by 0.00 and a mix by -15.6, and counts swapped bands.
- **The card's grid scrolls backward.** `uv.y += uTravel.x / 8.` with `rd.z` negative makes the pattern `-forward + travel`, so rows recede as travel rises. Seen in the scene strip. T00's `trivialLayer` has the right sign, `forward + uTravel.x`. Left as the plan writes it, since the card's numbers are comparable only if built exactly so, and nothing real uses it. T03's floor is T03's.
- **The speed line mesh must stay visible until its first `frame`,** or A12's `bindtarget=0` reads +2, not +3, because only rendered materials compile a second time. At precompile `uLineK` is 0, so the draw adds no light, and the instance count of a tier 0 profile is 0. The plan did not state the initial value.
- **`test.skip(({}, i) => ...)` does not type-check at describe level.** Section 6's form gives TS2769 in Playwright 1.64: the condition callback takes one argument, with no `TestInfo`. `test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); })` works.
- **The GLSL grep gate reads test files too.** `check:task` scans owned `.ts` and flagged `uniform float uTime;` in `crtSource.test.ts`, a sample string for the checker. The name is assembled at run time there.
- **Ultraviolet's accent has red exactly 0,** so a ratio-per-channel hue test divides by zero. A5 compares each channel to its expected value instead.
- **`-g "software"` matches the project name in the test title,** so section 6's command runs every test on that project and skips all but one: `67 skipped, 1 passed`. Harmless. `-g "software tier 0"` is cleaner.
- **A14 reproduced the probe to the printed digit on all six palettes,** and A10's 35,848 exactly, so the card here is the card measured. A15's control read 31.1 against the probe's 33.03, and its gain 1.5 read 12.34 against 13.2. The cause was not investigated, since both stay clear of their limits on the right side.
- **Glitch at 1 and at .35 no longer differ in chroma,** and both equal the unglitched frame, for the permutation reason above.

**From the V1 repair, 2026-11-05:**

- **A window of stalls alone is masked by the display-limit hold.** A first `STALL_MS` row of 1000 ms on every frame passed with the stall branch deleted. All samples sat in the overflow bin, so `p95 - p50` was 0 and boot 5 was under `p95 / 2`, and the governor held. The row now puts a stall on every 4th frame, so p50 stays at 60 Hz, and it fails without the rule.
- **Over all lines, the light-weighted radius is not a direction test.** On correct code at local 10 to 10.3 it fell in every ring tried: -0.683 px over the frame, -1.247 within 540 px, -1.736 from 300 to 540. Each line fades as a whole near its wrap (`vFade` depends only on `fwd`), which reweights the lines against each other. One line alone fades uniformly along its length, so its radius moves by geometry only. Isolated by instance count, all 21 visible pairs moved outward.
- **Far lines sit inside the sun fade.** The vanishing point of `-z` is at k about .58 from the disc centre, so a line is dark while it is far: line 0 showed at only 5 of 16 positions over its period. That is the fade working, and it is why A23d uses six lines.
- **The lines' sun fade and the disc share one metric,** `g = rd.xy / -rd.z` against `HERO_C` and `HERO_R`, and the camera sits at `(camX, camY, 0)` (`writeCameraPose`). So A22 can be stated in disc radii. The disc covers 135,798 pixels, an equivalent radius of 208 px [arithmetic], so the old 187 px circle reached only .9 of it, which is why a fade reaching .85 R passed.
- **A Vite reload killed one test in the full run** (`M7 tiers`, `Execution context was destroyed`). It passed alone straight after. A sibling's module change is the likely cause [I]; no T06 source changed between the runs.

**From the V2 repair, 2026-11-05:**

- **Two other same-state rows still compare at tier 3's MSAA 2:** A13 (`M3 present`) and A19c's tick pair (`M4 grain`). Neither draws a blended scene mesh, since the lines are off and the card's sky and sticks are opaque [I: read in `testCard.ts` and `speedLines.ts`, not measured for D3D11 noise]. DI-70 names only A23's far pair and A29, so they are left as they are. DI-67's wording, "every same-state comparison", would also reach them, so that is for the T00 owner to rule on. (Ruled by DI-73: both stay at MSAA 2 and assert the lines hidden; see the R3 repair.)
- **The far pair and A29 read 0 bytes at MSAA 0, as they did at MSAA 2.** The wrap and step counts did not move (226,346 and 178,535; control 1,164,818 and 208,835), because they still run at the tier's MSAA.

**From the R3 repair, 2026-11-05:**

- **A13 and A19c's byte compares cannot see the lines drawn dark.** With the lines drawn at `feel.speedLines` 0 they add no light, and both compares still read 0 bytes. So DI-73's exemption could only lapse quietly, which is why the rows now read the mesh's `visible` flag rather than pixels.
- **A29's old form could not see a dead multisampled target after the restore.** Both mutants passed every earlier assertion, including all four MSAA 0 byte compares at 0, because `forceMsaa(0)` disposes the restored targets before those frames.
- **The two MSAA mutants read identical values, with every pixel unlit.** Colour storage unattached and a lost-context framebuffer gave the same four `dLuma` and `dLit` to every printed digit. The likely reason is that the scene texture keeps its zero initialisation after the restore, so the post chain runs on black [I: not read back from the texture].
- **What the liveness check cannot see.** It catches a dark or dead multisampled target. A restored target that renders but resolves without antialiasing would move mean luma and the lit count only at edges, so it would likely pass [I: not tried]. Telling MSAA 2 from 0 would take a different-state compare against an MSAA 0 frame, which DI-73 did not ask for.

**From the 2026-11-05 probes, before any project code:**

- **A bloom level change recompiles, and `info.programs` hides it.** Tier cycle `4,3,2,1,0,1,2,3`: `linkProgram` went from 8 to 20 while `info.programs.length` stayed 8. Cause in source: the `levels` setter calls `this.dispose()`, and `Pass.dispose` disposes every `Material` property. A kept `MipmapBlurPass` brought it to 0 on both the RTX and SwiftShader. §6.10's "Bloom `levels` 6.8 ms" may be this compile [I]. §8.1's "so no program compiles mid-game" is otherwise false at tier changes.
- **The keep-alive does not survive a restore on its own.** After `forceContextRestore`, with the kept pass not re-rendered: 4 links in the following tier changes. Re-rendered: 0.
- **§6.7's two wash-out metrics pass a flood.** Threshold .1 at intensity 3 gave a frame with glow filling every grid cell and a blown-out sun, at near-white .063% and mean chroma 108.7, higher than the clean frame's 92.2. Near-white needs all three channels high, which a magenta glow does not reach, and SCREEN raises the dominant channel, so chroma goes up. Haze lift separates them: 9.8 clean, 13.2 at gain 1.5, 16.1 at gain 2, 33.0 flooded. Threshold .1 at intensity .8 only reached 12.6. (closed by DI-01)
- **`over=4` is a weak near-white control:** .524%, barely over the line. So A16 uses 5.
- **Arctic Laser fails near-white from its disc alone, by day.** Disc top `#FFFFFF`, through `emit(.., 1.05)`, gave .945% with no sticks and .966% with them at exposure 1, and .347% at exposure .88. All other palettes gave under .01%. The image is a flat white disc. Toxic Arcade's `#D1F7FF` and Ultraviolet's `#E0D4FF` pass on the card. T04's plan independently reports 1.463% on a sky-only frame, and 0% with disc top `#D8F6FF`. (closed by DI-02)
- **Saturation is not free against the chroma gate.** Toxic Arcade, already the lowest at 64.6, went to 61.8 at exposure .88, then 55.5 with saturation .95, then 50.3 at .90. That is why T06 applies exposure only.
- **§6.7's "Sky up to .6" is exceeded by two palettes.** `skyGrad(0)` is `.96 * uPal[2]`, luma .76 for Arctic Laser and .71 for Toxic Arcade [arithmetic]. Both stay under the .95 threshold, so no bloom, and this is noted for T11, not fixed. (closed by DI-04)
- **Blend mode is not what writes alpha.** `BlendFunction.NORMAL` on Crt also gave all 255, since `mix(dst, src, 1)` takes `src.a`. So the alpha gate's negative control must change the written alpha, not the blend. With `inputColor.a`: 35,848 of 2,073,600 at 255, minimum 64, matching `Agents.md`.
- **`min` and `noCa` link one program,** since their shader text is identical. Effects add 3 programs, not 4. §6.6's "7 to 8" was two variants.
- **Post draws are `2 * levels + 1`:** 15, 13, 11, 7, and 1 for `bare`, so tier 3 is 13, against §9.2's 14.
- **`renderer.toneMappingExposure` works under the composer.** Flat .2 went from code value 112 to 70 at exposure .5, because `setProgram` refreshes that uniform regardless of `toneMapped`, and no link happened. §6.6's "renderer tone mapping is ignored" is about the mode, not the exposure.
- **Neutral tone mapping crushes near-black grey.** Flat .02 reads as code value 8, because `x < .08` subtracts almost all of `x`. It is why grain's std peaks at 3.46 around there.
- **Scan moire is small with an integer period.** Low-frequency row amplitude at most 0.16 code value through Chromium's own compositing, across DPR 1, 1.25, 1.5 and 2, at pixel ratios 1.333, 1, 0.833, on flat grey. Non-integer periods gave 1.01 (2.5) and 1.20 (2.2), so the detector can fail. Only headless Chromium was tried.
- **Resizing after the draw in the same rAF showed no blank canvas here.** 240 frames with 12 pixel-ratio flips, CDP screencast at about 150 frames, page green behind the canvas: 1 mostly-green frame with resize after the draw, and 1 with it before, so that frame is most likely start-up, not a flip. Other browsers are untested. Deferred application stays, for the lost-context reason in section 11.
- **Shared effects survive a restore.** All four variants were byte-identical to their pre-loss frames, with alpha 255 (one run, simulated loss, §14 row 5). After restore the page logs 30 `console.warn`s, `delete: object does not belong to this context`; they are warnings, so a clean-console gate on errors passes.
- **Speed line quads were invisible until `DoubleSide`.** `cross(dir, v)` gives a winding that depends on the line, so `FrontSide` culled them.
- **A 4-in-100 clustered spike pattern still triggered a downshift,** because a 2 s window of about 105 frames can catch two clusters. A3 uses evenly spread spikes.
- **The display-limit hold can mask real throttling.** Prototype: steady 33.3 ms with boot p95 8 stays at its tier for all 120 s, by §6.10's rule. A phone that throttles after a fast boot and settles to a steady 30 Hz looks identical, yet §10.5 says thermal throttling is handled only by the governor. T06 implements §6.10 as written and reports this. (closed by DI-33)

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| Keep-alive `MipmapBlurPass`, re-rendered in every `precompile` | Removes a mid-game compile on the code path that fires when a device is already struggling. Six lines, and measured [O]. The alternatives (a `BloomEffect` per level count, or editing the private mipmap arrays) go against §6.6's sharing or reach into internals | 2026-11-05 | T06 planner |
| Compile detection by `linkProgram` spy | `info.programs.length` cannot see it [O] | 2026-11-05 | T06 planner |
| `setQuality` and `resize` only record; a flush applies them at the next `frame`, `render` or `precompile` | §3.3 step 15 is not guarded by `contextOk`. `composer.multisampling` during a loss reads `gl.getParameter` and would store 0 [I: `getSafeSamples`]. Deferring avoids GL during a loss, coalesces resizes, and keeps the resize before a draw, as `Agents.md` asks | 2026-11-05 | T06 planner |
| One shared `CrtEffect`; `min` and `bare` set amplitudes to 0 | §6.6's sharing idea extended. Flash and glitch stay cheap and active at every tier, which matters for game feedback. Dynamic branches skip the hash | 2026-11-05 | T06 planner |
| `grainFrame` from `tick`: 24 Hz, 64 s period | §4.5 needs a pure function of tick. Exact integer arithmetic on the CPU rather than `floor(phase * n)` on a float32. Same tick, same grain, which identity tests need | 2026-11-05 | T06 planner |
| uint hash in Crt instead of the prototype's float hash | No precision loss as the seed grows, and GLSL 3.00 is guaranteed. `highp` is three's default for `ShaderMaterial` | 2026-11-05 | T06 planner |
| Scan period `max(2, round(3 * pixelRatio))`, amplitude scaled to keep mean darkening `.10 / 3` | §6.6 says "integer 3 px", tested at DPR 1 only. This keeps about 3 CSS px and an integer buffer period, and a tier change does not shift overall brightness. Both rules passed the moire check [O]; M6 decides by looking | 2026-11-05 | T06 planner |
| Vignette stays the library effect | §6.6 says move it into Crt only if a device misrenders it, and no such device is available. Listed as unverified in section 13 | 2026-11-05 | T06 planner |
| `feel.flash` is an additive accent, scaled to luma .2 | §7.4 and §6.6 do not define it. T02 says "colour only", cap .6. A white mix took chroma to 36.9 [O]. Accent at effective luma .12: 57.7 chroma on Sunset [O] | 2026-11-05 | T06 planner |
| `feel.glitch` is banded `c.brg` by 12 px rows, re-rolled per grain frame | Colour only, so it can merge with CA (`Agents.md`). Starting look, to be judged in M4 | 2026-11-05 | T06 planner |
| §5.4's exposure is `renderer.toneMappingExposure`, owned by T06, lowest at deepest night | §6.6 and §8.1 state this (DI-03). T04 declined it because a sky-only change breaks the fog match, and T06 owns tone mapping. It moves sky, fog and props together. Measured to work, no recompile [O] | 2026-11-05 | T06 planner |
| §5.4's sky saturation is not implemented by T06 | Post could only desaturate the whole frame, neon included, which works against R2: at saturation .95 Toxic Arcade fell to 55.5, at the gate [O]. Palette-level saturation would be T01's. Reported for T11 and the operator to decide (closed by DI-03) | 2026-11-05 | T06 planner |
| Speed lines derive from `uTravel.y` with period 256, with no accumulator | §4.3 and §4.5. Motion matches travel exactly, wraps with no jump, and speed needs no CPU write. Length follows `sim.speed` | 2026-11-05 | T06 planner |
| "Fraction of lines" is a smooth per-line rank fade, not a changing `instanceCount` | T02's meaning, without per-frame pops. Tier still sets the true count, so tiers cut vertices | 2026-11-05 | T06 planner |
| Sun fade per pixel in the fragment shader | `HERO_C` and `HERO_R` come from `COMMON_FRAG`, so nothing is duplicated. §6.1's framing invariant | 2026-11-05 | T06 planner |
| Tier 0 reachable automatically only above 50 ms p95 from tier 1 | §6.10 gives no floor. Dropping a 45 fps machine to 640x360 with almost no props would break R3 for a small R6 gain. `software` is pinned at 0 unless forced | 2026-11-05 | T06 planner |
| Stalls of 1000 ms or more are ignored; histogram percentiles; settle 3 s plus window 2 s | Hidden-tab returns and debugger pauses are not load. A histogram is allocation-free at any refresh rate. The settle makes "one change per 5 s" structural and discards the switch's own hitch [O: fuzz min 5003.7 ms] | 2026-11-05 | T06 planner |
| "Reversed upshift" means a downshift within 30 s | §6.10 does not define it. 30 s allows at most a few decision windows, and later trouble is not blamed on the upshift | 2026-11-05 | T06 planner |
| `forced` beats `software`; missing boot measure is tier 3 and never held | A harness must be able to force tiers on SwiftShader. Tier 3 is §6.10's default | 2026-11-05 | T06 planner |
| Haze lift gate added | §6.7's pair cannot fail on a flood [O]. A gate that cannot fail is not evidence (`Agents.md`). Threshold 20 sits above the measured 13.2 at twice T02's excess gain, and below the 33 flood [A] (closed by DI-01) | 2026-11-05 | T06 planner |
| Arctic Laser's near-white failure is printed, not gated | T06 does not own palettes. Gating would block T06 on T11's decision, and hiding it would bury the finding (superseded by DI-02) | 2026-11-05 | T06 planner |
| Card and dev code under `src/render/fx/dev/`, kept out of the bundle by a test | §12 gives T06 only one spec file and one dev page, and the card must be TypeScript. Nothing outside `dev/` imports it | 2026-11-05 | T06 planner |
| Dev-only `PostOptions` for negative controls | A control must exercise the real code path with one thing changed. Each option is a single branch at boot, none is in a per-frame path | 2026-11-05 | T06 planner |
| Governor implemented and tested from a prototype | Expected event times in A3 come from running the same logic, not from reasoning. The executor writes it again in TypeScript | 2026-11-05 | T06 planner |
| Glitch swaps a band whole, and `feel.glitch` sets how many bands: `if (f > 1. - .28 * uGlitch) c = c.brg` | The plan expected to tune this. A partial mix is what turned the sky and horizon to mud at .35, and T02 holds .35 for 3 s. At 1 the coverage is what it was, 28% of bands. Still colour only, so it still merges with CA. Replaces the starting line in section 5's Crt text | 2026-11-05 | T06 executor |
| Flash: dark surfaces give up their own colour as it arrives. `d = 1. - smoothstep(0., .3, luma); c = c * (1. - uFlash * d) + uFlashColor * uFlash` | A real reject on the plan's list, a frame turning grey, that chroma did not catch. Bright pixels, luma above .3, stay additive, so sun and neon keep their colour. Floor cell saturation .31 to .52, Sunset chroma 57.4 to 61.2 at .6. `FLASH_LUMA` stays .2 and A5 stands. Replaces the starting line in section 5's Crt text. Not a threshold change | 2026-11-05 | T06 executor |
| Scan rule `max(2, round(3 * pixelRatio))` kept after A25 | Both rules passed moire. The rule holds 6 device px across tiers 3 and 4 at DPR 2, while a fixed 3 jumps from 4.5 to 6 on that tier change | 2026-11-05 | T06 executor |
| The line mesh is left visible from `attach` until its first `frame` | Makes precompile render it, so A12's control means what it says. No light is added, since `uLineK` is 0 | 2026-11-05 | T06 executor |
| Card's backward grid left as written | Section 5 says the card is comparable only if built exactly so, and do not polish it. Reported in section 10 | 2026-11-05 | T06 executor |
| `test.beforeEach` skip instead of section 6's describe-level `test.skip` callback | The written form does not type-check. Same behaviour | 2026-11-05 | T06 executor |
| `status: done` with A34 still open | The orchestrator's task text for this batch sets done on the rows that can run now plus `check:task`, and forbids whole-repo runs while siblings are mid-flight. M7's "`done` waits for that" would otherwise block on a run this batch may not make. Per `Agents.md`, a defect found later returns the plan to `in-progress` | 2026-11-05 | T06 executor |
| **Ruling 1, glitch band swap: accepted with a condition, met.** A19e gains chroma preservation against the glitch-0 frame on all six palettes, within 1 code value, and `M4 glitch liveness`, band fractions in `[.06, .14]` at .35 and `[.22, .34]` at 1 | Tightens acceptance, as the reviewer proposed. Preservation is extended from Sunset to all six because a permutation leaves chroma unchanged on any palette (0.00 measured on all six). The ranges are about 3.5 binomial standard deviations around the hash's design rate over 720 bands [A]. Dead, mix, grey and fixed-coverage mutants each fail | 2026-11-05 | T06 executor. V1 asked for the checks (its blocking defect 1 and ruling 1) with no numbers: "about 10%", "about 28%", "within about 1 code value". The ranges and the six-palette scope are the executor's; V2 agreed to them (its A19e ruling, section 14 at 21:19Z) |
| **Ruling 2, flash formula: accepted with a condition, met.** A17 gains a dark-surface saturation floor of .62 on Sunset at flash .6, night and day | Tightens acceptance, as the reviewer proposed ("a dark-surface saturation floor"). The floor sits between the shipped flash's .690 and the additive flash's .560 [A]. A whole-frame lit-saturation floor was measured too and separates less (.499 against .429), so it is printed only. The muted peak frame stays T11's (DI-66) | 2026-11-05 | T06 executor. V1 asked for "a dark-surface saturation floor" (its low defect and ruling 2) with no number. The .62 is the executor's; V2 agreed to it (its A17 ruling, section 14 at 21:19Z) |
| **Ruling 3, card's backward grid: accepted.** Left as written | The reviewer found it hides no gated result. Line direction is now gated on the flat card (A23d), so nothing relies on the scene card for motion. T03's floor sign is T03's | 2026-11-05 | T06 executor; the V1 verifier agreed |
| **Rulings 4 to 6 and 8 to 9: accepted, no change.** Mesh visible until its first `frame`; `beforeEach` skip; scan rule `max(2, round(3 * pixelRatio))`; A33's VACUOUS fail-before read in T00's source, not run; section 7's [O] figures for A17 and A19e describe the starting text | The reviewer reproduced or read each and accepted it as it stands | 2026-11-05 | T06 executor; the V1 verifier agreed |
| **Ruling 7, `done` with A34 open: accepted with a condition, met.** `status` went to `in-progress` for this repair and back to `done` once the repaired rows and `check:task` passed. A34 is still open | The reviewer's condition and DI-64: T10 must not count T06 green until the post-repair whole-repo `check` and `test:browser` run green, which the T00 owner runs after the batch | 2026-11-05 | T06 executor; the V1 verifier agreed; DI-64 |
| **A3 gains three stall rows that fail without the rule** | The reviewer's blocking defect 2 asked for the 40 s row and the repeated 3000 ms row; both are added with its expected outcomes. A third row tests `>=` at exactly `STALL_MS`, mixed with normal frames because a stall-only window is masked by the hold (section 10). The plan's 5000 ms row stays, marked as unable to fail from the rule | 2026-11-05 | T06 executor. V1 asked for the 40 s and repeated 3000 ms rows, with their outcomes (its blocking defect 2). The `STALL_MS` row and the 5000 ms marking are the executor's; V2 agreed to all three rows (its A3 ruling, section 14 at 21:19Z) |
| **A22's sun check: the whole disc in disc radii, 0 pixels over 1 level, at most 16 changed** | The reviewer offered two fixes, 0 changed in the circle or the circle widened to the disc's full radius. This widens to `k <= 1` in the disc's own metric, read from `hero.glsl`, and tightens the count from 0.2% of the circle's 109,845 pixels (about 220, of any size) to none over 1 level and 16 at 1, the plan's same-frame allowance elsewhere. It is stricter than either option alone on count or area. Measured 0 | 2026-11-05 | T06 executor. V1 offered the two fixes (its low defect), not this form or the limit of 16; V2 agreed to both (its A22 ruling, section 14 at 21:19Z) |
| **A23d: line direction gated, one line at a time** | The reviewer suggested the line-pixel radius between local 10 and 10.3. Over all lines at once that radius fell on correct code (section 10), so as suggested it would fail a correct build. A23d keeps the reviewer's measure, radius from the vanishing point growing over a .3 u step, but isolates lines 0 to 5 by instance count over 8 positions. V1 did not review this form; it is a new check, not a moved threshold | 2026-11-05 | T06 executor; V2 accepted it (its A23d ruling, section 14 at 21:19Z) |
| **DI-58 for T06's same-state rows, under DI-68** (was "DI-58 not applied to T06") | The first reason given here, that DI-58 lists its rows and names no T06 row, no longer holds: DI-68 applies DI-58's bound to every same-state compare on `gpu`. T06's same-state rows (A13, A19c ticks 0 and 1, A23's far pair, A29) still keep 16 bytes at most 1 level, which is stricter than DI-58's 64, loosens nothing, and has read 0 in every run. If one of them ever reads 17 to 64 bytes with no byte over 1 level, that row moves to DI-58's bound, and the reading is DI-58's case, not a T06 defect. A byte over 1 level still fails at once, as DI-58 says. On `software` the bound stays 0 (DI-58) | 2026-11-05; amended 2026-11-05T22:00Z | T06 executor; V2's condition on this row (accepted with a condition); DI-68 |
| **A23's far pair and A29 compare bytes at MSAA 0; A29's MSAA 2 is a separate state assertion** | DI-67: through D3D11, blended draws at MSAA 2 or 4 differ between identical renders, up to 173 B for T05. Both rows draw additive lines, and both read 0 at MSAA 2 in every run, but DI-70 rules that a clean run does not show the noise is absent. The compare frames now read `composer.multisampling` 0 at each frame, and that assertion failed on the old form (`[2,2]`, `[2,2,2,2]`) and on a `post.ts` mutant that ignores `forceMsaa`. The restore's own MSAA path is still checked: tier 3 reads 2 after `precompile`. The wrap and step pairs compare different states and keep tier 3's MSAA. No threshold changed | 2026-11-05T22:00Z | T06 executor; V2's low defect 1; ruled by the T00 owner (DI-70) |
| **A3 gains a row: a stall clears the window** | The plan's state machine says `chain = 0; clear window`, and no row failed when the clear was dropped (V2's mutant, 34 of 34 passed). The new row puts 60 slow frames in an open window just before a 40 s stall, so keeping them sheds a tier in the next window. It fails on V2's mutant and on the branch deleted. A new row, no threshold moved | 2026-11-05T22:00Z | T06 executor; V2's low defect 3 |
| **DI-73: A13 and A19c keep their MSAA 2 byte compares and assert the speed lines hidden; A29 gains a coarse MSAA 2 liveness check after the restore** | DI-73 (1) exempts A13 and A19c from DI-67 because nothing blended is drawn there. Each row now reads the speed lines mesh's `visible` at every compared frame, found by `RenderOrder.SPEED_LINES`, and expects false. Mesh state is read rather than pixels, because lines drawn at `feel.speedLines` 0 add no light and leave the bytes at 0 (section 10). DI-73 (3): the byte compare's `forceMsaa(0)` disposes the restored targets, so A29 now compares mean luma and lit count per variant at tier 3's own MSAA 2, before the loss and straight after `precompile`. Limits: within 0.5 luma and 1% of lit pixels, plus a pre-loss frame over half lit, so a dark reference cannot pass. 20 repeats read 0 before the limits were written. DI-67's 173 B bounds the D3D11 noise at .0152 luma and 173 pixels, and a dead target reads -35.7 to -44.2. These are new limits, so no threshold moved. Fail-first: a visible-lines mutant failed A13 and A19c, and two MSAA-only restore mutants failed A29 while every older A29 assertion passed. DI-73 (2) changes no T06 row, since A23 and A29 already force MSAA 0 at their tier | 2026-11-05T22:56Z | T06 executor; ruled by the T00 owner (DI-73), from the R2 reviewer (V3) |
| **DI-64 and DI-66 read for T06** | DI-64: T06 counts as done for T10 only after the post-repair whole-repo run is green. DI-66 carries the V1 flash note (lit saturation .511, Arctic 1.62% and Toxic .91% near-white under flash .6) to T11, so T06 does not re-file it. DI-59 to DI-63 and DI-65 concern other tasks | 2026-11-05 | T06 executor |

## 12. Contract change requests

All additive doc comments. T02's request documents the `FeelState` ranges T06 relies on, so T06 files none for them. All three are **amended**. The text below is a record of what was asked.

**CCR-T06-1. Governor semantics. Amended, C-22; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.** T08 and T10 both call `force`, and neither the return path nor the boot meaning is written down. `src/contracts/index.ts`, above `force(t: Tier | 'auto'): void;`:

```ts
  /** Updates profile at once; the next sample() returns the new tier once, so app/ applies every change in one place. 'auto' keeps the current tier and resumes control. */
```

Above `export type CreateGovernor`:

```ts
/** forced beats software. software pins tier 0 under 'auto'. bootP95Ms is milliseconds of the readPixels-synced boot frames at tier 3; not finite or not above 0 means no measurement. */
```

**CCR-T06-2. PostStack application timing. Amended, C-23; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.** T10, T00's shell and T09 read sizes and call these in a fixed order, and the deferred behaviour is not visible in the types. `src/contracts/index.ts`, above `setQuality(q: Readonly<QualityProfile>): void;` inside `PostStack`:

```ts
  /** setQuality and resize only record. They apply at the start of the next frame, render or precompile, so GL is never touched while the context is lost. resize applies the §6.10 pixel-ratio formula. */
```

Above `rebuild(): void;` inside `PostStack`:

```ts
  /** Cheap and GL-free, safe on every warp. After a context restore, call precompile again as well. */
```

**CCR-T06-3. Who owns exposure. Amended, C-12; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.** §5.4 names no owner, and T04's plan leaves it open. `src/contracts/index.ts`, on its own line above `dayPhase: number;` in `ZoneState`, next to CCR-T04-2's comment:

```ts
  /** T06 applies exposure from dayPhase in post, so sky, fog and props move together. T04 applies it only to stars, nebula, aurora and meteors. */
```

## 13. Outcomes and retrospective

**Result against Purpose,** on the card, on one RTX 4070 SUPER under D3D11 plus SwiftShader for tier 0:

1. Deep colour holds: near-white at most .011%, chroma 61.8 to 116.1 on six palettes night and day, haze lift 7.24 to 10.55. Each limit was shown to fail on its control. I looked at every image the plan lists.
2. Alpha is 255 on every pixel in all four variants at MSAA 0, 2 and 4, with the scene writing .25, and two page colours composite byte-identically.
3. Zero links after boot, across variants, the tier cycle, MSAA, a hidden mesh, and after a simulated restore. Boot links 9 on this scene. After the restore, tier 3's own MSAA 2 targets render live: mean luma and lit count equal their pre-loss values on all four variants, while a dead multisampled target reads -35.7 to -44.2 luma (R3, DI-73).
4. Speed lines streak outward from the vanishing point, which A23d now gates (21 of 21 visible line steps outward, 0 of 21 when reversed). They respect depth, change 0 of 135,798 pixels of the whole disc in `bare`, and are 0 bytes apart at chunk 2^40 and chunk 0. The wrap at 4096 looks like an ordinary step.
5. The tier table exists as data and equals `fakeProfile`. The pure governor matches all of A3's series and the fuzz, and drives the real stack in A31 with 0 links. Four A3 rows now fail when the stall rule is deleted, one when `>=` becomes `>`, and one when a stall keeps the window (V2 repair).
6. The scan period stays an integer at DPR 1, 1.25, 1.5 and 2, with low-frequency amplitude at most .184 code values through Chromium's compositing, and a control at period 2.2 reads .667.

**Gaps:**

- **A34 is not run:** whole-repo `npm run check` and `npm run test:browser` wait for the batch to finish. Until then "the repo is green with T06 in it" is unverified.
- Numbers measured on the card describe the card. T11 owns the real-scene gates.
- A19e's absolute chroma limit cannot fail from glitch. The earlier claim here that it was a regression guard was wrong (V1). Since the V1 repair, A19e's preservation check against the glitch-0 frame and its band count do fail on a dead, mixing, grey or fixed-coverage glitch.
- Near-white under flash .6 exceeds .5% on Arctic by day, 1.62%, and on Toxic it reads .91%, and the peak flash frame's lit saturation is .511 against .904. The plan prints these rather than gating them, since a flash is transient. T11 has them through DI-66.
- A23d's one-line-at-a-time form differs from the form the V1 verifier suggested, which fails correct code. V1 did not review it; V2 did, and accepted it.
- Timing printed here (A7, A26, A30) ran with siblings on the same GPU, so it is contaminated and informational. No `gpu-timing` suite ran, and T06 owns none.
- A29's MSAA 2 liveness check is coarse, as DI-73 asks. It catches a dark or dead multisampled target after a restore, shown by two mutants. Whether a restored target that renders without antialiasing would pass it was not tried; section 10 infers that it would.

**Lessons:** a passing chroma number sat beside a frame the plan's own reject list named, and only looking found it. Twice: the flash and the glitch. Both fixes raised chroma as a side effect, which says the metric was pointing the right way but too weakly. From the V1 repair: a fix found by eye needs its own gate the day it lands, shown failing on the old code. The flash, the glitch and the governor's stall rule each had a test beside them that could not fail from them. The cheapest proof that a row can fail is to delete the line it guards and run it.

**What was not verified.** Human checks, none of which block `done`, and T11's operator pack collects them:

- **HC1.** Any non-RTX GPU or a phone, including the library vignette's reversed `smoothstep` and mediump behaviour.
- **HC2.** Scanline moire in any browser but headless Chromium.
- **HC3.** A real GPU reset. Every restore here is simulated.
- **HC4.** Whether the governor's thresholds suit real devices.
- **HC5.** Whether the display-limit hold masks thermal throttling.
- **HC6.** The look on the real scene.

Also not verified, and not human checks: A34, the whole-repo `check` and `test:browser` after this repair, which DI-64 requires before T10 counts T06 done. Allocation and leaks of the live stack, which are T09's gates. A4 covers only the pure governor and `computePostParams`, so it is narrower than §9. The `VACUOUS` fail-before of A33 was not captured. Flicker in motion was judged only from a strip of 6 stills, not at speed; T09's shimmer and T11's review cover it.

**For other tasks:** T02 and T11: `feel.glitch` now sets how many bands swap, not how hard they swap, and `.35` is 10% of bands. T09: the first `forceVariant('off')` links the direct-to-canvas program of each material it draws, 2 on the card [O]. `off` is not one of the four variants and is outside Purpose 3, but a link-count gate that crosses it must expect this.

## 14. Revision notes

- 2026-11-05T06:34Z Initial draft. No approved revisions.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: C-12, C-22, C-23, S-33, S-42, S-48, S-53, DI-01, DI-02, DI-03, DI-04, DI-16, DI-28, DI-33, DI-36.
- 2026-11-05T09:28Z Independent review, full read of M2 onward and all acceptance rows, with this plan's GLSL compiled and run on D3D11 and SwiftShader in a scratchpad page. Factual corrections, no threshold changed. The card's grid moved out of its `if`, per `Agents.md`, with identical bytes. Keep-alive is 3 draws, not 4. M5's `frame` no longer undoes `setVisible(false)`. A19b's crop, A19c's std and A22's variant now state what makes them passable and able to fail. A23 pins `dayPhase`, and A0 lists `zone`, since exposure otherwise differs across chunks. A19e names its palette. A14 records palette 5's new reading. A3's `16.667` is `1000 / 60`.
- 2026-11-05T10:40Z The T05 approver, while checking DI-51: the sentence under the card cited `Agents.md`'s old branch rule, which DI-51 narrowed to early exits. Wording only. The card, its [O] numbers and every threshold are unchanged, and the status stays `approved`.
- 2026-11-05T15:09Z The T06 executor. Section 5's Crt text remains the starting text. The shipped `crt.frag.glsl` differs on the glitch and flash lines, per the Decision log. Section 6's describe-level skip form is replaced in the spec, per the Decision log. Section 5's M5 gains that the mesh starts visible. No threshold or expected output in section 7 changed. Section 7's [O] figures for A17 and A19e describe the starting text; section 9 has the current ones.
- 2026-11-05T19:38Z Independent verifier V1-T06, review only, no code changed. Verdict: not passed, 2 blocking. Reproduced: `check:task -- T06` exit 0, `contracts:check` exit 0, gpu spec `70 passed, 1 skipped` exit 0, software tier 0 `1 passed` exit 0; numbers match section 9. Blocking 1: A19e is vacuous, since a dead glitch, a `mix` glitch (Sunset .35 at 73.1) and grey bands (Sunset 61.1) all pass it, so section 10's "regression guard" claim is wrong. Blocking 2: A3's stall row is vacuous, since removing the `ms >= STALL_MS` branch passes all 31 governor tests, while a 40 s stall at tier 3 then upshifts at once without the branch. Rulings: glitch band swap accepted, on condition that A19e gains a liveness and chroma-preservation check; flash formula accepted, on condition of a guard A17 lacks, since an additive flash still reads 57.4; card's backward grid accepted, since no gate reads its motion, but line direction is checked only by eye (reversed lines pass all of M5); mesh visible until first `frame` accepted; `beforeEach` skip accepted; scan rule accepted; `done` with A34 open accepted, on condition that T10 does not count T06 green before A34; A33's uncaptured VACUOUS fail-before accepted as T00's mechanism, read in source and not run. For T11: flash .6 near-white on Arctic by day is 1.62% and on Toxic .91%, and lit saturation falls from .90 to .51.
- 2026-11-05T20:25Z The T06 executor, repairing V1's verdict. `status` set to `in-progress` at 20:10Z and back to `done` once the repaired rows and `check:task` passed. **No source file under `src/render/fx` changed** except `dev/metrics.ts`, which gains four pure metrics; the Crt, speed lines and governor are byte-identical to what V1 reviewed. Section 7 changes, each tightening acceptance and logged in section 11 with the reviewer named: A3 gains three stall rows and marks the 5000 ms row as unable to fail from the rule; A17 gains a dark-surface saturation floor; A19e gains preservation against the glitch-0 frame on all six palettes and a band-count liveness test; A22's sun check covers the whole disc in disc radii, with no pixel over 1 level and at most 16 changed; new row A23d gates line direction; A6 lists the new metrics. Section 10's "regression guard" claim and section 13's matching gap are corrected. T00-owner decisions: DI-58 does not name T06 and is not applied; DI-64 keeps A34 open as the condition for T10; DI-66 carries V1's flash note to T11. Every new check was shown failing on a mutant of the file it guards, and each mutant was restored by hash.
- 2026-11-05T21:19Z Independent verifier V2-T06, review only, no code changed. **Verdict: passed, no blocking defect.** Reproduced: `check:task -- T06` exit 0 (103 tests), `contracts:check` and `plans:check` exit 0, gpu spec `72 passed, 1 skipped` exit 0, software tier 0 `1 passed` exit 0, all printed values equal to section 9. Only `dev/metrics.ts`, `governor.test.ts`, `metrics.test.ts` and `fx.spec.ts` differ from V1's hashes. Every repair claim reproduced by mutation, each file restored to its start hash: stall branch deleted (3 rows fail), `>` for `>=` (1), stall without `chain = 0` (1); glitch dead, mix, grey, fixed coverage, and a new half-swap mutant all fail A19e; additive flash fails A17 at .560; reversed lines 0 of 21 and frozen lines 0 of 24 fail A23d; both sun-fade mutants fail A22. Rulings: A3's three stall rows, accepted, each fails without the code it guards; A17's dark-surface floor .62, accepted, it sits between .690 and the additive .560; A19e's preservation within 1 on six palettes and liveness ranges, accepted, the hash is deterministic so the ranges cannot flake; A22's whole-disc check, accepted, stricter than V1's either option; A23d's one-line form, accepted, because the all-lines radius really falls on correct code (V2 probe, 10 to 10.3: -0.683 px in `full`, -1.43 in `bare`) while A23d read 21 of 21 identically over 6 runs, smallest counted margin +0.388 px; "DI-58 not applied", accepted with a condition, since DI-68 now applies DI-58 to every same-state compare, so a 17 to 64 byte one-level reading on A13, A19c, A23 or A29 is DI-58's case and moves that row to DI-58's bound, not a T06 defect. Low, for the T00 owner: A29 and A23's far pair compare at MSAA 2 with additive lines, against DI-67's MSAA 0 rule, though they read 0 bytes in 6 runs. Low, T06: a stall that skips `clearWindow()` passes every A3 row. Section 11 credits V1 with agreeing to numbers V1 never saw; this note supplies that agreement. A34 stays open under DI-64.
- 2026-11-05T22:03Z The T06 executor, repairing V2's four low items. `status` was `in-progress` from 21:55Z and is now `done` again. **No source file under `src/render/fx` changed**; only `fx.spec.ts` and `governor.test.ts` did. Section 7: A23's far pair and A29's byte compares run at MSAA 0 under DI-67 and DI-70, with A29's MSAA 2 kept as a separate state assertion; A3 gains a row in which a stall must clear the window. No threshold moved. Section 11: the DI-58 row cites DI-68 with V2's condition, and the rows that credited V1 with agreeing to numbers it never saw now name V1's request and V2's agreement. Each new check failed first, on the old form or a mutant (V2's `clearWindow` mutant, the stall branch deleted, `forceMsaa` ignored), and each mutated file was restored to its start hash. Left for the T00 owner: A13 and A19c also compare one state at MSAA 2, with no blended draw [I] (section 10).
- 2026-11-05T22:58Z The T06 executor, applying DI-73 items 1 and 3 (the T00 owner's ruling on V3's review). `status` was `in-progress` from 22:47Z and is now `done` again. **No source file under `src/render/fx` changed**; only `fx.spec.ts` did. Section 7: A13 and A19c keep their MSAA 2 byte compares under DI-73's exemption, and each now asserts the speed lines mesh hidden at every compared frame. A29 gains a coarse MSAA 2 liveness check after the restore: per variant, within 0.5 mean luma and 1% of lit pixels of the pre-loss MSAA 2 frame, with the reference over half lit. These limits are new. They were set after 20 measured repeats, and the arithmetic is in A29's row. No existing threshold moved. Each new check failed first: A13 and A19c on a visible-lines mutant of `speedLines.ts`, and A29 on two MSAA-only restore mutants of `post.ts`, under which every older A29 assertion still passed. Each mutated file was restored to its start sha256. DI-73 (2) needs no change, since A23's far pair and A29 already force MSAA 0 at their tier. Sections 9, 10, 11 and 13 record the runs, the findings, the decision and the remaining gap. A34 stays open under DI-64.
