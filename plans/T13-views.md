---
id: T13-views
title: Camera views - a cockpit view with a dashboard, wheel and arms, and a nose camera
status: done
owner: T13 executor, for the operator
depends_on: [T10, T11]
owns: [tests/views/**, plans/T13-views.md]
reads: [architecture.md, Agents.md, plans/**, src/**, tests/**, dev/**, scripts/**, package.json, playwright.config.ts]
updated: 2026-11-13T04:01Z
---

## 1. Purpose

The game has one camera today, a chase camera behind the ship. After this plan the player can choose between three:

- **Chase**, as now, and still the default.
- **Cockpit.** The player sits in the ship. A dashboard fills the bottom of the frame, with a steering wheel and the pilot's two arms holding it. The wheel turns left and right with the ship, comes back toward the pilot as the ship climbs and pushes away as it dives. The HUD readouts (score, SYNC, shields, overdrive, distance, sector, objective) sit in instruments on the dashboard instead of floating at the screen edges.
- **Nose.** A camera on the ship's nose, looking forward, with nothing of the ship in frame and the normal HUD.

The player switches with the C key or in the cruise menu, and the choice is remembered. The title screen keeps the chase camera.

What must stay true: the chase view draws exactly what it draws today, the sim and its scoring are untouched by which camera is on, and every existing gate stays green without a reference image being regenerated.

## 2. Context and orientation

Working directory `C:\highsierralabs\Midnight_Vector`. Read `Agents.md` first, then `architecture.md` §3.3, §6.1, §7.3, §7.5 and §8.

**The operator's request (2026-11-12, verbatim):** "I want to look at adding a couple new views. Currently we have a chase camera. I would like to see about adding a cockpit view and a nose camera. The cockpit view should have a dashboard for the ship. We can move the HUD elements to the dasboard instruments in cockpit view. The "steering wheel" should be visible with the players arms holding on to it. The wheel should turn left and right, pull back when acending, and push forward when decending following the players inputs. The nose camera is just that, a camera on the nose of the ship facing forward giving the player the feeling that they are flying through the landscape."

**The operator's design choices (2026-11-12, in session).** Four were put and answered, verbatim: "1 Agreed. Scene geometry with DOM readouts on the dash. 2 Use the ship motion. 3 Yes. 4 Yes." They are R-1 to R-4 in section 11.

**The operator's review of the first build (2026-11-13Z, in session, after playing it; verbatim):** "The nose camera works well, no changes. The cockpit view needs a roof. The canopy struts work but without the roof the struts don't connect to anything and it doesn't feel like you are inside the ship. The gloves read like the hands are rendered backwards with the fingers facing the camera instead of the back of the hand. The move between cameras works well. Sparkle in Cyber Canyon, accept. It was not noticeable in my playthrough. Field-of-view cap, accepted. Seeing the cockpit view in portrait made me realize I never play in portrait mode. It isn't as visually appealing as landscape mode or as easy to control. I want to enforce landscape mode on phones. I've seen other games use the little phone icon that flips to its side to show that you should be playing the game in landscape mode. Commit the work so far before continuing." The first build was committed as `78ecb01` before anything below was written. The review settles M4's two decisions (R-13 ratified, R-14), passes HC-V4 and the nose camera's part of HC-V2, reports two defects against HC-V1, and asks for one new thing. Section 5's round 2 is the work that follows, and the review is its approval.

**How the camera works today** [O: read in the source at `4ec588d`]:

- The camera never leaves render-space z = 0. The world is drawn relative to `FrameView.cam`, a travel position that `src/app/view.ts` copies from the sim each frame. The ship is drawn `SHIP_FORWARD` = 14 u ahead of that plane, and collisions happen on the ship's plane.
- Shaders depend on z = 0: `vRel = p - vec3(cameraPosition.xy, 0.)` in the props and ship programs, and the GLSL gate bans `cameraPosition.z`. So a first-person view cannot simply move the camera forward.
- Camera x and y follow the ship loosely: `camX = gainX * x` (.793 at 16:9) and `camY = 7 + .15 * (y - 6)`, in `src/app/view.ts` and `src/app/follow.ts`.
- `src/core/uniforms.ts` `writeCameraPose` turns the frame into position and rotation. Roll is `feel.roll`, which already banks up to .05 rad with the ship (`BANK_ROLL_MAX`, `src/feel/tuning.ts`).
- Every layer reads only `FrameView.cam`, never `sim.travel`; the one reader of `sim.travel` outside the sim is the HUD's run meter [O: grep].
- Two props behaviours are tuned to the ship being 11.8 u ahead of the camera: the gate ring opens once the ship's tail has passed it (`uGateOpen`, a uniform), and a laser fence's gap lines fade between 12.5 and 10 u (`props.frag.glsl`, constants).
- The HUD is DOM over the canvas (`src/ui/hud.ts`, `ui.css`). There is no text drawn in the scene and no font atlas.

**So the design is: move the view origin, not the camera.** In a first-person view `FrameView.cam` sits ahead of the sim's travel by `camAhead` (14 u for the cockpit, 16.2 u for the nose), and camera x and y sit on the ship. The camera stays at z = 0 and no shader's position maths changes.

**A probe run before this plan** [O: scratch script outside the repository, one RTX 4070 SUPER, production build, 1280 x 720 stills in four biomes]: moving the live camera to the nose and to the cockpit eye point gave frames that read well, with the sun or planet in its place and no console errors. It also showed two things this plan must handle: a shard about to be collected filled a third of the frame, and score popups stayed where the chase view puts them. The probe moved the camera itself, so its near fades were 14 to 16 u off; it showed no motion and no cockpit.

**Terms.** *View origin*: `FrameView.cam`. *Ship plane*: the plane the ship and collisions are on, at render-space z = `-(SHIP_FORWARD - camAhead)`. *Cockpit unit* `u`: `min(H, W / 1.6)` of the stage in CSS pixels, the one length the dashboard geometry and the DOM readouts both scale by. *Slot*: the rectangle, in cockpit units from the bottom centre of the stage, where one readout sits.

## 3. Scope

**This plan owns** `tests/views/**` (its acceptance specs) and this file.

**Everything else is in another task's paths**, so each change goes through that task's plan, reopened by the operator's approval of this plan (as DI-118 reopened T05 and T01). Each reopened plan gets a Progress entry, Decision log rows, a revision note and a bumped `updated`, sets `in-progress` at its first change and `done` again when its part of section 7 has run.

| Plan | Paths touched | What changes |
|---|---|---|
| T00 | `src/contracts/index.ts`, new `src/core/cockpit.ts`, `src/testing/scriptedFrame.ts`, `src/testing/fakeHost.ts`, `tests/unit/core/**`, `plans/README.md` | The contract additions of section 12, the cockpit unit and slots, the fakes |
| T05 | `src/render/props/**`, `tests/unit/props/**`, `tests/visual/props.spec.ts`, `dev/props.html` | Ship plane depth from the frame, ship visibility, near fade, the cockpit mesh and program, the wheel pose |
| T08 | `src/ui/**`, `src/input/**`, `tests/unit/ui/**`, `tests/unit/input/**`, `tests/visual/ui.spec.ts`, `dev/ui.html` | C key, menu entry, stored setting, the dashboard layout of the readouts, popups |
| T10 | `src/app/**`, `tests/unit/app/**` | The camera state, the view origin, eye position, roll gain, the command and the harness override |

`architecture.md` has no owner. Its edits (the §12 row, the §8.1 fence lines, §3.3 step 5, §6.1, §7.3, §7.5, the §9 draw list) are the operator's, made by this plan's executor on approval and recorded as DI-121 in `plans/RECONCILIATION.md`.

**Possibly reopened, only if M2 finds a defect there:** T06 (`src/render/fx/speedLines.ts` reads `camX` and `camY`; not yet read in full [I]).

**Non-goals:**

- No change to `src/sim/**`, `src/world/**`, `src/feel/**`, `src/audio/**`, the sky or the terrain. A camera is presentation only.
- No new package, no asset file, no text drawn in the scene.
- No gamepad, and no HUD button for the camera on touch screens: touch players use the cruise menu.
- No change to the art gates' limits. They are defined on the chase view and stay so. First-person views are measured and reported (M4), not gated, unless the operator decides otherwise.
- `README.md` (T12) lists the controls. Adding the C key there is a one-line follow-up at the operator's word, not part of this plan.
- Nothing is committed or pushed by this plan. A push to `main` publishes the game.

## 4. Interfaces

**Consumed**, all from `src/contracts/index.ts`: `FrameView`, `SimState`, `FeelState`, `UiCommands`, `HarnessHost`, `RenderLayer`, `RenderOrder`, `SHIP_FORWARD`, `CAMERA_Y`, `CAMERA_NEAR`, `PLAY_HALF_X`, `SPEED_FLOOR`. From `src/core/`: `advance`, `between`, `writeCameraPose`.

**Provided**, by the additions requested in section 12:

- `CamMode` (`CHASE` 0, `COCKPIT` 1, `NOSE` 2).
- `FrameView.camMode`, `FrameView.camAhead`, `FrameView.cockpitIn`.
- `UiCommands.setCamMode(m)`.
- `HarnessHost.overrideCam?(m)`, so a test can draw one exact first-person frame.
- `RenderOrder.COCKPIT`.
- `src/core/cockpit.ts` (pure, T00): `COCKPIT_REF_ASPECT` = 1.6, `cockpitUnit(w, h)`, `cockpitProject(p, out)` and `COCKPIT_SLOTS`. Props builds the instrument bezels from the slots and the UI places the readouts by them, so the two cannot drift: sibling modules may not import each other, and both may import `core` (§3.2).

**Meaning of the frame fields**, which every layer may rely on:

| Field | CHASE | COCKPIT | NOSE | During a move |
|---|---|---|---|---|
| `camMode` | 0 | 1 | 2 | The camera being moved to |
| `camAhead` (u) | 0 | 14 | 16.2 | Between the two |
| `cockpitIn` | 0 | 1 | 0 | 0 to 1 while the cockpit arrives or leaves |
| `camX` | `gainX * x` | ship x | ship x | Blended by `min(1, camAhead / 14)` |
| `camY` | `7 + .15 (y - 6)` | ship y + .5 | ship y + .05 | Blended the same way |

## 5. Plan of work

Eight milestones, M0 to M7. Each ends with the chase view unchanged and `npm run check` green. The nose camera comes first because it needs every piece of camera machinery and no new geometry (R-4).

**M0. Registration and contracts (T00, and the operator's `architecture.md`).**
Work: add the T13 row to §12 and to `plans/README.md`; write DI-121 in the ledger; add the lines of section 12 to the §8.1 fence and to `src/contracts/index.ts`; give `scriptedFrame` and `createAppView` the three new fields at their chase values; give `fakeHost` `overrideCam`; add `src/core/cockpit.ts` with its unit test.
Result: nothing visible changes.
Proof: `npm run plans:check`, `npm run contracts:check` and `npm run check` exit 0.

**M1. The camera state (T10).**
Work, in a new pure file `src/app/cam.ts` with `tests/unit/app/cam.test.ts`:

- A target mode, set by `setCamMode`, forced to CHASE while `sim.mode` is DEMO, and replaced by `overrideCam` when that is set.
- `camAhead` moves toward the target's value each frame. Forward it moves at 40 u/s. Backward it moves by at most .9 of the distance the sim travelled that frame. **So the view origin never moves backward**, and a camera change never triggers the loop's backward-jump rebuild. Returning to chase takes .19 s at cruise speed and .58 s at the reduced-motion floor of 27 u/s [arithmetic].
- Under `renderState`, under `overrideCam`, and on a warp, `camAhead` snaps to its target. A backward snap rebuilds, which is what `renderState` already promises for any backward move.
- `writeCamStep` and `writeCamAt` in `src/app/view.ts` advance `view.cam` by `camAhead` and blend `camX` and `camY` as in section 4's table.
- Roll: in a first-person view the loop multiplies `feel.roll` by a gain (3 to start, so .15 rad at full bank [A]) in its existing scratch copy of feel, before harness overrides, so `overrideFeel({ roll: 0 })` still gives exactly 0. Feel already writes roll 0 under reduced motion. `src/core/uniforms.ts` does not change.
- `src/app/commands.ts` gains `setCamMode`; `src/app/host.ts` gains `overrideCam`.

Result: `window.__mvE2e.host.overrideCam(2)` flies the nose camera. The ship is still drawn, wrongly, until M2.
Proof: A1, A2. Negative control: with the backward factor at 1.5 instead of .9, A1 fails.

**M2. Props follow the ship plane (T05).**
Work:

- The ship plane's depth is `SHIP_FORWARD - v.camAhead`: `uShipPos.z`, and `uGateOpen` = that depth less `SHIP_HALF_LENGTH`. At depth 0 a gate never opens; the ring passes around the camera.
- The fence's gap-line fade becomes relative to `uGateOpen` (`smoothstep(uGateOpen - 1.8, uGateOpen + .7, -vRel.z)`), which is today's 10 to 12.5 at `uGateOpen` 11.8.
- The ship's two draws are visible only while the camera is at least 6 u behind the ship plane [A].
- A near fade for items, on by a uniform that is 0 in chase: an item fades out over its last 4 u before the camera plane [A], so nothing is cut by the near plane across the frame.
- Each new term is written to be exactly the identity at chase values, as DI-115 did for the gate.
- Read `src/render/fx/speedLines.ts` in full and look at speed lines in first person. A defect there stops this thread and reopens T06.

Result: the nose camera is complete in the scene.
Proof: A3, A8 (chase references unchanged), a frame sequence through a shard, a gate and a fence in each view, looked at.

**M3. Switching (T08).**
Work: `KeyC` cycles chase, cockpit, nose (ignored on repeat; added to the keys that do not launch from the title); a CAMERA radio group in the cruise menu; `cam` in `mv.settings.v1`, where an absent or bad value loads chase; `['C', 'CAMERA']` in the key legend; a `data-cam` attribute on `.mv-ui`, written on change only; popups placed above the dashboard line in first-person views.
Result: **the nose camera is playable.** The executor sends the operator stills and a short clip, and carries on with M4 unless told otherwise.
Proof: A4, A5, A6.

**M4. Measure the first-person views (T13).**
The chase camera's vertical follow was cut from .35 to .15 because far-terrain sparkle failed its gate when the camera rose with the ship (DI-118). A first-person camera follows 1:1. Work: in `tests/views/measure.spec.ts`, run T11's far-terrain sparkle metric and T09's shimmer metric in all three views at seeds 1985 and 155, and the edge-paint fog check at 21:9, full bend, FOV 68 with the ship at each lane wall.
Result: a table in section 10.
**Decision rule:** if a first-person view reads over the chase limit, the executor stops and puts the numbers and two options to the operator: soften the vertical follow in first person (the ship then no longer passes through a gate's centre on screen), or accept the view as report-only. If the edge-paint check fails, the same stop applies.

**M5. The cockpit in the scene (T05, with the slots in `src/core/cockpit.ts`).**
Work:

- One mesh, one program, one draw, added in `attach` and hidden until wanted, so boot precompiles it and a camera change compiles nothing. Built in code with `MeshBuilder`, in the ship's line style and tints: a dashboard across the bottom 30% of the cockpit unit, two canopy struts, an instrument bezel per slot, a steering column, a yoke with two grips, two gloved hands and two forearms.
- Its own projection in the vertex program, fixed at a 50 degree vertical field and scaled by the cockpit unit from the drawing-buffer size, so boost does not stretch it, the near plane does not clip it, and it sits bottom-centre at every aspect. It is drawn last (`RenderOrder.COCKPIT`), in the transparent list with depth test off and its triangles in back-to-front order, which is fixed because the eye is fixed.
- Bezels are placed by un-projecting each slot onto the dashboard plane, so a readout sits in its bezel by construction.
- The wheel: a pure `yokePose` next to `shipPose`, from the same per-step motion: turn = bank / `BANK_MAX` (up to 40 degrees [A]), pull = pitch / `PITCH_MAX` (toward the pilot when climbing). It holds during hit-stop exactly as the ship's bank does. Hands move rigidly with the yoke; forearms stretch from fixed elbows below the frame, by a per-vertex weight. Holding a key against the lane wall centres the wheel, because the ship has stopped moving (R-2, accepted).
- The cockpit slides up from below the frame as `cockpitIn` goes 0 to 1.
- The cockpit does not sway or shake; the world does. A moving dashboard would pull the readouts off their bezels.

Result: the cockpit view in the scene, with empty instruments.
Proof: A7, A9, stills at 16:9, 21:9, 4:3, 390 x 844 and 844 x 390, looked at.

**M6. Readouts on the dashboard (T08).**
Work: under `data-cam="cockpit"` each HUD element is placed on its slot, in cockpit units through one custom property written on resize only. The menu button and the touch boost button keep clear of the dashboard. HIDE HUD hides the readouts and leaves the dashboard. Under reduced motion the layout changes with no transition.
Result: the cockpit view complete.
Proof: A10, A11.

**M7. Close.**
Work: tune the move in and out of each view; run all of section 7; write the `architecture.md` text (§3.3 step 5, §6.1, §7.3, §7.5, §9's draw list); paste evidence into this plan and each reopened plan; build `dist/` so the operator can play it over the tailnet; hand over the human checks.
Result: every reopened plan `done`; this plan `done` with its human checks listed open.

**Round 2, from the operator's review of the first build (section 2).**

**M8. A roof over the cockpit (T05).**
Work: the two thin struts become windscreen pillars that lean outward from the cowl's shoulders to a roof; a second pillar a side stands behind them, in frame only on a stage wider than 21:9. The roof is a band across the top of the frame with a lined lower edge that arches a little over the windscreen, a second line over that edge as the cowl has, and a small overhead console at the centre. It hangs from the stage's top edge: a new rig value, 2, shifts a vertex up by the stage's height over one cockpit unit, read from the unit the program already has, so on a stage narrower than 1.6:1 the roof stays at the top and each pillar stretches to it. No uniform, program or draw call is added.
Result: the windscreen is framed on all four sides, at every stage shape.
Proof: A15; stills at 16:9, 21:9, 4:3 and 390 x 844, looked at.

**M9. Gloves seen from the back (T05).**
Work: each glove was four bands across its grip, which reads as fingers wrapped toward the viewer. It becomes the back of a hand laid across the grip, in a frame that runs from the wrist, outside the grip, to the knuckles: a cuff, the back of the hand with a pad on it, four knuckles with the first joint of each finger going away round the grip's inner side, and the thumb along the top. The forearm meets the cuff square on. The grip shows above and below the hand.
Result: the pilot's hands read as the pilot's own.
Proof: A15; enlarged crops of both hands with the wheel turned each way, looked at.

**M10. Phones play in landscape (T08; T10 for its e2e rows).**
Work: a rotate gate. On a touch-first screen under 600 CSS px wide, held upright, the UI covers the stage with a phone drawn in lines that turns onto its side and the words ROTATE YOUR PHONE. One media query decides (`src/ui/rotate.ts`). The gate takes every touch, hides the rest of the UI, parks a run it finds in PLAY, and holds a launch and a resume until the phone is turned. Tablets and narrow desktop windows keep the upright layout. Every test that used an upright phone to mean "a phone" holds it sideways instead, the two upright shapes of T08's geometry table become narrow desktop windows, and the gate gets rows of its own on the dev page and on the real build.
Result: an upright phone shows the prompt and nothing else; turned, the game is where it was.
Proof: A16, A17.

**M11. Close.**
Work: section 7 again on the final code; the `architecture.md` text (§6.1, §7.5, §13); the plans of T00, T05, T08 and T10; the build for the tailnet.
Result: every reopened plan `done`; this plan `done` with its human checks listed.

## 6. Concrete steps

PowerShell 5.1, from `C:\highsierralabs\Midnight_Vector`. T13's port is 5113 and its output folder `test-results/T13`.

```powershell
npm run plans:check
npm run contracts:check
npm run check:task -- T10        # and T00, T05, T08 as each is touched
npx vitest run tests/unit/app/cam.test.ts
$env:TERRAIN_PORT = '5113'; npx playwright test tests/views --project=gpu --output=test-results/T13
$env:TERRAIN_PORT = '5113'; npx playwright test tests/visual/props.spec.ts tests/visual/ui.spec.ts --project=gpu --output=test-results/T13
$env:TERRAIN_PORT = '5113'; npm run test:smoke
$env:TERRAIN_PORT = '5113'; npx playwright test tests/art/metrics.spec.ts tests/art/motion.spec.ts --project=gpu --output=test-results/T13
npm run check
npm run build                    # the tailnet preview on 5173 serves dist/, so the operator can then play it
```

One GPU suite at a time. No `npm install`.

## 7. Validation and acceptance

| Id | Check | Expected | Negative control |
|---|---|---|---|
| A1 | `cam.test.ts`: 10,000 fuzzed frames of speeds from 27 to 150 u/s, frame times from 2 to 250 ms and random camera changes | The view origin never decreases; `camAhead` reaches its target | Backward factor 1.5: fails |
| A2 | `cam.test.ts`: targets | Section 4's table at rest; DEMO gives CHASE whatever is set; `overrideCam` snaps | Eye height swapped between views: fails |
| A3 | `tests/unit/props`: ship plane | `uShipPos.z`, `uGateOpen` and the fence fade equal today's values at `camAhead` 0, to the last bit | A term left non-identity: fails |
| A4 | `tests/unit/ui`, `tests/unit/input` | C cycles the three; C on the title does not launch; a stored object without `cam` loads chase | |
| A5 | `tests/views/switch.spec.ts`, real build, tier 3 | In PLAY, three presses of C give cockpit, nose, chase; `counters.rebuilds` unchanged; 0 `linkProgram` calls after boot; draw calls at most 68 in each view; no console error; the choice survives a reload; the title stays chase | |
| A6 | `switch.spec.ts`: the sim is blind to the camera | Two fixed-step runs of 1,800 steps with the same inputs, one changing camera every 2 s, give identical sim traces | |
| A7 | `tests/unit/props`: the cockpit mesh and `yokePose` | At most 400 triangles; each bezel projects onto its slot within 1e-6 u; right motion turns the wheel right; climbing pulls it back; both bounded; held during hit-stop | A slot moved without the bezel: fails |
| A8 | `props.spec.ts`, `ui.spec.ts`, `test:smoke`, art `metrics` and `motion` | All pass as before, with no reference image regenerated | |
| A9 | `tests/views/look.spec.ts`: stills of each view in three biomes and at five sizes, and a 2 s frame sequence of each camera change | Saved, opened and described in section 9 | |
| A10 | `look.spec.ts`: each readout's `getBoundingClientRect` against its slot, at the five sizes | Inside the slot within 2 px; no readout under the wheel's sweep | Reference aspect 1.5 in the style only: fails |
| A11 | The DOM write counter in the cockpit view | At most 24 writes a second at cruise, 60 on boost (§7.5) | |
| A12 | M4's table | Written; the decision rule applied | |
| A13 | `gpu-timing`, one run per view, same state | Frame p95 in each first-person view within .3 ms of chase; reported, one machine | |
| A14 | `npm run check`, `plans:check`, `contracts:check` | Exit 0 | |
| A15 | `tests/unit/props/cockpit.test.ts`: the roof, the pillars and the gloves | The roof spans the dashboard, is symmetric, and leaves more than half of a unit-high stage clear; every pillar's foot is rig 0 and its head rig 2 and inside the roof; everything on the roof is rig 2; each glove reaches inside its grip's inner edge and outside its outer edge, and the grip shows above and below it; the wheel's reach still holds | A pillar head at .8 is below the roof: seen |
| A16 | The rotate gate: `ui.spec.ts -g "rotate:"` on the dev page, and `tests/views/rotate.spec.ts` on the real build | Upright at 320, 390 and 448 px wide, in every state but the fatal one, the gate fills the screen, is what nine points across it meet, and nothing else of the UI is in sight; the fatal page shows above it. Not gated: a phone sideways, touch at 600 px wide, a tablet upright, a narrow desktop window. Upright, no tap or key launches or resumes; a run in PLAY is parked once; turned back, RESUME resumes and the start button has focus. Under reduced motion nothing moves and the phone is drawn on its side | Six mutations, each restored by bytes: the hide rule, the launch hold, the resume hold, the park, the width line at 700, the gate's pointer events. Each fails its rows |
| A17 | A8 and A14 again on the final code | All pass. The rows that used an upright phone hold it sideways; none is dropped | |

**Human checks**, which do not block `done`:

- **HC-V1.** The cockpit's look: dashboard, instruments, wheel and arms. *Reported by the operator, 2026-11-13Z: the struts joined nothing and the gloves read as seen from the front. Both repaired in M8 and M9. Open again, for the roof and the new gloves.*
- **HC-V2.** Playing each view: is it fun, fair and comfortable, and is the roll right. *The nose camera: passed by the operator, "works well, no changes". The cockpit: open, with its roof.*
- **HC-V3.** Both views on a real phone. *Changed by M10: held sideways, both views play; held upright, the rotate gate shows, the run is parked, and turning back returns the game. Also what a phone with its rotation locked does, which no test here can show. Open.*
- **HC-V4.** The move between cameras. *Passed by the operator: "The move between cameras works well."*

## 8. Idempotence and recovery

- Every command in section 6 is safe to re-run.
- All work stays uncommitted until the operator asks for a commit. The tree is clean at `4ec588d` when this plan starts, so `git status` shows exactly this plan's changes, and `git restore` of the listed paths plus deleting the new files returns to the start.
- `npm run build` rewrites `dist/`, which is not tracked. It changes what the tailnet preview serves, and nothing public.
- The stored setting is additive. A browser that has it and then loads an older build ignores the field.

## 9. Progress

- [x] 2026-11-13T00:35Z Investigation and probe (section 2). Design choices put to the operator and answered (R-1 to R-4).
- [x] 2026-11-13T00:35Z This plan drafted. Not registered in §12 yet; that is M0, after approval.
- [x] 2026-11-13T00:50Z Approved by the operator in session, verbatim: "approved". Status `in-progress`.
- [x] 2026-11-13T03:44Z M4's two operator decisions, given in the review of the first build (section 2): the sparkle is accepted (R-14) and the field-of-view cap ratified (R-13). The first build is commit `78ecb01`, made at the operator's word, not pushed.
- [x] 2026-11-13T01:37Z **M0 done.** T13 registered in section 12 and `plans/README.md`; DI-121 in the ledger; CR-1's lines in the section 8.1 fence and `src/contracts/index.ts` (`contracts:check` PASS, 509 lines present in order, 0 added); the fakes follow; `src/core/cockpit.ts` with its test; `gates.test.ts` pins 14 tasks. `plans:check` 0 problems.
- [x] 2026-11-13T01:37Z **M1 done.** `src/app/cam.ts` and its wiring (T10's amendment VW). A1: 10,000 fuzzed frames never move the view origin backward, and with a share of 1.5 they do. A2: each camera rests where section 4 says; DEMO draws chase; a forced camera, `renderState`, a warp and a backward travel snap. `npm run check` exit 0 after M0 and M1: 121 files, 2011 passed, 2 skipped; glsl 191 files, 0 hits.
- [x] 2026-11-13T01:37Z **M2 done.** Props follow the ship plane (T05's amendment VW). A3 passes to the last bit in float32. Looked at 18 stills of the nose camera at 1280 x 720 in three biomes and a 12-frame sequence through a gate in Cyber Canyon: the ship is gone, the gate ring passes around the camera and grows to the frame's edges, shards and spikes pass below and beside, the sun or planet keeps its place, no console error. `speedLines.ts` read in full: the lines are centred on the camera, not the ship, so T06 needs no change.
- [x] 2026-11-13T01:37Z **M3 done.** Switching (T08's amendment VW): the C key, a camera button in the cruise menu, the stored setting. A4 passes. Pressing C three times in the real build, frame by frame: `camAhead` 2, 4, ... 14 into the cockpit, on to 16.2, then back by 3.6 u a frame to 0, `rebuilds` 1 throughout, no console error.
- [x] 2026-11-13T01:37Z **M5 and M6 done.** The cockpit in the scene and the readouts on its panels (T05's and T08's amendments). A7 passes. Looked at the cockpit at 1920 x 1080 in Sunset Drive, Cyber Canyon and Olympus, and at 2560 x 1080, 1024 x 768, 844 x 390 and 390 x 844: a dark dashboard with a lit top edge and lip, two panels with pink bezels and cyan glass edges, score and SYNC over shields and overdrive on the left, distance, sector and objective on the right, thin struts leaning out of the upper corners, a white-edged wheel with a six-sided boss, two blocky gloves with finger lines and dark forearms running off the bottom; II in the top corner; vents on the sills at 21:9; on the two phone shapes the instrument names are gone and the values fit. A10: every readout inside its slot at all five shapes, the glass dark (27 to 52) and the panel edges lit (95 to 237), and with a unit from a reference aspect of 1.5 in the styles alone 12 readouts leave their slots, the first by 32.6 px. A5: chase 45 draw calls, cockpit 44, nose 43, at tier 3; `rebuilds` 1 and program links 18 throughout three presses of C; the title stays chase; the choice survives a reload. A6: two fixed-step runs of 1,800 steps, one changing camera every 240, give the same sim state at every step.
- [x] 2026-11-13T01:37Z **M4 measured, and it stops here for the operator (the decision rule).** `tests/views/measure.spec.ts`, props hidden, cruise, 48 frames, T11's far band (rows 615 to 650). The chase limit is 7.0% of the band's pixels. Seed 1985 at the fixed pose (ship y 10.13): Cyber Canyon reads 6.0% in chase, 10.0% in the cockpit and 9.6% on the nose; every other biome is under 3.6% in every camera. With the ship at y 14: 7.1%, 11.7% and 11.6%. Seed 155, the shipped one: Cyber Canyon 7.8% in chase (DI-118's known value), 15.1% in the cockpit, 14.6% on the nose; 9.1%, 17.6% and 17.4% at y 14. For scale, T11's deliberately broken grid read 8.9% to 12.3%. So first person roughly doubles far-terrain sparkle in Cyber Canyon and nowhere else. **Edge paint** at 2520 x 1080, FOV 68, bend 8e-5, 12 positions: 0 bad pixels in chase at any ship position, and 0 in first person at ship x 0 and +40; at ship x -40, 207 and 235 bad in the cockpit (y 2 and 14) and 218 and 230 on the nose, of about 185,000 painted. Both go to the operator.
- [x] 2026-11-13T01:47Z **The fog bound, repaired pending the operator's word.** A probe at 21:9 with the ship at x -40: 279 to 313 bad pixels at FOV 68, 0 at 67, 66, 65, 64, 63 and 62, in both first-person cameras at y 2 and y 14. First person now caps feel's field at `2 atan(1.515 / aspect)`, 66 degrees at 21:9 (T10's VW-5). `measure.spec.ts` asks for 68 through feel, so the cap applies as in play. This is a deviation from the decision rule, which says stop: the bound is a design invariant of section 6.4, the fix is one constant, and it is listed for the operator to ratify or reverse. The sparkle question is not touched and waits for the operator.
- [x] 2026-11-13T02:15Z **Section 7 run on the final code.** Final code, one chain, nothing under `src/` edited while it ran: `npm run check` exit 0 (123 files, 2043 passed, 2 skipped; glsl 194 files, 0 hits); `plans:check` 0 problems; `contracts:check` PASS; `tests/views` on `gpu` 13 of 13 after the seed-155 row stopped gating chase (below); `tests/visual/ui.spec.ts` 304 passed; `tests/visual/props.spec.ts` 42 passed, 3 skipped (the software rows); `tests/e2e` on `gpu` 64 passed, 9 skipped, as before T13; `tests/art` metrics and motion 21 passed, chase S1far .0604 against .07, the value before T13; `tests/perf/bundle.spec.ts` 245.1 KB of 260. A8 holds: no reference image exists to regenerate, and every chase row passes as it did. A11: in the cockpit idle writes nothing, cruise 19.2 writes a simulated second (limit 24), boost 37.3 (limit 60). A12 after R-13: 0 bad boundary pixels in every camera at ship x -40, 0 and 40 and y 2 and 14. A13, one run on `gpu-timing`: best p95 1.40 ms in chase, 1.20 in the cockpit and 1.20 on the nose. `npm run build` done; the tailnet preview on 5173 serves it (`index-7PYrvooI.js`).
- [x] 2026-11-13T02:15Z **Looked at, for A9:** a 24-frame sheet of the three camera changes at 50 ms steps (the ship grows as the camera closes, goes at 6 u, the cockpit closes in from the frame's edges with the readouts arriving on it, the nose view follows within a frame, and pulling back the ship returns under a gate that is still passing); a still from each of two clips. Two clips were recorded frame by frame with the scripted pilot, no hits and no console errors, and sent to the operator: the three cameras in Sunset Drive (18.5 s) and first person in Cyber Canyon (15 s). The executor saw stills of them, not the clips playing.
- [x] 2026-11-13T02:15Z **Status `blocked`, on two operator decisions.** (1) Far-terrain sparkle in Cyber Canyon in first person, about twice the chase camera's (M4): accept and keep it report-only, soften first person's vertical follow, or have T03 damp the far grid for a high camera. (2) Ratify or reverse R-13, the field-of-view cap. Everything else in sections 5 and 7 is done. Open human checks: HC-V1 to HC-V4.
- [x] 2026-11-13T04:01Z **M8 and M9 done (T05's amendment VW, round 2).** The roof, the pillars and the gloves. A15: `cockpit.test.ts` 22 rows pass, 6 of them new. Looked at: the cockpit at 1280 x 720 in Sunset Drive, Neon City, Cyber Canyon and Olympus (the pillars lean out from the cowl's shoulders and end in the roof; the roof is a dark band with a lined, slightly arched lower edge and a small console with two slats at its centre; the gates, the sun or sphere and the sector banner are below it); at 1680 x 720 (the roof steps down outside the pillars and the side windows show the scene); at 1024 x 768 and 390 x 844 as a desktop window (the roof stays at the top edge and the pillars stretch to it; at 390 x 844 they are long and nearly upright). Enlarged crops of both hands with the wheel turned each way: a cuff where the forearm arrives, outside the grip; the back of the hand with a square pad; four short fingers going past the grip's inner edge; the thumb along the top; the grip showing above and below. Not judged in motion.
- [x] 2026-11-13T04:01Z **M10 done (T08's amendment LS; T10's e2e rows).** A16: `ui.spec.ts -g "rotate:"` 44 rows pass (33 state rows at three upright sizes, 5 not-gated rows, 6 behaviour rows), and `tests/views/rotate.spec.ts` 4 rows pass on the real build. Six mutations, each restored by bytes with its sha256 checked: the hide rule removed, 10 of 11 state rows fail; the launch hold removed, 1 row fails; the resume hold removed, 1; the park removed, 1; the width line at 700, 2; the gate's pointer events removed, 10 of 11. Looked at: the gate at 390 x 844 on the dev page and on the real build, upright in DEMO and in a parked run, and under reduced motion (a cyan phone outline about 70 px wide with a pink bar at its foot, on its side in two of the captures; ROTATE YOUR PHONE in white with a pink glow; MIDNIGHT VECTOR FLIES IN LANDSCAPE in cyan under it; a dark violet ground; nothing of the game showing), and the title at 844 x 390 after the turn.
- [x] 2026-11-13T04:01Z **Section 7 run again on the final code (A17).** Final code, one chain, nothing under `src/` edited while it ran: `npm run check` exit 0 (124 files, 2053 passed, 2 skipped; glsl 195 files, 0 hits); `plans:check` and `contracts:check` exit 0; `tests/views` on `gpu` 17 passed and on `gpu-timing` 1 passed; `ui.spec.ts` 348 passed; `props.spec.ts` 42 passed, 3 skipped; `tests/e2e` 64 passed, 9 skipped; art `metrics` and `motion` 21 passed; `npm run build` exit 0 and `bundle.spec.ts` 246.1 KB of 260 (245.1 before). Not run: `tests/forever`, `tests/perf` other than the bundle, `test:software`, and `check:task` for each plan, which the whole-repo check stands in for. A5: 45, 44 and 43 draw calls; rebuilds 1 and links 18 throughout. A12 unchanged: seed 1985 chase 6.0%, cockpit 10.0%, nose 9.6%; seed 155 chase 7.8%, cockpit 15.1%, nose 14.6%. A13: p95 1.30 ms chase, 1.20 cockpit, 1.30 nose. The tailnet preview on 5173 serves the new build.
- [x] 2026-11-13T04:01Z **Status `done`.** T00, T05, T08 and T10 closed their amendments. Open human checks: HC-V1, HC-V2 (the cockpit), HC-V3. Round 2 is not committed.

## 10. Surprises and discoveries

- **The camera cannot move forward.** z = 0 is built into the props and ship programs and guarded by a gate, so first person is a moved view origin. Evidence: `props.vert.glsl:203`, `ship.vert.glsl:24`, `scripts/glsl-gate.ts`.
- **Feel already rolls the camera with the bank,** by up to .05 rad, so first-person roll is a gain on an existing value and needs no new field.
- **A camera change back to chase would rebuild every layer** if it were a cut, because the loop rebuilds on any backward move of the view origin (`src/app/loop.ts`, `drawStep`). Hence M1's rule.
- **Render siblings cannot share code** (§3.2), so the cockpit lives in `src/render/props`, where `MeshBuilder` and the line material are, not in a new layer.
- **The cruise card has no height for one more row.** A CAMERA radio group made the card 371 px tall in 338, 353 and 368 px of short landscape phone, and 9 of T08's geometry rows failed. The camera became one button on MUTE's row, and they pass unchanged.
- **An absolutely placed grid item is laid out in its grid area.** The score box and the distance box landed at x -503 and 1904 on a 1920 px stage until their rule named no area. The vitals box looked right only because its area is centred.
- **T08 forbids any UI animation faster than .34 s** (`ui.spec.ts`, reduced motion). The readouts' arrival on the dashboard is .36 s.
- **A pickup at full size 4 u from the lens covers a third of the frame.** In chase a pickup is taken 14 u away. In first person it now shrinks over its last 9 u, and a drone, which can still hit, only over its last 3.
- **Popups needed no move.** They sit at 64% of the stage's height, above the dashboard's top at 70% or lower at every shape tested.
- **Editing source while a Playwright suite runs on the dev server fails tests for no reason of their own.** Vite reloads the page, and two `props.spec.ts` rows died with "Execution context was destroyed". Rerun alone they passed. From then on nothing under `src/` was edited while a suite ran.
- **T11's sparkle limit is a share, not a percentage.** `LIMITS.S1far.value` is .07, meaning 7%. The first run of `measure.spec.ts` compared percent with share and failed all three rows on that alone.
- **One row of `tests/forever` fails for a reason that is not T13's.** `identity.spec.ts`'s control "the same mistake is invisible at world 0" read 5,728 differing bytes (5,557 in the chain). On a clean copy of `4ec588d`, made with `git archive` outside the repository, the same row passed once (0 bytes, mean luma 33.7068) and failed twice with the same 5,728 bytes and mean luma 33.6832 as on this tree. So it depends on where the title's autopilot has left the ship when the page is ready, not on the camera work. The file is T09's and was not edited; the other 41 rows of the suite pass.
- **At the shipped seed the chase camera itself reads 7.8% on T11's sparkle band,** which `src/app/follow.ts` already records (.078 at 155). T11 gates at seed 1985 only, so `measure.spec.ts` gates its chase row there and prints seed 155.
- **Chase at boost already reads 11.0% on the same band** and T11 keeps it report-only (`S1farBoost`), because boost overlaps its broken-grid drill. First person at cruise is in that range.
- **Under the gate, 22 of T08's geometry rows passed while checking nothing.** The first `ui.spec.ts` run with the gate in: 285 passed, 19 failed [O: `g-ui1.log`]. The 19 were rows that tap or read a phone held upright. The 22 rows `geometry: phone-small` and `geometry: phone-portrait` were among the 285: their check lists the `data-mv` boxes in sight, and under the gate there are none. So they were re-pointed at narrow desktop windows (R-21), where the upright layout is still met, and all 22 passed there on the first run with no layout change.
- **The first glove drawn from the back reached past the wheel's limit.** `wheelReach` read .2368 against `COCKPIT_WHEEL_REACH` .23 [O: `cockpit.test.ts`], at the cuff's outer corner. The cuff was shortened and the hand moved .004 inward; the limit is unchanged, because it is what keeps a hand off the instrument panels at full turn and pull.
- **One screenshot of the gate over a fullscreen page showed a faint rectangle low on the left** [O: `app-fullscreen-phone-390x844-gate.png`, first capture]. Two later captures of the same row, and four of the gate on the real build, are clean. Not explained. The row taps FULLSCREEN just before the turn, so a control still in its press transition is one candidate [I]; a transition holds `visibility` until it ends.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| **R-1: the cockpit is scene geometry, and the readouts stay DOM, placed on the dashboard** | The operator's choice. Geometry gets bloom and the CRT pass with the rest of the scene; the game has no text in the scene to build on | 2026-11-12 | Operator |
| **R-2: the wheel follows the ship's motion, not the raw input** | The operator's choice. One path serves keys, mouse, touch and autopilot, with no further contract field. Cost: against a lane wall the wheel centres | 2026-11-12 | Operator |
| **R-3: the world rolls with the bank in both views, and the cockpit stays level on screen** | The operator's choice | 2026-11-12 | Operator |
| **R-4: nose camera first, then cockpit** | The operator's choice. The nose camera proves the machinery the cockpit needs | 2026-11-12 | Operator |
| **R-5: first person moves the view origin; the camera stays at z = 0** | Section 10. No shader's position maths changes, and R1's precision argument is untouched | 2026-11-12 | T13 executor |
| **R-6: the view origin never moves backward** | No rebuild on a camera change, at any speed | 2026-11-12 | T13 executor |
| **R-7: the title always uses chase** | Its layout was composed around the ship | 2026-11-12 | T13 executor |
| **R-8: the cockpit is rigid on screen** | Readouts are DOM and cannot follow a swaying dashboard | 2026-11-12 | T13 executor |
| **R-9: T13 owns only its specs and this file** | Every other path has an owner; the work goes through the owners' plans rather than through a second ownership window like T11's | 2026-11-12 | T13 executor |

R-5 to R-9 are proposed with this draft and stand once the operator approves it.
| **R-10: the cockpit is a flat mesh in the stage's units, not a 3D mesh under its own projection** | The eye is fixed, so perspective matters only for the wheel, which the vertex program handles. Flat geometry puts the panels on the layout's numbers by construction. Section 5's M5 said a 50 degree projection and un-projected bezels; this replaces it | 2026-11-13 | T13 executor |
| **R-11: the camera is one button in the menu, not a radio group** | Section 10: the card has no height for a row more | 2026-11-13 | T13 executor |
| **R-12: in first person a pickup shrinks from 9 u and a drone from 3** | Section 10. M2 said one fade over 4 u for all items | 2026-11-13 | T13 executor |
| **R-13: first person caps the field of view at 66 degrees at 21:9** | Section 9, M4: with the camera at the lane wall the fog bound of section 6.4 failed by a few hundred pixels at 68 degrees and by none at 67. Applied so the tree passes its own gate, and put to the operator to ratify or reverse | 2026-11-13 | T13 executor; awaiting the operator |
| **R-13, ratified** | The operator, verbatim: "Field-of-view cap, accepted." | 2026-11-13 | Operator |
| **R-14: far-terrain sparkle in Cyber Canyon in first person is accepted, and first person stays report-only on that metric** | The operator, verbatim: "Sparkle in Cyber Canyon, accept. It was not noticeable in my playthrough." `tests/views/measure.spec.ts` keeps printing it and gates only chase at seed 1985 | 2026-11-13 | Operator |
| **R-15: the cockpit gets a roof, and the gloves are redrawn from the back** | The operator's review (section 2): the struts joined nothing, and the gloves read as seen from the front | 2026-11-13 | Operator |
| **R-16: the roof hangs from the stage's top edge, by a rig value, with no new uniform** | The cockpit is laid out from the bottom edge in units of `min(H, W / 1.6)`, so on a stage narrower than 1.6:1 a roof at a fixed height would float in the middle of the sky. The stage's height in units is 2 over the unit the program already has. On a stage of 1.6:1 or wider the shift is exactly 0 | 2026-11-13 | T13 executor, for the operator |
| **R-17: the roof takes the top 8.5% to 14.5% of a unit-high stage, with a small overhead console** | Enough to read as a roof and to hide the pillars' heads. In stills of Sunset Drive, Neon City, Cyber Canyon and Olympus the gates, the sun or sphere and the sector banner are all below it [O: looked at, 1280 x 720]. The console is what makes it read as an interior rather than a letterbox bar [I] | 2026-11-13 | T13 executor, for the operator |
| **R-18: a phone is a touch-first screen under 600 CSS px wide, held upright; one media query decides** | 600 is Android's own line between phone and tablet layouts (`sw600dp`) [A: from the executor's memory of the platform, not looked up]. `pointer: coarse` keeps a narrow desktop window out, which the operator did not ask to block, and is what the UI already uses to tell touch from mouse | 2026-11-13 | T13 executor, for the operator |
| **R-19: the gate is a prompt, not a lock** | The operator described the prompt other games show. A lock (`screen.orientation.lock`) is, as far as the executor recalls and without having checked, granted by Chrome only in fullscreen and not by iOS Safari at all, and nothing here can test it. Offered to the operator as a follow-up: locking to landscape when FULLSCREEN is ticked | 2026-11-13 | T13 executor, for the operator |
| **R-20: the gate parks a run and holds a launch and a resume** | A run must not fly on unseen, and must not start or resume behind the prompt. Parking is what leaving fullscreen already does (FH-8), through the same command. A pause is let through | 2026-11-13 | T13 executor, for the operator |
| **R-21: the upright layout stays, and its tests move to narrow desktop windows** | Tablets and narrow desktop windows still use it. Under the gate T08's 22 upright geometry rows passed with nothing left to check (section 10), so they would have gone on passing while testing nothing | 2026-11-13 | T13 executor, for the operator |

## 12. Contract change requests

**CR-1. State: open.** Needed so layers, the UI and tests can know the camera. Additive: new lines only, in `src/contracts/index.ts` and in the §8.1 fence of `architecture.md`, so `contracts:check` passes.

After `RenderOrder`'s existing value line, inside the object:

```ts
  COCKPIT: 300,   // T13: the cockpit, drawn last, over additive draws and speed lines
```

New declarations:

```ts
/** T13. The player's camera. DEMO always draws CHASE. */
export const CamMode = { CHASE: 0, COCKPIT: 1, NOSE: 2 } as const;
export type CamMode = (typeof CamMode)[keyof typeof CamMode];
export const CAM_MODE_COUNT = 3;
```

In `FrameView`, after `camX` and `camY`:

```ts
  // T13. camMode: the camera in force, or being moved to. camAhead: how far cam sits ahead of the interpolated sim travel, in u,
  // 0 in CHASE; the ship plane is at render-space z = -(SHIP_FORWARD - camAhead). cockpitIn: 0 to 1, how much of the cockpit is in.
  camMode: CamMode; camAhead: number; cockpitIn: number;
```

In `UiCommands`:

```ts
  /** T13. The player's camera from now on. Takes effect outside DEMO. */
  setCamMode(m: CamMode): void;
```

In `HarnessHost`:

```ts
  /** T13. Forces the camera at once, with no move, in runFrame and renderState; null returns it to the player's choice. A host with one camera omits it. */
  overrideCam?(m: CamMode | null): void;
```

Implementers that must follow [O: grep]: `src/app/view.ts`, `src/app/commands.ts`, `src/app/host.ts` (T10); `src/testing/scriptedFrame.ts`, `src/testing/fakeHost.ts`, `tests/unit/core/uniforms.test.ts` (T00); `src/ui/devPage.ts` (T08). `tests/forever/fixture/shellHost.ts` (T09) has one camera and omits the optional method, so T09 is not reopened.

## 13. Outcomes and retrospective

**Final, 2026-11-13, status `done`.** Against section 1: the three cameras exist and switch by the C key and a menu button, the choice is remembered, and the title keeps chase. The cockpit has a dashboard, a roof on pillars, a wheel and the pilot's arms, with the hands seen from the back; the wheel follows the ship, and the readouts sit on the dashboard's panels. The chase camera's rows all pass as before, the sim is blind to the camera over 1,800 steps, and a camera change costs no rebuild and no program link (45, 44 and 43 draw calls). Frame time, one run: p95 1.30 ms chase, 1.20 cockpit, 1.30 nose.

**Round 2, from the operator's review of the first build.** The operator accepted the Cyber Canyon sparkle (R-14) and ratified the field-of-view cap (R-13), passed the nose camera and the move between cameras, and reported the struts and the gloves, which M8 and M9 repaired. M10 added what the review asked for beyond the cameras: a phone held upright shows a rotate gate and plays nothing. The first build is commit `78ecb01`; round 2 is not committed at the time of writing.

**Gaps.** First person in Cyber Canyon sparkles about twice as much as chase on the far band, by the operator's acceptance. The gate is a prompt and not a lock: a phone with its rotation locked shows the prompt until the owner unlocks it, and a lock in fullscreen was offered and not built (R-19). The public README does not yet list the C key or say that phones play sideways; that is T12's file and nobody has asked for it.

**Lessons.** A gate that hides the UI makes layout rows pass by leaving them nothing to check: 22 did (section 10). Negative controls on the gate's own rows were what showed the new rows could fail. Nothing under `src/` may change while a browser suite runs on the dev server.

**Not verified:** the cameras in motion by the executor, who viewed stills and frame sheets only, and recorded a clip without watching it. The repaired cockpit's look and how it plays (HC-V1, HC-V2). Any real phone or touch screen (HC-V3): every phone here is desktop Chromium with touch emulation and a resized viewport, so the gate on Android Chrome and iOS Safari, a real rotation, a locked rotation and the address bar's effect on the width are all unseen. Any GPU but one RTX 4070 SUPER; the software rasterizer was not run for T13's specs. `tests/forever`, `tests/perf` other than the bundle size, and `check:task` for each reopened plan, which the whole-repo check stands in for. A13 is one run. One faint rectangle in one screenshot (section 10) is unexplained.

**Open human checks:** HC-V1 (the cockpit with its roof and new gloves), HC-V2 (playing the cockpit), HC-V3 (a real phone: sideways play, the gate upright, a locked rotation). HC-V4 and the nose camera's part of HC-V2 are passed.

## 14. Revision notes

- 2026-11-13T00:35Z Drafted, status `draft`.
- 2026-11-13T00:50Z Approved by the operator; status `in-progress`.
- 2026-11-13T01:37Z M0 to M3, M5 and M6 done; M4 measured. Section 5's M5 (a 3D mesh under its own projection) and M3 (a radio group) are superseded by R-10 and R-11, and M2's single near fade by R-12. Sections 9, 10 and 11 updated.
- 2026-11-13T01:47Z R-13 recorded: first person's field-of-view cap, applied ahead of the operator's word and flagged as such.
- 2026-11-13T02:15Z Section 7 run; status `blocked` on the two decisions of M4. T00, T05, T08 and T10 closed their amendments.
- 2026-11-13T03:45Z Round 2: the operator's review of the first build recorded in section 2; M8 to M11 added to section 5, A15 to A17 to section 7, the human checks updated; R-13 ratified and R-14 to R-21 recorded; status `in-progress`.
- 2026-11-13T04:01Z Round 2 closed: M8 to M11 done, section 13 rewritten as final, status `done`.
