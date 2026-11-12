# Agents.md

Midnight Vector is a static website and endless 80s synthwave arcade game, built with TypeScript, three.js, custom GLSL and pmndrs post-processing, with no asset files.
The camera never stops moving forward, and no absolute world coordinate ever reaches a GLSL float.

Design lives in [architecture.md](architecture.md) and is not repeated here. This file covers how to work on the project. `§n` means section n of that file, and every subsection heading starts with its number. Read §1, §3, §8 and your row in §12 before your first change.

Jump to: [§1 Overview](architecture.md#1-overview) | [§2 Stack](architecture.md#2-tech-stack) | [§3 System](architecture.md#3-system-design) | [§4 Precision](architecture.md#4-coordinates-and-precision) | [§5 World](architecture.md#5-world-generation) | [§6 Rendering](architecture.md#6-rendering-design) | [§7 Game](architecture.md#7-game-design) | [§8 Contracts](architecture.md#8-frozen-contracts) | [§9 Budgets](architecture.md#9-performance-budgets) | [§10 Robustness](architecture.md#10-robustness) | [§11 Tests](architecture.md#11-test-strategy) | [§12 Tasks](architecture.md#12-task-decomposition) | [§13 Decisions](architecture.md#13-decision-log) | [§14 Risks](architecture.md#14-open-risks)

**Evidence tags.** `[O]` observed: run on this machine, or read in the installed source of the pinned version. `[W]` from a web source linked at the end. `[I]` inferred, not tested. `[M]` from memory, not checked. As of 2026-11-04 no project code exists, so no `[O]` has run against it. GPU results come from throwaway probes on one RTX 4070 SUPER plus SwiftShader, and no mobile GPU has been tested.

## Start here

### Commands

Run from `Midnight_Vector/` (named `terrain/` until 2026-11-11; finished plans keep the old path as a record). Vitest 5 no longer searches parent folders for its config [W] [vitest-mig].

```powershell
npm ci                 # install exactly what the lockfile says
npm run dev            # Vite dev server; it blocks, so run it in the background
npm run build          # static site in dist/
npm run preview        # serve dist/ locally
npm run typecheck      # tsc --noEmit on both tsconfigs
npm run lint           # ESLint, including the module boundary rules
npm test               # vitest run
npm run check          # typecheck + lint + test + GLSL grep gate; whole repo, run when no task is mid-flight
npm run check:task -- T03   # the same gates scoped to one task's owns list; use this while siblings run in parallel
npm run plans:check    # fails if any path matches the owns list of two plans; run before spawning executors
npm run test:smoke     # tests/e2e on the gpu project, armed at T10
npm run test:browser   # all module visual specs and e2e
npm run test:software  # the same specs on SwiftShader: tier-0 and software-only rows (DI-90)
npm run test:forever   # warp, identity, cracks, soak, context loss; also test:perf and test:art

npx vitest run tests/unit/world/noise.test.ts -t "non-flat"                  # one unit test
npx playwright test tests/visual/terrain.spec.ts --project=gpu -g "horizon"  # one browser test
```

§11.2 names `check` and the `test:*` suites. The other script names are set here, and T00 must define all of them. Nothing runs until T00 lands. The flags were checked against the installed CLIs [O]; the test file names are examples. Use `vitest run`, because bare `vitest` can sit in watch mode [M].

Some scripts cannot pass at T00, by design. `build` and `preview` need T10's `index.html`, and `test:smoke`, `test:forever`, `test:perf` and `test:art` exit 1 until their owners add tests [O: T00 rehearsal]. T00 proves a production build with its own `npm run build:proof`. None of this is a false alarm.

### Source of truth, highest first

1. The operator's instruction in the current session.
2. `architecture.md` for design, and `src/contracts/**` once T00 ships it. A difference between (§8) and the contract files is a bug: stop and report it, do not pick one.
3. Installed source in `node_modules/` for what a library actually does. It beats this file, blog posts and memory. If it contradicts `architecture.md`, record that as a finding rather than quietly working around it.
4. This file, for how to work.
5. Your plan, for scope and steps inside the paths you own.
6. Web tips and memory. See [Stale advice](#stale-advice).

### Never

- Edit a path your task does not own (§12), or write code before your plan exists and is approved. T11's pin rule in §12 is the one exception.
- Install or upgrade packages outside T00. `three` stays below 0.188 and `typescript` below 6.1 because of peer ranges, and runtime dependencies are exactly two (§2).
- Run `npm audit fix --force`. It downgrades eslint to 9.39.5, and the advisory is dev-only [O].
- Run `npx playwright install` as a side effect. Tests discover the cached browser (§11.1).

### Windows

- PowerShell 5.1 has no `&&`. Use `A; if ($?) { B }`. Set env vars with `$env:TERRAIN_PORT = '5103'; npm run dev`.
- In the Bash tool, write forward slashes; the workspace notes say backslashes in `C:\...` get mangled.
- Paths resolve case-insensitively here: with only `Agents.md` on disk, `Test-Path AGENTS.md` returned True [O]. A wrong-case import can pass here and fail on a Linux host [I], so match case exactly.

### Loading this file

- **Claude Code may not load it.** Its docs say `AGENTS.md` is read only when no `CLAUDE.md` exists in the working folder or above, and `C:\highsierralabs\CLAUDE.md` does exist [W] [cc-memory], not run. The documented fix is a one-line `Midnight_Vector/CLAUDE.md` containing `@Agents.md`. That file does not exist and §12 gives it no owner, so until the operator adds it, read this file explicitly at session start. Check with `/context all`.
- **Casing.** The operator named this file `Agents.md`, while tools look for `AGENTS.md`. A path lookup finds it on this filesystem [O]. Exact-name matchers and case-sensitive checkouts may not [I]. Do not add a second copy: here both names are the same file [O].

## TypeScript 6

- **Keep `"types": ["vite/client"]` in §8.3.** Without it `?raw` gives TS2307, `import './x.css'` gives TS2882, and `import.meta.env` gives TS2339 [O]. `moduleResolution: "node"` gives TS5107 [O].
- **Vite strips types without checking them** [W] [vite-features]. A working dev server proves nothing, so run `npm run typecheck`.
- **`noUncheckedIndexedAccess` applies to typed arrays.** `float32[i]` and an `as const` array indexed by a variable are `number | undefined`, TS2322 on assignment [O]. Write `a[i]!` in hot paths: it is erased at compile time, while `?? 0` adds a branch and hides out-of-range bugs [I]. T00's ESLint config must allow it.
- **Use `as const` objects, not `enum`,** and `import { CHUNK_LEN, type Travel }`, following (§8.1). `verbatimModuleSyntax` and `isolatedModules` are on.
- **Never route around a contract** with `any`, a cast or a sibling import. File a change request (see [Plan files](#plan-files)). The one sanctioned cast is `timeScale` under [postprocessing](#pmndrs-postprocessing-6396).
- **`Readonly<T>` is shallow and compile-time only.** `FrameView.phases` is still writable, and a layer must not retain `FrameView` between frames (§8.1).

## Vite 8

- **Shaders use `?raw`.** It is typed by `vite/client` and works in both build and Vitest [O]. It has no includes, so shared code goes through `contracts/glsl.ts` (§6.2). Do not add `vite-plugin-glsl`.
- **Keep `base: './'` and test from a nested path.** A build ran correctly from `/some/nested/path/` [O]. A root-only test would not catch an absolute URL [I].
- **Old config snippets are stale.** Use `rolldownOptions` rather than `rollupOptions`, and `oxc` rather than `esbuild`. The old names remain in the installed types only as `@deprecated` aliases [O]. Object-form `manualChunks` is gone [W] [vite-mig].
- **The 500 kB chunk warning is expected.** three plus these effects is 604 kB, 148 kB gzipped [O]. Do not chase it; the budget that counts is the gzip limit in §9.3.
- `dev/*.html` pages are dev-server only. A build uses `index.html` alone unless told otherwise [M], so never add them to the build input.

## three.js 0.187 and WebGL2

**Programs**

- **`compileAsync` must run with the composer's target bound.** A program's cache key includes the output colour space, which differs between canvas and render target [O]. In a probe, plain `compileAsync` built 1 program and the first composer render then compiled another. With the target bound, that render compiled 0 [O]. §6.6 calls for `compileAsync` but does not state this.
  ```ts
  renderer.setRenderTarget(composer.inputBuffer);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  ```
- **Add every mesh before precompiling.** `compile` walks `scene.traverse`, so `visible = false` rings are included (0 new programs at render [O]). A mesh added later is not.
- **Do not flip program-key flags at runtime.** Changing `transparent` recompiles mid-game (§6.4). A first composite took 67 ms against 0.8 ms afterwards at 64x64 [O], which shows a stall exists, not its size elsewhere.
- **`debug.onShaderError` replaces three's `console.error`** [O]. Once it is set, a test that listens for console errors cannot see a shader failure, so the handler must signal both the fatal page and the test hook. It fires only on a failed link and only while `checkShaderErrors` is on, so leave that on.
- **Never `clone()` a material that shares uniforms.** Clone deep-copies and silently breaks the link [O]. Spread the shared `{value}` objects by reference (§6.2).

**Buffers and uploads**

- **`addUpdateRange` counts components, not texels or instances** [O]. For the RGBA atlas, row `r` is `addUpdateRange(r * width * 4, width * 4)`. Each call allocates an object [O], which is fine at chunk rate but not per instance per frame.
- **One texture range per row.** The partial upload hard-codes height 1 [O: `WebGLTextures.js`], so a range spanning rows does not upload as a block.
- **Clear before a full upload.** A non-empty `updateRanges` suppresses the full upload, so call `clearUpdateRanges()` before `needsUpdate` on a warp or restore (§10.2).
- **Capacity is fixed.** Resizing an attribute throws [O]. Vary `instanceCount` or `setDrawRange` instead. Pool everything: three frees nothing automatically, and a material's dispose leaves its textures [W] [dispose]. `composer.dispose()` covers passes and buffers [O].

**Stats, state and colour**

- **Set `renderer.info.autoReset = false` and call `info.reset()` once per frame.** Otherwise calls read 1 instead of 18 under the composer [O]. `info.memory` holds only geometries and textures [O], so leak tests also audit the scene: object count, attribute bytes and pending update ranges (§9.3). The design has no growable JS pool to assert on.
- **Keep `frustumCulled = false` on every scene mesh.** The bend is false geometry, and vertex displacement is not in the bounds (§6.1).
- **`alpha: false` does not make the canvas opaque.** Context alpha is hard-coded true, and a material writing a = 0.25 reached the canvas as 64 [O]. The final effect writes alpha 1 (§6.6).
- **Colour:** `Color` setters convert sRGB to linear, while uniforms and GLSL literals are already linear [O]. Data textures such as the atlas stay `NoColorSpace` [O]. The last `EffectPass` encodes the output [O].
- **Call `renderer.setPixelRatio` and `composer.setSize` together.** Canvas and composer desync otherwise [O]. Resizing reallocates targets, so it happens only in rAF before drawing, or on a tier change (§6.10).

**Hot paths**

- In any per-frame path, do not use `new`, `clone()`, closures, array spread, `.map`, `.slice()`, `.subarray()` or template strings. `subarray` allocates a view [M]. Keep scratch objects at module scope.
- `composer.setSize` and `addPass` allocate [O], so they belong to tier changes. Pass `dt` to `composer.render(dt)` so its internal timer is skipped [O].
- Whether three's own `render()` is allocation-free has not been measured on the real build (§14). **Heap slope cannot see short-lived allocation:** it read 0 for a 15.5 KB/frame allocator [O: T09 rehearsal]. Gate allocation with the sampling profiler by URL class plus `usedJSHeapSize` windows, and keep slope for leaks (§9.2).
- **A double returned through a non-inlined call can be boxed:** 12 B per return in Chromium [O: T09 rehearsal]. In per-sample code such as `height`, avoid double-returning inner calls (§9.2).

## Custom GLSL

- **Use `ShaderMaterial` with `glslVersion` unset.** It always compiles as `#version 300 es`, and `uint`, `texelFetch` and `fwidth` work [O]. Setting `GLSL3` removes the `gl_FragColor` define, and `<colorspace_fragment>` then fails with an undeclared identifier [O]. `RawShaderMaterial` without a version compiles as ESSL 1.00, so `in` and `out` error [O].
- **`#include <name>` resolves only against three's `ShaderChunk`** [O]. Project code gets `COMMON_VERT` or `COMMON_FRAG` prepended by string (§8.2).
- **Draw grid lines only with `pristineLines` or `pristineGrid`** (§8.2), from [golus]. Take derivatives before `fract`. Under the horizon, taking them after raised row noise fivefold, and a plain `fract/fwidth` idiom whitened the row to 0.9954 mean (§6.4).
- **Avoid undefined builtins, even when they work here.** `smoothstep` with reversed or equal edges and `clamp` with its minimum above its maximum are undefined in GLSL [M]. Replacing `clamp(lw, deriv, .5)` with `min(max(lw, deriv), .5)` changed no output on the RTX or SwiftShader [O], so a pass on these two proves nothing about other drivers. Write `1. - smoothstep(a, b, x)` with `a < b`.
- **Keep coordinates small.** Adding an integer offset to a grid uv in float32 gave a mean error of 0.02/255 at 2^10, 14.75/255 at 2^20 and 220/255 at 2^24 [O]. Add a wrapped uniform in the shader, per the rule in §4.3, so derivatives stay continuous.
- **Banned by the grep gate:** `uTime`, `cameraPosition.z`, `modelMatrix` (§4.5). Apply `bendV` to the render-space position, then `projectionMatrix * viewMatrix`.
- **Animate only with integer harmonics:** `fract(phaseAt(i) * k + seed)` with integer `k`, or the wrap pops (§4.5).
- **All emission goes through `emit(colour, L)`** with `L` from §6.7. Equal multipliers would bloom only the cyan.
- **Use `highp` for coordinates and derivatives, and `highp sampler2D` for the atlas.** This desktop reports 23 bits for mediump, so mediump bugs are invisible here; SwiftShader reports 10 bits, though whether it enforces them is unverified [O]. Ints crossing stages must be highp on Android, and iOS needs `highp sampler2D` for float textures [W] [mdn-webgl]. Use mediump only on colour math, after profiling on a real device.
- **No early exit (`return`, `discard`) under a non-uniform condition above derivative-dependent code,** even with the derivatives written first. On D3D11 an `if (r < .93) return` above the star maths drew hollow outlines around lit cells, and moving `dFdx` above the `if` did not help; removing the branch did [O: T04 rehearsal]. A selection that rejoins was not a hazard: ANGLE lowers `?:` to the same HLSL `if`/`else` as an `if`, and a high-frequency rejoining branch above `pristineLines` changed no value on the RTX, where an early `return` changed up to 19,665 pixels. SwiftShader showed neither, so a software-only test cannot catch this [O: one RTX and SwiftShader, throwaway; other GPUs unknown].
- **Translator warnings reach `console.warn`, not `console.error`,** so a clean-console test does not see them. Multi-return functions gave `X4000 use of potentially uninitialized variable`, and a single-assignment form removed it [O: T04 rehearsal]. The frozen `phaseAt` logs a dynamic-indexing warning on D3D11 [O], so do not fail a test on every warning.
- **Mind `%`.** JS keeps the dividend's sign, so use `rowMod` and `travelMod` from `core/coords.ts`. GLSL int `%` is undefined for negative operands [M], so keep operands non-negative.

## pmndrs postprocessing 6.39.6

- **`timeScale` works but is untyped.** `pass.timeScale = 0` fails tsc with TS2339, and `minTime` and `maxTime` are typed but never read [O]. §4.5 requires the freeze, so keep this cast in one helper in `render/fx`. It compiled, and time held at 0 over 50 renders [O].
  ```ts
  (pass as unknown as { timeScale: number }).timeScale = 0;
  ```
- **A merged pass can hold only one convolution effect.** SMAA with chromatic aberration (CA) throws, and so do Glitch, LensDistortion, Pixelation and ShockWave with CA, because they transform UVs [O]. The throw comes at `addPass`, not the constructor, so a test that only constructs proves nothing [O].
- **The UV-transform check is a text match.** It runs `/mainUv/` on the effect's fragment source [O]. The custom Crt must define only `mainImage` and must not contain that string, even in a comment. The hit glitch (§7.4) therefore has to be colour-only, or it cannot share a pass with CA [I].
- **Argument order is not effect order.** The list sorts by attributes, so convolution runs first; the rest keep insertion order [O]. Pass them in the §6.6 order, with Crt and Vignette after tone mapping.
- **Bloom's threshold tests luminance.** Keep non-emissive surfaces below it (§6.7). Changing `levels` recreates targets, so do it only on a tier change [O]. It also disposes both blur materials, so three links them again: 12 links over a tier cycle, while `renderer.info.programs.length` stays constant [O: T06 probe]. Keep one extra `MipmapBlurPass` alive and render it in every `precompile` (§6.6), and detect compiles with a spy on `gl.linkProgram`. Do not change the SCREEN blend to ADD, which adds light [I].
- **Tone map with the effect, not the renderer.** Under the composer, `renderer.toneMapping` is silently ignored: 188 with or without ACES, 197 direct to canvas [O]. Set the mode explicitly (§6.6), because the default is AGX [O].
- **Do not use effect-level switches to save GPU.** `DST` recompiles and draws stay at 18; `opacity = 0` also keeps 18 draws; `enabled = false` on the last pass leaves the canvas empty [O]. Use the prebuilt variant swap in §6.6, and render each variant once at boot.
- **Set `dithering = true` on the final pass.** It runs after output encoding and adds a static per-pixel offset of up to +/-0.5 LSB, from `mix(2s, -2s, rand(gl_FragCoord.xy))` with `s = .25/255` [O]. If the dark sky still bands in a screenshot, write a triangular-PDF effect at 2 LSB, per [gjol], with the seed bounded.

## Infinite world and precision

- **Positions are `{chunk, local}`** (§4.1). Subtract only with `between`. `totalDistance` is for the HUD alone.
- **Never apply `|0`, `~~`, `>>`, `<<` or `>>>` to a chunk, row or distance.** They wrap to 32 bits, which is exactly how `simplex-noise` goes silently flat [O]. Hash high and low words as in §4.4.
- **Never put an absolute coordinate in a `Float32Array`, attribute or uniform.** float32 ulp is 64 u at 1e9 (§4.2). A CPU `modelViewMatrix` check can look exact (z = -5.25) while `modelMatrix` as float32 is off by 5.25 [O], so a CPU check does not prove the GPU is safe.
- **Every world-anchored pattern has a period dividing 4096** (§4.3). **No accumulators:** no `t += dt` feeding a shader; phases derive from the tick (§4.5).
- **R1 is structural.** No mode, menu or error path may skip `sim.step` (§3.3). Reduced motion slows travel and never stops it (§10.3).
- **`world`, `sim` and `feel` are pure.** No `Math.random`, `Date.now` or result-changing cache. Output goes into caller-owned `out` objects, and golden hashes are per engine (§5.1).
- **A warp to 1e9 is not enough.** A low-octave noise bug appears only near 5e10, so test 1e9, 1e12 and 1e15 (§4.4). At 100 u/s, 1e9 u takes 115.7 days [O], so only warp tests get there. Warp refuses `chunk >= CHUNK_LIMIT`, just under 2^48 (§4.2).
- **Already rejected, with reasons in §13:** skirts, chunk meshes, floating-origin rebase, `simplex-noise`, per-vertex atlas planting (§5.7). Reopening one takes a plan amendment.

## Web Workers: not used

World generation runs on the main thread (§2). `height` is pure, so moving it later stays possible. There is no `WebWorker` in the tsconfig `lib` (§8.3).

If a later plan brings workers back, write exactly `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`, because a standalone `new URL` became a silent `data:` asset [O]. Transfer `buf.buffer`, not the typed array; the sender's view drops to `byteLength` 0 [O].

## Web Audio

- **Create or resume the `AudioContext` inside a gesture handler** [W] [mdn-audio]. A context made earlier starts `suspended` [O]. Launch on `pointerup`, `click` or a filtered `keydown`: touch `pointerdown` does not activate, a touch drag never fires `click`, and Escape does not activate [O: T08 rehearsal, Chromium 1234]. iOS Safari is untested. iOS can also report `interrupted` [M]; retry on the next gesture (§10.5).
- **Schedule with the lookahead pattern in §7.6**, passing times to `start(t)` and `set*ValueAtTime` [W] [clocks]. Never drive it from rAF.
- **On hide,** suspend, stop the timer and reset `nextNoteTime` on return, so no burst plays (§10.4). Chrome throttles hidden-tab timers, per a 2020 post not rechecked [W] [chrome-timers].
- **Source nodes are one-shot.** A second `start()` throws `InvalidStateError` [O]. Make a new source per note and reuse the `AudioBuffer` [W] [mdn-abs]. Disconnect per-voice chains on `onended` and cap polyphony [M].
- **Use `AudioParam` methods, not `.value`,** for anything timed [W] [mdn-audio]. `cancelScheduledValues` clears only the future, so it cannot prune history and would delete pending automation [O: T07 prototype]. Chromium showed no cost from 1e5 past events [O]; other browsers were not tested. Avoid per-event automation on long-lived params where that is easy.

## Vitest 5

- **Pure logic only.** The default environment is `node`, so `Worker`, `document` and rAF are undefined, while `performance`, three's math and `?raw` work [O]. Do not add jsdom or happy-dom; DOM behaviour belongs in Playwright (§2).
- **Vitest 5 changes:** Node 22.12 or later, and `clearMocks` on by default [O: `engines`, config defaults], plus changed `-t` matching [W] [vitest-mig]. `-t` takes a regexp over the full test name [O: `--help`].
- **Every new gate needs a negative control.** The crack detector counts because a hole enlarged by 4 cells fails it with 10.4M pixels (§11.3). A test that cannot fail is not evidence, so show it failing before it passes.

## Playwright 1.64 for WebGL

- **Import from `playwright/test`.** `@playwright/test` is not needed [O].
- **Find the browser with `findChromium`** (§11.1). Playwright 1.64.1 wants chromium 1248, and 1234 is what is cached [O]. Assert WebGL2 and the renderer string in the test, so a run cannot pass on the wrong rasterizer.
- **To test the fallback, use `--disable-3d-apis`.** `--disable-gpu` falls back to SwiftShader instead [O].
- **Deterministic frames come from `harness.renderAt`** (§11.5). For DOM animation, call `page.clock.install({ time: 0 })` first, then `pauseAt` and `runFor`. That froze rAF, then ran exactly 10 frames at 16 ms ticks [O]. `animations: 'disabled'` does not cover rAF [O]. Keep reference images per machine [W] [pw-snap].
- **Never measure frame time with `page.clock` or rAF deltas.** rAF delta read 0.1 ms under a 10 ms load. Use the `readPixels` sync in a tight loop (§11.4). Headless rAF also ran at about 125 to 130 Hz on an empty canvas [O], so it is no stand-in for a 60 Hz display.
- **Autoplay tests pass wrongly by default.** `page.evaluate` runs with `userGesture: true`, so a new context inside it is `running` [O]. `locator.waitFor`, `waitForSelector`, `locator.isVisible` and `waitForFunction` also grant activation, while `addInitScript`, `page.on('console')` and `page.waitForEvent('console')` do not [O: T10 rehearsal]. So before a gesture, wait only on a console signal such as `MV_READY`, and gesture with `page.mouse`, `page.keyboard` or touch input, never `locator.click`. Record construction through `addInitScript` and assert before the first real gesture (§11.5). In Chromium, `AudioBufferSourceNode.prototype` has its own `start()`, so a recorder that wraps only `AudioScheduledSourceNode.prototype.start` misses every buffer source; wrap both [O: T07 repair].
- **`recordVideo` does not run here.** It wants `ffmpeg-1013`, and only `ffmpeg-1011` is cached [O: T10 rehearsal]. Use CDP `Page.startScreencast`, which needs no install and keeps the GL canvas [O].
- **A real hidden tab is not reachable,** and `devicePixelContentBoxSize` reports CSS pixels under `deviceScaleFactor`, so take the ratio from `window.devicePixelRatio` [O: T10 rehearsal]. See §10.4 and §10.5.
- **Read the false-result traps in §11.3 before writing a harness test:** `autoClear`, stale `updateRanges`, same-task pixel reads, and restoring inside the loss event.
- **Use one context per page.** Otherwise `Too many active WebGL contexts` evicts the oldest [O].
- **Compare same-state frames at MSAA 0 on the `gpu` project.** Through D3D11, blended draws at MSAA 2 or 4 differ between identical renders by up to 173 B, while Vulkan and MSAA 0 read 0 [O: T05]. A remaining 1-level flip at up to 41 bytes is bounded by DI-58: at most 64 bytes, none over 1 level; `software` stays exact. `--use-angle=gl` gives no context headless here; `--use-angle=vulkan` works [O].

## Browser robustness

The required behaviour is in §10. These are the parts that are easy to get wrong.

- **Do not cache `renderer.info`, `capabilities`, `extensions` or `properties`.** All are new objects after a restore [O]. Re-fetch any extension you acquired yourself [I]; the spec says enabled extensions are not restored [W] [webgl-spec].
- **Never use `attr.onUpload(free)`.** Rendering throws after a restore [O]. Rebuild from pure state.
- **Render-target contents are lost on restore:** red became 0,0,0,0 with a positive control [O]. Re-bake anything you rendered once.
- **Never recreate the renderer as recovery** (§10.2). Do not assume restore arrives; the fatal page covers that.
- **Wrap `new WebGLRenderer` in try/catch,** because three throws when context creation fails [O]. Wrap every `localStorage` access too (§7.1).

## Stale advice

Tips you will find online or remember, and what is true at the pinned versions.

| Advice | Reality here |
|---|---|
| `glslVersion: GLSL3` is needed for WebGL2 features | Not needed, and it breaks `gl_FragColor` [O] |
| `outputEncoding`, `sRGBEncoding`, `WebGL1Renderer` | Not in the source [O] |
| `material.extensions.derivatives` | Gone; only `clipCullDistance` and `multiDraw` remain [O] |
| `attribute.updateRange` | Replaced by `addUpdateRange` [O] |
| `THREE.Clock` | Deprecated since r183, and warns at construction [O]. The loop uses the rAF timestamp (§3.3) |
| "Enable `mipmapBlur`" | Already the default [O] |
| Bloom `kernelSize`, `resolutionScale`, `width`, `height` | Deprecated [O] |
| `ToneMappingEffect` defaults to ACES | Defaults to AGX [O] |
| `EffectPass.maxTime` wraps time | Dead field: time reached 100 with `maxTime = 5` [O] |
| `BlendFunction.SKIP` differs from `DST` | Alias; both are 9 [O] |

## Plan files

Plans adapt OpenAI's [ExecPlans][execplans] and GitHub's [Spec Kit][speckit]; template section 12 is this project's own. This is vendor and practitioner guidance from sources that borrow from each other, and no controlled study of plan files was looked for.

### When a plan is required

- **Every task in §12 gets its own plan file, written and approved before that task's first line of code.** T00's plan comes first. T01 to T09 may write theirs alongside or after it, citing §8 until `src/contracts/` exists.
- **After that,** write a plan for any multi-file, multi-approach or unclear change, and for any change to a contract, ownership or a gate.
- **Skip it** only for a quick routine fix inside one module you own, with an existing check that proves it. Note the fix in that module's plan under Progress.

### Location and naming

- `plans/T##-slug.md`, using the exact names in §12. Numbers are pre-assigned there, so nobody scans for the next one. New work gets the next T number from the T00 owner before its plan is written.
- Plans live in this folder, not in a tool's private store such as `~/.claude/plans/`, because other executors and later sessions must read them. Copy any plan-mode output here.
- `plans/README.md` (T00) holds the index, either generated or edited only by T00. Plans are not moved or renamed; moving files breaks links.
- `plans/RECONCILIATION.md` is the T00 owner's ledger of contract, seam and design decisions. It is not a plan, `plans:check` does not read it, and executors treat it as read-only. Where a plan and §8 disagree, §8 wins.

### Template

Self-contained, except that contracts are cited by path, since copies drift. Use prose for reasoning, frontmatter for ownership and checkboxes only in Progress.

```yaml
---
id: T03-terrain
title: Terrain clipmap and floor shading
status: draft      # draft | approved | in-progress | blocked | done | abandoned
owner: <agent or person>
depends_on: [T00]
owns: [src/render/terrain/**, dev/terrain.html, tests/visual/terrain.spec.ts, tests/unit/terrain/**, plans/T03-terrain.md]   # exactly the §12 row
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/testing/**]                                           # read-only
updated: 2026-11-04T21:00Z
---
```

Then these `##` headings, in this order:

1. **Purpose:** the outcome a viewer or player can see or measure, not a list of internals.
2. **Context and orientation:** repo-relative paths, terms defined, environment assumptions. Enough for a newcomer with only this plan.
3. **Scope:** owned paths, read-only contracts, explicit non-goals.
4. **Interfaces:** consumed and provided, cited by path from `src/contracts/**`.
5. **Plan of work:** milestones of goal, work, result and proof, each independently verifiable.
6. **Concrete steps:** working directory and exact PowerShell 5.1 commands.
7. **Validation and acceptance:** command or action, then expected output. Observable behaviour, not internal attributes. Include fail-before/pass-after tests, expected counts, negative controls, and screenshot and frame-time evidence where visual. End with a **Human checks** list, by id, if any exist (see [Definition of done](#definition-of-done)).
8. **Idempotence and recovery:** what is safe to re-run, and how to reach a clean state, including for files not yet committed.
9. **Progress:** timestamped checkboxes (`- [x] 2026-11-04T21:10Z Milestone 1: what happened`), with done and remaining recorded at every stop.
10. **Surprises and discoveries:** each with short evidence, such as command output or a source line.
11. **Decision log:** decision, rationale, date, author.
12. **Contract change requests:** what is needed, why, the exact additive diff, and its state: open, approved or rejected.
13. **Outcomes and retrospective:** result against Purpose, gaps, lessons, and what was not verified.
14. **Revision notes:** each change to the plan after approval, dated, with the reason.

### Status lifecycle

Status lives only in the plan's own frontmatter. Bump `updated` (UTC) with every change.

| Status | Meaning | Set by |
|---|---|---|
| `draft` | Written, not accepted. No code yet | Owner |
| `approved` | Accepted by the operator, or by an independent review agent when the operator asked for the whole build in one go (this project's original request did). The author of a plan cannot approve it. Review the plan set once, not each step | Reviewer |
| `in-progress` | Being executed. A `done` plan returns here when T10 or T11 reports a defect in its paths; add a revision note, fix it, then set `done` again | Owner |
| `blocked` | Waiting on a contract request, dependency or decision, with the reason in Progress | Owner |
| `done` | Acceptance has actually run, evidence is pasted, Outcomes is written and lists every open human check | Owner |
| `abandoned` | Stopped on purpose, reason in Outcomes. Kept, not deleted | Owner or operator |

### Keeping a plan alive

- Update it at every stopping point, so a fresh agent can resume from the plan alone.
- Once approved, run without stopping. Stop only for a contract change or an operator decision.
- Log surprises with evidence as they happen, and decisions when they are made, not at the end.
- If plan and disk disagree about what exists, disk wins and the plan gets corrected.

### Deviations

- **Small course change:** amend the plan, and add a Decision log entry and a revision note.
- **Structural mistake or broken contract:** discard the work in your owned paths, sharpen the plan and re-run it. Git restores only what the operator has committed, so copy uncommitted files outside the project before a risky rewrite.
- **Contract change needed:** stop that thread, set `blocked`, and file a request in section 12. The T00 owner approves it as an additive amendment (§8), including after T00 is `done`. The only non-additive change allowed is T11's numeric retune in §8. Never widen a type locally.
- **Defect in another task's paths:** do not edit it. Record it in your plan with evidence and set `blocked`. The operator reopens that task's plan or, in a one-go build, the orchestrating reviewer does (§12). A seam defect where both plans follow their own text goes to the T00 owner, who decides the meaning as the operator's delegate and records it in the ledger. Only §14's operator decisions and T11's verdict wait for the operator.
- **Acceptance:** never edit a threshold or expected output to get a pass without a Decision log entry and the reviewer's agreement.

### Keeping parallel tasks apart

The build ran without git, and disjoint ownership is still the isolation rule. A git worktree would not carry the ignored `node_modules/`, so it is not a drop-in substitute [I].

1. **Disjoint `owns` globs.** Each plan's `owns` is its §12 row. `npm run plans:check` (T00, in `scripts/`) fails if any path matches two plans; run it before spawning executors. Two overlaps are legal: `src/contracts/glsl/hero.glsl` once T00 hands it to T04, and T11's serial window.
2. **Shared files have one owner.** T00 owns `package.json`, the lockfile, all configs and the contracts. T10 owns `index.html`, `src/main.ts` and `src/app/**`. Everyone else files a request. No task owns `architecture.md` or `Agents.md`, so changes to them go to the operator or, in a one-go build, to the T00 owner as the operator's delegate, who records them in the ledger. That includes T11's deviation register.
3. **Contracts freeze before anyone spawns.**
4. **One executor per plan, and a plan is writable only by its owner.**
5. **Isolate shared mutable state** [W] [augment]. Each task uses port `51NN`, where NN is its number, and its own output folder. T00's `playwright.config.ts` reads the port from `TERRAIN_PORT`:
   ```powershell
   npx vite --port 5103 --strictPort
   $env:TERRAIN_PORT = '5103'; npx playwright test tests/visual/terrain.spec.ts --project=gpu --output=test-results/T03
   ```
6. **No ad hoc `npm install`,** since it rewrites a lockfile everyone shares.
7. **Run one `gpu-timing` suite at a time on a machine.** Concurrent GPU work contaminates frame numbers [I].
8. **Follow the graph in §12.** T01 to T09 run in parallel; T00, T10 and T11 run alone. Two tasks can run in parallel when they touch different files and neither depends on the other [W] [speckit].

### On completion

1. Run the acceptance list and paste the short evidence into the plan. False completion is a named failure mode for long-running agents [W] [harness].
2. Write Outcomes: result against Purpose, gaps, lessons, and what was not verified.
3. Set `status: done` and bump `updated`. The plan stays where it is as the record.
4. Do not silently extend scope. Follow-ups go to a new plan or a change request. T09's suites arm at T10, and T10 is not done until they pass (§12).

## Definition of done

A task is done only when all of these are true, each from a run you performed yourself in this session.

1. **The plan's acceptance list passes,** with short output pasted into the plan.
2. **`npm run check:task -- T##` exits 0 for your task,** and the whole-repo `npm run check` exits 0 once the parallel batch has finished. A sibling's half-written file must not fail your task, and your task is not finished until the whole repo is green together.
3. **For any visual change, you looked.** Capture a screenshot with Playwright on the `gpu` project, open the image and view it, then say what you saw. Before T10, use `dev/<module>.html`. A still cannot show shimmer or flicker, so temporal changes also need a frame sequence or the shimmer metric (§11.3). Keep review images at or under 1920 px wide: 1920 x 1080 arrived unscaled, while 3840 x 1620 arrived at 2000 x 844 with false moire [O: T11 test chart, may vary by tool version]. One-level colour steps did not show at any size, so judge banding by number and by range-stretched crops.
4. **For any performance or memory change,** the matching gate in §9 ran. Before T10 that means your module's own gate on its pure path, and your report says it is narrower: only T09's suites on the real build establish §9.
5. **Your report lists what ran, what the result was, and what was not verified.**

Never claim a check you did not run. If a check an agent could run cannot run, say so and leave the task open.

**Human checks are different.** A check that needs a person's eyes, ears or hands, or a device no agent has, such as whether it sounds good, whether it is fun, or a real phone or hidden tab, is a human check. List it by id in your plan's section 7, report it as not verified in Outcomes, and it does not block `done`. T11 collects every open human check into its operator pack, and the operator's answers close them. A defect the operator finds reopens the owning plan. T11 is the exception, because its purpose is the operator's verdict: when its agent stage is complete it stays `blocked` with its pack ready, and only the verdict makes it `done`. Until then, no report may say the build is finished. Viewing your own screenshots (item 3) is an agent's check, not a human check.

A check establishes only what it tested: `tsc` proves types, not behaviour; a pass on the RTX says nothing about phones; art gates catch regressions and do not establish beauty (§11.5).

## Git

This folder is a git repository since 2026-11-11: branch `main`, remote `origin` at `https://github.com/highsierralabs/Midnight_Vector`. A push to `main` runs `.github/workflows/pages.yml`, which builds `dist/` and, once the repository is public, deploys it to GitHub Pages at `https://highsierralabs.github.io/Midnight_Vector/`, so a push publishes the game (T12). Commits use the repo-local identity, the operator's GitHub noreply address; do not change it. Commit and push only when the operator asks, and never force-push. `.gitignore` keeps out `node_modules/`, `dist/`, `test-results/` and `test-refs/` (per-machine references). `.gitattributes` pins text files to LF on checkout, overriding this machine's global `core.autocrlf=true`; do not remove it. Never add AI attribution, such as `Co-Authored-By` trailers or "Generated with" lines, to commit messages or PR bodies.

## Sources

Link targets for the `[W]` labels follow; they do not render. Limits on this evidence: most pages were read through fetch extractions rather than byte-checked, Golus through a mirror, three's dispose manual through search snippets only, and the Khronos context-loss wiki was unavailable (403).

[golus]: https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8
[gjol]: https://pixelmager.github.io/linelight/banding
[mdn-webgl]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
[webgl-spec]: https://registry.khronos.org/webgl/specs/latest/1.0/
[dispose]: https://threejs.org/manual/en/cleanup
[vite-features]: https://vite.dev/guide/features
[vite-mig]: https://vite.dev/guide/migration
[vitest-mig]: https://vitest.dev/guide/migration
[pw-snap]: https://playwright.dev/docs/test-snapshots
[clocks]: https://web.dev/articles/audio-scheduling
[mdn-audio]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
[mdn-abs]: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
[chrome-timers]: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
[cc-memory]: https://code.claude.com/docs/en/memory
[execplans]: https://developers.openai.com/cookbook/articles/codex_exec_plans
[speckit]: https://github.com/github/spec-kit/blob/main/spec-driven.md
[harness]: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
[augment]: https://augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution
