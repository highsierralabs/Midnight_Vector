---
id: T04-sky
title: Sky - gradient, hero disc modes, stars, nebula target and sky events
status: done
owner: T04 executor
depends_on: [T00]
owns: [src/render/sky/**, src/contracts/glsl/hero.glsl, dev/sky.html, tests/visual/sky.spec.ts, tests/unit/sky/**, plans/T04-sky.md]
reads: [architecture.md, Agents.md, plans/T00-foundation.md, src/contracts/**, src/core/**, src/testing/**, tests/support/**]
updated: 2026-11-06T02:31Z
---

## 1. Purpose

After T04 the world has its sky, and the sky is half of what makes the frame read as synthwave. Observable outcomes:

1. A viewer of `dev/sky.html` sees a saturated dusk gradient, fine round stars, a quiet nebula and a hero disc, in each of the four hero modes (banded sun, eclipse corona, ringed planet, wire moon) and each of the six palettes, and all 24 combinations have been opened and judged by the executor.
2. The disc never moves. It sits at the same screen position in every mode and palette, scales only with FOV, and switches between modes with a soft wipe that has no pop at either end.
3. There is no black band under the horizon when the world bends, the sky gradient joins fogged floor cleanly, and dark gradients show no contour lines at normal contrast or when stretched.
4. Stars hold their brightness and shape under camera shake and FOV pulses, and a deliberately naive star fails the same test.
5. Meteors appear in every zone, aurora in Orbital Night, lightning in Cyber Canyon. All are pure functions of tick and zone, and reduced motion turns off everything that flashes.
6. `src/contracts/glsl/hero.glsl` carries all four modes with its frozen signature, so T03's sun column and T05's chrome orbs follow the mode with no work on their side. Mode 0 stays byte-identical to the T00 text, so siblings' screenshots do not change.
7. The sky has no dependence on travel distance, so it cannot degrade at 1e15 u.

## 2. Context and orientation

Working directory for every command: `C:\highsierralabs\terrain`. It is not a git repository. `§n` means a section of `architecture.md`. Read §6.1, §6.3, §6.7, §6.8, §6.10, §5.4, §4.5, §8.2 and §10.3 first, then this plan, then T00's section 4 for the dev shell.

Terms:

- **rd:** the normalized world-space view direction of a fragment. World axes carry no camera pitch, so `rd.y = 0` is the true horizon.
- **Gnomonic g:** `rd.xy / -rd.z`. The disc is fixed in g at centre (0, .125), radius .215.
- **p:** `(g - HERO_C) / HERO_R`, disc coordinates. `d = length(p)`, disc edge at `d = 1`.
- **Hero mode:** 0 banded sun, 1 eclipse, 2 ringed planet, 3 wire moon (`HeroMode` in §8.1).
- **Iso view:** a dev-only build of the sky showing one component.
- **Night factor:** `.5 + .5 * cos(TAU * zone.dayPhase)`, 1 at `dayPhase` 0.
- **Stand-in stack:** T00's `DevPost`: half-float, Bloom and Neutral tone mapping at §6.6 values, final alpha write, `dithering = true`, no CA, Crt or vignette. Sky shots in T04 are judged on this. T06 and T11 own the final look.

Screen geometry at 1920x1080, camera pitch .05 [arithmetic, matches the rehearsal images]:

| Feature | g.y | Row at FOV 58 | Row at FOV 68 |
|---|---|---|---|
| Horizon | 0 | 588.7 | 580.1 |
| Disc top | .34 | 262.3 | 311.7 |
| Disc centre | .125 | 467.4 | 480.4 |
| Disc bottom (hidden by the floor) | -.09 | 677.0 | 652.6 |
| Planet body top, mode 2 | .2669 | 331.5 | 368.7 |

**Where the evidence comes from.** Every `[O]` below was run on 2026-11-05 in a throwaway page in the session scratchpad, built on three 0.187.0 and postprocessing 6.39.6 from the reference install and the contract GLSL from T00's rehearsal, with a stand-in stack matching DevPost, on the RTX 4070 SUPER and SwiftShader. It is not part of the project and may be gone. None of it counts as acceptance. The GLSL in section 5 is the text that ran, with these small changes that have not been rendered in this exact form: function renames to the `hero` and `sky` prefixes, `skyBolt` made branch-free, the removal of rehearsal debug switches, and `uStarPx`. Event schedules in `events.ts` are design [A]; only their look, at hand-picked parameters, was rendered.

Environment facts [O]: `uint` and `ivec2` hashing, `dFdx`, `dFdy` and `fwidth` compile and run under `ShaderMaterial` with `glslVersion` unset, on ANGLE D3D11 and SwiftShader.

**T04 is the one parallel task whose edit reaches other tasks' shaders.** `COMMON_FRAG = common + commonFrag + hero`, so a broken `hero.glsl` breaks every scene material in T03, T05 and T06 the moment Vite serves it. Section 5 M3 handles this.

## 3. Scope

**Owned, and the complete file list:**

| Path | Contents |
|---|---|
| `src/render/sky/index.ts` | Exports only `createSkyLayer: CreateLayer` |
| `src/render/sky/skyLayer.ts` | `createSkyCore(o?: SkyOptions): SkyCore`, the `RenderLayer` |
| `src/render/sky/skyMaterial.ts` | String assembly and the two `ShaderMaterial`s |
| `src/render/sky/skyParams.ts` | Every tunable as a named constant, no three |
| `src/render/sky/events.ts` | Pure schedule: `createSkyEvents`, `biomeWeight`, `nightFactor`, `writeSkyEvents`. No three, no DOM |
| `src/render/sky/sky.vert.glsl`, `sky.frag.glsl`, `skyNoise.glsl`, `skyStars.glsl`, `skyEvents.glsl`, `nebula.vert.glsl`, `nebula.frag.glsl` | Shaders, loaded with `?raw` |
| `src/render/sky/dev/devFloor.ts` | Dev-only `RenderLayer` named `terrain`: bent floor, fog into `skyGrad`, a plain sun column. Never imported by `index.ts` or `skyLayer.ts` |
| `src/render/sky/dev/devHarness.ts` | Dev-only `window.__skyDev`: sheet builder, float probe, context-loss helper |
| `src/render/sky/dev/metrics.ts` | Pure metrics over `Uint8Array`, no three, unit-tested |
| `src/render/sky/dev/hero.v0.glsl` | A byte copy of T00's §8.2 `hero.glsl`, the mode-0 reference |
| `src/render/sky/dev/hero.candidate.glsl` | Working copy for hero edits. Deleted at M8 |
| `src/contracts/glsl/hero.glsl` | After T00 is `done`. Published, not edited in place |
| `dev/sky.html` | Dev page |
| `tests/visual/sky.spec.ts` | Browser acceptance |
| `tests/unit/sky/events.test.ts`, `metrics.test.ts`, `glsl.test.ts` | Unit acceptance |
| `plans/T04-sky.md` | This plan |

**Read-only:** `architecture.md`, `Agents.md`, `src/contracts/**` except `hero.glsl`, `src/core/**`, `src/testing/**`, `tests/support/**`, other plans.

**Non-goals:**

- Fog colour, terrain, sun column ripple and floor blending: T03. `devFloor.ts` exists only to judge the join and is not a stub of T03.
- Palette values and crossfade maths: T01. T04 reads `uPal` and nothing else.
- Bloom, dither, tone mapping, Crt: T06. §6.3 forbids dither in the sky.
- Day-phase exposure, which is T06's. Sky saturation was dropped (DI-03). T04 applies day phase only to stars, nebula, aurora and meteors.
- Allocation and frame-budget gates: T09 owns the real ones. T04 reports indicative numbers.
- The fake world, shell and camera pose: T00.

## 4. Interfaces

**Consumed**, cited from `src/contracts/index.ts`: `CreateLayer`, `RenderLayer`, `RenderContext`, `FrameView`, `ZoneState`, `QualityProfile`, `RenderOrder`, `PHASE_PERIOD_TICKS`, `DebugMode`, `HeroMode`, `Biome`, `PaletteId`. From `src/contracts/glsl.ts`: `COMMON_VERT`, `COMMON_FRAG`. From `src/core/hash.ts`: `hash01`. From `src/testing/`: `startDevShell`, `createFakeWorld`, `DevShell`, `ScriptedFrameOptions`. From `tests/support/pw.ts`: `test`, `expect`, `openDevPage`, `saveShot`.

**Provided to everyone:** `createSkyLayer` from `src/render/sky/index.ts`, and the `sunDisc` semantics below.

**`sunDisc(vec3 rd, float yScale)` semantics, fixed by T04 for T03, T05 and T10:**

- Fragment stage only, because it uses derivatives. `rd` is finite, and need not be normalized or forward-facing. `yScale` is in `(0, 1]`.
- Returned `.rgb` is **already premultiplied emission including the halo**, and is added. `.a` is the coverage of the opaque disc in `[0, 1]`. The correct sky composite is `c * (1. - s.a) + s.rgb`, not `mix(c, s.rgb, s.a)`, which would lose the halo.
- Output is finite and `.rgb >= 0` for every finite `rd`. A7 proves this.
- It reads only `uPhases`, `uPal` and `uHero`. It adds no uniform, since a uniform only the sky supplies would read 0 in terrain.
- Everything else `hero.glsl` declares is prefixed `hero`. No other file may declare a `hero*` or `sky*` symbol.

**Internal dev surface,** used by `dev/sky.html` and the spec. `SkyOptions` is compile-time, through `defines`, so the shipped program has no debug branch. It lives in `skyMaterial.ts`, and `skyLayer.ts` re-exports it:

```ts
export interface SkyOptions {
  iso?: 'all' | 'gradient' | 'stars' | 'nebula' | 'hero' | 'nostars';   // default 'all'; nostars is all but the stars (A13's aurora bound)
  naiveStars?: boolean;     // negative control for the star gate
  legacyBelow?: boolean;    // negative control: the old §6.3 rule, near-black at rd.y < 0 (S-25)
  heroSource?: string;      // replaces hero.glsl for this material only
  nanTest?: boolean;        // negative control for the float probe
  fullAtTier0?: boolean;    // negative control: tier 0 draws the program of tiers 1 to 4, as before D-007 (?tier0=full)
}
export interface SkyCore extends RenderLayer { readonly nebulaSize: readonly [number, number] }
```

**Tier 0's program (D-007).** The layer builds two sky materials from the same text and one private uniform record: the one tiers 1 to 4 have always drawn, and a tier-0 one with `SKY_NEBULA` and `SKY_STARS` left out and `HERO_SUN_ONLY` defined. Both meshes are in `ctx.scene` from `attach`, so `post.precompile()` links both, and `setQuality` only swaps which mesh is visible, which is not a program key. Tier 0 therefore draws gradient, events, the plain sun of mode 0 in every mode, and the horizon rule. Its nebula gain was already 0, so in mode 0 a tier-0 frame equals the old tier-0 frame without stars, byte for byte (A23).

**Private uniforms of the sky material,** all written in `frame()` with no allocation:

| Uniform | Type | Written from |
|---|---|---|
| `uNeb` | sampler2D | Nebula target |
| `uNebGain`, `uStarGain` | float | `nightFactor`, quality |
| `uStarPx` | float | `max(1, renderer.domElement.height / 1080)` |
| `uTwPhase` | float | `phases[5]`, or `phases[7]` under reduced motion |
| `uAuP` | vec2 | `(phases[6], phases[5])`, or `(phases[7], phases[7])` under reduced motion |
| `uAurora`, `uBoltK`, `uFlash` | float | `writeSkyEvents` |
| `uMet`, `uMetK`, `uBoltX` | vec4[2], vec2, float[9] | `writeSkyEvents`, Float32Arrays |

**Seams.** Where another task must assume the same meaning. All were compared at reconciliation, and where a row and §8 differ, §8 wins.

| Other task | Topic | T04's assumption |
|---|---|---|
| T01 | Biome numbering | `Biome` in §8.1: CYBER_CANYON 3, ORBITAL_NIGHT 4 |
| T01 | Palette numbering | `PaletteId` in §8.1, §6.8 order |
| T01 | Mixes | `biomeMix` and `heroMix` ramp 0 to 1 and reach exactly 1 where A takes over B's value. `biomeB` and `heroB` hold the next zone even at mix 0, and T04 ignores them there. Weight of biome b is `(biomeA == b ? 1 - mix : 0) + (biomeB == b ? mix : 0)`, continuous across the boundary. `uHero = (heroA, heroB, heroMix)` |
| T01 | `dayPhase` | Sawtooth in `[0, 1)`. T04 only ever evaluates `cos(TAU * dayPhase)`, so the wrap cannot pop. `dayPhase` 0 is deepest night (§8.1) |
| T01, T06 | Day-phase exposure and saturation | **Not applied by T04.** Exposure is T06's (§5.4, §8.1). Sky saturation was dropped (DI-03). T04's `skyGrad` output is never modified |
| T01 | Bend | `bendAt` gives `c = -1.2e-5`, `vMax = 1500`, and `vMax > 0` always. T04's horizon rule reads `uBend` and the camera's y live and handles any `c`, so T01 may retune without telling T04 |
| T03, T05 | `skyGrad` argument | `y` is `rd.y` of the normalized view direction, in world axes, after the bend. Not gnomonic. The sky passes the same quantity |
| T03 | Fog against sky | Fully fogged geometry equals `skyGrad(rd.y)` exactly. The sky adds to that: stars above `rd.y` .015, nebula above .04, aurora well above that, and the disc's halo everywhere. So fogged ridges show as slightly darker silhouettes against the halo near the disc. That is accepted, and the prototype looked like this [O]. T03's fog stays `skyGrad` only |
| T03 | Sky under the horizon | Per §6.3: full gradient and disc down to `g.y = gb`, near-black (`uPal[0] * .25`) by `gb - .016`. `gb` is .004 under terrain's top edge: the crest `-2 * sqrt(camY * |c|)` when its `v` is inside `vMax`, otherwise the far edge at 6016 u. At `c = -1.2e-5` and camera y 7: `gb` -.0223, near-black by -.0383. T03's floor is translucent, and a wider band leaks through it [O: table in M1]. T03's crest of -.018 to -.022 agrees with this, and nothing of T03's is known to need sky between -.04 and the crest [I], which T03's re-run of its horizon shots tests |
| T03 | Sun column | `sunDisc(rr, .55)`, per §6.4. All four modes render in the reflection through this call [O: rehearsal floor]. Band scroll is not slowed under reduced motion, see the design decision in section 11 |
| T03, T05, T09 | Software cost of `sunDisc` | SwiftShader appears to run all four modes under the uniform branch [I]. Sky at 640x360: 8.0 ms with T00's mode-0 text, 16.9 ms with four modes [O]. If tier 0 misses 50 ms at T10, T03 should drop the sun column at compile time for tier 0, and T04 will add a `HERO_SUN_ONLY` define to `hero.glsl`. **Done for D-007:** `hero.glsl` has the block, and the sky defines it at tier 0. Any material may define it: `sunDisc` then returns mode 0's sun in every mode, with no wipe, and its mode-0 output is unchanged. T05's chrome orbs still run four modes at tier 0 unless T05 defines it there, so at tier 0 an orb can reflect a ringed planet under a plain sun; that is T05's call |
| T05 | Chrome orb | May call `sunDisc(R, 1.)` on a reflected direction, including `R.z >= 0`. Semantics as above, and A7 covers the whole sphere |
| T00 | Hand-off | T04 touches `hero.glsl` only after T00 is `done`. It keeps byte-exact the three lines `contracts-check` requires: `const vec2  HERO_C = vec2(0., .125);`, `const float HERO_R = .215;`, `vec4 sunDisc(vec3 rd, float yScale) {` |
| T00 | `scriptedFrame` overrides | `o.hero` sets `heroA = heroB = hero` and `heroMix = 0`. `o.biome` sets `biomeA = biomeB = biome` and `biomeMix = 0`. `o.palette` writes the §6.8 table into `zone.palette`. `o.zone` is applied last (§8.1) |
| T00 | Camera | `rotation.set(CAMERA_PITCH + shakeY, shakeX, roll)`. T04 derives `rd` from `projectionMatrix` and `viewMatrix`, so any pose and FOV work. Camera x has no effect. Camera y moves only the horizon rule, read from three's `cameraPosition` |
| T00 | Shell | `setTier` calls `setQuality` on layers. `frameAt` calls `frame(v)` on every layer. `pixels()` is valid in the same task as `frameAt`. `?hero`, `?palette`, `?biome`, `?tier`, `?post=off`, `?manual=1` as in T00 section 4 |
| T00 | Console fixture | `pw.ts` fails on `console.error`. D3D11 translator warnings reach `console.warn` through three (`WebGLProgram.js:867`), so the spec adds its own `X4000` check, and the shared fixture stays as it is (DI-38) |
| T06 | Quality | `nebulaWidth` is one of 384, 192, 0, per §6.10. Target height is width / 2. 0 means no draw and gain 0. `q.tier === 0` also selects tier 0's program (D-007): no nebula sampling, no stars, the plain sun. §6.10's table does not list stars; tier 0 drops them anyway, recorded in the decision log |
| T06, T10 | Render-target use | Inside `sky.frame(v)`, T04 calls `setRenderTarget(rt)`, `render`, then restores what `getRenderTarget()` returned. It changes nothing else. It runs before `post.frame` and `post.render`, per §3.3 step 11 |
| T06 | Precompile | `post.precompile()` covers both sky materials, because both meshes are in `ctx.scene` from `attach`, the tier-0 one hidden at tiers 1 to 4 and the other hidden at tier 0 (three's `compile` walks `scene.traverse`, which includes hidden meshes [O: `WebGLRenderer.js` 1464]). The nebula program is separate and compiles in `rebuild`, which T00's lifecycle runs after precompile and before the first frame. So there is no mid-game compile at any tier |
| T06 | Dither | Sky output is HDR linear with no dither. T04's banding gate holds under `dithering = true` on the last pass. If T06 replaces that dither, it must re-run A10 |
| T06 | Luminance | Disc 1.05, wire lines 1.45, ring edges 1.5, eclipse ring 1.5, moon rim 1.6, meteors 1.9, bolt 2.2. All are thin except the disc. Bloom threshold .95 and smoothing .25 assumed |
| T06 | Two flashes | `feel.flash` is T06's. Lightning's `uFlash` is T04's and is independent of it |
| T09 | Purity | Sky output is a pure function of seed, zone fields, `tick mod 30720`, `alpha`, `uBend`, camera rotation, FOV and y, canvas height, quality and `reducedMotion`. It reads neither `v.cam` nor `uTravel`. Identity comparisons need ticks congruent mod 30720 and equal zone state |
| T09 | Debug modes | `setDebugMode` is a no-op on the sky. Crack and edge-paint runs that need a magenta background must call `setVisible(false)`, which also stops the nebula draw |
| T09 | Counts | 2 draws per frame at tiers 4 to 2 (sky, nebula), 1 at tiers 1 and 0, 1 triangle each. 3 programs (sky, tier-0 sky, nebula), 1 geometry shared by all three meshes, 1 target, 2 sky meshes in `ctx.scene` with one visible. All constant after boot. Before D-007 it was 2 programs and 1 sky mesh |
| T10 | Boot and restore | `createSkyLayer()` first in the layer array. `rebuild(v)` before the first `frame(v)`, and after every context restore. T10 does not cache anything from the layer |
| T11 | Tuning | `skyParams.ts` and the shaders are in T11's window through `src/render/**`, and so is `hero.glsl`, with its three signature lines frozen (§12) |

## 5. Plan of work

Milestones run in order and each can be verified alone. Every visual milestone ends with the executor opening the images, per the review table in section 7.

### M0. Preconditions

**Goal:** the ground is what this plan assumes. **Work:** confirm `plans/T00-foundation.md` is `done`. `Biome`, `PaletteId`, the `dayPhase` comment and `o.zone` are in §8. Read `src/testing/devShell.ts` and `scriptedFrame.ts`, and correct the seam table if disk disagrees (disk wins). Copy `src/contracts/glsl/hero.glsl` to `src/render/sky/dev/hero.v0.glsl` and to `hero.candidate.glsl`, byte for byte, with `Copy-Item`. **Result:** references in place. **Proof:** `Get-FileHash` equal across the three files.

### M1. Skeleton: gradient, contract disc, horizon rule

**Goal:** the layer draws through the full lifecycle, and the horizon is right. **Work:**

`sky.vert.glsl`:

```glsl
out vec3 vRd;
void main() {
  vec3 v = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.);
  vRd = transpose(mat3(viewMatrix)) * v;
  gl_Position = vec4(position.xy, 1., 1.);
}
```

The vertex shader needs no shared code. Geometry: one `BufferGeometry` with `position` `[-1,-1,0, 3,-1,0, -1,3,0]`, shared with the nebula mesh. Material: `ShaderMaterial`, `glslVersion` unset, `uniforms: { ...ctx.shared, ...private }`, `depthTest: false`, `depthWrite: false`, `transparent: false`. No `<colorspace_fragment>` include, since the composer owns encoding. Mesh: `renderOrder = RenderOrder.SKY`, `frustumCulled = false`, `matrixAutoUpdate = false`. Never `clone()` the material.

`sky.frag.glsl`, the shipped composition. Comments in the file should say why each fade exists:

```glsl
in vec3 vRd;
void main() {
  vec3 rd = normalize(vRd);
  vec2 g = rd.xy / max(-rd.z, 1e-3);
  float pxw = fwidth(g.y) + 1e-6;                          // before any branch
  vec3 c = skyGrad(rd.y);
  vec3 tx = texture(uNeb, vec2(g.x / 3.6 + .5, g.y + .05)).rgb;
  float neK = smoothstep(.46, .78, tx.r) * (.5 + tx.g) * smoothstep(.04, .34, rd.y);
  float neA = smoothstep(.2, .5, rd.y) * (1. - smoothstep(.35, .7, tx.b));   // accent clouds only high up, and dimmer
  c += emit(mix(uPal[4], uPal[6], neA), mix(.04, .025, neA)) * neK * uNebGain;
  c += skyStars(rd);
  if (uAurora > 0.) c += skyAurora(g);                     // uniform condition, no derivative inside
  c += skyMeteor(g, uMet[0], uMetK.x, pxw) + skyMeteor(g, uMet[1], uMetK.y, pxw);
  if (uBoltK > 0.) c += skyBolt(g, pxw);
  c += emit(uPal[2], uFlash) * smoothstep(-.05, .2, rd.y);  // the sky lights up in its own hue
  vec4 s = sunDisc(rd, 1.);
  c = c * (1. - s.a) + s.rgb;
  float cy = max(cameraPosition.y, 1.), cc = max(-uBend.y, 0.), vm = uBend.z;
  float gb = (sqrt(cy / max(cc, 1e-12)) <= vm ? -2. * sqrt(cy * cc) : -(cy + cc * (vm * vm + 2. * vm * (6016. - vm))) / 6016.) - .004;
  c = mix(uPal[0] * .25, c, smoothstep(gb - .016, gb, g.y));   // full sky down to terrain's top edge, then dark fast
  gl_FragColor = vec4(c, 1.);
}
```

Iso and negative-control variants use `#ifdef` around the same lines. `legacyBelow` replaces the last mix with `if (rd.y < 0.) c = uPal[0] * .25;`.

**Why the horizon rule is what §6.3 states (S-25).** With `c = -1.2e-5` the floor's top edge is a crest at `g.y = -2 * sqrt(camY * |c|)`, which is -.0183 at camera y 7 and -.0217 at 9.8, about 18 to 21 px under the true horizon, at v = 764 u and unfogged. So the old §6.3 rule, "near-black below the horizon", paints a black stripe across the screen between the crest and the horizon. T01's `bendAt` makes `c = -1.2e-5` the constant value in production. Scene objects hid this in the art prototype's `bend.png`, which is why nobody saw it.

The sky cannot simply stay bright lower down either, because the floor is translucent (alpha .72 to .94, §6.4), so whatever the sky paints behind it shows through. A first fix that kept full sky to `g.y` -.045 and faded by -.12 washed out the near floor and ghosted the disc through it. The rule above stays bright only to just under the crest, and is dark .016 lower. Luminance at x = 300 under T03's alpha law, `c = -1.2e-5` [O]:

| Rule | Row 590 | 600 | 608 | 620 | 630 | 660 | 680 |
|---|---|---|---|---|---|---|---|
| Old §6.3 rule | 1 | 2 | 29 | 30 | 15 | 21 | 7 |
| Wide fade, rejected | 84 | 84 | 44 | 45 | 37 | 34 | 18 |
| This rule | 84 | 84 | 44 | 35 | 15 | 21 | 7 |

So the black band is gone, and from row 630 the floor equals the old rule. Rows 608 to 625 carry a soft glow just under the crest, and T03 should judge it in its own frames.

`skyLayer.ts` per the interface. `setVisible(on)` sets `mesh.visible` and suppresses the nebula draw. `setDebugMode` is empty. `dispose` frees target, materials and geometry. The layer's default hero is whatever `COMMON_FRAG` holds. `dev/sky.html?candidate=1` passes the working copy as `heroSource`, and `?verbatim=1` passes `hero.v0.glsl`, to the sky and to `devFloor` alike. The spec adds `candidate=1` through one constant until M3 clears it.

`devFloor.ts`: a `PlaneGeometry(8192, 6400, 1, 320)` in render space from z = 64 to -6336, vertex `bendV(position)`, then `projectionMatrix * viewMatrix`. Fragment: `pristineGrid` at /8, `emit`, radial `fogK`, `sunDisc(reflected rd, .55)` times a Fresnel term `F`, then `mix(c, skyGrad(rd.y), fog)`, with alpha `mix(mix(.72, .94, 1. - F), 1., fog)`, the §6.4 law, so sky leak through the floor is visible. `transparent: true`, `renderOrder = RenderOrder.TERRAIN`, `frustumCulled = false`. Camera position comes from `cameraPosition.xy`, which T00's GLSL gate allows.

`dev/sky.html`: inline module of a few lines, per T00's dev-page convention. It reads `?iso`, `?naive`, `?below=legacy`, `?verbatim`, `?candidate`, `?floor`, `?period`, `?nan`, loads the two hero texts with `?raw` imports, then builds `createSkyCore(options)`, optionally `createDevFloor()`, optionally a `createFakeWorld({ periodChunks: 1024 })`, then `startDevShell(layers, undefined, { world })` and `installSkyDev(core)`. It carries `<link rel="icon" href="data:,">`.

The spec saves images under `info.outputPath(...)` and prints `SCREENSHOT <absolute path>` for each, like T00's `saveShot`, so the executor knows what to open.

**Result:** gradient and disc with a clean horizon. **Proof:** A1, A5, and the M1 images.

### M2. Hero candidate: four modes in the working copy

**Goal:** all four modes look right before anyone else can see them. **Work:** write `hero.candidate.glsl`. Starting text, as rendered in the rehearsal [O], changing only its first comment line:

```glsl
// Hero disc: four modes behind one frozen signature. rgb is premultiplied emission including the halo; a is disc coverage.
// Reads only uPhases, uPal and uHero. Every symbol except sunDisc is prefixed hero. Derivatives are taken in sunDisc before the mode branch.
const vec2  HERO_C = vec2(0., .125);
const float HERO_R = .215;

vec3 heroHaloColor() { return mix(uPal[4], uPal[2], .5); }

vec4 heroSun(float d, float a, float v, float b) {
  float f = fract(v * 9. + uPhases[1].x);
  float w = clamp((.42 - v) / 1.42, 0., 1.); w = .04 + .8 * w * w;
  float band = v > .42 ? 1. : smoothstep(w - b, w + b, abs(f - .5) * 2.);
  float m = (1. - smoothstep(1. - a, 1. + a, d)) * band;
  vec3 s = emit(mix(uPal[4], uPal[3], smoothstep(-.9, .75, v)), 1.05) * m;
  float e = max(d - 1., 0.);
  float halo = exp(-e * 2.4) * .30 + exp(-e * .7) * .10;
  return vec4(s + heroHaloColor() * halo * (1. - m), m);
}

vec4 heroEclipse(vec2 p, float d, float a) {
  float m = 1. - smoothstep(1. - a, 1. + a, d);
  float e = max(d - 1., 0.);
  float th = atan(p.y, p.x + 1e-7);            // no derivative of th anywhere: its seam would show
  float ph = phaseAt(6);
  float s1 = sin(th * 5. + TAU * ph) * .45 + sin(th * 11. - TAU * 2. * ph + 1.7) * .33 + sin(th * 23. + TAU * 3. * ph + .6) * .22;
  float st = .5 + .5 * s1;
  float corona = exp(-e * (6.5 - 4.3 * st));
  float ring = exp(-abs(d - 1.) / (.022 + a));
  vec3 cor = emit(mix(uPal[2], uPal[4], clamp(e * .9, 0., 1.)), .62);
  vec3 rgb = emit(mix(uPal[3], uPal[2], .2), 1.5) * ring + cor * corona * (1. - m) + uPal[0] * .35 * m;
  rgb += heroHaloColor() * exp(-e * .7) * .10 * (1. - m);
  return vec4(rgb, m);
}

vec4 heroPlanet(vec2 p, float d, float a) {
  const float RB = .66;
  const float C = .9553, S = -.2955;           // tilt -0.3 rad
  vec2 q = vec2(C * p.x - S * p.y, S * p.x + C * p.y);
  float r = length(vec2(q.x, q.y / .25));
  float ar = fwidth(r) + 1e-4;
  float strip = (smoothstep(.98 - ar, .98 + ar, r) * (1. - smoothstep(1.2 - ar, 1.2 + ar, r)))
              + (smoothstep(1.26 - ar, 1.26 + ar, r) * (1. - smoothstep(1.52 - ar, 1.52 + ar, r))) * .75
              + (smoothstep(1.58 - ar, 1.58 + ar, r) * (1. - smoothstep(1.68 - ar, 1.68 + ar, r))) * .5;
  float edge = exp(-abs(r - 1.68) / (.012 + ar)) + exp(-abs(r - .98) / (.012 + ar));
  float mb = 1. - smoothstep(RB - a, RB + a, d);
  float front = 1. - smoothstep(-ar, ar, q.y);
  float ringVis = 1. - mb * (1. - front);
  float nz = sqrt(max(1. - d * d / (RB * RB), 0.));
  float lat = q.y / RB;
  float bands = .5 + .5 * sin(lat * 15. + sin(q.x * 3.1 + TAU * phaseAt(7)) * .55);
  vec3 bodyC = mix(uPal[4], uPal[3], clamp(lat * .55 + .5 + (bands - .5) * .5, 0., 1.));
  vec3 body = emit(bodyC, 1.05) * (.42 + .58 * nz);
  vec3 ringC = emit(uPal[6], .34) * strip + emit(uPal[6], 1.5) * edge;
  float ringA = clamp(strip * .9, 0., 1.);
  float cov = max(mb * (1. - front * ringA), ringA * ringVis);
  vec3 rgb = body * mb * (1. - front * ringA) + ringC * ringVis;
  float e0 = max(d / RB - 1., 0.), e = max(d - 1., 0.);
  rgb += heroHaloColor() * (exp(-e0 * 2.4) * .22 + exp(-e * .7) * .10) * (1. - cov);
  return vec4(rgb, cov);
}

vec4 heroMoon(vec2 p, float d, float a) {
  float m = 1. - smoothstep(1. - a, 1. + a, d);
  float e = max(d - 1., 0.);
  float z = sqrt(max(1. - d * d, 0.));
  const float CT = .9394, ST = .3429;          // forward tilt .35 rad
  const float CR = .9689, SR = -.2474;         // roll -.25 rad
  vec3 n = vec3(CR * p.x - SR * p.y, SR * p.x + CR * p.y, z);
  n = vec3(n.x, CT * n.y - ST * n.z, ST * n.y + CT * n.z);
  vec2 uv = vec2(atan(n.x, n.z + 1e-7) / TAU * 18. + 18. * phaseAt(7), asin(clamp(n.y, -1., 1.)) / 3.14159265 * 12.);
  vec2 l = pristineLines(uv, vec2(.045));
  float wire = max(l.x, l.y) * smoothstep(0., .25, z);
  float rim = exp(-abs(d - 1.) / (.014 + a));
  vec3 rgb = emit(uPal[5], 1.45) * wire * m + emit(mix(uPal[5], uPal[3], .4), 1.6) * rim + uPal[0] * .55 * m;
  rgb += heroHaloColor() * (exp(-e * 3.2) * .20 + exp(-e * .7) * .10) * (1. - m);
  return vec4(rgb, m);
}

vec4 heroEval(int mode, vec2 p, float d, float a, float v, float b) {
  vec4 r;
  if (mode == 1) r = heroEclipse(p, d, a);
  else if (mode == 2) r = heroPlanet(p, d, a);
  else if (mode == 3) r = heroMoon(p, d, a);
  else r = heroSun(d, a, v, b);
  return r;
}

vec4 sunDisc(vec3 rd, float yScale) {
  vec2 g = rd.xy / max(-rd.z, 1e-3); g.y *= yScale;
  vec2 p = (g - HERO_C) / HERO_R;
  float d = length(p), a = fwidth(d) + 1e-4, v = p.y;
  float b = fwidth(v) * 9. + 1e-4;
  int ma = int(uHero.x + .5), mb = int(uHero.y + .5);
  vec4 A = heroEval(ma, p, d, a, v, b);
  if (uHero.z <= 0. || ma == mb) return A;
  vec4 B = heroEval(mb, p, d, a, v, b);
  if (uHero.z >= 1.) return B;
  // A soft wipe rising through the disc. Every mode's opaque part lies within |v| < 2, but sky is visible up to v = 2.91 at FOV 68 (DI-44).
  float th = mix(-2.2, 3.4, uHero.z);
  float k = 1. - smoothstep(th - .6, th + .6, v);
  return mix(A, B, k);
}
```

Mode branches are on a uniform, so `fwidth` inside `heroPlanet` and `pristineLines` inside `heroMoon` are in uniform control flow. Every animation is an integer harmonic of a phase (§4.5). All smoothsteps have increasing edges. Band scroll stays `uPhases[1].x`, which is phase 4 (480 ticks, 4 s), since `phaseAt(i)` reads `uPhases[i / 4][i % 4]` (DI-63).

**Then iterate on what you see.** The rehearsal text is a good start, not a verdict: one reviewer, from stills, at one tick. Ring tips reach close to the horizon, and the ring fill is the least certain choice. Change text freely, except the three frozen lines and mode 0's output.

**As shipped, three changes to the starting text above** (`src/contracts/glsl/hero.glsl` is the text; decision log has the reasons):

```glsl
// heroPlanet: coverage no longer falls with brightness
float s1 = smoothstep(.98 - ar, .98 + ar, r) * (1. - smoothstep(1.2 - ar, 1.2 + ar, r));
float s2 = smoothstep(1.26 - ar, 1.26 + ar, r) * (1. - smoothstep(1.52 - ar, 1.52 + ar, r));
float s3 = smoothstep(1.58 - ar, 1.58 + ar, r) * (1. - smoothstep(1.68 - ar, 1.68 + ar, r));
float strip = s1 + s2 * .75 + s3 * .5;
float ringA = clamp((s1 + s2 + s3) * .96, 0., 1.);
// heroEclipse(vec3 rd, vec2 p, float d, float a): sky plus corona stays under the bloom threshold
float skyL = dot(skyGrad(rd.y / max(length(rd), 1e-6)), W709);
vec3 cor = emit(mix(uPal[2], uPal[4], clamp(e * .9, 0., 1.)), .54 * (1. - smoothstep(.15, .6, skyL)) + .08);
// sunDisc, after k: the directions the wipe never reaches fade over the first and last tenth
k = max(min(k, smoothstep(0., .1, uHero.z)), smoothstep(.9, 1., uHero.z));
```

A fourth change is comment only (DI-63): line 2 of the starting text said derivatives are taken in `sunDisc` before the mode branch, but `heroPlanet`'s `fwidth` and `heroMoon`'s `pristineLines` run inside it. Line 2 now says so, and that this is legal because the branch is on a uniform. Published `37cb8804...` at 2026-11-05T20:20Z through steps 1 to 5 of M3.

**Result:** a candidate the executor can defend. **Proof:** A2, A3, A4, A6, A7, and the M2 images.

### M3. Publish `hero.glsl`

**Goal:** siblings get four modes with no breakage. **Work,** in this order:

1. A2, A3, A4, A7 pass against the candidate.
2. `glsl.test.ts` passes: the three frozen lines present verbatim, no `uniform` declaration, every top-level function `sunDisc` or `hero*`.
3. Copy the candidate to `src/render/sky/dev/hero.publish.tmp`, then `Move-Item -Force` that over `hero.glsl` in one step, a rename on the same volume, and inside T04's owned paths until the moment it lands. Never edit `hero.glsl` in place, and never let an editor save a half-written file there. LF endings, UTF-8 no BOM: copy bytes, do not re-encode.
4. Clear the spec's `candidate=1` constant, run A2 and A3 again, then `npm run contracts:check`.
5. Note the time in Progress. Sibling dev pages are Vite-served, so their next load picks it up.

From here, further hero edits return to `hero.candidate.glsl` (copy `hero.glsl` over it first) and go through steps 1 to 5 again. **If a sibling reports a shader failure traced to `hero.glsl`, restore `src/render/sky/dev/hero.v0.glsl` over it immediately, then investigate.** **Result:** `createSkyLayer` uses `COMMON_FRAG` with no override. **Proof:** A2, A3, `contracts:check` exit 0.

### M4. Stars

**Goal:** fine round stars that hold still. **Work:** `skyNoise.glsl`:

```glsl
uint skyHu(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float skyHash(ivec2 c, uint s) { return float(skyHu(uint(c.x) * 0x9E3779B1U ^ uint(c.y) * 0x85EBCA77U ^ s)) / 4294967296.; }
float skyVn(vec2 p) {
  vec2 i = floor(p), f = p - i; f = f * f * (3. - 2. * f); ivec2 c = ivec2(i);
  return mix(mix(skyHash(c, 1U), skyHash(c + ivec2(1, 0), 1U), f.x), mix(skyHash(c + ivec2(0, 1), 1U), skyHash(c + ivec2(1, 1), 1U), f.x), f.y);
}
float skyFbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * skyVn(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
```

`skyStars.glsl`, branch-free, with one return:

```glsl
vec3 skyStars(vec3 rd) {
  vec2 st = rd.xz / (max(rd.y, 0.) + .35) * 62.;       // max(): rd.y + .35 reaches 0 on screen below the horizon
  vec2 dx = dFdx(st), dy = dFdy(st);
  float det = dx.x * dy.y - dy.x * dx.y; det += det < 0. ? -1e-9 : 1e-9;
  float cellPx = 1. / sqrt(abs(det));
  vec2 ci = floor(st); ivec2 c = ivec2(ci); vec2 f = st - ci;
  float r = skyHash(c, 2U), rs = skyHash(c, 3U);
  float rpx = min(mix(.8, 1.9, rs) * uStarPx, .45 * cellPx);
  float mar = rpx / cellPx;
  vec2 o = f - .5 - (vec2(skyHash(c, 4U), skyHash(c, 5U)) - .5) * max(1. - 2. * mar, 0.);
  vec2 pp = vec2(dy.y * o.x - dy.x * o.y, dx.x * o.y - dx.y * o.x) / det;   // cell offset to pixels, exact inverse Jacobian
  float k = 1. - smoothstep(rpx * .45, rpx, length(pp));
  float k3 = 1. + floor(skyHash(c, 6U) * 3.);
  float tw = mix(1., .82 + .18 * sin(TAU * (k3 * uTwPhase + skyHash(c, 7U))), step(.979, r));
  return step(.93, r) * vec3(.9, .85, 1.) * k * mix(.14, .85, rs * rs) * tw * smoothstep(.015, .25, rd.y) * uStarGain;
}
```

Three points in that text came from failures in the rehearsal [O]:

- **No `if (r < .93) return` above the derivatives.** That early exit produced hollow parallelogram outlines around every lit cell on D3D11, and the tracker found 1 star instead of 225. Moving the `dFdx` lines above the `if` changed nothing, consistent with the translator sinking them into the branch [I]. Only removing the branch fixed it.
- **Per-axis `fwidth` stretches stars.** The old §6.3 `max(fwidth(st))` metric and the prototype's `fp/dst*px` give horizontal dashes off-axis near the horizon, because `fwidth` adds both screen derivatives. The inverse Jacobian above gives round dots everywhere.
- **Peak star L is .85 x .87,** under the bloom threshold, so stars cannot bloom-flicker. The prototype's 1.3 could.

`naiveStars` replaces the body with a fixed cell-space radius and a hard step, the "torn dashes" of §6.3, as the negative control. Add `metrics.ts` and its unit tests with synthetic inputs first, so the metric is shown able to fail on its own. Definitions, as rehearsed: `trackStars` takes as candidates the local maxima within +/-2 px with luminance at least 50, no pixel above 10 elsewhere in +/-9, in sky rows, x 500 to 1420, and sums a 15x15 window around the predicted position in each frame. `bandChanges` takes every 4th column, counts value changes between adjacent rows, and divides total changes by total (max - min) levels. Near-white is min channel above 235. Chroma is mean (max - min) channel, per pixel.

**Result:** stars pass the tracked gate. **Proof:** A8, A9, and the M4 images.

### M5. Nebula render target

**Goal:** soft structure behind the stars at a bounded, fixed cost. **Work:** `nebula.frag.glsl`, prefixed with `COMMON_VERT` and `skyNoise.glsl`:

```glsl
in vec2 vUv;
void main() {
  vec2 g = vec2((vUv.x - .5) * 3.6, vUv.y - .05);
  vec3 rd = normalize(vec3(g, -1.));
  vec2 q = rd.xz / (rd.y + .35);
  float ph = TAU * phaseAt(7);
  vec2 d1 = .10 * vec2(cos(ph), sin(ph)), d2 = .06 * vec2(cos(2. * ph + 1.), -sin(2. * ph + 1.));
  float w = skyFbm(q * 1.3 + d1);
  float ne = skyFbm(q * 2.1 + w * 1.6 + d2);
  float fil = skyFbm(q * 5.3 - w * 2.2 - d1 * 2.);
  gl_FragColor = vec4(ne, fil, w, 1.);
}
```

The target stores densities, not colour, so palette changes need no re-render, and the sky shader colours them. The domain covers `|g.x| <= 1.8` and `g.y` from -.05 to .95, which contains every visible direction up to the §6.4 horizontal cap (half-tangent 1.574) and FOV 68 (top g.y about .75) with margin for shake. Sampling clamps at the edge.

Target: `new WebGLRenderTarget(w, w / 2, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false })`. Scene: its own `Scene` with `matrixWorldAutoUpdate = false`, a plain `Camera`, one mesh with `frustumCulled = false`.

- `frame(v)`: if visible and `nebulaWidth > 0`: `prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(nebScene, nebCam); renderer.setRenderTarget(prev);`. Every frame, as §6.3 says, because skipping frames would make the image depend on history and break identity.
- `setQuality(q)`: `rt.setSize(w, w / 2)` when `q.nebulaWidth > 0`, which reallocates only if the size changed [O: `RenderTarget.setSize`, §6.10 allows a tier-change cost]. At 0, keep the current target, skip the draw and set gain 0. The initial size is 192x96, so the sampler is always valid.
- `rebuild(v)`: always render once, even at `nebulaWidth = 0`, so the program is compiled at boot whatever the starting tier, and re-baked after a context restore.

**Result:** one extra draw at tiers 4 to 2, none below. **Proof:** A11, A12, and the M5 images.

### M6. Sky events

**Goal:** the sky has moments, without state. **Work:** `skyEvents.glsl`:

```glsl
vec3 skyAurora(vec2 g) {
  float x = g.x;
  float w = sin(x * 2.1 + TAU * uAuP.x) * .11 + sin(x * 5.3 - TAU * 2. * uAuP.x + 1.3) * .045;
  float h = g.y - (.40 + w);
  float body = smoothstep(0., .06, h) * exp(-max(h, 0.) * 4.2);
  float rays = .55 + .45 * sin(x * 43. + sin(x * 17. + TAU * uAuP.y) * 2.2 + TAU * 2. * uAuP.y);
  rays *= .7 + .3 * sin(x * 97. + TAU * 3. * uAuP.y + sin(x * 31.) * 1.5);
  return emit(mix(uPal[6], uPal[1], clamp(h * 2.6, 0., .7)), .30) * body * rays * uAurora;
}
vec3 skyMeteor(vec2 g, vec4 m, float k, float pxw) {           // m.xy head, m.zw tail
  vec2 a = m.zw, ba = m.xy - a;
  float t = clamp(dot(g - a, ba) / max(dot(ba, ba), 1e-6), 0., 1.), d = length(g - a - ba * t);
  float w = mix(.35, 1.15, t) * pxw;
  return emit(mix(uPal[6], vec3(1.), .45), 1.9) * (1. - smoothstep(w, w + 1.4 * pxw, d)) * t * t * k;
}
vec3 skyBolt(vec2 g, float pxw) {
  const float T = .74, B = -.04;                        // B is under the crest, so the horizon rule and the floor end the bolt
  float t = (T - g.y) / (T - B), ends = smoothstep(0., .03, t) * (1. - smoothstep(.97, 1., t));
  float fi = clamp(t, 0., 1.) * 8.; int i = int(min(floor(fi), 7.));
  float xb = mix(uBoltX[i], uBoltX[i + 1], fi - float(i));
  float xj = xb + (skyVn(vec2(t * 46., uBoltX[0] * 37.)) - .5) * .026 + (skyVn(vec2(t * 131., uBoltX[0] * 53.)) - .5) * .009;
  float d = abs(g.x - xj), w = mix(.6, 1.5, clamp(t, 0., 1.)) * pxw;
  float l = 1. - smoothstep(w, w + 1.6 * pxw, d);
  return (emit(mix(uPal[6], vec3(1.), .55), 2.2) * l + emit(uPal[6], .5) * exp(-abs(g.x - xb) * 34.) * .20) * uBoltK * ends;
}
```

`events.ts` is pure, allocation-free and three-free:

```ts
export const SKY_CYCLE = 30720;        // phase 7, 256 s. Divisible by every slot length below
export interface SkyEvents { readonly met: Float32Array; readonly metK: Float32Array; readonly boltX: Float32Array; boltK: number; flash: number; aurora: number }
export type SkyZone = Readonly<Pick<ZoneState, 'biomeA' | 'biomeB' | 'biomeMix' | 'dayPhase'>>;
export function createSkyEvents(): SkyEvents;                            // met 8, metK 2, boltX 9
export function biomeWeight(z: SkyZone, b: number): number;
export function nightFactor(dayPhase: number): number;
export function writeSkyEvents(seed: number, tick: number, alpha: number, z: SkyZone, reduced: boolean, out: SkyEvents): void;
```

Schedule, all values [A] in `skyParams.ts`. `tc` is `tick % SKY_CYCLE` from exact doubles, so `tick` may be any integer below 2^53. `h(a, i)` is `hash01(seed, slot, a, i)`.

| Event | Rule |
|---|---|
| Meteor | Two channels `c = 0, 1`, slots of 960 ticks (8 s), channel 1 offset by 480 ticks. `h0 < rate` fires, with `rate = .25 + .25 * weight(ORBITAL_NIGHT)`, gate `clamp((rate - h0) / .02, 0, 1)` so a changing weight cannot pop a meteor. Start `t0 = .05 + .55 * h1` of the slot, life `.09 + .08 * h2` of the slot (.72 to 1.36 s). Always ends by .77 of the slot, so nothing crosses a slot boundary, and channel 0 never crosses the cycle wrap. Channel 1's last slot, from tick 30240, does span the wrap, so its slot number and local tick come from `(tc + SKY_CYCLE - 480) % SKY_CYCLE`, which runs through the wrap with no jump [arithmetic]. Start `(-1.4 + 2.8 * h3, .30 + .38 * h4)`, direction `(sign * (.35 + .35 * h5), -(.10 + .16 * h6))`, travelling toward the centre. `s` in `[0, 1]`: head `A + D * s`, tail `A + D * max(s - .55, 0)`, `metK = gate * min(s / .1, (1 - s) / .3, 1) * mix(.6, 1, night)`. Off under `reduced` |
| Lightning | `w = weight(CYBER_CANYON)`. Slots of 1920 ticks (16 s). `h0 < .55` fires at tick `192 + floor(h1 * 1440)` of the slot. Two strobes: age 0 to 11 ticks at `exp(-age / 4)`, age 20 to 29 at `.8 * exp(-(age - 20) / 3)`. `boltK = w * strobe`, `flash = .05 * w * strobe`. Path `x0 = side * (.45 + .4 * h2)` plus a random walk of `(h(i) - .5) * .14` over 9 points, then the whole path moves inward, keeping its shape, until its outer side is at most `BOLT_X_MAX` .9. So every bolt is on a 16:9 screen at FOV 58, which shows `|g.x|` up to about .98 (V1 review). Over 400 seeds, 0 of 3,455 strikes reach past .99, and 8 (.23%) have a point inside the disc's `|g.x| < .215` [O: scratch scan of `events.ts`]. Before, with `.8 * h2` and no shift, 25.2% lay wholly past .99, so the sky flashed with no bolt, and .12% reached the disc. The disc composites over the bolt. Off under `reduced` |
| Aurora | `aurora = weight(ORBITAL_NIGHT) * mix(.6, 1, night)`, continuous by construction. Stays on under `reduced` with the slowest phase |

Stars use `uStarGain = mix(.35, 1, night)`, nebula `uNebGain = nebulaOn ? mix(.5, 1, night) : 0`.

The schedule deliberately ignores `zone.index` and `v.cam`, see the decision log. Pattern repeats every 256 s, which is over three zones at cruise and behind a different palette and biome.

**Photosensitivity.** At most two strobes per strike and at least 3.7 s between strikes by construction, sky-wide flash at most .05 L (`emit(uPal[2], uFlash)` makes that exact), off under reduced motion. The unit test counts rising edges over the whole cycle. The "three flashes per second" limit behind this is from memory [M], and this is not a compliance claim.

**Result:** events render in the right zones. **Proof:** A13, A14, and the M6 images.

### M7. Dark gradients and photometry

**Goal:** the numbers and the eye agree across six palettes. **Work:** with `?iso=gradient`, run A10 and view the range-stretched crops of all six palettes. Run A4's numeric gates with everything on. T04 cannot edit `skyGrad` or palette values. Anything found there is a finding with evidence for T01, T00 or T11, not a local fix. Arctic Laser's disc and the sky budget are closed (DI-02, DI-04), and A4 gates the new disc top. **Result:** a measured table in Progress. **Proof:** A10, A4.

### M8. Whole-layer review and exit

**Goal:** the task can close. **Work:** run the full spec and unit suites, and the wide and narrow viewport shots (A15), DPR 2 (A16), tier sweep (A12), context restore (A17), software (A18). Delete `hero.candidate.glsl`. Write Outcomes, paste evidence, list what was not verified. `npm run check:task -- T04`. When the batch has finished, whole-repo `npm run check`. **Result:** `status: done`. **Proof:** A19, A20.

### M9. Tier 0 for D-007 (reopened after T10)

**Goal:** the sky stops costing tier 0 on software what tier 0 does not show, without changing tiers 1 to 4. **Work:** the `HERO_SUN_ONLY` block in `hero.glsl` through M3; a second sky program at tier 0 without `SKY_NEBULA` and `SKY_STARS` and with `HERO_SUN_ONLY`; both meshes in the scene from `attach`, with `setQuality` choosing which is visible (section 4). **Result:** at tier 0, the plain sun in every mode, gradient, events and horizon. **Proof:** A23 fail before and pass after, its mutants, T10's `D-007.spec.ts` before and after through the GPU lock, a byte comparison of tiers 1 to 4 against frames captured before the change, the `gpu` rows, and T10's A28 run read-only.

## 6. Concrete steps

PowerShell 5.1, in `C:\highsierralabs\terrain`. No `&&`. Own port 5104, own output folder. Run only one spec at a time on this GPU.

```powershell
$env:TERRAIN_PORT = '5104'

# M0
Select-String -Path plans\T00-foundation.md -Pattern '^status:'
New-Item -ItemType Directory -Force src\render\sky\dev | Out-Null
Copy-Item src\contracts\glsl\hero.glsl src\render\sky\dev\hero.v0.glsl
Copy-Item src\contracts\glsl\hero.glsl src\render\sky\dev\hero.candidate.glsl
Get-FileHash src\contracts\glsl\hero.glsl, src\render\sky\dev\hero.v0.glsl, src\render\sky\dev\hero.candidate.glsl

# Any time
npm run check:task -- T04
npx vitest run tests/unit/sky

# One browser test; prints SCREENSHOT <path> lines to open with the Read tool
npx playwright test tests/visual/sky.spec.ts --project=gpu --output=test-results/T04 -g "horizon"

# The whole spec
npx playwright test tests/visual/sky.spec.ts --project=gpu --output=test-results/T04
npx playwright test tests/visual/sky.spec.ts --project=software --output=test-results/T04-sw -g "software"

# Look at it by hand
npx vite --port 5104 --strictPort     # run in the background, then open /dev/sky.html?hero=2&palette=3

# M3 publish, only after A2, A3, A4, A7 pass on the candidate
Copy-Item src\render\sky\dev\hero.candidate.glsl src\render\sky\dev\hero.publish.tmp
Move-Item -Force src\render\sky\dev\hero.publish.tmp src\contracts\glsl\hero.glsl
npm run contracts:check

# D-007: T10's regression and A23, timing, so through the GPU lock (path in the session scratchpad)
node <scratchpad>\tools\gpu-lock.mjs T04 "npx playwright test tests/e2e/defects/D-007.spec.ts --project=software --output=test-results/T04-D007"
node <scratchpad>\tools\gpu-lock.mjs T04 "npx playwright test tests/visual/sky.spec.ts --project=software --output=test-results/T04-D-after -g ""A23 """

# Stop a leftover server
Get-NetTCPConnection -LocalPort 5104 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## 7. Validation and acceptance

`sky.spec.ts` test titles start with the A number, so `-g "A8"` selects one. Paste short output into Progress. Numbers marked [O] are from the rehearsal; a threshold marked [A] is a starting value, and changing one needs a Decision log entry and the reviewer's agreement (`Agents.md`). Every browser test also asserts no `console.warn` containing `X4000`, since the rehearsal hit `X4000: use of potentially uninitialized variable` on multi-return functions and T00's fixture would not catch that. It does not fail on `Program Info Log` as such, because the frozen `phaseAt` logs a dynamic-indexing warning there on D3D11 (DI-38).

**Same-state rows (DI-58).** A2, A6's ends, A9's same tick, A12's history check, A13's reduced row and A17 compare two renders of one state. On the `gpu` project they pass when at most 64 bytes differ and no byte by more than 1 level, and a delta over 1 fails at once. On `software` they need 0 bytes, which A22 checks. `sameStateFault` in the spec is the one place the rule lives. The reason is a platform effect: on the RTX through D3D11 the same frame flips by 1 level at 1 to 41 fixed pixels once other states have been drawn in between, and it never happened on SwiftShader [O: V1 verifier; and in this repair's final run, A6 `1>3 mix 0` read 1 byte at 1 level]. **What this gives up:** a real fault confined to 64 bytes at 1 level passes on `gpu`. It still fails A22 on `software`. Real faults on record are far larger (the mutant results below).

**Mutant controls.** `T04_MUTANT=<name>[,<name>]` makes the spec serve one fault to its pages by request interception, so nothing changes on disk and no sibling sees it. Each names the row it must fail, and every one did [O: 2026-11-05T20:22Z to 20:24Z, all exit 1]:

| Mutant | File and fault | Must fail | Result |
|---|---|---|---|
| `sunScroll` | `hero.glsl`, band scroll at `1.5 *` phase 4 | A2, A11, A22 | A2 3 of 12 states within, state 1 66,066 bytes, max 221. A11 phase 4 at 480, 109,185 bytes, max 236. A22 state 1 9,795 bytes on SwiftShader |
| `eclipseHarmonic` | `hero.glsl`, corona at `1.5 *` phase 6 | A11 | 7680, mode 1: 1,142,099 bytes, max 132 |
| `twinkleHarmonic` | `skyStars.glsl`, twinkle at `k3 + .5` | A11 | 5760, mode 0: 4,658 bytes, max 74 |
| `auroraHarmonic` | `skyEvents.glsl`, sway at `1.5 *` phase 6 | A11 | 7680, biome 4: 1,342,193 bytes, max 80 |
| `moonHarmonic` | `hero.glsl`, moon spin `18.5 *` phase 7 | A11 | 30720, mode 3: 44,739 bytes, max 255. The iso nebula row cannot see this |
| `swapEnd` | `hero.glsl`, `return A` at mix 1 | A6 | `0>2 mix 1` 1,560,968 bytes, max 253 |
| `drift` | `skyLayer.ts`, twinkle phase plus `drift += .002` per call, an accumulator | A9, A17 | A9 same tick 648 bytes, max 2. A17 1,070 bytes, max 3 |
| `reducedBolt` | `events.ts`, lightning left on under reduced motion | A13 | reduced lightning 3,080,928 bytes, max 254 |
| `evenNebula` | `skyLayer.ts`, nebula drawn on even ticks only | A12 | calls 2,1,2,1,2,1; history 1,428,498 bytes, max 26 |
| `auroraBright` | `skyEvents.glsl`, aurora L 1.5 | A13 | peak 1.204 against .8 |
| `allModes` | `hero.glsl`, `#ifdef HERO_SUN_ONLY` renamed, so tier 0 draws every mode (D-007) | A23 | see Progress, D-007 repair |
| `lateLow` | `skyLayer.ts`, tier 0's mesh added to the scene after precompile (D-007) | A23 | see Progress, D-007 repair |

```powershell
$env:TERRAIN_PORT = '5104'; $env:T04_MUTANT = 'eclipseHarmonic'; npx playwright test tests/visual/sky.spec.ts --project=gpu --output=test-results/T04-mut -g "A11 nebula"; Remove-Item Env:T04_MUTANT
```

| # | Command or action | Expected |
|---|---|---|
| A0 | `A0 live`, added at execution: the page with no `?manual`, rAF running for 600 ms | Clean console, 1920 wide, `live.png` **viewed**. Every other row runs manual, so this is the one that exercises the live loop |
| A1 | `A1 horizon` under `?floor=1`, `bend: { a: 0, c: -1.2e-5 }`, palette 0, mode 0 | At x = 300, every row from 575 to 612 has luminance at least 60% of the smaller of the means of rows 575-585 and 608-612, so no dark band exists [O: 78 to 84 down to row 604, 44 at 608]. At rows 630, 640, 660, 680 the frame matches the `?below=legacy` frame within 3 levels per channel, so nothing leaks through the floor [O: 15, 30, 21, 7 in both]. Then with `c` at 0: same. With `c` at twice the fake value: the same at rows 640, 660, 680 only, because §6.3's fade then ends at row 633.7, 631.0 and 638.4 at `camY` 7, 5.6 and 9.8, so row 630 is inside it by design [arithmetic; O: row 630 differs by up to 9 channel levels at `camY` 7 and 30 at 9.8, rows 640 and down by 0]. Run each `c` at `camY` 7, and at `o.sim.y` 2 and 14, which give `camY` 5.6 and 9.8 (§6.1, §8.1). By §6.3's formula `gb` is then -.0204 and -.0257, just under crests at -.0164 and -.0217 [arithmetic] |
| A1n | Same with `?below=legacy` | Must fail the dark-band check [O: 82 at row 586, then 1 to 2 at rows 590 to 604]. A test that asserts the failing shape, so the detector is proven |
| A2 | `A2 mode zero` | `?verbatim=1` against the default page, 12 states (palettes 0, 5, 4 x ticks 0, 123, 600, 4097), `post=off`, nebula and events included, compared byte by byte across the two pages: within DI-58 in every state [O: 12 of 12 at 0 bytes]. Also frames with `heroB != heroA` at mix 0 match frames with `heroB == heroA` within DI-58 [O: 0 bytes], so T01's "B holds the next zone at mix 0" is ignored. Mutant `sunScroll` fails it |
| A2n | Mode 0 against mode 1, same state | Over 1,000,000 differing bytes, and rejected by the DI-58 check [O: 1,541,582, max 255], so A2 can fail. Modes 2 and 3 likewise [O: 1,560,968; 1,500,915] |
| A3 | `A3 geometry` under FOV 58 and 68, `?iso=hero` | Mode 0 first lit row at x = 960 is 262 +/- 3, and 312 +/- 3 at FOV 68. Modes 1 and 3: rim peak at the same rows. Mode 2: body top 331 +/- 4, and 369 +/- 4 at FOV 68 [arithmetic, section 2] |
| A4 | `A4 sheets`, 4 modes x 6 palettes, everything on, stand-in stack | Writes `mode0..3.png` (3x2 sheets, 640x360 cells, box-filtered from `pixels()`), `crop0..3.png` (1:1 crops `[640, 180, 640, 360]`), and `sheet-metrics.json`. Near-white (min channel above 235) at most 0.5% in every combination [O: at most .06% on the other 23 combinations with the old table, and 0% on Arctic Laser mode 0 at `#D8F6FF`]. Mean chroma at least 55, at the fake world's bend, `c = -1.2e-5` [O: minimum 56.1 over six ticks, Toxic Arcade mode 2, on these sky-only frames under §6.3's horizon rule. The 62.4 first recorded here was the rehearsal's default wide fade, `below=1`. At `c = 0` the same combination reads 53.3, because near-black starts about 17 rows higher, so this row must not run flat]. **Open all 8 images** |
| A5 | `A5 fog join`, `?floor=1`, 6 palettes, no bend then full bend, FOV 58 and 68 | Saved and **viewed**. Numeric: at x = 300, the fully fogged floor row, radial distance at least 4300, matches the last sky row, two rows above it, within 12/255 per channel at `c = 0` [A; O: at most 3 on six palettes]. Only one row qualifies: row 590 at FOV 58, row 581 at FOV 68 [arithmetic]. The next row down is not fully fogged and reads 34 to 41 off [O] |
| A6 | `A6 wipe`, pairs (0, 2), (1, 3), (2, 0), mix 0, .3, .45, .5, .55, .7, 1 | Mix 0 equals pure A, and mix 1 equals pure B, within DI-58 under `post=off` [O: 0 bytes at five ends, and `1>3 mix 0` 1 byte at 1 level in the final run]. Mutant `swapEnd` fails it. Adjacent frames at the production rate, mix .5 and .5 + 1/1200, under `post=off`: maximum byte delta at most 8 [A; O: 7 on a stand-in page, DI-44]. **The last step too:** mix `1 - 1/1200` against 1 at FOV 58 and FOV 68, maximum byte delta at most 8 [O: 1 on the stand-in; the old wipe gave 36 over 117,223 bytes, a visible pop]. Print the same pair at 390x844, since a portrait view sees higher `v`. DevPost figures printed. Sheets **viewed**. **Added at execution, from the review's note on chrome-orb reflections:** `sunDisc` over the whole sphere (1024x512, `discStep`), first and last production steps: at most 8 levels of 8-bit sRGB on black, the worst case for a reflection, and the 3 further pairs (3, 1), (0, 1), (1, 0). The last tenth is printed [O: before the fix 255 levels, on 2.2% of directions; after it 1.7] |
| A7 | `A7 finite probe`: `devHarness` renders the sky at 1080p and `sunDisc` over a 512x512 grid of `rd` across the whole sphere (`yScale` 1 and .55) into an RGBA32F target, reads with `readRenderTargetPixels`, all 4 modes and 3 mode pairs at mix .5 | Every component finite. `sunDisc` rgb at least -1e-4, alpha in `[-1e-4, 1 + 1e-4]`. A NaN here would spread across the screen through bloom |
| A7n | `?nan=1`, which injects `sqrt(-1. - uPal[0].r)` on one row. The operand must not be constant: a literal `sqrt(-1.)` folds to 0 in the translator with no warning, and the probe then reports nothing [O: 0 non-finite, D3D11 and SwiftShader] | Probe reports non-finite pixels, so it can fail [O: 5,760 components on one 1920-pixel row, on both] |
| A8 | `A8 star motion`, `?iso=stars`, `post=off`, tracked isolated stars, tick held fixed, 40 frames at .17 px per frame (1.745e-4 rad, at 974.2 px per radian) through `feel.shakeY`, then through `feel.shakeX` | At least 100 stars tracked [O: 225]. Motion-compensated 15x15 flux CV p95 at most .20 [A; O: .125 and .131]. Peak CV p95 at most .05 [A; O: .008] |
| A8n | Same with `?naive=1` | Flux CV p95 at least .40 [O: .734 and .468], so the gate can fail |
| A9 | `A9 star still` | Same tick twice: within DI-58 [O: 0 bytes]. Mutant `drift` fails it. Frames 1/60 s apart with twinkle: max byte delta at most 3 [arithmetic: about .8 per frame]. Reduced motion: at most 1. FOV sweep 58 to 66 in 8 frames and roll sweep +/-.02: filmstrip of a 160x90 crop at 4x, nearest neighbour, **viewed** for popping, tearing or dashes. Mode strip, 8 frames 1 s apart per mode, **viewed** |
| A10 | `A10 banding`, `?iso=gradient`, 6 palettes, stand-in stack, x 64 to 320, rows 0 to 240 | For each channel spanning at least 8 levels: value changes per level at least 1.3 [A; O: minimum 1.35, typical 2 to 5]. Range-stretched crops `[0, 0, 640, 300]` of all six palettes in one sheet **viewed**: grain, with no contour lines |
| A10n | Same with `?post=off` | Exactly 1.00 changes per level in every such channel [O: 1.00 in all], and the stretched crop shows hard contours [O: green steps across the whole crop on Ultraviolet]. The row-mean metric was tried and rejected, because curved bands average out [O] |
| A11 | `A11 nebula`, `?iso=nebula` at +4x gain, and full frame | **Viewed** for block or diamond upsampling. Iso nebula, phase-7 wrap (tick 30719, alpha .999, against tick 30720): at most 8 differing bytes, each by at most 1 [O: 5 bytes]. **Full sky, all four modes, biomes 0 and 4, across the wrap of every phase the sky reads** (V1 review; the old bar wrap crossed only phases 0 and 1, which the sky never reads): phase 4 (band scroll), 5 (twinkle, aurora rays), 6 (corona, aurora sway), 7 (planet, moon, nebula). Each wrap is the first multiple of its period with no meteor or strike active either side in biome 0 or 4, found in Node from `writeSkyEvents`: 480, 5760, 7680 and 30720 for the default seed, since 1920 and 3840 have a meteor on channel 1. Pair `tick - 1` at alpha .999 against `tick`: max delta at most 1 in all 32 pairs [O: max 1, at most 297 bytes]. Many bytes move by 1 because the frame moves .001 tick, so the bound is on level. Mutants `sunScroll`, `twinkleHarmonic`, `eclipseHarmonic`, `auroraHarmonic` and `moonHarmonic` fail it, each at its own phase |
| A11n | `A11n`: a sky-wide `.05 * fract(1.5 * phaseAt(k))` added to `sky.frag.glsl` by request interception, for k 4 to 7 in turn | Each A11 pair pops, max over 1, exactly where its tick is a multiple of phase k's period, and stays at most 1 elsewhere [O: 6,056,639 to 6,056,677 bytes, max 7 where it crosses; at most 311 bytes, max 1 where not]. So each pair crosses the wraps it claims, and the check can fail |
| A12 | `A12 tiers`, `?post=off` so composer draws do not mask the count: `setTier` 3, 2, 1, 0, 1, 3 | `nebulaSize` 384x192, 192x96, unchanged at tiers 1 and 0, 384x192 again at 3. `stats().calls` is 2 at tiers 3 and 2, and 1 at tiers 1 and 0. `stats().programs` after the first full cycle stays constant on a second cycle, and a `gl.linkProgram` spy reads 0 further links, because `programs` alone does not show a recompile (§6.6). All frames non-blank. **Every frame draws the nebula** (V1 review: A11's pairs jump the camera, so a rebuild redrew it there): ticks 600 to 605 with the camera held, so no rebuild, read 2 calls each at tiers 3 and 2 [O: 2 at all twelve]. Tick 601 after tick 600 against after tick 9000: within DI-58 [O: 0 bytes]. Mutant `evenNebula` fails both |
| A13 | `A13 events`: ticks found by scanning `writeSkyEvents` in Node | Meteor sheet (6 palettes), aurora sheet (biome 4, 6 palettes, modes 0 to 3), lightning sheet (biome 3, 6 palettes, both strobes), all **viewed**. Near-white at most .5% [O: at most .01%]. Aurora: biome 4 against biome 0 differs by over 100,000 bytes. Both comparisons below hold one tick, since disc scroll and nebula differ between any two ticks [O: 512,219 bytes at 120 ticks apart with no event active]. Lightning: biome 3 against biome 0 at a strike tick differs by over 100,000 bytes. **Under `reducedMotion`, biome 3 against biome 0 at the same strike tick: within DI-58,** the bolt being off and neither biome having aurora [O: 0 bytes]; the same pair with motion on is rejected [O: 3,117,723 bytes], and mutant `reducedBolt` fails it. **Aurora luminance** (V1 review, and the condition on the aurora ruling): `?iso=nostars&post=off`, biome 4 against biome 0 at tick 600, which the spec checks has no meteor, each frame rendered again into an RGBA32F target so no channel clips. Over pixels the aurora lifts by more than .01, peak linear luminance at most .8, §6.7's sky budget, on all six palettes, with over 50,000 such pixels [O: .278 to .318 over 323,051 pixels; aurora alone adds at most .234]. Stars are compiled out so a star in a curtain does not count. Mutant `auroraBright` fails it [O: 1.204]. `bolts-1to1.png` crops follow each bolt's mean x |
| A14 | `npx vitest run tests/unit/sky` | All pass, none skipped. `events.test.ts`: same inputs same outputs, any call order. Identical at `tick` and `tick + 30720 * 2^30`. Over a full cycle at 120 Hz: meteors present and never active at a slot's last 20%; flash rising edges at most 2 in any 120-tick window; `boltK` 0 at weight 0 and under `reduced`; `metK` 0 under `reduced`, and continuous as `biomeMix` ramps. `out` arrays keep their identity. `nightFactor` equal at `dayPhase` 0 and just under 1, within 1e-6. `metrics.test.ts`: a synthetic staircase gives 1.00 changes per level, a dithered one over 1.3; a stable synthetic star under .05 CV, a flickering one over .4. `glsl.test.ts`: frozen lines verbatim in `hero.glsl`; no `uniform` in it; all top-level functions `sunDisc` or `hero*`; no `if (...) return` in `skyStars.glsl` or `skyEvents.glsl`; `index.ts` and `skyLayer.ts` import nothing from `./dev/`. `events.test.ts` also keeps every bolt within `|x| <= BOLT_X_MAX`, .9, over 200 seeds, with at most 1% of strikes reaching inside `|x| < .215` [A]. It failed before the cap [O: `expected 1.5329667329788208 to be less than or equal to 0.900001`] |
| A15 | `A15 viewports`: 2560x1080 at FOV 68 (21:9), 390x844 portrait, 1920x1080 at roll .05 | Saved and **viewed**. No streaks at the nebula domain edge. Disc centred. Stars round |
| A16 | `A16 dpr`, context with `deviceScaleFactor: 2`, `?tier=4` | `stats().height` is 1440 per the §6.10 formula (max pixels caps DPR at 1.33), so `uStarPx` is 1.33. Star count within 5% of tier 3, radii about a third larger in buffer pixels, **viewed** |
| A17 | `A17 restore`: frame, `forceContextLoss`, wait for the event, **yield 50 ms**, `forceContextRestore`, wait, `__shell.rebuild()`, same frame, `post=off` | Within DI-58, compared byte by byte [O: 0 bytes]. Mutant `drift` fails it. This frame cannot show the nebula re-bake, because `frame` redraws the nebula at tier 3 [O: 0 bytes with no re-bake]. Second case, nebula off: restore at tier 1, `__shell.rebuild()`, one frame, then `setTier(3)` and one frame: 0 further `gl.linkProgram` calls [O: 0]. Fails if `rebuild`'s nebula draw is removed [O: 1 link] |
| A18 | `A18 software`, `--project=software`, `?tier=0&post=off` | Renderer contains SwiftShader, page non-blank, shot **viewed**: disc, gradient and stars with no tearing [O: clean at 640x360]. `frameAt` p50 at most 25 ms [A; O: 16.9 p50, 20.2 p95, sky alone] |
| A19 | `A19 timing`, 300 frames in a tight loop, tier 3, stand-in stack | Reports p50 and p95. Fails only above 3 ms [A; O: p50 .6 to .9, p95 .8 to 1.2 including the composer]. Indicative only: siblings share this GPU, and T09 owns the 2 ms gate. Nebula on against off was indistinguishable at this resolution [O] |
| A20 | `npm run check:task -- T04` | Exit 0, `check:task T04 PASS`, non-zero counts on every gate. After the batch, `npm run check` exit 0 |
| A21 | `npm run glsl:check` and `npm run contracts:check` | Exit 0, `hero.glsl` signature lines present |
| A23 | `A23 tier 0`, added for D-007, `--project=software`, 640x360, `post=off` | Against the control, tier 0 drawn with the program of tiers 1 to 4 (`?tier0=full`): mode 0 at tier 0 equals the control with stars compiled out (`iso=nostars`) at 0 bytes in two states (palette 0 tick 600, palette 4 tick 4097), and differs from the control with stars by more than 0 bytes. Modes 1, 2, 3 and a wipe 1 to 2 at mix .5 equal mode 0 at 0 bytes. In the control, modes 1 to 3 differ from mode 0 by over 100,000 bytes, so the equalities can fail. The sky alone at tier 0, `frameAt` p50 of 60 frames, is below the control's. A switch from tier 3 to tier 0 and back links no more programs than the control's switch, and draws 1 call at tier 0 and 2 at tier 3. Before the fix: exit 1, `A23 mode 0 state 0: 9636 bytes, max 216` [O]. Mutants `allModes` (the block ignored) and `lateLow` (tier 0's mesh added after precompile) must fail it |
| A23v | `A23v tier 0 sheets`, both projects | `tier0-modes.png` and `tier0-before.png`, the four modes at tier 0 on palette 0, shipped and as before. **Viewed**: the shipped sheet shows one sun in all four cells, a gradient, no stars |
| A22 | `A22 same state`, `--project=software`, 640x360: A2's 12 states and heroB, A6's six ends, A13's reduced row, A9's same tick, A17's restore, through the same helpers as the `gpu` rows | 0 bytes each, DI-58's software bound, on a SwiftShader renderer string. Mode 0 against mode 1 is rejected there too, so the comparison can fail [O: all 0; 171,126 bytes]. Mutant `sunScroll` fails it |

**Blank-shot guard.** One rehearsal `page.screenshot` came back fully black with no other symptom, cause not established [O]. Sheets are therefore built from `pixels()`, and any `saveShot` is preceded by a check that the frame's mean luminance is above 1/255.

**The review.** "Viewed" means the executor opens the PNG with the Read tool and writes what it saw into Progress. Passing numbers do not replace this. Reject and iterate on any of these:

| View | What to reject |
|---|---|
| `mode0` to `mode3` | Disc position or size shifting between cells. A mode that reads as a different object at a glance across palettes in a bad way: muddy ring colour, grey fill, a body lost against the horizon glow. Anything clipped to flat white. Wash-out of the sky gradient. A palette where the mode does not read at thumbnail size |
| `crop0` to `crop3`, 1:1 | Jagged edges, aliased band edges, wire lines breaking into dots, a visible seam from `atan`, stair-stepped rings, black or dead pixels, a hard halo edge |
| Mode strips over time | Pops, crawling wire lines, ring bands jumping, corona streamers strobing, band scroll jitter |
| Wipe sheets | A hard edge, a frame where both discs look broken, halo jumping |
| Fog join | A dark or bright line at the horizon. Far floor distinct from the sky at `c = 0`. Reflection unreadable in any mode |
| Star crops and filmstrips | Dashes, square stars, stars clipped at cell edges, a visible grid, stars brighter than the disc's rim, flicker between frames |
| Nebula | Blotches competing with the gradient, block structure, colour that fights the palette (the first rehearsal at L .085 did this on Ember, with brown clouds; .04 was much better [O]) |
| Banding crops | Contour lines through the grain |
| Events | Aurora base too hard, curtains too bright against the sky budget, meteors too thick, bolt looking like a rendered polyline at 1080p, bolt crossing the disc |

**Human checks.** They do not block `done`. Outcomes reports them as not verified, and T11's operator pack collects them (`Agents.md`).

- **HC1.** Whether the sky is beautiful, in all modes and palettes, through the operator's contact sheet at T11 (§14 risk 2).
- **HC2.** The sky on any GPU but the RTX and SwiftShader, phones included. The D3D11 derivative failure in section 10 shows driver behaviour matters here (§14 risk 1).
- **HC3.** Sky frame cost on a mid-range GPU (§14 risk 1).
- **HC4.** Whether meteor and strike rates feel right in real time.
- **HC5.** Photosensitivity. The limits here are engineering bounds, and only a person can assess the result.

## 8. Idempotence and recovery

- Every test, gate and metric is safe to re-run. Specs write only under `test-results/T04*`.
- `Copy-Item` from `hero.v0.glsl` is the way back to a known good `hero.glsl`, and it restores mode 0 byte for byte. If `hero.v0.glsl` is gone, §8.2 holds the text.
- A stray `hero.publish.tmp` is harmless, since Vite serves only imported files. Delete it. Never leave `hero.glsl` absent: siblings' imports would fail.
- No git here. Copy a shader outside the project before a risky rewrite.
- Clean state for owned paths: delete `src/render/sky/`, `dev/sky.html`, `tests/visual/sky.spec.ts`, `tests/unit/sky/`, then restore `hero.glsl` from §8.2 through `node scripts/contracts-check.ts --extract` after deleting that one file. `--extract` never overwrites.
- Never touch `src/contracts/glsl/common*.glsl`, `src/testing/**` or palette values. File a request instead.

## 9. Progress

- [x] 2026-11-05T06:27Z Plan drafted. A throwaway rehearsal ran in the scratchpad; no project file exists for this task except this plan.
- [x] 2026-11-05T14:50Z M0 Preconditions. `plans/T00-foundation.md` status `done`. `hero.glsl`, `hero.v0.glsl`, `hero.candidate.glsl` all `47d84b60...`. Read `devShell.ts` and `scriptedFrame.ts`: the seam table holds, except that a still must pin `zone.dayPhase`, because the fake world derives it from the camera (section 10).
- [x] 2026-11-05T14:59Z M1 Skeleton and horizon. A1 at all three `c` and all three heights: `c -1.2e-5 camY 7: low 43.4 at row 612, limit 26.3; deep rows differ by at most 0`. Thinnest `c -2.4e-5 camY 5.6: low 43.6, limit 42.8`. A1n `low 1.2 at row 590, limit 17.1`. `horizon.png` **viewed**: no dark band under the crest at either height, no bend or twice the bend; the disc's bands continue into the column.
- [x] 2026-11-05T15:02Z M2 and first M3 publish, on all of M4 to M6, since A4 needs everything on (decision log). 24 combinations **viewed** in `mode0..3`, `crop0..3` and an added `low0..3`. Saw and rejected on first sight: a grey ring fill on Sunset Drive, grey nebula smudges left of the disc on Toxic Arcade and Arctic Laser. Both fixed before publishing.
- [x] 2026-11-05T15:02Z M3 first publish, `da53631f...`. `contracts:check PASS, 7 files`, `glsl:check 0 hits`, A2 12 of 12.
- [x] 2026-11-05T15:02Z M4 Stars, read from the images' file times. A8 `pitch stars 225, flux p95 .125, peak p95 .0067; yaw stars 225, flux p95 .130, peak p95 .0069`. A8n `flux p95 .734, .468`. A9 `same tick 0 bytes; 1/60 s max 1; reduced motion max 1`. `stars-fov.png`, `stars-roll.png` at 4x **viewed**: round dots, a few plus-shaped at the smallest radius, no dashes, tearing or popping. `stars-1to1.png` **viewed**: fine random dots, denser toward the horizon, no grid. Strips **viewed**: bands scroll evenly, wires and rings hold, corona streamers drift slowly, no pop.
- [x] 2026-11-05T15:03Z M5 Nebula, read from the images' file times. A11 `phase-7 wrap 5 bytes, max 1; bar wrap at tick 287, 96 bytes, max 1`. A12 `384x192, 192x96, 192x96, 192x96, 192x96, 384x192; calls 2 2 1 1 1 2; links 0`; hidden `calls 0`, then `2`; dispose frees the geometry. `nebula-iso`, `nebula-iso-1to1` **viewed**: soft at 5x upsample, no block or diamond structure. `nebula-corner` **viewed**: Ember's top right still reads dim brown (section 13).
- [x] 2026-11-05T15:12Z M6 Events. Rejected and reworked after viewing: bolt read as a polyline; aurora crossed grey; flash went brown on Ember. Second publish `bfb3eb39...` with the wipe's end fix. A13 `aurora 961093 bytes; lightning 3114683 bytes; reduced lightning 0 bytes; worst near-white .010%`. `meteors`, `meteors-2x`, `aurora`, `aurora-1to1`, `aurora-zoom`, `lightning`, `bolts-1to1` **viewed**: thin bright streaks with a tail, soft curtains in palette hues, a jagged bolt ending at the horizon, and the flash in the sky's own hue.
- [x] 2026-11-05T15:16Z Third publish `6ad47d07...`, the eclipse corona bound, after a 4x crop showed a contour on Arctic Laser and Toxic Arcade. A2, A3, A4, A7 re-run on the candidate first.
- [x] 2026-11-05T15:16Z A17 negative control, on my own `skyLayer.ts`, restored straight after: with `rebuild`'s draw removed, `A17 tier 1 restore, then tier 3: 1 further links`, red. Restored: `0 further links`.
- [x] 2026-11-05T15:17Z M8 `hero.candidate.glsl` deleted. `dev/sky.html` uses a variable specifier, so the page does not depend on it.
- [x] 2026-11-05T15:27Z M7 Banding and photometry, final text. A10, six palettes, levels then changes per level per channel, stand-in stack:

  ```
  Sunset Drive: 21.4L 3.84 | 1.0L 22.16 | 35.9L 2.32
  Miami Dusk: 47.9L 1.85 | 0.0L 0.00 | 72.2L 1.34
  Ultraviolet: 17.2L 4.70 | 2.0L 37.11 | 34.5L 2.43
  Toxic Arcade: 1.0L 5.82 | 22.5L 3.66 | 16.1L 5.02
  Ember: 31.8L 2.59 | 0.4L 2.29 | 19.0L 4.26
  Arctic Laser: 1.0L 22.30 | 23.3L 3.52 | 45.7L 1.91
  ```

  Worst on a channel over 8 levels: 1.34, against the limit of 1.3. A10n reads exactly 1.00 in every channel over 8 levels. `stretch-dither.png` **viewed**: grain, no contours. `stretch-nodither.png` **viewed**: hard contours. A4 `worst near-white .010% (Miami Dusk mode 3 tick 600); worst chroma 58.5 (Toxic Arcade mode 1 tick 3000), 144 frames`.
- [x] 2026-11-05T15:23Z M8 Whole-layer review. Final images **viewed**, on the shipped text:
  - `mode0`: same disc in all six, bands in the lower half, no shift between cells. Pale discs on Ultraviolet, Toxic Arcade and Arctic Laser still read as suns.
  - `mode1`: gold or white ring on a near-black disc, streamers read in all six. Toxic Arcade and Arctic Laser are quieter near the horizon by design.
  - `mode2`: solid saturated rings, striped body. The body's bottom is low contrast against the horizon glow on Sunset Drive and Ember, and still reads as a sphere. Accepted, for T11 to judge.
  - `mode3`: wire sphere with a bright rim in all six, lines continuous at 1:1, no dots, pole visible at the bottom.
  - `crop` and `low`: no jagged edges, no `atan` seam, no dead pixels.
  - `wipe-0-2`, `wipe-1-3`, `wipe-2-0`: a soft band rising, exact at both ends. At mix .45 to .55 the two discs overlap in the band, which reads as a transition and not a break.
  - `join-*`: horizon joins, far floor melts into the sky at no bend, no bright or dark line. All four reflections read. The grid's centre line shows small kinks, from `devFloor`'s long thin triangles [I], not from the sky.
  - `view-21x9`: disc centred, clouds to the edge, no streaks. `view-portrait`: disc wide but whole, stars round. `view-roll`: horizon and bands tilt together.
  - `dpr-tier4`: same field at higher density of pixels, dots round. `software.png`: disc, gradient, stars, no tearing, harsh because `post=off` shows linear values raw. `live.png`: Toxic Arcade planet, correct.
- [x] 2026-11-05T15:27Z Final runs. A0 to A17 `22 passed, 1 skipped` (A18 on `gpu`), at 15:27Z. A18 on `software`: `p50 14.9 ms, p95 18.2 ms`, SwiftShader, at 15:23Z. A19 through the GPU lock: `p50 1.00 ms, p95 1.70 ms`, indicative, siblings were active on this GPU, at 15:17Z. A14 41 passed. `check:task T04 PASS`, `tsc: 12 owned files, 2 configs, 0 problems`, `eslint: 12 owned files, 0 errors, 0 warnings`, `vitest: 3 owned files, exit 0`, `glsl: 22 owned files scanned, 0 hits`.
- [x] 2026-11-05T15:24Z Comment-only republish of `hero.glsl`, `512f9793...`, so its text states only what was measured. The 15:27Z run above is after it. A18 and A19 ran before it, on the same code.

- [x] 2026-11-05T20:11Z Repair after V1-T04 started. `status: in-progress`. sha256 of all 23 owned files recorded in the session scratchpad (`T04/hashes-start.txt`).
- [x] 2026-11-05T20:13Z Bolt cap, failing first. The new `events.test.ts` row, run against the old schedule: exit 1, `expected 1.5329667329788208 to be less than or equal to 0.900001`. After the cap: `Tests 42 passed (42)`, exit 0. Scratch scan over 400 seeds: `bolts 3455: outer beyond .99 0 (0.0%), wholly beyond .99 0 (0.0%), inner under .215 8 (0.23%)`, against `1487 (43.0%)`, `872 (25.2%)` and `4 (0.12%)` before.
- [x] 2026-11-05T20:20Z DI-63 comment republish through M3. Candidate, `-g "A2 mode|A3 |A4 |A7 "`: 4 passed, `A2 12 of 12 states within DI-58`, A3 within 2 rows, `A4 worst near-white 0.010%; worst chroma 58.5`, A7 0 non-finite. `glsl.test.ts` 17 passed with the candidate included. `Move-Item` publish, `37cb8804...`, LF, no BOM. `contracts:check PASS, 7 files`. A2 and A3 again on the published text: 2 passed. Candidate deleted.
- [x] 2026-11-05T20:21Z First full `gpu` run of the repaired spec, A19 excluded: exit 0, 23 passed, 2 skipped (A18 and A22 are software-only).
- [x] 2026-11-05T20:24Z Mutant controls, all exit 1 on the rows they name (table in section 7). `auroraBright` first read only .837 against .8 on 8-bit pixels, so the aurora bound moved to a float target, and then read 1.204 (20:25Z).
- [x] 2026-11-05T20:26Z Final runs on the finished code. `gpu`, `--grep-invert A19`, `--output=test-results/T04-R1`: exit 0, 23 passed, 2 skipped. `A2 12 of 12 states within DI-58`; A6 ends `0 bytes` except `1>3 mix 0: 1 bytes, max 1`; `A9 same tick 0 bytes`; A11 wraps at 480, 5760, 7680, 30720 all max 1; A11n as in its row; `A12 every frame {"tier 3":[2,2,2,2,2,2],"tier 2":[2,2,2,2,2,2]}; tick 601 after 600 against after 9000: 0 bytes`; `A13 reduced lightning 0 bytes`, aurora peak .278 to .318; `A17 tier 3: 0 bytes`. `software`, `-g "A18|A22"`: exit 0, 2 passed, `A18 p50 15.3 ms, p95 20.1 ms`, A22 every comparison 0 bytes at 640x360 on SwiftShader. A19 through the GPU lock: exit 0, `p50 0.70 ms, p95 1.20 ms`, indicative only, since siblings may have had non-timing GPU work running.
- [x] 2026-11-05T20:27Z Images from the repaired rows **viewed**, from `test-results/T04-R1`:
  - `lightning.png`: a jagged bolt ending at the horizon in all six cells, including Miami Dusk strobe 2, which showed none before. Ember's strikes on the left of the disc.
  - `bolts-1to1.png`: every crop holds its bolt, labelled x .69, .83, .57, .41: jagged, soft glow, ends at the horizon. Before, two of four crops were empty.
  - `aurora.png`, `aurora-1to1.png`, `aurora-zoom.png`: soft curtains with a wavy base in teal or pink, not blooming, under the disc's brightness. Ember's bars still ochre (DI-66, T11).
  - `meteors.png`, `meteors-2x.png`: thin tapering streaks; Arctic Laser's tail hidden by the disc. Unchanged.
  - `nebula-iso.png`, `nebula-iso-1to1.png`, `nebula-full.png`, `nebula-corner.png`: soft clouds, no block or diamond structure. Ember's top right still brown (DI-66).
  - `stars-fov.png`, `stars-roll.png`, `stars-1to1.png`: round or plus dots at 4x, no dashes or tearing; fine dots at 1:1. The empty ninth cell is the transparent canvas.
  - `strip0` to `strip3`: bands step evenly second to second, corona and planet bands drift slowly, wires stay continuous. No pop.
  - `wipe-0-2`, `wipe-1-3`, `wipe-2-0`: a soft rising band, mix .9 and 1 identical, both discs whole at .45 to .55.
- [x] 2026-11-05T20:28Z `npm run check:task -- T04`: exit 0 (pasted in Outcomes).

Remaining: A20's second half, whole-repo `npm run check`, and `test:browser`, which the T00 owner runs after the batch and which have not run in this repair.

**D-007 repair (T10 round 1).** Timing on this machine is contaminated by five other owners, so every cost below is a delta inside one run: the sky's share is `all` minus `no sky` from the same page, with `all` the mean of the first and last `all` reads.

- [x] 2026-11-06T01:34Z Reopened, `status: in-progress`. sha256 of the 22 owned files recorded, and the files copied, in the session scratchpad (`T04/d007/hashes-start.txt`, `T04/d007/backup/`). `hero.glsl` reads `37cb8804...`, the V2-verified text.
- [x] 2026-11-06T01:42Z to 01:49Z Fail before, T10's regression, unchanged code, through the GPU lock: `npx playwright test tests/e2e/defects/D-007.spec.ts --project=software --output=test-results/T04-D007`, exit 1, `expect(received).toBeLessThanOrEqual(expected)`. `all {"p50":61.9,"p95":66.8,"calls":28}`, `no sky {"p50":56.8,"p95":66.6}`, `all again {"p50":63.0,"p95":70.2}`: sky share p50 5.7 ms, p95 1.9 ms.
- [x] 2026-11-06T01:45Z to 01:49Z, same lock hold: a scratch probe (`T04/d007/probe/cuts.spec.ts`, not acceptance) on the app at tier 0, serving edited `sky.frag.glsl` text to its own page only, so nothing on disk changed. Sky share p50 / p95 in ms: unchanged 15.9 / 18.3; sun only 7.9 / 7.6; sun and no nebula 4.1 / 6.8; sun, no nebula, no stars 2.0 / 5.5; sun, no nebula, no events 1.6 / 0.4; all four cut -1.4 / -1.6 (noise); unchanged again 14.0 / 18.5. So the four-mode disc is about half the sky's software cost, and nebula sampling, stars and events about 2 to 4 ms each.
- [x] 2026-11-06T01:58Z to 02:02Z Second baseline, same command to `test-results/T04-D007-base2`: exit 1, `all {"p50":68.9,"p95":81.7}`, `no sky {"p50":56.3,"p95":62.8}`, `all again {"p50":62.6,"p95":68.7}`: sky share p50 9.5 ms, p95 12.4 ms. In the same hold, a scratch capture (`probe/frames.spec.ts`) saved the unchanged sky's frames under `post=off`: 60 on `software` at tiers 3, 1 and 0, 35 on `gpu` at tiers 4 to 1, for a byte comparison after the change.
- [x] 2026-11-06T02:02Z M3 step 2 on the candidate (`HERO_SUN_ONLY` block in `sunDisc`, nothing else changed): `npx vitest run tests/unit/sky/glsl.test.ts`, `Tests 17 passed (17)`, exit 0, candidate included.
- [x] 2026-11-06T02:14Z Fail before, my new row, unchanged layer, through the lock: `-g "A23|A18"` on `software`, exit 1, `A23 mode 0 state 0: 9636 bytes, max 216` (the stars). A18 passed, `p50 16.0, p95 19.4` ms. The spec's `HERO_QUERY` held `candidate: 1` during this run, for the M3 rows below; without the define the candidate compiles to the published program.
- [x] 2026-11-06T02:14Z M3 step 1 on the candidate, `gpu`, `-g "A2 mode|A3 |A4 |A7 "`: exit 0, 4 passed. `A2 12 of 12 states within DI-58, bytes 0/0` in all 12, heroB 0 bytes; A3 passed; `A4 worst near-white 0.010% (Miami Dusk mode 3 tick 600); worst chroma 58.5 (Toxic Arcade mode 1 tick 3000)`, the same as V2; A7 0 non-finite in all 7 cases.
- [x] 2026-11-06T02:15Z M3 steps 3 to 5. `Copy-Item` to `hero.publish.tmp`, `Move-Item -Force` over `hero.glsl`: `965aa472...` on both, no tmp left. `HERO_QUERY` cleared. `contracts:check PASS, 7 files`, `hero.glsl: 3 signature lines checked, present in order`, exit 0. A2 and A3 on the published text: exit 0, 2 passed, A2 12 of 12 at 0 bytes. No material defined `HERO_SUN_ONLY` until the next step, so the publish changed no sibling's frame.
- [x] 2026-11-06T02:15Z Layer installed: `skyMaterial.ts` (`createSkyUniforms`, `createSkyMaterial(..., tier0)`, `fullAtTier0`), `skyLayer.ts` (two sky meshes, one visible), `dev/sky.html` (`?tier0=full`). `hero.candidate.glsl` deleted. `npm run check:task -- T04`: exit 0, `tsc: 12 owned files, 2 configs, 0 problems`, `eslint: 12 owned files, 0 errors, 0 warnings`, `vitest: 3 owned files, exit 0` (42 passed), `glsl: 22 owned files scanned, 0 hits`, `check:task T04 PASS`.
- [x] 2026-11-06T02:16Z to 02:22Z After, through the lock. `software -g "A23|A18|A22"`: A22 passed (`A2 bytes 0` in all 12, `A2n mode 1: 171126 bytes`, the same as V2); A18 passed, `p50 6.3, p95 7.3` ms against 16.0 and 19.4 before; A23v passed. **A23 failed on its link check only**: `tier 3 to 0 and back: 1 links, control 0`. Every pixel row passed: control modes 1 to 3 against mode 0 172,322, 175,232, 167,119 bytes; mode 0 against the control without stars 0 bytes in both states, against the control with stars 9,636 bytes; modes 1 to 3 and the wipe against mode 0 0 bytes; `sky alone at tier 0, frameAt p50: 6.6 ms, control 15.8 ms`. The link was the row's own fault (section 10): under `post=off` DevPost draws to the canvas while precompile compiled for the composer's target, so every scene program links at its first draw, and the control's main program had already drawn. The link check now runs with post on, as the app does.
- [x] 2026-11-06T02:16Z to 02:22Z, same hold. **T10's regression after:** `D-007.spec.ts` to `test-results/T04-D007-after1`, exit 1 (terrain and props unchanged): `all {"p50":55.5,"p95":58.8}`, `no sky {"p50":53.2,"p95":59.0}`, `all again {"p50":52.5,"p95":59.2}`: sky share p50 0.8 ms, p95 0.0 ms, against 5.7 / 1.9 and 9.5 / 12.4 in the two baselines. **Tiers 1 to 4 unchanged:** the scratch capture again (`after`) against `before`, byte for byte: 0 differing bytes in all 35 `gpu` frames (tiers 4, 3, 2, 1, at 1920x1080, 1920x1080, 1600x900, 1280x720) and all 40 `software` frames at tiers 3 and 1. At tier 0 on `software`, mode 0 differs by 9,627 to 9,680 bytes (the stars) and modes 1 to 3 by 144,651 to 180,590 (the sun), as intended.
- [x] 2026-11-06T02:23Z Images **viewed**. `tier0-modes.png` (shipped tier 0, palette 0, post on): four identical cells, a yellow-to-pink banded sun half sunk at a clean horizon line, deep purple sky over a hot pink horizon glow, soft magenta halo, no stars, no stray pixels. `tier0-before.png` (the control): the same sky with a dense white starfield, and the eclipse with streamers, the ringed planet and the wire moon. Tier 0 still reads at a glance; the lost starfield is the largest visible change. `software.png` (A18, post off, linear raw): a bright banded disc with clean edges over a red horizon band, no stars, no tearing.
- [x] 2026-11-06T02:23Z to 02:28Z Through the lock. **A23 passes** on the corrected row, `software -g "A23 "`, exit 0, 1 passed: every pixel line as at 02:22Z, `sky alone at tier 0, frameAt p50: 5.1 ms, control 16.2 ms`, `tier 3 to 0 and back, post on: 0 links, control 0; post off: 1 calls at tier 0, 2 at tier 3`. **Mutants fail it:** `T04_MUTANT=allModes`, exit 1, `A23 mode 1 is the sun: 172322 bytes, max 255`; `T04_MUTANT=lateLow`, exit 1, `A23 links at the switch`, `1 links, control 0`. **T10's regression, second after-run**, `test-results/T04-D007-after2`, exit 1: `all {"p50":54.8,"p95":58.2}`, `no sky {"p50":52.9,"p95":58.7}`, `all again {"p50":51.5,"p95":57.3}`, `no terrain {"p95":32.7}`, `no props {"p95":42.4}`: sky share p50 0.3 ms, p95 -1.0 (noise).
- [x] 2026-11-06T02:28Z to 02:29Z `gpu`, `--grep-invert A19`, `--output=test-results/T04-D-gpu`: exit 0, 24 passed, 3 skipped (A18, A22, A23 are software-only). The figures match V2's: `A2 12 of 12 states within DI-58, bytes 0/0` in all 12; A2n 1,541,582, 1,560,968, 1,500,916 bytes; A4 `0.010%`, chroma 58.5; A8 flux p95 .125 and .130, A8n .734 and .468; `A9 same tick 0 bytes`; A11 phase-7 wrap 5 bytes, max 1; A12 `calls 2 2 1 1 1 2` on both cycles and `links 0` on the second, with `programs` 6 to 7 at the first tier 0, the post-off first-draw link of section 10; `A13 aurora 961093 bytes; lightning 3117723 bytes; reduced lightning 0 bytes`, aurora peak .278 to .318; `A17 tier 3: 0 bytes`, `0 further links`. A23v on `gpu`: `tier0-modes.png` **viewed**, the same four identical suns as on SwiftShader, and the X4000 fixture passed, so tier 0's program compiles clean on D3D11.
- [x] 2026-11-06T02:29Z T10's A28, run read-only: `npx playwright test tests/e2e/compile.spec.ts --project=gpu --output=test-results/T04-D-a28`, exit 0, 1 passed: `n0 17`, 17 links at every step of tiers 4, 3, 2, 1, 0 and auto; `n1 34` after a restore, 34 throughout; control 34 to 35. T10 recorded 16 before; the 17th is tier 0's sky program, linked at precompile, so the app compiles nothing at a switch to tier 0. `npm run glsl:check`: `186 files scanned, 0 hits`, exit 0.
- [x] 2026-11-06T02:30Z A19 through the lock: exit 0, `p50 1.20 ms, p95 2.00 ms`, under its 3 ms bound. Indicative only, other owners were active, and tier 3's program is unchanged. `npm run check:task -- T04` on the final text: exit 0, `tsc: 12 owned files, 2 configs, 0 problems`, `eslint: 12 owned files, 0 errors, 0 warnings`, `vitest: 3 owned files, exit 0`, `glsl: 22 owned files scanned, 0 hits`, `check:task T04 PASS`. `npx vitest run tests/unit/sky`: `Tests 42 passed (42)`. Owned-file hashes against the start: exactly `dev/sky.html`, `hero.glsl` (`965aa472...`), `skyLayer.ts`, `skyMaterial.ts` and `sky.spec.ts` changed, plus this plan; no candidate or tmp file remains. 02:31Z `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.

Remaining for D-007, not T04's: with the sky hidden, the app still reads p95 58.7 and 59.0 ms in the two after-runs, so no sky cut can reach §9.2's 50 or the 45 target alone. Terrain (`no terrain` p95 32.7 to 34.8) and props (`no props` 42.4 to 43.0) hold the rest: T03's cut, then T05 per T10's register. Whole-repo `npm run check` and `test:browser` were not run, by this batch's rules.

## 10. Surprises and discoveries

**From execution, on project code, RTX unless stated.**

- **The review's inference was right: `sunDisc` stepped at the end of a wipe for directions the wipe never reached.** `discStep` over the whole sphere, last production step, in 8-bit sRGB on black: 255 levels, over 4 levels on 9,321 of 524,288 directions. The cause is `k` staying 0 at high `v`, plus a huge `fwidth(d)` on a lat-long grid, so partial coverage reaches far from the disc. T05's orb sends such directions, with `z` forced negative. After the fix: 1.7 levels at most on the last step, 2.0 on the first, and 2.8 per step in the last tenth. This is measured on `sunDisc` alone, not on a real orb, which T05 owns.
- **A one-byte difference in a frame that should be identical.** A6's exact check read 1 byte on `1>3 mix 0` under `post=off` once, and failed once more at the same early point with the message not captured, in about 15 runs of A6. Neither repeated: 0 differences in 50 fresh pages of 8 pairs each, 12 pages after a floor page x 18 comparisons, 200 repeats of one pair, and 40 repeats each of five pairs. T00's section 4 reports a similar byte with post on, cause unknown. Cause not established, and siblings were using the GPU. A6 stays at 0 bytes, and now prints a repeat if it fails, so the next failure says which kind it is. **Superseded:** the V1 verifier reproduced it on A2 and A6 and showed that a flip can persist, so a repeat cannot remove it. DI-58 restates the rows, and the repeat print is gone.
- **Sky plus corona over the bloom threshold drew a contour.** On Arctic Laser and Toxic Arcade a 4x crop showed a hard-edged lobe around the eclipse near the horizon: at row 560 G fell 241 to 232 in one 2-pixel step while R and B went on rising. A plain `mode1` sheet barely shows it. Keeping sky plus corona under .95 removed it on Toxic Arcade and left a thin band hugging the rim on Arctic Laser [O]. That bloom's SCREEN blend over HDR values is the mechanism is [I].
- **A translucent ring over a complementary sky is grey.** Sunset Drive's outer bands read grey-teal at the rehearsal's `ringA = strip * .9`. Coverage independent of band brightness made them a saturated teal. Together with the nebula change below, worst chroma went from 56.1 to 59.3; the two were not measured apart.
- **The nebula's accent colour had the same problem,** as grey-mauve smudges beside the disc on Toxic Arcade and Arctic Laser, and brown on Ember. Keeping accent high up and dimmer fixed the smudges. Ember's top right is still dim brown at 1:1, since amber at low luminance is brown (section 13). With this and the ring, A4's thin margin of 1.1 is now 3.5: 58.5 against 55.
- **Accent to horizon crosses grey in the aurora, and any accent wash is muddy in a flash.** See the decision log. Ember's flash turned the whole upper sky brown for 100 ms.
- **The bolt from 9 points read exactly as the review table feared,** and jitter applied to the glow as well drew horizontal hair across it, because each row's offset differs.
- **A hue step across aurora bars was not the aurora.** At 3x, bars change from teal to lilac at one row. A column read shows R going 88 to 48 over about 24 rows, and the same step between the bars. It is a nebula cloud's lower edge showing through. Accepted.
- **`scriptedFrame` moves `dayPhase` with the camera.** A still that only sets `tick` changes star gain with distance. The spec's `still()` pins `at`, `camX` and `zone.dayPhase`. `at` also forces alpha 0, so the alpha cases use `t` alone.
- **Seed 1985 strikes in 5 of 16 lightning slots,** against 8.8 expected at rate .55 [arithmetic]. Not a defect. T11 and HC4 judge the rate.
- **`stats().programs` falls from 7 to 5 during the first tier cycle** under `post=off`, because DevPost's bloom rebuilds its blur. The row asks for constancy on the second cycle, which holds with 0 links.
- **`uStarPx` is one frame stale after a resize.** `frame()` reads the canvas height before `post.frame` applies a recorded resize. It shows only on the frame of a tier change, which reallocates everything anyway. Left as the plan's table says.

**From the V1 repair.**

- **The flake came back in the final run, on the verifier's own pair.** A6 `1>3 mix 0` read 1 byte at 1 level, while 0 of the other 5 ends and all 12 A2 states read 0. Under the old exact row the run would have been red. Under DI-58 it passes, and it is what the bound is for.
- **A meteor sits on two phase-5 wraps.** Ticks 1920 and 3840 have a channel-1 meteor active in biome 0 or 4 for the default seed, and a moving head would make a wrap pair differ for a reason other than a phase. The first quiet phase-5 wrap is 5760. The spec finds the ticks itself, so a retuned schedule moves them rather than breaking the row.
- **8-bit post-off pixels cannot bound HDR luminance.** With the aurora at five times its L, the first version of the check read a peak of only .837, because each channel clips at 1, so luminance is capped by hue: a clipped cyan would read about .78 and pass. Rendering the same frame into an RGBA32F target read 1.204 for the mutant and .278 to .318 for the shipped aurora.
- **A full-sky wrap pair moves hundreds of bytes by 1 level** (up to 297), from .001 tick of continuous motion, so the A11 bound is on level, as the plan's bar-wrap row already was.
- **The bolt cap doubled the near-disc fraction,** .12% to .23% of strikes, because shifting a path inward can bring its inner side toward the centre. The disc still composites over the bolt there.

**From the D-007 repair.**

- **On the integrated app the four-mode disc is about half of the sky's software cost.** The scratch probe read a sky share of 15.9 and 14.0 ms p50 unchanged, 7.9 with the sun alone [O: one run, contaminated]. The other half is spread over nebula sampling, stars and events at about 2 to 4 ms each, though tier 0 shows no nebula at all: its gain was already 0 there, and SwiftShader paid for the texture read and the smoothsteps anyway.
- **Under `?post=off` every scene program links at its first draw.** DevPost's `render` draws the scene with `setRenderTarget(null)` when the variant is `off`, while `precompile` compiles with `composer.inputBuffer` bound, and the output colour space is part of the program key (Agents.md). A23's first link check, under `post=off`, therefore read 1 link for tier 0's program against 0 for a control whose program had already drawn once. With post on, as in the app, the check compares like with like. A12's post-off tier cycle would hide the same effect, because it counts links only on its second cycle [I]. This is the dev shell's debug path, not a defect in DevPost's production-like path, so it is recorded and not filed.
- **The sky share is not resolvable at p95 on this machine.** The two baselines read p95 shares of 1.9 and 12.4 ms from the same command minutes apart, and a `no sky` p95 of 66.6 once sat 0.2 under its `all`. p50 shares were steadier (5.7, 9.5, and the probe's 15.9 and 14.0), so the deltas here are read at p50 first.

**From the rehearsal.** All from 2026-11-05, on the RTX unless stated. None of this ran against project code.

- **§6.3's "near-black below the horizon" draws a black stripe under real bend.** `below0.png` shows it across the full width, rows 590 to 604, at `c = -1.2e-5`, T01's constant. The floor's crest is about 18 px under the true horizon. Fix in M1, and §6.3 states it (closed by S-25).
- **The first fix was wrong too, and only a translucent floor showed it.** Keeping full sky to -.045 looked perfect over an opaque test floor (`below1.png`). Under T03's alpha law it lifted the near floor, 18 instead of 7 at row 680 and 37 instead of 15 at row 630, and ghosted the disc through it. The rule in M1 replaced it. `devFloor` therefore carries the alpha law.
- **Arctic Laser mode 0 fails the near-white gate.** Near-white 1.463% against the §6.7 limit of 0.5%, on a sky-only frame, because disc top is #FFFFFF. Changing only disc top to #D8F6FF gave 0%, with mean chroma 73.6 against 72.2, and every other combination was at most 0.06%. Palette values are T01's and T11's. (closed by DI-02)
- **Toxic Arcade and Arctic Laser exceed §6.7's sky budget through the contract gradient.** `skyGrad(0)` luminance is .96 x horizon luminance: Sunset .239, Miami .231, Ultraviolet .121, Toxic .711, Ember .245, Arctic .762, against "sky up to .6" [arithmetic]. They still read well on the sheets and stay under the bloom threshold, tone-mapped (26, 239, 152) and (108, 231, 238) at row 585 [O], so this is a budget inconsistency, not an observed wash-out. T04 cannot change it. (closed by DI-04)
- **A hash early-out before derivative maths breaks on D3D11.** Hollow outlines around lit star cells, tracker count 1 instead of 225. Moving the derivatives above the `if` did not help; removing the branch did. `Agents.md` states this (DI-13).
- **`X4000 use of potentially uninitialized variable`** appears for functions with several `return`s behind branches, at `console.warn` through three. Harmless in pixels so far, and invisible to a clean-console gate that checks only errors. The single-assignment form of `heroEval` removed it.
- **Fixed-cell star metric stretch.** See M4. The round version also looks more refined at 1:1, with many fine dots rather than dashes.
- **Tracking needs care.** A sign error in the yaw sweep looked like .83 flux CV on every kernel. The negative control and the pitch sweep exposed it. Keep both.
- **SwiftShader cost.** Sky at 640x360 with no post: full sky plus four-mode hero 16.9 ms p50; lite sky (no stars, nebula, events) with four-mode hero 10.8; full sky with T00's mode-0 hero 8.0; lite with mode-0 hero 2.3; sky hidden 0.1. Uniform gates did not save time there, consistent with SIMD masking running every branch [I]. A branch that skips sky shading below the horizon gave no measurable gain on SwiftShader or the RTX, and 0 changed bytes, so it was dropped.
- **Nebula cost is below what the sync resolves on the RTX.** Repeated A/B runs at 384x192 read p50 .6 and p95 .7 to .9 with and without. Stand-in stack: 15 draws total, 6 programs.
- **Determinism held.** `post=off`: same state 0 bytes; tick against tick + 30720 x 2^30 0 bytes; context loss and restore with the nebula 0 bytes.
- **`rt.setSize` reallocates only on a real change,** and calls `dispose` then [O: `RenderTarget.js`].
- **Row-mean banding metric failed as a detector.** Dithered and undithered gave similar worst steps, because gradient rows are curved across x. Value changes per level separates them cleanly, 1.35 and up against exactly 1.00.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| Sky stays at full gradient and disc down to .004 under terrain's top edge, then reaches `uPal[0] * .25` within .016 | §6.3 states this (S-25). Its old rule drew a black band under bend, and a wider band leaks through the translucent floor [O: M1 table]. The disc shows slightly more than "20% sunk" under `c < 0`, about 17%, which reads as correct [O: `below1.png`] | 2026-11-05 | T04 planner |
| `gb` is computed in the shader from `uBend` and `cameraPosition.y` | T01 may retune `c`, and follow moves camera y from 5.6 to 9.8 (§6.1). No CPU state or sibling coupling. `.y` passes T00's GLSL gate, which bans z swizzles | 2026-11-05 | T04 planner |
| No branch skipping sky shading below the horizon | No measured gain on either rasterizer, plus derivative risk near the branch edge [O] | 2026-11-05 | T04 planner |
| Stars use an exact inverse Jacobian, branch-free | §6.3 states this (DI-13). Round on-screen dots everywhere, flux CV p95 .125 and .131, peak CV .008 [O]. `max(fwidth(st))` stretches off-axis. Same radius range, same density, same cell mapping | 2026-11-05 | T04 planner |
| Star peak L at most .85 x .87 | Keeps stars out of bloom, so no bloom flicker, and inside the §6.7 sky budget. The prototype's 1.3 was over the threshold | 2026-11-05 | T04 planner |
| Nebula target stores densities, not colour | Palette crossfades need no re-render, and the target stays cheap. Colour lives in the sky shader, so nebula matches the current palette exactly | 2026-11-05 | T04 planner |
| Target rendered every frame at the §6.10 size | §6.3 says each frame. Skipping would add history and break identity. Cost below sync resolution at 384x192 [O] | 2026-11-05 | T04 planner |
| Target domain `|g.x| <= 1.8`, `g.y` -.05 to .95 | Covers the §6.4 horizontal cap and FOV 68 with shake margin, and spends the 2:1 target on the visible band | 2026-11-05 | T04 planner |
| `rebuild` always renders the nebula, even at `nebulaWidth` 0, at a default 192x96 | Program compiled at boot on every tier, sampler always valid, no compile on a later upshift | 2026-11-05 | T04 planner |
| Event schedules use `tick mod 30720` and `hash01`, and ignore `zone.index` and `v.cam` | Hashing the zone index would pop a meteor at a zone boundary, since nothing may hold state. Reading `v.cam` would break `periodChunks` identity (100 does not divide 1024, §5.1). Biome weight gates visibility continuously. A 256 s repeat is invisible behind changing zones [I] | 2026-11-05 | T04 planner |
| Event parameters computed on the CPU, uploaded as small floats | Needs `hash01`'s double arithmetic on large slot numbers, and keeps per-pixel loops out of the sky shader | 2026-11-05 | T04 planner |
| Meteors and lightning off under reduced motion, aurora and twinkle on the slowest phase | §10.3 removes flash and asks for slowest harmonics. Meteors are not listed, but off is the safe reading and nothing depends on them | 2026-11-05 | T04 planner |
| Disc band scroll is **not** slowed under reduced motion | `hero.glsl` can read only shared uniforms, and no shared uniform carries that flag. The scroll runs on phase 4 (480 ticks, 4 s), about 6 px/s inside the disc: a 23 px band period over 4 s [arithmetic], not a pulse or a blink. Corrected per DI-63 from "a bar-phase scroll, about 10 px/s": `uPhases[1].x` is phase 4, not the bar. Slower, so safer under reduced motion. Accepted without a contract change. §10.3 states this (DI-14, DI-63) | 2026-11-05 | T04 planner; corrected by T04 executor |
| The wipe runs to `th` 3.4 with half-width .6, not 2.2 and .16 | The old range stopped below the highest visible sky, so the last frame replaced what remained in one step, up to 117,223 bytes at FOV 68 and a corona streamer visibly vanishing. A time-based fade would need new state; this needs none and leaves mode 0 alone. It gives mid 7 and end 1 on the stand-in, against the row's limit of 8 (DI-44) | 2026-11-05 | T00 owner |
| Mode change is a rising soft wipe, not a dissolve | A 20 s double exposure of two discs looks like a mistake. Wipe is stylish and exact at both ends. Halo and disc share one `k`, so it stays a single expression [O: `wipe.png`] | 2026-11-05 | T04 planner |
| Hero edits go through a candidate and an atomic publish | `hero.glsl` is compiled into siblings' materials during the parallel batch | 2026-11-05 | T04 planner |
| Dev helpers live under `src/render/sky/dev/` | §12 gives T04 no other place, and the dev page needs real modules. `glsl.test.ts` proves shipped code imports none of it | 2026-11-05 | T04 planner |
| `iso`, `naiveStars`, `legacyBelow`, `nanTest` are compile-time options | Negative controls in shipped code would cost a uniform and a branch at every pixel | 2026-11-05 | T04 planner |
| Sheets built from `pixels()`, not `drawImage` | The rehearsal's `drawImage` relied on `preserveDrawingBuffer: true`, which the shell does not set | 2026-11-05 | T04 planner |
| `uStarPx = max(1, canvas height / 1080)` | §6.3 defines radius in pixels, so tier 4's 1440-row buffer would shrink stars by a quarter on screen. Height, because width depends on aspect. Not rehearsed; A16 is its first test | 2026-11-05 | T04 planner |
| M4 to M6 built before the M3 publish, not after | A4 must pass before publishing, and A4 is everything on. Siblings got `hero.glsl` no later for it, at 15:02Z, 12 minutes after M0 | 2026-11-05 | T04 executor |
| Ring coverage independent of band brightness, `.96` | The plan names the ring fill the least certain choice. A translucent band over a complementary sky is grey. Emission still falls outward. No threshold touched | 2026-11-05 | T04 executor |
| Nebula accent only above `rd.y` .2 to .5, at L .025, disc-bottom colour elsewhere at L .04 | Review table: colour that fights the palette. A small change from the plan's `sky.frag.glsl` line. Moved worst chroma up, and no gate loosened | 2026-11-05 | T04 executor |
| Aurora: toward `uPal[1]`, capped at .7, L .30, base ramp .06 | Review table: base too hard, too bright. `uPal[1]` is dim, so `emit` lifts it and the hue turns with saturation held; `uPal[2]` crossed grey on Toxic Arcade and Arctic Laser, `uPal[4]` on Sunset Drive | 2026-11-05 | T04 executor |
| Bolt: two octaves of jitter, tapered width, soft ends, ending at `g.y` -.04, glow on the unjittered path | Review table: rendered polyline. It runs only under the uniform `uBoltK > 0.` branch, and stays branch-free inside | 2026-11-05 | T04 executor |
| Flash is `emit(uPal[2], uFlash)`, not `uPal[6] * uFlash` | Accent wash is brown on Ember and grey on Sunset Drive. `emit` makes "under .05 L" exact where it was hue-dependent. Reduced motion still reads 0 bytes | 2026-11-05 | T04 executor |
| Wipe's end: `k = max(min(k, smoothstep(0., .1, m)), smoothstep(.9, 1., m))` | Supersedes "a time-based fade would need new state": this needs none. A6's rows are unchanged or better, mode 0 is untouched, and the sphere's last step fell from 255 levels to 1.7. Visible sky is already at or past these values then [arithmetic: differs only above `m` about .98 at FOV 68] | 2026-11-05 | T04 executor |
| Corona luminance `.54 * (1 - smoothstep(.15, .6, skyL)) + .08` | Painted glows stay under bloom (§6.3, §6.7). It calls `skyGrad`, which reads only `uPal`, so `sunDisc`'s stated reads hold. `rd` may be unnormalized or zero, so `max(length(rd), 1e-6)` | 2026-11-05 | T04 executor |
| Sphere check added to A6 at the row's own 8 levels | Turns the review's note into a gate, on the worst case of black. An addition, not a change to any threshold | 2026-11-05 | T04 executor |
| A6's exact 0 kept, despite one unexplained byte | Not one of the cases Agents.md allows without the reviewer's agreement. The test prints a repeat on failure, and passes or fails exactly as before. **Rejected by the V1 verifier, superseded by the DI-58 row below** | 2026-11-05 | T04 executor |
| A19 run through the GPU lock, though it is in the `gpu` project | The file name decides the project, and T04 owns only `sky.spec.ts`. The lock still keeps other timing suites off during it | 2026-11-05 | T04 executor |
| No `HERO_SUN_ONLY` tier-0 define yet | Cost is known [O], but the 50 ms tier-0 budget has not been tried on the integrated build. Add it only if T10 shows a miss. **Superseded 2026-11-06 by the D-007 rows below:** T10 showed the miss | 2026-11-05 | T04 planner |
| **Acceptance change (DI-58):** A2, A6's ends, A9's same tick, A13's reduced row and A17 pass on `gpu` at most 64 differing bytes with none over 1 level, and a delta over 1 fails at once; 0 bytes on `software`. A2 and A17 now compare bytes, not hashes, so a count exists | The RTX flips 1 to 41 fixed pixels by 1 level once other states are drawn between, and a persisting flip defeats repeats [O: V1 verifier; this repair's final run]. Every restated row still fails a real fault, shown by mutant (section 7). A12's new history check uses the same rule | 2026-11-05 | T00 owner decided (DI-58); V1 verifier proposed and agreed; T04 executor applied |
| A22 runs the same helpers on `software` at 0 bytes | So DI-58's software clause is checked, not assumed. 640x360, the software project's viewport | 2026-11-05 | T04 executor |
| **Acceptance change:** A11's bar wrap replaced by full-sky pairs at the wraps of phases 4 to 7, in all four modes and biomes 0 and 4, at most 1 level | The bar wrap crossed only phases 0 and 1, which the sky never reads, so a non-integer corona harmonic popped 1,142,099 bytes and passed (V1, blocking). Phase 5 uses 5760, not 1920, because a meteor is active at 1920 and 3840. A threshold is not loosened: the pairs are new, at the old row's own 1 level | 2026-11-05 | T04 executor; V1 verifier's fix, agreed |
| A11n permanent; real-code faults through `T04_MUTANT` | A11n's injection touches only `sky.frag.glsl`'s last line, so a T11 retune does not break it, and it proves each pair crosses the wraps it claims. Mutants name tuning text, so they stay opt-in and run with nothing on disk changed | 2026-11-05 | T04 executor |
| **New gate:** aurora peak linear luminance at most .8 at gain 1, `iso=nostars`, float target | V1 low defect, and the condition on the aurora ruling. .8 is §6.7's sky budget. Float, because 8-bit clips per channel (section 10). `nostars` is a dev-only compile variant like the other iso views | 2026-11-05 | T04 executor; V1 verifier asked for it |
| **New gate:** A12 counts nebula draws over six consecutive ticks with the camera held, and compares a frame after two histories | V1 low defect: an even-ticks-only nebula passed A9, A11 and A17, because their camera jumps rebuild | 2026-11-05 | T04 executor; V1 verifier's fix |
| Bolt path capped: `BOLT_X_SPAN` .8 to .4, then the whole path shifted inward to `BOLT_X_MAX` .9 | V1 low defect: a quarter of strikes lay wholly off screen. A shift keeps the path's shape, where a clamp would draw a straight segment at the edge. More strikes now show a bolt, so the visible rate rises: HC4 and T11 judge it. The near-disc gate is new, at 1% [A] | 2026-11-05 | T04 executor |
| Bolt review crops follow each bolt's mean x | V1 low defect: fixed halves cropped two bolts out | 2026-11-05 | T04 executor |
| `hero.glsl` line 2 states where derivatives are taken | DI-63. Comment only, published through M3 with A2, A3, A4 and A7 on the candidate | 2026-11-05 | T00 owner decided; T04 executor |
| V1 ruling: ring coverage `clamp((s1+s2+s3)*.96)`, **accepted** | A4 chroma 58.5 against 55, near-white .010%; saturated rings in `crop2` and `low2`. Ember's ochre fill is T11's (DI-66) | 2026-11-05 | V1 verifier agreed |
| V1 ruling: nebula accent above `rd.y` .2 to .5 at L .025, **accepted** | No grey smudges on the sheets, A4 passes, no threshold moved | 2026-11-05 | V1 verifier agreed |
| V1 ruling: aurora toward `uPal[1]`, capped at .7, L .30, base ramp .06, **accepted with a condition** | Condition: T11 judges it on the contact sheet, and any retune adds a luminance check. The check now exists in A13, so a retune that blows the aurora fails it | 2026-11-05 | V1 verifier set the condition; T04 executor met its second half |
| V1 ruling: bolt with two octaves of jitter, tapered, soft ends, ending at `g.y` -.04, **accepted** | Jagged, not a polyline, ends at the horizon; A13 passes | 2026-11-05 | V1 verifier agreed |
| V1 ruling: flash `emit(uPal[2], uFlash)`, **accepted** | L exactly `uFlash`, at most .05 by A14; reduced lightning 0 bytes | 2026-11-05 | V1 verifier agreed |
| V1 ruling: wipe end fade, **accepted** | Sphere steps at most 2.0 levels, against 255 without it; makes DI-44's range redundant for the last step, harmlessly | 2026-11-05 | V1 verifier agreed |
| V1 ruling: eclipse corona bound calling `skyGrad`, **accepted** | No contour or strobe in `crop1` and `strip1`; reads only `uPal`; A7 finite. Guarded by the picture only | 2026-11-05 | V1 verifier agreed |
| V1 ruling: A6's exact 0 with a printed repeat, **rejected** | The repeat does not make the row pass, and the flake is a reproduced platform effect. Replaced by DI-58's bound, above | 2026-11-05 | V1 verifier ruled; T00 owner decided |
| V1 ruling: A6's whole-sphere `discStep` check, **accepted** | An addition that can fail: 255 levels with the end fade removed | 2026-11-05 | V1 verifier agreed |
| V1 ruling: M4 to M6 built before the M3 publish, **accepted** | M3 step 1 needs A4 with everything on; siblings got `hero.glsl` 12 minutes after M0 | 2026-11-05 | V1 verifier agreed |
| V1 ruling: A19 in the `gpu` project through the GPU lock, **accepted** | T04 owns only `sky.spec.ts`; the lock gives the same isolation | 2026-11-05 | V1 verifier agreed |
| V1 ruling: Progress times for M4 and M5 from image file times, **accepted** | Disclosed, and the verifier reproduced the numbers | 2026-11-05 | V1 verifier agreed |
| **D-007: `HERO_SUN_ONLY` at tier 0.** `hero.glsl` gains an `#ifdef HERO_SUN_ONLY` block in `sunDisc` that returns `heroSun` after the shared derivatives; the sky defines it in its tier-0 program only | The response this plan's seam table and §9.2 name for a tier-0 miss at T10, at §9.2's stated cost of a plain sun in software. Biggest single cut: sky share p50 about 7 ms of 15 in the probe. Mode 0's output is unchanged by construction and by A2 and A23 (0 bytes). Published through M3 with A2, A3, A4, A7 and `glsl.test.ts` on the candidate. A design change at tier 0 only: §6.10's "disc never degrades" still holds for position, size and palette, while the mode is lost at tier 0, as §9.2 already allows | 2026-11-06 | T04 executor |
| **D-007: no nebula sampling at tier 0** | §6.10 already turns the nebula off at tier 0, so its gain is 0 there, and the term added exactly 0 while SwiftShader still paid for the texture read: about 4 ms p50 in the probe after the sun cut. Changes no pixel: A23 reads 0 bytes against the old program with stars compiled out | 2026-11-06 | T04 executor |
| **D-007: no stars at tier 0.** A tier-0 look change | The orchestrator's brief offers stars at tier 0 as a cut that keeps the sky readable. The probe read about 2 ms p50 for them after the two cuts above. Gradient, disc, palette and horizon carry the read, and §6.10's never-degrade list (grid, disc, palette) does not include stars. **What this gives up:** the starfield at tier 0, which `tier0-before.png` shows to be a large part of the night look there. Purpose 4's star gates (A8, A9, A16) run at tiers 3 and 4 and are unchanged. For T11 and HC1 to judge on software | 2026-11-06 | T04 executor |
| **D-007: events kept at tier 0** | Measured, not cut: with events also off the probe read a further 0.4 to 2.5 ms. Aurora and lightning are the zone signatures Purpose 5 names for Orbital Night and Cyber Canyon, and their reduced-motion handling is gated (A13). If tier 0 still misses after T03's cut, compiling `SKY_EVENTS` out of tier 0's program is the next sky cut, one line in `skyDefines`, and the T00 owner or the operator should decide it | 2026-11-06 | T04 executor |
| **D-007: two sky meshes, one visible, instead of a material swap or define flip** | Changing `defines` or the material on one mesh would compile at the first tier-0 frame (§6.4, Agents.md). Both meshes are in the scene from `attach`, so precompile links both, and visibility is not a program key. Cost: one more program linked at boot on every tier, and one more scene object, both constant (T09's soak compares against its own first sample). Both materials spread one private uniform record, so `frame()` writes once | 2026-11-06 | T04 executor |
| **D-007: new rows A23 and A23v, mutants `allModes` and `lateLow`, dev option `fullAtTier0`** | Additions, no threshold changed. A23 is the fail-before and pass-after row for this change, with the old program as its control. A23's link check runs with post on, because under `post=off` every scene program links at its first draw (section 10) | 2026-11-06 | T04 executor |

## 12. Contract change requests

Both additive, both reconciled. The text below is a record of what was asked, and the fallbacks are removed. Execution raised no new request and no seam defect.

**CCR-T04-1. Zone overrides for dev frames. Approved, C-21; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.** `ScriptedFrameOptions` in T00's section 4 can set `palette`, `biome` and `hero` but not `heroB`, `heroMix`, `biomeB`, `biomeMix` or `dayPhase`, and T04 must test wipes, biome fades and day phase. `src/testing/scriptedFrame.ts`, in `ScriptedFrameOptions`:

```ts
  /** Applied last, after palette, biome and hero. For testing crossfades and day phase. */
  zone?: Partial<Pick<ZoneState, 'index' | 'biomeA' | 'biomeB' | 'biomeMix' | 'heroA' | 'heroB' | 'heroMix' | 'dayPhase'>>;
```

**CCR-T04-2. Meaning of `dayPhase` 0. Amended, C-12; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.** T01's CCR-T01-4 says it is a sawtooth. Nothing says which end is night, and T04's star gain and any later exposure work need the same answer. `src/contracts/index.ts`, in `ZoneState`, before `dayPhase`, comment only:

```ts
  // dayPhase 0 is deepest night. Consumers evaluate cos(TAU * dayPhase), so the sawtooth wrap cannot pop.
```

**Dependency, not a new request:** `Biome` and `PaletteId` from CCR-T01-3, approved as C-10 and in §8.1.

## 13. Outcomes and retrospective

**Result against Purpose.**

1. All 24 combinations were opened and judged. Gradient, stars, nebula and disc show in each, on the stand-in stack.
2. The disc stays put: A3 within 2 rows of the arithmetic at both FOVs, in all modes. The wipe is exact at both ends, 0 bytes, and moved at most 7 levels per production step at the steps sampled, mix .5 and the last. Steps between were not sampled.
3. No black band under bend at any tested `c` or camera height, and the legacy rule fails the same check. The floor and sky differ by at most 3 at the fog join, on six palettes. Dark gradients read 1.34 changes per level or better with dither, and hard contours without.
4. Tracked stars hold: flux CV p95 .125 and .130 against a naive star's .734 and .468.
5. Meteors in every zone, aurora in Orbital Night, lightning in Cyber Canyon, all from `writeSkyEvents`, pure in tick and zone. Under reduced motion, lightning leaves 0 differing bytes and meteors are off.
6. `src/contracts/glsl/hero.glsl` carries four modes behind the frozen signature, and mode 0 is byte-identical to the T00 text in 12 of 12 states. T03 and T05 follow the mode with no work on their side, though neither was run by T04.
7. The sky reads neither `v.cam` nor `uTravel`. That is by construction and the A14 identity at `tick + 30720 * 2^30`. No frame was rendered at 1e15 u, since T09's warp is what reaches it.

**Ran, with results:** A0 to A13, A15 to A17 on `gpu`, A14 in Vitest, A18 on `software`, A19 through the lock, A20's `check:task`, A21. All passed on the final text. A6's exact check failed twice in earlier runs, see section 10.

**Repair after V1-T04, against the verdict.**

- Blocking, DI-58 (T00 owner's, applied here): A2, A6's ends, A9's same tick, A13's reduced row and A17 restated to DI-58's bound on `gpu` and 0 bytes on `software`, the latter now checked by A22. Each still fails a real fault: `sunScroll` (A2, 66,066 bytes), `swapEnd` (A6), `drift` (A9, A17), `reducedBolt` (A13), and A2n through the same check. The final run showed the flake once, `1>3 mix 0` 1 byte at 1 level, which DI-58 passes.
- Blocking, A11: the bar wrap is replaced by 32 full-sky pairs across the wraps of phases 4 to 7, all at max 1. Five real-code harmonic faults each fail it at their own phase, and A11n proves each pair crosses exactly the wraps it claims.
- Low, aurora luminance: A13 bounds it at .8 in linear HDR, shipped .278 to .318; five times L reads 1.204 and fails.
- Low, nebula every frame: A12 counts draws over six consecutive ticks and compares two histories; the even-ticks mutant fails both.
- Low, off-screen bolts: every strike's path is inside `|x| <= .9`, the unit test failed before the cap, and `lightning.png` and `bolts-1to1.png` now show a bolt in every cell.
- Low, DI-63: `hero.glsl` line 2 corrected and published, `37cb8804...`; the decision log gives the band scroll as phase 4, about 6 px/s.
- Not T04's: Ember's ochre and brown reads (T11, DI-66). Their images were viewed again and are unchanged.

`npm run check:task -- T04` after the plan edits: exit 0, `tsc: 12 owned files, 2 configs, 0 problems`, `eslint: 12 owned files, 0 errors, 0 warnings`, `vitest: 3 owned files, exit 0`, `glsl: 22 owned files scanned, 0 hits`, `check:task T04 PASS`.

**Not run, because this batch forbids it or it comes later:** whole-repo `npm run check`, `npm run test:browser`. The second half of A20 is therefore open until the batch ends.

**D-007 repair, against T10's register row.**

- **Applied:** `HERO_SUN_ONLY` at tier 0, as this plan and §9.2 name it, plus two further tier-0-only cuts, nebula sampling (no pixel change, its gain was already 0) and stars (a look change). Events stay. Each is in the decision log with its measured share.
- **Sky share of tier 0 on the app, p50, all minus no sky in one run:** 5.7 and 9.5 ms in the two baselines (15.9 and 14.0 in the scratch probe's unchanged runs), then 0.8 and 0.3 ms after. p95 shares moved from 1.9 and 12.4 to 0.0 and -1.0, which is inside this machine's noise. The sky alone at tier 0 on the dev page: A18 p50 16.0 before, 6.3 after; A23 5.1 to 6.6 ms against the old program's 14.2 to 16.2 in the same runs. All figures are contaminated by other owners' work, which is why they are read as deltas inside one run.
- **T10's regression is still red,** exit 1 with `all` p95 58.8 and 58.2 ms after, and it will stay red on the sky's account alone: with the sky hidden the app reads p95 58.7 and 59.0. The remaining cost is terrain and props, so D-007 now depends on T03's terrain cut and, per T10's register, T05 next. T04 has no further cut that matters there, except events at tier 0 (decision log), worth at most a few ms.
- **Tiers 1 to 4 unchanged:** 0 differing bytes in 35 `gpu` frames across tiers 4 to 1 and 40 `software` frames at tiers 3 and 1, captured before and after; every `gpu` row passes with V2's figures; A22 0 bytes on SwiftShader; T10's A28 shows no link at any tier switch, including to tier 0.
- **Fail before, pass after:** A23 exit 1 before (`9636 bytes`), exit 0 after; its mutants `allModes` and `lateLow` each exit 1.
- **Gaps:** tier 0 loses the starfield and the hero mode, a visible change on software and on any device whose player picks quality 0; T11 and HC1 should judge it on a software contact sheet. T05's chrome orbs still run four hero modes at tier 0 unless T05 defines `HERO_SUN_ONLY` there (seam table). Not verified: the combined 45 ms target, which depends on T03's change and was not measured with it in place; any GPU but the RTX and SwiftShader; the cut's cost on a real low-end device.

**Gaps and things to look at.**

- **Ember's upper right reads dim brown at 1:1.** Dim amber is brown, and T04 cannot change the palette. Luminance is already down to .025. T11 can retune Ember's accent, or `neA`'s level. Reported, not resolved.
- **Mode 2's body bottom is low contrast against the horizon on Sunset Drive and Ember.** It reads as a sphere. T11 to judge.
- **A6's single byte is unexplained** (section 10). DI-58 now bounds it on `gpu`, and A22 keeps exact 0 on `software`. Its cause, inferred to be a driver or ANGLE effect, is not shown.
- **The visible strike rate rose** with the bolt cap, since no strike is off screen now. HC4 and T11 judge the rate.
- **Rear reflections are measured on `sunDisc`, not on a chrome orb.** A real orb has its own derivatives. T05's A22 is the check there.

**Not verified by T04, as the plan expected.**

- The final look under CA, Crt and vignette (T06, T11), and with real terrain, props and fog (T03, T05, T10). `devFloor` is a stand-in.
- HC1: whether it is beautiful. Numbers catch regressions. One executor reviewed stills and strips, and the operator's contact sheet is at T11.
- HC2: any GPU other than the RTX and SwiftShader. The D3D11 derivative failure in this section's rehearsal notes shows driver behaviour matters. Mobile is untested (§14).
- HC3: frame cost on mid-range GPUs. A19 is indicative, on a GPU siblings were using. Allocation and leak gates are T09's; `writeSkyEvents` is written not to allocate, and that is unmeasured here.
- HC4: real-time schedule feel. Meteor and strike rates are unplaytested [A].
- HC5: photosensitivity. The limits are engineering bounds, not an assessment.
- T03's horizon shots against the published sky, and T05's orb: their owners re-run them.

**Lessons.**

- The rehearsal numbers reproduced almost exactly on project code (A8 and A8n to three figures, A2n within 7%). The defects it missed were all ones only a closer picture showed: 1:1 crops of the ring, a 4x crop of the corona, a 1:1 bolt.
- Complementary colours added at equal luminance make grey, four separate times here: ring, nebula, aurora, flash. `emit` toward a dim colour, or a palette's own hue, avoids it.
- A review's `[I]` note was worth measuring. The chrome-orb step took one helper to confirm, and it was much larger than the frame gates could see.

## 14. Revision notes

- 2026-11-05T06:27Z Initial draft. No approved revisions.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: C-10, C-12, C-21, S-25, S-45, DI-02, DI-03, DI-04, DI-13, DI-14, DI-16, DI-26, DI-28, DI-34, DI-38.
- 2026-11-05T09:28Z Independent review, full read of M2 onward and all acceptance rows, with this plan's GLSL compiled and run on D3D11 and SwiftShader in a scratchpad page. Factual corrections, no threshold changed: A1 no longer compares row 630 at twice `c`, since §6.3's fade reaches past it, and states that each `c` runs at all three camera heights. A4's chroma evidence corrected from 62.4, which was the rehearsal's default wide fade, to 56.1, and the row pinned to the fake bend. A5 names the one fully fogged row. A7n's injection made non-constant, because a literal `sqrt(-1.)` folds to 0 and the control could not fail. A17's "fails if the re-bake is removed" was false at tier 3 and is replaced by a tier 1 case that can fail. The meteor row's claim about the cycle wrap and the lightning row's claim about clearing the disc corrected. Reported, not edited: the wipe against A6 and at its end, and A13's tick comparisons.
- 2026-11-05T10:15Z Applied DI-44, DI-45 from the full-text reviews, decided by the T00 owner in plans/RECONCILIATION.md.
- 2026-11-05T15:24Z Execution. GLSL in M1, M2 and M6 corrected to what shipped, for the reasons in the decision log: nebula colour, flash, ring coverage, corona bound, wipe's ends, aurora, bolt. A0 added. A6 gains the whole-sphere check. A4 gains `low0..3`, A9's strips are 4x as the row states, A11 gains `nebula-corner`, A13 gains `meteors-2x`, `bolts-1to1`, `aurora-1to1`, `aurora-zoom`, A12 also checks `setVisible` and `dispose`. No threshold was loosened. `SkyOptions` lives in `skyMaterial.ts`.
- 2026-11-05T19:55Z Independent verification V1-T04, verdict **not passed**, two blocking defects. First, the exact-0 rows flake on the RTX: A2 failed 1 run in 7 (10 of 12 states equal), A6 1 in 6 (`1>3 mix 0`, 1 byte), from the same frame changing by 1 level at a few fixed pixels within one page, on the verbatim hero text too and never on SwiftShader, the signature of T00's post-on byte. Second, A11's bar wrap crosses only phases 0 and 1, which the sky never reads, so no row samples the phase 4 to 6 wraps: a non-integer eclipse harmonic popped 1,142,099 bytes at tick 7680 and passed every row. Ring coverage: accepted, A4 chroma 58.5 and saturated rings on the sheets. Nebula colour: accepted, no grey smudges, Ember's brown corner already reported. Aurora: accepted with a condition, since no row bounds its luminance (five times the L passed A13) and Ember's curtains read brown, so T11 must judge it. Bolt: accepted, jagged and ending at the horizon. Flash colour: accepted, L exact and reduced motion 0 bytes. Wipe ends: accepted, sphere steps at most 2 levels and no visible change before mix .985. Corona bound: accepted, no contour in `crop1`, guarded by the picture alone. A6's exact 0 kept with a printed repeat: rejected as a resolution, the row needs a tolerance or a software-only exact check, which the T00 owner decides. M4 to M6 before M3: accepted. A19 in the `gpu` project through the lock: accepted. Progress times for M4 and M5 from image file times: accepted, disclosed and reproduced. The A6 sphere check: accepted.
- 2026-11-05T20:28Z Repair after V1-T04, by the T04 executor. Blocking: the same-state rows restated to DI-58 (on `gpu` at most 64 bytes and none over 1 level; on `software` 0 bytes, with new row A22), A2 and A17 moved from hashes to byte counts, and A11's bar wrap replaced by full-sky pairs at the wraps of phases 4 to 7 in four modes and two biomes, with new row A11n. Low: a float-target aurora luminance bound in A13 at .8, with a `nostars` dev view; A12 checks the nebula draw every frame; the bolt path capped on screen (`BOLT_X_SPAN` .4, `BOLT_X_MAX` .9) with a unit test, and bolt crops by x; `hero.glsl` line 2 corrected and republished (DI-63). `T04_MUTANT` controls added to the spec. All twelve V1 rulings recorded in the decision log. Thresholds: none loosened; the A6 change is DI-58's, decided by the T00 owner and agreed by the V1 verifier, and the new gates are additions.
- 2026-11-05T21:18Z Independent verification V2-T04, verdict **passed**, no blocking defect. Re-ran on port 5204: `gpu` spec without A19 exit 0, 23 passed, 2 skipped; `software` A18 and A22 exit 0, A22 0 bytes in every comparison; A19 through the lock exit 0, p50 1.90 ms, p95 6.00 ms, contaminated by sibling GPU work; `check:task T04` exit 0; vitest 42 passed; `contracts:check` and `glsl:check` exit 0. Every `T04_MUTANT` failed its named rows with the plan's numbers. Four more on-disk faults also failed, each restored and its hash confirmed: no bolt shift (A14, 1.134), aurora rays at 2.5 times phase 5 (A11 at 5760), nebula at 1.5 times phase 7 (A11 iso, 1,823,464 bytes) and twinkle fed half of phase 5 from `skyLayer.ts` (A11 at 5760). The RTX flip came back on a new pair, `2>0 mix 0` 2 bytes at 1 level, inside DI-58. Rulings: A2, A6's ends, A9's same tick, A13's reduced row and A17 under DI-58 are **accepted**: `sameStateFault` matches DI-58's text, and `sunScroll`, `swapEnd`, `drift` and `reducedBolt` still fail them by more than 1 level. A2 and A17 moving from hashes to byte counts is **accepted**, because DI-58 needs a count. A22 is **accepted**: 0 bytes, and `sunScroll` fails it at 9,795 bytes. A12's draw counts and its history check through DI-58 are **accepted**: DI-68 covers the check, and `evenNebula` reads 2,1,2,1 and 1,428,498 bytes. A11's 32 full-sky pairs, bounded at 1 level with no byte cap, are **accepted**: A11n shows each pair crossing exactly the phases 4 to 7 it claims, and eight harmonic faults fail it. The phase-5 pair at 5760 rather than 1920 is **accepted**, since meteors are active at 1920 and 3840. A11n made permanent is **accepted**. A13's aurora bound of .8 L on a float target with `iso=nostars` is **accepted**: the shipped aurora peaks at .278 to .318, and `auroraBright` reads 1.204. A14's bolt test is **accepted**: at most .9, at most 1% near the disc [A], and .23% measured. The bolt schedule change is **accepted with a condition**: visible strikes in Cyber Canyon at 16:9 and FOV 58 rose from 1.50 to 2.02 a minute, no row bounds that rate, and at 390x844 portrait 99.3% of strikes are still wholly off screen, so the sky flashes with no bolt; T11 and HC4 must judge both. Bolt crops by mean x are **accepted**. The `T04_MUTANT` controls are **accepted**. The DI-63 comment republish is **accepted**: the line 2 text is right, and A2 reads 0 bytes against the verbatim text in all 12 states. Images viewed: `lightning`, `bolts-1to1`, `aurora`, `mode0` to `mode3`, `crop2`, `wipe-1-3`, `nebula-full`, `view-portrait`, `horizon` and `strip1`. Not run: whole-repo `npm run check` and `test:browser`, which the T00 owner runs next (DI-64).
- 2026-11-06T01:34Z Reopened for T10's D-007 (`plans/T10-integrate.md` section 10): tier 0 on SwiftShader at 640x360 reads p95 63.9 ms on the integrated app against §9.2's 50, and 54.5 to 55.9 with the sky hidden. The response is the one this plan's seam table and §9.2 name, `HERO_SUN_ONLY` at tier 0, plus any further tier-0-only cut that keeps tier 0's sky readable, each in the Decision log. T03 cuts terrain at the same time, and the orchestrator's combined target is p95 at most 45 ms. Tiers 1 to 4 must not change. `status: in-progress`.
- 2026-11-06T02:31Z D-007 repair done. Added: section 4's tier-0 program, `fullAtTier0`, M9, rows A23 and A23v, mutants `allModes` and `lateLow`, and the seam rows for `sunDisc`'s software cost, T06's quality and precompile, and T09's counts (3 programs, 2 sky meshes). The `hero.glsl` publish is `965aa472...`. No threshold changed; the new rows are additions. Tier 0 drops stars and the hero mode, by decision log entry. `status: done`. T10's D-007 regression is still red because of terrain and props, not the sky.
