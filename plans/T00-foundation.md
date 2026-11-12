---
id: T00-foundation
title: Foundation - scaffold, contracts, core, fakes, browser discovery and gates
status: done
owner: T00 executor
depends_on: []
owns: [package.json, package-lock.json, tsconfig*.json, vite.config.ts, vitest.config.ts, playwright.config.ts, eslint.config.js, .gitignore, scripts/**, src/contracts/**, src/core/**, src/testing/**, tests/support/**, tests/boundaries/**, tests/unit/core/**, plans/README.md, plans/T00-foundation.md]
reads: [architecture.md, Agents.md, plans/**]
updated: 2026-11-12T18:14Z
---

## 1. Purpose

After T00, the folder installs from a lockfile and nine parallel executors can start without touching each other. Observable outcomes:

1. `npm ci` reproduces the exact pins of §2, and `npm audit --omit=dev` reports 0 vulnerabilities.
2. `src/contracts/**`, `src/core/coords.ts` and `tests/support/browser.ts` match the text of §8 and §11.1, and a gate proves it.
3. A forbidden import fails lint, a banned GLSL token fails the grep gate, an overlapping plan fails `plans:check`, and a broken sibling file does **not** fail another task's `check:task`, while a broken owned file does. Each of those has a negative control.
4. A 1080p screenshot taken on the real GPU through `startDevShell` shows a gradient sky, a banded sun and a magenta grid drawn only from the contract GLSL, and the executor has opened that image and described it. T03 to T06 use the same shell for their own screenshots before integration.
5. All four Playwright projects launch and each asserts it got the rasterizer it claims.
6. A production bundle of three, postprocessing and the contract GLSL builds with relative URLs and runs from a nested path.

## 2. Context and orientation

The working directory for every command is `C:\highsierralabs\terrain`. It is not a git repository, and `Agents.md` forbids `git init`. Nothing exists yet except `architecture.md`, `Agents.md`, `plans/` and `.claude/workflows/`, which belongs to no task. `§n` means a section of `architecture.md`.

Terms used here:

- **Owned path:** a path matched by the `owns` list in a plan's frontmatter.
- **Gate:** a command that exits non-zero when a rule is broken. **Negative control:** a run that must fail, proving the gate can fail.
- **Fixture tree:** a small self-contained project under `tests/boundaries/fixtures/`, excluded from the root tsconfig, ESLint, Vitest and Playwright, used to exercise a gate.
- **Dev shell:** `startDevShell` in `src/testing/devShell.ts`, which hosts render layers on the fake world in a browser page. **DevPost:** the default post stack the shell uses when no `PostStack` is passed.
- **Armed later:** a suite whose tests other tasks write. T00 defines the script, and it reports "No tests found" until then.

**Where the evidence comes from.** Every `[O]` below was run on 2026-11-05 in a throwaway scaffold in the session scratchpad, with the §2 pins installed through npm from an exact `package.json`, on Node 24.14.1 and npm 11.11.0, on the RTX 4070 SUPER and SwiftShader. That scaffold is not part of the project and may be gone, so none of it counts as acceptance. The executor runs everything again. `createFakeWorld`, `scriptedFrame`, `createFakeHost`, `alloc.ts`, `uniforms.ts` and `motion.ts` were not rehearsed beyond what is stated; treat their details as design [A] until the tests in §7 pass.

Environment facts [O]: cached browsers are `chromium-1234` and `chromium_headless_shell-1234` under `%LOCALAPPDATA%\ms-playwright`. The npm registry was reachable. Node 24.14.1 runs `.ts` files directly with no flag or warning.

## 3. Scope

**Owned, and the complete file list:**

| Path | Contents |
|---|---|
| `package.json`, `package-lock.json`, `.gitignore` | M1 |
| `tsconfig.json`, `tsconfig.node.json` | Browser code, then tests, scripts and configs |
| `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js` | M1, M4, M5 |
| `scripts/lib/plans.ts` | Frontmatter parser, owned-glob expansion, glob intersection, §12 row parser |
| `scripts/contracts-check.ts`, `scripts/glsl-gate.ts`, `scripts/check-task.ts`, `scripts/plans-check.ts` | Gates |
| `src/contracts/index.ts`, `glsl.ts`, `glsl/common.glsl`, `glsl/common.frag.glsl`, `glsl/hero.glsl` | §8, verbatim |
| `src/core/coords.ts`, `hash.ts`, `motion.ts`, `uniforms.ts`, `alloc.ts` | `coords.ts` §8.1 verbatim; the others per §8.1's signature fence and M3 |
| `src/testing/index.ts`, `fakeWorld.ts`, `scriptedFrame.ts`, `fakeHost.ts`, `devShell.ts`, `devPost.ts` | Fakes and shell |
| `tests/support/browser.ts`, `rasterizer.ts`, `pw.ts` | §11.1 verbatim, the renderer classifier, the Playwright fixture |
| `tests/support/devshell/` | `smoke.html`, `fakehost.html`, `blank.html`, `trivialLayer.ts`, `devshell.spec.ts`, `raster.spec.ts`, `fakehost.spec.ts`, `timing.timing.spec.ts`, `fallback.nowebgl.spec.ts`, and A11f's child run: `consoleguard.control.ts`, `consoleguard.config.ts` |
| `tests/support/buildproof/` | `index.html`, `main.ts`, `vite.config.ts`, `buildproof.spec.ts` |
| `tests/boundaries/` | `boundaries.test.ts`, `gates.test.ts`, `contracts.test.ts`, `pins.test.ts`, `rasterizer.test.ts`, `fixtures/` |
| `tests/unit/core/` | `coords`, `hash`, `motion`, `uniforms`, `alloc`, `fakeWorld`, `scriptedFrame`, `fakeHost`, `devPost` `.test.ts` |
| `plans/README.md`, `plans/T00-foundation.md` | Index and this plan |

**Read-only:** `architecture.md`, `Agents.md`, all other plans.

**Non-goals:**

- T00 creates no other task's path: no `dev/`, `index.html`, `src/main.ts`, `src/world/`, `src/sim/`, `src/feel/`, `src/render/`, `src/audio/`, `src/ui/`, `src/input/`, `src/harness/`, `src/app/`, `tests/visual/`, `tests/forever/`, `tests/perf/`, `tests/e2e/` or `tests/art/`. Not even empty ones or stubs.
- No terrain, sky, props or post look. The proof layer and DevPost exist only to prove the shell and to give T03 to T05 a faithful picture.
- No real noise, palette crossfade, tier table or governor. Those are T01 and T06.
- No editing of `architecture.md` or `Agents.md`. Findings go to the T00 owner or the operator through section 10 and the report (DI-25).

## 4. Interfaces

**Consumed:** third-party packages only.

**Provided, frozen text:** `src/contracts/index.ts`, `src/contracts/glsl.ts`, `src/contracts/glsl/*.glsl`, `src/core/coords.ts`, `tests/support/browser.ts`, exactly as in §8 and §11.1.

**Provided, per §8.1's signature fence (C-06).** §8.1 wins on any difference. `tests/support` is not in §8.1, so this block is its only statement.

```ts
// src/core/hash.ts, motion.ts, uniforms.ts, alloc.ts: signatures per §8.1's signature fence, semantics in M3.
// src/testing/fakeWorld.ts -- imports no three
export interface FakeWorldOptions { seed?: number; periodChunks?: number; archetypes?: readonly Archetype[]; items?: readonly ItemKind[] }
export function createFakeWorld(o?: FakeWorldOptions): WorldSource;

// src/testing/scriptedFrame.ts -- imports no three, so T07 and T08 dev pages can use it
export interface ScriptedEvent { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
export interface ScriptedFrameOptions {
  at?: Travel; tick?: number; palette?: number; biome?: number; hero?: HeroMode;
  bend?: { a: number; c: number }; feel?: Partial<FeelState>; sim?: Partial<SimState>;
  tier?: Tier; reducedMotion?: boolean; events?: readonly ScriptedEvent[]; world?: WorldSource;
  camX?: number; camY?: number;   // render-space; default as §6.1 from sim.x and sim.y, with gain 0.72
  /** Applied last, after palette, biome and hero. For testing crossfades and day phase. */
  zone?: Partial<Pick<ZoneState, 'index' | 'biomeA' | 'biomeB' | 'biomeMix' | 'heroA' | 'heroB' | 'heroMix' | 'dayPhase'>>;
}
export function scriptedFrame(t: number, o?: ScriptedFrameOptions): FrameView;
export function fakeProfile(t: Tier): QualityProfile;   // equal field by field to T06's table

// src/testing/fakeHost.ts. Its sim: warpTo obeys canWarp, updates state.travel, and raises warpSerial only on success; step advances travel by SPEED_CRUISE / SIM_HZ, sets stepDist and raises tick; forceSignalLost exists.
export interface FakeHostCalls {
  setManual: boolean[]; runFrame: number[]; renderState: [number, number, number][];
  overrideZone: unknown[]; overrideBend: unknown[]; overrideFov: (number | null)[]; overrideFeel: unknown[];
  forceVariant: unknown[]; forceMsaa: unknown[]; layerVisible: [LayerName, boolean][]; debugMode: [LayerName, DebugMode][];
  governorForce: (Tier | 'auto')[];
}
export interface FakeHost extends HarnessHost { readonly calls: FakeHostCalls }
export function createFakeHost(): FakeHost;

// src/testing/devShell.ts -- three and postprocessing allowed
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
export function startDevShell(layers: RenderLayer[], post?: PostStack, o?: DevShellOptions): DevShell;
declare global { interface Window { __shell?: DevShell } }
// Query string read by the shell: ?manual=1 ?tier=0..4 ?post=off ?t=<seconds> ?palette=0..5 ?biome=0..5 ?hero=0..3

// src/testing/devPost.ts
export function createDevPost(): PostStack;      // setQuality and resize record and apply later, like the real PostStack
// src/testing/index.ts re-exports everything above. Importing it pulls three and postprocessing, which load in Node [O].

// tests/support/devshell/trivialLayer.ts -- T09's shell target loads it (S-55)
export function createTrivialLayer(): RenderLayer;

// tests/support/rasterizer.ts -- no Playwright import, unit-tested
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
export function checkRasterizer(project: string, webgl2: boolean, renderer: string): string | null;   // null = correct

// tests/support/pw.ts
export const test;                               // playwright/test plus an auto fixture and option allowConsoleErrors (default false)
export { expect };
export async function openDevPage(page: Page, path: string, query?: Record<string, string | number>): Promise<void>;
export async function expectRasterizer(page: Page, info: TestInfo): Promise<void>;
export async function saveShot(page: Page, info: TestInfo, name: string): Promise<string>;   // prints "SCREENSHOT <absolute path>"
```

**`scriptedFrame` options.** `o.hero` sets `heroA = heroB = hero`, `heroMix = 0`. `o.biome` sets `biomeA = biomeB = biome`, `biomeMix = 0`. `o.palette` writes the §6.8 table. `o.sim` overrides win over derived values, including `beat`, `sync`, `mode`, `speed`. `o.camX` and `o.camY` override the derived camera. `o.zone` is applied last.

The auto fixture fulfils `**/favicon.ico` with 204, collects `console.error` and `pageerror`, and fails the test at teardown if any appeared, unless `test.use({ allowConsoleErrors: true })`. `openDevPage` navigates, waits for `window.__shell.ready`, fails early on any shader error, and calls `expectRasterizer`.

**Conventions other tasks rely on:**

| Topic | Rule |
|---|---|
| Dev page | Plain HTML with an inline `<script type="module">` importing `/src/testing/devShell.ts` and the module's own `/src/render/<name>/index.ts` [O: inline module with `/src/...` imports served correctly by Vite 8]. Inline scripts are not type-checked, so keep them to a few lines. A literal `import()` of a path another task may not have written yet fails the page's whole inline module with a 500, for every query and even on a branch that never runs, and `/* @vite-ignore */` on the literal does not help [O]. The document itself still returns 200, so the visible symptom is `window.__shell` never appearing. Use a variable specifier with `/* @vite-ignore */`: `const p = '/src/world/index.ts'; await import(/* @vite-ignore */ p)` |
| Spec imports | `import { test, expect, openDevPage, saveShot } from '../support/pw'` |
| Pages with no shell | `test`, `expect`, `saveShot` work on any page. The auto fixture adds no `evaluate` before a test's own actions. `console.warn` and `console.info` do not fail a test. `openDevPage` is for shell pages only; three-free pages use `page.goto` |
| Project routing by file name | `*.timing.spec.ts` runs only under `gpu-timing`. `*.nowebgl.spec.ts` runs only under `no-webgl`. Every other `*.spec.ts` can run under `gpu` or `software`, and the npm script picks which |
| Ports and output | `$env:TERRAIN_PORT = '51NN'` and `--output=test-results/T##`. With no flag, output goes to `test-results/default`, so a stray run cannot wipe a sibling's folder [O] |
| Reference images | `test-refs/` (gitignored), per machine, through `snapshotPathTemplate` |

**Seams.** Places where another task must assume the same meaning. Reconciled on 2026-11-05 (`plans/RECONCILIATION.md`). Where a row and §8 differ, §8 wins.

| Other task | Topic | T00's assumption |
|---|---|---|
| T01, T02, T05 | Prop and item records | See `PropField` and `ItemField` in §8.1. |
| T01 | `hash01` inputs | `a`, `b` integer-valued. `periodChunks` reduction happens before the call. A value in `[1 - 2^-25, 1)` rounds to 1.0 when stored in a `Float32Array`, so `keep` must be clamped with `Math.min(v, 0.99999994)` to keep `[0, 1)` true |
| T02, T05 | Motion | `trafficOffset` returns u added to `zLocal`, in `[0, travel)`, in the forward direction, so a car moves with the player. `droneOffset` returns u added to `x`. `phase` is the `[0, 1)` value of the phase index in `ItemField`. The sim passes alpha 0 phases from the tick; render passes `uPhases` |
| T02, T06, T10 | Neutral `FeelState` | `shakeX`, `shakeY`, `roll` radians, 0. `fovDeg` = 58. `aberration` 0. `flash` 0. `speedLines` in `[0, 1]`, 0. `bloomGain` is a multiplier, neutral 1. `duck`, `shipHold`, `glitch` 0 |
| T02, T10 | Camera pose (C-03) | `position = (camX, camY, 0)`. `rotation.set(CAMERA_PITCH + shakeY, shakeX, roll)` in three's default XYZ order. `fov = min(fovDeg, 2 * atan(CAMERA_HALF_TAN_MAX / aspect) * 180 / PI)`. `shakeX` is therefore a small transient yaw. §6.1 states this (S-40) |
| T02, T07, T08 | `SimState` scales | `beat = tick / 72`, fractional. `overdrive` in `[0, 1]`. `sync` integer 1 to 16. `shields` integer 0 to 3. `ghost` seconds remaining |
| T10 | `writeSharedUniforms` | Writes `uTravel = (cam.local, travelMod(cam, 4096))`, `uCamRow = rowMod(cam.chunk)`, `uPhases` from `v.phases`, `uBend`, `uPal` from `v.zone.palette`, `uHero = (heroA, heroB, heroMix)`, all in place. `uFog` stays as created. **When `v.reducedMotion` is true it writes `uBend = (0, 0, vMax)`**, so §10.3's "bend off" lives here and no layer or app code repeats it |
| T03, T04, T05, T06, T10 | Layer lifecycle | `attach(ctx)` in array order, `setQuality(q)`, then `post.attach`, `post.setQuality`, `post.resize`, `await post.precompile()`, then `rebuild(v)` once on every layer before the first `frame(v)`. Each frame: `renderer.info.reset()`, `writeSharedUniforms`, camera, `frame(v)` per layer, `post.frame(v)`, `post.render(dt)`. T10 must use the same boot order, including the first `rebuild`, and after timed boot frames may call `setQuality` and `rebuild` once more (§8.1) |
| T03, T05 | Non-monotonic frames | When `frameAt` moves the camera backwards or forwards by more than 64 u, the shell increments `warpSerial` and calls every `rebuild(v)` first, as §3.3 step 10 does. Ordinary forward steps never rebuild |
| T03, T05 | No `post` argument | DevPost renders with HDR half-float, MSAA from the profile, Bloom and Neutral tone mapping at §6.6 values, a final alpha-1 write, `dithering = true`, `timeScale = 0`. No CA, Crt or vignette. So T03 to T05 shots lack scanlines and grain, and T06 and T11 own the final look |
| T06, T10 | Resize ownership | `PostStack.resize(cssW, cssH, dpr)` records. At the next `frame`, `render` or `precompile` it applies the §6.10 pixel-ratio formula and calls `renderer.setPixelRatio`, `renderer.setSize` and `composer.setSize` together (C-23). The shell and T10 call only `post.resize`. Layers never resize |
| T06, T10 | `renderer.info.reset()` | Called once per frame by the frame owner (shell or `app/loop`), not by `PostStack` |
| T06 | Tier values | `fakeProfile` copies §6.10 with exact pixel counts (3686400, 2073600, 1440000, 921600, 230400). §6.10 states this (S-42). T06 owns the real table, and the fake equals it field by field (§8.1). T11 may edit the fake's table under the pin rule (§12) |
| T06, T10 | Software detection | The string to match comes from `WEBGL_debug_renderer_info`. `gl.RENDERER` returned `WebKit WebGL` on both rasterizers [O] and would never match. T10 computes `software` for `CreateGovernor` from the unmasked string |
| T09 | `createFakeHost` | Works in Node and in a browser. `ctx.renderer` is real when `document` exists, and a minimal stub otherwise (`info`, `getContext`, `domElement`, `setRenderTarget`, `compile`, `render`). `renderState(chunk, local, tick)` draws one fullscreen triangle whose colour is a pure function of `(rowMod(chunk) mod 1024, local, tick)`, so distant equal states are pixel-identical, unequal ones are not. Fake layers and post only record into `calls`, and the fake sim follows M6. T09 has no `dev/` page in §12, so a browser page for it lives under its own `tests/forever/` or `tests/perf/` |
| T09, T10 | `renderState` alpha | Alpha 0 means `view.cam` equals `(chunk, local)` exactly and `phases[i] = (tick % P[i]) / P[i]`. `scriptedFrame(t, { at, tick })` follows the same rule |
| T09 | Spec names | `tests/forever/soak.timing.spec.ts` style for anything needing `gpu-timing`. Plain `*.spec.ts` under `tests/perf/` runs under `software` in `test:perf` |
| T09, T03, T06 | Post-on identity | A repeated identical frame with post on can differ by one byte by 1/255 on the RTX, cause unknown [O]. Post off differed by 0. See section 10 |
| T10 | Fallback and favicon | Fallback e2e lives in `tests/e2e/fallback.nowebgl.spec.ts`. `index.html` should carry `<link rel="icon" href="data:,">`, since the network and console gates otherwise see a favicon 404 [O]. Under `no-webgl`, calling `new WebGLRenderer` logs `console.error` before it throws [O], so `main.ts` must pre-check, as §10.1 says |
| T10 | Build scripts | `npm run build` and `preview` work only once T10 creates `index.html`. Until then `build` fails with `[UNRESOLVED_ENTRY]` [O] |
| T11 | Numeric retune | `contracts-check` allows `FOG_START`, `FOG_END` and `DEFAULT_SEED` to change value. Any other numeric retune needs that allowlist extended by the T00 owner in the same amendment |
| T11 | Section 6.8 palette | T11 retunes `src/world/palettes.ts`, which nothing of T00's reads. `fakeWorld.test.ts` compares `PALETTE_HEX` with §6.8 in `architecture.md`, so a retune alone fails nothing here. When the T00 owner applies T11's deviation register to §6.8, `PALETTE_HEX` in `src/testing/fakeWorld.ts` must change in the same amendment, or `npm run check` goes red |
| T04 | `hero.glsl` hand-off | T00 ships §8.2's text. Once T00 is `done`, T04 owns the file. `contracts-check` then only requires the lines `const vec2  HERO_C = vec2(0., .125);`, `const float HERO_R = .215;` and `vec4 sunDisc(vec3 rd, float yScale) {` |
| T07, T08 | Dev pages | Import `/src/testing/scriptedFrame.ts` directly, not the barrel, so three is not loaded |

## 5. Plan of work

Milestones run in order. Each can be verified alone.

### M0. Confirm the reconciled contract text

**Goal:** the contract text to ship is settled before any file exists. **Work:** every approved request is already in §8's text; section 12 is the record. Read section 12. A request filed since and still `open` blocks M2, and the plan goes `blocked` with the reason in Progress. **Result:** nothing is applied by hand. **Proof:** section 12 has no `open` row.

### M1. Scaffold and install

**Goal:** the exact toolchain installs from a lockfile. **Work:**

`package.json`:

```json
{
  "name": "midnight-vector", "version": "0.0.0", "private": true, "type": "module",
  "engines": { "node": ">=24.14.1 <25" },
  "dependencies": { "postprocessing": "6.39.6", "three": "0.187.0" },
  "devDependencies": {
    "@types/node": "24.19.2", "@types/three": "0.187.0", "eslint": "10.14.0", "playwright": "1.64.1",
    "typescript": "6.0.3", "typescript-eslint": "8.72.1", "vite": "8.3.5", "vitest": "5.1.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run",
    "glsl:check": "node scripts/glsl-gate.ts",
    "contracts:check": "node scripts/contracts-check.ts",
    "check": "npm run typecheck && npm run lint && npm test && npm run glsl:check",
    "check:task": "node scripts/check-task.ts",
    "plans:check": "node scripts/plans-check.ts",
    "build:proof": "vite build --config tests/support/buildproof/vite.config.ts",
    "test:foundation": "playwright test tests/support --project=gpu --project=gpu-timing --project=software --project=no-webgl",
    "test:smoke": "playwright test tests/e2e --project=gpu",
    "test:browser": "playwright test tests/support tests/visual tests/e2e --project=gpu --project=no-webgl",
    "test:forever": "playwright test tests/forever --project=gpu --project=gpu-timing",
    "test:perf": "playwright test tests/perf --project=gpu-timing --project=software",
    "test:art": "playwright test tests/art --project=gpu"
  }
}
```

`.gitignore`: `node_modules/`, `dist/`, `test-results/`, `test-refs/`, `playwright-report/`, `*.tsbuildinfo`.

`tsconfig.json` is §8.3 verbatim plus `"include": ["src/**/*.ts"]`. `tsconfig.node.json`:

```json
{ "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "node"], "allowImportingTsExtensions": true },
  "include": ["tests/**/*.ts", "scripts/**/*.ts", "*.config.ts"],
  "exclude": ["tests/boundaries/fixtures/**"] }
```

`vite.config.ts`: `base: './'`, `appType: 'mpa'` (a wrong dev path is a 404 rather than a silent SPA fallback), `optimizeDeps.include: ['three', 'postprocessing']` (no reload on first import), `server` and `preview` with `host: '127.0.0.1'`, `strictPort: true`, `port` from `TERRAIN_PORT`, then from a `--port` in `process.argv`, then 5100. `cacheDir: node_modules/.vite/p<port>`, so parallel servers do not share an optimizer folder [O: two concurrent servers on 5191 and 5192, each with its own folder]. No `rollupOptions` or `esbuild` keys.

`vitest.config.ts`: `environment: 'node'`, `testTimeout: 30_000` (section 11), `include: ['tests/unit/**/*.test.ts', 'tests/boundaries/*.test.ts']`, `exclude: ['tests/boundaries/fixtures/**', 'node_modules/**']`, `cacheDir: node_modules/.vite/vitest-${TERRAIN_TASK ?? 'all'}`.

**Result:** `node_modules` from the lockfile. **Proof:** A1 and A2. The other configs land at the milestones that exercise them, but each config file should exist before the next milestone needs it.

### M2. Contracts and the verbatim gate

**Goal:** the contract files equal §8 and §11.1, with no retyping. **Work:** write `scripts/contracts-check.ts`:

- Parse fences in `architecture.md` with `/^```(\w+)\n([\s\S]*?)^```$/gm`. A fence whose first line matches `/^\/\/ (src\/\S+|tests\/\S+)/` belongs to that path. Seven fences match [O]. The new signature fence is not extracted, because its first line names no file.
- `--extract` writes any of the seven files that does not exist, as LF UTF-8 with no BOM, and refuses to overwrite one that exists.
- Default mode exports `checkAdditive(archText, fileText, numericAllow): { ok, present, added, problems }`: every non-blank line of the fence must appear in the file in the same order. Extra lines are allowed and counted. On a line `export const NAME = <number>;` with `NAME` in the allowlist (`FOG_START`, `FOG_END`, `DEFAULT_SEED`), only the name is compared. `hero.glsl` is checked only for the three signature lines in section 4.
- Print one line per file (`src/contracts/index.ts: N lines present in order, 0 added`) and exit 1 on any problem.

Run `--extract`. Every approved request is already in §8's text, so `added` is 0. **Result:** the contracts exist and type-check. **Proof:** A3 and A4. §8.1 and §8.2 as reconciled compiled with zero diagnostics under the §8.3 options [O: ledger, `tsc` 6.0.3]. The text before reconciliation passed lint under the M4 rules [O]; the reconciled text has not been linted.

### M3. Core

**Goal:** the pure shared helpers. **Work:**

- `coords.ts`: already extracted, do not edit.
- `hash.ts`, exact text, because T01's golden hash depends on it:

```ts
const W32 = 4294967296;
function absorb(h: number, w: number): number {
  let k = Math.imul(w, 0xCC9E2D51);
  k = (k << 15) | (k >>> 17);
  h ^= Math.imul(k, 0x1B873593);
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xE6546B64) | 0;
}
/** Uniform in [0, 1). Exact in chunk up to 2^53: the high and low words are hashed separately. */
export function hash01(seed: number, chunk: number, a: number, b: number): number {
  let h = (seed % W32) ^ Math.imul(Math.floor(seed / W32), 0x27D4EB2F);
  h = absorb(h, chunk % W32);
  h = absorb(h, Math.floor(chunk / W32));
  h = absorb(h, a);
  h = absorb(h, b);
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return (h >>> 0) / W32;
}
```

Measured [O]: chi-squared over 256 bins and 1e6 draws gave 232 to 309 across chunk, a, b and seed sweeps, including chunk bases up to 2^48 (df 255, so mean 255, sd about 23; a single fixed draw, not a calibrated test). Neighbour correlations were all under 0.002 in magnitude, worst avalanche deviation from 0.5 was 0.0016 over chunk bits 0 to 47, and a call took 25 ns.

Goldens, which `hash.test.ts` asserts with `toBe`:

| Arguments (seed, chunk, a, b) | Value |
|---|---|
| 1985, 0, 0, 0 | 0.5741655419114977 |
| 1985, 1, 0, 0 | 0.23195873759686947 |
| 1985, 0, 1, 0 | 0.35482506174594164 |
| 1985, 0, 0, 1 | 0.06773243471980095 |
| 1986, 0, 0, 0 | 0.033974359510466456 |
| 1985, 2^32, 0, 0 | 0.19808156415820122 |
| 1985, 2^40 + 3, 19, 127 | 0.3153043582569808 |
| 1985, 2^48 - 1025, 5, 9 | 0.3606241049710661 |
| 2^40, 7, 2, 3 | 0.012779665645211935 |

- `motion.ts`: `TAU` as a local constant. `trafficOffset(travel, k, seed, phase)` returns `travel * fract(k * phase + seed)`, with JS `fract(x) = x - Math.floor(x)`. `droneOffset(amp, k, seed, phase)` returns `amp * Math.sin(TAU * (k * phase + seed))`. These are the same expressions as the §5.8 GLSL lines, in the same order, with no reordering or factoring, so a shader line reads identically. Also `phaseOf(tick, alpha, i)` and `writePhases(tick, alpha, out)`, from §4.5. Doc comments quote the GLSL twin.
- `uniforms.ts`: `createSharedUniforms()` allocates `uTravel` 2, `uPhases` 8, `uBend` 3, `uPal` 21, `uFog` 2 (`FOG_START`, `FOG_END`), `uHero` 3 floats. `writeSharedUniforms(v, out)` per the seam table, no allocation, never replacing a `value`. Also `CameraPose`, `cameraFov(fovDeg, aspect)` and `writeCameraPose(v, aspect, out)`.
- `alloc.ts` per §8.1's signature fence. `tests/unit/core/*` as listed in A5.

**Result:** core complete and tested. **Proof:** A5.

### M4. Lint boundaries, GLSL gate, `check:task`, `plans:check`

**Goal:** each rule is enforced and each gate is shown able to fail.

**ESLint** (`eslint.config.js`, flat, using `tseslint.config`). Ignore `.claude/**`, `dist/**`, `node_modules/**`, `test-results/**`, `test-refs/**`, `playwright-report/**`, `tests/boundaries/fixtures/**`. Use `tseslint.configs.recommended` (not type-aware, so a sibling's half-written file cannot break it). Turn `@typescript-eslint/no-non-null-assertion` off. Ban enums with `no-restricted-syntax` on `TSEnumDeclaration`.

Boundaries use `@typescript-eslint/no-restricted-imports` with `regex` patterns, because a `group` glob such as `**/sim` also hits a module's own `./sim` file. For a forbidden list `NAMES`, the regex is:

```
^(?:\./)?(?:\.\./)+(?:NAMES)(?:/|$)|(?:^|/)src/(?:NAMES)(?:/|$)
```

For `src/render/<x>`, `NAMES` must also hold the other render names both bare and prefixed (`props|render/props|...`), because `../props/rings` is the normal spelling; the first draft missed exactly this and the negative control caught it [O]. `no-restricted-imports` does not see dynamic import, so add to `no-restricted-syntax` the selector ``ImportExpression[source.value=/REGEX/i]``, with `/` written as `\x2F` [O]. The `i` matches `no-restricted-imports`, which ignores case by default. Later blocks replace earlier `no-restricted-syntax` config rather than merging, so each block must repeat the enum entry.

Those regexes read a specifier as text, so every row also carries these (amended 2026-11-05, section 11):

- **Non-canonical spellings.** A `no-restricted-imports` pattern and matching dynamic and type selectors on `(?:^|/)(?!\.\.?/)[^/]+/\.\./|/\./|//|\\|(?:^|/)node_modules/`, which rejects `a/../b`, `a/./b`, `a//b`, a backslash, and a package reached by path.
- **Type position.** `no-restricted-imports` does not see `typeof import('x')` or `import('x').T`, so ``TSImportType[source.value=/REGEX/i]`` repeats the static list. Use `source`, not `argument`, which prints a deprecation warning in typescript-eslint 8.72 [O]. It follows the static list rather than the dynamic one, so in `src/app/**` and `src/main.ts` a type-position import of `harness` fails, like `import type`. Where `three` is `import type` only, in `src/contracts/**`, type position stays legal.
- **Unreadable dynamic imports.** `ImportExpression[source.type!="Literal"]` and `import.meta.glob`, since the gate cannot read what they reach.

| Files | Forbidden project modules | `three` | `postprocessing` | Extra |
|---|---|---|---|---|
| `src/contracts/**` | all, including `core` | `import type` only (`allowTypeImports`) | no | |
| `src/core/**` | all except `contracts` | no | no | pure |
| `src/world/**`, `src/sim/**`, `src/feel/**` | every other module | no | no | pure |
| `src/audio/**`, `src/ui/**`, `src/input/**` | every other module | no | no | |
| `src/harness/**` | every other module | yes | no | |
| `src/render/<x>/**` | every other module and other render dirs | yes | yes | |
| `src/testing/**` | all except `contracts` and `core` | yes | yes | |
| `src/testing/fakeWorld.ts`, `scriptedFrame.ts` | same | no | no | pure |
| `src/app/**`, `src/main.ts` | `testing` and `harness` through `no-restricted-imports`; the `ImportExpression` selector covers `testing` only, so `harness` stays reachable by dynamic import | yes | yes | |
| `tests/unit/<m>/**` | implementations of every module other than `<m>`; `testing`, `contracts` and `core` allowed | yes | yes | |

"Every other module" means `world, sim, feel, audio, ui, input, harness, app, testing, render`, minus self. Test dirs map `terrain, sky, props, fx` to `render/<name>`; `tests/unit/core` and `tests/unit/app` may import anything. Everywhere three is allowed, add `{ regex: '^three$', importNames: ['Clock'] }` [O: fails on `Clock`, passes on `Scene`]. "Pure" adds `no-restricted-properties` on `Math.random`, `Date.now` and `performance.now` [O], and on `Math`, `Date` and `performance` read through `globalThis`, `window` or `self`. Its limits are in section 10.

`tests/boundaries/boundaries.test.ts` calls `new ESLint().lintText(code, { filePath })` with **virtual** paths, so no forbidden file ever exists on disk and no other task's directory is created [O]. Table: at least the 42 rehearsed cases [O: all as expected], extended to cover every row above with one pass and one fail. Required cases: `../sim/rules`, `../sim`, `../sim/index.ts`, `../../src/sim/rules`, `/src/sim/rules.ts`, `export { x } from`, `export * from`, `import('../sim/rules')`, type-only three from `world` (fail), type-only three from `contracts` (pass), value three from `contracts` (fail), `./sim` inside `world` (pass), `./input` inside `ui` (pass), `../input/keys` from `ui` (fail), `../sky/sky.glsl?raw` from `render/terrain` (fail), `a[0]!` (pass), `any` (fail), `enum` (fail). In `src/app/x.ts`: `import { createHarness } from '../harness/index'` (fail), `export * from '../harness/index'` (fail), `await import('../harness/index')` (pass). In `src/world/`: `./../sim/rules`, `../world/../sim/rules`, `../../src/world/../sim/rules`, `.././sim/rules`, `..//sim/rules`, a backslash path, `../../../terrain/src/sim/rules`, `../../node_modules/three/build/three.module.js`, `typeof import('../sim/rules')`, `import('../sim/rules').X`, `typeof import('three')`, a template-literal `import()`, a variable `import()`, `import.meta.glob` (all fail). `./a/b`, `typeof import('./sim')`, `typeof import('../contracts/index')` (pass). In `src/contracts/`: `typeof import('three')` (pass). In `src/core/`: `globalThis.Math.random()` (fail).

**GLSL gate** (`scripts/glsl-gate.ts`). Banned, on any line, comments included:

- `/\buTime\b/`
- `/\bcameraPosition\s*\.\s*[xyzrgbastpq]*[zbp]/`, which catches `.z`, `.xyz`, `.b` and spaced forms
- `/\bmodelMatrix\b/`

Default scope: `src/**/*.{glsl,vert,frag,ts,tsx}`, `dev/**/*.{glsl,html,ts}`, `tests/support/devshell/**/*.{html,ts}`. `--root <dir>` scans a fixture instead. Prints `file:line: banned NAME`, then a count. **Zero files scanned is a failure** [O]. Exports `scanFiles(paths)` for `check:task`. `gates.test.ts` runs inside `check:task T00`, so it must not assert that the default scope is clean, because that scope covers siblings' paths. It asserts the default scope has files to scan and that T00's own paths have no hits. Whole-repo cleanliness is the `glsl:check` step of `npm run check`.

**`check:task`** (`scripts/check-task.ts T## [--root dir]`):

1. Resolve `plans/T##-*.md`. Exit 2 if missing or `owns` is unparsable.
2. Expand `owns` with `fs.globSync(..., { withFileTypes: true })`, files only, to POSIX relative paths. Drop anything under `tests/boundaries/fixtures/`: T00 owns `tests/boundaries/**`, and those files are deliberately broken and excluded from every tsconfig, so without this drop T00 could never pass its own gate. A fixture run with `--root` is unaffected, since its paths are relative to the fixture.
3. **tsc through the compiler API, not the CLI.** For each of `tsconfig.json` and `tsconfig.node.json` that exists: `ts.getParsedCommandLineOfConfigFile`, `ts.createProgram`; report config errors except TS18003, plus `getOptionsDiagnostics` and `getGlobalDiagnostics`; then `getSyntacticDiagnostics` and `getSemanticDiagnostics` **only for owned source files**. Filtering CLI output would be unsound: `tsc` stops at syntax errors, so one syntax error in a sibling hides every type error everywhere [O: CLI printed only TS1005 while the API also found TS2322 in the same run]. An owned `.ts` file in no program is an error (so a tsconfig cannot silently skip it).
4. ESLint through `new ESLint({ cwd }).lintFiles(ownedLintable)`, for `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`.
5. Vitest: spawn `node node_modules/vitest/vitest.mjs run <owned *.test.ts paths>` with `TERRAIN_TASK` set. Positional arguments filter by path, and a sibling's failing test was not run [O].
6. GLSL: `scanFiles` on owned files.
7. **Vacuity is failure.** Zero owned files type-checked, or zero linted, or a plan that owns a `tests/unit/` or `tests/boundaries/` path with no `*.test.ts` under it, fails with a message containing `VACUOUS`. A plan that owns no unit-test path (T11) prints `vitest: not applicable`.
8. All gates always run, then a one-line summary per gate and a final `check:task T## PASS` or `FAIL`. Exit 0 or 1. It does not run Playwright, and says so.

**Fixture tree** `tests/boundaries/fixtures/check-task/` has its own `tsconfig.json` (`types: []`), `eslint.config.js`, `vitest.config.mjs`, `plans/`, `src/`, `tests/unit/`. Expected:

| Fixture plan | Set-up | Expected |
|---|---|---|
| T98 | Owned files clean; `src/sibling/broken.ts` has syntax, type and lint errors; a sibling test fails | exit 0 [O] |
| T97 | Owns the broken sibling | exit 1, names TS1005, TS2322 and a parse error [O] |
| T96 | Owns only paths with no files | exit 1, `VACUOUS` [O] |
| T95 | Owned code clean, owned test red | exit 1 [O] |
| T94 | No such plan | exit 2 [O] |
| T93 | Owned file has a type error **and** the sibling has a syntax error | exit 1, names the owned TS2322 |

**`plans:check`** (`scripts/plans-check.ts [--root dir] [--arch file] [--allow-missing] [--approved]`):

1. Read `plans/T##-*.md`. Files in `plans/` that do not match `T##-*.md`, such as `README.md` and `RECONCILIATION.md`, are ignored. Parse frontmatter with no YAML dependency: flow list on one line, or block `- item` list. Required keys: `id`, `title`, `status`, `owner`, `depends_on`, `owns`, `reads`, `updated`. `status` must be in the six-word lifecycle.
2. The 14 headings must appear in template order. Accept `## Purpose` and `## 1. Purpose`, case-insensitive, trailing colon allowed.
3. Extract each §12 row by matching lines that start `| **T##** |` and contain a final cell starting `` `plans/ `` [O: 12 rows], and take backticked tokens from the third cell, "Owns exactly". No cell in those rows contains a pipe [O], so splitting the row on `|` is enough. `owns` must equal that set. A missing plan is a problem unless `--allow-missing`.
4. Static overlap: for every pair of plans and every pair of patterns, test **glob intersection** segment by segment (`**` spans zero or more segments; `*` within a segment), so overlaps are found before any file exists [O: 2441 pattern pairs across generated §12 plans, 0 problems].
5. Also check on-disk files for matches to two plans.
6. Legal overlaps, exactly: T00 and T04 on `src/contracts/glsl/hero.glsl`, and every temporary T11 path in §12 (`src/render/**`, `src/world/palettes.ts`, `src/world/biomes.ts`, `src/contracts/glsl/hero.glsl`, `src/feel/tuning.ts`, `src/sim/tuning.ts`) against any other plan. Any other overlap is a problem naming both plans and both patterns.
7. `--approved` additionally requires every plan's status to be `approved`, `in-progress` or `done`. Exit 0 or 1.

`gates.test.ts` generates temporary plan sets from the §12 table into `test-results/T00/plans-fixture-*/`: clean (exit 0), overlap with T05 owning `src/render/terrain/**` (exit 1) [O], `dev/audio.html` dropped from T07 (exit 1, drift) [O], one plan missing (exit 1), a heading out of order (exit 1), hero overlap between T00 and T04 only (exit 0), and the clean plan set plus a `plans/RECONCILIATION.md` containing no frontmatter (exit 0).

**Result:** all gates exist. **Proof:** A6 to A9.

### M5. Browser discovery and Playwright

**Goal:** four projects that launch the right browser. **Work:** `browser.ts` is already extracted. `playwright.config.ts`:

- `testDir: 'tests'`, `testMatch: '**/*.spec.ts'`, `outputDir: 'test-results/default'`, `snapshotPathTemplate: 'test-refs/{projectName}/{testFileName}/{arg}{ext}'`, `fullyParallel: false`, `workers: 1`, `retries: 0`, `timeout: 60_000`, `reporter: 'list'`.
- `use: { baseURL: http://127.0.0.1:${port}, headless: true }`, with `port` from `TERRAIN_PORT ?? '5100'`.
- `webServer: { command: npx vite --port ${port} --strictPort, url: http://127.0.0.1:${port}/@vite/client, reuseExistingServer: true, timeout: 60_000 }`. Use `/@vite/client` for readiness: `/` is 404 until T10 and Playwright does not accept 404 as ready [O: `/` 404, `/@vite/client` 200].
- A local helper throws `No cached Chromium found. Set TERRAIN_CHROMIUM / TERRAIN_HEADLESS_SHELL, or run: npx playwright install chromium` when `findChromium` returns undefined [O].

| Project | `testMatch` / `testIgnore` | Viewport | Executable | Args |
|---|---|---|---|---|
| `gpu` | ignore `.timing.spec.ts`, `.nowebgl.spec.ts` | 1920x1080 | `gpu` | `--ignore-gpu-blocklist`, `--use-angle=d3d11` on win32 |
| `gpu-timing` | match `.timing.spec.ts` only | 1920x1080 | `gpu` | same plus `--disable-gpu-vsync --disable-frame-rate-limit --enable-precise-memory-info --js-flags=--expose-gc` |
| `software` | ignore as `gpu` | 640x360 | `software` | `--use-angle=swiftshader --enable-unsafe-swiftshader` |
| `no-webgl` | match `.nowebgl.spec.ts` only | default | `gpu` | `--disable-3d-apis` |

`rasterizer.ts`: `gpu` and `gpu-timing` need WebGL2 and a renderer not matching `SOFTWARE_RENDERER`; `software` needs WebGL2 and `/swiftshader/i`; `no-webgl` needs no WebGL2. `rasterizer.test.ts` uses the two observed strings [O] as negative controls: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` under `gpu` must fail, and `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)` under `software` must fail.

**Result:** discovery proven. **Proof:** A10.

### M6. Fakes

**Goal:** a world and frames good enough to judge a look. **Work:**

**`createFakeWorld`.** Pure and allocation-free. `seed` defaults to 1985. When `periodChunks` > 0, every function reduces `chunk` modulo it first.

- `height`, with `smooth` a clamped smoothstep:
  ```
  d = |x|; k = smooth((d - 85) / 430); if (k === 0) return 0;
  P = 4096 / zs; z = ((iz % P) + P) % P * zs + zLocal;
  return k * (135 + 250 * smooth((d - 260) / 1100))
           * (0.5 + 0.2 * sin(TAU * x / 1024) * sin(TAU * z / 2048) + 0.08 * sin(TAU * x / 256) * sin(TAU * z / 512));
  ```
  Measured for this formula [O]: valley exactly 0 at |x| <= 85, peak h/|x| 0.184 (under the real function's 0.28), min above the valley 0.9, identical through different `(iz, zs, zLocal)` splits and at `iz = 2^40`. The period of 2048 u divides `WORLD_PERIOD`.
- `fillProps`: per-chunk counts read `ARCHETYPE_SPEC[a].perChunk`, 101 records plus the ring on chunks divisible by 48 [arithmetic: the sum is 102], under `MAX_PROPS_PER_CHUNK`. Small archetypes (palm, reflector, chevron, cactus, totem, colonnade, billboard, orb) at |x| in `[44, 85]`. Others at |x| in `[120, 500]`. Two archetypes copy T01's rows (S-07). RING: `x 0, y 65.14, zLocal 32, yaw 0, scale 1, keep 0`. PYLON pairs: `x +-100, y 0, zLocal 0, yaw 0, scale 1, keep .1 / .6`, with `variant` .75 when row `chunk + 1` also has a pair, otherwise .25 (S-04). For the rest, `y` is the mesh origin per `PropField`: fake `height` at the spot, and floating types (orb, crystal, saucer) add a constant hover of 6, 8 and 40 u, inside T01's bands. Their values come from `hash01(seed, chunk, archetype, i)` draws, with `keep` clamped per the seam. `o.archetypes` restricts the set, so T05 can isolate one type.
- `fillItems`: all six kinds, within `ITEM_SPEC[k].perChunk`, with `a`, `b`, `seed` and record order per `ItemField`. Gates at `chunk % 3 === 0`, `zLocal = 0`, `y 8`, `radius 9`. Fences at `x 0`, `radius 42`, `y 8`. Shards on the world 12 u lattice, using `chunk % 3` for the phase. Spikes, fences, drones and traffic at low density. Otherwise x in `[-40, 40]`, y in `[2, 14]`. Under 32 per chunk.
- `zoneAt`: `index = floor(chunk / 100)`. `biomeA = biomeB = index % 6`, mix 0. `paletteA = paletteB = index % 6`, mix 0. `palette` from the six §6.8 tables converted sRGB to linear. `heroA = heroB = 0`, mix 0. `objective = index % 5`, `objectiveTarget = 10`, `musicKey = index % 12`, `dayPhase = (chunk % 750) / 750` in exact arithmetic.
- `bendAt`: `a = 8e-5 * (0.7 sin(TAU * travelMod(at, 16384) / 16384) + 0.3 sin(TAU * travelMod(at, 65536) / 65536))`, `c = -1.2e-5`, `vMax = 1500`.

**`scriptedFrame(t, o)`.** `t` is seconds. Returns one module-level `FrameView` mutated in place, like the real one, so a caller who needs two must copy values. Three-free.

- Without `o.at`: `tick = floor(t * SIM_HZ)`, `alpha = t * SIM_HZ - tick`, `speed = SPEED_CRUISE`, `stepDist = SPEED_CRUISE / SIM_HZ`, `sim.travel` at tick distance from a base of chunk 1, `cam` = travel moved by `-(1 - alpha) * stepDist`, exactly as §3.3 step 5.
- With `o.at`: `cam = at`, `alpha = 0`, `tick = o.tick ?? floor(t * SIM_HZ)`.
- `phases` per §4.5. `zone` and `bend` from the world, with overrides, and `o.zone` last. `feel` neutral with overrides. `quality = fakeProfile(o.tier ?? 3)`.
- `sim`: mode DEMO, `score = floor(t * 100)`, `sync = 1 + floor(t / 4) % 16`, `shields = 3`, `overdrive = fract(t / 10)`, `beat = tick / 72`, `ghost = 0`, `sectorIndex = zone.index`, `objectiveProgress = 0`, with overrides. `x = 12 * sin(TAU * t / 16)`, `y = 6`; `camX = 0.72 * x`, `camY = CAMERA_Y + 0.35 * (y - 6)` per §6.1, unless `o.camX` or `o.camY` overrides them.
- `events` from `o.events`, count 0 otherwise.

**`createFakeHost`** per the seam table. `warpTo` obeys `canWarp`, and `warpSerial` rises only on success. `step` advances travel. `forceSignalLost` exists. `overrideFeel` and `governor.force` record into `calls`.

**Result:** T01 to T09 can build against these. **Proof:** A5 (fake unit tests) and A12.

### M7. Dev shell and the visual proof

**Goal:** real GPU pixels through the same lifecycle T10 will use. **Work:**

**`startDevShell`:**

- Renderer flags are exactly §6.6: `powerPreference: 'high-performance', antialias: false, stencil: false, depth: false`. `preserveDrawingBuffer` stays at its default false, since a manual screenshot was byte-identical with and without it [O: 1,311,182 bytes, `Buffer.equals` true].
- `toneMapping` left alone. `info.autoReset = false`.
- `debug.onShaderError` pushes to `shaderErrors` and calls `console.error('SHADER_ERROR ...')`, because the handler replaces three's own log (`Agents.md`). [O: both signals arrive.]
- Canvas appended to `document.body`, with margin 0 and a black background. Scene and camera per §6.1 constants. `shared = createSharedUniforms()`. `world = o.world ?? createFakeWorld()`.
- Lifecycle per the seam table. Default rAF loop calls `frameAt(startT + (ms - firstMs) / 1000)`, where `startT` is `?t` or 0, so a slow boot does not read as a camera jump; `?manual=1` renders one frame and stops. A changed window size or device pixel ratio is applied before the next draw: `frameAt` compares the current values, because `innerWidth` changes before the `resize` event dispatches.
- `window.__shell = shell`. `ready` flips only after the first frame. Wrap `new WebGLRenderer` in try/catch, and on failure set `window.__shell` absent and log one `console.error`.

**`createDevPost`:** a `PostStack`. `new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: profile.msaa })`, then `RenderPass`, then one `EffectPass(camera, bloom, tone, alphaOne)`. `BloomEffect` per §6.6 row 2, levels from the profile, left unchanged when `bloomLevels` is 0, because `MipmapBlurPass.render` throws at `levels = 0` [O: stand-in, TypeError reading `texture`; DI-46]. The first build's count comes from `firstBloomLevels` in `devPost.ts`, which is not re-exported by `index.ts`: 6 when the profile has none. `ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })`. A small `Effect` with `BlendFunction.SRC` writing `vec4(inputColor.rgb, 1.)` [O: all 2,073,600 pixels alpha 255]. `dithering = true`, and the `timeScale = 0` cast. `precompile` binds `composer.inputBuffer` before `compileAsync`, per `Agents.md`. `forceVariant('off')` renders directly with `autoClear = true`. `setQuality` and `resize` record and apply at the next `frame`, `render` or `precompile`, like the real stack. `resize` per the seam table.

**`tests/support/devshell/trivialLayer.ts`** exports `createTrivialLayer(): RenderLayer`, named `sky`, not a stub of T03 or T04, built only from contract GLSL. Its query flags stay:

- A fullscreen sky triangle using `skyGrad` and `sunDisc`, `RenderOrder.SKY`, no depth test.
- A floor quad in render space, x within ±4096, z from 0 to -4300, through `bendV`, then `projectionMatrix * viewMatrix`, shaded with `pristineGrid((x, forward + uTravel.x) / 8)`, `emit` and `fogK`.
- With `?depth=1`: near green quad at z = -40 drawn first and far red quad at z = -80 drawn last, x within ±10, y 0 to 20.
- With `?bad=1`: an undeclared identifier in the fragment shader.
- With `?alpha=1`: the floor writes alpha .25, which only a final alpha-1 write can hide.
- With `?hot=1` and `?depth=1`: the near quad writes `vec3(8.)`, far above the bloom threshold.
- It records its lifecycle calls, including `setDebugMode`, on `window.__layerLog`, and each frame on `window.__frames` and `window.__lastView`.

`smoke.html` wires it. `?recordpost=1` passes a `createDevPost` wrapped in a recorder, `?markworld=1` passes a world whose `bendAt` writes `vMax` 1200, and `?otier=<n>` passes a tier through `DevShellOptions`, which `?tier` outranks.

**Visual iteration.** Run A11, open the PNG with the Read tool, and describe it in Progress. If it shows wash-out, banding, moire on the grid, a dead sun or a wrong horizon, fix DevPost or the proof layer, and re-shoot. Only the first shot rehearsed is known [O]: deep purple top, magenta-pink glow to the horizon, yellow-to-pink sun with thin dark bands, sunk at a horizon near row 590, bright magenta grid converging with no visible moire. That reference used an analytic floor; the plane floor in this plan is new and must be viewed.

**Result:** T03 to T06 can start. **Proof:** A11 to A13.

### M8. Build proof and whole-repo check

**Goal:** the toolchain builds and runs a bundle. **Work:** `npm run build` cannot run before T10 owns `index.html` [O], so `tests/support/buildproof/` has its own entry. `index.html` with `<link rel="icon" href="data:,">`. `main.ts` importing `three`, `postprocessing` and `src/contracts/glsl`, and printing a line into a `<pre>`. `vite.config.ts` with `root` set to that folder, `base: './'`, and `outDir` at `test-results/T00/build-proof`. `buildproof.spec.ts` (gpu only) runs the build, serves the output from a `node:http` server under `/some/nested/path/`, loads it, asserts the `<pre>` text and no failed request.

**Result:** a build runs. Then `npm run check`, then the stub-free listing. **Proof:** A14 to A16.

### M9. Hand-off

**Goal:** executors can spawn. **Work:** run `plans:check` over the real plan set. Fix only T00's own files; another plan's defect goes to that plan's owner. Write Outcomes. Set `status: done`. **Result:** contracts are frozen. **Proof:** A17.

## 6. Concrete steps

PowerShell 5.1, in `C:\highsierralabs\terrain`. No `&&`. A failed step stops the milestone.

```powershell
# M1
npm install --no-fund --no-audit
Remove-Item -Recurse -Force node_modules
npm ci --no-fund --no-audit
npm ls --depth=0
npm audit --omit=dev
npm audit                     # informational; exit 1 is expected

# M2 (after writing scripts/lib/plans.ts and scripts/contracts-check.ts)
node scripts/contracts-check.ts --extract
npm run contracts:check
npm run typecheck

# M3 and M6
npx vitest run tests/unit/core

# M4
npx vitest run tests/boundaries
npm run lint
npm run glsl:check
node scripts/glsl-gate.ts --root tests/boundaries/fixtures/glsl
npm run check:task -- T00
npm run plans:check

# M5
$env:TERRAIN_PORT = '5100'
npx playwright test --list
npx playwright test tests/support/devshell/raster.spec.ts --project=gpu --project=software --output=test-results/T00
npx playwright test tests/support/devshell/timing --project=gpu-timing --output=test-results/T00-timing
npx playwright test tests/support/devshell/fallback --project=no-webgl --output=test-results/T00-nowebgl

# M7
npx playwright test tests/support/devshell/devshell.spec.ts --project=gpu --output=test-results/T00
# Then open every path printed after SCREENSHOT with the Read tool.

# M8
npm run build:proof
npx playwright test tests/support/buildproof --project=gpu --output=test-results/T00-build
npm run check
npm run test:foundation -- --output=test-results/T00-all
```

To stop a leftover dev server on a port: `Get-NetTCPConnection -LocalPort 5100 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

## 7. Validation and acceptance

Paste short output into Progress as each one passes. Expected counts marked [O] came from the rehearsal; the rest are stated by intent. In this table, `\|` is a literal pipe, escaped for Markdown.

| # | Command or action | Expected |
|---|---|---|
| A1 | `npm ci` after deleting `node_modules` | Exit 0. `npm ls --depth=0` lists exactly the 10 direct packages at the §2 versions [O: 139 added, about 5 s] |
| A2 | `npm audit --omit=dev`, then `npm audit` | First: `found 0 vulnerabilities`, exit 0 [O]. Second: `9 moderate severity vulnerabilities`, 0 high, 0 critical, exit 1 [O]. All nine trace to `minimatch` 7.0.0 to 11.0.0, advisory GHSA-g3hv-75wg-m249, through `eslint` and `typescript-eslint`, so it is dev-only as §2 says. Its `fixAvailable` would move eslint to 9.39.5 and typescript-eslint to 8.36.0, so run no fix. Any other advisory is a finding to report, not to fix silently |
| A3 | `npm run contracts:check` | Exit 0, seven files, `added` 0 |
| A3n | `contracts.test.ts` | Deleted line fails, reordered lines fail, changed type fails, added line passes, changed `FOG_END` passes, changed `DEFAULT_SEED` passes, changed `CHUNK_LEN` fails, altered `sunDisc` signature fails, altered `sunDisc` body passes |
| A4 | `npm run typecheck` | Exit 0 on both configs |
| A4n | Temporarily add `export const p = process.env;` to `src/core/x.ts`, run `npm run typecheck`, delete it | TS2591 [O], proving node types stay out of browser code |
| A5 | `npx vitest run tests/unit/core` | All pass, none skipped. Required: `advance` with either sign, the tiny-negative case (`local = -1e-17` gives `local 0`, same chunk), behaviour at `2^48 - 1025`; `between` exact across a chunk gap; `rowMod`; `travelMod(4096)` at `chunk = 2^40 + 63, local = 12.5` is 4044.5; `canWarp` false on `CHUNK_LIMIT`, `2**48`, 1.5, -1, NaN and `local = 64`, true on `CHUNK_LIMIT - 1`. All 9 `hash01` goldens by `toBe`; uniformity under 340 on the sweeps; `hash01` at chunk `k` differs from `k + 2^32`. `trafficOffset` in `[0, travel)`, equal at phase 0 and 1 for integer k; `droneOffset` within 1e-9 at phase 0 and 1. `writeSharedUniforms`: array identity unchanged, lengths, `uTravel.y` 4044.5 and `uCamRow` 63 at the point above, `uTravel.y` 4044.5 at `chunk = 2^40 + 127`, which tells 4096 from 8192 where `2^40 + 63` cannot, bend zeroed under `reducedMotion`, `uFog` untouched. `writePhases` and `phaseOf` equal §4.5. `cameraFov` holds the §6.4 cap, in degrees, `writeCameraPose` applies that cap to `fovDeg` at 32:9, and `writeCameraPose` under `shakeY: -CAMERA_PITCH` gives `rotX` exactly 0. `firstBloomLevels`: 6 at `fakeProfile(0)`, otherwise the profile's own count, 3 at tier 1, 6 at tier 3, 7 at tier 4. `alloc.ts`: every array sized from its constant, and `createNeutralFeel` per §8.1. Fake world: valley 0, split independence, any-order `fillProps` equality, `start` monotonic with total under the cap, `zLocal`, `keep`, `tintSeed`, `variant` ranges after Float32 storage, all 20 archetypes and 6 kinds appear, no row exceeds `perChunk`, RING, PYLON, GATE and FENCE records as M6 states, `periodChunks = 1024` makes chunk `k` and `k + 1024 * 2^37` equal, and `periodChunks = 101` makes `bendAt`, `height` and `zoneAt` reduce the chunk, which 1024 cannot show. All 126 values of the §6.8 table, through `writeFakePalette` and through `zoneAt`. Hover 6, 8 and 40 on ORB, CRYSTAL and SAUCER, 0 on every other archetype written from a height. `scriptedFrame`: same `t` same values, `phases` equal §4.5, `at` gives `alpha` 0 and exact `cam`, the option rules in section 4 hold, `camX` and `camY` override, `zone` applies last. `fakeHost`: constructs in Node, records calls, `warpTo` refuses `CHUNK_LIMIT` with state unchanged, `warpSerial` rises only on success, `step` advances travel, `forceSignalLost` exists, `overrideFeel` and `governor.force` record |
| A6 | `npx vitest run tests/boundaries/boundaries.test.ts` | Every case in the M4 table as expected, at least 45: the 42 rehearsed plus C-30's three |
| A6n | `'import { x } from "../sim/rules"; export const a = x;' \| npx eslint --stdin --stdin-filename src/world/height.ts` | Exit 1, `@typescript-eslint/no-restricted-imports` [O], and the same line with filename `src/app/loop.ts` exits 0 |
| A7 | `npm run lint` | Exit 0, no warnings |
| A8 | `npm run glsl:check` | Exit 0 with a file count above zero. `--root tests/boundaries/fixtures/glsl`: exit 1, 6 hits across 2 files [O]. `--root tests/boundaries/fixtures/glsl-clean` (`uTimeline`, `cameraPosition.xy`, `modelViewMatrix`): exit 0 [O]. An empty temp dir: exit 1, `VACUOUS` [O] |
| A9 | `npx vitest run tests/boundaries/gates.test.ts` | The check:task fixture table and plans:check cases in M4 all behave as listed |
| A9b | `npm run check:task -- T00` | Exit 0, four gate lines, non-zero counts. With a banned token in a temporary `src/render/terrain/zz.glsl` or `dev/audio.html`: still exit 0, while `glsl:check` and the owner's `check:task` exit 1. With one in a temporary T00-owned file: exit 1 |
| A9c | `npm run check:task -- T00` with half the logical CPUs spinning | Exit 0, because T01 to T09 run on these CPUs. A gate must not depend on machine load (section 11) |
| A10 | `npx playwright test --list` | Lists all four projects. `$env:TERRAIN_CHROMIUM='C:/nope/chrome.exe'; npx playwright test --list` exits 1 with `browser override does not exist` [O]. With `PLAYWRIGHT_BROWSERS_PATH`, `LOCALAPPDATA`, `USERPROFILE` and `HOME` pointed at an empty folder, `node node_modules/playwright/cli.js test --list` exits 1 with `No cached Chromium found` [O]. Use `node` here, since `npx` itself only printed npm notices under an empty profile [O]. Clear the env afterwards |
| A10b | `raster.spec.ts` under `gpu` and `software` | `gpu` renderer contains the real adapter, `software` contains `SwiftShader` [O]; shots saved and viewed |
| A10c | `timing.timing.spec.ts` under `gpu-timing` | `typeof gc === 'function'`, `performance.memory` present, prints sync p50 and p95 [O: 0.8 and 1.4 ms on the first proof scene] |
| A10d | `fallback.nowebgl.spec.ts` | `getContext('webgl2')` is null on `blank.html` [O] |
| A11 | `devshell.spec.ts` picture test | Passes with clean console. `stats().calls` above 3, against 1 with `info.autoReset` on. A second case renders one `createDevPost` frame at `fakeProfile(0)` with no throw, which is T03's A22 path (DI-46), and `calls` above 10, against 4 if bloom were built at 0 levels. **Open the PNG and write what you saw into Progress.** All pixels alpha 255 [O] |
| A11b | Horizon test, `frameAt(4.2, { bend: { a: 0, c: 0 } })` | Horizon row within `[587, 593]` at x = 100 [O: 590] |
| A11c | Depth test with `?depth=1` | Pixel (960, 560): green dominant under DevPost [O: 33, 241, 33, 255]. Negative control `?depth=1&post=off`: red wins [O: 255, 0, 0, 255], proving the detector and the zero-depth canvas of §6.10 |
| A11d | Determinism | `post=off`: 16 repeats of `frameAt(4.2)` give 0 differing bytes [O]. Default post: at most 16 differing bytes and each by at most 1 [O: 0 or 1 byte, always the same pixel]. Different `t`: over 1000 differing bytes [O: 209,961] |
| A11e | Distance | `frameAt(0, { at: { chunk: 2**40, local: 12.5 }, tick: 120, palette: 0, bend: { a: 0, c: 0 } })` against the same call with `chunk: 0`, under `post=off`: 0 differing bytes, and neither frame blank. `palette` is pinned because the fake zone index differs between the two chunks |
| A11f | `?bad=1` with `allowConsoleErrors` | `shaderErrors.length > 0` and console has `SHADER_ERROR` [O]. Without `allowConsoleErrors`, the same page fails the test, and for that reason alone: a child Playwright run of `consoleguard.control.ts` reports one test, status `failed`, one error, `Error: N console errors:` with N entries, each `console.error: SHADER_ERROR`. No `test.fail()`. **Negative controls (drills on copies):** a fixture failing at setup or teardown, a test timeout, an action timeout, an extra unrelated console error, the guard's check bypassed and `allowConsoleErrors` defaulting to true each fail it |
| A11g | Lifecycle | `__layerLog` starts `attach, setQuality, rebuild, frame`. Forward tick steps add no `rebuild`. A jump adds one and `warpSerial` rises. `?recordpost=1` shows `attach, setQuality, resize, precompile` before `frame, render`. DevPost's `setQuality` and `resize` change nothing until the next `frame`, `render` or `precompile` |
| A11h | The paths T03 leans on, one case in `devshell.spec.ts` | `?post=off`, clear colour `0xff00ff`, layer hidden, `frameAt` twice: every pixel 255,0,255,255 and `calls` 0. `?markworld=1`: `uBend[2]` and `ctx.world` read 1200, against 1500 without it. `setDebugMode('crack')` reaches the layer's log. A forward step of exactly 64 adds no rebuild, and 64.5 adds one. At 3840x1080 with `feel.fovDeg` 68: `camera.aspect` close to 3840/1080 and `tan(fov/2) * aspect` close to 1.574. `?alpha=1`: 0 pixels not opaque under DevPost, over 100,000 under `post=off`, which shows the page writes below 1 |
| A11i | What section 4 promises the siblings, one case in `devshell.spec.ts` | `?palette=2&biome=3&hero=1&t=4.2`: `uHero` [1, 1, 0], `uPal` equal to `writeFakePalette(2)`, tick 504, `uPhases[3]` close to (504 % 120) / 120, biome 3, palette 2, and other values with no query. Projection element [5] close to 1 / tan(fov / 2) at 58, 68 and 58 degrees. Multisampled targets, leaving out postprocessing's 1x1 probe: samples 2 with an RGBA16F colour buffer at tier 3, samples 4 with RGBA16F at tier 4, none at tier 2. `setTier(1)`: 9 calls from 15, width 1280. Then `setTier(4)`: samples 4, 17 calls, width 1920. `forceMsaa(2)`: samples 2. A hot quad adds over 20 code values beside itself under DevPost, and exactly 0 under `post=off`. `shell.rebuild()`: one more `rebuild` in the layer and post logs, `warpSerial` unchanged. `?otier=1`: tier 1, width 1280, and with `?tier=4`: tier 4, width 1920. On a paused clock: 20 frames over 320 ms after `setManual` off, on, off, none before that or after `setManual(true)`, `?t` carried into the loop, `warpSerial` 0. `dispose()`: no canvas and no `window.__shell` |
| A12 | `fakehost.spec.ts` | Browser test with no harness involved: `ctx.renderer` real, `renderState(1024 + 5, 3, 120)` equals `renderState(5, 3, 120)` bytewise, and differs from `renderState(6, 3, 120)` |
| A13 | C-05's GLSL twins | A float-target render of `trafficOffset` and `droneOffset` at 8 sample inputs agrees with `motion.ts` within 1e-3 u |
| A14 | `npm run build:proof` | Exit 0, one chunk, gzip under 260 KB [O: 141.33 KB, with the expected 500 kB warning]. `index.html` has `src="./assets/` [O] |
| A14b | `buildproof.spec.ts` | Page runs from `/some/nested/path/`, no 404, no console error. The file builds in `beforeAll`, so its negative control passes alone on a clean tree (`-g "negative control"`), with no leftover build |
| A14c | `npm run build` | Fails with `[UNRESOLVED_ENTRY] Cannot resolve entry module index.html` [O]. Record as expected until T10 |
| A15 | `npm run check` | Exit 0 |
| A15b | `pins.test.ts` | Every Agents.md script name exists; exact versions; no `^` or `~`; `dependencies` has exactly `three` and `postprocessing`. A mutated copy with `^` fails |
| A15c | `npm run test:smoke`; `test:forever`; `test:perf`; `test:art` | Each: `Error: No tests found`, exit 1 [O for the form], until armed. `npm run test:browser` passes |
| A16 | `'src/world','src/sim','src/feel','src/render','src/audio','src/ui','src/input','src/harness','src/app','src/main.ts','index.html','dev','tests/visual','tests/forever','tests/perf','tests/e2e','tests/art' \| Where-Object { Test-Path $_ }` | Prints nothing |
| A17 | `npm run plans:check` | Exit 0 with 12 plans, 0 problems |

**Human checks.** They do not block `done` (`Agents.md`). T11's operator pack collects them.

- HC1: the Linux and macOS paths in `tests/support/browser.ts` (§11.1), and anything on a GPU other than the RTX and SwiftShader, since no such device is available here.

## 8. Idempotence and recovery

- Safe to re-run: `npm ci`, every check, gate and test command. `contracts-check --extract` never overwrites. `npm install` must run only in M1 or when absorbing a dependency change, since it rewrites the shared lockfile.
- Clean state without git: `Remove-Item -Recurse -Force node_modules, test-results, test-refs, dist -ErrorAction SilentlyContinue`, then `npm ci`.
- Contract files can be rebuilt from `architecture.md`: delete the seven files, run `--extract`.
- Before a risky rewrite of a script or `devShell.ts`, copy it outside the project, since there is no git to revert with.
- Never run `npm audit fix`, with or without `--force`, or `npx playwright install` as a side effect.
- `tests/boundaries/gates.test.ts` writes only under `test-results/T00/`, and cleans its own temp dirs at the start of each run.
- If T00 must reopen after siblings start, it is the one file set everyone reads: change only what an approved request says, and announce the revision.

## 9. Progress

- [x] 2026-11-05T05:55Z Plan drafted. A throwaway rehearsal ran in the scratchpad; no project file exists except this plan and `plans/README.md`.
- [x] 2026-11-05T10:14Z Execution started. All 12 plans read `status: approved` (grep `^status:` over `plans/`), so the spawn condition held.
- [x] 2026-11-05T10:14Z M0 Reconciled contract text confirmed. Section 12 has no `open` row, and `grep -nE "State: \*?\*?open|\| open( |\|)"` over all plans returned nothing.
- [x] 2026-11-05T10:16Z M1 Scaffold and install. A1: `npm install`, delete `node_modules`, `npm ci`: exit 0, `added 139 packages in 4s`. `npm ls --depth=0` lists exactly the 10 pins. A2: `npm audit --omit=dev`: `found 0 vulnerabilities`, exit 0. `npm audit`: `9 moderate severity vulnerabilities`, exit 1, all through `minimatch` 7.0.0 to 11.0.0, GHSA-g3hv-75wg-m249, reached via `@eslint/config-array`, `eslint` and `@typescript-eslint/*`. Its fix would install eslint 9.39.5, so no fix was run.
- [x] 2026-11-05T10:17Z M2 Contracts and verbatim gate. A3: `npm run contracts:check` exit 0: `index.ts` 497 lines, `coords.ts` 33, `glsl.ts` 6, `common.glsl` 33, `common.frag.glsl` 16, `browser.ts` 44, all `0 added`, and `hero.glsl` 3 signature lines, `0 added`. A3n: `contracts.test.ts` passes every listed mutation, plus FOG_START and a non-numeric FOG_END. A4: `npm run typecheck` exit 0 on both configs. A4n: `export const p = process.env;` in a temporary `src/core/x.ts` gave `error TS2591: Cannot find name 'process'`, exit 2; file deleted, exit 0 again.
- [x] 2026-11-05T10:18Z M3 Core. `hash.ts` as the plan's exact text, and all 9 goldens pass by `toBe`. Fake-dependent parts of A5 land at M6.
- [x] 2026-11-05T10:24Z M4 Lint boundaries, GLSL gate, check:task, plans:check. A6: `boundaries.test.ts` has 147 table cases plus a count check, 148 tests, all as expected. A6n: stdin `../sim/rules` as `src/world/height.ts` exit 1, `@typescript-eslint/no-restricted-imports`; same line as `src/app/loop.ts` exit 0. A7: `npm run lint` exit 0. A8: `glsl:check` exit 0, 10 files; `--root tests/boundaries/fixtures/glsl` exit 1, `2 files scanned, 6 hits`; `glsl-clean` exit 0; empty dir exit 1, VACUOUS. A9: `gates.test.ts` passes T98 exit 0, T97 exit 1 naming TS1005, TS2322 and `parse error`, T96 VACUOUS, T95 exit 1, T94 exit 2, T93 exit 1 naming the owned TS2322 with no TS1005, plus every plans:check case. A9b: `check:task T00` PASS, four gate lines. First real `plans:check`: 12 plans, 2648 pattern pairs, 0 problems.
- [x] 2026-11-05T10:26Z M5 Browser discovery and Playwright. A10: `--list` shows all four projects. `TERRAIN_CHROMIUM=C:/nope/chrome.exe`: exit 1, `browser override does not exist`. Empty `PLAYWRIGHT_BROWSERS_PATH`, `LOCALAPPDATA`, `USERPROFILE`, `HOME` with `node node_modules/playwright/cli.js test --list`: exit 1, `No cached Chromium found`. A10b: `gpu` renderer `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)`, `software` renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. A10c gc and precise memory present under `gpu-timing`; sync timing lands at M7, when the shell exists. A10d: `getContext('webgl2')` null on `blank.html`. `rasterizer.test.ts` holds both observed strings as negative controls.
- [x] 2026-11-05T10:31Z, rerun 10:44Z M6 Fakes. A5: `npx vitest run tests/unit/core` passes, 8 files, none skipped, covering every item the A5 row lists. A12: `fakehost.spec.ts`, real WebGL2 renderer, `renderState(1024 + 5, 3, 120)` and `renderState(1024 * 2^30 + 5, 3, 120)` each differ from `renderState(5, 3, 120)` by 0 bytes; next row, next local and next tick each differ by 172,800 bytes (every colour byte of a 320x180 frame). Also passes under `software`.
- [x] 2026-11-05T10:45Z M7 Dev shell and visual proof, image viewed. Evidence, from `test:foundation` after a clean `npm ci`:
  - **A11 picture, opened with the Read tool, final run:** `test-results/T00-all/support-devshell-devshell--e6d8e-d-with-a-clean-console-A11--gpu/devshell-picture.png`, 1920x1080. Deep indigo at the top corners, dark red toward top centre from the painted halo, going through purple to a hot pink glow at the horizon. Yellow disc at top going to pale pink at the bottom, with 10 or so dark bands that thicken downward, a crisp edge and a soft glow. Its lower part is cut by the floor's far edge, near row 606. Magenta grid converging on the vanishing point at the disc's base, lines bright with a paler core and a tight glow, far field melting into flat magenta. The camera is offset by `camX` 8.6, so the line under the vanishing point leans left toward the bottom of the frame. No wash-out, no visible banding, no moire pattern at full size, sun alive, horizon where §6.1 puts it. Numbers: alpha 255 on all pixels, near-white 0, mean chroma 115.08, `blackP10` 16.
  - **Crops, also opened:** far grid at 2x and 3x: filtered lines with stair-steps at subpixel widths and no interference bands, fading to flat colour. Lower sun at 3x: band edges clean. Sky range-stretched, two regions: smooth with faint static dither and no contour lines. A still cannot show shimmer or flicker, and no frame sequence was viewed.
  - **Bend-on against bend-off:** with the fake bend the top edge of the floor is near row 606, which is §6.3's crest below the true horizon. With bend off it is row 591. The sun is cut by about 17% of its diameter [arithmetic: -.0183 to -.09 of a .43 span], against §6.1's "about 20%".
  - **A11 second case, opened:** `devshell-tier0.png`, 640x360 scaled up by CSS, same composition, soft. A shell at tier 0 and a shell going tier 3 to 0 both render. **Negative control:** with the `bloomLevels > 0` guard removed, the second one fails with `TypeError: Cannot read properties of undefined (reading 'texture')`, then the guard was restored and it passed. See section 10 for what the first control attempt showed.
  - **A11b:** horizon row 591 at x = 100, in `[587, 593]`. Control: zero pitch moves it to row 543, outside that range.
  - **A11c:** pixel (960, 560) under DevPost 33,241,33,255, green dominant. Control `?depth=1&post=off`: 255,0,0,255, and canvas depth bits 0.
  - **A11d:** `post=off` 0 differing bytes over 16 repeats. Default post 0 differing bytes in every run here, inside the allowed 16. Different `t`: 824,992 differing bytes.
  - **A11e:** chunk 2^40 against chunk 0: 0 differing bytes, each with 2,631,051 colour bytes above 8. Control, `local` 15 against 12.5: 417,105 differing bytes.
  - **A11f:** `?bad=1` reaches `shaderErrors` and the console shows `SHADER_ERROR`. The `test.fail()` case without `allowConsoleErrors` fails as intended. `openDevPage` throws `shader error` on the same page.
  - **A11g:** layer log `attach, setQuality, rebuild, frame`. Post log `attach, setQuality, resize, precompile, frame, render`. 20 forward steps add no rebuild. A jump adds one and `warpSerial` goes 0 to 1, and a backward move adds another, 1 to 2. After `setQuality` and `resize` the buffer stays 1920 wide; the next `frameAt` makes it 480.
  - **A13:** on T01's item domains, 16 samples: traffic worst .000234 u, drone worst .0000022 u, both under 1e-3. See section 11 for the first attempt's samples.
  - **A10b, opened:** `raster-gpu.png` and `raster-software.png` are flat blue from the clear colour. `shell-gpu.png` and `shell-software.png` show the same composition at 1920x1080 and 640x360, viewed with no fault. **A10c:** `gc` and `performance.memory` present; sync p50 .80 ms, p95 1.20 and 1.40 ms in two runs, 15 calls, 6 programs, 12,302 triangles.
- [x] 2026-11-05T10:45Z M8 Build proof and whole-repo check. A14: `npm run build:proof` exit 0, one chunk, 600.28 kB, gzip 148.09 KB, under 260 KB, with the expected 500 kB warning; `index.html` has `src="./assets/index-CQsMUNm9.js"`. A14b: runs from `/some/nested/path/`, prints `build proof ok: three r187, common 4134 chars`, no request failed, clean console. Control: the same request log sees a 404 for a missing asset. A14c: `npm run build` exit 1, `[UNRESOLVED_ENTRY] Cannot resolve entry module index.html`, expected until T10. A15: `npm run check` exit 0, 13 test files, 357 tests, `glsl:check` 25 files, 0 hits. A15b: `pins.test.ts` passes, and the mutated `^`, `~`, third dependency and 0.188 copies each fail. A15c: `test:smoke`, `test:forever`, `test:perf`, `test:art` each `Error: No tests found.`, exit 1. `npm run test:browser` exit 0, 24 passed. `npm run test:foundation` exit 0, 29 passed, 18 skipped by design (`software` on the 1080p and one-rasterizer specs), 0 failed. A16: the listing printed nothing.
- [x] 2026-11-05T10:45Z M9 Hand-off. A17: `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0. A9b: `check:task T00` PASS: `tsc: 46 owned files, 2 configs, 0 problems`, `eslint: 47 owned files, 0 errors, 0 warnings`, `vitest: 13 owned files, exit 0`, `glsl: 53 owned files scanned, 0 hits`. After deleting `node_modules` and `test-results`: `npm ci` exit 0, lockfile hash unchanged, every gate above rerun. T00 is `done`, so `src/contracts/glsl/hero.glsl` passes to T04.

- [x] 2026-11-05T11:39Z Repair of six defects from an independent verifier, on plan `status: in-progress`. No sibling had started: every other plan read `approved`, and no sibling path existed. Temporary files in sibling paths were deleted afterwards, and A16 printed nothing.
  - **Defect 1, a sibling's banned token failed `check:task T00`.** Before: temporary `src/render/terrain/zz.glsl` with `uniform float uTime;`, `check:task T00` exit 1, `vitest: 13 owned files, exit 1`, `glsl: 53 owned files scanned, 0 hits`, failing `the default scope has files to scan and is clean`. After, same file: `check:task T00 PASS` exit 0, `glsl:check` exit 1 with `src/render/terrain/zz.glsl:1: banned uTime`, `check:task T03` exit 1 naming that hit (its three VACUOUS gates fail it anyway). A temporary `dev/audio.html` with `uTime`, `src/world/zz.ts` with syntax and type errors, and a red `tests/unit/world/zz.test.ts`, together: T00 exit 0, `glsl:check` exit 1, T07 exit 1 naming the `uTime` hit (with VACUOUS gates beside it), T01 exit 1 with `tsc 2 problems, eslint 1 error, vitest exit 1`. Control that T00 can still fail: temporary `src/testing/zz.glsl` with `uTime`, `check:task T00` exit 1, from the new test and the glsl gate both.
  - **Defect 2, the negative control needed a leftover build.** After deleting `node_modules`, `test-results`, `test-refs`, `dist`, then `npm ci` (139 packages, lockfile hash unchanged): `npx playwright test tests/support/buildproof --project=gpu -g "negative control" --output=test-results/V-neg` exit 0, 1 passed. Control: with the `beforeAll` build disabled and `test-results` deleted, the same command exit 1, `page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE`.
  - **Defect 3, `writeCameraPose` and the FOV cap.** Mutation `out.fovDeg = v.feel.fovDeg;` now fails `npx vitest run tests/unit/core`, 1 failed: `expected 68 to be close to 47.7567466072988`. Restored, byte-compared.
  - **Defect 4, `info.autoReset`.** Mutation to `true` now fails A11, exit 1: `Expected: > 3, Received: 1`. Restored, byte-compared. Correct code reads 15.
  - **Defect 5, the first-build bloom levels.** `firstBloomLevels` extracted, `tests/unit/core/devPost.test.ts` added. Mutation `return q.bloomLevels;` fails the unit test (`expected +0 to be 6`) and the tier-0 browser test (`Expected: > 10, Received: 4`). Mutation of the call site to `levels: quality.bloomLevels` passes the unit test, 2 passed, and fails the browser test the same way. That second result is why the browser assertion exists. Both restored, byte-compared. Correct code at tier 0 reads 15 calls.
  - **Defect 6, boundary gate spellings.** `boundaries.test.ts` table grown from 147 cases to 206. Before the config change: 42 of the new cases failed and 165 tests passed. After: 207 tests passed, `npm run lint` exit 0. A6n again: `src/world/height.ts` exit 1, `src/app/loop.ts` exit 0.
  - **Whole gates on that clean install, code final:** `npm run check` exit 0: 14 test files, 419 tests, `glsl:check: 25 files scanned, 0 hits`. `npm run check:task -- T00` exit 0: `tsc: 47 owned files, 2 configs, 0 problems`, `eslint: 48 owned files, 0 errors, 0 warnings`, `vitest: 14 owned files, exit 0`, `glsl: 54 owned files scanned, 0 hits`. `contracts:check` exit 0, 7 files, `0 added`. `plans:check` exit 0, `12 plans, 2648 pattern pairs, 0 problems`. `test:foundation` exit 0, 29 passed, 18 skipped by design. `test:browser` exit 0, 24 passed. `build:proof` exit 0, gzip 148.09 KB, same chunk hash `index-CQsMUNm9.js` as before the repair.
  - **Images opened, `test:foundation` run above:** `devshell-picture.png`, 1920x1080: same composition as M7, indigo corners, dark red above the sun, hot pink at the horizon, yellow to pale pink banded disc cut by the floor edge, magenta grid with bright cores. No fault seen. PICTURE metrics match M7: mean chroma 115.08, `blackP10` 16, near-white 0, 15 calls. `devshell-tier0.png`, 640x360 scaled up: same composition, softer, far field flatter magenta. These are stills, and the repair changed no pixel-affecting code on purpose, so they check only for accidental change.

- [x] 2026-11-05T13:05Z Repair of three defects from a second independent verifier, on plan `status: in-progress`. No sibling had started: every other plan read `approved`, and the A16 scan printed nothing at the start and at the end. Every mutation below went through a throwaway runner in the scratchpad that restores the file and compares its hash, and all reported restored.
  - **Defect 1, a required gate depended on machine load.** Before: the range test read 4723 ms against the 5000 ms limit, full suite exit 0. After: `npx vitest run tests/unit/core/fakeWorld.test.ts` exit 0, 29 passed, that test 120 ms. It still reads 201,546 records over the same 2000 chunks. **Negative controls,** each through `-t "keeps zLocal"`, each exit 1 with the expected text in `bad`: `Z_LOCAL` 64 and -1, `KEEP` 1, `TINT_SEED` 1, `VARIANT` 1 and NaN, `SCALE` 0, and with 2 chunks instead of 2000 `expected 203 to be greater than 100000`. **Under load, measured with `os.cpus()` over 3 s:** idle 4% busy. 12 spinners of 24 logical CPUs, 56% busy: `npm run check:task -- T00` exit 0, `vitest: 14 owned files, exit 0`, `check:task T00 PASS`. 24 spinners, 100% busy: `npx vitest run` exit 0, 420 passed; slowest with its own 120 s limit 13,068 ms, slowest with no per-test limit 8471 ms (the first lint case), range test 275 ms. **Part (b) has its own fail-before:** 24 spinners with `--testTimeout=5000` forced: exit 1, 1 failed, the first lint case `Test timed out in 5000ms` at 7370 ms. **Repeats, each with its own report kept:** 12 idle full runs, 6 full runs under 12 spinners: 18 of 18 exit 0, 7560 passed, 0 failed; range test at most 173 ms; slowest with no per-test limit 939 ms.
  - **Clean install:** deleted `node_modules`, `test-results`, `test-refs`, `dist`, then `npm ci` exit 0, lockfile hash unchanged. `npm run check` exit 0: 14 files, 420 tests, `glsl:check: 25 files scanned, 0 hits`. `npm run check:task -- T00` exit 0: `tsc: 47 owned files, 2 configs, 0 problems`, `eslint: 48 owned files, 0 errors, 0 warnings`, `vitest: 14 owned files, exit 0`, `glsl: 54 owned files scanned, 0 hits`.
  - **Defect 2, the literal `import()` seam.** Section 4's 'Dev page' row now states the rule. On throwaway pages under `tests/support/devshell/`, deleted afterwards, with no `src/world` or `dev` on disk (asserted). Variable form, T03's line as the defect gives it: the page reaches `window.__shell.ready`. Same form with an existing target: loads it, `ctx.world.seed` 7. Same form with `world=real` and no file: `pageerror` `Failed to fetch dynamically imported module`, at run time and on that branch only. Literal form, with no query and with `?world=ref`, and the literal with `/* @vite-ignore */`: document 200, `?html-proxy&index=0.js` 500, `window.__shell` undefined after 4 s. **T03's line and the ledger are not changed here,** see section 10. `grep` over the other plans found the same literal-import list the verifier reports: T03:289 is the only cross-task literal.
  - **Defect 3, test gaps.** A11h added to `devshell.spec.ts`, `?alpha=1` and a `setDebugMode` log to `trivialLayer.ts`, `?markworld=1` to `smoke.html`, a `2^40 + 127` case to `uniforms.test.ts`. Correct code: `POST-OFF CLEAR {"total":2073600,"wrong":0,"calls":0}`, `WIDE {"aspect":3.5555555555555554,"fov":47.7567466072988,"halfTan":1.5739999999999998}`, `ALPHA post on {"total":2073600,"notOpaque":0}`, `ALPHA post off {"total":2073600,"notOpaque":908160}`. **Mutants that survived before now fail,** each exit 1 at the named assertion: `travelMod(v.cam, WORLD_PERIOD * 2)` `expected 8140.5 to be 4044.5`; `d > 2 * CHUNK_LEN` `step645`; `camera.aspect = camera.aspect` `r.aspect`; `const world = createFakeWorld()` 1200 against 1500; `renderer.autoClear = false` `wrong` 2,073,600; no `AlphaOneEffect` `notOpaque` 910,080; `setDebugMode` not forwarded; `setVisible` not forwarded, `wrong` 2,049,526. **Three more I added,** also failing: `d >= CHUNK_LEN`, a `ctx` holding a different world, and the page ignoring `?alpha=1`, which fails the control at `off.notOpaque`. **Still surviving, as the verifier said:** `pass.dithering = false`, `freezeEffectTime` removed, precompile's `setRenderTarget` removed, each exit 0, 17 passed over the whole spec. Listed in section 13.
  - **Other gates, code final:** `test:foundation` exit 0, 30 passed, 19 skipped by design, and again exit 0 with the same counts under 12 spinners (55% busy). `test:browser` exit 0, 25 passed. `npx vitest run tests/unit/core` 125 passed. `build:proof` exit 0, gzip 148.09 KB, same chunk hash `index-CQsMUNm9.js`. `contracts:check` exit 0, 7 files, `0 added`. `plans:check` exit 0, `12 plans, 2648 pattern pairs, 0 problems`.
  - **Images opened:** `devshell-picture.png`, 1920x1080: indigo corners, dark red above the sun, hot pink at the horizon, yellow to pale pink banded disc cut by the floor edge, magenta grid with bright cores. `devshell-tier0.png`, 640x360 scaled up: same composition, softer. No fault seen. PICTURE metrics match M7: mean chroma 115.08, `blackP10` 16, near-white 0, 15 calls. These are stills, compared by description and metrics, since the earlier files were deleted with `test-results`. The floor's default fragment text is unchanged in substance, so they check only for accidental change.

- [x] 2026-11-05T14:05Z Repair of three defects from a third independent verifier, on plan `status: in-progress`. No sibling had started: every other plan read `approved`, and the A16 scan printed nothing at the start and at the end. Every mutation below was restored and its hash compared, by the scratchpad runner or by hand for the two extra ones, and all matched.
  - **Defects 1 and 2 were not fixed by this repair.** The verifier names the T00 owner for both, and both edit `plans/T03-terrain.md` or `plans/RECONCILIATION.md`, which are outside T00's `owns`, while this repair ran under "T00's owned paths only". Read at the end of this repair: `grep -n "await import('/src/world" plans/T03-terrain.md` still prints line 289, a grep of the ledger for `vite-ignore`, `realWorld = ` and `T03-terrain.md:289` finds 0 lines, and T03's M0 at line 186 still has the whole-repo proof. `npm run check:task -- T03` exit 1 with 3 `VACUOUS` lines, which is what the replacement proof expects. The exact text for the T00 owner is in section 10.
  - **Defect 3, test gaps.** A11i added to `devshell.spec.ts`, three tests and a 126-value test to `fakeWorld.test.ts`. `?hot=1`, `window.__frames` and `window.__lastView` added to `trivialLayer.ts`, and `?otier` to `smoke.html`. No production or contract code changed: `devShell.ts`, `devPost.ts` and `fakeWorld.ts` match their hashes from before the mutations. Correct code: `PROJECTION [1.8040477552714238,1.48256096851274,1.8040477552714238]`, `MSAA tier 3 [{"samples":2,"format":34842},{"samples":2,"format":33190}]`, tier 4 the same with samples 4, tier 2 none, `t3` 15 calls width 1920, `t1` 9 calls width 1280, `t4` 17 calls width 1920, `BLOOM added 68.97964938095103 code values with post on, 0 with post off`, `RAF` frames 1, 1, 21, 21 and tick 504, 504, 540, 540 with serial 0 throughout.
  - **Every mutant the verifier listed as surviving now fails, 16 of 16,** each exit 1 at the named assertion. `npx playwright test tests/support/devshell/devshell.spec.ts --project=gpu -g "A11i"`: no `updateProjectionMatrix` in `applyCamera` `Expected: 1.48256096851274, Received: 1.8040477552714238`; no `?palette` at `r.pal`; no `?hero` at `r.hero`; `startT = 0` `Expected: 504, Received: 0`; `o.tier` ignored at `{ tier: 1, width: 1280 }`; the public `rebuild()` emptied at `{ layer: 1, post: 1, serial: 0 }`; no cancel in `setManual` `Expected: 20, Received: 40`; `frameBufferType: 1009` RGBA16F count 0; `multisampling: 0` allocation count 0; no `composer.multisampling` update at `r.high`; no `levels` update `Expected: 9, Received: 15`; `intensity: 0` `Expected: > 20, Received: 0`. `npx vitest run tests/unit/core/fakeWorld.test.ts`: `0xfd3778` and the Arctic Laser disc top `0xffffff` at the 126-value test; SAUCER hover 0 at the hover test; `reduced.chunk = at.chunk` `expected 0.00004311431393396575 to be 0.000007886289168558526`.
  - **Mutants I added, 14.** Failing, 13: no `?biome`; `o.tier` outranking `?tier`; the public `rebuild` skipping the stack; rAF time with no origin `Expected: < 564, Received: 432580`; the loop dropping `startT` `Expected: >= 504, Received: 36`; `dispose` leaving the canvas; `dispose` leaving `window.__shell`; `forceMsaa` not applied; the last hex of the last row; `height` with no period; `zoneAt` with no reduce; cancel and guard removed together `Expected: 20, Received: 40`; `setManual(true)` ignored `Expected: 21, Received: 41` at `stopped.frames`. **Surviving, 1:** removing `manual` from the loop's guard, exit 0, see section 13.
  - **Repeats of A11i:** 12 idle, all passed, and bloom read the same value in all 12. 6 under 12 spinners (61% busy), all passed. Its loop step runs on a paused `page.clock`, so a slow machine cannot change the frame count.
  - **Clean install:** deleted `node_modules`, `test-results`, `test-refs`, `dist`, then `npm ci` exit 0, lockfile hash unchanged. On that cold Vite cache, first: `test:foundation` exit 0, 31 passed, 20 skipped by design. Then `npm run check` exit 0: 14 files, 424 tests, `glsl:check: 25 files scanned, 0 hits`. `npm run check:task -- T00` exit 0: `tsc: 47 owned files, 2 configs, 0 problems`, `eslint: 48 owned files, 0 errors, 0 warnings`, `vitest: 14 owned files, exit 0`, `glsl: 54 owned files scanned, 0 hits`, and again exit 0 under 12 spinners (63% busy). `test:browser` exit 0, 26 passed. `npx vitest run tests/unit/core` 129 passed. `build:proof` exit 0, gzip 148.09 KB, same chunk hash `index-CQsMUNm9.js`. `contracts:check` exit 0, 7 files. `plans:check` exit 0, `12 plans, 2648 pattern pairs, 0 problems`.
  - **Images opened:** `devshell-picture.png`, 1920x1080: indigo corners, dark red above the sun, hot pink at the horizon, yellow to pale pink banded disc cut by the floor edge, magenta grid with bright cores. `devshell-tier0.png`, 640x360 scaled up: same composition, softer, far field flatter magenta. No fault seen. PICTURE metrics match M7: mean chroma 115.08, `blackP10` 16, near-white 0, 15 calls. These are stills, and `trivialLayer.ts`'s default shaders did not change, so they check only for accidental change.

Remaining in T00's own paths: nothing. `check:task` on a task with no files yet exits 1 with `VACUOUS`, by design: T01, T03 and T11 were run to confirm it.

- [x] 2026-11-05T14:45Z T00 owner closed the three items this repair left open, per DI-54: `plans/T03-terrain.md` M3 and M0, and the ledger entry. `npm run plans:check` and `npm run check` rerun by the owner. The fourth verifier's remaining findings are in DI-55 (subnormal `advance`, no change) and DI-57 (test gaps, listed in section 13). The T00 owner, not an independent reviewer, closed this last step, and no verifier reran after it.

- [x] 2026-11-06T12:18Z Reopened for VI-gates' bare `test.fail()` control at `tests/support/devshell/devshell.spec.ts:658-663` (A11f), acting for the T00 owner. T02 reads `in-progress`, so siblings may be running: no shared file is mutated in place, and every drill runs on copies under `tests/support/zzdrill/`, deleted afterwards. Before any edit, sha256: `pw.ts` ac87272c...54e09, `devshell.spec.ts` 16682a15...0b4f, this plan bb287f5b...f69c, copies in the scratchpad's `T00-FC/orig/`.
- [x] 2026-11-06T12:26Z to 12:29Z **Fail-before, the old control on copies.** A scratchpad runner (`T00-FC/drill.mjs`) copies `pw.ts` and `devshell.spec.ts` into `tests/support/zzdrill/` with only their relative imports rewritten, applies one mutation, runs `-g "negative control: without allowConsoleErrors" --project=gpu`, deletes the folder, and checks the live files by sha256: `liveFilesUnchanged=true zzdrillRemoved=true` on all 16 runs below. Old form, exit code and summary: unmutated 0, `1 passed` (the expected failure, printed with a cross). **Counted as the expected failure, so the defect is real:** the guard's fixture throwing a `TypeError` after `use()` 0, `1 passed`; the page with no shell and `waitForFunction`'s own 5 s timeout 0, `1 passed`; an extra `console.error('DRILL unrelated error')` beside the shader error 0, `1 passed`. **Not counted, against the finding's wording:** the fixture throwing before `use()` 1, `Error: DRILL broken fixture` (the body's `test.fail()` is never reached); a test timeout, `--timeout=15000` on the page with no shell, 1, `Test timeout of 15000ms exceeded` (status `timedOut` is not the expected `failed`). Caught by the old form too: the guard's check made `if (false)` 1, and `allowConsoleErrors` defaulting to true 1, both `Expected to fail, but passed.` The setup run's log is named `drill-old-setup.log` and its line reads `drill=fixture`, the mutation's first name.
- [x] 2026-11-06T12:30Z **The change.** `test.fail()` is gone. The control runs the bare test in the new `consoleguard.control.ts` in a child Playwright process, through the new `consoleguard.config.ts` (the repo's `gpu` project and `use`, no `webServer`, `timeout: 30_000`), with `--reporter=json`, and asserts what the report says: no run errors, statuses exactly `['failed']`, one error, header `Error: N console errors:`, N entry lines, each `console.error: SHADER_ERROR `, child exit 1. `pw.ts` is unchanged (sha256 still ac87272c...54e09). New hashes: `devshell.spec.ts` c4422e4e...e056, `consoleguard.control.ts` 754267c1...6873, `consoleguard.config.ts` c04e23e5...ddf2. Real files, 12:30Z: exit 0, `1 passed (5.6s)`, `GUARD CHILD {"exit":1,"statuses":["failed"],"head":"Error: 1 console errors:","entries":1}`. The child report's message: `Error: 1 console errors:\nconsole.error: SHADER_ERROR Fragment shader is not compiled.` then `ERROR: 0:238: 'thisNameIsNotDeclared' : undeclared identifier`.
- [x] 2026-11-06T12:30Z to 12:32Z **Pass-after, the same drills on copies of the new form.** Unmutated 0, `1 passed`. **Each now fails, exit 1:** fixture throwing before `use()`, the parent's own fixture fails with `Error: DRILL broken fixture`; fixture throwing after `use()`, `GUARD CHILD ... "head":"TypeError: DRILL broken fixture teardown","entries":0` at `expect(head).not.toBeNull()`; action timeout, `"head":"TimeoutError: page.waitForFunction: Timeout 5000ms exceeded."` at the same line; test timeout, `"statuses":["timedOut"]` at the status line, after 31.7 s; extra unrelated error, `"head":"Error: 2 console errors:","entries":2`, failing at the filter with `["console.error: DRILL unrelated error"]`; guard check bypassed and `allowConsoleErrors` defaulting to true, each `"statuses":["passed"]`, `Expected ["failed"], Received ["passed"]`. So a broken fixture no longer counts as the expected failure, and nothing the old form caught is lost.
- [x] 2026-11-06T12:33Z **Whole spec, real files, on gpu:** `npx playwright test tests/support/devshell/devshell.spec.ts --project=gpu --output=test-results/T00-FC` through the GPU lock, exit 0, `18 passed (18.1s)`, no cross in the list, no `Execution context was destroyed`. PICTURE metrics as before: mean chroma 115.08, `blackP10` 16, near-white 0, 15 calls. `npx playwright test tests/support --list` over all four projects: `Total: 51 tests in 6 files`, the control listed twice (gpu and software), and 0 lines naming `consoleguard` or the child's title, so no suite collects the child.
- [x] 2026-11-06T12:35Z **Gates, code final.** `npm run check:task -- T00` exit 0: `tsc: 49 owned files, 2 configs, 0 problems`, `eslint: 50 owned files, 0 errors, 0 warnings`, `vitest: 14 owned files, exit 0` (425 tests), `glsl: 56 owned files scanned, 0 hits`, `check:task T00 PASS`; the two extra files in each count are the new ones. `npm run plans:check` exit 0, `12 plans, 2648 pattern pairs, 0 problems`. `tests/support/zzdrill/` does not exist. Not run here, by instruction: `npm run check`, `test:browser`, `test:software`; the T00 owner runs them next. Remaining in T00's paths: nothing.

### Amendment PR, public release (operator request, T12)

- [x] 2026-11-12T18:04Z `plans/README.md`: the index row and the order line for T12. The operator ratified `plans/T12-release.md` in session ("Plan is ratified as written. Go."), and the T00 owner gave it the next number.
- [x] 2026-11-12T18:04Z `package.json`: `description`, `license` (`MIT`), `homepage` and `repository` added after `private`. `"private": true` stays, and no dependency, version, engine or script changed. `package-lock.json`: the root entry gains `"license": "MIT"`, the one line npm itself writes there for a licensed package; edited by hand, because `Agents.md` forbids an ad hoc `npm install`.
- [x] 2026-11-12T18:04Z Gates: see `plans/T12-release.md` section 9, which records `npm run plans:check` and the whole-repo `npm run check` after these edits. A fresh clone's `npm ci` against the edited lockfile is T12's A7.

- [x] 2026-11-12T18:14Z `tests/boundaries/gates.test.ts`, four lines. The file reads the real `architecture.md` and pinned the number of tasks at 12, so T12's row failed three assertions: the row list at line 71 and `12 plans` at lines 134 and 201 (`3 failed | 1987 passed | 2 skipped`; received 13 rows and `13 plans, 3187 pattern pairs, 0 problems`). Changed: the test's title, the row list (`'T12'` added) and the two `12 plans` strings, now `13 plans`. The operator agreed in session, verbatim: "Proceed with the fix for the 4 lines." The whole-repo result after it is in `plans/T12-release.md` section 9.

## 10. Surprises and discoveries

All from the 2026-11-05 rehearsal. None of these has run against project code.

- **Filtering `tsc` CLI output would have passed falsely.** With a syntax error in one file, the CLI printed only `rings.ts(5,1): error TS1005`, while the compiler API on the same file also returned TS2322, TS2391 and TS7010. That is why `check:task` uses the API.
- **`gl.RENDERER` is masked.** It returned `WebKit WebGL` on both the RTX and SwiftShader. Only `UNMASKED_RENDERER_WEBGL` gives `ANGLE (NVIDIA, ...)` or `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...`. A governor or test matching `gl.RENDERER` would never detect software rendering.
- **A one-byte flake with post on.** Rendering the same frame 16 times, comparing full-frame bytes: post off gave 0 differences in all 4 runs. Post on, at MSAA 0 and 2, gave no difference in 4 of 8 runs and in the others up to 12 of 16 frames differing, always by 1 byte, by 1/255, at the same pixel (row 560 from the top, col 513), persisting across consecutive frames once it appears, all inside one JS task. SwiftShader's 4 repeats showed none. **Cause not established.** An FNV hash compare in the first version of the test failed 2 of 3 runs on this. §11.3's post-on "0 bytes" may therefore flake.
- **A favicon request fails a clean-console test.** A page with no icon link logged `Failed to load resource: the server responded with a status of 404` on the first navigation. The `pw.ts` fixture answers it; `index.html` should declare its own.
- **`/` is 404 under Vite until `index.html` exists,** even with `appType: 'mpa'`, so `webServer.url` cannot be the root.
- **Playwright clears its output folder at start.** A stale file in `test-results/default` disappeared while a file in sibling `test-results/keepme` survived. A default output of `test-results` would therefore let any stray run wipe every task's evidence [I].
- **Node type leakage.** With no `include` in `tsconfig.json`, the whole tree compiles as one program and `process` passes, because vite's types pull in `@types/node` [O: no diagnostics]. With `include: ["src/**/*.ts"]`, `process` in `src/` gives TS2591 [O].
- **`--disable-3d-apis` makes three log** `A WebGL context could not be created. Reason: disabled by enterprise policy or commandline switch` before throwing.
- **The first boundary regex missed `../props/rings`** between render siblings, caught by the negative-control table. This is the case for keeping the table.
- **`eslint .` scans dot-folders.** It linted `.claude/workflows/terrain-design-docs.js` (0 errors today). No task owns that file, so a later edit could break everyone's `npm run lint`, hence the ignore entry.
- **DevPost on the rehearsal scene:** 14 draw calls, 5 programs, p50 0.8 ms and p95 1.4 ms synced over 60 frames at 1080p, MSAA 2 on the RTX.
- **`.mjs` under `checkJs` needed heavy JSDoc** to pass `noUncheckedIndexedAccess`. `.ts` scripts run by Node needed none and got full strict checking.

From execution, on 2026-11-05, against project code:

- **DI-46 holds only for a change of levels, not for a first profile at 0.** `new BloomEffect({ levels: 0 })` did not throw: `MipmapBlurPass`'s `levels` getter already reads 0 on a new pass, so the setter does nothing, and both mipmap lists stay empty. My first negative control therefore passed when it should have failed [O: `1 passed`]. The throw needs non-zero then 0: the setter pushes `renderTarget` onto `upsamplingMipmaps` while `downsamplingMipmaps` stays empty, and `render` reads `downsamplingMipmaps[0].texture` [read: `build/index.js:3979`, `:4019` onward; O: `TypeError ... reading 'texture'`]. A bloom at levels 0 from the start would also never render its target, so `createDevPost` builds with 6 when the first profile has none. T06's real stack is not bound by this, but the same two paths exist there.
- **A resize test passed once and failed in the next suite.** It passed in `test:foundation` and failed in the following `test:browser`. My output filter dropped its error text, so the failure itself was not read. The cause is inferred, not shown: the test waited for `innerWidth`, which I recall changes before the `resize` event dispatches [M], and the shell then only acted on the event, so the frame could draw at the old size. The shell now compares sizes in `frameAt`. That test then passed 8 of 8 alone and in both suites after, which fits the inference without proving it. A spec that resizes after the page is open would have been exposed to the same race.
- **`--reporter=json` with no `--outputFile` writes `.vitest/json/output.json` in the project root.** My own command created it, once. It is not in `.gitignore` and no task owns it. I removed it and used `--outputFile` in the scratchpad instead.
- **`page.goto` throws on a 404 with an empty body:** `net::ERR_HTTP_RESPONSE_CODE_FAILURE`, so `response.status()` is never reached. T10's `dist.spec.ts` should not rely on reading that status from a navigation.
- **The list reporter prints a passing `test.fail()` case with a cross.** The summary counts it as passed. Read the summary, not the mark.
- **Vite 8 forwards the page's console to the dev server's terminal,** as `[vite] (client) [console.error] ...`. So the deliberate shader failures and no-WebGL errors show up in the output of a green run. This is not a failure.
- **`KHR_parallel_shader_compile` is missing on SwiftShader,** and `compileAsync` logs `THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported` through `console.warn`. It does not fail the fixture.
- **esquery ends a regex at the first `/`,** with no escape for it, so the `ImportExpression` selector writes `/` as `\x2F` rather than `\/`.
- **Real numbers against the rehearsal:** `plans:check` reads 2648 pattern pairs against 2441 on generated plans, and the bundle is 148.09 KB gzip against 141.33 KB, since this one builds a composer and renders a frame. Both are inside their limits.
- **Backslashes in a Bash heredoc came through collapsed:** `\\` written in a Python heredoc reached the file as `\`, and one quoted heredoc failed to parse. The control test caught the bad regex. Use Edit, or a script file, for text with backslashes.

From the verifier's repair, on 2026-11-05:

- **`TSImportType[argument.literal.value=...]` works and prints a warning per node.** On `check:task T00` it printed `DeprecationWarning: The 'argument' property is deprecated on TSImportType nodes. Use source instead.` about 30 times, with no failure. The installed `ast-spec.d.ts` gives `source: StringLiteral`, and the warning stopped with `TSImportType[source.value=...]`.
- **A dynamic `import('../Sim/rules')` passed while the static form failed.** esquery regexes are case-sensitive, and `no-restricted-imports` ignores case by default. The selectors now carry `i`.
- **A banned token in `src/contracts/glsl/hero.glsl` fails `check:task T00`** [O: temporary `// uTime` line, exit 1, file restored by hash]. T00's `owns` covers that path and the overlap is legal, so this is the rule as written, not the defect 1 bug, and it is left alone: excluding the file would narrow T00's gate. T04 publishes by rename after its own checks, so a half-written file should not land there [read: `plans/T04-sky.md` M3], but if T04 ever publishes a banned token, T00's `check:task` goes red with it. **Open for the T00 owner.**
- **`import * as T from 'three'` fails lint everywhere three is allowed,** even for `new T.Scene()`, because the `Clock` entry uses `importNames` and a namespace import could reach it [O: probe in `src/render/sky/x.ts`]. No plan uses that form outside T08's expected-fail row [read: grep over `plans/`], so named imports are what every task writes.
- **What the boundary gate still does not see** [O: `lintText` probes, all passing]: `new Date()` and a local alias `const M = Math; M.random()` in a pure module, `require('../sim/rules')` through a hand-declared `require`, `new URL('../sim/rules.ts', import.meta.url)`, and `import('three').Clock` in type position, which is only a type. The first two would matter most in `world`, `sim` and `feel`, where a golden hash such as T02's `GOLDEN` should change if one reached the output [I]. None is in the plan's required list, so none was added.

From the second verifier's repair, on 2026-11-05:

- **A literal `import()` of a missing file fails the page's inline module, not the document.** Browser view of a throwaway page with no `src/world`: document 200, `zz-seam-literal.html?html-proxy&index=0.js` 500, one `Failed to load resource` console error, `window.__shell` undefined after 4 s. My first probe asked for the document's status through `page.request.get`, read 200, and failed. So a test that checks a navigation's status does not see this. Vite logs it as `Pre-transform error: Failed to resolve import "/src/world/index.ts"`. `openDevPage` then waits out its timeout, as the verifier saw. I did not change that: nothing asked for it, and the console error is in the failure report.
- **Text for the T00 owner: this repair did not apply it.** T00 does not own either file (section 11). In `plans/T03-terrain.md:289`, replace the comment with `// world=real does: const realWorld = '/src/world/index.ts'; const { createWorld } = await import(/* @vite-ignore */ realWorld);`, as a seam defect under Agents.md, and record it in `plans/RECONCILIATION.md`. The line is a comment describing a page T03 has not written, so nothing on disk is broken today. An executor who copies it fails whenever T01 has not yet written that file.
- **The existing resize test could not see a stale aspect.** It went from 1920x1080 to 1280x720, both 16:9, so `camera.aspect = camera.aspect` passed it. A11h goes to 3840x1080.
- **The first lint case is now the slowest test with no per-test limit,** because ESLint loads its config there: 842 ms idle before the repair, 8471 ms at 100% of 24 CPUs after it, and 7370 ms in the run with the 5 s limit forced, which failed. So part (b) of defect 1 is needed even with the rewrite. The margin at that load is about 3.5 times.
- **`AlphaOneEffect` is doing real work at T03's alphas.** Without it, a floor writing .25 leaves 910,080 of 2,073,600 pixels not opaque under DevPost. The `post=off` control reads 908,160. The two differ, and I did not look into why.
- **A clean loop does not explain the verifier's unattributed failure.** Its six-run loop had one `exit=1` whose report was overwritten. My 18 runs kept every report and had no failure, so I can say this failure did not recur in 18 runs. Its cause stays not established, and it may or may not have been the timeout fixed here.

From the third verifier's repair, on 2026-11-05:

- **`set multisampling` allocates a 1x1 RGBA8 multisampled renderbuffer.** A spy on `renderbufferStorageMultisample` saw RGBA8 first, then the RGBA16F colour and depth buffers at 1920x1080. A stack from the spy put it in postprocessing's `getSafeSamples`, reached from `set multisampling`, from `setRenderer`, from `new EffectComposer`. It is a probe of the sample limit and not a target. A spy that counts every call sees a colour format that is not HDR, and an `every samples === N` check can be met by the probe alone, so A11i keeps `width > 1` only. T06's and T09's spies will see the same call.
- **My first bloom band sat on the quad.** It read 90.01 code values, which looked like plenty. The quad's near edge works out at about x 716, and a profile then showed the band's right side had a 68.59 delta with post off, where no bloom exists. So that band would likely have passed at `intensity: 0` as well [I: not run on the first band]. The band is now x 560 to 700, the post-off delta is asserted to be exactly 0, and the mutant fails it. The profile with post on read 12.76 at x 560, 38.65 at 600, 74.34 at 640 and 118.59 at 680.
- **`manual` in the loop's guard appears redundant with the cancel.** Removing it passes A11i, since `setManual(true)` leaves no request pending. The cancel in turn showed only on off-then-on inside one task, where it stops a second loop: 40 frames against 20 without it. So the verifier's mutant needed that exact sequence.
- **`page.clock` suits the rAF loop.** Frame counts read exactly 20 per 320 ms over 18 runs, idle and under load, and the mutant with no time origin gave tick 432,580 from the hour on the paused clock. Real-time rAF would have had the jump limit depending on a hitch: 64 u at `SPEED_CRUISE` 80 u/s is .8 s.
- **Text for the T00 owner, added to the T03:289 text above, also not applied here.** In `plans/T03-terrain.md:186`, M0's Proof, replace `` `npx tsc --noEmit -p tsconfig.json` exits 0 before any T03 file exists `` with `` `npm run check:task -- T03` runs, and it fails `VACUOUS` until M1 adds code, as expected ``, which is T07's M0 form, and add a section 14 note there. Add a seam entry to `plans/RECONCILIATION.md` citing section 4's 'Dev page' row. Then update this plan's sections 9, 10 and 13, which list these as open. To re-verify: `grep -n "await import('/src/world" plans/T03-terrain.md` prints nothing, and `npm run plans:check` exits 0.

From the VI-gates `test.fail()` repair, on 2026-11-06:

- **`test.fail()` in Playwright 1.64.1 counts some failures and not others.** On copies of the old control: an error after the body's `test.fail()` runs counted as the expected failure, including a fixture's teardown `TypeError`, an action's own `TimeoutError` and a guard failure that also carried an unrelated error. A fixture throwing before `use()` did not, since the body never ran `test.fail()`, and a test timeout did not, since its status is `timedOut` and not the expected `failed` [O: the drill runs in section 9; read: `_failWithError` in `worker/workerProcessEntry.js:1101` sets `timedOut` for a `TimeoutManagerError`]. So VI-gates' "any failure, a timeout or a broken fixture included" holds for an action timeout and a fixture failing at teardown, not for a test timeout or a fixture failing at setup.
- **A teardown error turns a skipped test into a failed one.** `_failWithError` changes status `skipped` to `failed` [read: `workerProcessEntry.js:1102`; not run]. So an expected-failure mode inside `pw.ts`'s guard would also need a skip check: on `software` the control skips in its body, and a guard asserting at teardown that it had failed would fail the skipped test. That was a second reason not to build it; the main one is the next item.
- **No passing in-process test can see a guard that never fails.** A test passes when nothing throws, so any design where the control itself catches the guard's failure passes when the guard's code is removed. Only a run outside the test can read that a test failed, which is why the control spawns a child run. The `bypass` and `default` drills are the evidence.
- **The JSON report's raw message keeps colour codes on a test timeout,** `\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m`, with `FORCE_COLOR=0` set. The guard's own message had none. A coloured guard message would fail the header match, a false failure and not a false pass.
- **The shader log carries NUL bytes.** The child's message has `\u0000` lines between the info logs, so `grep` called the drill logs binary. `grep -a` reads them.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| `check:task` uses the TypeScript and ESLint APIs and spawns Vitest with explicit test paths | CLI filtering is unsound (section 10). Rehearsed end to end on a fixture tree | 2026-11-05 | T00 planner |
| Empty owned paths fail `check:task` with `VACUOUS` | A gate that passes on nothing is not evidence. All gates still run and print, so early runs stay useful | 2026-11-05 | T00 planner |
| Gate scripts are `.ts`, run directly by Node 24, in `scripts/`, type-checked by `tsconfig.node.json` | No JSDoc burden, full strict checks, no new dependency. Relative imports in scripts carry `.ts`, hence `allowImportingTsExtensions` | 2026-11-05 | T00 planner |
| `eslint.config.js` is not type-checked | Under `checkJs` it needs a lot of JSDoc. ESLint validates it at load, and the boundary table proves its behaviour | 2026-11-05 | T00 planner |
| `tsconfig.json` adds `include`; `tsconfig.node.json` keeps `vite/client` and adds `node` | §8.3 states this (DI-37), and tests import `?raw` code too. Compiler options otherwise unchanged | 2026-11-05 | T00 planner |
| `src/testing` may import `three` and `postprocessing`; `fakeWorld` and `scriptedFrame` may not | `startDevShell` must build a `RenderContext`. §3.2 states this (DI-37). T07 and T08 pages stay three-free | 2026-11-05 | T00 planner |
| `src/harness` may import `three`, not `postprocessing` | §3.2 states this (DI-37). It reaches post through `PostStack`, and three is only needed for small helpers | 2026-11-05 | T00 planner |
| `src/app` may import `postprocessing` | §3.2 states this (DI-37). T10 is unlikely to need it, and the rule would only surprise | 2026-11-05 | T00 planner |
| T00's proof pages live in `tests/support/devshell/` | §3.1 gives `dev/` pages to module owners and §12 gives T00 no `dev/` path. Vite serves them under root [O] | 2026-11-05 | T00 planner |
| Project routing by file suffix, not `test.skip` in each spec | §12 gives T03 to T06 a single spec file, which must stay runnable under `gpu` or `software`. Only timing and no-webgl need exclusivity. `tests/support` specs that need 1080p skip themselves outside `gpu` | 2026-11-05 | T00 planner |
| `workers: 1`, `retries: 0` | One GPU; a retry would hide the flake that a negative control is there to show | 2026-11-05 | T00 planner |
| Armed-later suites exit 1 with "No tests found", no `--pass-with-no-tests` | A suite that finds nothing must not look green | 2026-11-05 | T00 planner |
| `hash01` is Murmur3-style with separate high and low words of chunk, text pinned here | T01's golden hash depends on exact output, and §8.1 gave only the signature. Measured in section 5 | 2026-11-05 | T00 planner |
| DevPost mimics §6.6 without CA, Crt or vignette | Without a depth buffer the bare canvas is wrong (§6.10, A11c) and without tone mapping the colours are wrong. T03 to T05 must judge against something close | 2026-11-05 | T00 planner |
| `scriptedFrame` mutates and returns one object | Matches the real `FrameView` lifetime, and exposes a layer that retains it | 2026-11-05 | T00 planner |
| `fakeProfile` uses exact pixel counts | §6.10's rounded figures give DPR 0.999 at 1080p (closed by S-42) | 2026-11-05 | T00 planner |
| `contracts-check` is an additive subsequence check, in `npm test` | Approved additions must pass, and T11's numeric exception must pass, while a removal or edit must fail forever. T04's ownership of `hero.glsl` narrows that file to its signature | 2026-11-05 | T00 planner |
| `plans:check` also verifies `owns` against §12 and the template headings | Agents.md requires both, and parallel authors will drift. A static glob intersection is required, since no files exist when it first runs | 2026-11-05 | T00 planner |
| GLSL gate scans comments too and has wider swizzles than the literal `cameraPosition.z` | Simple and fail-safe. `.xyz` leaks z just as `.z` does | 2026-11-05 | T00 planner |
| Vite `cacheDir` per port, Vitest cache per task | Parallel executors otherwise share one optimizer folder. Whether sharing would actually corrupt is untested [I], and the fix costs nothing | 2026-11-05 | T00 planner |
| Software viewport 640x360; GPU viewport 1920x1080; no-webgl default | Tier 0 is 640x360 (§6.10). A spec can call `page.setViewportSize` for other shapes | 2026-11-05 | T00 planner |
| The shell applies a resize by comparing sizes in `frameAt`, not from the `resize` event (M7 amended) | A test that resizes and renders at once should not depend on event timing (section 10). Same behaviour for every other caller | 2026-11-05 | T00 executor |
| The rAF loop counts from its first callback, not from page time (M7 amended) | `frameAt(ms / 1000)` after a slow boot reads as a jump, and raises `warpSerial` and rebuilds on the first frame. No plan depends on absolute rAF time, since a timestamp is arbitrary anyway | 2026-11-05 | T00 executor |
| `createDevPost` builds with 6 levels when the first profile has `bloomLevels` 0 | DI-46 says leave levels unchanged, and a first build has no prior value. The library default is 8 and tier 3 is 6. With 0 the bloom would silently never render | 2026-11-05 | T00 executor |
| A13's samples use T01's item domains, with no change to the 1e-3 limit | My first samples drove `droneOffset` with the traffic row's inputs, amp 128 and k 48, and read .00162 u, over the limit. T01's drones have amp 3 to 8 and k 1, and its cars have travel 64 to 128 with `a * k / 256` in 20 to 40. On those, including k 160 at phase .999, the worst is .000234 u. The out-of-domain figure is float32 precision on an input no record holds, and it is recorded here so the change can be judged | 2026-11-05 | T00 executor |
| `scriptedFrame` with `o.tick` and no `o.at` gives alpha 0 and `cam` at that tick's travel | M6 states the `at` and no-`at` cases only. A given tick means an exact state, so no interpolation | 2026-11-05 | T00 executor |
| `fakeHost` colours are a hash of the state, not a scaled value | `(row mod 1024) / 1024` in 8 bits gives rows 5 and 6 the same byte, which would pass A12's "equal" and fail its "differs" | 2026-11-05 | T00 executor |
| Fake pylons run 28 rows on, 4 rows off | M6 sets the wire flag from the next row, so a pair on every row would leave the .25 value untested | 2026-11-05 | T00 executor |
| Fake gates are all normal gates, `a` 0, with no checkpoint | M6 lists gates at `chunk % 3 === 0`, `radius 9` and no checkpoint. T01's `c % 100` checkpoint is T01's row, and T02 and T05 test it on their own data | 2026-11-05 | T00 executor |
| `check:task` also fails an owned `.ts` file in no program, with its own fixture T92 | The plan states the rule without a row in its table, and an untested rule proves nothing | 2026-11-05 | T00 executor |
| `gates.test.ts` no longer asserts the default GLSL scope is clean. It asserts that scope has files, and that T00's own paths have no hits, with a non-empty scan | It runs in `check:task T00`, and the default scope covers siblings' paths, so a sibling's token failed T00 against section 1 item 3 and Agents.md Definition of done item 2. No gate is weakened: `glsl:check` in `npm run check` still fails the same token, shown by a run. `src/contracts/glsl/hero.glsl` is still scanned, see section 10 | 2026-11-05 | T00 executor |
| M4's module regex and selectors amended: the prefix takes `./`, and `src/NAMES` matches at any depth | The plan's regex read specifiers as text, so `./../sim/rules`, `../world/../sim/rules` and `../../../terrain/src/sim/rules` passed lint, and the compiler's resolver accepts those shapes (section 13). The regex was right to the cases M4 listed, so this is a plan amendment, not a code bug | 2026-11-05 | T00 executor |
| Non-canonical specifiers are banned in every row, beyond the verifier's `name/../` pattern: also `/./`, `//`, a backslash and `node_modules/` | The cause is that a specifier is read as text, so listing only the spellings already found would leave the next one open. Same class, one regex, one table row each, and a grep over `plans/` found no use | 2026-11-05 | T00 executor |
| Type-position `import()` follows the static list, so in `src/app/**` and `src/main.ts` a type-position `harness` fails, while a runtime `import('../harness/index')` passes | `import type` from the harness already fails there, and a dynamic import's result is already typed, so T10 loses nothing. T09's `typeof import('./metrics')` inside `src/harness` is self-relative and passes, with a table case | 2026-11-05 | T00 executor |
| `ImportExpression[source.type!="Literal"]` and `import.meta.glob` are banned in every row, not only template literals | A variable specifier or a glob gets past the gate the same way a template literal does. A grep over `plans/` found no such use in linted code. T03's `dev/terrain.html` uses a literal and is not linted. `tests/support/**` has no row, so its `@vite-ignore` imports stay legal | 2026-11-05 | T00 executor |
| Pure rows ban `Math`, `Date` and `performance` through `globalThis`, `window` and `self` | The verifier left this open. `globalThis.Math.random()` is one edit from legal code and has no use in a pure module. `const M = Math` cannot be caught this way, and is recorded in section 10 instead | 2026-11-05 | T00 executor |
| The tier-0 browser test also asserts `calls` above 10 | The verifier offered a unit test or a browser metric, and a unit test on `firstBloomLevels` alone cannot see a call site that stops using it: that mutation passed the unit test. `lit > 1000` could not tell the two apart either (230,400 against 162,993), and the draw count can (15 against 4) | 2026-11-05 | T00 executor |
| `src/testing/index.ts` re-exports `createDevPost` by name instead of `export *` | `firstBloomLevels` exists for the test and is not part of the surface §8.1 lists | 2026-11-05 | T00 executor |
| Acceptance change, proposed by the independent verifier: `testTimeout: 30_000` in `vitest.config.ts`, and the fake world's range test uses one aggregated expect. Same 2000 chunks, same fields, same bounds. No bound or expected value changed, only the time limit | The test made about one `expect` per field, about 4.7 s against the 5 s default, a margin of about 6% [verifier: eight idle runs 4644 to 4745 ms; mine before the change 4723 ms]. That made a required gate depend on load, against Definition of done item 2 and section 12, while T01 to T09 share these CPUs. Verifier's runs: a first `npm run check` after a clean install failed at 5058 ms; on 24 logical CPUs, 6 spinners passed at 4965 ms, 12 failed at 5485 ms, 24 failed at 7193 ms and also timed out `boundaries.test.ts`'s first lint case at 6277 ms; `check:task T00` with 12 spinners failed; the aggregated form took 129 ms idle and 218 ms with 24 spinners, and `--testTimeout=30000` with 24 spinners passed with the slowest test at 15.6 s. Both changes are needed: the rewrite removes the cost, and the limit covers the first lint case and siblings' tests under load. `retries: 0` stays, since a retry would hide a flake rather than remove one | 2026-11-05 | T00 executor, verifier's proposal |
| The range test keeps `bad` uncapped | With every record failing, `bad` held 201,546 entries and the failing run still took under 1 s, so a cap would save nothing and add a branch | 2026-11-05 | T00 executor |
| A11h is one test with named steps, as the verifier proposed, and has two controls beyond its list: 1500 on the default world, and `?alpha=1&post=off` not opaque | A value of 1200 or 0 means nothing unless the page can read otherwise. Without the second control, a floor that ignored the flag would pass the alpha check [O: control mutant fails `off.notOpaque`] | 2026-11-05 | T00 executor |
| The 'Dev page' row says the inline module fails with a 500, not the whole page as the defect's text put it | At browser level the document returned 200 and `?html-proxy&index=0.js` returned 500 [O], for no query, `?world=ref` and the `@vite-ignore` literal alike. The effect the verifier described holds, and `window.__shell` never appears, but a check on the navigation's status would not see it | 2026-11-05 | T00 executor |
| `plans/T03-terrain.md:289` and `plans/RECONCILIATION.md` are not edited by this repair. The exact text goes to the T00 owner | T00 does not own either file. Agents.md says a plan is writable only by its owner, that executors treat the ledger as read-only, and that a seam defect goes to the T00 owner, who records it. This repair ran under "T00's owned paths only". Section 10 holds the text | 2026-11-05 | T00 executor |
| A11i and the fake-world tests are added now and not deferred, one case with named steps, as the third verifier proposed. A Deviations-level amendment | Section 4 promises these paths to siblings, and T00's suite could not see them break [verifier: 16 mutants exit 0 before this change; I did not rerun that state]. T01 to T09 have not started, so it is cheapest now. No threshold or expected value was changed, and no production code | 2026-11-05 | T00 executor, verifier's proposal |
| Checks beyond the verifier's list: `?biome`, the query outranking `o.tier`, `forceMsaa`, `dispose`, the rAF time origin, and a period that shares no factor with `bendAt` and `height` | Each was the same kind of gap as a listed one and needed only a few lines, and each new assertion was then seen failing. Period 101 is there because the verifier showed 1024 cannot tell, by arithmetic, and it also closes `height` and `zoneAt` | 2026-11-05 | T00 executor |
| The bloom check is a floor, over 20 code values against a reading of 68.98, and exact values stay unpinned | It separates bloom from no bloom on one machine, which is the named mutant. Pinning .8 by reading it would need a hook into the effect that only tests use, and parsing §6.6 would tie T00's test to values §6.6 calls starting values. Section 13 says what this does not catch | 2026-11-05 | T00 executor |
| The palette test reads §6.8 from `architecture.md`, not a copied table | A copy can drift with the fake and pass, while §6.8 is the source M6 names. The cost is that a change to §6.8 needs the same change to `PALETTE_HEX`. Section 4 has the row, and T11's retune of `palettes.ts` alone does not trigger it | 2026-11-05 | T00 executor |
| The hover test pins 6, 8 and 40, which are T00's own constants, rather than T01's bands | A band would pass 7. M6 now states the values, and they sit inside T01's bands of 3 to 10, 3 to 28 and 40 to 150 | 2026-11-05 | T00 executor |
| Defect 1 and defect 2 are not applied here, and T03 and the ledger are not edited | The verifier names the T00 owner for both, and this repair ran under "T00's owned paths only". Agents.md says a plan is writable only by its owner and executors treat the ledger as read-only. Sections 9 and 13 therefore keep them open, not closed, and section 10 holds the text. The verifier's reading stands: T00's code needs no change for them | 2026-11-05 | T00 executor |
| A11f's negative control runs the bare test in a child Playwright process and asserts the child report's status and message, instead of `test.fail()` or the verifier's `expect(...).toThrow(...)` on a helper | VI-gates found the bare `test.fail()` counted other failures, and the drills confirm it for a fixture failing at teardown, an action timeout and an extra error. A helper called with `toThrow`, or an expected-failure option inside the guard, would assert the reason, but the control would still pass with the guard's teardown check deleted or never run, which the old form caught (`bypass` and `default` drills, section 10). The child run uses the real fixture at its defaults, so it keeps that and adds the reason. `pw.ts`, which every sibling's spec imports, does not change | 2026-11-06 | T00 executor, for the T00 owner |
| A11f's acceptance text changes from "shown once by a `test.fail()` case" to the child report's status and message, plus the drills as its negative controls | The row named the mechanism VI-gates found unsound. The new text is stricter: the same failure is still required, and its reason is now pinned. No threshold or count moved | 2026-11-06 | T00 executor, for the T00 owner |
| The child config has `timeout: 30_000`, the child process is killed at 50 s, and the parent keeps the 60 s default | A hung child then ends inside the parent's own limit, and its `timedOut` status reaches the parent, which fails on it [O: test-timeout drill, 31.7 s]. The child's 30 s is about 19 times its whole run, `stats.duration` 1570 ms in the report. A slower page makes the control fail, not pass | 2026-11-06 | T00 executor |
| The child config reuses the root config's `gpu` project and `use`, has no `webServer`, and is not a `*.spec.ts` | The child then launches the same browser with the same flags as the parent. The parent run's Vite server is already up on `TERRAIN_PORT`, and with no server the child fails rather than passing. Not matching `**/*.spec.ts` keeps it out of every suite without a skipped test in their counts [O: `--list`, 51 tests, 0 lines naming it] | 2026-11-06 | T00 executor |
| Drills run on copies in `tests/support/zzdrill/`, not by mutating `pw.ts` in place | `pw.ts` is imported by every sibling's spec and T02 reads `in-progress`. A software run is not necessarily behind the GPU lock, so an in-place mutation could have broken a sibling's run during the window. The copies differ from the live files only in their relative imports and the one mutation, and the runner checks the live hashes after each run | 2026-11-06 | T00 executor |
| **PR-1: `package.json` states the licence, a description, the Pages address and the repository; `"private": true` stays** | The operator is releasing the game under MIT (T12, R-3). `private` concerns the npm registry, not the repository, and stops an accidental `npm publish` | 2026-11-12 | T00 owner, for the operator |
| **PR-2: the lockfile's root entry is edited by hand** | The only difference npm would write is `"license": "MIT"` under the root package. A hand edit of that one line keeps every resolved version and integrity hash byte-identical, which an install might not | 2026-11-12 | T00 owner, for the operator |
| **PR-3: the task-count pins in `gates.test.ts` move from 12 to 13** | They assert how many tasks `architecture.md` §12 has, and it now has 13. The assertions keep their force: the exact row list, the count printed by `plans:check`, and `0 problems` are all still required. An expected value changed, so the operator's agreement was asked for and given | 2026-11-12 | T00 owner, for the operator |

## 12. Contract change requests

**Reconciliation rule.** Every approved request is already in §8's text; this section is the record. `plans/RECONCILIATION.md` holds each decision and its reason, and §8's text is what freezes.

After T00 is `done`, a request reopens this plan (`in-progress`, revision note, one amendment). It is additive only, `contracts:check` must show the old lines still in order with the expected `added` count, `npm run check:task -- T00` must pass, and siblings then re-run their own `check:task`. Non-additive requests are rejected, except T11's numeric retune inside its stated bounds. The T00 owner updates §8, and the ledger records it.

Requests T00 itself raises, all additive. The text below is kept as a record.

**CCR-1. Record field offsets and meanings.** State: **amended**, C-01, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. Fake world, T01, T02 and T05 all index `Float32Array` records, and §5.5 and §8.1 leave `a`, `b` and the ranges unstated. `src/contracts/index.ts`, after `ITEM_STRIDE`:

```ts
/** Offsets in one PROP_STRIDE record. x lateral u; y final ground u; zLocal in [0, CHUNK_LEN); yaw radians; scale > 0; keep, tintSeed, variant in [0, 1). */
export const PropField = { X: 0, Y: 1, Z_LOCAL: 2, YAW: 3, SCALE: 4, KEEP: 5, TINT_SEED: 6, VARIANT: 7 } as const;
/** Offsets in one ITEM_STRIDE record. SHARD, GATE, SPIKE: a = b = 0. FENCE: a gap centre x, b gap half-width. DRONE: a amp, b integer k, phase 3. TRAFFIC: a travel, b integer k, phase 7. seed in [0, 1). */
export const ItemField = { KIND: 0, X: 1, Y: 2, Z_LOCAL: 3, RADIUS: 4, A: 5, B: 6, SEED: 7 } as const;
```

**CCR-2. Allocators for caller-owned records.** State: **approved**, C-02, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. Every consumer otherwise re-derives array sizes. New file `src/core/alloc.ts`, added to §3.1's core list:

```ts
export function createPropRow(): PropRow;
export function createItemRow(): ItemRow;
export function createZoneState(): ZoneState;
export function createBendState(): BendState;
export function createEventBuffer(): EventBuffer;      // EVENT_CAPACITY per array
export function createNeutralFeel(): FeelState;        // values in section 4
```

**CCR-3. One camera pose.** State: **approved**, C-03, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. §8.1 says `writeSharedUniforms` exists "so `app/` and the dev shell cannot drift apart on what step 9 writes", but step 9 also sets the camera, including the §6.4 FOV cap. `src/core/uniforms.ts` also exports:

```ts
export interface CameraPose { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; fovDeg: number }
export function cameraFov(fovDeg: number, aspect: number): number;   // min(fovDeg, 2 * atan(CAMERA_HALF_TAN_MAX / aspect) in degrees)
export function writeCameraPose(v: Readonly<FrameView>, aspect: number, out: CameraPose): void;
```

**CCR-4. Phase helper.** State: **approved**, C-04, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. §4.5 gives the formula, and app, sim collision and the fakes all need it. `src/core/motion.ts` also exports:

```ts
export function phaseOf(tick: number, alpha: number, i: number): number;   // ((tick % P[i]) + alpha) / P[i]
export function writePhases(tick: number, alpha: number, out: Float32Array): void;
```

**CCR-5. GLSL twins in the contract.** State: **amended**, C-05, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. T05 must call them. §5.8 requires the GLSL and JS to match, and a shared function makes that checkable. `src/contracts/glsl/common.glsl`, at the end:

```glsl
// Twins of src/core/motion.ts. Same expressions, so sim collision and the drawn position agree.
float trafficOffset(float travel, float k, float seed, float phase) { return travel * fract(k * phase + seed); }
float droneOffset(float amp, float k, float seed, float phase) { return amp * sin(TAU * (k * phase + seed)); }
```

**CCR-6. The `src/testing` signatures in section 4.** State: **approved**, C-06, with C-20, C-21 and C-29 merged, absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. §8.1's line on `src/testing/` omits `startDevShell`'s return type, gives `scriptedFrame` no way to request a position or override, and names no way to inspect a fake host. The additions are optional parameters and extra members, and `src/testing/devPost.ts` and `src/testing/index.ts` are new files. Existing call shapes still compile.

**Requests from the other plans.** Their text stays in each plan's section 12.

| Request | State | Entry |
|---|---|---|
| CCR-T01-1 | amended | C-07 |
| CCR-T01-2 | amended | C-01, C-08 |
| CCR-T01-3 | approved | C-10 |
| CCR-T01-4 | amended | C-12 |
| CCR-T02-1 | amended | C-13 |
| CCR-T02-2 | approved | C-14 |
| T03-CCR-1 | approved | C-18 |
| T03-CCR-2 | approved | C-19 |
| T03-CCR-3 | approved | C-20 |
| CCR-T04-1 | approved | C-21 |
| CCR-T04-2 | amended | C-12 |
| CCR-T05-1 | rejected: withdrawn by its author | C-37, replaced by C-07 |
| CCR-T05-2 | `SHIP_FORWARD` approved; traffic half withdrawn and amended | C-09; C-08 |
| CCR-T06-1 | amended | C-22 |
| CCR-T06-2 | amended | C-23 |
| CCR-T06-3 | amended | C-12 |
| CCR-T07-1 | approved | C-24 |
| CCR-T08-1 | approved | C-15 |
| CCR-T08-2 | approved | C-16 |
| CCR-T08-3 | amended | C-17, C-12 |
| CCR-T08-4 | approved | C-11 |
| CCR-T08-5 | amended | C-25 |
| CCR-T09-1 | amended | C-26 |
| CCR-T09-2 | amended | C-27 |
| CCR-T09-3 | amended | C-28, C-31 |
| CCR-T09-4 | approved | C-29 |
| CCR-T09-5 | approved | C-30 |
| CCR-T10-1 | amended | C-31, C-36 |
| CCR-T10-2 | rejected | C-32 |
| CCR-T11-1 | rejected: withdrawn by its author | C-33 |
| CCR-T11-2 | rejected: withdrawn by its author | C-34 |
| CCR-T11-3 | approved | C-35 |
| CCR-T11-4 | amended | C-36 |

## 13. Outcomes and retrospective

**VI-gates `test.fail()` repair, 2026-11-06.** A11f's negative control no longer uses `test.fail()`. It reads a child run's report and passes only when the bare test failed through the console guard, on SHADER_ERROR entries alone. On copies, a fixture failing at teardown, an action timeout and an extra console error, which the old form counted as the expected failure, now fail it, and so do the four cases the old form already failed. **Not verified by this repair:**

- The spec under `software`, where the control skips in its body before any child run. Only `gpu` was run, as asked. `test:foundation` and `test:browser`, which include `tests/support`, are the T00 owner's next runs.
- `npm run check`, `test:browser` and `test:software`, left to the T00 owner by instruction.
- The control's header match reads the text of `pw.ts`'s error, `N console errors:`, and the JSON report's `error.message`, which is Playwright 1.64.1's format. A change to either fails the control loudly. Neither is pinned by another test.
- A child run that cannot start fails the control at the report check, and a child killed at 50 s may leave its browser running on Windows [I: not run].
- The drills ran on copies, not on the live files, by design. The copies differ only in their relative imports and the one mutation, which the runner applies with an exactly-once anchor check.

**Added by the T00 owner, per DI-57, not verified by T00's suite:** a verifier's sampled mutants that still exit 0: `applyCamera` position and roll; rebuild order on a jump; `warpSerial` in the view; `setLayerVisible` ignoring its name; `antialias: true`; `ToneMappingMode.REINHARD`; `composer.setSize` dropped; `dprCap` dropped; `sync` without `% 16`; `musicKey` modulo; the prop x bands; `fakeHost`'s beat. Correct code behaved correctly on each path the verifier probed, apart from tone mapping and the beat, which were read only. "Survived" means against the one suite that mutant ran.

**Result against Purpose.** All six outcomes hold, each from a run in this session, on this machine, on the RTX 4070 SUPER and SwiftShader.

1. `npm ci` reproduces the pins with the lockfile unchanged, and `npm audit --omit=dev` reports 0 vulnerabilities. `npm audit` reports the 9 moderate `minimatch` advisories A2 predicts, with no fix run.
2. `contracts:check` shows the seven files equal to §8 and §11.1, `added` 0. `contracts.test.ts` proves the gate fails a deletion, a reorder, a changed type and a changed `CHUNK_LEN`.
3. A forbidden import fails lint (206 table cases), a banned GLSL token fails the grep gate, an overlapping plan fails `plans:check`, a broken sibling does not fail `check:task` and a broken owned file does. Each was seen failing. The first version of this outcome was false for a banned token in a sibling's file, which failed T00, and the verifier found it. It now holds for T00, except for `hero.glsl` (section 10).
4. The 1080p picture through `startDevShell` shows the gradient sky, banded sun and magenta grid from contract GLSL only. It was opened and described in section 9.
5. All four Playwright projects launch, and each asserts its rasterizer. `rasterizer.test.ts` shows the check rejecting the wrong string on each.
6. A production bundle runs from `/some/nested/path/` with relative URLs, at 148.09 KB gzip.

**Gaps.** None against the acceptance list. No contract change was needed, and section 12 gains no row. Open for the T00 owner: a banned token in `src/contracts/glsl/hero.glsl`, a legal T00 and T04 overlap, still fails `check:task T00` (section 10). Also open for the T00 owner: the literal import in `plans/T03-terrain.md:289`, its ledger entry, and T03's M0 proof at line 186, which T00 does not own and no T00 repair has applied (section 10). The third verifier rates the first as blocking for its verdict. The boundary gate's remaining blind spots are listed in section 10 too.

**Not verified.**

- HC1: the Linux and macOS paths in `tests/support/browser.ts`, and anything on a GPU other than the RTX and SwiftShader. No such device is here. Open for T11's pack.
- `npm run build` on the real entry: it fails by design until T10. `npm run preview` and `npm run dev` as named commands were not run; `npx vite` was, through Playwright's `webServer` and once by hand on port 5192.
- Temporal quality. No frame sequence was viewed and no shimmer metric run on the proof floor. The determinism test shows repeats are stable, and that is a different question. T03 and T11 own this for real terrain.
- Whether DevPost's look predicts T06's. DevPost has no CA, Crt or vignette, and it is not specified to honour `bloomGain`.
- The post-on flake in section 10 did not appear in the A11d runs here, 0 differing bytes each time. That says nothing about its cause, which stays open. The shell tolerance stays.
- Whether `createFakeWorld`'s look is good enough for T05: only its records are tested here, and no prop has been drawn on it.
- Whether the two gates with fixtures behave the same on real sibling plans under parallel runs. `check:task` ran on T00 for real, and on T01 and T11 only to see `VACUOUS` with no files.
- Parallel use of ports and caches was exercised only serially: 5100, 5191 and 5192 in turn, each with its own `node_modules/.vite/p<port>`.
- Whether the amended lint rules reject anything a sibling really writes. A grep over `plans/` found no conflict, and the rules have only run on T00's code and on virtual paths, since no sibling code exists yet.
- Whether Vite would resolve each non-canonical spelling. No build went through them. `ts.resolveModuleName` on `tsconfig.json`, asked from `src/testing/` with `src/core/coords.ts` as the target, resolved all of `./../core/coords`, `../testing/../core/coords`, `../../src/testing/../core/coords`, `.././core/coords`, `..//core/coords`, `..\core\coords`, `../../../terrain/src/core/coords` and `../Core/coords`, which is why each is banned. The backslash and wrong-case forms resolve on this machine, and a Linux host is untested.
- `pass.dithering`, `freezeEffectTime` and precompile's `setRenderTarget(composer.inputBuffer)` in `devPost.ts`. Removing or disabling each one still passes the whole of `devshell.spec.ts` [O: exit 0, 17 passed], so T00's suite cannot see them break. The verifier found no pixel-level signal in DevPost for dithering or `timeScale`, and I did not search further. The verifier infers the precompile mutant is near-equivalent because `devPost.ts:98` renders straight afterwards; neither of us measured that, and Agents.md gives the reason the line exists.
- T03's real `dev/terrain.html`. T00 does not own `dev/`, so the variable-specifier form ran on a throwaway page under `tests/support/devshell/` with the same line. Here, that Vite treats the two folders alike is still inferred. The third verifier reports running throwaway pages in the real `dev/` with no `src/world` on disk, with the literal form failing and the variable form reaching `ready`, which would close it. I did not repeat that run, since `dev/` is not T00's path. A target under `src/world/` was not loaded here, since that is T01's path: a target under `src/testing/` was, and the verifier reports a temporary `src/world/index.ts` returning 200.
- Exact bloom settings in `devPost.ts`. A11i's floor catches `intensity: 0` [O], and a bloom adding over 20 code values passes, so a smaller intensity or a changed threshold, smoothing or radius may not fail it [I: not run at those values]. T06 owns the real stack.
- `manual` in the rAF loop's guard. Removing it passes A11i [O: exit 0], and I read it as redundant with the cancel in `setManual`, not as a gap. That is from reading the code, on the paths A11i exercises.
- A11i's mutants ran against A11i alone, not the whole spec, so they show that A11i fails each one, not which other test might too.
- Load beyond CPU. The load runs used CPU spinners only, at 12 and 24 of 24 logical CPUs. Disk, memory and GPU contention from real siblings were not exercised, and neither was `npm run check` as a whole under load: `check:task -- T00`, `npx vitest run` and `test:foundation` were. Nine siblings compiling at once may look different.
- The cause of the verifier's one unattributed `exit=1` (section 10).

**Lessons.**

- A negative control can pass, and that is its point: DI-46's first control passed, and that is how the real condition was found.
- A test that failed once in a resize path led to a sturdier shell. Retrying it would have left the path as it was for T03 and T04.
- A numeric limit that fails on a first try deserves a look at the inputs before the limit, and the look belongs in the record either way (section 11, A13).
- Three mutations survived a suite whose negative controls all worked. A control shows that one named failure can be seen, and says nothing about a failure nobody named. Mutating the code under test found those.
- A gate that runs inside a scoped gate inherits the scope. Asserting whole-repo state in a test that `check:task` runs broke the isolation the same command exists to give.
- A green run says nothing about margin. A test at 94% of its limit passed my earlier gates, and it took an independent run to show that a required gate depended on the machine.
- A probe can test the wrong thing and still produce a clean-looking number. My first check of the literal-import 500 read the document's status, which is 200, and it was the failed expectation that sent me to the browser view.
- A difference needs a control for what else differs. My first bloom band read a healthy number while sitting partly on the quad that was changing, and only a profile with post off showed it. Asserting that delta to be 0 keeps the band honest if the layer ever moves.

### Amendment PR

`package.json` and the lockfile's root entry now state the MIT licence, and the index lists T12. Nothing T00 provides to other tasks changed. Not verified here: `npm ci` on a fresh clone against the edited lockfile (T12's A7), and what `npm install` would write if it were run.

## 14. Revision notes

- 2026-11-05T05:55Z Initial draft. No approved revisions, no absorbed requests.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: L-01, C-01 to C-07, C-14, C-20, C-21, C-23, C-29, C-30, C-35, S-01, S-04, S-07, S-40, S-42, S-55, S-57, S-61, DI-25, DI-26, DI-37.
- 2026-11-05T08:43Z Independent review. Added the section 7 Human checks list the template asks for, from what section 13 already names as not verifiable here.
- 2026-11-05T10:15Z Applied DI-46 from the full-text reviews, decided by the T00 owner in plans/RECONCILIATION.md.
- 2026-11-05T10:47Z Executed. M7 amended on two small points, with Decision log entries: the rAF time origin, and resize applied by comparing sizes. Sections 9, 10, 11 and 13 written. Status `done`.
- 2026-11-05T11:39Z Reopened for six defects from an independent verifier, before any sibling started. M4's module regex and selectors amended; `gates.test.ts`, `buildproof.spec.ts`, `uniforms.test.ts`, `devshell.spec.ts`, `boundaries.test.ts`, `devPost.ts`, `index.ts` and `eslint.config.js` changed; `tests/unit/core/devPost.test.ts` added. No contract changed, and section 12 gains no row. A5, A9b, A11 and A14b state the new behaviour. **Siblings:** the boundary gate is stricter for every plan, so a task that has already linted should run `check:task` again; none has started yet. Status back to `done`.
- 2026-11-05T13:05Z Reopened for three defects from a second independent verifier, before any sibling started. `vitest.config.ts` gains `testTimeout: 30_000`, an acceptance change logged in section 11. `fakeWorld.test.ts` aggregates one test's expects, with the same chunks, fields and bounds. `devshell.spec.ts` gains A11h, `trivialLayer.ts` gains `?alpha=1` and a `setDebugMode` log, `smoke.html` gains `?markworld=1`, `uniforms.test.ts` gains the `2^40 + 127` case. No production or contract code changed. Section 4's 'Dev page' row states the dynamic-import rule. Section 5's M1 and M7 and section 7's A5 are updated, and A9c and A11h are new rows. `plans/T03-terrain.md:289` and the ledger were left to the T00 owner, with the text in section 10. **Siblings:** `createTrivialLayer` keeps its export and its default output, and a grep over the other plans found no use of `__layerLog`, `?alpha` or `?markworld`. Status back to `done`.
- 2026-11-05T14:05Z Reopened for three defects from a third independent verifier, before any sibling started. Defect 3 applied as a Deviations-level amendment: `devshell.spec.ts` gains A11i, `fakeWorld.test.ts` gains the 126-value, hover and period tests, `trivialLayer.ts` gains `?hot=1`, `window.__frames` and `window.__lastView`, `smoke.html` gains `?otier`. No production or contract code changed. Section 4 gains a T11 palette row, M6 states the hover values, M7 states the new flags, A5 is extended and A11i is a new row. Defects 1 and 2 are left to the T00 owner with the text in section 10, since they edit `plans/T03-terrain.md` and `plans/RECONCILIATION.md`, and they stay listed as open. **Siblings:** `createTrivialLayer` keeps its export and default pixels, and a grep over the other plans found no use of `__frames`, `__lastView`, `?hot` or `?otier`. Status back to `done`.
- 2026-11-06T12:18Z Reopened for VI-gates' low finding on the bare `test.fail()` control (A11f), acting for the T00 owner. `devshell.spec.ts`'s control now runs `tests/support/devshell/consoleguard.control.ts` through `consoleguard.config.ts`, both new and both under `tests/support/**`, and asserts the child report. Section 3 lists the two files, section 7's A11f row states the new acceptance and its drills, and sections 9, 10, 11 and 13 record the work. `pw.ts`, every contract and every config at the root are unchanged, and `owns` is unchanged. **Siblings:** nothing they import changed. Status back to `done`.
- 2026-11-12T18:04Z **Amendment PR** (public release, for T12): `plans/README.md` gains the T12 row and order line; `package.json` gains `description`, `license`, `homepage` and `repository`; `package-lock.json`'s root entry gains `"license": "MIT"`. Progress, Decision log (PR-1, PR-2) and Outcomes updated. `owns` and `reads` unchanged. Status stays `done`. Not committed.
- 2026-11-12T18:14Z **Amendment PR extended:** `tests/boundaries/gates.test.ts` pins 13 tasks instead of 12 (PR-3), four lines, with the operator's agreement. Status stays `done`. Not committed.
