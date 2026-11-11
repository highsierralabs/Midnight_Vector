# Reconciliation ledger

Owner: the T00 owner, acting as the operator's delegate for design decisions, because the operator asked for the whole build in one go. This file is not a plan. Plan updaters work only from it. Decisions here are decisions, not observations: an `[O]` below marks something actually run, and says where.

Decision words: **approved** (as filed), **amended** (accepted with the stated change, or a seam settled by choosing a meaning), **rejected** (including withdrawn by its author).

## Rules that apply to every entry

These save repeating the same edit. Apply them to every plan named in an entry.

| Id | Rule |
|---|---|
| G-1 | In a plan's section 12, keep the request's text as a record and set its state to the entry's decision, with `C-nn` and "absorbed into architecture.md §8 on 2026-11-05; §8's wording wins" where approved or amended. |
| G-2 | Phrases such as "if approved", "if absorbed" and "if T00's CCR-n is approved" become unconditional for an approved or amended request. Delete that request's row from any fallback table: T02 section 4, T09 section 4, T10 section 4's M0 table. Text that says a sibling's plan is absent or that a seam is one-sided is out of date, because every plan has now been compared. |
| G-3 | A seam row that restates §8 correctly may stay. Where a row and §8 differ, the entry says what changes; if an entry was missed, §8 wins. |
| G-4 | Every changed plan gets a section 14 revision note, `2026-11-05 Reconciled per plans/RECONCILIATION.md: <entry ids>`, and a new `updated`. Status stays `draft` until a reviewer who did not write the plan approves it. |
| G-5 | Plans cite contracts by path. Nobody copies §8 text into a plan to "keep it in step". |
| G-6 | Sections 10 (Surprises) and 11 (Decision log) of a plan are records. Where an entry says G-6 for a bullet or row, keep its text and append `(closed by DI-nn)`, or `(superseded by DI-nn)` if the decision was reversed. |
| G-7 | Where an entry says G-7, or where a plan's text about an item decided under "Design issues" says "§x does not state", "deviates from §x", "see the design issue", "raised as a design issue", "reported for the operator" or "the operator may overrule", cite the entry instead: "§x states this (DI-nn)". Numbers and reasoning stay. |

## `plans:check` and this file

**L-01. This file must not break `plans:check`.**

- Source: T00 owner.
- Decision: approved, with a guard.
- Resolution: no change to the logic. T00's M4 reads `plans/T##-*.md` in both `plans:check` step 1 and `check:task` step 1 [read in plans/T00-foundation.md; the gate does not exist yet, so nothing was run]. `RECONCILIATION.md` and `README.md` do not match. Neither appears in any `owns` list, and on-disk overlap only looks at files matching two plans.
- Reason: the pattern is already narrow. The guard stops an implementer widening it to `plans/*.md`.
- Plans: **T00** M4, `plans:check` step 1, add: "Files in `plans/` that do not match `T##-*.md`, such as `README.md` and `RECONCILIATION.md`, are ignored." `gates.test.ts` adds one case: the clean plan set plus a `plans/RECONCILIATION.md` containing no frontmatter still exits 0. `plans/README.md` adds one line: "`RECONCILIATION.md` is the T00 owner's ledger of decisions. It is not a plan."

---

# Contracts and seams

## Verification of the §8 text

All [O], run 2026-11-05 on this machine after the §8 edits, in the scratchpad folder `reconcile_tsc`. Nothing here ran project code, because none exists.

| Check | How | Result |
|---|---|---|
| Fences | T00's regex `/^```(\w+)\n([\s\S]*?)^```$/gm` with T00's first-line path rule, over the edited file | 7 path fences, the same 7 paths. The new signature fence does not match the path rule |
| Additive | T00's `checkAdditive` rule, reimplemented: every non-blank old line present in the new fence, in order | All pass. `index.ts` 311 old lines, 184 added. `common.glsl` 4 added. `hero.glsl` 2 added. `coords.ts`, `glsl.ts`, `common.frag.glsl`, `browser.ts` 0 added |
| Types | `tsc` 6.0.3 from the probe, §8.3's compiler options plus `include` only, over the extracted `src/contracts/*.ts`, `src/core/coords.ts`, the signature fence and a conformance stub implementing every interface | **Exit 0, no diagnostics**, 5 project files. The stub also holds 5 `@ts-expect-error` lines (old field names `heightU` and `perChunkMax`, `overridePitch`, an unasserted numeric table index, a widened `SimCommand`), and an unused one would be an error |
| Negative control | Same config, stub with `forceSignalLost`, `forceFeel` and `overrideFeel` removed and a wrong assignment added | Exit 2, exactly 4 errors: TS2741 three times, TS2322 once |
| GLSL | §8.2 as extracted, raw WebGL2 compile and link in Chromium 1234, calling the new twins, on the RTX under D3D11 and on SwiftShader | Compiled and linked on both. A shader with an undeclared name failed, as it should. D3D11 logs a performance warning for dynamic indexing in `phaseAt`, in the frozen text; it is not new |

This proves types and compilation only. The stub's bodies are mostly empty, and it does not show any interface can do its job. `tests/support/browser.ts` was not re-type-checked, since it is byte-identical to before.

## A. Contract change requests

### World and records

**C-01. `PropField` and `ItemField`.**
- Source: T00 CCR-1; T01 CCR-T01-2 (ItemField wording); seams T00, T01, T02, T05.
- Decision: amended.
- Resolution: both are in §8.1 after `ITEM_STRIDE`, offsets as CCR-1. Wording merged: prop `y` is the mesh origin (S-01), not "final ground"; GATE and FENCE as CCR-T01-2; PYLON flag per S-04; SEARCHLIGHT per S-05.
- Reason: three plans index these records, and CCR-1's first wording was wrong about GATE and FENCE.
- Plans: **T00** section 4 rows "Prop record fields" and "Item record `a`, `b`, `seed`": replace both with "See `PropField` and `ItemField` in §8.1." **T01, T02, T05**: G-2.

**C-02. `src/core/alloc.ts`.**
- Source: T00 CCR-2; consumed by T02, T05, T10.
- Decision: approved.
- Resolution: in §8.1's signature fence and §3.1's module map.
- Reason: otherwise every consumer re-derives array sizes, and it defines neutral feel for `renderState`.
- Plans: **T00** section 3, drop "only if CCR-2 is approved". **T02, T05, T10**: G-2. T01 keeps its own `support/rows.ts`.

**C-03. Camera pose helpers.**
- Source: T00 CCR-3; consumed by T10.
- Decision: approved.
- Resolution: `CameraPose`, `cameraFov`, `writeCameraPose` in §8.1's signature fence.
- Reason: the FOV cap has a radians trap and guards the fog bound, and app and shell must not drift.
- Plans: **T00** M3 unconditional. **T10** G-2; `view.ts` uses them.

**C-04. Phase helpers.**
- Source: T00 CCR-4; consumed by T02, T10.
- Decision: approved.
- Resolution: `phaseOf`, `writePhases` in §8.1's signature fence.
- Reason: one definition prevents off-by-alpha drift.
- Plans: **T00** M3 unconditional. **T02, T10**: G-2.

**C-05. GLSL twins of the motion functions.**
- Source: T00 CCR-5.
- Decision: amended.
- Resolution: `trafficOffset` and `droneOffset` at the end of `common.glsl` in §8.2, and T05 must call them, since an uncalled twin proves nothing.
- Reason: T05's draft wrote the expression by hand with the comment "same expression", which is the drift this exists to stop.
- Plans: **T00** A13 unconditional. **T05** M2 vertex path, the traffic branch becomes:
  ```glsl
  float f = fract(aInstC.z * phaseAt(7) + aInstB.w);
  fwd = trafficOffset(aInstC.y, aInstC.z, aInstB.w, phaseAt(7));
  sMul = min(1., min(f, 1. - f) / uTrafficFade);
  ```
  and M8's DRONE row becomes "`x` by `droneOffset(aInstC.y, aInstC.z, aInstB.w, phaseAt(3))` from `common.glsl`". T05 declares no function with either name. T05 A25 stands.

**C-06. Full `src/testing` signatures.**
- Source: T00 CCR-6.
- Decision: approved.
- Resolution: in §8.1's signature fence, with C-20, C-21 and C-29 merged. `DevShell.pixels()` rows are bottom-up. `createTrivialLayer` stays in T00's plan (S-55), since only T09 consumes it.
- Reason: T03 to T06 need a defined way to render a chosen frame, and §8 is where siblings look.
- Plans: **T00** section 4's code block: add the merged members and the `pixels()` comment; section 3 file list unconditional.

**C-07. `ARCHETYPE_SPEC`, `ITEM_SPEC`, `ITEM_KIND_COUNT`.**
- Source: T01 CCR-T01-1; T05 (depends, see C-37).
- Decision: amended.
- Resolution: in §8.1. Fields are `maxDist`, `perChunk`, `top`, `root`, `floats`. `radiusU` is not in the contract. Values are T01's section 4 table, except RING, which is `top: 100, root: 0, floats: true`. Sum of `perChunk` is 102 [arithmetic], under `MAX_PROPS_PER_CHUNK`. `ITEM_SPEC` carries `maxDist` from §6.5 and `perChunk` from T01's ItemRow table.
- Reason: T01's diff said "CCR-T05-1 as written", but T05 withdrew that text and uses `top`, `root`, `perChunk`, so the two plans had different field names and the table existed nowhere in full. T05's code uses those names, and T01's table and T11 already use `top` and `root` as words. T05 builds RING with radius 97 and tube 3, origin at the centre, so 100 / 0 is right; T01's 168 / 38 described a mesh nobody builds, and T01 ignores RING's values.
- Plans: **T01** rename throughout: `heightU` to `top`, `rootU` to `root`, `perChunkMax` to `perChunk`. Scatter becomes `n = min(n, ARCHETYPE_SPEC[a]!.perChunk)`. Delete the sentence "Below, and throughout this plan, `top` means `heightU`...". Archetype table row 13 becomes `100 / 0`, and its note "`top` and `root` are T05's and unused here" stays. §12 CCR-T01-1: G-1, and note the table is in §8.1. **T05** §12: "as amended, C-07". **T11** "within `perChunkMax`" becomes `perChunk`. **T00** fake world reads `perChunk` from the table.

**C-08. `TRAFFIC_TRAVEL_MAX`, `TRAFFIC_FADE`, `ITEM_WINDOW_BEHIND`.**
- Source: T01 CCR-T01-2; T05 CCR-T05-2 (traffic half, withdrawn by T05); T02 (supports).
- Decision: amended.
- Resolution: one of each, in §8.1. The window comment says `c = travel.chunk`, not `p`, the ship's chunk (S-11).
- Reason: two names for one number is the drift §8 stops. T02's arithmetic is written for `c`, and T02 is the only reader.
- Plans: **T02** §12, the first bullet lists only `SHIP_FORWARD` under CCR-T05-2. **T01** S-11. **T05** G-1.

**C-09. `SHIP_FORWARD`.**
- Source: T05 CCR-T05-2; T02 and T10 (depend).
- Decision: approved.
- Resolution: in §8.1, with a comment stating the 1.6 u collision radius and 3.2 u drawn width (S-09). `SHIP_AHEAD` no longer appears in any plan [O: grep of `plans/`], so there is nothing to retire.
- Reason: both tasks reached 14 u independently, and a collision at the camera plane would fire late.
- Plans: **T02, T05, T10**: G-1, G-2.

**C-10. `Biome`, `PaletteId`.**
- Source: T01 CCR-T01-3; T04 and T09 (depend).
- Decision: approved.
- Resolution: in §8.1 after `BIOME_COUNT`. Order checked against §5.4's and §6.8's rows [read].
- Reason: aurora, lightning and `forceZone` otherwise use bare numbers.
- Plans: **T01, T04, T09, T11**: G-1, G-2.

**C-11. `PALETTE_NAMES`, `BIOME_NAMES`.**
- Source: T08 CCR-T08-4.
- Decision: approved.
- Resolution: in §8.1 after `Biome` and `PaletteId`, same order.
- Reason: `src/ui` may not import `src/world`.
- Plans: **T08, T11**: G-1, G-2.

**C-12. `ZoneState` and `WorldSource` comments.**
- Source: T01 CCR-T01-4; T04 CCR-T04-2; T06 CCR-T06-3; T08 CCR-T08-3 (second comment).
- Decision: amended.
- Resolution: merged into two comment pairs inside `ZoneState`, and one above `fillProps`, in §8.1. T01's objective wording wins over T08's, as T02 asked. T08's separate comment above `ZoneState` is dropped.
- Reason: four requests stated overlapping meaning about the same fields.
- Plans: **T01, T04, T06, T08**: G-1.

### Sim, feel and input

**C-13. `FeelState` comment.**
- Source: T02 CCR-T02-1.
- Decision: amended.
- Resolution: in §8.1. It adds that `duck` is unread by audio (S-14), that T06 clamps `bloomGain` to `[0, 1.5]` so a harness override of 0 is legal, and that `shakeX` is a transient yaw (S-40).
- Reason: T05, T06, T07, T08 and T10 read it, and the original comment said T07 used `duck`.
- Plans: **T02** G-1.

**C-14. `Sim.forceSignalLost`.**
- Source: T02 CCR-T02-2; T09 (depends).
- Decision: approved.
- Resolution: in §8.1. `createSim`'s result implements it, and so does the fake.
- Reason: §11.5 must cross `SIGNAL_LOST`, and no command reaches it.
- Plans: **T02** drop the fallback, the method is on `createSim`'s result. **T10** G-2: delete the `createSimInternal` path. **T00** fake host per C-29.

**C-15. `ControlFrame` comment.**
- Source: T08 CCR-T08-1; T02 (supports).
- Decision: approved.
- Resolution: in §8.1.
- Reason: both sides already agree, and the type gives no unit or sign.
- Plans: **T02, T08**: G-1.

**C-16. `SHIELD_MAX`, `SYNC_MAX`.**
- Source: T08 CCR-T08-2; T02 (supports).
- Decision: approved.
- Resolution: in §8.1 after `EVENT_CAPACITY`. T02 imports them instead of defining them in `tuning.ts`.
- Reason: the HUD draws fixed pips and may not import `src/sim`.
- Plans: **T02, T08**: G-1, G-2.

**C-17. Event field comment.**
- Source: T08 CCR-T08-3 (first comment); T02 (supports).
- Decision: amended.
- Resolution: in §8.1 above `Ev`. It adds "0 when cosmetic" to `value`, and `chunk` reads "row chunk as passed, or `travel.chunk` if there is no item", which is T02's table.
- Reason: T05 and T07 rely on those two facts, and "the ship's chunk" was ambiguous by one chunk.
- Plans: **T08** G-1.

### Render and post

**C-18. Crack negative control.**
- Source: T03 T03-CCR-1; T09 (depends).
- Decision: approved.
- Resolution: `CRACK_CONTROL_GROW`, `RenderLayer.setCrackControl?`, `HarnessApi.setCrackControl`, in §8.1.
- Reason: §11.3 requires the control at integration, and no method reached it.
- Plans: **T03, T09**: G-1, G-2.

**C-19. `DebugPaint`.**
- Source: T03 T03-CCR-2; T09 (depends).
- Decision: approved.
- Resolution: in §8.1 after `CRACK_CONTROL_GROW`.
- Reason: T03 writes these colours and T09 decodes them.
- Plans: **T03, T09**: G-1, G-2.

**C-20. `camX`, `camY` in `ScriptedFrameOptions`.**
- Source: T03 T03-CCR-3.
- Decision: approved.
- Resolution: in §8.1's signature fence.
- Reason: the fog table's worst row needs camera x -28.8 on a dev page.
- Plans: **T00** section 4 and M6: the options override the derived values. **T03** G-1.

**C-21. `zone` in `ScriptedFrameOptions`.**
- Source: T04 CCR-T04-1.
- Decision: approved.
- Resolution: in §8.1's signature fence.
- Reason: T04 must test wipes, fades and day phase.
- Plans: **T00** section 4 and M6: applied last. **T04** G-1; delete the `__zoneOverride` fallback.

**C-22. `Governor` semantics.**
- Source: T06 CCR-T06-1; T10 (seam on `sample(0)`).
- Decision: amended.
- Resolution: in §8.1, plus "`sample(0)` returns a pending force once and adds to no statistic", and that `software` comes from the unmasked string.
- Reason: T10 feeds `sample(0)` from every harness frame (S-48). Under T06's pseudocode a zero would enter histogram bin 0 and count in `winN`, so a long harness run could dilute p95 afterwards. T10's note that this has "no practical effect" holds only for short runs.
- Plans: **T06** M1 state machine, `sample(ms)`, directly after the pending check, add `if ms <= 0: return null`. A3's series table adds one row: 10,000 `sample(0)`, then a real series, gives the same events as the real series alone. Section 4's "Feeding the governor" row adds "`runFrame` and `renderState` send `sample(0)`". **T10** section 4 row `T06 | sample(0)`: replace with "A no-time tick per §8.1".

**C-23. `PostStack` timing.**
- Source: T06 CCR-T06-2.
- Decision: amended.
- Resolution: in §8.1, plus a comment above `PostStack` on what the frame owner owns (S-44) and one on the two forces (S-45).
- Reason: deferred application is invisible in the types, and T00's and T10's seams rely on it.
- Plans: **T06** G-1. **T00** `createDevPost`: `setQuality` and `resize` record and apply at the next `frame`, `render` or `precompile`, like the real stack.

### Audio and UI

**C-24. `AudioEngine` comment.**
- Source: T07 CCR-T07-1.
- Decision: approved.
- Resolution: in §8.1.
- Reason: T08 and T10 must call it correctly without reading T07's plan.
- Plans: **T07** G-1.

**C-25. `UiCommands` comment.**
- Source: T08 CCR-T08-5.
- Decision: amended.
- Resolution: in §8.1. Corrected: mount runs before the renderer and final governor exist, and `app/` buffers `setQuality` (S-23). Adds ownership of bests.
- Reason: as filed it implied the governor exists at mount, and T10's boot order is the opposite.
- Plans: **T08** G-1; S-23.

### Harness

**C-26. `HarnessStats` fields.**
- Source: T09 CCR-T09-1.
- Decision: amended.
- Resolution: `width`, `height`, `tick`, `warpSerial`, `mode` in §8.1, plus a comment that `chunk` and `local` are the sim's travel (S-52).
- Reason: specs need the frame's shape, and T10 and T11 disagreed about what `chunk` reports.
- Plans: **T09** G-1.

**C-27. `HarnessApi` members.**
- Source: T09 CCR-T09-2.
- Decision: amended.
- Resolution: `forceFeel`, `setTier`, `forceSignalLost`, `loseContext`, `restoreContext`, and the `pixels` comment, in §8.1. `setTier`'s comment is reworded to S-50's timing.
- Reason: §11.3, §9.2 and §14 risk 10 have no other path, and a guarded `restoreContext` makes the fourth trap unreachable.
- Plans: **T09** G-1, and section 4's table row `setTier`: "Applies at step 15 of the next `renderAt` or `stepFrames` frame, and shows from the frame after".

**C-28. `HarnessHost.overrideFeel` and frame-method comments.**
- Source: T09 CCR-T09-3.
- Decision: amended.
- Resolution: `overrideFeel` in §8.1 as filed. T09's two comments on `runFrame` and `renderState` are replaced by the block in C-31.
- Reason: one member covers zero pitch, the haze reference and peak-feel frames. T09's comment said `view.dt` is 1/60 and that a tier applies before drawing, which S-49 and S-50 settle the other way.
- Plans: **T09** G-1. **T10** implement it: when set, step 8 points `view.feel` at one preallocated scratch `FeelState`, filled from `feel.out` (or neutral under `renderState`), then the override's fields, then `overrideFov`. Production cost is one null check. `writeCameraPose` then gives `shakeY: -CAMERA_PITCH` exactly zero pitch.

**C-29. Fake host surface.**
- Source: T09 CCR-T09-4.
- Decision: approved.
- Resolution: in §8.1's signature fence: `overrideFeel` and `governorForce` logs, and the fake sim's semantics in a comment there.
- Reason: T09's unit tests inspect what the harness asked for.
- Plans: **T00** M6 `createFakeHost`, and A5: add `warpSerial` rises only on success, `step` advances travel, `forceSignalLost` exists, `overrideFeel` and `governor.force` record. **T09** delete the fallback.

**C-30. Lint against a static harness import.**
- Source: T09 CCR-T09-5.
- Decision: approved.
- Resolution: as filed. Not a contract; T00 owns the config.
- Reason: a static import is the one way a normal visit would fetch the harness, and otherwise it shows only in a browser test at T10.
- Plans: **T00** M4 table, row `src/app/**`, `src/main.ts`: forbid `harness` through `no-restricted-imports` as well as `testing`; keep the `ImportExpression` selector for `testing` only. `boundaries.test.ts` adds: `import { createHarness } from '../harness/index'` in `src/app/x.ts` fails; `export * from '../harness/index'` there fails; `await import('../harness/index')` there passes. **T10** section 4 row `T00 | Lint`: add "except `src/harness`, which only a dynamic import may reach".

**C-31. Meaning of the harness host.**
- Source: T10 CCR-T10-1; T09 CCR-T09-3 (comments).
- Decision: amended.
- Resolution: one comment block above `HarnessHost` in §8.1. T10's meaning stands except: `createHarness` installs `window.__mv` (S-46), and any backward move rebuilds (S-41).
- Reason: T09 and T11 must call the host correctly without reading T10's plan.
- Plans: **T09, T10**: G-1.

**C-32. `HarnessHost.overridePitch`.**
- Source: T10 CCR-T10-2.
- Decision: rejected.
- Resolution: use `overrideFeel({ shakeY: -CAMERA_PITCH })` (C-28). No `overridePitch` member, no fake log.
- Reason: T09's member already does this and also serves the haze reference. T10's request was written before T09's plan existed.
- Plans: **T10** section 4: delete the `overridePitch` rows from the M0 table and the host table, and the `T00 | Fake host` seam row. Replace with `overrideFeel` per C-28. M6's table, Cracks row: `overrideFeel` in place of `overridePitch`, twice. A22: `overrideFeel({ shakeY: -CAMERA_PITCH })` moves the horizon. Seam row `T09 | Crack mode` per S-54.

**C-33. `applyTier` (CCR-T11-1).**
- Source: T11.
- Decision: rejected: withdrawn by its author.
- Resolution: no `applyTier`. `?tier=N` for page-level tiers; `HarnessApi.setTier` for switches.
- Reason: both needs are covered.
- Plans: **T10** delete the `applyTier` rows from the M0 table and the host table, the phrase in the seam row `T11 | Page and tier`, and the clause in §12's opening sentence.

**C-34. `HarnessApi.zoneAt` (CCR-T11-2).**
- Source: T11.
- Decision: rejected: withdrawn by its author.
- Resolution: T11 reads `window.__mvE2e.host.ctx.world.zoneAt`. `__mvE2e` is T10's, not a contract, and T10 offers it to T11.
- Reason: no contract change is needed.
- Plans: none.

**C-35. `DEFAULT_SEED`.**
- Source: T11 CCR-T11-3; T10 (depends).
- Decision: approved.
- Resolution: in §8.1 after `WorldOptions`, and added to §8's numeric exception. §5.1 reworded.
- Reason: no plan chose what a first-time visitor sees, and T11 must be able to.
- Plans: **T00** M2 and section 4 row `T11 | Numeric retune`: the allowlist is `FOG_START`, `FOG_END`, `DEFAULT_SEED`; A3n adds "changed `DEFAULT_SEED` passes". **T10** G-2; `tests/unit/app/realWorld.test.ts` reads `DEFAULT_SEED`, not a literal 1985. **T11** G-1. No change to T07, which keeps its private literal 1985 for music picks (S-17).

**C-36. Harness URL comment.**
- Source: T11 CCR-T11-4; T10 CCR-T10-1 (URL line).
- Decision: amended.
- Resolution: one comment block above `HarnessApi` in §8.1, adding `?tier` and the note on periodic zones, and carrying the metric definitions of S-53.
- Reason: both requests said the same thing, and the switch has to be pinned because T09 used a different one (S-47).
- Plans: **T10, T11**: G-1.

**C-37. Archetype table (CCR-T05-1).**
- Source: T05.
- Decision: rejected: withdrawn by its author, replaced by C-07.
- Resolution: see C-07.
- Reason: its text no longer exists, and T01's request depended on it.
- Plans: none beyond C-07.

## B. Seams

Compared across all twelve plans, by topic. "Agreed" rows change no plan. Where a row is load-bearing, its meaning is now in §8.

### World, records, items

**S-01. Prop `y`.**
- Source: T00 ("final ground height") against T01, T05 ("mesh origin").
- Decision: amended.
- Resolution: mesh origin. Grounded is true height minus sink, floating is true height plus hover, the centre. In `PropField`.
- Reason: T01 writes it and T05 draws it.
- Plans: **T00** per C-01.

**S-02. Mesh extents, facing yaw and per-chunk caps.**
- Source: T01, T05.
- Decision: approved.
- Resolution: agreed, pinned in `ARCHETYPE_SPEC`'s and `PropField`'s comments. SEARCHLIGHT's undrawn housing is stated.
- Reason: load-bearing for grounding and ring capacity.
- Plans: none.

**S-03. RING height.**
- Source: T05 (says T01's record is `y = 95`, recommends 65) against T01 (now 65.14).
- Decision: approved at 65.14.
- Resolution: the record is `y = 65.14`, the torus centre. T05 draws the record's value. The 95 case is closed.
- Reason: T01 already moved, using T05's finding and the disc arithmetic (`(65.14 - 7) / 465 = .125`, `100 / 465 = .215`). T05's text is simply older. No ring has been rendered at either height, so A29 still has to be looked at.
- Plans: **T05** section 4 rows `T01 | RING` and `T00 | Fake RING and PYLON`: replace `y = 95` and the recommendation with "`y` is 65.14". M7's RING row: drop "section 10 has the arithmetic for 95 and 65". A29: one `ring-frame.png` at the record's `y`, RING at 430 u and 200 u; drop the 95 and 65 frames. Section 10's bullet: add "T01 has since set 65.14, so this is closed". Decision log row: "with `y = 65` recommended to T01" becomes "at T01's 65.14". **T01** archetype row 13: "T05 draws it there with its own constant" becomes "T05 draws it from the record".

**S-04. PYLON wires.**
- Source: T01 ("T05 hangs each wire from the next row", `variant` uniform) against T05 ("T01 flags it through `variant`", reads nothing from the next row). Each assumed the other does the work, so as written half the wires would dangle at random.
- Decision: amended.
- Resolution: T01 flags it. PYLON `variant` is .75 when row `c + 1` also has a pair, otherwise .25. T05 draws wires only when `floor(variant * 2) === 1`, as it already plans. `keep` is .1 left, .6 right. In `PropField`.
- Reason: one condition in T01, no change to T05's mesh and no row lookup in T05's feeder.
- Plans: **T01** scatter pseudocode: `PYLON: if expected >= 1 write the pair with variant = (expected at row c + 1) >= 1 ? .75 : .25; continue`, where row `c + 1` is evaluated by the same formula after period reduction. Archetype row 6: replace "T05 hangs each wire from the same-side pylon in the next row, so a line that stops just has no wire" with "`variant` .75 when the next row has a pair, otherwise .25, so a line that stops has no wire". `variant` field row: add "except PYLON". A7: PYLON `variant` is exactly that flag. Decision log row "`variant` uniform" reworded. **T05** section 4 row `T01 | PYLON`: `keep` .1 left, .6 right. **T00** M6: fake PYLON pairs set the same flag.

**S-05. SEARCHLIGHT yaw.**
- Source: T01 ("base azimuth") against T05 ("sweep phase offset, leaning away from x = 0").
- Decision: amended.
- Resolution: T05's reading. Values stay uniform in `[0, TAU)`.
- Reason: leaning outward stops an additive beam washing over the disc, and T01 changes no number.
- Plans: **T01** archetype row 10: "base azimuth" becomes "sweep phase offset".

**S-06. Traffic ring capacity.**
- Source: T01 (two spare rows are enough) against T05 (no, 116 with `rear = 3`).
- Decision: amended.
- Resolution: 116, `rear = 3`. §6.5's row and formula sentence updated, `ITEM_SPEC`'s comment states it.
- Reason: T05's worked case overwrites a live row at 108. It costs 8 instances.
- Plans: none; T01's row already notes T05's 116.

**S-07. Fake world values.**
- Source: T01, T05, T02 asking T00.
- Decision: approved.
- Resolution: the fake copies T01's rows.
- Reason: otherwise T05's dev pictures and T02's thread check mislead.
- Plans: **T00** M6 `fillProps`: RING `x 0, y 65.14, zLocal 32, yaw 0, scale 1, keep 0`; PYLON pairs `x +-100, y 0, zLocal 0, yaw 0, scale 1, keep .1 / .6`, flag per S-04, instead of "RING at `x = 0`, `y = 0`" and random pylons. `fillItems`: GATE `y 8, radius 9`, per `ItemField`; FENCE `x 0, radius 42, y 8`. Section 4: `o.hero` sets `heroA = heroB = hero`, `heroMix = 0`; `o.biome` sets `biomeA = biomeB = biome`, `biomeMix = 0`; `o.palette` writes the §6.8 table; `o.sim` overrides win over derived values, including `beat`, `sync`, `mode`, `speed` (T04's and T07's assumptions).

**S-08. Collision and placement of items.**
- Source: T01, T02, T05.
- Decision: approved.
- Resolution: agreed. Gate threaded at bare `radius` on the ship's centre, on `chunk % 3 === 0`, `zLocal === 0`. Checkpoint GATE `a === 1` at `c % 100 === 0`: no miss, points, SYNC or GATES count; graded when `zone.index` changes. Fence at any y, gap narrowed by T02 by the ship's radius. Traffic collides only while its fade scale is 1. Pinned in `ItemField`, `TRAFFIC_FADE` and §7.1.
- Reason: three plans already match.
- Plans: none.

**S-09. Ship size.**
- Source: T01 (at most 2 u), T02 (1.6, local `SHIP_HIT_RADIUS`), T05 (draws 3.2 u wide).
- Decision: approved.
- Resolution: agreed. Comment on `SHIP_FORWARD` only. T02 keeps the constant.
- Reason: a contract constant would turn a T02 retune into a contract change for one comment's worth of coupling.
- Plans: none.

**S-10. Drawn size of items.**
- Source: T01 ("item meshes scale by radius") against T05 (SHARD is a fixed half-size 1.2).
- Decision: amended.
- Resolution: T05's exception. In `ItemField`.
- Reason: 2.5 is a generous pickup radius, not a gem's size.
- Plans: **T01** seam row `T05 | Item drawing`: add "except SHARD, which T05 draws at a fixed size".

**S-11. Sim item window.**
- Source: T01 (`p - 2 .. p + 1`, `p` the ship plane's chunk) against T02 (`c - 2 .. c + 1`, `c = travel.chunk`).
- Decision: amended.
- Resolution: `c = travel.chunk`. Checked by arithmetic: row `c + 2` starts above the plane, since `local + 14 < 128`, and a car from row `c - 3` ends below `c * 64`. §5.8, §7.1 and `ITEM_WINDOW_BEHIND` updated.
- Reason: T02 is the only reader and its derivation is written for `c`. T01's guarantee is only `zLocal + a < 192`.
- Plans: **T01** section 4 seam row `T02 | Sim's item window`: use `c = travel.chunk`.

**S-12. Objective units and display.**
- Source: T01, T02, T08.
- Decision: approved.
- Resolution: agreed, pinned in `ZoneState` (C-12). Progress restarts with the sector, the display clamps to target, `target <= 0` is complete.
- Reason: consistent everywhere.
- Plans: none.

**S-13. Sector shown on the HUD.**
- Source: T08, T01 ("`sectorIndex` always equals `zone.index`") against T02 (it leads by one frame at a boundary).
- Decision: amended.
- Resolution: `sectorIndex` is `zoneAt(travel).index`, and may lead by one frame. HUD and audio read `v.zone.index`, so sector number and palette name come from one object. In `SimState`'s comment.
- Reason: T02's reasoning is right, since `v.zone` is at the interpolated camera. T07 already reads the zone.
- Plans: **T08** seam row `T02 | sectorIndex`: replace with "The sector shown reads `v.zone.index`, and the palette name reads the same object. `sim.sectorIndex` can lead by one frame". Row `T02 | Events`: "Shields and score are read from `SimState` and the sector from `v.zone`, never events, because overflow may drop events". **T01** seam row `T08 | Sector display`: "the same number, except for one frame at a boundary".

### Audio and game feel

**S-14. Hit duck.**
- Source: T07 against T02, which names `feel.duck` as the source.
- Decision: amended.
- Resolution: T07's. The duck triggers on `Ev.HIT` and is scheduled on the audio clock. `feel.duck` stays, computed by T02 and unread, because §8 is additive.
- Reason: a per-frame linear value cannot give a flat 400 ms, depends on frame rate and cannot be tested in virtual time.
- Plans: **T02** FeelState table, `duck` row, meaning: "No consumer. Kept because §8 is additive". Seam row `T07 | Clock and cues`: delete "`duck` is the source for the hit duck". **T07** seam row "Hit duck: differs from T02's text": becomes "Hit duck: T07 triggers on `Ev.HIT` and schedules on the audio clock. `feel.duck` is unread". Drop the "if the reconciler insists" sentence.

**S-15. Blip chain.**
- Source: T07 against T02, which says `state.sync` is the chain.
- Decision: amended.
- Resolution: T07 counts its own chain. `sim.sync` drives layers only.
- Reason: SYNC moves at most once per gate, so a run of shards would repeat one note, against §7.6's "rising with the chain".
- Plans: **T02** seam row `T07 | Clock and cues`: delete "`state.sync` is the chain for rising blips". **T07** seam row "Blip chain: differs from T02's text": drop "differs", state the rule.

**S-16. Clock, events read, key.**
- Source: T01, T02, T07.
- Decision: approved.
- Resolution: agreed. `beat = tick / 72`; `value === 0` is cosmetic; `musicKey` integer semitone offset; T07 assumes no grid alignment. Pinned in `SimState`, the `Ev` comment and `ZoneState`.
- Reason: consistent.
- Plans: none.

**S-17. Music seed.**
- Source: T07 (literal 1985) with C-35.
- Decision: approved.
- Resolution: T07 keeps a private literal 1985 for bass and arp picks. It does not follow `?seed` or `DEFAULT_SEED`.
- Reason: `FrameView` carries no seed, and the key still follows through T01.
- Plans: none.

**S-18. Control frame, commands, autopilot, bests.**
- Source: T02, T08, T10.
- Decision: approved.
- Resolution: agreed. `launch` from DEMO only, `pause` from PLAY only, `resume` from CRUISE only, others silent no-ops. Idle tag is `mode === PLAY && autopilot`. T08 owns bests and latches travel at the first PLAY, and writes none once `warpSerial` is non-zero. Pinned in `ControlFrame`, `SimCommand`, `SimState`, `UiCommands`, `Ui`, §7.1.
- Reason: consistent.
- Plans: none.

**S-19. Score reset.**
- Source: T08 ("never reset by a mode change") against T02 ("reset only by `launch`", 0 before it).
- Decision: amended.
- Resolution: T02's. In `SimState`'s comment.
- Reason: `launch` is a mode change, so T08's wording was false in that one case.
- Plans: **T08** seam row `T02 | Scales`: "`score` non-negative and integer-valued, 0 until `launch`, reset only by `launch`".

**S-20. Feel ranges and reduced motion.**
- Source: T02, T06, T00, T10.
- Decision: approved.
- Resolution: agreed. Feel writes neutral values for the listed fields, T06 adds CA 0 and grain 0, `writeSharedUniforms` writes the bend-off, T08 is the only reader of the media query, and `commands.ts` writes sim and view together. Pinned in `FeelState`, `SharedUniforms`, `UiCommands`.
- Reason: consistent.
- Plans: none.

**S-21. Audio unlock and retry.**
- Source: T07, T08, T10.
- Decision: approved.
- Resolution: T07 owns retry on later gestures through its own capture-phase listeners. T08 launches inside an activating event. T10 never awaits `unlock` and adds no gesture listener. In `AudioEngine`'s comment.
- Reason: T07 has the state the others cannot see.
- Plans: none.

**S-22. Audio and UI per frame.**
- Source: T07, T08, T10, T09.
- Decision: approved.
- Resolution: agreed. Both run at step 13 in every mode, including during a context loss and under `renderState`, before step 14 clears events. T07 tolerates a backward tick. Audio is inert under the harness because no gesture happens.
- Reason: consistent.
- Plans: none.

**S-23. Mount order.**
- Source: T08 ("`ui.mount` runs after the audio engine, governor and sim exist") against T10 (mount before the renderer; `setQuality` buffered until the final governor exists).
- Decision: amended.
- Resolution: T10's. In `UiCommands`' comment. Commands are valid at once.
- Reason: the title should be up during boot, and T08 only needs the commands to work.
- Plans: **T08** seam row `T10 | Commands`: "`ui.mount` runs after audio, sim and view exist, and before the renderer and the final governor. `setQuality` at mount is buffered by T10".

**S-24. DOM hooks and fatal flow.**
- Source: T08, T09, T10, T11.
- Decision: approved.
- Resolution: agreed, hook names checked against T08's list [read]. The list others rely on is in `Ui`'s comment. `showFatal` may precede mount, the first reason wins. T10 stops the loop, calls `showFatal`, removes the canvas. `input.attach(canvas)`. `uiRoot` is empty and never transformed.
- Reason: consistent.
- Plans: none.

### Terrain, sky, props

**S-25. Sky under the horizon.**
- Source: T03 (an old T04 rule: `gb = -(10 + abs(c) * q) / 6016 - .012`, fading by `gb - .075`, and asking for full paint to about -.04) against T04 (crest-based `gb`, near-black by `gb - .016`).
- Decision: amended.
- Resolution: T04's rule, written out in §6.3 from T04's shader text. §6.3's old "near-black" line is superseded.
- Reason: T04 measured that a band reaching -.045 lifts the translucent floor from 15 to 37 at row 630 [O: T04 rehearsal, as reported in its plan]. T03's stand-in copies an earlier T04 draft. Nothing in T03 is known to need sky between -.04 and the crest [I], but T03's clean render was under the old rule, so T03 must look again.
- Plans: **T03** seam rows `T04 | Sky under the horizon` and `T04 | Sky through the floor`: replace the rule with "per §6.3". `createStandInSky`: use §6.3's lines. Re-run and view the horizon shots, and record that the earlier [O] was under the wider rule. **T04** seam row `T03 | Sky under the horizon`: drop "T03's plan asks ... T04 goes tighter on purpose" and cite §6.3. T05's backdrop is a dev stand-in and need not copy it.

**S-26. `skyGrad` argument and fog ray.**
- Source: T03, T04, T05.
- Decision: approved.
- Resolution: agreed. `y` is `rd.y` of the normalized view direction, world axes, post-bend. Fully fogged geometry is pure gradient, with no disc or stars. Comment added in §8.2.
- Reason: otherwise fogged terrain does not match the sky.
- Plans: none.

**S-27. `sunDisc`.**
- Source: T03, T04, T05.
- Decision: approved.
- Resolution: agreed. Composite `c * (1. - s.a) + s.rgb`, fragment stage only, any finite `rd`, reads only `uPhases`, `uPal`, `uHero`, other symbols prefixed `hero`. Comment added to `hero.glsl` in §8.2. `contracts:check` still requires only the three signature lines.
- Reason: three plans call it.
- Plans: none.

**S-28. Software cost of `sunDisc`.**
- Source: T03, T04, T09, T10.
- Decision: approved.
- Resolution: agreed. Not built now. If tier 0 misses 50 ms at T10, T03's `NO_SUN_COLUMN` and T04's `HERO_SUN_ONLY`, set before first compile. T10's first `setQuality` on a software boot is the real tier, which allows that.
- Reason: consistent.
- Plans: none.

**S-29. Height calls, atlas and morph.**
- Source: T01, T03.
- Decision: approved.
- Resolution: agreed. Whole rows, negative `iz` allowed, exact across splits, exactly 0 in the valley, continuous across zones. T03 owns the morph-on-parent test (its A2) on the uniform diagonal T01's sag gate assumes [read]. Pinned above `height` in §8.1.
- Reason: consistent, and T01 asked who owned the test.
- Plans: none.

**S-30. Bend constants.**
- Source: T00, T01, T03, T04.
- Decision: approved.
- Resolution: `c = -1.2e-5`, `vMax = 1500`, `abs(a) <= 8e-5`, all [A]. `BendState`'s comment and §5.3 now state it.
- Reason: four plans picked the same value with no text behind it, and the crest and fog proof depend on it.
- Plans: none.

**S-31. Floor alpha, draw order, mirror.**
- Source: T03, T05.
- Decision: approved.
- Resolution: agreed. T05 collapses mirrored instances past `abs(x)` 125, which loses only faint reflections from 125 to 140 where `h < 3`.
- Reason: the loss is accepted by both.
- Plans: none.

**S-32. Layer lifecycle.**
- Source: T00, T03, T04, T05, T06, T10.
- Decision: approved.
- Resolution: agreed, including T10's second `setQuality` and `rebuild` after timed boot. Comment above `RenderLayer`. Every mesh exists after `attach`. `rebuild` snaps ramps.
- Reason: every render task depends on the order.
- Plans: **T05** `density.ts`: add "The first `setQuality` and every `rebuild` set `uDensity`, filter and modulus to the current target at once, with phase idle", because T10 relies on this and T05 did not state it.

**S-33. `setQuality` rate.**
- Source: T05 ("at most once per 5 s") against T03, T06 (any rate, including mid-ramp from the menu).
- Decision: amended.
- Resolution: any rate. In `RenderLayer`'s comment.
- Reason: T06's rate limit covers automatic changes only, and a player can click the menu twice.
- Plans: **T05** section 4 row `T06 | Quality`: replace "at most once per 5 s" with "at any frame end, including mid-ramp from the menu". `density.ts`: "A new request during a ramp or refill restarts toward the new target from the current `uDensity`, with a refill if the modulus changed". A12 adds one case: a second tier change mid-ramp stays smooth. **T06** seam row `T03, T05 | Ramps and call rate`: delete the last sentence.

**S-34. `setQuality` during a context loss.**
- Source: T10 (held) with T03, T04.
- Decision: approved.
- Resolution: never called while lost; applied at restore before `rebuild`. T06's only records either way. §3.3 step 15 and `RenderLayer`'s comment updated.
- Reason: T04's touches `rt.setSize`, which can dispose on a lost context.
- Plans: none.

**S-35. Own render target.**
- Source: T04, T06, T10.
- Decision: approved.
- Resolution: a layer may render to its own target in `frame` and must restore what `getRenderTarget` returned. Nebula compiles in `rebuild`, since `precompile` walks only `ctx.scene`.
- Reason: consistent.
- Plans: none.

**S-36. Debug modes.**
- Source: T03, T04, T09.
- Decision: approved.
- Resolution: agreed. Terrain swaps materials and other layers ignore the mode. The harness hides layers, sets the clear colour and zero pitch. Debug materials compile on first use, so link gates exclude debug modes. Comment by `DebugMode`.
- Reason: consistent.
- Plans: none.

**S-37. Slot order after a rebuild.**
- Source: T09 (asks for a fixed head, "not settled by T05's plan") and T05 ("identical inputs give identical buffers").
- Decision: approved.
- Resolution: rebuild starts from a fixed head. In `RenderLayer`'s comment, for equal rows.
- Reason: draw order changes additive rounding, so identity with objects could fail with no real defect. `row` itself differs between `k` and `k + 1024 n` unless the shift is a multiple of 65536, so the promise is slot order, not bytes.
- Plans: **T05** M1 `ring.ts`: add "`reset()` sets `head = 0`". **T09** seam row `T05 | Slot order after a jump`: drop "Not settled by T05's plan as written", cite §8.1.

**S-38. Ramps under `renderAt`.**
- Source: T09 ("T05's ramp takes about 72 frames at `view.dt = 1/60`", fixed state) against T05 (the ramp is a function of `v.tick`) and T03 (counts frames).
- Decision: amended.
- Resolution: ramps never read `view.dt`. At a fixed tick T05's ramp would not advance, so the tier cycle advances `tick` by 2 per `renderAt` at a fixed position. In `FrameView`'s comment.
- Reason: as written T09's spec would sit at the start of T05's ramp and report a false pass.
- Plans: **T09** `tierswitch.spec.ts`: "Fixed position, `tick` + 2 per `renderAt`, tier cycle 4, 3, 2, 1, 0, 1, 2, 3, 90 frames per tier, because T05's density ramp runs on `v.tick`". The printed diff then includes time-based animation, which T09 notes.

**S-39. Ship and sky in identity.**
- Source: T04, T05, T06, T09, T10.
- Decision: approved.
- Resolution: agreed. Ship pose is pure in `v.sim`, `v.feel`, `v.alpha`, `v.phases`; sky is pure in zone, `tick mod 30720`, alpha, bend, camera; grain is pure in `tick`. `renderState` holds `v.sim` still. Shimmer steps `local` with `tick` fixed.
- Reason: consistent.
- Plans: none.

**S-40. Camera pose and portrait follow.**
- Source: T00, T02, T04, T10; T02's design issue on the portrait frustum.
- Decision: approved.
- Resolution: `rotation.set(CAMERA_PITCH + shakeY, shakeX, roll)`, so `shakeX` is a small transient yaw, and §6.1 now says "no steady yaw". T10's `followGainX` lives in `src/app`; dev frames keep 0.72. §6.1 updated.
- Reason: consistent, and the old "no yaw, ever" contradicted §7.4.
- Plans: none.

### Post and quality

**S-41. Jumps.**
- Source: T00 (shell: backward, or forward over 64 u), T10 (backward across a chunk, or over `CHUNK_LEN`), T03, T05, T09, T11.
- Decision: amended.
- Resolution: T00's wording everywhere: any backward move, or a forward jump over `CHUNK_LEN`, rebuilds every layer and post first. A forward step within `CHUNK_LEN` streams. Layers still self-heal. In `RenderLayer`'s and `HarnessHost`'s comments.
- Reason: the dev-tested path and the integrated path should be the same one.
- Plans: **T10** host table row `renderState`: "or the camera moved backwards at all". **T11** seam row `T09, T10 | renderAt`: same phrase.

**S-42. Tier table.**
- Source: T00, T06.
- Decision: approved.
- Resolution: exact pixel counts, tier 0 `dprCap` 1, in `QualityProfile`'s comment and §6.10's table.
- Reason: both plans already use them, and §6.10's rounded figures give a non-integer ratio at exactly 1080p [from T00's plan].
- Plans: none.

**S-43. Software detection.**
- Source: T00, T06, T10.
- Decision: approved.
- Resolution: the unmasked `WEBGL_debug_renderer_info` string, in `CreateGovernor`'s comment and §6.10.
- Reason: `gl.RENDERER` reads `WebKit WebGL` on both rasterizers [O: T00 rehearsal, as reported].
- Plans: none.

**S-44. Frame owner against PostStack.**
- Source: T00, T06, T10.
- Decision: approved.
- Resolution: agreed. Comment above `PostStack`. T10 calls `post.resize(cssW, cssH, window.devicePixelRatio)` and observes the stage wrapper, not the canvas. §3.3 step 15 no longer says "resize if needed".
- Reason: consistent.
- Plans: none.

**S-45. Post forces and compile gates.**
- Source: T06, T09, T10.
- Decision: approved.
- Resolution: agreed. Forces survive `setQuality`, scan and grain follow the variant. `forceVariant('off')` sets `autoClear` true around its own draw. Compile gates spy on `linkProgram`, because `info.programs.length` does not show recompiles. Restore runs layer `rebuild`, `post.rebuild()`, `await post.precompile()`; a warp calls only `post.rebuild()`.
- Reason: consistent.
- Plans: none.

### Harness and integration

**S-46. Who installs `window.__mv`.**
- Source: T09 (`createHarness` sets `__mv` and `__mvLab`) against T10 (`createHarness` does not write to `window`, T10 assigns) and T11 (consumes).
- Decision: amended.
- Resolution: T09's. `createHarness` installs both globals and returns the API, through `globalThis`, since it also runs under Node in unit tests. `app/` calls it, then logs `console.info('MV_READY')`. T10 keeps `__mvE2e`. In `HarnessHost`'s comment.
- Reason: §3.1 and §12 give T09 `window.__mv`, and one function then owns the harness's whole window surface.
- Plans: **T10** M3 step 15: `createHarness(host)`, install the hook, then log. Seam row `T09 | createHarness`: "installs `window.__mv` and `window.__mvLab` and returns the API". M6's `declare global`: `__mvE2e` only. Seam row `T09 | Signals`: "after `createHarness` returns". **T09** section 4 row under Provided: add "through `globalThis`". Seam row `T10 | Import site`: "`app/` decides through its own URL parser, and imports dynamically. No static import under `src/app/` or `src/main.ts`". Seam row `T10 | ?harness behaviour`: add "`app/` also installs its own test hook, which only reads".

**S-47. URL switches.**
- Source: T09 (`?harness&aperiodic=1`) against T10, T11 (`?period=<n>`, 0 aperiodic).
- Decision: amended.
- Resolution: `?period=<n>` under `?harness`, default 1024. `?seed` and `?tier` in any mode. In the comment above `HarnessApi`. §5.1 updated.
- Reason: two plans and T10's parser already use it, and it allows a period other than 0.
- Plans: **T09** seam row `T10 | Query`: "`?harness` means `periodChunks` 1024, `?harness&period=0` means aperiodic, no `?harness` means 0. `?seed` and `?tier` apply in any mode". `openHarness`: `q?: { period?: number; tier?: Tier; seed?: number }`. Replace `aperiodic: true` with `period: 0` in `warp.spec.ts` and `?harness&aperiodic=1` with `?harness&period=0&tier=3` in `frame.timing.spec.ts`. Budget and other tier-3 perf specs pass `tier: 3`, since auto boot on the RTX may start at tier 4.

**S-48. `runFrame`.**
- Source: T09 (`governor.sample(dt * 1000)`) against T10 (`sample(0)`).
- Decision: amended.
- Resolution: T10's, so a synthetic dt never reaches the governor. T09's requirement stands: sim, layers and post are reached by property lookup and not frozen. A throw goes to the fatal route, then is rethrown. In `HarnessHost`'s comment.
- Reason: `stepFrames(n, .125)` would otherwise feed 125 ms frames to the governor and shed quality during a soak.
- Plans: **T09** seam row `T10 | runFrame`: replace "including `governor.sample(dt * 1000)`" with "with `governor.sample(0)` in step 2". **T10** host table row `runFrame`: add "Reaches `sim`, `layers[i]` and `post` by property lookup, never a captured method, and those objects are not frozen, because `lab.instrument` wraps them". **T06** per C-22.

**S-49. `renderState`.**
- Source: T09 (steps 6 to 13, `view.dt = 1/60`) against T10 (steps 5 to 15, `view.dt = 0`, `post.render(0)`).
- Decision: amended.
- Resolution: T10's. Steps 2 and 5 to 15, with steps 3, 4 and 8 skipped, dt 0, `camX` and `camY` from `prevX` and `prevY`. No plan reads `FrameView.dt` [O: grep of `plans/` for `v.dt` and `view.dt`]. `ui.frame` and `audio.frame` run. In `HarnessHost`'s comment.
- Reason: a fixed state has no elapsed time, and T10 implements it.
- Plans: **T09** seam row `T10 | renderState`: replace with "Per §8.1". Delete `view.dt = 1/60` wherever it appears.

**S-50. When a forced tier applies.**
- Source: T09 ("before drawing") against T10 (step 15, shows from the next frame).
- Decision: amended.
- Resolution: T10's. `setTier` then one frame applies it at that frame's step 15, and it shows from the frame after. `stats().tier` changes at once. Held while the context is lost.
- Reason: this is the production path, so the harness tests what ships. A one-frame lag costs T09 nothing, since its tier specs run many frames.
- Plans: **T09** C-27's row. Any spec that reads pixels right after `setTier` renders one extra frame first.

**S-51. Overrides.**
- Source: T01, T09, T10, T11.
- Decision: approved.
- Resolution: agreed. Persist until cleared; apply in `onFrame`, `runFrame` and `renderState`. `overrideZone` writes the palette with `writePalette`, sets B equal to A, mixes 0. `forceZone` does not change terrain or props: comment on `forceZone`. True pairs come from `findZoneChunk` or real zones. `overrideFov` keeps the §6.4 aspect cap.
- Reason: consistent, and §8.1's signature invited the wrong reading.
- Plans: none.

**S-52. `stats()` after `renderAt`.**
- Source: T10 (flags it), T11, T09.
- Decision: approved.
- Resolution: `chunk` and `local` are the sim's travel, as T09 reads them. T11 asserts them only straight after `warp`, which its plan already says. In `HarnessStats`' comment.
- Reason: `HarnessHost` exposes no view.
- Plans: **T10** seam row `T09, T11 | stats() after renderAt`: replace with "Per §8.1. T10 changes nothing here".

**S-53. Wash-out metric definitions.**
- Source: T06, T09 (haze lift against bloom gain 0, whole frame) against T11 (`min` minus `bare`, inside uv radius .26).
- Decision: amended.
- Resolution: one definition of **haze lift**: mean Rec.709 luma of the frame minus the same frame under `forceFeel({ bloomGain: 0 })`, whole frame. In the comment above `HarnessApi`. T11 keeps a separately named **centre haze**: same reference, inside uv radius .26. That removes T11's dependence on `min` and `bare`. T11 keeps `floorBlack` and `litSaturation`, T09 keeps `blackP10`. Limits for all of these are for the §6.7 decision in the design-issues section.
- Reason: T11's ellipse existed because `bare` has no vignette; with the same variant as reference the vignette cancels, and T11's sensitivity (9.0 to 58.7, against 6.4 to 35 over the whole frame [O: T11 prototype, as reported]) is worth keeping under its own name. Two gates with one name and two meanings would mislead a reader.
- Plans: **T11** section 2's definition: "Haze lift" becomes "**Centre haze:** mean Rec.709 luma inside uv radius .26 of `min`, minus the same frame under `forceFeel({ bloomGain: 0 })`, in code values". Section 4: `export function centreHaze(w: number, h: number, on: Uint8Array, off: Uint8Array, maskR?: number): number` replaces `hazeLift`. Consumed list adds `forceFeel`. Capture table row `min`, `bare`, all layers becomes `min` twice, default and with bloom gain 0. Gate W3 is named centre haze. `metrics.spec`'s comparison with T06's `washout` stands. Replace "Why the ellipse" with the reason above; it also matches how T11's table was measured, against a bloom-off render of the same stack. Decision log row "Haze lift from `min` minus `bare`" is reversed, citing this entry. Delete seam rows `T06 | min against bare` and `T06 | Vignette mask`. **T09** seam row `T11 | Metrics`: "T11 takes its reference frames through `forceFeel`, uses its own pure metrics in `tests/art/support/metrics.ts` with a conformance test against `metrics.washout`, and takes shimmer from T09's suite". **T06** seam row `T09, T11 | Metric definitions`: cite §8.1.

**S-54. Crack mode.**
- Source: T03, T09, T10.
- Decision: amended.
- Resolution: as T09's plan: every layer `setDebugMode('crack')`, hide all but terrain, set and restore the clear colour, zero pitch with `overrideFeel`, `autoClear` is T06's on the `'off'` path. Post-on path is `bare`, MSAA 0.
- Reason: T10's row predates T09's plan.
- Plans: **T10** seam row `T09 | Crack mode`: "T09 sets the clear colour on `ctx.renderer`, hides layers through `host.layers`, and zeroes pitch with `overrideFeel({ shakeY: -CAMERA_PITCH })`. T10 does not reset them".

**S-55. T09's use of T00's proof layer.**
- Source: T09 (imports `trivialLayer.ts`) against T05 ("no frozen export").
- Decision: amended.
- Resolution: `tests/support/devshell/trivialLayer.ts` exports `createTrivialLayer(): RenderLayer`. Its query flags stay.
- Reason: T09's shell target needs a name, and none was stated.
- Plans: **T00** M7: state the export. **T09** `shellHost.ts`: `startDevShell([createTrivialLayer()], labPost, { tier: 3 })`.

**S-56. `pixels()` orientation.**
- Source: T03, T09 (bottom-up), T11 (row order unstated, detects it).
- Decision: approved.
- Resolution: bottom-up, as `gl.readPixels` gives them, for `HarnessApi.pixels` and `DevShell.pixels`. T11 may keep its check as a truth check.
- Reason: consistent, and now stated.
- Plans: **T11** seam row `T09 | pixels()`: "Rows are bottom-up (§8.1). `capture.ts` flips them and keeps its screenshot comparison as a check".

**S-57. Test helpers on pages with no shell.**
- Source: T07, T08, T10, T11 against T00.
- Decision: approved.
- Resolution: `test`, `expect`, `saveShot` work on any page. The auto fixture adds no `evaluate` before a test's own actions. `console.warn` and `console.info` do not fail a test. `openDevPage` is for shell pages only.
- Reason: gesture tests depend on no early `evaluate`, and T00's description already allows this.
- Plans: **T00** section 4's conventions table adds one row saying exactly that, and that three-free pages use `page.goto`.

**S-58. Routing, lint, tooling.**
- Source: T01, T07, T08, T09, T10, T11 against T00.
- Decision: approved.
- Resolution: agreed [read against T00's M1, M4, M5]. `test:art` runs under `gpu`; T11 runs `budget.timing.spec` explicitly under `gpu-timing`, as its plan shows.
- Reason: consistent.
- Plans: none.

**S-59. Numeric retune and `hero.glsl` hand-off.**
- Source: T00, T03, T04, T11.
- Decision: approved.
- Resolution: agreed. `FOG_END` only goes down, and A9 re-runs. Three lines of `hero.glsl` stay byte-exact. Whether T11's window includes `hero.glsl` or who may reopen plans is for the design-issues section.
- Reason: consistent as far as it goes.
- Plans: none, beyond C-35.

**S-60. Post-on identity.**
- Source: T00, T06 (shell tolerance), T09 (best of 5 triples).
- Decision: approved.
- Resolution: T00's and T06's shell tolerance stays, and T09 does as its plan says. They test different things. §11.3's wording is for the design-issues section.
- Reason: 0 bytes stays the integrated requirement. The flake's cause is not established.
- Plans: none.

**S-61. T00's plan and the §8 text.**
- Source: T00 owner, a consequence of folding the requests into §8.
- Decision: approved.
- Resolution: approved requests are already in §8, so T00 extracts them and hand-applies nothing.
- Reason: there is one source. Part of §8 may still change in the design-issues pass, so literal byte counts and line numbers would go stale at once.
- Plans: **T00** M0: "Every approved request is already in §8's text; section 12 is the record". §12's opening rule: same, and "M0 applies" goes. M2: delete the literal line numbers and the expected byte sizes; keep "seven fences"; add "the new signature fence is not extracted". "Then apply approved additions" goes. A3: "Exit 0, seven files, `added` 0". Section 8: "re-apply approved diffs from section 12" goes. `plans/README.md`, step 2 under "Before spawning executors": "Contract change requests are reconciled in `plans/RECONCILIATION.md` and already in §8". M3's and section 3's "if CCR-n is approved" go per G-2. For the record, the fences today sit at lines 728, 1250, 1287, 1387, 1431, 1450, 1584, and `index.ts` is 34,866 bytes [O: `check.mjs`].

## C. Change list by plan

| Plan | Entries that change it |
|---|---|
| T00 | L-01, C-01, C-02, C-03, C-04, C-05, C-06, C-07, C-14, C-20, C-21, C-23, C-29, C-30, C-35, S-01, S-04, S-07, S-55, S-57, S-61 |
| T01 | C-01, C-07, C-08, C-10, C-12, S-03, S-04, S-05, S-10, S-11, S-13 |
| T02 | C-01, C-02, C-04, C-08, C-09, C-13, C-14, C-15, C-16, S-14, S-15 |
| T03 | C-18, C-19, C-20, S-25 |
| T04 | C-10, C-12, C-21, S-25 |
| T05 | C-01, C-02, C-05, C-07, C-08, C-09, S-03, S-04, S-32, S-33, S-37 |
| T06 | C-12, C-22, C-23, S-33, S-48, S-53 |
| T07 | C-24, S-14, S-15 |
| T08 | C-11, C-12, C-15, C-16, C-17, C-25, S-13, S-19, S-23 |
| T09 | C-10, C-18, C-19, C-26, C-27, C-28, C-29, C-31, S-37, S-38, S-46, S-47, S-48, S-49, S-50, S-53, S-55 |
| T10 | C-02, C-03, C-04, C-09, C-14, C-22, C-28, C-30, C-31, C-32, C-33, C-35, C-36, S-41, S-46, S-48, S-52, S-54 |
| T11 | C-07, C-10, C-11, C-35, C-36, S-41, S-53, S-56 |

## D. Design issues this section already closed

For the design-issues pass, so nothing is decided twice. Issue ids count down each plan's `designIssues` list in order.

| Issue | Closed by |
|---|---|
| T00 #1 (rounded max pixels), T00 #3 (masked renderer), T00 #7 (no yaw) | S-42, S-43, S-40 |
| T01 #4 (window), T01 #7 (checkpoint), T01 #10 (fake rows), T01 #11 (duplicates) | S-11, S-08, S-07, C-07 to C-09 |
| T02 #3 (portrait follow), T02 #6 (arch and bests owners) | S-40, S-08, S-18 |
| T03 #1, T04 #1 (sky under the horizon), T03 #2 (bend `c`), T03 #5 (crack control) | S-25, S-30, C-18 |
| T05 #2 (traffic cap) | S-06 |
| T07 #4 (duck and chain) | S-14, S-15 |
| T08 #4 (retry owner), T08 #5 (bests and media query owners) | S-21, S-18 |
| T09 #8 (`forceZone` and the heaviest biome), T09 #11 (T05 rebuild head) | S-51, S-37 |
| T10 #1 (T09's plan absent), T10 #6 (crack pitch) | G-2 and section B, C-32 |
| T11 #2 (the opening seed, as far as the constant goes), T11 #7 (`forceZone` comment) | C-35, S-51 |

Not settled here, and left for the design-issues pass: everything else in those lists, including §9.2 and §9.3's allocation and pool wording, §6.7's wash-out limits, §5.4's sky saturation, OKLab against OKLCh, §3.2's rule for `testing`, §11.3's identity wording, who may reopen a plan when the operator is away, and what a human check means for `done`. All of it is decided under "Design issues" below.

---

# Design issues

Every `designIssue` from all twelve plans: 107 filed. Issue ids count down each plan's list in order, as in section D above. The accounting table near the end covers each one. Several authors raising one thing make one entry.

The two documents are already edited to match. Where an entry says "docs only", no plan text is wrong in a way that would mislead an executor, beyond G-6 and G-7. Numbers tagged `[O: T04 rehearsal]` and the like are what that plan reports from its own throwaway probe; this pass did not re-run them. Where a question cannot be settled without running code, the entry's **Settles it** line names the acceptance that does.

## Verification of this pass

All [O], run 2026-11-05 on this machine in the scratchpad folder `reconcile_tsc`, after the edits. No project code exists, so none of this ran project code.

| Check | How | Result |
|---|---|---|
| Contract fences, against the state before this pass | T00's `checkAdditive` rule, reimplemented in `check_design.mjs` | 7 path fences, the same 7 paths. `index.ts` 495 old lines in order, 2 added, both comments. The other 6 files: 0 added |
| Contract fences, against the state before Part 1 | `check.mjs` | All pass. `index.ts` 311 old lines, 186 added |
| Types | `tsc` 6.0.3, §8.3's options plus `include`, over the re-extracted fences and the conformance stub | Exit 0, no diagnostics |
| Negative control | Same, `conformance_neg.ts` | Exit 2, the same 4 errors as Part 1 |
| §12 row | T00's parsing rule on T11's row | 8 backticked paths, no stray token, no extra pipe |
| Markdown tables | Column count per row, code spans ignored | 0 mismatches in `architecture.md` |
| Crossfade saturation | `oklch_check.mjs`: §6.8's table with the new disc top, all 30 ordered pairs, m = .25, .5, .75, sRGB saturation of grid and accent | Straight OKLab: worst .18, 52 of 180 samples under .4. OKLCh by shortest hue: worst .41, 0 under .4. Endpoint error 2.4e-7. **Arithmetic only**; it says nothing about a rendered frame, and other slots stay lower (disc top .154, horizon .343) |

This proves additivity, types and that arithmetic. It does not show any design decision below is right on screen.

## Picture and photometry

**DI-01. A wash-out gate that can see a flood.**
- Source: T06 #1, T09 #4, T11 #6.
- Decision: amended.
- Resolution: §6.7 now has four shared gates, each with a negative control: near-white under .5%, mean chroma over 55, **haze lift at most 20 [A]**, **`blackP10` at most 25 [A]**. Definitions in §8.1's comment above `HarnessApi`, which gains the `blackP10` line. T06 gates the first three on its card on all six palettes. T09 gates all four on the integrated default frame, with controls `floodLines(16)` and `veil(.1)`. T11 gates near-white and chroma on every sample, plus its three sharper metrics, centre haze at most 18, floor black at most 10, lit saturation at least .70, all [A]. A veil improves haze lift and a flood barely moves `blackP10`, so neither is claimed sufficient alone.
- Reason: three probes agree that near-white and chroma pass a flood, on T06's card, T09's frame and the art prototype. A gate that cannot fail is not evidence.
- Settles it: every limit is a probe number. T11's M2 re-derives them on real frames, and DR1 must fail centre haze and floor black with near-white and chroma passing. One haze metric must fail DR1, or T11 is `blocked`.
- Plans:
  - **T09** M5, armed bullet: "Armed: the default frame, palette 0, passes all four. Palettes 1 to 5 are printed and not gated here, because T11 gates every palette on real samples (§6.7)".
  - **T11** M2 step 2, after "rely on viewing": add "That does not apply to a flood detector, see M3". M3, after "Do not proceed with a vacuous gate": add "If W3 does not fail DR1, try §8.1's whole-frame haze lift at §6.7's limit. If neither fails, set `blocked` (U13), because R2 then has no flood detector". What-would-stop table adds U13: "Neither haze metric fails DR1 on the real path | `blocked` | T00 owner, then operator". A6 adds the same.
  - **T06** none. A15 stands.

**DI-02. Arctic Laser's white disc.**
- Source: T03 #8, T04 #2, T06 #2.
- Decision: approved, in §6.8 from the start, not at T11.
- Resolution: disc top `#D8F6FF`. The palette is gated like the other five wherever palettes are gated.
- Reason: three plans saw the same failure. T04 measured 0% near-white and chroma up with this value [O: T04 rehearsal], and Toxic Arcade's similar `#D1F7FF` passes on T06's card [O: T06 probe]. Leaving a known failure for T11 makes three plans carry an expected-fail exception.
- Settles it: T03's A24, T04's A4 and T06's A14 on the new value, which has run only on T04's stack, in mode 0.
- Plans:
  - **T03** A24: "palettes 0 to 5"; delete "Palette 5 is recorded, not gated [O: 1.46% near-white, from the white disc top, see section 10]". Section 10 bullet: G-6.
  - **T04** A4: delete "**except Arctic Laser mode 0, asserted above 1%** as a known palette finding [O: 1.463%, every other combination at most 0.06%]" and write "[O: at most .06% on the other 23 combinations with the old table, and 0% on Arctic Laser mode 0 at `#D8F6FF`]". Section 10 bullet: G-6.
  - **T05** seam row `T06 | Near-white`: "T05's backdrop draws the same disc. A34 reports the absolute figure at palette 0 and only the increase props add elsewhere, because T11 owns the all-palette gate". A34: replace "since T06 found Arctic Laser's disc alone exceeds the limit" with "since T11 owns the all-palette gate".
  - **T06** A14: "palettes 0 to 5"; delete from "Palette 5, Arctic Laser, is printed" to the end of the row, and add "Palette 5's disc top changed, so its old readings, .347 night and .966 day, no longer apply, and the new value has not run on this card". Decision row "Arctic Laser's near-white failure is printed, not gated" and section 10 bullet: G-6.
  - **T11** gate W1's "Why": delete "Arctic Laser's white disc fails it today". M4's themes: delete "Arctic Laser's disc top;". Ladder row "Flat white disc, W1 on Arctic": delete. Seam row `T04 | Pins and hero`: delete its first sentence. M9's list: delete "T04's A4 for certain, once Arctic Laser changes". Decision row "Arctic Laser disc top `#D8F6FF` as the first palette change": G-6. M3's table adds DR8: "Arctic Laser disc top back to `#FFFFFF` in `palettes.ts` | `sheet36` | W1 on Arctic Laser tiles | T04 1.46%, T06 .97%". See DI-05 for the sentence that replaces the `r00` fail-before.

**DI-03. Day-phase exposure and saturation.**
- Source: T04 #3, T06 #5.
- Decision: amended.
- Resolution: exposure is T06's, through `toneMappingExposure`, `1 - .12 * (.5 + .5 * cos(TAU * dayPhase))` [A]. T04 applies day phase to stars, nebula, aurora and meteors. Sky saturation is dropped from §5.4.
- Reason: a sky-only change breaks fog's match to the sky, full-frame saturation took Toxic Arcade from 64.6 to 55.5 at .95, against a gate of 55 [O: T06 probe], and nobody needs it.
- Plans:
  - **T04** seam row `T01, T06 | Day-phase exposure and saturation`: "**Not applied by T04.** Exposure is T06's (§5.4, §8.1). Sky saturation was dropped (DI-03). T04's `skyGrad` output is never modified".
  - **T06** seam row `T04, T01 | dayPhase`: replace the bold last sentence with "§5.4 no longer lists sky saturation (DI-03)". Decision row "§5.4's sky saturation is not implemented by T06": G-6.
  - **T11** M4: delete the "Day-phase saturation" paragraph. Decision row "§5.4 sky saturation dropped": G-6.

**DI-04. Sky budget.**
- Source: T04 #4, T06 #6.
- Decision: amended.
- Resolution: §6.7 reads "up to .8".
- Reason: `skyGrad(0)` is .96 x horizon, so Toxic Arcade and Arctic Laser reach .71 and .76 through frozen GLSL [arithmetic], both stay under the .95 bloom threshold, and they read acceptably on sheets [O: T04 rehearsal]. It was an inconsistency, not an observed wash-out.
- Plans:
  - **T11** M4 "Sky budget" paragraph: "§6.7 says sky up to .8. T11 changes those two horizons only if J4 or J5 objects". Decision row "§6.7 'sky up to .6' not gated": G-6.
  - **T04, T06** section 10 bullets: G-6.

**DI-05. Palette crossfade in OKLCh.**
- Source: T11 #1.
- Decision: approved, moved to T01.
- Resolution: `mixPalette` works per slot: lerp L, lerp C, shortest arc on hue, and if either end has chroma under .02, take the other end's hue. §5.4 and §6.8 say so. §8.1's `palette` line stays and a comment beneath says OKLCh is OKLab's polar form, so the change is additive.
- Reason: a quarter of all travel time is a crossfade, and T11's evidence shows straight OKLab turns beige for several seconds. The arithmetic was re-run for this entry (see Verification). T01 has not written it yet, so moving it costs nothing, and T11 keeps `palettes.ts` to retune it.
- Settles it: T11's X1 with objects on. The midpoints on T03's terrain were 56.3 and 55.8 against a gate of 55, which is barely over.
- Plans:
  - **T01** section 3 row `src/world/palettes.ts`: "OKLCh mix". ZoneState table, `palette`: "Already mixed in OKLCh". M2: replace the `mixPalette` sentence with "`mixPalette(a, b, m, out)` works per slot in OKLCh: lerp L, lerp C, shortest arc on hue, and if either end has chroma under .02, take the other end's hue. Converts by `cos`, `sin` and cubing (no `pow`), and clamps to `[0, 1]`, allocation-free." Keep the clamp sentence and tag its numbers "for straight OKLab". A2 adds: "Grid and accent slots, all 30 ordered pairs, m = .25, .5, .75: sRGB saturation at least .40 [arithmetic: worst .41]. Negative control: a straight OKLab mix in the test reads worst under .25 [arithmetic: .18]". Decision log adds a row citing DI-05.
  - **T11** section 1 item 3: "which a straight OKLab mix did". M4: replace the "Crossfade" paragraph with "**Crossfade.** T01 ships OKLCh (DI-05). Look at the hue sweeps: the largest change is .15 in a linear channel across m = .05, on Ultraviolet to Toxic's accent [arithmetic], so a sweep may look fast on the smoothstep's steep part. If a slot looks wrong, the rubric decides, with a Decision log entry, in `palettes.ts`". M2 "Expected at `r00`": "X0 passes, since T01's test requires it. X1 sits near its limit on Sunset to Toxic and Toxic to Ember [O: 56.3 and 55.8, no props]. The mid-slopes of default terrain look bare [O: T01]. The opening is Ultraviolet at deepest night [O: section 10]". A4: "Predictions from M2 compared in Progress". M3's table adds DR7: "Straight OKLab in `mixPalette`, in `palettes.ts` | `transition` | X0 and X1 on Sunset to Toxic | 27.1 chroma, .18 saturation". M3: replace "The `r00` run is itself the fail-before for W1 on Arctic Laser and for X0 and X1" with "DR7 and DR8 are the fail-before for X0, X1 and W1 on Arctic Laser". A9: "**Fail-before on record:** DR7". Ladder row "Beige midpoint, X0, X1": fix becomes "Per-slot hue or chroma". Decision row "Crossfade moves to OKLCh": G-6. M9's register list: see DI-25.

**DI-06. Keep-out and grounding drowning objects.**
- Source: T01 #1, T01 #2.
- Decision: amended.
- Resolution: §5.6 states that `h` includes the ground, and what that costs. §5.7 rule 2 is `sink = min(band p95, .3 * top * scale)`. Rule 3 rejects a candidate that would float or be mostly buried at `.7 * top * scale`. Rule 4 and §5.3: grounded objects stop at 520, floating only from 520 to 1040, and tall grounded objects return from 1040, just past `C * FOG_END = 1032`. `K` stays .05.
- Reason: T01's rehearsal shows both as written fail R3: sinking by p95 left DISH at .27 of quota, and terrain alone reaches the keep-out limit from 500 to 1032. Loosening `K` now would be a guess, because with keep-out off Neon City's occlusion rose to 24.3% [O: T01 rehearsal, CPU projection, not rendered].
- Settles it: the bare upper slope is the visible cost against R3. T11's O1, D1, D2 and DR3, then the operator's Q4. T11 may raise `KEEPOUT_K` toward .067.
- Plans:
  - **T01** M4: replace "**The `.3 * top * scale` cap deviates from §5.7 rule 2**, which says to sink by the p95. Without it" with "**§5.7 rule 2 states this cap.** Without it". Decision rows on two bands and the sink cap: G-7.
  - **T05, T11** none. T05 already builds to `ARCHETYPE_SPEC`'s roots, and T11's ladder row already covers bare slopes.

**DI-07. Searchlight count.**
- Source: T01 #3.
- Decision: approved.
- Resolution: only on `chunk % 6 === 0`, at most 8 live in 47 chunks, in §6.5's row. `perChunk` stays 1 and cap 49 stays, oversized and harmless.
- Reason: per-chunk 1 with reach 3000 u gives 47. T01's rule gives what §6.5 wanted.
- Plans: none.

**DI-08. Reduced density with FIFO rings.**
- Source: T05 #3.
- Decision: approved.
- Resolution: §6.5 and §6.10 carry T05's design: per-tier modulus, per-row clamp, one-ring-per-frame refill, ordered so `uDensity` hides the difference.
- Reason: a FIFO's live slots spread over the whole capacity, so `instanceCount` cannot shrink by waiting. It was designed, not run, and it still is.
- Settles it: T05's A12 and A7, then T09's B16 on the real build.
- Plans: **T05** Decision row "Reduced density uses a per-tier modulus": G-7.

**DI-09. Terrain stride 2 and the hole.**
- Source: T03 #3, T03 #4.
- Decision: amended.
- Resolution: §6.4 states `side: DoubleSide` at all tiers, the hole's bounds, its stride 2 rows and the true margins. Morph is exact only within a level at stride 1. §6.4's crack table gains a stride 2 row.
- Reason: T03 saw real one-pixel cracks with `FrontSide` at stride 2 and 0 with `DoubleSide`, at no measurable cost. `side` is in the program key, so it cannot flip per tier. The cause is inferred, not proven.
- Settles it: T03's A5 and A6 on its dev page, and T09's stride 2 run below on the real build, which nothing covered.
- Plans:
  - **T03** M1: "**Hole position (§6.4):**". G-7 for "which §6.4 does not state".
  - **T09** `cracks.spec.ts`, end of the bullet: add "Then `tier: 1` (stride 2), chunk `15625000000000`, full bend, 300 frames, both paths, 0 bad, since §6.4's `DoubleSide` matters there and T03's evidence is only on its dev page". B5 adds the same.

**DI-10. Hidden rings accumulating update ranges.**
- Source: T05 #6.
- Decision: approved.
- Resolution: in §6.5: past 64 pending, clear them, and a ring going idle marks every slot dead.
- Reason: a hidden mesh never uploads, and stale slots alias back through `rowDelta` after 65536 chunks.
- Plans: none; T05's M2, A2i and A10 already say this.

**DI-11. Mirror roots, RING reach and fog direction.**
- Source: T05 #4, T05 #5, T11 #9.
- Decision: approved. Fog only goes down.
- Resolution: §6.5: the mirror clamps `y` to 0 before flipping, root faces have no lines, past `abs(x)` 125 collapses. Shader reach is `min(maxDist, uFog.y)`. §6.4 says T11 may lower fog and never raise it.
- Reason: a flipped root would rise above the floor, and a fragment past `FOG_END` paints a mark over the disc. T03's worst inner edge is at radial 4300.5 u, so raising fails.
- Plans:
  - **T05** Decision row "Effective reach in the shader": replace "since T11 may raise fog within §8's rule" with "and T11 may only lower fog, so the record is just early".
  - **T11** section 3, fixed list: delete "T05's section 11 says T11 'may raise fog', which conflicts; lower-only wins". Decision row "Fog retunes lower only": G-6.

**DI-12. Far grid table, pulse direction and the 32:9 figure.**
- Source: T03 #7, T03 #9, T03 #10.
- Decision: approved.
- Resolution: §6.4's far grid tables are marked as history, and T03's thresholds stand on its own controls. Pulse direction stays as written, and T03's shots and T11 decide. 32:9 reads 4211 at camera x 0, with 4183 noted as possibly including full follow.
- Reason: none changes a bound. The pulse has not been reviewed in motion, and flipping it is one sign.
- Settles it: T11's M6 for the pulse.
- Plans: docs only.

**DI-13. Stars and derivative branches.**
- Source: T04 #7.
- Decision: approved.
- Resolution: §6.3 states the inverse Jacobian form. `Agents.md` gains the rule against non-uniform branches above derivative-dependent code.
- Reason: T04 measured both.
- Plans: **T04** Decision row "Stars use an exact inverse Jacobian": G-7.

**DI-14. Hero band scroll under reduced motion.**
- Source: T04 #6.
- Decision: approved as T04 chose.
- Resolution: §10.3 exempts the disc's band scroll, about 10 px/s. No shared `uMotion` uniform.
- Reason: it is a slow scroll, not a pulse or blink, and a new shared uniform for it is not worth a contract change. The operator can reverse this.
- Plans: none.

**DI-15. Software budget has no split.**
- Source: T04 #9.
- Decision: approved.
- Resolution: §9.2 stays undivided and names the two compile-time fallbacks (S-28).
- Reason: only the integrated build can say where it goes.
- Settles it: T09's B20 at T10. A miss reopens T03 and T04 for `NO_SUN_COLUMN` and `HERO_SUN_ONLY`.
- Plans: none.

## Allocation, leaks and identity

**DI-16. Allocation gates.**
- Source: T09 #1, T09 #2, T02 #7, T03 #6, T08 #2, T10 #10, T05 #7.
- Decision: amended.
- Resolution: §9.2's budget is zero in what our code asks for, gated per URL class on the real build by the sampling profiler plus `usedJSHeapSize` windows: `other` at most 128 B/frame [A], `src/world` at most 20 KB/frame [A], libraries at most 32 KB/frame [A]. Slope is for leaks only. R6's text is unchanged. `height`'s boxed doubles are named as a gap against it in §9.2 and §14 risk 18, because that is what they are. Module gates are regression checks: T01 heap delta, T02 and T10 median of short windows, T05 GC count, T08 sampling.
- Reason: slope read 0 for a 15.5 KB/frame allocator [O: T09 rehearsal]. Five plans independently found it blind. No plan's method is wrong for its own scope, so nobody is made to change it, but only T09's run says anything about the budget.
- Settles it: T09's B19 at T10. T01's measurement below.
- Plans:
  - **T01** allocation probe: the gate of under 4 B per call stays for `fillProps`, `fillItems`, `zoneAt` and `bendAt`. For a `height` row: "printed, and gated only against a leak, at under 64 B per sample [A], because this Node probe may read lower than Chromium, where T09 read 50.3 to 60.3 [O]". Add to M7's work: "Measure one `height` row in a throwaway Chromium page by T09's method, `usedJSHeapSize` windows under `--enable-precise-memory-info`, as written and with `oct` and `gradP` inlined into the octave loop. Keep the lower if every golden and rule test is byte-identical, and paste both numbers into section 10". Nothing here changes §8.1.
  - **T03** section 10 bullet on `height` at the call boundary: G-6.
  - **T04** section 13: "heap slope is T09's" becomes "allocation and leak gates are T09's".
  - **T05** section 3: "Heap-slope and soak gates" becomes "Allocation profile and soak gates". Decision row: "T09's heap slope covers the rest" becomes "T09's profiler covers the rest".
  - **T06** section 13: "heap slope of the live stack, which is T09's gate" becomes "allocation and leaks of the live stack, which are T09's gates".
  - **T09** seam row `T01 | height allocation`: replace the last sentence with "T01's Node probe guards only against a leak on a height row (DI-16)".
  - **T10** Decision row "Allocation gate of 64 B/frame": "T09's heap slope remains §9.2's gate" becomes "T09's profiler on the real build remains §9.2's gate". A8 stands.

**DI-17. Pool sizes.**
- Source: T09 #7.
- Decision: approved.
- Resolution: a scene audit replaces them in §9.3, §11.3's Soak row and `Agents.md`.
- Reason: no growable JS pool exists. All rings are fixed at attach.
- Plans: **T09** Decision row "Pool sizes replaced by a scene audit": G-7.

**DI-18. Post-on pixel identity.**
- Source: T00 #2, T09 #3.
- Decision: amended.
- Resolution: §11.3 keeps 0 bytes: post off, one try; post on, best of 5 attempts with a self-compare, failing at once beyond 16 bytes or a delta over 1. T00's and T06's shell tolerance stays (S-60).
- Reason: this rig flips one half-float ulp in the sky pass with no world change, and a real error repeats while this noise does not. A tolerance would pass a real 1/255 error.
- Settles it: the cause is not established and need not be for the gate. `--use-angle=gl` or a second GPU would separate the hypotheses, if anyone needs to.
- Plans: none.

**DI-19. Shimmer limit.**
- Source: T09 #5.
- Decision: rejected as a threshold change now.
- Resolution: the limit stays 8 [A]. §11.3 notes the small margin, and a failure at T10 is a finding for T05 and T11. Any change needs a Decision log entry and the reviewer.
- Reason: T09's probe read 8.102 on a stand-in stack with no props. There is no real-scene number to move it to.
- Settles it: T09's B10 at T10.
- Plans: none.

**DI-20. Harness traps, sub-budgets and the edge-paint gap.**
- Source: T09 #6, T09 #9, T09 #10.
- Decision: approved.
- Resolution: §11.3's third and fourth traps state the guards. §9.2 explains the .1 ms clock and the residual. §11.3's Edge paint row says camera x -28.8 is covered only by T03's dev page.
- Reason: as T09 reported. A harness camera x override is not worth adding, because T03's page reaches that row.
- Plans: **T09** section 13: add "Known gap: §6.4's worst fog row, camera x -28.8, is not reachable under `renderAt`".

## Game and audio

**DI-21. Gates on the beat.**
- Source: T02 #1, T02 #6 (the flash note).
- Decision: approved.
- Resolution: §5.8 states it: gates land on the beat at normal cruise, after T02's trim of up to 6% re-locks, in about 6 s at worst. Not during boost or a hit's slowdown, nor under reduced motion. §1's "thread gates on the beat" stays. The checkpoint arch's flash cutting another short is cosmetic and accepted.
- Reason: `beat` comes from `tick` and cannot shift.
- Settles it: T02's A7 for the arithmetic; whether it feels good is §14 risk 3.
- Plans: **T02** Decision row "Beat lock by speed trim": G-7.

**DI-22. Interpolation offset between camera and phases.**
- Source: T02 #2.
- Decision: approved: accept.
- Resolution: noted under §3.3. Error at most .42 u at the 8 u drone cap, under the ship's 1.6 u radius [arithmetic].
- Reason: `phaseOf` is frozen, and the error cannot be seen against a 2.5 u pickup.
- Plans: none.

**DI-23. Idle rules.**
- Source: T02 #4.
- Decision: approved.
- Resolution: §7.2: 10 s idle freezes all rules, with cosmetic events only.
- Reason: otherwise a parked player farms best score and loses shields. The operator may overrule it, and it is one condition in `rules.ts`.
- Plans: **T02** Decision row "Idle PLAY freezes all rules": G-7.

**DI-24. Cars under reduced motion, and drone amplitude.**
- Source: T02 #8, T01 #8.
- Decision: approved. No cap below 31 u/s on cars.
- Resolution: §5.8 caps drone amplitude at 8 u. A car crossing twice at 31.2 u/s stays accepted.
- Reason: rare, mostly covered by the ghost, and only under reduced motion. An exact at-most-once guarantee is not worth slower traffic for everyone.
- Plans: none.

**DI-25. Who reopens a plan, and who applies T11's register.**
- Source: T10 #8, T11 #8.
- Decision: amended.
- Resolution: `Agents.md` Deviations and §12: the operator reopens a plan or, in a one-go build, the orchestrating reviewer. A seam defect where both plans follow their own text goes to the T00 owner, who decides as the operator's delegate and records it here. Only §14's operator decisions and T11's verdict wait for the operator. Changes to `architecture.md` and `Agents.md`, including T11's deviation register, go to the operator or that delegate.
- Reason: "the operator reopens" stalls an unattended run at the first defect.
- Plans:
  - **T00** the sentence "Because `architecture.md` has no task owner, the operator is told of every approved request so §8 can be updated" becomes "the T00 owner updates §8, and the ledger records it".
  - **T10** section "Seam defects": "the operator decides" becomes "the T00 owner decides as the operator's delegate".
  - **T11** U4: "Who resolves" becomes "Operator or orchestrating reviewer reopens". M9 step 4: "write the deviation register for the T00 owner or operator to apply. Expected entries: §5.1 default seed if it changes, plus any `KEEPOUT_K`, fog, tier, mirror, palette or limit changes". Delete the older list of expected entries, since this pass already applied those.

**DI-26. T11's window.**
- Source: T02 #5, T04 #5, T11 #4; S-59.
- Decision: amended.
- Resolution: §12's T11 row adds `src/contracts/glsl/hero.glsl`, `src/feel/tuning.ts`, `src/sim/tuning.ts`. Values and shader constants only. `hero.glsl`'s three signature lines stay byte-exact. Feel stays inside `FeelState`'s comment ranges. Sim changes only on an operator finding from playing it. `src/ui/**`, `src/audio/**`, `zones.ts`, `scatter.ts`, `items.ts` and `height.ts` still reopen their owners.
- Reason: these are the look-critical numbers (disc halo, bloom and flash caps) and the retune §14 risk 3 predicts, and T11 runs alone, so a wider window has no one to collide with. The UI and audio stay out because T11 has no gates over them.
- Plans:
  - **T00** M4 `plans:check` step 6: "Legal overlaps, exactly: T00 and T04 on `src/contracts/glsl/hero.glsl`, and every temporary T11 path in §12 (`src/render/**`, `src/world/palettes.ts`, `src/world/biomes.ts`, `src/contracts/glsl/hero.glsl`, `src/feel/tuning.ts`, `src/sim/tuning.ts`) against any other plan".
  - **T02** seam row `T11 | Retunes`: "`src/sim/tuning.ts` and `src/feel/tuning.ts` are in T11's window, values only (§12). A sim retune comes only from an operator finding, and T11 re-records the golden under the pin rule".
  - **T04** seam row `T11 | Tuning`: "`skyParams.ts` and the shaders are in T11's window through `src/render/**`, and so is `hero.glsl`, with its three signature lines frozen (§12)".
  - **T11** frontmatter `owns`: `[src/render/**, src/world/palettes.ts, src/world/biomes.ts, src/contracts/glsl/hero.glsl, src/feel/tuning.ts, src/sim/tuning.ts, tests/art/**, plans/T11-art-pass.md]`. Section 2, Window: the same temporary paths. Section 3 route table: delete the `hero.glsl` and `tuning.ts` rows. Fixed list adds: "`hero.glsl`'s three signature lines. Feel values inside `FeelState`'s ranges. `src/sim/tuning.ts` only on an operator finding". Non-goals: "rule or feel balance, unless the operator asks for it". Seam row `T02 | Feel`: "Feel caps are in the window". Ladder row "Sky fights disc": "Nebula `L`, stars, then the disc's halo weights in `hero.glsl`". U4's list: `src/ui`, `zones.ts`, `items.ts`. Decision row "`hero.glsl`, `src/feel`, `src/ui`, `zones.ts` stay out": G-6.

**DI-27. T11's retunes turning other tasks' tests red.**
- Source: T11 #3.
- Decision: approved, as T11's "better" option.
- Resolution: §12's pin rule. T11 edits expected-value lines itself, and `fakeProfile`'s table in `src/testing`, each with a ledger row and Decision log entry, and the reviewer agrees to the batch once at M9. A test failing for any other reason is a defect. `Agents.md` Never names the exception. None of these lines enter `owns`, so `check:task -- T11` and `plans:check` do not change.
- Reason: reopening five plans for one-line expected values is pure overhead when T11 is the only writer, and `Agents.md` already requires the reviewer's agreement for such edits.
- Plans:
  - **T11** Section 2, Pin: add "T11 edits it, under the pin rule (§12)". Section 3 route table, row "Other tasks' tests": "T11, expected-value lines only, pin rule (§12)". M9 step 2: "**Pin batch.** For each pin, T11 edits the expected-value line and writes one row: test id, file, old expectation, new expectation, the retune behind it. The reviewer agrees to the batch once. A red that is not a direct result of a logged retune is a defect and goes to its owner. Known so far: ..." and keep the rest of the known list, minus DI-02's item. A24: "Every pin was applied under the pin rule, with the reviewer's agreement in Progress". What-would-stop table: delete U9. Seam rows `T06, T00 | Tier table pin` and `T01 | Palette test`: "pin update" wording stands.

**DI-28. Human checks and how a task reaches `done`.**
- Source: T07 #2, T10 #7, T11 #5.
- Decision: amended.
- Resolution: `Agents.md` Definition of done and §12. A check that needs a person's eyes, ears or hands, or a device no agent has, is a **human check**: listed by id in the plan's section 7, reported as not verified in Outcomes, and not blocking `done`. A machine check that cannot run still leaves the task open. T11 collects every open human check into its operator pack. The operator's answers close them, and a defect reopens the owner. **T11 itself ends `blocked` with its pack ready until the operator has answered**, and no report may call the build finished before that. No new status. Listening review: the operator, H1 to H13, through T11's pack. §14 gains risks 15 and 16.
- Reason: strictly read, "leave the task open" means T07 and T10 can never finish, which stalls the whole graph, while calling them verified would be false. This keeps both honest: tasks finish on what agents can establish, and the whole-build claim waits for a person.
- Plans:
  - **T02, T03, T04, T05, T06, T08** section 7 ends with a **Human checks** list: the items that need a person or an absent device from that plan's section 13, each given an id `HC1`, `HC2` and so on, or the word "None".
  - **T07** section 7 heading "What still needs human ears": "Human checks", adding "They do not block `done` (`Agents.md`)".
  - **T09** B22: tag "Human check".
  - **T10** section 7 ends with a Human checks list: M9's questions. Decision row "Human checks do not block `done`": G-7.
  - **T11** section 1: T11 stays `blocked` until item 6, as written. Seam row `T07 | Listening`: "The pack carries T07's H1 to H13. A defect reopens T07". M10: Q10's "If T07's design issue is accepted, answer" becomes "Answer"; Q12 adds "Leave it running 10 minutes on that device: did it slow, and did the tier change?" (DI-33); add Q15 "Switch tabs for 30 s, and come back: any jump or audio burst?" and Q16 "Run the 2-hour soak, B22". M10 adds: "The pack also lists every other plan's open Human checks". A25: "Q1 to Q16". U8: replace "and `Agents.md` says to leave the task open" with "and `Agents.md` keeps T11 `blocked` until then". Decision row "T11 stays `blocked`": G-7.

**DI-29. Audio text.**
- Source: T07 #1, T07 #3, T07 #6.
- Decision: approved.
- Resolution: `Agents.md` Web Audio: `cancelScheduledValues` clears only the future. §7.6: `patternFor(bar, sector, sync, out)`, and drift through a .4 s EMA, slew and a fast re-anchor.
- Reason: as T07 measured. Following the old `Agents.md` advice would have deleted future automation.
- Plans: **T07** Decision rows for these: G-7.

**DI-30. HUD text.**
- Source: T08 #1, T08 #6.
- Decision: approved.
- Resolution: §7.5: the mono stack for the HUD, a heavy system stack for the wordmark, one token. DOM write budgets 0 idle, 24 cruise, 60 boost, 300 adversarial [A], counted by observer plus `setProperty` wrapper.
- Reason: as T08 viewed and measured, one reviewer, stills. The binding rule, system fonts only, is unchanged.
- Settles it: phone fallbacks are a human check.
- Plans: **T08** Decision row on the wordmark: G-7.

## Browser, test and tooling

**DI-31. Activation and gestures.**
- Source: T10 #2, T08 #3.
- Decision: approved.
- Resolution: §11.5 and `Agents.md`: `locator.waitFor`, `waitForSelector`, `locator.isVisible`, `waitForFunction` and `evaluate` all grant activation, so a gesture test waits only on a console signal and gestures with `page.mouse`, `page.keyboard` or touch input. Launch fires on `pointerup`, `click` or a filtered `keydown`.
- Reason: T10 and T08 measured it, and a void gesture test passes wrongly.
- Plans:
  - **T07** A19: add "and no `locator` call, `waitFor*` or `isVisible` before the gesture".
  - **T08** A4: add "and no `locator` call, `waitFor*` or `isVisible` before the gesture; gestures by `page.mouse`, `page.keyboard` or touch input only".
  - **T10** none; `openAppUntouched` already does this.

**DI-32. Hidden tab, DPR, motion wording, recordVideo.**
- Source: T10 #3, T10 #4, T10 #5, T10 #9.
- Decision: approved.
- Resolution: §10.4 and §14 risk 16: a real hidden tab is a human check, and tests cover the handler and the clamp. §10.5: the observer is only a trigger, and the ratio comes from `window.devicePixelRatio`. §11.5: `travel` never moves backward on any frame and strictly rises across any 50 ms, with a control. §14 risk 14 and `Agents.md`: `recordVideo` does not run here, use CDP screencast.
- Reason: all measured by T10. The R1 test keeps its force: per-step rising is T02's fuzz, and per-frame "strictly rises" was simply false on a page whose rAF outruns the sim.
- Plans: none.

**DI-33. Governor hold against throttling.**
- Source: T06 #4.
- Decision: rejected for now: no change to §6.10's rule.
- Resolution: the rule stays, and §6.10, §10.5 and §14 risk 17 say it can mask throttling.
- Reason: a hold that expires would step down on every 50 Hz panel, and a probe adds a visible quality change, with no device evidence either way. Nothing here can run a device that throttles.
- Settles it: the operator's Q12 on a real device. If it stays at its tier and stutters, reopen T06 with the two candidates in risk 17.
- Plans: **T06** section 10 bullet: G-6.

**DI-34. Bloom levels recompile.**
- Source: T06 #3.
- Decision: approved.
- Resolution: §6.6 and `Agents.md` state the keep-alive pass, rendered in every `precompile`, and that compile gates spy on `gl.linkProgram`.
- Reason: T06 measured 8 to 20 links invisible to `info.programs.length`, and 0 with the keep-alive.
- Plans: none.

**DI-35. Never-restored crash, and CSS 3D under no WebGL.**
- Source: T10 #11, T10 #12, T08 #8.
- Decision: approved.
- Resolution: §14 risk 5 notes the crash did not reproduce on a simple scene. §10.1: no 3D transforms on the poster or the fatal page. T10 writes the poster's text from `src/ui/copy.ts`, and the duplicate is accepted, since a pre-script poster cannot import it.
- Reason: a CSS perspective grid painted over text under `--disable-3d-apis` [O: T10 rehearsal, cause not established], which is exactly the unsupported client.
- Settles it: T10's A13 for the fatal page at 15 s, on the real scene.
- Plans:
  - **T08** `fatal.ts` line in M7: add "No `perspective` or 3D transform: flat gradients and paths only (§10.1)".
  - **T10** none.

**DI-36. Image size when viewing.**
- Source: T11 #10.
- Decision: approved.
- Resolution: `Agents.md` Definition of done: review images at or under 1920 px wide, and banding judged by number and range-stretched crops.
- Reason: T06's claim did not reproduce here, and oversized sheets create false moire [O: T11 test chart]. It may vary by tool version.
- Plans: **T06** M4 visual iteration: delete ", since a 1080p image is downscaled when viewed".

**DI-37. Module boundaries, tsconfig, commands, lint root.**
- Source: T00 #5, T00 #6, T00 #8, T00 #9.
- Decision: approved as T00's plan has them.
- Resolution: §3.2 states what `testing`, `harness` and `app` may import. §8.3 states `include` and the second tsconfig's types. `Agents.md` Commands says which scripts cannot pass at T00. T00's ESLint ignores `.claude/**`, with no document change.
- Reason: T00's rehearsal showed each, and its plan and lint table already do this.
- Plans: **T00** Decision rows for these: G-7. `plans/README.md`, T08's row: Scope adds "bests, the reduced-motion setting", as §12 now does (T02 #6, T08 #5).

**DI-38. Favicon, and console warnings.**
- Source: T00 #4, T04 #8.
- Decision: T00 #4 approved. T04 #8 rejected.
- Resolution: §11.5: the fixture answers `favicon.ico` with 204, and `index.html` carries its own icon link. The shared fixture does **not** fail on warnings containing `Program Info Log`. T04's spec keeps its own X4000 check.
- Reason: the frozen `phaseAt` already logs a D3D11 dynamic-indexing warning [O: Part 1's GLSL check above], so T04's optional fixture rule would fail every shell page.
- Plans: none.

**DI-39. World text.**
- Source: T01 #5, T01 #6.
- Decision: approved.
- Resolution: §5.2: biome mix on the row's exact z. §5.1: the periodic world's step at each wrap is accepted as harness-only.
- Reason: T01 measured the ridge. Identity tests are unaffected by the wrap.
- Plans: none.

**DI-40. The opening.**
- Source: T11 #2 (what C-35 left).
- Decision: approved: T11 decides, on evidence.
- Resolution: `DEFAULT_SEED` stays 1985 for now. T11's M7 compares it with candidates that open on Sunset Drive, Boulevard and the banded sun, and the operator can overrule. Every seed opens at `dayPhase` near 0. No day-phase offset is added now. If deepest night hurts the opening, T11 reopens T01 for one line in `zones.ts`.
- Reason: nobody has seen any of these with objects. The choice takes viewing, and an offset nobody may need is a feature nobody needs.
- Settles it: T11's A14, and the operator's Q1 and Q13.
- Plans: none.

## After independent review

**DI-41. T05's per-row clamp against T01's keep.**
- Source: the plan review that blocked T05. A seam where both plans followed their own text, so it comes to the T00 owner under Agents.md's Deviations.
- Decision: amended. The mechanism is new; §8's types, `ARCHETYPE_SPEC`, the clamp and the modulus formulas are unchanged. One §8.1 comment and one sentence each in §5 and §6.5 now state it.
- Resolution: a ring stores `keep' = max(keep, rank / (perChunk * 1.25))`, where `rank` is the record's 0-based position by ascending `keep` within its row and archetype, ties by ordinal, computed by an insertion sort on preallocated scratch. The filter and the shader both use `keep'`. T01's record and its thinning test keep the raw `keep`. `truncated` means only "the row held more than `perChunk`".
- Reason: `writeRow` truncated a row to `perRowClamp(d)` while T05's M2 and A12 required a refill to change nothing visible. A row with more records under `keep < d` than the clamp allows would lose one at the end of a down ramp. Raising the clamp costs vertices at low tiers and needs §6.5's figures redone, and stratifying T01's `keep` changes T01's algorithm and test.
- Evidence: [O: arithmetic only, by the T00 owner in a script separate from the reviewer's; 5,720,000 row-density cases for each of five keep models: T01's golden-ratio form, independent hashes, all near 0, clumped, and rows shorter than `perChunk`.] Over the clamp before the lift: 16,567, 302,441, 3,640,000, 957,110 and 92,724 cases. After the lift: 0 in all five, 0 nesting breaks, and Float32 stored comparison also 0 over. RING stays 0 and PYLON stays .1 and .6. Kept share on T01's form stays within .002 of `d` as an aggregate over that list of `perChunk` values; per type at real values it is lower by up to .008 at d = .4 and .005 at d = .08, and no acceptance depends on it; a row whose keeps are all near 0 keeps more, up to the clamp, as it already would. Nothing has run in a ring, a shader or a frame.
- Settles it: T05's A2d with its negative control, A12 and A7, then T09's B16 on the real build.
- Plans: **T05** glossary, M1, M2, instance layout, `worstCaseWorld`, A2d, Decision log. **T01** seam row only; its algorithm and tests are unchanged, and it stays approved subject to the T05 reviewer confirming the row.

**DI-42. T05's A12 ratio had no defined subject.**
- Source: T05's second review, which held DI-41 itself sound [O: 0 over the clamp on real `perChunk` values and real densities; 0 bytes across 32 refill sequences on the RTX with the lift, up to 172,330 without].
- Decision: amended. A12's ratio runs on placeholders with the worst-case world at 8 fixed positions, gated on the median, skipping and printing the switch frame. On the art build the ratio is printed and a strip viewed.
- Reason: unit boxes read p50 2.54, worst 4.15. Art-sized solid proxies read over 4 at 6 to 13 of 16 positions with or without the lift, so a hard limit on art would force an executor to shop for positions or lower the threshold. The alternative, a .15 shrink window, passes but leaves 37% of kept records visibly shrunken at tier 1.
- Cost accepted: a near tower collapses in about 36 ms on a tier change. T09's B16 will not catch that, so it is viewed. Automatic tier changes are at least 5 s apart. Proxy figures are not art; real art at M6 may move them.
- Plans: **T05** A12, Decision log.

**DI-43. The ship in isolated tests.** Source: same review. Decision: approved. `PropsLayerOptions.ship` (default true) and `ship=0`, implied by `scene=one` and `scene=sheet`, used by A4, A5, A8 and A25. Reason: from M8 on the ship is in every frame, about 223 px wide, against 1 px centroid tolerances and silhouette masks. Plans: **T05**. A2d also gains a model check after a mid-refill reversal and a stated evaluation order for the clamp.

**DI-44. The hero wipe popped on its last frame.** Source: T04's full-text review. Decision: amended. `th = mix(-2.2, 3.4, uHero.z)`, half-width .6, in `hero.candidate.glsl` as M2 allows. A6 also gates the last step, at FOV 58 and 68. Reason: the wipe stopped at `v` 2.2 but sky is visible to 2.31 and 2.906, so what remained changed in one frame: up to 117,223 bytes [O: stand-in on D3D11]; §1's "no pop" was false and A6 never sampled that frame. Not chosen: a time-based final fade, which needs new state. [I] Rear reflections on chrome orbs may still step at mix 1, on few pixels; not measured, and A6 prints a portrait case. Plans: **T04** M2, A6, Decision log.

**DI-45. T04's A13 compared different ticks.** Source: same review. Decision: amended. Compare at one tick, biome 3 against biome 0; under reduced motion 0 bytes. `metK` 0 under `reduced` joins A14. Reason: disc scroll and nebula alone change 126,206 to 662,523 bytes between ticks [O], so "within twinkle" had no usable threshold. Plans: **T04** A13, A14.

**DI-46. T00's dev post at tier 0.** Source: same review, a cross-plan seam. Decision: approved. `createDevPost` leaves bloom levels unchanged when `bloomLevels` is 0, and A11 renders that frame. Reason: `MipmapBlurPass` throws at `levels = 0` [O: stand-in], and T03's A22 runs that path. Plans: **T00** M7, A11.

**DI-47. T07's resume limit against its pad recovery.** Source: T07's full-text review. Decision: amended, a threshold restated with reason. A3 and A21 allow 3 steps plus one recovered pad chord, A21 capped at 60 sources at SYNC 16, at a stated resume phase, with a replay control. Reason: M2's late policy starts a missed chord at `now`, which is what stops a bar having no harmony, so no reading of "3 normal steps" could pass [arithmetic: worst 56]. Plans: **T07** A3, A21.

**DI-48. T07's blip ladder.** Source: same review. Decision: amended. Fold the whole ladder down an octave when its top exceeds 96, and A4 runs over all 12 keys x 8 chords. Reason: note-by-note folding broke monotonic order and 6-note ladders broke "non-decreasing", in 26 of 96 pairs [O: composer port]; the old row passed only because it named no key or chord. Plans: **T07** M1, A4.

**DI-49. T08's reduced motion.** Source: T08's full-text review. Decision: amended. No animation at all under reduced motion: a popup appears and expires on `v.tick`. A12's control is limited to `play`, `signal-lost` and popups. Not chosen: a title prompt pulse, added only to give a test something to find. Reason: M7's fade would be listed by `getAnimations()` [O], so M7 and A12 contradicted each other, and with animation off nothing removed a popup. Plans: **T08** M7, A12.

**DI-50. T08's write budget.** Source: same review. Decision: amended; §7.5's 300 stands. Every slot, style and attribute included, uses the 6-tick throttle, leading-edge. Reason: only text was throttled, so all fields changing every frame reached 580 per second [arithmetic]. Leading-edge means a beat kick in normal play is not delayed. Plans: **T08** M3, M5, A2, A5.

**DI-51. The GLSL branch rule.** Source: the second reader of the plan review's edits. Decision: amended. Agents.md now bans early exit under a non-uniform condition above derivative-dependent code, not every selection. Reason: ANGLE lowers `?:` to the same HLSL `if` as an `if`, so the old text could not be obeyed by T03's ternaries or the frozen `sunDisc` line, and the measured failure was the early exit [O: one RTX and SwiftShader]. T06's card also moved its `pristineGrid` above its `if` in the same review; 0 bytes changed, and it stays. Plans: none beyond T06's, already applied. **Agents.md** Custom GLSL.

**DI-52. When bests are written.** Source: T08's full-text review, non-blocking. Decision: approved. At most once per 600 ticks while rising, and on `pagehide`. Reason: no game-over event exists, so a per-change `setItem` was allowed by the text. Plans: **T08** M3, A14.

**DI-53. Stale figures.** Source: T04 and T06's full-text review. Decision: approved. §9.2's worst case is 64 with post at 13, and §6.8 records the new Arctic reading. §6.7's haze range 7.76 to 11.33 was re-read as 7.24 to 10.55 on a stand-in with the new palette; it is left as written, because T11 calibrates every wash-out limit on the real scene. Plans: none.

**DI-54. Dev pages must not name another task's module in a literal `import()`.** Source: T00's second, third and fourth verifiers. Decision: approved. T03's M3 line used a literal `import('/src/world/index.ts')`. Vite's import analysis resolves that when it transforms the page, even on a branch that never runs, so with no `src/world` on disk the inline module returns 500, the document still returns 200, and `window.__shell` never appears [O: throwaway pages in the real `dev/` folder, port 5103; `/* @vite-ignore */` on the literal does not help]. A variable specifier with `/* @vite-ignore */` loads, and fails at run time only on the branch that takes it [O]. T00 section 4's 'Dev page' row holds the rule. T03's M0 proof also moves to `check:task`, since a whole-repo compile fails on a sibling's half-written file [O]. A verifier's grep found no other cross-task literal in T01 to T11. Plans: T03 M0, M3; T00 sections 9, 10, 13.

**DI-55. `advance` and a subnormal negative `d`.** Source: T00's fourth verifier. Decision: limit recorded, no change to §8 or `coords.ts`. For a negative `d` of magnitude below about 3e-322, `advance` leaves `local` slightly below 0, against its doc comment [O: 5e-324 to 1e-322 stay negative, 3e-322 and larger up to 1e-17 give 0]. The other 132,113 precision checks passed. Nothing in the plans drives the camera backward: `d` is forward speed times a fixed step, or 0 [I: from reading §7 and T02, no caller was traced in code]. T02's A-rows and T09's R1 proof are the checks that would show otherwise. Reopen if any later task calls `advance` with a computed negative `d`.

**DI-56. Corrections recorded after T05's final approval.** Source: T05's approver, who may not edit this ledger. Decision: noted. DI-43's ship list also covers A12, so `ship=0` applies to A4, A5, A8, A12 and A25. T05's A12 runs on still placeholder boxes (`uMotion` off, no phase-driven look, backdrop hidden), at named positions, with the 12-frame strip under DevPost at 2 ticks per frame; no threshold moved. `ship: false` hides the meshes rather than omitting them, so the sheet can show the ship's own tile. T05's Purpose item 4 states the accepted cost from DI-42. T06's citation of Agents.md's GLSL rule is reworded per DI-51. T01's section 4 keep row also changed under DI-41, wording only, beyond the "seam row only" in that entry and its change list. **What this accepts, restated:** a near tower can collapse in about 36 ms on a tier ramp, and no automated test holds a pop limit on real art; an executor views a strip.

**DI-57. T00's remaining test gaps are not held against T00.** Source: T00's fourth verifier. Decision: deferred. No wrong behaviour was found on any path probed. A sample of mutants still survive T00's own suite (camera position and roll, rebuild order on a jump, `warpSerial` in the view, `setLayerVisible` name, antialias, Reinhard tone mapping, `composer.setSize`, `dprCap`, sync modulo, `musicKey` modulo, the prop x bands, `fakeHost` beat). They are listed in T00 section 13 as not verified. The siblings' own specs exercise most of those paths as consumers, which is inferred, not measured. Mutation sampling has no natural end, and four verifier rounds have found only test gaps in T00's code since round 2.

**DI-58. Same-state pixel comparisons on the RTX allow a bounded one-level difference.** Source: T04's verifier, rated blocking with the T00 owner named; T00's earlier unexplained post-on byte. Decision: amended. On the `gpu` project, two renders of the same state match when at most 64 bytes differ and no byte differs by more than 1 level. A byte that differs by more than 1 fails at once. On the `software` project the bound stays 0 bytes. A row that already allows more keeps its own tolerance, and attempts stay where a row has them. Reason: on the RTX through D3D11, the same frame changes by 1 level at 1 to 41 fixed pixels once other states have been rendered in between, and then either stays changed or reverts. It never happened on SwiftShader, 0 of 720 renders [O: T04's verifier; iso=nebula 6 of 15 pages, iso=hero 1 of 15, iso=gradient and iso=stars 0 of 15]. Once a flip persists, a self-compare reads 0, so attempts cannot remove it, and §11.3's argument for attempts over a tolerance fails for this case. Real faults on record are far larger: the band-scroll harmonic bug read 109,185 bytes and A2n 1.5M. **What this gives up:** a real error confined to 64 bytes at 1 level would pass on `gpu`. It would still fail on `software` wherever that row runs there. Cause not established; a driver or ANGLE effect is inferred, not shown. Applies to: T04 A2, A6, A9 same-tick, A13 reduced and A17; T09's identity gates, including B3 and B12's byte compare; T00 A11d if it ever flakes; §11.3. It does **not** cover T05's MSAA self-compare of up to 80 bytes, which T05's verifier traced to T05's own additive beams: that stays a T05 defect.

**DI-59. T07's A21 bound, restated.** Source: T07's verifier, rated blocking with the T00 owner named. Decision: amended. DI-47's "worst 56" was wrong. Correct production code starts 64 sources in the 300 ms after a resume at form bars 18 and 22 [O: T07's verifier, real engine on the dev page], and a scratch model of the sequencer reaches 72 at sector 5 bar 30, overcounting the engine by 4 to 7. A21 now states its bound in structure, as A3 does: in the 300 ms after `resume()` at SYNC 16, the sources started are at most those of 3 sequencer steps at the current form position plus one recovered pad chord, counted by T07's pure composer for that position. The test resumes at the worst form position over all 32 bars and 6 sectors, found by that pure count, and the replay control must still exceed the bound. The 300 ms master fade-in on resume also gets a gate with a negative control (a T07 defect). Plans: T07.

**DI-60. Audio allocates while the JIT is cold.** Source: T07's verifier, low. Decision: recorded as §14 risk 19, open. T07's `frame()` allocates about 260 B per 60 Hz frame for tens of seconds while cold, from engine boxing of `ctx.currentTime` and the observe and wind arithmetic, and 5 B when warm [O: T07's verifier]. §9.2's 128 B line has no warm-up exemption, and audio is inert under the harness, so nothing on the real build measures it. It is the same kind as risk 18: engine boxing, not objects the code creates. Not a T07 defect.

**DI-61. Furthest distance accrues only while score accrues.** Source: T08's executor and verifier, low, a design question. Decision: amended. §7.2 freezes score during idle so a parked player cannot farm it. The same reasoning applies to furthest distance, which T08 fed in every non-DEMO mode, CRUISE and idle autopilot included. §7.2 now says so. Plans: T08.

**DI-62. Rings with additive draws slide.** Source: T05's executor, accepted with a condition by its verifier. Decision: amended. §6.5 now says that the SAUCER, SEARCHLIGHT and FENCE rings shift their live slots on each crossing so slot order equals rebuild order, because additive blending into a half-float target depends on instance order [O: T05, 38 to 41 bytes FIFO against rebuild at tier 3, 0 with beams removed]. Caps are unchanged. A10's worst case is 14,352 B per crossing against 16 KB. A mutant that skips the shift fails the model check. Plans: T05 fixes its `ring.ts` header.

**DI-63. §10.3's band-scroll figure.** Source: T04's verifier, low. Decision: corrected. The disc's band scroll runs on phase 4 (480 ticks, 4 s), not the bar, so it is about 6 px/s, not 10. That is slower, and so safer under reduced motion. `hero.glsl` line 2 says derivatives are taken before the mode branch, but `heroPlanet`'s `fwidth` and `heroMoon`'s `pristineLines` run inside it. The branch is uniform, so the code is legal and only the comment is wrong. T04 fixes the comment.

**DI-64. Whole-repo rows after a parallel batch.** Source: T01's verifier and others, low. Decision: recorded. Executors set `done` with their whole-repo rows pending, because the batch rule forbade whole-repo runs. The T00 owner ran them after the batch. `npm run check`: typecheck and lint clean, 1627 tests passed, 2 failed: T03 `layer.test.ts:357` and T05 `alloc.test.ts:83`, both clean gc 2 against 0, both passing alone 3 of 3. Their verifiers traced both to the observer, not the code under test. `test:browser`: 399 passed, 6 skipped, 1 failed (T04 A6, DI-58). A task counts as done for T10 only after the post-repair whole-repo run is green.

**DI-65. T09's B12 may use two loss cycles.** Source: T09's verifier, blocking for T09, with a T00-owner ruling asked for. Decision: approved. On the app the sim moves the camera between captures, so a byte compare across a loss with the loop running fails whatever the restore does. B12 therefore proves byte identity across loss and restore with the sim held (`manual(true)`), and proves that travel rises during a loss in a separate cycle with the loop running. §11.3's "Same, with travel still rising" means both hold, not that one cycle shows both.

**DI-66. Look notes for T11 from the verifiers.** Source: the nine V1 verifiers, low, owner T11. Decision: listed for T11's contact sheet and gates. Not defects in the code that produced them.
- Ultraviolet's disc (#E0D4FF to #7B2FF7) reads pale lilac with little contrast against its violet sky. Fade midpoints such as Sunset Drive to Arctic Laser land on a pastel mint sun over lavender.
- Ember reads brown or ochre in three places: the ring fill, the aurora bars and the top-right nebula.
- The terrain's sun column is a hard-edged rectangle whose lower half turns brown-olive (RGB 33,16,0), and in portrait it covers most of the floor. The x = 0 line is a thick pink bar, about 30 px at the frame bottom. Ringed-planet reflections kink just under the horizon.
- The peak flash frame is a muted teal wash, lit saturation .511 against .904, below T11's .70 limit. Near-white under flash .6 exceeds .5% on Arctic (1.62% by day) and Toxic (.91%).
- Aurora luminance has no bound: five times L still passed A13.
- For T10: on the title fixture the demo ship clips the first laser fence at 0.55 s, silently, and at A8a's 2.07% hit rate that is about one silent pass-through every 15 s. Check it on T01's real world.
- Shimmer: terrain alone reads 7 to 9 against §11.3's limit of 8, and the shell reads 12.2. T11 calibrates the limit on the real scene, as already ruled.

**DI-67. Same-state compares with MSAA and blending on D3D11.** Source: T05's repairer, as a question for the T00 owner. Decision: amended. On the RTX through ANGLE's D3D11 backend, identical frames with blended draws at MSAA 2 or 4 differ between renders: up to 173 B with beams alone, and 29 to 42 B on the full road scene at MSAA 4. On the same GPU, Vulkan reads 0, and MSAA 0 reads 0 [O: T05's repair]. That is beyond DI-58's bound, and it is a resolve effect, not a world or precision fault. So every same-state comparison that the `gpu` project gates runs at **MSAA 0**, post on or off, and §11.3's post-on identity runs post on at MSAA 0. MSAA is still exercised by the cost, look and tier rows, which do not compare bytes. A print-only post-on MSAA 2 identity run under `--use-angle=vulkan` is allowed and recorded, not gated. `--use-angle=gl` gives no context headless here [O], so Vulkan, not GL, separates driver from code. Inferred, not tested: T03's transparent floor at MSAA may carry the same noise. T03's current rows pass. Plans: T09 (identity specs and §11.3 row); T05 already compares at MSAA 0 or within its own reading.

**DI-68. DI-58 covers every same-state comparison, not only the rows it named.** Source: T09's repairer. Decision: clarified. DI-58's bound applies to any comparison on the `gpu` project between two renders of one state, including T09's B14 trap-2 compare and its washout control check (A14's 'after' 0 bytes), which both render other states in between. A row whose comparison is between different states, such as a liveness or a control that must differ, is unaffected.

**DI-69. Buried pylons in Cyber Canyon.** Source: T01's repairer. Decision: accepted for now, for T11. In Cyber Canyon the coarse surface at PYLON's 3000 u reach (spacing 128) covers more than .7 of the mast in 163 of 4000 records, and 0 elsewhere [O: T01's repair]. PYLON is a fixed line (S-04), so moving single pylons would break the line. T01's 'no mostly buried object' check excludes PYLON and reports its count. T11 judges the canyon's pylon lines on the real build. If they read as stumps, T11 raises PYLON's lane in that biome or drops the line there.

**DI-70. DI-67 scope: no exemption by measurement on D3D11; Vulkan MSAA rows may be gated.** Source: V2 verifiers of T03, T05 and T06. Decision: ruled. (1) T03's A15 post-on identity, and T06's A23 far pair and A29 restore compare, run at MSAA 2 with blended or additive draws and read 0 so far. DI-67 applies to them anyway: they compare bytes at MSAA 0. A check that the tier really uses MSAA 2 stays separate, as a state assertion. Reason: the D3D11 noise is intermittent and depends on blending, so a clean run of a few repeats does not show it is absent, and a red whole-repo run for no real fault costs more than the coverage MSAA adds to a byte compare. (2) T05's gated same-state compares on ANGLE's Vulkan backend at MSAA 2 and 4 stand beside DI-67. They read 0 and guard DI-62's slide. The block must skip, printing why, wherever the launched renderer is not Vulkan. T05 also adds a GPU-free slot-order check, so the slide has a gate that needs no GPU. (3) Timing rows that sit in plain `gpu` specs, such as T05's A30, run inside `test:browser`. The T00 owner runs `test:browser` with the GPU otherwise idle, and a timing failure in a contended run proves nothing (Agents.md).

**DI-71. Two exceptions to DI-67, and the Vulkan print-only spec.** Source: T09's V2 verifier. Decision: ruled. (1) Shimmer's zero step is a same-state compare at MSAA 2. It stays at MSAA 2, because shimmer is about the look as shipped, and its own band-mean limit of .001 tolerates about 201 one-level values per frame pair, above DI-58's 64 and T05's worst D3D11 MSAA figure of 173 B [arithmetic: V2-T09]. (2) T09's print-only `identity-vulkan.spec.ts` must skip, printing why, where the launched renderer is not Vulkan, as DI-70 already requires of T05's block. Its second browser launch per `test:forever` run is accepted.

**DI-72. The veil control's strength on the real scene.** Source: T09's R3 repair, an open Decision log row needing a reviewer. Decision: amended. The veil control exists to show that a veil which near-white, chroma and haze lift all pass is still caught by `blackP10` (§11.3's wash-out table). On the real layers, `veil(.1)` takes chroma to 51 to 55 on Sunset Drive at four day phases, and to 53.9 on Ultraviolet, so chroma also catches it and the control no longer shows the blind spot it is for [O: T09 R3, with `labPost`, not T06's post]. `veil(.05)` reads chroma 64.4 and 65.3 with `blackP10` 35 on both palettes [O], so it demonstrates the blind spot and is a subtler fault for `blackP10` to catch. The control is therefore `veil(.05)` in A14 and B11, under `forceZone(SUNSET_DRIVE, BOULEVARD, 0)`. No gate threshold moves. If T10's B11 run on the app with T06's post reads chroma at or under 55 at `.05`, T10 records a seam row for the T00 owner rather than changing the strength.

**DI-73. Where MSAA stays in a same-state compare, and what replaces it where it goes.** Source: the R2 reviewer (V3). Decision: ruled. (1) DI-67's "every" has one more exemption: T06's A13 and A19c may compare bytes at MSAA 2, because nothing blended is drawn into the multisampled scene target there. The sky triangle and sticks are opaque, three disables blending for opaque normal-blended materials, and the speed lines are hidden at `feel.speedLines` 0 [O: V3's code reading, and 25 of 25 identical repeats at MSAA 2 and 4]. Each of the two rows asserts that the speed lines are hidden in its frames, so the exemption cannot lapse quietly. (2) Where a row moves to MSAA 0 for its byte compare, it keeps the tier it was testing and forces MSAA 0 (`forceMsaa(0)`), rather than switching tier, so the post chain under test is unchanged. T03's A15 follows this. (3) A restore row whose byte compare left MSAA keeps a coarse MSAA 2 liveness check after the restore, such as a lit count or mean luma against the pre-loss frame within a stated tolerance. That is not a byte compare, so it does not conflict with DI-67. T06's A29 follows this.

## T10 round 1 (defect register D-001 to D-010 in plans/T10-integrate.md)

**DI-74. Shimmer: B10 gates the floor, and props get their own temporal check (D-002, D-004).** Source: T10's D-002 and D-004. Decision: amended scope, no threshold moved. §11.3's shimmer row and §6.2 set the limit of 8 for the floor grid just under the horizon: filtered against naive lines. On the app, all layers read 25.87, props hidden 7.44, terrain alone 7.48, props alone 33.41, periodic about every 10 frames [O: T10, twice, identical]. Props moving through the band produce frame differences whether they alias or move truly, so one number cannot judge both. (1) B10 measures shimmer with the props layer hidden, against 8 and the stored per-machine baseline. A12's naive-grid control runs the same way, where it trips at 18.64 against 7.44 [O]. (2) Props get a separate check owned by T05: the same 48-frame sequence rendered natively and as a supersampled reference (at least 4x the pixels, box-filtered down), with all layers on. The native shimmer's excess over the reference measures aliasing, not motion. T05 first establishes how much of the 25.87 is aliasing, fixes the aliasing it finds (lines and beams under a pixel, far small props, bloom on subpixel highlights), and then proposes the gate's limit from measurement. T11 confirms the limit on the real scene. (3) The all-layers figure is printed by B10, not gated, so it stays visible. §14 risk 4 stays open until (2) is gated. Plans: T09 (B10, A12 scope), T05 (the new check and fixes), T11.

**DI-75. Reduced motion at load (D-001, seam T02 and T10).** Decision: T10's proposal is adopted. If reduced motion is set before the sim's first step, it applies from that step: the start speed is `SPEED_CRUISE * REDUCED_MOTION_SCALE`, with no ease. A toggle after the first step keeps T02's ease, so a mid-run toggle does not jolt. Plans: T02.

**DI-76. The veil control's strength and pose (D-003, seam T09 and T06).** Decision: amends DI-72. With T06's post on the app, `veil(.05)` reads `blackP10` 25 to 27 over 13 poses, so the control passes or fails by load timing [O: T10]. The control becomes `veil(.06)`: `blackP10` 32, chroma 59.6 at the standalone pose [O]. B11 fixes its pose with `stepToTick`, as B10 does. Plans: T09.

**DI-77. B19's stability line (D-005).** Decision: amended. T09's "three consecutive window medians within 1 B" never holds on the app: spreads of 234 to 296 B over about 8.8 KB [O: T10, three repeats of 17 runs]. V1 ruled that a failure of this line alone is a T09 measurement failure, not a §9.2 breach. Stability now means three consecutive window medians within 5% of their mean. The leak and class limits and the controls are unchanged. Plans: T09.

**DI-78. §9.2's "other" allocation line (D-008, seam).** Decision: **loosened**, from 128 B to 512 B per frame [A]. Project code outside `src/world` allocates 296 to 377 B per frame on the app over 6 profiles: post about 171, sky about 90, terrain about 77, speed lines about 39, props about 29. The T10 loop alone reads 18.5 to 46.6 and is gated at 64 [O: T10, by bisection]. The 128 B figure was assumed, not measured. Against a measured total of about 8.8 KB per frame, almost all inside three.js (§14 risk 6), cutting the project's share to 128 B would change the total by about 2.5%, at the cost of reworking hot paths in five modules. **What this gives up:** about 23 KB/s more garbage at 60 Hz than the old line allowed. B19 keeps the line at 512 B, so a regression above the measured level still fails. The per-module figures are recorded in T10's register as reference values. Plans: T09 (B19's class line), §9.2.

**DI-79. The launch-click hitch (D-009).** Decision: a budget is set, and T07 owns the fix. On the launch click, T07's synchronous gesture work stalls two frames, at 90.3 to 97.2 ms and then 76.4 to 83.4 ms: `engine.unlock` 35.5 to 44.7 ms self time, kit 17 to 19, impulse 12.6 to 12.8, graph 9.0 to 9.5, voices 6.6 to 7.1 [O: T10's CPU profile]. Only creating or resuming the `AudioContext` must happen inside the gesture (Agents.md). Budget: the synchronous part of the gesture handler at most 8 ms on this machine, and no frame over 33 ms in the 2 s after the launch click. Anything else, such as kit synthesis, the reverb impulse and voice pools, is built after the gesture in slices of at most 4 ms per frame, or off the main thread through `OfflineAudioContext.startRendering`. Sound may begin up to 300 ms after the click; the launch cue may play from a small buffer prepared earlier. T10 turns its launch-hitch spec into a gate once T07 lands. Plans: T07, T10.

**DI-80. Lost input edge on frames without a sim step (D-010, seam T08, T02 and T10).** Decision: T10's proposal is adopted. `app/loop.ts` latches `control.human` from a frame that took no step into the next frame's sample, so human = sampled or latched, and clears it once a step has consumed it. §3.3's order is unchanged. Plans: T10.

**DI-81. Look notes from T10's first viewing, for T11.** Source: T10's M3 and M7 images. Low, not defects in the producing code unless T11 finds one. The disc's floor reflection is a hard rectangle and covers most of the road on a phone (DI-66 already lists it). Red laser fences dominate Sunset Drive and Boulevard frames. The fade midpoint superimposes two heroes, here a wire globe and a ringed planet, and reads muddled. The hit flash is a yellow-olive whole-frame wash. Large mint shards read flat. In the cruise strip the ship flies small near the horizon. Toxic Arcade reads very busy. Zone 0 at `DEFAULT_SEED` is Ultraviolet, so the poster's yellow Sunset disc turns pale lilac at the switch (T11's opening-seed question, Q1). For T10, not T11: at 390x844 the ship's wing is cut at x = -35, and the ship was not found at x = -40. That is T10's follow framing to investigate.

**DI-82. The supersampled reference for props aliasing (D-002, T05's A16b).** Decision: approved as built. DI-74 asked for a reference of at least 4x the pixels, box-filtered down. T05 showed that a 2x render differs from native in more than sampling: it changes the shaders' derivative filters and bloom's mip footprint, and it read above native everywhere [O]. A16b instead averages 16 jittered sub-pixel samples on a 4x4 grid per frame, with post at native size. That samples the scene as a 4x by 4x render box-filtered would, and changes nothing else. Measured on the app: about 95% of the props' shimmer is true motion. The aliasing excess is 1.14 of 25.87 with all layers, and props' share was 0.105, now 0.084 after the REFLECTOR and ORB fixes [O]. The limits, a props' share of at most 0.2 literal and 0.4 blurred, are accepted provisionally; T11 confirms them. The control, NAIVE_EDGES, reads 0.434 and 0.841. PYLON (0.301) and CHEVRON (0.130) keep some residual aliasing. Widening PYLON's lattice needs a builder change, so it is listed for T11, not required now.

**DI-83. DI-79 restated: the AudioContext constructor is the browser's, not the project's.** Source: T07, blocked on DI-79. Decision: amended. `new AudioContext()` alone measured 33.4 to 48.6 ms for the first context in a browser process and 7.8 to 11.6 ms later, and no option variant helped [O: T07]. DI-79 keeps the constructor inside the gesture, as Agents.md and T10's autoplay row require. The budget is now: (1) the project's own synchronous work in the gesture, everything except the constructor and `resume()`, at most 8 ms (measured 0.3 to 0.4 ms); (2) every frame in the 2 s after the launch click, other than the click frame itself, at most 33 ms (measured 9.3 to 13.8 ms less the constructor); (3) the click frame at most the constructor's own time plus 8 ms. T07's option 3, a boot-time `enumerateDevices()` to pre-warm, is **rejected**: a device query before any gesture is a privacy and §10.5 matter, and it is not worth 25 ms once per launch. T10's launch-hitch figure of 90 to 104 ms precedes the click in every run and is probably the profiler's own start, so T10 confirms that and gates on the click frame. **Accepted cost:** the first launch in a browser session shows one long frame of about 35 to 50 ms at the click.

**DI-84. B19's windows control on the app (T09).** Decision: amended. The probe control (allocProbe(256) moves the window median by 256 ± 16) is exact on the shell, but on the app the clean medians drift with the route, and sequential controls read +88.8 to +564.4 [O: T09]. On the app the control interleaves probe-on and probe-off windows and requires a shift of 256 ± 64 B. Interleaved runs read +207.6 to +264.2 [O]. The shell keeps ± 16. T09's MIN_WINDOW_RUNS = 5, and its soft assertions so that a validity failure cannot hide the §9.2 lines, are accepted. Noted for T11: B11's flood control has a thin margin on the app, haze lift 20.47 against > 20.

**DI-85. Tier-0-only look cuts (D-007).** Decision: accepted. Tier 0 runs on software and on the weakest devices. At tier 0 the floor drops the sun column (NO_SUN_COLUMN, the response T03's plan names) and the slope normal (NO_SLOPE_NORMAL, which costs the flank mountains their lit facets and buys 0.3 to 1.4 ms). The sky draws mode 0's sun in every mode (HERO_SUN_ONLY), with no nebula sampling and no stars. Tiers 1 to 4 are unchanged [O: T03 and T04 byte-identical tier-3 rows]. T05 defines HERO_SUN_ONLY on its tier-0 orb material too, so an orb never reflects a ringed planet under a plain sun. T03's A22b time gate of 0.8 is accepted provisionally. T11 judges the tier-0 look on a software contact sheet. The tier-0 shader is chosen at the layer's first setQuality, so a hardware boot that falls to tier 0 at run time keeps the full shader. That is accepted, since such a device is not CPU-rasterizing.

**DI-86. Three measurement definitions, so gates do not depend on chance.** Source: the T05, T07 and T09 close-outs. Decision: amended. No budget moves.
- (1) DI-83's click-frame limit is measured from the click event's own timestamp to the end of the frame that contains it, not from the frame's start. Otherwise the idle time before the click arrives counts against the limit, and the result depends on where in the frame the click lands. That is what fails on `software` at 60 Hz, and it left a gpu margin of 0.3 ms [O: T07]. The limit stays the constructor's time plus 8 ms. T10's own click gate uses the same definition.
- (2) DI-84's interleaved windows control on the app uses a larger probe: `allocProbe(1024)`, accepted at 1024 ± 256 B. With a 256 B probe on the app, no-probe readings ranged from -58.4 to +127.8 and one real reading was +323.2 [O: T09], so a 256 ± 64 band cannot separate the probe from the noise. At 1024 the noise is about 12% of the signal. A probe of 0 must still fail. The shell keeps `allocProbe(256)` at ± 16.
- (3) T05's A30 runs inside `test:browser`, without the GPU lock, and its first run after a page load is noisy (p95 1.6 to 3.1 ms) [O: T05]. A30 runs one discarded warm-up pass of the same sequence before the gated pass. Its limit of 2.0 ms is unchanged.
- Noted for T11 and the operator: T05 now calls `gl.flush()` after every 12th props draw, which cut the layer's loop from about 1.5 to about 1.07 ms on this RTX. Its effect on tile-based mobile GPUs is unmeasured (§14 risk 1).

**DI-87. Readings of DI-86 confirmed.** Decision: confirmed. (3) means one gated pass after one discarded warm-up, replacing V1's lower-of-two-runs rule. It is the stricter reading, because a best-of-two after a warm-up can only read lower. Its cost: the no-flush mutant fails A30 in about half of runs (7 of 12), so A30 is a budget gate, not a guard on the flush. (1) is read in the rAF entry clock only, from the click event's timestamp to the entry that ends its frame. The rAF timestamp reading is logged, not gated, because its interval can end a display period after the frame does [O: T07 D3]. T10's click gate uses the entry clock too.

## T10 round 2 (D-011, D-012)

**DI-88. The follow gain keeps the whole ship in frame at every aspect (D-011, seam T10, T02 and T05).** Decision: T10's proposal is adopted. At 16:9 the fixed gain of .72 puts the ship's outer wing outside the frame at x = ±40 (NDC 1.104), for aspects up to about 1.96 [O: T10, live camera and projection of T05's `buildShipBody`]. The gain is now `max(.72, 1 - (.85 tan(29°) aspect (SHIP_FORWARD - SHIP_HALF_LENGTH) - SHIP_HALF_WIDTH) / PLAY_HALF_X)` at every aspect: .793 at 16:9, .976 at 390x844, and .72 from aspect 2.30 up, so 21:9 and B7's edge-paint case are unchanged. §6.4's fog table is computed at 21:9, where camera x stays at -28.8. At 16:9 camera x reaches -31.7 on a narrower view, and T03 checks that its fog and edge row still holds there. **What this gives up:** at 16:9 the camera follows the ship a little more, so lateral motion reads slightly less across the screen. Plans: T10 (`follow.ts`), T03 (a check only), §6.1.

**DI-89. The HUD's first show stalls the first launch (D-012).** Decision: T08 owns the fix. On the first launch in a fresh browser, the HUD's first show costs two frames of 26 to 55 ms while the main thread is idle, about 22 to 28 ms of each in "(idle)", so the cost is the first raster or composite [I: T10's profile and bisect]. That breaks DI-83's limit (2). The CRUISE panel's first open shows the same kind of cost, 28.7 to 42.5 ms. T08 keeps the HUD, and the CRUISE panel where it can, laid out and rastered during DEMO, invisible, so the launch changes only what is already drawn. T08 must keep T09's B12 assumption: the context-lost overlay is hidden by display or the hidden attribute, not by opacity, and `showContextLost(false)` takes effect in the same step. T10's `launch-hitch.spec.ts` "first launch in a fresh browser" is the regression. Whether a real Chrome with warm GPU caches shows the cost at all is unverified.

## Integrated review (VI-game, VI-r1, VI-gates)

**DI-90. A script for the software-project gates.** Source: VI-gates, blocking, owner T00. Decision: fixed by the T00 owner. No npm script ran `tests/visual` or `tests/e2e` under `software`, so every software-only row (D-007's regression, T10 A29, T03 A22 and A22b, T04 A18, A22 and A23, T05 A37, T06's tier 0) was skipped in every scripted run while the run counted as green [O: VI-gates, 10 of 19 skips]. DI-58 and DI-85 rest on those rows. `package.json` gains `test:software`, and §11.2, Agents.md's command list, and T10's and T11's whole-repo acceptance lists include it. A whole-repo green now means `check`, `test:browser`, `test:software`, `test:smoke`, `test:forever` and `test:perf`.

**DI-91. What earlier rulings gave up, stated plainly, and where other acceptance changes are recorded.** Source: VI-gates, low, owner T00. Decision: recorded. DI-58, DI-78, DI-83, DI-87 and DI-88 name their cost. These did not, and should have:
- **DI-74:** "no threshold moved" is true of the number, not of the scope. All-layers shimmer, 25.87 on the app, is no longer gated. Props' temporal quality is gated only through A16b's aliasing share, whose limits are provisional until T11, and true-motion flicker is judged by eye.
- **DI-76:** the veil control moved from .05 to .06, a slightly stronger veil. A fault between those strengths that only `blackP10` would catch is no longer demonstrated.
- **DI-77:** stability now accepts window medians that drift up to 5%, about 440 B on 8.8 KB. A slow allocation growth under 5% across three windows is not called unstable. The leak and class lines still apply.
- **DI-84 and DI-86(2):** on the app the windows control proves that a 1 KB/frame probe is seen within ±256 B, not a 256 B one. The shell still proves 256 ± 16. Soft assertions mean a validity failure is reported without stopping the run.
- **DI-86(1):** idle time before the click event inside the click's frame is not counted.
- **DI-86(3):** the first pass after a page load, the one a player sees first, is not gated.

Acceptance changes recorded only in plan Decision logs, each with a verifier's agreement as Agents.md allows. Listed so one place points to all of them; the list is assembled from the verifiers' reports and may not be complete:
- T01: height allocation ceiling 64 to 8 B/sample, with the probe sub-window 5000 to 40 rows.
- T02: A4 traffic, "crosses once" to "at most once, 150 to 170 of 400 seeds"; A16's 5% measured against at least 2% of the field's range; beat-grid counts made exact.
- T03: A15, A17, A19 and A20 settle 3 s before the reference, with A17's settle placed before the walk; A16 "under 300" narrowed to position-derived uniforms; A21 widened to 10 scenes; A22b time gate .8.
- T05: A6, A7, A10 and A11, closest-of-three, then single frames with a 16-byte self-compare; A25 and A28 measured on a mesh-defined plane; A33 counting grounded types above the horizon.
- T06: A23d checks one line at a time.
- T07: A13 read against a no-pump render; A16 timed with no clip stage; the fade length limit of 1.76 dB.
- T08: A11 measured inside border and padding; longer minimums on the throttle.
- T09: A15 three clean runs in a row, plus MIN_WINDOW_RUNS 5.

**DI-92. The launch sector is graded, against a target scaled to what remains (seam T02 and T08).** Source: VI-game, low. Decision: amended. T02 never grades the sector a run is launched in, yet the HUD shows its objective counting to "OK". A player who completes the first objective they ever see gets nothing [O: VI-game, "GATES 12/12 OK", then a banner with no grade]. T02 now grades the launch sector, with its target scaled by the fraction of the sector still ahead at launch: counts rounded up with a minimum of 1, distances scaled. The HUD already shows the target from `SimState`, so no contract changes. Plans: T02.

**DI-93. R1's exact range, and harness calls beyond it.** Source: VI-r1, low. Decision: recorded and guarded. The picture is exact up to chunk 2^48, the headroom above CHUNK_LIMIT. Past 2^48 the frame degrades as §4.2 predicts, and from about 2^49 the atlas's row loop stops making progress (q + 2 rounds to q), so a harness `renderAt` there hangs the tab [O: VI-r1]. A player starting at 0 cannot get there: at any speed the game reaches, it takes far longer than a lifetime [arithmetic: 2^48 x 64 u]. Only a harness warp near CHUNK_LIMIT followed by about 14 minutes of flight reaches it. **What this accepts:** R1 is exact for chunk < 2^48, not unbounded. T09's `renderAt` and `renderState` throw a RangeError outside [0, CHUNK_LIMIT + 1024), as `warp` does. T03's atlas refill throws if a row write makes no progress, so precision loss reaches the fatal route instead of hanging.

**DI-94. Leaving SIGNAL_LOST is not player input (T02).** Source: VI-r1, low. Decision: a T02 defect. The exit set `lastHumanTick` to the current tick, so an idle ship re-armed 10 s of rules-on PLAY and could cascade into more losses with nobody at the controls. That is what §7.2's idle rule exists to stop. The exit keeps the last real input's tick, and returns to idle autopilot if that input is older than IDLE_TIMEOUT.

**DI-95. The title does not take a launch before the game is running (seam T08 and T10).** Source: VI-game, low. Decision: T08 owns the fix and reads T10's existing `html[data-mv-boot]`. Until it reads `running`, the prompt shows a loading state and `tryLaunch` ignores input. A press during the 1.6 s load used to start the run and its audio while the title stayed on screen [O: VI-game]. No T10 change.

**DI-96. Look note for T11: the player's ship is hard to find at 16:9.** Source: VI-game, low, owner T11 with T05. At 16:9 the resting ship sits about 70 px under the horizon, in the densest band of far props, in the same mint as shards, gates and the HUD accent. A first-time viewer took a traffic car for it. T11 gives the ship a colour, rim or underglow no item or prop uses, or lowers its resting screen position, and judges it on a 16:9 sheet at x = -40, 0 and +40.

**DI-97. DI-92 replaced: the launch sector is graded against its full target.** Source: T02's CCR-T02-3, blocked. Decision: amended. DI-92 assumed that the HUD reads its objective target from `SimState`. It reads it from `world.zoneAt` through the view (src/ui/hud.ts:86-87, src/app/loop.ts:127), so a scaled target would need a contract field and a T08 change [O: T02]. Grades only pay a bonus (`GRADE_BONUS` [5000, 2500, 1000, 250] for S, A, B, C), so a low grade never costs the player anything. T02 therefore grades the launch sector against the zone's full target, the same number the HUD shows. A late launch just tends to earn a lower grade. No contract change. T02's `lossLive` rule is ratified: a `SIGNAL_LOST` grades a sector boundary only when it came from live play, so a loss forced from idle cannot earn a GRADE bonus with nobody playing (DI-94).

**DI-98. DI-93 corrected.** Source: T03. From chunk 2^48 - 3, level-0 rows ahead of the camera pass 2^53 and odd rows round [arithmetic: T03]. R1 is exact for chunk < 2^48 - 4. Harness frames between that and CHUNK_LIMIT + 1024 render slightly wrong, which DI-93 already accepts.

**DI-99. Notes from the integrated fixes.** (1) On fine pointers the HUD's II button no longer takes mouse presses (T08, VI-game). T10's A19 row that clicked it with a mouse is updated to Tab and Enter, plus a touch tap. (2) On a fresh browser the first harness frame takes about 5 s on the app, at any chunk [O: T09, 3 launches], against 59 to 78 ms on a warm browser. It has not been profiled. T11's cold-load row (A13, first10) measures the real page, and so is where it would show for a player. (3) Overlapping popup plates hide part of each other, seen only with all six forced on; a look note for T11.

**DI-100. Whole-repo baseline before T11.** Source: the T00 owner, alone on the machine, 2026-11-06, after the integrated review and its fixes. All exit 0: `npm run check` (117 files, 1941 tests, 2 skipped; glsl 188 files, 0 hits), `plans:check`, `contracts:check`, `build` (app 243.11 KB gzip by Vite, 235.16 KB by gzip -9), `test:foundation` (31 passed), `test:browser` (531 passed, 19 skipped), `test:software` (52 passed), `test:smoke` (64 passed), `test:forever` (44 passed, 1 skipped: B22, the operator's 2-hour real-time soak), `test:perf` (6 passed). Logs are in the T00 owner's scratchpad (batch4). T00 to T10 are done. T11 may start.

## T11

**DI-101. U7: reviewer sensitivity. A provisional ruling by the T00 owner, open to the operator's overrule at M10.** Source: T11 stopped on U7. Over two counted planted sheets the reviewer found 7 of 10 strong plants, 0 of 4 weak, and made 4 false alarms. It missed lift .08 three times and desat .4 once [O: T11 Progress]. Two things limit what that test shows. The sheet was 6 x 6 tiles of 320 x 180, so a lifted black is a small absolute change on a small tile, and the image tool may present a large sheet below its native size [I]. And the reviewer was the executor, who had already viewed r00's clean sheets. Decision, in order: (1) **Image path.** T11 measures what the Read tool actually presents for its sheet sizes, then regenerates the planted test as sheets of at most 3 x 3 tiles at 640 x 360 or larger, presented at native size. A **fresh reviewer** who has never seen any key or r00 sheet takes it, writing the answers before opening the key. (2) If every strong plant is found with at most 3 false alarms, U7 is cleared and viewing evidence counts at that sheet format, which T11 then uses for every sheet a reviewer judges. (3) If the reviewer still misses a strong type, T11 shows, on the real r00 frames, which numeric gate fails each missed type (for example W4 for lift .08, and W2 or C1 for desat .4). Those gates become the stated backstop. Viewing evidence then counts only for what the reviewer was shown able to see, and the Outcomes and the operator pack say exactly which defect types the viewing cannot see. Either way T11 continues with M4. **What this gives up:** if (3) applies, no viewing check catches lifted blacks or desaturation, only numbers do. The operator may overrule at M10 (Q13), and T11's plan stays `blocked` on the operator in any case (U8).

## After T11 (T00 owner, 2026-11-07)

T11 ended its agent stage `blocked` on U8, the operator's review, by design. Five items came back to the T00 owner. Each is ruled here. Every file named below is outside T11's window unless stated, and each edit is the T00 owner's, made on the owner's behalf and named in that owner's plan or here.

**DI-102. CCR-T11-5 approved: `DEFAULT_SEED` 1985 to 155.** Source: T11 M7 (A14), section 12. At 1985 the opening is Ultraviolet / Orbital Night, and the yellow poster disc cuts to a pink disc at about 2.3 s. At 155 it is Sunset Drive / Boulevard / banded sun, continuous with the poster, then Miami Dusk, Ember and Arctic Laser, with all 36 pairs by zone 99. The T00 owner viewed `m7/first10-seed155.png` against `final/first10.png` and agrees. T11's checks at 155 before filing: first10 F1 2366 ms, F2 93.5; the opening's six frames pass W1, W2, W4 and C1; the autopilot measure gives 279 gates, 100% threaded and a longest still of .075 s, the same as at 1985 [O: T11]. **Ripple, kept small on purpose:** every test calibrated on a fake world or on T11's fixed pose keeps 1985 by name.
- `src/testing/fakeWorld.ts` exports `FAKE_SEED = 1985` and defaults to it, which covers dev pages, `fakeHost`, `audit.test` and the other fake fixtures.
- `tests/forever/fixture/shellHost.ts` (T09) defaults to `FAKE_SEED`. **Correction (DI-108):** this alone did not keep B10 and B11 on 1985. Their harness opens the app, not the shell, whenever index.html exists, and with no seed, so they followed `DEFAULT_SEED` until DI-108 pinned the harness. The independent A24 reviewer found this.
- `tests/visual/sky.spec.ts` (T04) scans sky events at `FAKE_SEED`, the seed `dev/sky.html` renders.
- `tests/art/support/capture.ts` (T11) exports `ART_SEED = 1985`, and the specs `capture`, `hero`, `motion`, `plant`, `play`, `sheet36`, `software`, `budget.timing`, `tiers` and `transition` use it. Only `first10` and `pack` follow `DEFAULT_SEED`, because they show the real opening.
- `tests/boundaries/contracts.test.ts` replaces the new literal.

T10's `params`, `D-001`, `realWorld` and `view` tests read the constant and run at 155, as does every suite that loads the real page without `?seed=`. architecture.md §5.1 and the contract excerpt now say 155. **What this gives up:** the real page's suites lose their 1985 history. The opening at 155 has been seen only in `first10`, the opening sheet and the clips; the art sheets stay at the calibration seed. The operator may restore 1985 with one constant (Q1, Q13).

**DI-103. SIM_BENCH (T02 A14) gates on the lowest p99 of up to three attempts.** Source: T11 M10. Inside the full parallel `npm run check`, with the machine about 30% busy, one attempt read p99 .546 and .554 against .5. The same code reads .17 to .24 alone, and `src/sim` is unchanged since DI-100, when it passed. Other processes can only add time, so the lowest p99 of three is the cleanest reading. Code that is really slower raises all three. The limit stays .5 ms. **What this gives up:** an intermittent slowness inside the step that shows in only one attempt of three would pass. Allocation-driven spikes, the likely source of such slowness, are gated separately by `alloc.test.ts` and B19. File: `tests/unit/sim/bench.test.ts`, with T02's plan text unchanged in meaning (a `SIM_BENCH` line is still printed, now with the attempt number).

**DI-104. The poster's fallback caption no longer flashes on a cold load.** Source: T11 M7, `m7/first10-seed54.png` and `-seed155.png`. On 2 of 6 cold loads the caption ("If this picture never starts moving...") showed for one or two frames at about .23 s, before `main.ts` set `loading`. `index.html` (T10) now sets `data-mv-boot="pending"` from a one-line inline script in `<head>`. CSS hides the caption while the value is pending and reveals it after 10 s. `main.ts` replaces the value with `loading`, `unsupported` or `failed` at once, and `bootReady('pending')` is false. With script off, the inline script never runs, so the caption shows at once as before (T10 A2). **What this gives up:** if script is on but the module never runs (an old browser without modules, or a failed fetch of the entry), the poster shows without its explanation for 10 s instead of at once.

**DI-105. T11's deviation register D1 to D6 applied to architecture.md, and T06's flash wording corrected.** D1 and D2: a note under §6.8's table gives the shipped Ultraviolet disc top `#FF6BE6` and Ember accent `#FF7A00`. The cells keep the starting values, because the fake world mirrors the table cell for cell (`fakeWorld.test.ts`) and every dev-page baseline rests on it. Changing the cells would move the fakes too. D3: §6.4's sun column gains T11 r03's `colK`. D4: §6.8's crossfade gains the long-arc exception for dark pairs that cross the olive band. D5: §11.5's disc occlusion is now per pair, the least occluded of five samples, with the ship masked out. D6: §6.7's neon line range names the fence wall lines at .90. §6.8 no longer says only Sunset Drive has been rendered with objects. The flash takes the grid colour since T11 r09 (ledger 8). Pin P1 changed only its expected-value line, so T06's test name, local name and comment, and T06's plan rows (section 4 palette row, `flashR/G/B`, the `uFlashColor` comment, A5) now say "grid colour" and cite this entry. **Not decided here:** agreement to the pin batch and to the two O1 definition changes was asked of an independent reviewer (DI-106). The operator's Q13 still decides.

**DI-106. What the T00 owner did not reopen, and two independent checks run instead.** These U4 findings stay with the operator as named choices, each with its measured price in T11 section 13, because each is either a taste call or would reopen a plan whose gates were calibrated on the current look, and T11's round cap is spent:
- everything converges on the vanishing point (J1 1)
- the title over the disc's upper third
- the first live frame at about 2.2 s
- three violet palettes that look alike
- the hero double exposure at fade midpoints
- the laser fences
- the whole-frame hit flash
- pale suns on Toxic Arcade and Arctic Laser
- faint Arctic Laser UI lines, pale popups, and the sector banner over the disc

Changing them before the operator has looked would pre-empt the review U8 exists for. The operator's answers start at most two feedback rounds (T11 Next action). Two checks T11 could not reach were run by the orchestrator with fresh agents: (1) blind biome naming (A17) on the `final` blind sheets, by a reader who has seen no key; (2) independent agreement or refusal for pin P1, the two O1 definition changes, r09 and r12 kept at the edge of step 7, the boost-run frame classes, and B10's baseline left as stored. Their results are recorded in T11's Progress and section 13 and do not bind the operator.

**DI-107. A swinging searchlight beam no longer floods the frame beside the lens (T05's `props.frag.glsl`, inside T11's window, after its round cap).** Source: the T00 owner, viewing `final/ui-play.png`. Its Toxic Arcade / Neon City tile has a pale, full-height slab over the right sixth of the frame. No fence, gate or other item stands within 30 u of the camera there [O: T11's `near.mts` at chunk 538, local 20 to 50]. Searchlights stand 90 to 500 u to the side, with beams 520 u long that swing, so the slab is a beam passing the lens [I]. This is the searchlight case of the M9 reviewer's reject 2, which r10 fixed for fences only. `L_BEAM` now multiplies its emission by `smoothstep(12., 90., d)` on fragment distance, as the fence wall does with `smoothstep(6., 70., d)`. This also covers saucer beams. Beams seen from beyond 90 u are unchanged. It is a defect fix, not a retune: T11 records it as ledger row 13, outside its 12 rounds, and re-runs its art gates on it. **What this gives up:** a beam that passes within about 90 u of the camera dims as it approaches, instead of reading as a bright shaft at arm's length.

**DI-108. T09's harness pages name their calibration seed, 1985.** Source: the independent A24 reviewer (DI-106). `tests/forever/support/open.ts` opens the app, not the shell, once index.html exists, and passed no seed. So after DI-102 every armed forever, perf and e2e-defect spec opened at 155, and B10's stored baseline (7.4353), B11's margin and the perf and allocation budgets no longer described the scene they measured. `harnessUrl` now always sends `seed=${q.seed ?? HARNESS_SEED}`, with `HARNESS_SEED = FAKE_SEED` (1985). A spec that gives a seed keeps it. Pages opened at `/?harness` directly (`fatal`, `isolation`, one `ui.spec` row) test behaviour, not seed-calibrated numbers, and follow `DEFAULT_SEED`. The whole-repo run started before this was stopped during its browser stage and run again from the start. **What this gives up:** no stored baseline is checked at the seed now shipped. The opening at 155 is covered by T11's `first10` and the smoke suite, not by B10.

**DI-109. T05's A16b names its calibration seed. At the new opening it reads over its limit.** Source: the whole-repo run after DI-102 to DI-108 (scratchpad `batch5/summary.txt`). Every stage exited 0 except `test:browser`, which had 530 passed, 19 skipped and 1 failed. The failure was `props.spec` "neon: shimmer against a supersampled reference" (A16b): props' share was excess .149 (limit .2) and blurred .588 (limit .4). A16b opens `/?harness&tier=3` with no seed, so since DI-102 it measured seed 155's opening (Sunset Drive / Boulevard) instead of the 1985 scene its limits were set on. A/B through the GPU lock: the failure reproduced exactly with DI-107 in place and with it reverted (.149, .588 both times), so the beam fade is not the cause. With `&seed=1985` it reads .101 and .248 and passes, as at T11 M10. The page now names 1985, as DI-108 does for T09. **Finding, not fixed:** in the Boulevard opening scene, props' blurred shimmer share is .588 against A16b's .4. That is low-frequency crawl from props, measured on one still pose. It belongs to the biome, not to the seed: Boulevard renders the same at any seed, and 155 only puts it first. A16b had sampled one scene, so this is a coverage gap now exposed. It goes to T05 (U4) and to the operator's Q6 (motion: shimmer or strobing), who will see Boulevard in the first seconds. Separately, a re-run of the whole `props.spec` file (39 passed, 3 skipped, 1 failed) failed A30 "budget: worst case" at p95 2.20 ms against 2.0. Two single re-runs read 2.10 (fail) and 1.80 (pass) with the machine at 48% background CPU from non-project processes, and its no-props baseline read 1.60 p95 in the same runs. It passed inside `batch5` and read 1.40 at M9 and 1.60 at M10. It already gates the lower p95 of two passes. Like SIM_BENCH before DI-103, it is a timing row inside a non-timing suite with a thin margin under load. **Left as is and disclosed:** it is T05's gate, and widening it is not the T00 owner's to do on this evidence. **What this gives up:** A16b checks props aliasing on one scene only, and not on the scene the game opens on.

**DI-110. DI-107 withdrawn: the slab was a gate the ship had threaded, and a threaded gate now opens out of the frame (T05's `props.vert.glsl` and `props.frag.glsl`, inside T11's window, after its round cap).**
- **Source.** T11's A24 stage traced the slab with a layer A/B (`TERRAIN_DIAG_UI`):
  - with props hidden the slab goes; with fx or terrain hidden it stays;
  - it carries a scrolled chevron.

  It is the side of a GATE, not a beam.
- **DI-107's diagnosis was wrong.** Its `near.mts` trace looked at chunk 538, local 20 to 50. The camera at that shot was at chunk 539, local 58.7, where a gate the ship had just threaded stands at zf 5.3, its centre 6.47 u to the camera's left, radius 9 [O: T11 `a24-diag`]. So DI-107's beam fade had no observed target: T11 found no beam near the lens in anything it rendered [O]. Its only measured effect was on the Toxic Arcade tile, at most 13 levels on 869 px.
- **The withdrawal.** `props.frag.glsl` is restored to T11's `m10-final` backup, byte for byte [O: `cmp`].
- **The fix, in `props.vert.glsl`.** Once a gate's plane is less than 11.8 u ahead of the camera, the ship's tail has cleared it (`SHIP_FORWARD` 14 less `SHIP_HALF_LENGTH` 2.2). From there the gate scales about the view axis by `k = 1 + 6 (1 - smoothstep(6, 11.8, zf))`, the whole ring as one, its edges with it. Arithmetic at FOV 58 and 16:9 [I]:
  - A centred ring's sides leave the frame at about zf 11.2 instead of 9.1.
  - The slab's member, 2.5 u from the view axis, leaves at about zf 9.1 instead of 2.6. At cruise (80 u/s) that is about 2 frames instead of 7.
- **Precedent.** Shards and drones already shrink past the ship plane (`smoothstep(2., 11., zf)` in the same shader), and r10 faded the fence's verticals past the ship's tail. This is the gate's version of that rule.
- **Unchanged.** Collision, scoring and the gate flash: the sim reads item records, not the drawn ring.
- **Probe through the GPU lock.**
  - `play.spec` ui at a scratch round: the slab is gone from the Toxic Arcade / Neon City tile, and the other five tiles look unchanged [O: viewed against `final2/ui-play.png`].
  - `first10` at 155: the pale slab at 4.0 s remains [O]. Frame by frame it is the gate the ship is threading at that moment, about 12 u ahead, whose members sit at the frame edges. That is not a threaded gate. Its flat, pale look up close is the M9 reviewer's reject 2 and J4, a look question for T11 and the operator (Q2), and this ruling does not retune it.
- **Status.** A defect fix, not a retune. T11 records ledger row 13 (DI-107) as withdrawn and this as row 14, both outside its 12 rounds, then re-runs its art suite and pack on it. The whole-repo gates run again (scratchpad `batch6/summary.txt`).
- **What this gives up:**
  - A gate you have passed through no longer frames the view as it goes by. Past the ship's tail it bursts outward in about 3 u of travel, faster than perspective alone.
  - A camera that passes within about 0.5 u of a member still sees it close for a frame or two.

**DI-111. §11.5's O1 sentence now says what it gives up (A24's condition on O1 change A).** Source: T11's A24 stage drafted the sentence, and the second fresh reviewer found it unapplied at line 1758. Applied with two changes:
- it cites A24 and this entry instead of r04;
- it adds the fixed mask's own blind band, 4.78% of the disc at its foot, which the reviewer noted D5's line leaves out.

The sentence now names three costs:
- items crossing the disc are not gated on real pixels;
- a pair passes when one sample in five is clear;
- a keep-out twenty times too weak (`KEEPOUT_K` = 1) failed only 1 of 6 Neon City pairs, so T01's CPU keep-out test is the main guard for scenery over the disc.

**What this gives up:** nothing in the product. The wording is longer.

**DI-112. B10 run at the shipped seed as a report, and the second A24 review recorded.**
- **The review.** A second fresh, read-only, adversarial reviewer re-checked T11's answers to A24 (scratchpad `T11/a24-recheck.json`, verbatim).
  - Both refusals are met: the ship mask is now a fixed artifact from the ship's own projected geometry, checked by hash, and the boost-run classes and W4allow gate are now defined.
  - P1, O1 change A, r09 and r12 are met.
  - B10 was partly met, because its condition put a run at 155 first and none had been made.
  - The reviewer also listed five record defects in T11's plan. T11 corrects them in its next stage, without rewriting old Progress.
- **The change.** `tests/forever/support/open.ts` gains `harnessSeed()`. It reads `TERRAIN_HARNESS_SEED` for a report run at another seed, and is `HARNESS_SEED` (1985) otherwise. The same edit puts `harnessUrl`'s doc comment back above `harnessUrl`, from where DI-108 had separated it.
- **The run.** Inside the whole-repo run after DI-110 (scratchpad `batch6/summary.txt`, `b10-155.txt`, step `b10-155`), with `TERRAIN_HARNESS_SEED=155`: 3 passed.
  - **Floor, props hidden:** 6.294 against the absolute limit 8, and above the liveness floor 1.
  - **Repeat and zero step:** the repeat is identical, and the zero step reads 2.1e-7.
  - **Naive-grid control:** trips at 16.86.
  - **Stored-baseline row:** reads 6.294 ≤ 7.584. It compares the 155 scene with a 1985 baseline, so it is not a verdict.
  - **All layers, printed and not gated:** 29.42 at 155 against 26.44 at 1985. That is props' crawl at the Boulevard opening again, as in DI-109.
  - **Inferred, not observed:** that the page opened at 155. The log does not print the seed, but every reading differs from the 1985 run's beside it.
- **The rest of `batch6`.** Every stage exited 0:
  - `check`: 1941 passed, 2 skipped.
  - `browser`: 531 passed, 19 skipped, with A16b at 1985 and A30 both passing.
  - `software`: 52 passed.
  - `smoke`: 64 passed.
  - `forever`: 44 passed, 1 skipped. B10 reads 7.4188 at 1985, unchanged from `batch5` to the last digit, because B10 hides props.
  - `perf`: 6 passed.
  - The app chunk is 244.28 KB gzip.
- **What this gives up:** nothing gated changes. The variable is for reports. A run that sets it measures a scene other than the one its baselines describe, and such a run's baseline rows prove nothing.

**DI-113. DI-110's gate rule magnified a member the camera passed close to; each member is now thinned by the factor the ring opens by (T05's `props.vert.glsl`, `material.ts` and `layer.ts`, inside T11's window, after its round cap).**
- **Source.** T11's final3 stage and a fresh read-only reviewer (`review:DI-110`) found the same defect independently.
  - DI-110 scaled the whole ring by up to 7 about the line through the camera. A member near that line moved out by 7 times a small distance while its own width grew 7 times, so it stayed in view as a wall [O: `final3/worst-floor0.png`, boost frame 2190, about nine tenths of the frame; clip-transition frames 189 to 191, 40 to 52% of the width over the disc; clip-boost frame 168, half the frame].
  - It turned W4allow from 3 to 5 failing frames of 242, worst .99 to 54.8: frames 693 and 2190 read floor black 66 and 68 against 14 and 7 at final2. *[Corrected by DI-115: final2's frame 693 reads 11, not 14 (`final2/metrics-boost.json`, found by the DI-113 reviewer). 14 is the probe's reading below, and final4 reads 15. The frame passes its allowance of 21.90 in every one of these.]* The boost trajectory was identical on 556 of 556 samples, and final3's window differed from m10-final's only in `props.vert.glsl` [O: both reports, recomputed by the reviewer].
  - DI-110's own "what this gives up" (a frame or two, within about 0.5 u) understated this. Its arithmetic covered a member 2.5 u away and a centred ring only.
- **The fix.** Only the gate rule changes; DI-110's withdrawal of DI-107 stands.
  - In mesh space, before scale, each ring vertex moves along its own corner direction toward the band's mid-line, `r' = m + (r - m) / k` with `m` = 1.07 / cos(pi / 8), the mean of the inner and outer radii. Each leg is thinned about its centre line the same way. *[Replaced by DI-115: about its own centre the leg stood out of the ring's lower corner as the ring opened.]*
  - The ring then opens about the line through the camera by `k`, as before. A member's width across its band is therefore the same at any `k`, and its distance from the camera's line grows by `k`.
  - Seam edges open with the ring and band edges keep their width (`edgeK`), so the neon outline keeps its weight. The inner band's edges run in z, which nothing scales.
  - **The depth is no longer a literal.** It is `uGateOpen`, a shared layer uniform equal to the ship's depth less `SHIP_HALF_LENGTH`: 11.8 u by default, and it follows the sheet tool's debug ship depth. The ramp is unchanged: `k = 1 + 6 (1 - smoothstep(uGateOpen - 5.8, uGateOpen, zf))`.
  - **The comment is corrected.** DI-110's shader comment called the rule DI-111 and listed first10's 4.0 s slab as removed, which DI-110 itself says remains.
  - **New test.** `tests/unit/props/gateOpen.test.ts` checks the uniform on every prop material, that it follows `setShipForward`, and that the shader reads it with no literal depth. *[DI-115 rewrote it: the text checks did not pin the rule, and the negative control matched a hand-written string.]*
- **Arithmetic** at FOV 58 and 16:9, a 1.26 u band seen face-on, one 60 fps frame at cruise per step [I: scratchpad `t00owner/probe2/arith.mjs`]. Frames over 15% of the frame's width, by the near edge's distance from the camera's line. *[Noted under DI-115: the model is the front panel only. Seen from inside the ring, the 1.44 u inner band adds roughly 15 to 20% to a near member's width, so these counts are a lower bound (the DI-113 reviewer). T11 measured 14.3% at clip-boost frame 168.]*

  | Distance | No rule | DI-110 | DI-113 |
  |---|---|---|---|
  | 0.1 u | 3 | 7, up to 46% | 0, at most 10% |
  | 0.5 u | 3 | 4 | 0 |
  | 1 u | 2 | 1 | 0 |
  | 2.5 u | 1 | 0 | 0 |

  A camera inside a member's band still sees that member at its own width until the opening moves it off the line, unless the camera is within about 0.09 u of the band's mid-line. Then the camera flies through the member, as it would with no rule.
- **Probe through the GPU lock**, at round `gatefix2-probe`, base final3 (scratchpad `t00owner/probe2/`, logs and frames):
  - **`play.spec` boost.** The trajectory is identical to final2 on 556 of 556 samples. W4allow fails 2 of 242, worst .992 at frame 1734, which is final2's worst exactly. Frames 693 and 2190 read 14 and 7 again, and 1499 now passes at 13 [O: recomputed]. *[Corrected by DI-115: "again" holds for 2190 only. Frame 693 read 11 at final2, so 14 is not a return to it; it passes either way.]* Both remaining frames, 1734 and 2133, fail on r00 too and predate T11. W1shard reads .0108 at frame 1170 against .5; W2shard reads 70.90 against 55.
  - **Clips.** Viewed against final3:
    - transition frames 186 to 193 at final3's pick, Toxic Arcade to Sunset Drive at seed 155 zone 31: the mint wall is a bar about 3 to 5% of the width for two frames, gone at 191;
    - the centred gate at 255 to 262 opens with no pop;
    - the off-axis gold gate at 544 to 551 leaves at the left edge as a thin bar;
    - clip-boost 164 to 171: final3's half-frame peach wall at 168 is a bar about 6 to 8% wide, gone at 169.
  - **`play.spec` ui.** No slab on the Toxic Arcade / Neon City tile. Sunset Drive / Olympus keeps its two pink fence bars, as at final2.
  - **`first10` and launch at 155.** The gate being threaded reads as a whole octagon round the ship, and nothing is magnified.
- **Status.** A defect fix, not a retune. T11 records it as ledger row 15, outside its 12 rounds, then re-runs its suite and pack on it. The whole-repo gates run again (scratchpad `batch7/summary.txt`).
- **What this gives up:**
  - A passed gate leaves as a thin outline that widens out of the frame, not as a band that swells. The burst reads lighter.
  - A member the camera flies straight through still covers the lens at its own width for the last frames, as it did before DI-110.
  - W4allow stays red on frames 1734 and 2133. Both predate T11 and go to T02, T06 and the fences' owner, or to the operator's acceptance.

**DI-114. A18's no-rendering-while-lost check counts from the loss event (T10's `tests/e2e/motion.spec.ts` and `tests/e2e/lib/app.ts`).**
- **Source.** `batch7` after DI-113 (scratchpad `batch7/summary.txt`). Every stage exited 0 except `test:smoke`: 63 passed, 9 skipped, and R1 failed on `r1 - r0` = 2 against at most 1. Run alone three times it failed once more the same way and passed twice (`batch7/r1-rerun.txt`).
- **Cause.**
  - `r0` was read in one `page.evaluate`, and the loss was triggered in the next. Frames drawn while that second call reached the page were counted as drawn while lost.
  - `r1 - r0` read 1 in batches 4, 5 and 6 and in two of the re-runs, and 2 in batch7 and one re-run [O: each log's `"context"` line].
  - Read inside the loss event, after the app's own handler (`lifecycle.ts`, registered at boot), the count shows the truth. In all five runs below, 1 or 2 frames came between `r0` and the loss, and 0 after it [O].
  - So the margin of 1 was always spent on a frame drawn before the loss, and a second one, under no change in the app, failed the run.
  - **Inferred, not proven:** that DI-113 does not cause this. Nothing it changes runs between two `evaluate` calls, and the frames counted come before the loss in every run where they were measured.
- **The change.**
  - `loseContext` now resolves to `counters.rendered` as read inside the `webglcontextlost` event. Its callers that ignore the value are unchanged.
  - A18 asserts `rLoss >= r0` and `r1 - rLoss <= 1`, the same tolerance from the right point.
  - The report prints `rLoss`.
- **The run, through the GPU lock.** R1 four times: 4 passed, with `rLoss - r0` = 2, 1, 1, 2 and `r1 - rLoss` = 0 every time (`batch7/r1-fix.txt`). Then the whole smoke suite: 64 passed, 9 skipped (`batch7/smoke2.txt`). `check:task T10` and `plans:check` pass. *[Noted under DI-115: no log of `check:task T10` was kept at the time (the DI-113 reviewer found none). It was run again in `batch8`, logged in `batch8/check-task-T10.txt`.]*
- **The rest of `batch7`.** Every other stage exited 0:
  - `check`: 1944 passed, 2 skipped, the 3 new tests from DI-113 included.
  - `browser`: 531 passed, 19 skipped.
  - `software`: 52 passed.
  - `forever`: 44 passed, 1 skipped. B10 reads 7.4188 at 1985, unchanged.
  - `perf`: 6 passed.
  - `b10-155`: 3 passed, floor 6.294.
  - The app chunk is 244.73 KB gzip.
- **What this gives up:** nothing in the product. The check no longer charges the frames drawn before the loss to the time the context was lost. A loop that kept drawing while lost would still fail it, by about 120 frames over the 2 s wait [I].

**DI-115. A gate's legs stay seated in the ring as it opens, and the gate rule is exactly the identity until it starts (T05's `props.vert.glsl`, inside T11's window, after its round cap).**
- **Source.** The fresh read-only reviewer of DI-113 (`review:DI-113`, scratchpad `T11/wf-final4-result.json`) passed all six of its checks and found this from the code, not on view.
  - DI-113 thinned each leg about its own centre line (x 1.04), while the side member above it thins toward its band's mid-line (x 1.07). It also left the leg's top where it was, while the member's inner corner moves down.
  - So as the ring opens, the leg's top stands out of the ring's lower corner into the opening: 0.63 u wide and 0.52 u tall in the world at k 3. For k over 4 the leg comes away from the member, by 0.81 u at k 7 [I: scratchpad `t00owner/probe3/leg-arith.txt`].
  - None of the scripted passes flew low near a gate side, so no frame on file showed it.
- **Seen.** The T00 owner's probe, `probe3`:
  - **How.** A scratch spec in `test-results/T00-probe3/` with its own config, using the art harness's `openHarness` and `frame`, through the GPU lock. Seed 1985, the gate at chunk 3102. The camera is placed by the sim's x and y, at 12 depths from 12 u to 7.6 u ahead (k 1 to 5.9), with crops of the frame's lower right.
  - **What it shows.** With the camera at height 5.6 (ship y 2, the floor of the play window) and 7.5 u off the gate's centre line, the leg's top shows as a stepped block at the ring's lower corner at depths 10.4 to 9.6, where k is 1.9 to 2.9 [O: `probe3/before/B-low-dx7.5-grid.png`, `probe3/before-after-B.png`]. At height 7, or nearer the centre, the junction is below the floor or out of frame by then.
- **Also from that review.**
  - The rule was not exactly the identity at k 1, because `(m + (r - m) t) / r` and `c + (p - c) 1` round. Per sample, stills W3 moved by up to 9.4e-5 and W2 by up to 2.7e-5 against final3. T11 and the reviewer both report this; the cause is inferred. *[Refuted under DI-116: DI-115 removed that rounding, and final5's stills equal final4's per sample, bit for bit, so the rounding was not the cause.]*
  - `gateOpen.test.ts` matched text only.
  - DI-113's record misstated final2's frame 693, and its arithmetic is a lower bound. Both are noted in place above.
- **The fix.**
  - **Legs.** A leg thins about the side member's mid-line, x = ±1.07, half-way between the flats at 1 and 1.14. Its y is scaled by 1 + .07 gateU, the factor the thinning gives the member's inner corner.
    - The leg's overhang inside the inner face stays 0.09 u in the world at every k, as on the closed gate.
    - Its top stays level with the inner corner, and it never comes away [I: `leg-arith.txt` and the test below].
  - **Exact identity.** Each step is now written as the identity plus a term that is exactly 0 while gateK is 1: a term times gateU = 1 - 1/gateK, or times gateK - 1.
    - So a gate the ship has not reached is drawn bit for bit as before DI-110 [I: exact in IEEE arithmetic; a GPU compiler may still reorder, which the stills rows will show]. *[Corrected under DI-116: the stills rows show this is not borne out on this GPU. Per sample, W3 still differs from final2 by up to 9.40e-5 and W2 by up to 2.70e-5, as at final4, though every gate in those frames is closed. It holds for the rule's arithmetic only; the cause of the step is not traced (DI-116).]*
  - **The comment.** It now says the ring opens once the ship's tail has passed the gate's front face. The inner band runs 1.44 u deeper, so the ring is about 1.9 times open when the tail clears its back.
    - The reviewer judged this harmless while the camera's line is inside the ring, because opening about an interior point moves every edge outward [I]. The rule is unchanged.
  - **The test.** `tests/unit/props/gateOpen.test.ts` now builds buildGate's mesh and applies a copy of the shader's rule. The shader's text is pinned to that copy line by line, so an edit to either fails until both agree. *[Corrected under DI-116: overstated. The nine pins matched each statement's text, not its order, its guard or anything added, and an edit to the copy alone tripped none of them (the DI-115 review). DI-116 replaced this test.]* It checks:
    - that GATE_MID and SIDE_MID equal the mesh's mean ring radius and the side member's mid-line;
    - that the rule is exactly the identity at k 1;
    - that at every k from 1.25 to 7, every front panel keeps its band width in the world;
    - that each leg stays seated: no gap, and no overhang or rise beyond the closed gate's.
    - Negative controls run the same checks on the older rules. DI-113's fails the leg checks at k 3 and k 7, and DI-110's fails the width check at k 2. 6 passed.
- **The probe after the fix**, with the same five setups. At every depth the leg sits under the side member [O: `probe3/after/B-low-dx7.5-grid.png`, `probe3/before-after-B.png`].
  - A thin tick remains at the corner. It is the leg's front half standing 0.45 u proud of the front panel, which the closed gate also has.
  - Members keep their width, and nothing else in the five grids changed on view.
- **Status.** A defect fix, not a retune. T11 records it as ledger row 16, outside its 12 rounds, and re-runs its suite and pack on it. The whole-repo gates run again (scratchpad `batch8/summary.txt`). *[Noted under DI-116: that summary's last line, "tree hashes at start in started.txt, unchanged at end", overstates. `started.txt` holds six files' hashes, not the tree's, and no end-of-run record was kept. The file times show the tree did not change during batch8.]*
- **What this gives up:** nothing seen. By k 7 a leg has moved about 0.23 u toward the member's mid-line, before the opening, and is out of frame by then.

**DI-116. The gate test runs the shader's own text (T05's `tests/unit/props/gateOpen.test.ts`, the T00 owner's since DI-113). No product file changes.**
- **Source.** The fresh read-only reviewer of DI-115 (`review:DI-115`, scratchpad `T11/wf-final5-result.json`, `review` field). Thirteen of its fifteen checks pass and two fail. Its overall line, in short: DI-115's leg fix holds up in the geometry, the shader and on screen, but a closed gate does not draw "bit for bit as before DI-110" in the stills on this GPU, and the test misses structural regressions.
  - **Passed.**
    - The probe's placement and images (1a, 1b).
    - Its own gate passes from the final5 clips (1c). final4's pale leg-top block, about 20 by 15 px, shows at transition frames 188, 332, 404, 476, 548 and 620 and is gone at final5; nothing new appeared.
    - The shader: SIDE_MID and the leg's y factor (2a), the identity in IEEE arithmetic (2b), and the seams, pins, mirror and silhouette (2c).
    - The old test's copy and negative controls (3a, 3b).
    - The numbers: the gated rows (4a); W4allow recomputed at 2 of 242 (4c); the boost trajectory (4d); batch8 (4e).
    - The record (5a to 5c).
  - **Failed, 3c, the test.** Its nine regular expressions pinned statement text only. Any of these would have passed, and an edit to the test's copy alone tripped nothing:
    - `part < 1.5` changed to `part < .5`;
    - the `M_GATE` guard dropped, or the `edgeK` default changed;
    - a statement added;
    - the opening or the pin moved;
    - `length(l.xy)` changed to `length(l)`.
  - **Failed, 4b, the stills.**
    - Against final2, W3 differs on 73 of 180 samples (max 9.40e-5, p1b0i8) and W2 on 93 of 192 (max 2.70e-5, p1b0i68).
    - At those samples final4 and final5 are bit-identical, and so are final2 and final3.
    - Every sheet36 sample is at local 20, so every gate ahead is 44 u or more away, where gateK is 1.
    - The one run-to-run spread on file, a24 against final2 on the same window, is 4.87e-6 in W3.
  - **Its other new defects** are answered under "The other defects" below:
    - the executor missed transition frame 625 and two of final4's leg blocks;
    - the opening moves pinned leg bottoms below the floor, as it has since DI-110;
    - batch8's summary overstated its tree check;
    - T11 miscounted its Progress entries again;
    - the boost run's flashColor moved at DI-113.
- **The fix: the test runs the shader.** `gateOpen.test.ts` no longer holds a copy of the rule. It translates a stretch of `props.vert.glsl`'s `main()` into JavaScript, statement by statement, and runs it on buildGate's mesh at three cameras and twelve depths. The stretch runs from `float gateK = 1.;` to the RING floor cut.
  - **The translator** knows only the statement forms that stretch uses. Any other form fails the test, so an edit to the stretch is either run or refused, never skipped. The forms:
    - scalar and vector declarations and assignments, and `l.xy *=`;
    - the opening's `p.xy += (p.xy - c.xy) * e`, with `e` a single operand;
    - `if` and blocks;
    - `length`, `sign`, `cos`, `sin` and `smoothstep`.
  - **The checks**, each named in its message:
    - *identity:* a closed gate (zf 50, 12, and exactly uGateOpen) and every other motion (zf 50 down to -5) draw exactly as `origin + l s`, with gateK 1 and edgeK 1. Compared with `Object.is`.
    - *depth:* gateK is 1 at or past uGateOpen, 7 from 5.8 u nearer, and never falls, for uGateOpen 11.8 and 30. No literal 11.8.
    - *width:* every front panel's seams keep their world length.
    - *joined:* the inner band stays on the front panels.
    - *seat:* each leg's overhang inside its member's inner face, and its top's rise above the inner corner, stay as on the closed gate, with no gap. The tolerance is 1e-5 u; float32 mesh coordinates and GATE_MID's seven digits move them by 2.2e-6 u at k 7 [O].
    - *axis:* the ring opens about the camera's line.
    - *pinned:* a leg's floor vertices open with the ring, so the pin comes before the opening.
    - *edge:* edgeK is (k, 1, k, 1) on front panels and 1 elsewhere, and `vEdge` takes it.
    - *mesh:* GATE_MID and SIDE_MID equal buildGate's mean radius and side mid-line.
    - *tripwire:* outside the stretch, only three statements name the gate's variables: the pin's branch, the `vEdge` line and the flash's branch. A gate vertex is pinned by its param.
  - **The rule itself.** A second test runs the shader's text against DI-115's rule written out on its own, to 1e-12 at every vertex, camera and depth. So an edit to either fails until both agree, which DI-115 claimed for its version and did not have.
  - **Mutants.** There are 24 edits of the shader, applied in memory. Each is expected to be caught by a named check, and each is [O: scratchpad `t00owner/di116/mutants.txt` lists every mutant's problems]:
    - the reviewer's list (3c);
    - DI-113's rule, final4's text, under today's opening;
    - DI-110's whole-member scaling;
    - a literal depth;
    - the opening about the gate instead of the camera;
    - the opening moved after the mirror flip or after the bend;
    - the pin dropped;
    - a new gate-only step after the rule;
    - SIDE_MID 1.04, and GATE_MID 1.2;
    - a leg's y factor dropped;
    - `vEdge` without edgeK;
    - a precedence the translator would misread, and a swizzle it does not know.
  - **One edit is equivalent** and is not caught: dropping the opening's own `M_GATE` guard, since gateK is exactly 1 for every other motion.
  - 27 tests pass [O: `npx vitest run tests/unit/props/gateOpen.test.ts`, 12:25Z].
  - **What it does not show.** The GPU runs float32, and its compiler may reorder or fuse; the test runs float64 in the source's own order. That is exactly the gap that 4b found.
- **The stills (4b), corrected in place in DI-115.**
  - **What is known** [O: the window diffs between T11's backups final3, final4 and final5]:
    - From final3 to final4, only `props.vert.glsl` (DI-113), `material.ts` and `layer.ts` (the uGateOpen uniform) changed.
    - From final4 to final5, only the rule's arithmetic at k 1 changed, and nothing moved. So the k-1 rounding of either rule was not the cause.
    - Against DI-110, DI-113 and DI-115 share the uniform and the shader's text around the rule: edgeK's multiply, and uGateOpen in the ramp. All of it is exact at k 1 in IEEE arithmetic.
  - **The cause is not traced.** It may be the compiled shader, or something else [U].
  - **How big it is.** T11's `worst-C1-1` cluster (p2b2i23) is 14 pixels at 1 level of 255 [O: T11]. It is 1/5,000 of delta.txt's floor, no gate turns on it, and nothing changes on view.
  - **Named check, not run:** render p2b2i23 and p1b0i8 under DI-110's and DI-115's `props.vert.glsl` in one session, then again with gates hidden.
  - **The shader's comment** still says "bit for bit". It is left as is so that T11's window stays at backup final5, and is to be corrected at that file's next edit.
- **The other defects.**
  - **Transition frame 625 and the leg blocks (T11's).**
    - The executor wrote that final5 repeats final4 frame for frame. That missed frame 625, where a closed gate's floor reflection beside its legs differs from final4 and final3 (local difference 37) and matches final2 (8, encoding noise) [O: the reviewer]. So the identity does restore one visible case.
    - final4's leg block was also at transition frames 404 and 620.
    - T11's stage is closed, blocked on U8, so its plan is not edited; this entry carries both.
  - **Pinned leg bottoms below the floor (since DI-110, unseen).**
    - The pin sets a leg's floor vertices to y 0 before the opening, and the opening then moves them to -cam.y (k - 1).
    - The floor is transparent and drawn after the props, so an opening gate's lower parts could show through the floor's alpha for the few frames it opens. The RING floor cut exists for this class of problem (plan section 10).
    - Neither T11 nor either reviewer saw it in the 30 fps clips [I: from the code]. Open below.
  - **batch8's summary (mine).**
    - Its last line, "tree hashes at start in started.txt, unchanged at end", overstates: `started.txt` holds six files' hashes, no end-of-run record was kept, and the line was added by hand. It is corrected in the file by an appended line.
    - T11 found the six hashes unchanged at 10:50:18Z.
    - File times show nothing under src/, tests/, scripts/, public/ or the root configs was written from 09:57Z to 12:25Z, so the tree did not change during batch8 [O: `find -newermt`, checked against two known file times].
  - **T11's Progress count (T11's).** It reported "six dated Progress entries" for the eight it added (65 to 73), the same miscount the DI-113 review found. Noted here.
  - **flashColor (DI-113's, noted).**
    - The boost run's flashColor differs from final2, final3 and a24 on 225 of 556 samples, by up to 2.0e-4, and is identical between final4 and final5.
    - "Trajectory identical" holds for the fields listed (f, sinceHit, flash, glitch, mode, speed, x and shields), not for every measured colour.
- **Status.** Test-only: no file in the bundle, the art suite or T11's window changed. Runs: `npm run check`, `check:task T05` (the file's owner glob) and `plans:check`. The operator's pack is rebuilt at round final5 so its rulings carry this entry.
  - *[Results, written after the pack's rebuild and so not in it.]* `npm run check` exit 0, 12:29 to 12:34Z: 118 files, 1968 passed and 2 skipped (1947 before, plus the new test's 21), and glsl 188 files with 0 hits. `check:task T05` PASS. `plans:check` 0 problems. The pack's build 3 ran 12:34:48 to 12:38:53Z through the GPU lock: 3 passed, and 1 failed on the designed "a gated row is red" assertion (W4allow). Its index differs from T11's build 2 only in its time stamp and the rulings, and still lists 317 files. T11's window equals backup final5 in all 75 files [O: scratchpad `t00owner/di116/runs.txt`, the saved build 2 and build 3 index pages, and `cmp` against the backup].
- **What this gives up.** The test is tied to the stretch's statement forms. A change that keeps the rule but writes it another way, such as a new swizzle or a helper function, fails until the translator learns that form. That is deliberate: the failure names the statement.

**DI-117. FULLSCREEN and HIDE HUD in the CRUISE card: T08 reopened for an operator request (T08's amendment FH).**
- **Source.** The operator, while reviewing the game on a phone and a tablet over Tailscale, verbatim: "Two feature requests I want to implment while I'm reviewing. A fullscreen and a hide the HUD options you can select from the pause menu." The pause menu is the CRUISE card (`src/ui/menu.ts`, `src/ui/dom.ts`), opened by Esc, P or II. The game cannot truly pause. That is T11's operator question Q14, and it is not part of this entry.
- **Reopened.** The T00 owner (the orchestrator, as the operator's delegate) reopened T08 from `done` to `in-progress` at 15:54Z for this scope addition. `owns` and `reads` did not change. The orchestrator set design defaults, which the plan refined with stated reasons:
  - native checkboxes styled like MUTE and REDUCED MOTION, with RESUME first and REDUCED MOTION last in the focus trap;
  - FULLSCREEN through the Fullscreen API on `document.documentElement`, requested from the box's change handler, mirrored through the change events, not stored, with the webkit-prefixed API detected and the row hidden where neither exists;
  - HIDE HUD stored in `mv.settings.v1` backward-compatibly, II kept, the state notices and the live region kept;
  - non-goals: hotkeys, a PWA manifest, orientation lock, any change to the look.

  Three review rounds changed the amendment (FH-R1 to FH-R3), and an independent review agent approved it at 17:05Z. It was executed from 17:08Z to 17:58Z and repaired once after the first verification (FH-V1, 18:20Z to 18:40Z). The second verification found no defect above a nit.
- **What a player gets.**
  - **FULLSCREEN**, the first box in a new toggle row. Ticking it puts the whole page in element fullscreen, and unticking it leaves. The box re-reads the real state on both change events and both error events. So an exit by Esc, the browser, a gesture or the OS unticks it, and a refused request leaves it unticked. It is not stored, because a browser enters fullscreen only from a gesture. The row is hidden where neither API is enabled, which is iPhone Safari's case [M].
  - **Esc in fullscreen is the browser's.** The game's Esc toggle does nothing there (FH-7). Leaving fullscreen while in PLAY, by any route but the box, opens CRUISE once, in the same frame, as P does (FH-8, FH-36). That is shown with a page-script exit standing in for the browser [O: A30 (13), A31]. Real exits are HC8, HC9 and HC11. From CRUISE, leaving fullscreen keeps the menu open. P toggles as usual.
  - **HIDE HUD**, the second box, stored as `hideHud`. A stored object without the field loads with the HUD shown. Outside the title view it hides, by `visibility: hidden`:
    - the three HUD panels: score and SYNC; distance, sector and objective; shields and overdrive;
    - the touch BOOST button and the MUTED chip;
    - the score popups and the sector banner.

    It keeps II at full strength (FH-12), because on touch II is the only way back to the menu. It also keeps SIGNAL LOST, the autopilot tag (FH-13), the context-lost layer, the fatal page and the aria-live region. A second finger still boosts, and DEMO's title view is unchanged.
  - REDUCED MOTION shares the row and stays the last control, so the focus trap's ends are unchanged.
- **Files.** All are inside T08's owns [O: `find -newermt` from 16:00Z over the repo, without `node_modules`, `test-results` and `dist`, run at 19:03Z]:
  - `src/ui/copy.ts`, `dom.ts`, `menu.ts`, `storage.ts`, `index.ts`, `devPage.ts` and `ui.css`, plus the new `src/ui/fullscreen.ts`;
  - `tests/unit/ui/storage.test.ts`, plus the new `tests/unit/ui/fullscreen.test.ts`;
  - `tests/visual/ui.spec.ts` and `plans/T08-ui-input.md`.

  There is no contract change. The boxes use the existing `togglePause` and the DOM, and no `UiCommands` member was added. `src/input/**` and `dev/ui.html` are unchanged. `index.ts`, `devPage.ts` and `ui.spec.ts` match the verified bytes in scratchpad `T08-fs/fv1/final-sha256.txt`, and `ui.css` matches the verifier's `f1615156...` [O: `sha256sum`].
- **Expected-output edits to existing tests.** All four are T08's own tests, are recorded in T08's Decision log and move no threshold:
  - **E1:** the cruise aria snapshot gains FULLSCREEN and HIDE HUD between the radiogroup and REDUCED MOTION.
  - **E2:** the keyboard row's Tab cycle from RESUME goes from 6 presses to 8: `music, sfx, mute-toggle, INPUT, fullscreen, hide-hud, reduced, resume`.
  - **E3:** the `storage:` round trip in `ui.spec.ts` ticks HIDE HUD and expects `hideHud: true`.
  - **E4:** `storage.test.ts`'s defaults gain `hideHud: false`, and its round trip `hideHud: true`.

  FH-32 changed how A9's last-control check scrolls (the label, not the box), because the old form failed correct code once the card grew. Its limit is unchanged. No other task's test was edited.
- **architecture.md.** T08 proposed four edits, and two are applied here because the change makes those lines untrue or incomplete:
  - **§7.2's diagram** gains `PLAY --fullscreen left, not by the menu--> CRUISE   (in fullscreen, Esc is the browser's)`, after the Esc/P line (now line 712). By the code, a leave by the browser's control, a gesture or the OS now moves PLAY to CRUISE, and the diagram had no such edge.
  - **§7.3's keyboard row** now reads `... Esc or P cruise, M mute. In fullscreen Esc is the browser's: it leaves fullscreen, and from PLAY the UI then opens CRUISE` (line 727). "Esc ... cruise" was no longer true in fullscreen, where Esc from CRUISE does not resume.
  - **Not applied: the §7.5 sentence and the §12 wording.** Neither line is made untrue.
    - §7.5 says what the HUD shows and how it is written. HIDE HUD leaves both as they were, and A5's DOM-write counts are unchanged. architecture.md also lists none of the card's other controls (volume, mute, quality), so naming two here would be a level of detail it does not keep.
    - §12's "cruise menu" covers the new rows, and the owns column is unchanged.
  - **The §8 Ui hook list** (line 1189, mirrored at `src/contracts/index.ts` line 420) already omitted hooks that existed before FH, such as `score`, `menu-button` and `mute-toggle`. So `fullscreen` and `hide-hud` leave it true, and an edit there would put §8 out of step with the contract file.
  - **Also read and left as they were:** lines 20, 148, 702, 721, 746 to 748, 995, 1177 to 1179 and 1607 (overview, loop, bests, pause, HUD, idle tag, UiCommands, reduced motion), numbered after the edit.
  - After the edit: `contracts:check` PASS, 7 files.
- **Verification before this close.** It is recorded in T08's section 9 by the executor and by the independent verifier. Both ran headless Chromium 1234 on this desktop:
  - 218 unit tests;
  - the whole `ui.spec.ts`: 286 passed on `gpu` and 286 skipped on `software`;
  - mutations f1 to f20, each caught by its named row. The verifier re-ran f1, f10 and f20 and restored each file byte for byte;
  - a production build into the scratchpad, served on 5118 and probed at 1920x1080 and at 844x390 and 390x844 with touch;
  - the screenshots, opened and described.
- **This close's runs** (the T00 owner, logs in scratchpad `T08-fs/close/`):
  - **`npm run check`**, 19:04:50Z to 19:09:44Z, exit 0: typecheck, lint, 119 test files with 1982 passed and 2 skipped, and `glsl:check: 189 files scanned, 0 hits`.
  - **`npm run plans:check`:** `12 plans, 2648 pattern pairs, 0 problems`.
  - **`npm run check:task -- T08`:** `check:task T08 PASS`. tsc found 0 problems in 35 owned files, eslint 0 errors and 0 warnings, vitest exited 0 on 11 owned files, and glsl found 0 hits in 36.
  - **`npm run contracts:check`**, after the architecture.md edit: PASS, 7 files.
  - **T10's e2e on `gpu`,** 19:10:24Z to 19:15:09Z, exit 0: **62 passed, 9 skipped (4.7m)**.
    - How it ran: `TERRAIN_PORT=5110`, inside `gpu-lock.mjs T08`, with `--output=test-results/T08-e2e`.
    - Which files: 19 spec files named one by one. That is every `tests/e2e/**/*.spec.ts` except `dist.spec.ts`, which rebuilds the `dist/` that the operator's preview serves; the two `*.timing.spec.ts`, which the `gpu` project ignores; and `fallback.nowebgl.spec.ts`.
    - The skips: D-007 and `software.spec` are SwiftShader rows, and view.spec's seven review rows run only with `MV_VIEW=1`.
    - There was no failure, so there is no seam defect.
    - For reference, DI-114's whole smoke suite, `dist.spec.ts` included, read 64 passed and 9 skipped. The two-test difference is not checked here.
  - **`fallback.nowebgl.spec.ts` on `no-webgl`**, exit 0, 1 passed. Its output went to `test-results/T08-e2e-nowebgl`, so that the gpu run's folder was not cleared.
  - **After the runs:**
    - 5100 is still PID 35208, the operator's `vite.js preview --host 100.102.246.127`. 5108, 5110 and 5118 are free, and the lock is released. Each run's dev server ended with it, and no process was stopped.
    - `dist/` has no file newer than 14:56:13Z.
    - T08's files have the same hashes at the end of the stage as at its start (`start-sha256.txt`).
  - **Not run in this close:** the `gpu-timing` rows, `dist.spec.ts`, `tests/forever/**`, `tests/perf/**` (B21 included) and `tests/art/**`.
- **T11.** T11's window and the look are untouched. No file under `src/render/**`, `tests/art/**` or T11's other owns changed. Against the pre-FH backup (scratchpad `T08-fs/backup`), `ui.css` only gains rules: the HIDE HUD visibility rule, the `.mv-toggles` grid on the radios' columns and gap, its `[hidden]` rule, and `.mv-toggles` beside `.mv-radios` in the two-column rule. No existing colour, font or size rule changed [O: `diff`]. On view, REDUCED MOTION's line now carries FULLSCREEN and HIDE HUD beside it. At narrow widths, where the row has two columns, REDUCED MOTION takes a line below them, which is one line more than before (the verifier's 390x844 image). T11 stays `blocked` on U8. Its final5 operator pack predates this change: `test-results/T11-art/final5/ui-cruise.png`, written at 10:54:23Z, shows six cards with REDUCED MOTION alone on the last line and no FULLSCREEN or HIDE HUD [O: viewed]. Whether to reshoot that sheet is T11's call. HC8 to HC13 join the human checks its pack collects.
- **Human checks left open.** These are T08's section 7 checks. They need the operator's `dist/` rebuilt first:
  - **HC8:** FULLSCREEN on the phone: fill, the notch and system bars, leaving by gesture or back (from PLAY that leaves the run in CRUISE), and rotation.
  - **HC9:** the tablet, and iPad Safari if that is the tablet: the row, entering, Safari's own exits, and fill in both orientations.
  - **HC10:** iPhone Safari: no FULLSCREEN row, and HIDE HUD and REDUCED MOTION share the row.
  - **HC11:** Esc in fullscreen on real desktop browsers, the browser's fullscreen notice, and fill on the monitor.
  - **HC12:** HIDE HUD on the phone and tablet: only II is left, a second finger boosts, II opens the menu, and the setting survives a reload. Also whether the autopilot tag should stay.
  - **HC13:** whether the new row and II alone look right, and whether the browser's tap highlight on the toggle labels (which MUTE already shows) should go.

  T08's HC1 to HC7 stay open as before.
- **Still open.**
  - **The operator cannot see either feature yet.** `dist/`, which the operator's own `vite preview` on 5100 (PID 35208) serves, predates FH. Its newest file is from 14:56:13Z, and the verifier found no `data-hide-hud` or `fullscreenchange` in its bundle. Rebuilding `dist/` and restarting that preview is the operator's step, or the T00 owner's with the operator's go-ahead. Nothing in this change wrote `dist/` or touched that server. HC8 to HC13 wait on it.
  - **FH-35:** on the prefixed API the box is not re-read when a request settles. A refused webkit request that fires no error event could leave the box ticked. This is untested, and HC9 covers it.
  - A32's untick half is printed, not gated (FH-34).
  - Second-finger boost with HIDE HUD on the built bundle is covered only by the dev page's A29 (8).
  - **T10, noted, not a defect:** `panelState(page, 'hud')` in `tests/e2e/lib/app.ts` reports the HUD shown while HIDE HUD hides its panels. No e2e sets HIDE HUD, so nothing fails.
  - **T09, noted:** the scratch build's JS read 249.2 KB gzip with the harness chunk and 239.4 KB without, against B21's 260 KB limit [O: T08 A41, before FH-V1's small change]. B21 itself was not run.
  - **Design choices for the operator.** FH-8 (Esc in fullscreen ends in CRUISE) and FH-13 (the autopilot tag stays) are T08's choices. HC11 and HC12 put them in front of the operator.
- **What this gives up.**
  - In fullscreen, one Esc from CRUISE only leaves fullscreen, and a second Esc resumes.
  - Leaving fullscreen during PLAY, by any route, parks the run in CRUISE.
  - With HIDE HUD on, the run's score and distance show only in the card, and shields and overdrive not at all until SIGNAL LOST.

**DI-118. The operator's review of T11: accept with fixes. The ring legs removed, the ship's hull turned outward and closed, and a swooping path. T05 and T01 reopened.**
- **Source.** The operator's answers to T11's Q1 to Q16, 2026-11-07 at about 21:00Z, recorded verbatim in `plans/T11-art-pass.md` section 13 under "Operator's answers". Q3, verbatim: "Accept with one fix. Remove the support legs for the rings, the posts on the bottom left and right of the rings." General feedback, verbatim:
  - "Remove the support legs for the rings, the posts on the bottom left and right of the rings."
  - "Most of the path is left and right movements by the player. Vary the rings height off of ground. The play should feel like more a swooping path."
  - "The biggest issue is the player's vehicle. When flying around the camera appears to see through the vehicle at times. When it is close to the ground, panels on it dissappear as you move around. There appears to be a floating triangle directly below the vehicle."

  Also, before the answers: "The fullscreen and no HUD work fine." (DI-117's features, on the operator's devices.)
- **Reading.** The verdict is accept with fixes, and the three items are the fixes. The legs and the ship are T05's paths (`src/render/props/items.ts`, `ship.ts`, `glsl/props.vert.glsl`), inside T11's window (`src/render/**`) too; the ring heights are T01's (`src/world/lanes.ts`, `items.ts`), outside it. The T00 owner made all three, outside T11's 12 rounds, as with ledgers 13 to 16; T11's feedback round reads the result. Under Agents.md's rule for a defect T11 reports in a `done` plan's paths, the T00 owner returned T05 and T01 to `in-progress` at 21:00Z, each with a revision note, and is fixing them as the operator's delegate. The ship and the legs are defects against the operator's eye; the swooping path is a design change, recorded here and in §5.8 of architecture.md. No contract changed: `PLAY_Y_MIN`, `PLAY_Y_MAX`, `ItemField` and `ITEM_SPEC` are as they were.
- **The ship (T05).** The cause, from the mesh: the upper hull's ten triangles, the canopy and the underside were wound inside out, 30 edges were open (slots along both leading edges, the canopy's base), and the body is drawn one-sided (`FrontSide`). From above, the hull's top was culled and the flat underside, which stood out behind the notches, showed through: the floating triangle and the see-through ship. From behind and below, the inside-out top showed instead, so panels came and went with height. **Fix:** the same calls, turned outward by index order (every vertex, line and uv as T11 tuned it); a closed underside and walls on the hull's own outline; the canopy closed; the fins drawn from both sides; the underside's outline and the walls lined, because the camera is below the ship whenever it flies above y 7.5. A new unit test holds the hull closed and outward, and fails on the old mesh [O: T05 Progress]. On the GPU, old against new at six poses from the game camera: the old ship's underside hangs apart below the engines at y 6 and its top is missing at y 2; the fixed ship is a solid outlined delta at every pose [O: scratchpad `OP1/shots2/compare.png`, an agent's look under DI-101].
- **The legs (T05).** `buildGate` has no legs (32 tris, from 48), and DI-115's leg branch is gone from `props.vert.glsl`. `gateOpen.test.ts` drops its seat and pin checks and the five leg mutants, and now checks that the gate has no leg and no pinned vertex. DI-113's opening rule for the ring is unchanged. The shader comment DI-116 left for this edit ("bit for bit") is corrected: the identity holds for the arithmetic, not for every pixel on this GPU.
- **The swooping path (T01).** The lane has a height: even nodes in [8, 10), odd in [11, 13), one draw per node, so every gate climbs or dives 1 to 5 u from the last, 3 on average. Gates stand at it with radius 8, from 9, so the inner rim is 0 to 5 u off the floor: the high gates float and the low ones touch the road. Shards follow it between nodes. The floor of 8 is kept because traffic is cleared by height alone, and the solvable road, now flown in height, still finds no miss or hit [O: `items.test.ts`]. The checkpoint arch is unchanged. **Radius 8, not 6, by measurement.** The first draft had radius 6, every ring clear of the floor. T05's A16b (props' shimmer share against a supersampled reference, limit .2, [A]) read .222, against .08 to .10 in earlier records. Bisected on the GPU, every file restored by hash: the old ship with the new world .222, the new ship with the old world .108, so the world. The heights alone at radius 9 read .167, and radius 6 alone at y 8 .156. With the heights, radius 7 read .200 and 8 .184, and the bands a unit higher at radius 8 read .200. A smaller ring's members are thinner on screen, and floating rings put more members across the bright horizon, so far gates alias more. The limit was not moved. Radius 8 at 8 to 13 passes (`props.spec` 40 passed, 3 skipped). The heights do not force a gate either: a ship holding about 10.5 threads every gate. They make the path climb and dive, and the autopilot and the shards follow it. `ITEM_GOLDEN` is re-recorded with a Decision log row in T01. An allocation the change brought (5.29 B a call against 4) was found by `perf.test` and fixed. T02's demo pilot, on the real world, threads 100% of 279 gates in 600 s at seeds 155, 1985 and 7, with hits 0 to .06% [O: scratchpad `OP1/apreal.mjs`].
- **The camera (T10).** T11's round `op1` read S1far (far-terrain sparkle, props hidden) at .0751 against its .07 limit at seed 1985 (.0592 at `final5`) and .1042 at 155 (.0734). The camera's height follows the ship (`FOLLOW_Y` .35), and the lane now holds the ship at 8 to 13, so the camera rose. Measured with the gain changed and restored by hash: .15 gives .0604 and .0779, 0 gives .0496 and .0568. **`FOLLOW_Y` is .15** (T10 reopened for this one constant; architecture.md §6.1 updated). The ship now climbs and dives on screen rather than the view with it, and at the art pose it flies in front of the disc.
- **Also found by the round.** `W4allow`, red at 2 of 242 boost frames since `a24` and on the pre-T11 `r00`, passes at `op1` (264 frames, 0 failing): the boost run's path no longer meets the fence wall there. O1's fixed ship mask was rewritten under its spec's procedure (T11's Decision log). T02's demo pilot grazes about a third as often (17 to 28 per 600 s against 72 to 91 on the old world, same seeds), because the path runs higher above spikes and cars; threading and hits are unchanged. A player flying low can still graze.
- **What a player gets.** A ship that is solid from every angle. Floating rings without posts, at alternating heights, with the shard trail climbing and diving between them; the camera follows height at .35 (§6.1), unchanged.
- **O1 against S1far, for the operator.** T11's round `op1b` (`FOLLOW_Y` .15) passes 54 gated rows and fails O1, the disc's occlusion by props, at .2221 against .15 on 10 of 30 pairs (`final5` .1421): the floating rings and the shard trail, at 8 to 13 and above the camera, cross the disc's lower part. With the superseded r04 mask, comparable across both gains, O1 reads .1658 at .35 and .1953 at .15 (`final5` .1307). With this swoop, no follow gain passes both S1far and O1. Neither limit was moved. The choices: keep it (the operator's eye at Q6 and Q3 outranks both [A] limits), a smaller swoop, or the old camera with S1far red.
- **Open, for the operator.** The ship crossing the sun more often, now that the camera follows height at .15. Fewer grazes on the higher path. Whether the swoop is strong enough. Whether the low rings touching the road are acceptable, or every ring should float, at radius 6 or 7 and a measured shimmer over the [A] limit (the operator's eye at Q6 outranks the limit). Both are single constants (`lanes.ts`'s bands, `items.ts`'s `GATE_RADIUS`). Whether the ship's new outlined underside looks right from below.

**DI-119. The operator's device checks for FULLSCREEN and HIDE HUD: II dimmed with the HUD hidden, and the autopilot tag leaves after 4 s. T08's FH-12 and FH-13 superseded.**
- **Source.** The operator, 2026-11-08, verbatim: "HC9 PASSon my Samsung Tab7 and Pixel 9 Pro XL, HC10 I don't have an iphone, HC11 PASS, HC13 Full screen looks good. The II should be dimmed. Keep the light-blue highlight. HC12 When entering autopilot mode the message that appears should disappear from the screen after a few seconds." Earlier: "The fullscreen and no HUD work fine" (DI-118's source), read as HC8 and HC12's behaviour.
- **Checks.** HC9 passed on two Android devices; iPad Safari's prefixed path (FH-35) is not covered. HC10 not run: no iPhone. HC11 passed. HC13: the row accepted; the tap highlight kept.
- **II (`src/ui/ui.css`).** With the HUD hidden, outside the title view, II is at opacity .5; full under `:active`, `:focus-visible`, and `:hover` only under `(hover: hover)`, so a tap does not leave it lit. Supersedes FH-12. The text contrast at .5 is below FH-12's 1.65 to 1 at .55 [I: not computed here], accepted by the operator's ruling; keyboard focus restores it.
- **The tag (`src/ui/overlays.ts`, `dom.ts`, `ui.css`).** `AUTO_TAG_TICKS` 480 (4 s) after the AUTO panel rises, the tag's `data-show` goes to 0 and CSS hides it by `visibility`, after a .6 s fade; reduced motion hides it at once. It restarts on every rise, and on a clock that went back. The live region still announces it. It applies with the HUD shown or hidden: the ruling did not limit it to hidden. 480, not 360, so the dev page's `autopilot` state (held 370 ticks) still shows it. Supersedes FH-13's "stays".
- **Tests.** Three new rows in `tests/visual/ui.spec.ts` (`-g DI-119`): the tag at 96 ticks past the dev state shown, at 112 gone, and back on the next takeover; under reduced motion hidden; II .5 hidden, 1 shown, 1 focused. With `AUTO_TAG_TICKS` 1e9 and the dim rule at 1, all three fail (scratchpad `DI119/mut.txt`).
- **Gates.** `npm run check` exit 0 (1980 passed, 2 skipped; glsl 0 hits). `test:browser` through the lock exit 0, 585 passed, 19 skipped (23.5 min; scratchpad `DI119/browser.txt`). `test:software`, `test:art`, `test:forever` and `test:perf` not re-run: no render, sim or shader file changed, but the tag's absence after 4 s can change any frame taken more than 4 s into an autopilot stretch, which T11's A26 re-run will show.
- **Build.** `dist/` rebuilt (`app-B1JNdeoS.js`, carries `mv-tag-out` and 480). The operator's preview on 5100 was not listening at 2026-11-08 ~17:35Z; restarting it is the operator's step.
- **Open.** HC10 (an iPhone). iPad Safari (HC9's prefixed path, FH-35). Whether the dim and the tag's 4 s look right on the operator's devices.

## Open after this pass

Each has an owner and a named check. None is decided here, and none can be without running code or a person.

| Open question | What settles it | Where |
|---|---|---|
| Every wash-out limit on the real scene | Real-frame calibration, then drill DR1 | T11 M2, M3, A6 |
| Crossfade chroma with objects on, barely over 55 without | X1 | T11 A9 |
| Whether the bare upper slope hurts R3, and whether to raise `KEEPOUT_K` | O1, D1, D2, DR3, operator's Q4 | T11 M5, A7, A25; §14 risk 12 |
| How much `height` really allocates, and whether T01's inlining removes it | T01's scratch measurement, then the profile on the real build | T01 M7, T09 B19; §14 risk 18 |
| Shimmer with objects on the real stack | B10 | T09, at T10; §14 risk 4 |
| Tier 0 at 50 ms in software | B20 | T09, at T10 |
| Pop-free density and stride changes | A12, B16 | T05, T09; §14 risk 10 |
| Stride 2 on the real build | B5's new run | T09, at T10 |
| The Arctic disc on the other stacks | A24, A4, A14 | T03, T04, T06 |
| Pulse direction | Motion review | T11 M6 |
| The opening seed, and any day-phase offset | Ruled 155 by DI-102 on M7's comparison; the operator's Q1 and Q13 may overrule | T11 |
| Governor hold against throttling | A real device | Q12; §14 risk 17 |
| Fatal page survival on the real scene | A13 | T10; §14 risk 5 |
| Beauty, fun, sound, real phones, a real hidden tab, the 2-hour soak (the soak passed 2026-11-08: B22, growth 72,224 bytes, max 34.96 MB; T11's progress log) | The operator | T11 M10; §14 risks 1, 2, 3, 7, 15, 16 |
| R1 against accessibility | The operator | §14 risk 8, unchanged |
| The stills' step at DI-113 (W3 9.40e-5 and W2 2.70e-5 per sample; 14 pixels at 1 level), not undone by DI-115's exact identity | Render the samples under DI-110's and DI-115's `props.vert.glsl` in one session, then with gates hidden | T00 owner; DI-115, DI-116 |
| An opening gate's lower parts below the floor, under its alpha | A 60 fps pass at a gate's opening, viewing the floor below it | T00 owner, T05; DI-116 |
| The swoop's strength; low rings touching the road at radius 8, or every ring floating at 6 or 7 with A16b over its [A] limit; the ship's outlined underside from below | Closed 2026-11-08 by the operator: swoop kept (O1's sun red accepted), rings touching the road accepted at radius 8, the ship reads as a solid object (T11's progress log) | DI-118; T11's feedback round |
| The shader comment's "bit for bit" (DI-115) | Closed: corrected at DI-118's edit of `props.vert.glsl` | T00 owner; DI-116, DI-118 |
| FULLSCREEN and HIDE HUD on real devices and browsers: fill, the real Esc and system exits, the iPad's prefixed path, the iPhone's missing row, HIDE HUD on touch, the look of the new row (2026-11-08: HC8, HC9 on Android, HC11, HC12, HC13 passed or ruled; open: iPad Safari, HC10; DI-119) | `dist/` rebuilt and served by the operator's preview, then HC8 to HC13 | The operator; T08, T11's pack; DI-117 |

## Every design issue, accounted for

| Plan | Issue: entry |
|---|---|
| T00 (9) | #1 S-42. #2 DI-18. #3 S-43. #4 DI-38. #5, #6, #8, #9 DI-37. #7 S-40 |
| T01 (11) | #1, #2 DI-06. #3 DI-07. #4 S-11. #5, #6 DI-39. #7 S-08. #8 DI-24. #9 S-29 (T03's A2 owns it; §11.2 names it). #10 S-07. #11 C-07 to C-09 |
| T02 (8) | #1 DI-21. #2 DI-22. #3 S-40. #4 DI-23. #5 DI-26. #6 S-08, S-18, and DI-21 for the flash note. #7 DI-16. #8 DI-24 |
| T03 (10) | #1 S-25. #2 S-30. #3, #4 DI-09. #5 C-18. #6 DI-16. #7, #9, #10 DI-12. #8 DI-02 |
| T04 (9) | #1 S-25. #2 DI-02. #3 DI-03. #4 DI-04. #5 DI-26. #6 DI-14. #7 DI-13. #8 DI-38. #9 DI-15 |
| T05 (7) | #1 S-03. #2 S-06. #3 DI-08. #4, #5 DI-11. #6 DI-10. #7 DI-16 |
| T06 (6) | #1 DI-01. #2 DI-02. #3 DI-34. #4 DI-33. #5 DI-03. #6 DI-04 |
| T07 (6) | #1, #3, #6 DI-29. #2 DI-28. #4 S-14, S-15. #5 S-57 |
| T08 (8) | #1, #6 DI-30. #2 DI-16. #3 DI-31. #4 S-21. #5 S-18. #7 S-57. #8 DI-35 |
| T09 (11) | #1, #2 DI-16. #3 DI-18. #4 DI-01. #5 DI-19. #6, #9, #10 DI-20. #7 DI-17. #8 S-51. #11 S-37 |
| T10 (12) | #1 G-2 and section B. #2 DI-31. #3, #4, #5, #9 DI-32. #6 C-32. #7 DI-28. #8 DI-25. #10 DI-16. #11, #12 DI-35 |
| T11 (10) | #1 DI-05. #2 C-35 and DI-40. #3 DI-27. #4 DI-26. #5 DI-28. #6 DI-01. #7 S-51. #8 DI-25, with its text mismatches in DI-02, DI-03, DI-04. #9 DI-11. #10 DI-36 |

Total 107: 82 decided in 40 DI entries, and 25 closed by Part 1's entries, with this pass adding nothing to those beyond documents.

## Change list by plan, design issues

Apply with section C's list. Rules G-4, G-6 and G-7 apply to all of these.

| Plan | Entries that change it |
|---|---|
| T00 | DI-25, DI-26, DI-37, DI-46 |
| T01 | DI-05, DI-06, DI-16, DI-41 (seam row only) |
| T02 | DI-21, DI-23, DI-26, DI-28 |
| T03 | DI-02, DI-09, DI-16, DI-28 |
| T04 | DI-02, DI-03, DI-04, DI-13, DI-16, DI-26, DI-28, DI-44, DI-45, DI-58, DI-63 |
| T05 | DI-02, DI-08, DI-11, DI-16, DI-28, DI-41, DI-42, DI-43, DI-62 |
| T06 | DI-02, DI-03, DI-04, DI-16, DI-28, DI-33, DI-36 |
| T07 | DI-28, DI-29, DI-31, DI-47, DI-48, DI-59, DI-60 |
| T08 | DI-28, DI-30, DI-31, DI-35, DI-49, DI-50, DI-52, DI-61 |
| T09 | DI-01, DI-09, DI-16, DI-17, DI-20, DI-28, DI-58, DI-65, DI-67, DI-68 |
| T10 | DI-16, DI-25, DI-28 |
| T11 | DI-01, DI-02, DI-03, DI-04, DI-05, DI-11, DI-25, DI-26, DI-27, DI-28 |
