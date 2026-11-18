---
id: T14-crt
title: CRT screen - Synthwave City's scanlines, aperture grille and tube corners, on by default, with a box in the cruise card
status: done
owner: T14 executor, for the operator
depends_on: [T10, T11, T13]
owns: [plans/T14-crt.md]
reads: [architecture.md, Agents.md, plans/**, src/**, tests/**, dev/**, scripts/**, package.json, playwright.config.ts, ../Synthwave_City/src/post/grade.ts, ../Synthwave_City/src/post/index.ts, ../Synthwave_City/src/app/app.ts]
updated: 2026-11-18T03:00Z
---

## 1. Purpose

The game gets the CRT screen look that Synthwave City uses: scanlines that show most in the darks and mids, an RGB aperture grille, and corners that fall off like a curved tube. It is on when the game first loads. The cruise card gets a **CRT** box; clearing it gives back the game exactly as it draws today, and the choice is remembered.

What must stay true: with the box cleared every frame is the frame drawn today, bit for bit, so every existing gate and reference image holds without regeneration. The sim, the world, the audio and the HUD are untouched. The cruise card grows by no row.

## 2. Context and orientation

Working directory `C:\highsierralabs\Midnight_Vector`. Read `Agents.md` first, then `architecture.md` §6.6, §7.2, §8.1 and §12.

**The operator's request (2026-11-17, verbatim):** "I want to add the crt screen effect we are using for Synthwave_City to Midnight_Vector. It should be enabled by default with a tick box in the cruise card if the player wants to disable it."

**What Synthwave City does** [O: read in `../Synthwave_City/src/post/grade.ts` and `src/app/app.ts`]. One block inside its grade effect, after the tone curve, gated by a uniform `uCrt` (0 off, 0.7 when on, `CRT_STRENGTH` in `app.ts`):

- scanline: `line = .5 + .5 cos(px.y * 2pi / pitch)`; `scan = 1 - uCrt * .6 * (1 - .45 * lum) * (1 - line)`, so a bright beam fills its gap;
- grille: three cosines at the same pitch on `px.x`, 120 degrees apart, mixed in at `uCrt * .3`;
- light kept: the product is divided back by `mix(1, 1 / kept, .8)`, `kept = (1 - .5 * uCrt * .6)(1 - .5 * uCrt * .3)`;
- corners: `c *= 1 - uCrt * .35 * smoothstep(.18, .5, dot(q, q))`, `q = uv - .5`;
- pitch: `max(3, 3 * devicePerCss)` drawing-buffer pixels, so a line is 3 CSS px at any pixel ratio. Not rounded.

Synthwave City's setting defaults to off; here it defaults to on, per the request.

**What Midnight Vector has today** [O: read at `e07a28a`]. `src/render/fx/crt.frag.glsl` is T06's custom Crt effect: glitch, flash, a subtle integer-period scan (`SCAN = .1`, `scanAmpFor`, `scanPeriodFor` in `quality.ts`), grain, and the final alpha write. It runs after tone mapping and before the library's vignette in every variant (§6.6), so a Synthwave City block placed in it sees the same tone-mapped colour the City's block sees. `computePostParams` (`postParams.ts`) zeroes scan and grain in the `min` and `bare` variants. Settings live in T08's `src/ui/storage.ts` (`mv.settings.v1`), reach the app through `UiCommands` at mount and on change, and the app writes them into `FrameView` (`src/app/commands.ts`), as `setReducedMotion` does.

**Constraints that shape the port** [O: Agents.md and `tests/unit/fx/crtSource.test.ts`]:

- The library's UV-transform check is a text match: the shader may define only `mainImage` and may not contain `mainUv`. The crtSource test also bans the substring `time` anywhere in the file, comments included (so no "times", "sometimes").
- No effect-level switches and no runtime program-key flips. A uniform with an `if` on it is neither: same program, same draws.
- No early exit under a non-uniform condition. `uCrt` is uniform, and the block takes no derivatives.
- `smoothstep` edges must ascend. The City's `(.18, .5)` do.

**Terms.** *CRT on / off*: the player's box. *City block*: the scanline, grille, light-kept and corner lines above. *Today's scan*: T06's `SCAN = .1` integer pattern.

## 3. Scope

**This plan owns** only this file. Its code goes through the owners' plans, reopened by the operator's approval of this one, as T13 did. Each reopened plan gets a Progress entry, Decision log rows, a revision note and a bumped `updated`, sets `in-progress` at its first change and `done` again when its part of section 7 has run.

| Plan | Paths touched | What changes |
|---|---|---|
| T00 | `src/contracts/index.ts`, `src/testing/scriptedFrame.ts`, `src/testing/fakeHost.ts`, `plans/README.md` | The additive contract lines of section 12; fakes default to CRT off; the README index row |
| T06 | `src/render/fx/crt.frag.glsl`, `crt.ts`, `postParams.ts`, `quality.ts`, `src/render/fx/dev/**`, `dev/fx.html`, `tests/unit/fx/**`, `tests/visual/fx.spec.ts` | The City block in the Crt shader, its two uniforms, the pitch, `?crt` on the fx dev page |
| T08 | `src/ui/**`, `tests/unit/ui/**`, `tests/visual/ui.spec.ts`, `dev/ui.html` | The CRT box, its label, the stored setting, the card layout |
| T10 | `src/app/**`, `tests/unit/app/**` | `setCrt`, `view.crt`, `?crt=0|1`, the harness default |

`architecture.md` has no owner. Its edits (§6.6's Crt row, §7.2's cruise card, the §8.1 fence lines, §12's T14 row, §13's decision row) are the operator's, made by this plan's executor on approval and recorded as DI-123 in `plans/RECONCILIATION.md`.

**Non-goals:**

- No change to bloom, tone mapping, CA, vignette, grain, flash or glitch. No change to the tier table or the variants.
- No new package, no asset file, no new pass and no new program.
- No CRT strength slider; the box is on or off at the City's 0.7.
- `README.md` (T12) is not touched; a line there is a follow-up at the operator's word.
- Nothing is committed or pushed by this plan. A push to `main` publishes the game.

## 4. Interfaces

**Consumed**, all from `src/contracts/index.ts`: `FrameView`, `UiCommands`, `PostVariant`, `HarnessHost`.

**Provided**, additive (section 12): `UiCommands.setCrt(on)`, `FrameView.crt`, and the `?crt` page query in the `HarnessApi` comment block.

## 5. Plan of work

**M1. Contracts (T00).** Add the lines of section 12. Fakes and scripted frames set `crt: false`. Result: `npm run typecheck` fails only where a `FrameView` literal lacks `crt` and a `UiCommands` lacks `setCrt`, and each such site is fixed in its owner's milestone. Proof: typecheck green at the end of M4.

**M2. The shader (T06).** In `crt.frag.glsl`, two uniforms, `uCrt` (0 or 0.7) and `uCrtPitch` (integer drawing-buffer pixels, at least 3), and the City block, in the City's order: after flash, in place of today's scan line when `uCrt > 0`, before grain. Today's scan runs only when `uCrt == 0`, so the two patterns never beat against each other. `postParams.ts` gains `crt` and `crtPitch`: `crt = v.crt ? CRT_STRENGTH : 0` in every variant, and `crtPitch = max(3, round(3 * pixelRatio))`. `crt.ts` writes them in `apply` with no allocation.
Two deliberate differences from the City, both in the Decision log: the pitch is rounded to an integer, as `scanPeriodFor` already is here, so every line is the same and nothing creeps at fractional ratios; and the block runs in all four variants, because it costs a few ALU per pixel in a pass that already runs, and a player who leaves the box on should see it at every tier.
Proof: crtSource test still green (no `mainUv`, no `time`); a unit test that `computePostParams` gives `crt = 0` and today's `scan` with `v.crt` false, and `crt = .7`, `scan` unchanged, `crtPitch` 3, 5 and 6 at ratios 1, 1.5 and 2 with it true.

**M3. The setting and the box (T08).** `Settings.crt: boolean`, default `true`; absent or not a boolean in a stored object loads `true`, so a store from before T14 loads with the CRT on, as a new player gets it. The box, labelled **CRT**, goes in the MUTE and CAMERA row: MUTE, CRT, then the camera button in one column with its short label `CAM` where the grid has three columns. In the two-column layout the row gets a second line; M5 measures whether that makes the card scroll on the short landscape phone geometry the existing ui spec checks, and if it does, the executor stops and puts the layout to the operator (section 7, HC-C3). REDUCED MOTION stays the last control for the focus trap. Mount sends `cmd.setCrt(settings.crt)` with the others; a change sends it and persists.
Proof: unit tests for load, save, default and the old-store case; the ui spec's card geometry rows.

**M4. The app (T10).** `view.crt`, written by `setCrt`. `parseParams` reads `?crt=0|1`, which forces the CRT over the player's choice, in any mode, like `?tier`. Under `?harness` with no `?crt`, the CRT is forced off, so every existing harness spec, art gate and reference image measures the frame it was drawn for. The real build without a query follows the player's box.
Proof: unit tests on `parseParams` (`?crt=1`, `?crt=0`, bad value warns and is ignored, harness default off) and on `setCrt`.

**M5. Look, gates and docs.** Run everything in section 7. Take screenshots with the CRT on at DPR 1, 1.5 and 2 on two palettes, view them, and compare with Synthwave City's own look at the same pitch. Write the `architecture.md` edits and DI-123.

## 6. Concrete steps

```powershell
cd C:\highsierralabs\Midnight_Vector
npm run plans:check
npm run typecheck
npx vitest run tests/unit/fx tests/unit/ui tests/unit/app
npm run check:task -- T06; npm run check:task -- T08; npm run check:task -- T10
npm run check
npx playwright test tests/visual/fx.spec.ts tests/visual/ui.spec.ts --project=gpu
npm run test:smoke
npm run test:art
```

## 7. Validation and acceptance

1. **Off is today, bit for bit.** On `dev/fx.html` and on a `?harness` render, a frame with `?crt=0` matches the same frame at `e07a28a` byte for byte, on the `gpu` project at MSAA 0. Negative control: the same comparison with `?crt=1` differs.
2. **Every existing gate holds.** `npm run check`, `test:smoke`, `test:art`, `npx playwright test tests/views --project=gpu` and the fx and ui visual specs pass with no reference image regenerated and no limit changed.
3. **On draws the City block.** A pure-JS port of the block applied to a known input row matches the GPU output on `dev/fx.html?crt=1` within 1 level. Scanline period measured in a flat grey frame is 3, 5 and 6 rows at ratios 1, 1.5 and 2 (rounded, per M2).
4. **The box works.** Playwright, real gestures only: a fresh context launches with the CRT on (`data-mv="crt"` checked); clearing the box changes the canvas and reload keeps it cleared; ticking it brings it back. A stored object from before T14 loads with the box ticked.
5. **The card grows by no row** at the geometries the ui spec already checks, three-column and two-column; or, if two-column grows, the executor has stopped and asked (M3).
6. **No new program and no cost.** `gl.linkProgram` spy reads 0 links across ten toggles; draw calls unchanged; frame time with the CRT on is within noise of off on the smoke budget (vsync on, idle machine).
7. **Looked at.** Screenshots at 1920 x 1080 on, off, and on at DPR 1.5 and 2, viewed and described in Progress. The CRT-on frame's art metrics are measured and reported, not gated: the grille raises per-pixel chroma and the scanlines lower floor black by design.

**Human checks:**

- **HC-C1** Does the CRT look right in play on the operator's monitor, and like Synthwave City's?
- **HC-C2** On the operator's Android phone and tablet over the tailnet: no moire or shimmer at the phone's pixel ratio, and the card does not scroll in landscape.
- **HC-C3** Only if M3 finds the two-column card grows: where the CRT box goes.

## 8. Idempotence and recovery

Every step is safe to re-run. The tree is clean at `e07a28a`, so `git restore` and `git clean` on the touched paths return to the start. The new setting is a field in the same `mv.settings.v1` object; clearing site data resets it.

## 9. Progress

- [x] 2026-11-18T00:35Z Plan drafted from a read of both projects; no code changed. Awaiting the operator's approval.
- [x] 2026-11-18 **Approved by the operator**, verbatim: "Plan approved, when you're finished bring up the tail net server so I can test it over tailscale." Status `in-progress`. T00, T06, T08 and T10 reopened for their paths (amendment CR).
- [x] 2026-11-18 M1: the three contract lines of section 12 in `src/contracts/index.ts` and in `architecture.md` §8.1's fences; `contracts:check` PASS, 7 files. Scripted frames carry `crt: false`.
- [x] 2026-11-18 M2: `crt.frag.glsl` gains `uCrt`, `uCrtPitch` and the City block, with today's scan in its `else`; `quality.ts` gains `CRT_STRENGTH` .7 and `crtPitchFor`; `postParams.ts` writes `crt` and `crtPitch` in every variant; `crt.ts` writes both uniforms in `apply`. Dev only: `PostOptions.crt` and `dev/fx.html?crt=0|1`.
- [x] 2026-11-18 M3: `Settings.crt`, default and fallback `true`; the **CRT** box (`data-mv="crt"`) between MUTE and the camera button; mount sends `setCrt`; the camera button always shows its short label in the three-column grid and takes a line of its own in the two-column grid (windows 480 px wide or less).
- [x] 2026-11-18 M4: `parseParams` reads `?crt`, `?harness` alone gives `false`; `createCommands` takes `crtForced`; boot sets `view.crt = params.crt ?? true` before mount.
- [x] 2026-11-18 Whole-repo `npm run check` exit 0: 124 files, **2067 passed, 2 skipped**; `glsl:check` 195 files, 0 hits. `plans:check` 0 problems once §12's T14 row was in.
- [x] 2026-11-18 **Acceptance 1, off is today.** A throwaway probe (not kept) hashed 33 final frames in the page: 30 on `dev/fx.html` (tiers 0 to 4, palettes 0, 2, 5, plain and with flash .5 and glitch .6) and 3 `renderAt` frames of the harness app (seed 7). Run twice on a worktree of `e07a28a` and once on this tree with the CRT off, all at MSAA 0: **33 of 33 equal across all three runs**. A first run left the app at its tier's MSAA and two of the three app frames differed, which is DI-67's same-state MSAA noise, gone at MSAA 0. Kept test: `fx.spec.ts` "M8 off is the plain frame": `?crt=0` hashes equal to a page that never names it; `?crt=1` differs (negative control); 9 links each.
- [x] 2026-11-18 **Acceptance 3, on draws the City block.** "M8 pitch": scanline period in a screenshot of the flat card, want against got: DPR 1 tier 3, 3.000 / 2.994; DPR 1.5 tier 4 (ratio 1.333, pitch 4), 4.500 / 4.491; DPR 1.5 tier 3, 4.500 / 4.491; DPR 2 tier 4, 6.000 / 6.024; DPR 2 tier 3, 6.000 / 6.024; all within 3%, low-frequency share at most .427. Grille signature (per-channel spread over the three column phases): .0877 on, .0004 off. Measured in sRGB, which is about half the .17 the block gives in linear light.
- [x] 2026-11-18 **Acceptance 4 and 6, the box.** New `tests/e2e/crt.spec.ts`, 3 passed: a fresh visit has the box ticked and the grille on (.090); clearing it gives .0023; nine more toggles end on (.087) with **links 18 before and 18 after**; the stored object holds `"crt":true` and then `false`; a reload keeps it clear and plain; a pre-T14 stored object loads ticked; `?crt=1` and `?crt=0` hold over the box.
- [x] 2026-11-18 **Looked at.** `M8-crt0-p0`, `M8-crt1-p0`, `M8-crt0-p2`, `M8-crt1-p2` at 1920 x 1080, and 1:1 crops of the flat card at DPR 1 and DPR 2. On: fine horizontal lines through the sky and the sun's bands, corners a little darker, colours a touch deeper; off is the frame as it was. The crops show even lines and an even grille, with no moire. At the review scale the 3 px lines are faint, so the look is HC-C1's.

- [x] 2026-11-18 **Acceptance 5, the card.** `ui.spec.ts` on `gpu`, 348 rows: first run 342 passed, 6 failed, every failure a row that lists the card's Tab stops or the stored object exactly (the keyboard row, the three FULLSCREEN Tab rows, the FH desktop review, the reload row). Each now names `crt` in its place; the keyboard row presses the box with Space and reads `setCrt(false)` then `setCrt(true)`; the reload row clears it and reads `setCrt(false)` after the reload. Re-run of those rows: 14 passed. **Every geometry row passed in the first run**, the four short landscape phones included. Looked at: 667 x 375 shows MUTE, CRT and CAM: CHASE on the radios' three columns; 320 x 568 shows MUTE and CRT, the camera button on its own line, and the card whole.
- [x] 2026-11-18 **Acceptance 2, every existing gate.** On `gpu`: `tests/e2e` 67 passed, 9 skipped; `tests/views` 17 passed; `fx.spec.ts` 79 passed, 1 skipped; `tests/art` 43 passed, 9 skipped, **1 failed: `sheet36`, O1 worst .2221 at Toxic Arcade / Olympus (limit .15), 10 of 30 failing.** The same spec run on a worktree of `e07a28a` fails with the same value, .2220718916754159, and all 19 of its `GATE sheet36` lines are identical to this tree's. So the red predates T14 and is not in its paths (section 10). No reference image regenerated, no limit changed.
- [x] 2026-11-18 Final code, nothing under `src/` edited after: `npm run check` exit 0 (124 files, **2067 passed, 2 skipped**; glsl 195 files, 0 hits); `contracts:check` PASS, 7 files; `plans:check` 15 plans, 0 problems. `tests/boundaries/gates.test.ts` pins 15 task rows and 15 plans (T00's CR-2).
- [x] 2026-11-18 `npm run build` done; the tailnet preview on 5173, already running from 2026-11-11 (`vite preview --port 5173 --strictPort`, PID 4392), serves the new `dist/` [O: `index-COSTYvZy.js` and `app-BiIvCetz.js` return 200 on 127.0.0.1 and on the tailnet name, and the served app chunk contains `uCrtPitch`]. Stopping and restarting it was refused by the session's permission check, and was not needed.

## 10. Surprises and discoveries

- `npm run plans:check` reports one problem with this draft: "T14: no row in architecture.md section 12" [O: 2026-11-18T00:35Z]. Expected: the row is an operator edit made on approval (section 3), and the check goes green with it.

- Midnight Vector already has a scanline in its Crt pass, at 1/10 the City's depth and with a hard-edged integer pattern [O: `quality.ts` `SCAN = 0.1`, `crt.frag.glsl`]. Two patterns at nearly the same pitch would beat, hence M2's either-or.
- The crtSource test bans the substring `time` in the shader, comments included, stricter than the library needs [O: `tests/unit/fx/crtSource.test.ts`].
- **Measured grille depth is about half the City's linear figure.** The block is mixed in linear light and the last pass encodes to sRGB, so the three-phase spread on final 8-bit pixels is .088 where the block gives .17 [O: M8]. Gates on the CRT frame are written in encoded units.
- **Same-state frames differ at MSAA 2 or 4.** The first byte probe left the app at its tier's MSAA and 2 of 3 app frames differed between the old and new trees; at MSAA 0 all 33 matched in three runs [O]. That is DI-67's noise, not a T14 change.
- **`sheet36` is red at `e07a28a`, before T14.** O1 .2221 at Toxic Arcade / Olympus, 10 of 30 pairs over .15, identical on both trees [O]. T11's last recorded run read .1421 [O: `plans/T11-art-pass.md`, round a24]; T13 changed the props layer and ran only `metrics` and `motion` of `tests/art` [O: `plans/T13-views.md` section 6]. So the change most likely came with T13 [I, not bisected]. Left for the operator: it is in T05's and T11's ground, not T14's.

## 11. Decision log

| # | Decision | Rationale | Date | Author |
|---|---|---|---|---|
| C-1 | The City block replaces today's scan while on; off is today's frame exactly | Two scan patterns beat; off as today keeps every gate and reference image valid with no regeneration | 2026-11-18 | T14 executor, for approval |
| C-2 | Integer pitch, `max(3, round(3 * ratio))` | Same rule as `scanPeriodFor`; identical lines at fractional ratios. Differs from the City, which does not round | 2026-11-18 | T14 executor, for approval |
| C-3 | On in all four variants | A few ALU in a pass already running; a player's setting should not vanish at low tiers | 2026-11-18 | T14 executor, for approval |
| C-4 | `?harness` defaults the CRT off; `?crt=0|1` forces it | The art gates and references were drawn for the plain frame; the CRT's own look gets its own tests | 2026-11-18 | T14 executor, for approval |
| C-5 | Old stores load with the CRT on | The request makes it the default; a returning player has never chosen it off | 2026-11-18 | T14 executor, for approval |

## 12. Contract change requests

Open, additive:

```ts
export interface FrameView {
  // ...
  reducedMotion: boolean;
  /** T14. The CRT screen (scanlines, grille, tube corners) is on. */
  crt: boolean;
}
export interface UiCommands {
  // ...
  /** T14. The CRT screen from now on. */
  setCrt(on: boolean): void;
}
// HarnessApi comment block: "In any mode, ?crt=0|1 forces the CRT screen over the player's choice; under ?harness it defaults to 0."
```

## 13. Outcomes and retrospective

**Result against Purpose.** The game draws Synthwave City's CRT block (scanlines that a bright beam fills, an RGB aperture grille, light given back, tube corners, strength .7) whenever the cruise card's new **CRT** box is ticked, which it is for a new player and for any store from before T14. Clearing it draws the frame drawn before T14, byte for byte at MSAA 0 on the 33 frames probed. The choice is stored, a toggle links no program and adds no draw, the card grows by no row on the landscape phones, and the sim, world, audio and HUD are untouched.

**Gaps and what was not verified.** HC-C1 and HC-C2 passed (below). Frame time with the CRT on was not measured on the smoke budget (acceptance 6's last clause): the change is a few ALU in a pass that already runs and no draw, but that is an argument, not a measurement [I]. Only the RTX 4070 SUPER ran the GPU rows; no phone GPU has run the shader. The byte probe covered 33 frames, not every state. `sheet36` is red, before and after T14 alike (section 10).

**Lessons.** A test that reads 8-bit output measures the encoded image, so a linear-light figure from another project's source needs converting before it becomes a threshold. A byte comparison across trees needs MSAA 0, as DI-67 says.

**Human checks:** HC-C1 passed: the operator reports the CRT looks right and matches Synthwave City (2026-11-18). HC-C2 passed: on the phone and tablet over the tailnet, no shimmer or banding seen, and the cruise card fits in landscape (operator, 2026-11-18). HC-C3 did not arise: the card does not scroll.

## 14. Revision notes

- 2026-11-18 Approved by the operator; status `in-progress`, then `done` the same day. M3's two-column case resolved as the plan allowed: the card grows by a line only at 480 px wide or less, and does not scroll there, so HC-C3 did not arise. Not committed.
- 2026-11-18 HC-C1 and HC-C2 passed on the operator's report; committed and pushed at the operator's request.
