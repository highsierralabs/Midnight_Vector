---
id: T02-sim-feel
title: Sim rules, collision, autopilot, objectives and feel
status: done
owner: T02 executor
depends_on: [T00]
owns: [src/sim/**, src/feel/**, tests/unit/sim/**, tests/unit/feel/**, plans/T02-sim-feel.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/testing/**]
updated: 2026-11-11T16:05Z
---

## 1. Purpose

After T02 the game exists as pure logic in Node, with no browser. Observable outcomes:

1. **R1 cannot be broken from inside the sim.** Under adversarial input, in every mode, at chunk 0 and at chunk 2^40, for 1e6 steps per mode, `speed` never drops below the floor, `travel` rises on every step, and `dt` is never scaled. The same gate fails when a floor is deliberately removed.
2. **The page looks alive with no input.** The autopilot threads at least 95% of gates on the fixture world, dodges hazards, takes shard ribbons, never holds still for more than 1 s, and flies through the same `step()` as a player. A plot of its path has been opened and looked at.
3. **It is a game.** §7.1's rules work: shards, gates, SYNC, graze, boost, hits, shields, `SIGNAL_LOST`, sectors, grades. Every number is one named constant in one file.
4. **The sim does not know about the bend.** A world whose `bendAt` and `height` throw runs for 1e6 steps without noticing.
5. **Feel is cosmetic.** `createFeel` gets no sim reference, cannot write to what it reads, stays inside its caps under event floods, and is all-off under reduced motion.
6. **Consumers can trust the events.** Each event kind has one documented payload, each item fires at most once, and overflow changes no rule.

## 2. Context and orientation

Working directory for every command: `C:\highsierralabs\terrain`. It is not a git repository. `§n` means a section of `architecture.md`. T00 must be `done` before M1: it supplies `src/contracts/index.ts`, `src/core/coords.ts`, `hash.ts`, `motion.ts`, `src/testing/fakeWorld.ts`, and `npm run check:task`. All twelve plans were compared by topic in `plans/RECONCILIATION.md`, and the seams below reflect its decisions. Where a seam row and §8 differ, §8 wins.

T02 has no browser work, so it uses no port and no Playwright project. Test output that T02 writes goes under `test-results/T02/`, which is gitignored.

Terms:

- **Step:** one call of `sim.step`, exactly 1/120 s of sim time.
- **Ship plane:** the forward position `travel + SHIP_FORWARD`. The camera sits at `travel`; the ship is drawn `SHIP_FORWARD` u in front of it. Items are collected, threaded or hit as they cross this plane, not the camera.
- **Row:** one `ItemRow` from `world.fillItems(chunk, row)`.
- **Rules live:** `mode === PLAY && !autopilot`. Only then do score, SYNC, shields, overdrive and objectives change from items.
- **Cosmetic event:** a `SHARD`, `GATE` or `GRAZE` event with `value === 0`, emitted while rules are off, so the title screen still sparkles.
- **Rehearsal:** a throwaway JavaScript simulation run on 2026-11-05 in the session scratchpad on the Ryzen 3900X, on a synthetic world (`gauntletWorld` below). It is not project code and may be gone. Its numbers are tagged `[O: rehearsal]`. They describe that prototype on that synthetic world, or on a second one written from T01's draft item table where stated, not the implementation, and not T01's real code. Everything else numeric is `[A]`, and §14 risk 3 expects a retune after the human playtest.

## 3. Scope

**Owned, complete file list:**

| Path | Contents |
|---|---|
| `src/sim/index.ts` | `export { createSim }` and nothing else (§8.1) |
| `src/sim/tuning.ts` | Every sim constant in section 5, as one exported object plus its `Tuning` type |
| `src/sim/sim.ts` | `createSimInternal(world, tuning)`, state, `step`, `command`, `warpTo`, `setReducedMotion`, `forceSignalLost` |
| `src/sim/rules.ts` | Speed, boost, scoring, shields, mode transitions |
| `src/sim/collision.ts` | Item window, swept crossing, shape tests |
| `src/sim/autopilot.ts` | Digest, candidate planner, weave |
| `src/sim/objectives.ts` | Progress and grades |
| `src/feel/index.ts`, `tuning.ts`, `feel.ts` | `createFeel` and its constants |
| `tests/unit/sim/` | `motion`, `modes`, `collision`, `rules`, `objectives`, `beatlock`, `autopilot`, `fuzz`, `determinism`, `alloc`, `bench`, `structure` `.test.ts`; `fixtures/worlds.ts`, `invariants.ts`, `drive.ts`, `metrics.ts`, `png.ts` |
| `tests/unit/feel/` | `feel`, `caps`, `reduced`, `purity`, `alloc` `.test.ts`; `fixtures/frames.ts`, `png.ts` |
| `plans/T02-sim-feel.md` | This plan |

**Read-only:** `architecture.md`, `Agents.md`, `src/contracts/**`, `src/core/**`, `src/testing/**`.

**Non-goals:**

- No three, no DOM, no `localStorage`. Best score and furthest distance (§7.1) are not in `sim`; see the seam with T08.
- No bend. `sim` never calls `world.bendAt` or `world.height`, and collisions ignore terrain (§5.3, §7.1).
- No HUD, audio, ship mesh or post effect. T02 only produces numbers.
- No real world generation. `src/world` is T01's and T02's tests may not import it.
- A real playtest and a phone benchmark cannot happen here (§14 risks 3 and 13). Both are reported as not verified.

## 4. Interfaces

**Consumed, all from `src/contracts/index.ts`:** `ControlFrame`, `Sim`, `SimState`, `SimMode`, `SimCommand`, `Ev`, `EventBuffer`, `Feel`, `FeelState`, `WorldSource`, `ItemRow`, `ItemKind`, `ZoneState`, `Objective`, `Travel`, `CreateSim`, `CreateFeel`, and constants `SIM_HZ`, `CHUNK_LEN`, `SPEED_FLOOR`, `SPEED_CRUISE`, `SPEED_MAX`, `PLAY_HALF_X`, `PLAY_Y_MIN`, `PLAY_Y_MAX`, `ITEM_STRIDE`, `MAX_ITEMS_PER_CHUNK`, `EVENT_CAPACITY`, `PHASE_PERIOD_TICKS`, `CAMERA_FOV`, `CAMERA_FOV_MAX`, `ItemField`, `TRAFFIC_TRAVEL_MAX`, `TRAFFIC_FADE`, `ITEM_WINDOW_BEHIND`, `SHIELD_MAX`, `SYNC_MAX`, `SHIP_FORWARD`.

**Consumed from core:** `advance`, `between`, `travelMod`, `canWarp` (`src/core/coords.ts`), `trafficOffset`, `droneOffset`, `phaseOf` (`src/core/motion.ts`). From `src/core/alloc.ts`: `createItemRow`, `createEventBuffer`, `createZoneState`, `createNeutralFeel`. In tests only: `hash01`, and `createFakeWorld` from `src/testing/fakeWorld.ts` (import that file directly, not the barrel).

**Provided:** `createSim` from `src/sim/index.ts`, `createFeel` from `src/feel/index.ts`. Also `measureAutopilot(world, seconds)` in `tests/unit/sim/fixtures/metrics.ts`, for T10's real-world check.

**Not provided:** `createSimInternal`, `SimProbe` and `Tuning` are for T02's tests only and are not re-exported from `index.ts`. Production code, T10's app included, constructs a sim through `createSim` alone. That is the V1 verifier's condition on `SimProbe`, and `structure.test.ts` fails if any file under `src/` outside `src/sim/` names `createSimInternal` or `SimProbe`, or imports `sim/sim`.

M0 reads what T00 actually shipped. Every request T02 needs is in §8 (section 12), so no fallback applies.

### Meaning of the control frame

This restates §8.1's `ControlFrame` comment (C-15), and T08 agrees.

| Field | Meaning |
|---|---|
| `absolute: false` | `moveX`, `moveY` are rates in `[-1, 1]`: `+moveX` is right (+x, and screen right, since the camera has no yaw), `+moveY` is up (+y) |
| `absolute: true` | `moveX`, `moveY` are a normalised target. `x = moveX * PLAY_HALF_X`, `y = PLAY_Y_MIN + (moveY + 1) / 2 * (PLAY_Y_MAX - PLAY_Y_MIN)`. Screen y must be flipped by the caller |
| `boost` | True while held |
| `human` | True in any sample where a person produced input: key held, pointer moved or button held, touch down. It resets the idle timer |

Out-of-range values clamp, NaN becomes 0, and neither can throw.

### Meaning of the sim state

Every object identity is stable: `sim.state`, `sim.events` and `state.travel` are the same objects for life, mutated in place.

| Field | Unit and range |
|---|---|
| `tick` | Integer, +1 per step, never reset, untouched by warp |
| `beat` | `tick / 72`, fractional |
| `speed`, `stepDist` | u/s, and `speed / SIM_HZ` exactly |
| `x`, `y`, `prevX`, `prevY` | u, clamped to the play window. `prev*` is the previous step. Straight world, no bend |
| `score` | Integer-valued, kept through `SIGNAL_LOST`, reset only by `launch` |
| `sync` | Integer 1 to 16 |
| `shields` | Integer 0 to 3. Reads 0 during `SIGNAL_LOST`, 3 from the step it ends |
| `overdrive` | `[0, 1]` |
| `ghost` | Seconds of hit immunity remaining, `>= 0` |
| `autopilot` | True whenever the planner steers: DEMO, CRUISE, `SIGNAL_LOST`, and PLAY after 10 s idle |
| `sectorIndex` | `zone.index` of `zoneAt(travel)` |
| `objectiveProgress` | Same unit as `zone.objectiveTarget` (see the T01 seam). 0 at each sector start, changes only while rules are live, and never falls within a sector |
| `warpSerial` | +1 per successful warp only |

### Modes

| Mode | Steers | Speed target | Boost | Rules live | Events |
|---|---|---|---|---|---|
| DEMO | Autopilot | Cruise | Scheduled, free | No | Cosmetic `SHARD`, `GATE`, `GRAZE`; `BOOST_ON/OFF`; `SECTOR` |
| PLAY, human | Input | Cruise or boost | Costs overdrive | Yes | All except cosmetic ones |
| PLAY, idle over 10 s | Autopilot | Cruise | No | **No** | Cosmetic, `SECTOR` |
| CRUISE | Autopilot | Cruise | No | No | `SECTOR` only, plus `BOOST_OFF` on entry |
| `SIGNAL_LOST` | Autopilot | Cruise | No | No | Cosmetic, `SECTOR`, `GRADE` |

Commands: `launch` works from DEMO only: score 0, SYNC 1, shields 3, overdrive `OVERDRIVE_START`, chain 0, progress 0, `gradeEligible = true` (DI-97: the launch sector is graded against the zone's full target), ghost `LAUNCH_GRACE_S`, mode PLAY. `pause` works from PLAY only, and emits `BOOST_OFF` if boosting. `resume` works from CRUISE: back to PLAY, with ghost at least `RESUME_GRACE_S`. Any other combination is a silent no-op, so pausing during the 3 s of `SIGNAL_LOST` does nothing, as T08's `togglePause` expects. `SIGNAL_LOST` is entered only by the hit rule or `forceSignalLost`, and ends by tick count: shields 3, ghost `GHOST_S`. The exit is not input (DI-94): it keeps the last real input's tick, counting a `human` frame sent during `SIGNAL_LOST`, and ends in live PLAY only if that input is less than `IDLE_TIMEOUT_S` old, otherwise in idle autopilot with rules still frozen. A `SIGNAL_LOST` counts as the player's for grading only when it came from live play; a harness loss forced from idle PLAY grades nothing.

### Events

One table, which T05, T07 and T08 read, and T06 only indirectly through `FeelState`. It is §8.1's comment above `Ev` (C-17), made exact. `x`, `y` are always the ship's position in u. Emitted in step order: rows ascending by chunk, then index.

| Kind | `value` | `chunk`, `index` |
|---|---|---|
| `SHARD`, `GATE` | Points added including multipliers. 0 when cosmetic. A checkpoint gate is always 0 | Absolute row chunk as passed to `fillItems`; record ordinal in that row |
| `GRAZE` | Points added, 0 when cosmetic | Same, for the hazard |
| `GATE_MISS` | 0. Rules live only | Same |
| `HIT` | Shields left | Same, for the hazard |
| `SIGNAL_LOST`, `BOOST_ON`, `BOOST_OFF` | 0 | `travel.chunk`, 0 |
| `SECTOR` | New sector index, Float32, so use `state.sectorIndex` for display | `travel.chunk`, 0 |
| `GRADE` | Bonus points | `travel.chunk`; `index` = rank, 0 S, 1 A, 2 B, 3 C |

`GRADE`, when it fires, comes just before `SECTOR` in the same step. Overflow past `EVENT_CAPACITY` drops the event only. No rule ever reads the buffer. The buffer is cleared by `app` at §3.3 step 14, so feel (step 8), layers (step 11), UI and audio (step 13) all see one frame's events.

### FeelState

`createFeel()` takes nothing. `update` reads `s` and `e` and writes only `out`, which is one stable object. Neutral values are `createNeutralFeel()`.

| Field | Range | Meaning, and who reads it | Under reduced motion |
|---|---|---|---|
| `shakeX`, `shakeY` | up to 0.006, 0.012 rad | Transient yaw, pitch (T10, per T00's camera seam) | 0 |
| `roll` | up to ±0.07 rad | Three's `rotation.z`. Moving right gives negative roll, a right bank (T10) | 0 |
| `fovDeg` | `[58, 68]` | T10 applies the §6.4 aspect cap on top | 58 |
| `aberration` | `[0, 1]` | T06: `offset = mix(low, high, aberration)` of §6.6's ranges | 0 |
| `flash` | `[0, 0.6]` | T06, colour only | 0 |
| `speedLines` | `[0, 1]` | T06: fraction of its instanced lines | 0 |
| `bloomGain` | `[1, 1.25]` | T06: multiplies Bloom `intensity` | 1 |
| `glitch` | `[0, 1]` | T06: colour-only burst, 0.2 s after a hit, held at 0.35 during `SIGNAL_LOST` | 0 |
| `duck` | `[0, 1]` | No consumer. Kept because §8 is additive | Unchanged |
| `shipHold` | `[0, 0.07]` s | T05 and T08: `> 0` means hold ship animation and HUD roll | Unchanged |

### Seams

| Other task | Topic | T02's assumption |
|---|---|---|
| T00, T01 | Item records | `ItemField` in §8.1: GATE `a` 1 for a checkpoint, otherwise 0; FENCE `x` beam centre, `radius` half-length, `a` gap centre, `b` gap half-width; DRONE `a` amp, `b` integer k, phase 3; TRAFFIC `a` travel, `b` integer k, phase 7. `radius > 0` for all kinds |
| T01 | Collision radii | `radius` is the item's own, and T02 adds the ship's: hazards `d <= radius + SHIP_HIT_RADIUS` (1.6 u, inside T01's "at most 2 u"), shards `d <= radius + SHIP_PICKUP_RADIUS` (1.5 u). GATE alone uses bare `radius`: ship centre inside the opening |
| T01 | Fence | Barrier at any y, per T01's seam. `y` is for drawing. One difference from T01's text: T02 narrows the gap by the ship's radius, `abs(px - a) > b - SHIP_HIT_RADIUS`. T01's narrowest gap is 7 u and its solvable path runs on `laneX`, so it still holds [I] |
| T01 | Gate placement | `chunk % 3 === 0`, `zLocal === 0`, exactly; the beat lock depends on it. Rehearsal threaded 100% from radius 3 to 9 u, with `x` up to ±38 [O: rehearsal] |
| T01 | Checkpoint | GATE with `a === 1` at `chunk % 100 === 0`. Never a miss. It gives no points or SYNC, does not count for GATES, and the planner ignores it. T02 grades on `zone.index` changing, which T01 allows: the camera reaches that boundary in the step it passes under the arch |
| T01 | Traffic limits | `a <= TRAFFIC_TRAVEL_MAX`, and rows `c-2` to `c+1` see every crossing. `a * b / 256` in 20 to 40 u/s, per T01, so below `SPEED_FLOOR`: the ship always closes on a car, and each crossing of the plane is seen once. **Not every car is solid when it reaches the plane.** At `TRAFFIC_TRAVEL_MAX` and 40 u/s only about 40% of phases cross outside the fade band (51.2 / 128 [arithmetic]; 159 of 400 seeds [O]). The rest wrap inside the band ahead of the ship and reappear behind it without ever being solid at the plane (section 10). T05 and T11: a car that looks catchable is solid only for some phases. Under reduced motion a hit can slow the ship to 31 u/s, so a 40 u/s car can pull ahead and be crossed twice. Accepted: it is rare and the ghost covers most of it |
| T01 | Objective units | T01's table: GATES threaded count; CHAIN consecutive shards; GRAZES count; NO_HIT longest hit-free distance in u; BOOST boosted distance in u. `target <= 0` is treated as complete |
| T01 | Calls | `fillItems` at most once per chunk crossing, plus 8 rows at create or warp, `zoneAt` once per crossing. T02 never passes a negative chunk, leaving those rows empty. `out.chunk` is the argument. Record order is stable, because `index` is an identity |
| T01 | Golden independence | T02's `GOLDEN` uses T02's own `gauntletWorld`, so T01 tuning cannot flip it |
| T00 | `createFakeWorld` | The fake copies T01's rows (S-07), so all records obey the above, with `GATE y 8, radius 9`. If its gates are smaller, that is reported, not worked around by lowering A8c |
| T05 | Ship and collision plane | Ship drawn at render-space `z = -SHIP_FORWARD`, `x, y = lerp(prev*, cur, alpha)`. Items vanish visually when they cross it. The bend there is under 0.02 u [arithmetic: 8e-5 * 14^2], so the drawn crossing matches the sim |
| T05 | Hiding collected shards | `Ev.SHARD` with any `value`: hide record `index` of row `chunk`. T05 keeps this state itself and may lose it at `rebuild`, which only affects shards already behind the ship |
| T05 | Hazard looks | Traffic scale per `TRAFFIC_FADE`'s comment in §8.1, the same band in which collision is off. A fence hits at any y, so it must read as a full-height barrier between its posts, which T05's draft does. Gate opening drawn equals `radius`, and the ship is drawn 3.2 u wide, matching `SHIP_HIT_RADIUS` |
| T05 | Ghost looks | `mode === CRUISE` draws hazards ghosted. `ghost > 0` means ship blink |
| T05 | Checkpoint look | `a === 1` gets the arch look, and T02's `GATE` event with `value 0` is its flash cue. A checkpoint sits 1 or 2 chunks from a normal gate, while T05's single `uGateFlash` assumes gates at least 3 chunks apart, so one flash may cut another short. Cosmetic and accepted (§5.8, DI-21) |
| T06 | Pulse source | Reads `v.feel.*`, not events, for CA, flash, bloom, glitch and speed lines, so reduced-motion gating lives in one place. `aberration = 0` under reduced motion still leaves §6.6's low offset, so T06 forces offset 0 when `v.reducedMotion` is set, and handles grain itself. T06's draft reads this table directly and agrees. T06 also reads `v.sim.speed` for line length |
| T07 | Clock and cues | `state.beat` is continuous and unaffected by warp. Cues per the events table. `value === 0` on `SHARD`, `GATE`, `GRAZE` is cosmetic and may be played or ignored; no audio exists in DEMO anyway. Gates land on a beat only at normal cruise, within 1 tick, and about 6 s after a boost or hit |
| T08 | Input | As §8.1's `ControlFrame` comment. T08 sends touch as `absolute: true` from a virtual target; the sim's bounded rate turns a stale target into a glide, never a snap. `human` per T08's rule |
| T08 | HUD reads | Score, SYNC, shields, overdrive, ghost from state. Objective kind and target from `v.zone`, progress from state. T02 grades every sector, the launch sector included, against that same `zone.objectiveTarget` (DI-97). For any target above 0 the HUD shows `OK` exactly when the sector would grade S (`src/ui/format.ts:87`, read-only: `target > 0 && progress >= target`); a target at or below 0 grades S with no `OK`. `sectorIndex` equals `zoneAt(travel).index`, so it can lead `v.zone` by one frame at a boundary, since `v.zone` is at the interpolated camera. Floaters only for `value > 0`. Idle tag is `mode === PLAY && autopilot`. `score` resets only at `launch`, and is 0 before it |
| T08 | Bests | T08 owns `localStorage`. T08 latches `travel` when `mode` first becomes PLAY. Agreed in T08's draft |
| T09 | Warp and timing | `warp` calls `sim.warpTo`, which rebuilds the 8-row window itself. `warpTo` emits no event and does not touch `tick`, mode or score. T02 reports the Node step cost |
| T09, T10 | Reaching `SIGNAL_LOST` | `sim.forceSignalLost()`, on `createSim`'s result (C-14), and `HarnessApi.forceSignalLost()` for the e2e (C-27): PLAY only, no-op elsewhere |
| T10 | Loop | `sim.step(control)` per §3.3 with the same object each call. `feel.update(dt, state, events, reducedMotion)` once per frame before layers. `events.count = 0` at step 14. `sim.setReducedMotion` and the `reducedMotion` argument always agree. Set before the sim's first step, reduced motion applies from that step with no ease; after it, speed eases (DI-75, D-001). Commands as T08's seam: `togglePause` maps PLAY to `pause`, CRUISE to `resume`, otherwise nothing |
| T10 | Interpolation | `view.cam` per §3.3 step 5 may read chunk -1 for one frame only after `warpTo(0, 0)`. The sim's own start is chunk 3, so normal play never does |
| T10 | Integrated checks | T02's lint rule stops `tests/unit/sim` importing `src/world` or `src/feel`, so T10's `tests/unit/app` runs `measureAutopilot(createWorld(...), 600)` and asserts at least 80% gates threaded, and a sim plus feel trace that matches with and without `feel.update` |
| T10, T00 | Camera sign | `rotation.set(CAMERA_PITCH + shakeY, shakeX, roll)` as T00's seam. Shake magnitudes stay small because `shakeX` is the small transient beside §6.1's "no steady yaw" |
| T04 | FOV and shake | Reach the sky only through the camera. T04 derives `rd` from camera matrices, so the disc scales with `fovDeg` as §7.4 says |
| T11 | Retunes | `src/sim/tuning.ts` and `src/feel/tuning.ts` are in T11's window, values only (§12). A sim retune comes only from an operator finding, and T11 re-records the golden under the pin rule |

## 5. Plan of work

Milestones run in order. Each ends with its own green test file, so a fresh agent can resume from any of them.

### M0. Read what T00 shipped

**Goal:** no assumption about contracts survives unchecked. **Work:** open `src/contracts/index.ts` and `src/core/`, confirm every name in section 4 exists, and record that in Progress. Open `src/testing/fakeWorld.ts` and note its gate and fence values. **Result:** Progress names the real state. **Proof:** A1.

### M1. Skeleton: tuning, state, the R1 core

**Goal:** a sim that flies forward correctly before any rule exists. **Work:**

`src/sim/tuning.ts`. Every name below is one property of a single `TUNING` object. Values are `[A]` unless tagged. The speed floor is here as `speedFloor: SPEED_FLOOR`, so a negative control can remove it.

| Group | Constants |
|---|---|
| Start | `SIM_START_CHUNK` 3, `SIM_START_LOCAL` `48 - SHIP_FORWARD` (plane lands on a beat at tick 0), `SHIP_START_X` 0, `SHIP_Y_REST` 6 |
| Ship motion | `SHIP_RATE_X` 60 u/s, `SHIP_RATE_Y` 24 u/s, `SHIP_VEL_TAU` 0.09 s, `SHIP_ABS_GAIN` 6 per s, `SHIP_HIT_RADIUS` 1.6 u, `SHIP_PICKUP_RADIUS` 1.5 u |
| Speed | `REDUCED_MOTION_SCALE` 0.6, `SPEED_ACCEL` 70 u/s², `SPEED_DECEL` 45 u/s², `HIT_SPEED_FACTOR` 0.65, `HIT_RECOVER_S` 1.5 |
| Beat lock | `BEAT_TICKS` `PHASE_PERIOD_TICKS[0]` (72), `BEAT_U` `SPEED_CRUISE * BEAT_TICKS / SIM_HZ` (48), `BAR_U` `4 * BEAT_U` (192), `BEAT_LOCK_GAIN` 1 per s, `BEAT_LOCK_MAX` 4.8 u/s (6% of cruise), `BEAT_LOCK_BASE_EPS` 0.5 u/s |
| Scoring | `SHARD_POINTS` 100, `SHARD_OVERDRIVE` 0.08, `GATE_POINTS` 500, `GATE_SYNC_GAIN` 1, `GATE_MISS_SYNC_LOSS` 1, `SYNC_MIN` 1, `SYNC_MAX` from the contract, `GRAZE_POINTS` 50, `GRAZE_OVERDRIVE` 0.05, `GRAZE_RADIUS_FACTOR` 1.5, `BOOST_SCORE_MULT` 2 |
| Boost | `BOOST_DRAIN_PER_S` 0.2, `BOOST_MIN_START` 0.05, `OVERDRIVE_START` 0.25 |
| Hits | `SHIELD_MAX` from the contract, `HIT_SYNC_DIVISOR` 2, `GHOST_S` 1.2, `SIGNAL_LOST_S` 3, `LAUNCH_GRACE_S` 1.5, `RESUME_GRACE_S` 1, `FENCE_GRAZE_MARGIN` 2 u |
| Idle | `IDLE_TIMEOUT_S` 10 |
| Window | `ITEM_ROWS_BACK` `ITEM_WINDOW_BEHIND`, `ITEM_ROWS_AHEAD` 5, `SWEEP_ROWS_AHEAD` 1 |
| Objectives | `CHAIN_BREAK_U` 36, `GRADE_RATIO_S` 1, `GRADE_RATIO_A` 0.75, `GRADE_RATIO_B` 0.5, `GRADE_BONUS` `[5000, 2500, 1000, 250]` |
| Autopilot, all [O: rehearsal] | `AP_ENABLED` true, `AP_REPLAN_TICKS` 6, `AP_GRID_NX` 17, `AP_GRID_NY` 5, `AP_HORIZON_S` 2.6, `AP_COMMIT_S` 1.1, `AP_APERTURE` 0.45, `AP_LAG_S` 0.08, `AP_W_GATE` 40, `AP_W_HAZARD` 60, `AP_W_SHARD` 3, `AP_W_SWITCH` 0.05, `AP_W_SWITCH_Y` 0.5, `AP_SHARD_SIGMA2` 18, `AP_SHARD_URGENCY_S` 1, `AP_FEAS` 0.75, `AP_GATE_INNER` 0.5, `AP_GATE_SHORT_X_U` 10, `AP_GATE_SHORT_Y_U` 5, `AP_FENCE_BASE` 0.3, `AP_FENCE_OFF_U` 10, `AP_FENCE_CLEAR_U` 1, `AP_HAZARD_MARGIN` 1.25, `AP_HAZARD_BASE` 0.2, `AP_URGENCY_S` 0.5, `AP_TARGET_TAU` 0.12, `AP_WEAVE_X` 2.5, `AP_WEAVE_Y` 0.8, `AP_COMMIT_WEAVE_R` 0.2, `AP_MAX_DIGEST` 96 |
| Demo boost | `AP_DEMO_BOOST_PERIOD_TICKS` 3840 (32 s), `AP_DEMO_BOOST_TICKS` 576 (4.8 s) |

Tick-valued durations are computed once from seconds, as `Math.round(s * SIM_HZ)`, and all timers are "until tick" integers. That gives no accumulated drift, and `ghost` is derived: `max(0, ghostUntil - tick) / SIM_HZ`.

`step(c)`, in exactly this order. **Stage A cannot throw, no branch in it can skip `advance`, and it holds the only call of `advance` in `src/sim`.**

```
A. R1 core, plain arithmetic only
 1  before = travel; prevX = x; prevY = y; tick += 1; beat = tick / 72     // before feeds the crossing in M2
 2  boostActive = resolveBoost(...)                    // numbers and booleans, §7.1 rule below
 3  target = (boostActive ? SPEED_MAX : SPEED_CRUISE) * scale;  speedBase moves toward target, limited by ACCEL and DECEL
    since = tick - lastHitTick - 1                     // as built: counted from the first slowed step (Decision log)
    hitFactor = since < HIT_RECOVER ? lerp(HIT_SPEED_FACTOR, 1, since / HIT_RECOVER) : 1
    raw = speedBase * hitFactor + beatLockTrim(...)
    speed = raw >= floor ? raw : floor                 // written so that NaN lands on the floor
 4  stepDist = speed / SIM_HZ; advance(travel, stepDist)
B. Window
 5  if travel.chunk changed: fill row c + ITEM_ROWS_AHEAD, zoneAt once, remember if zone.index changed
C. Steering
 6  control = autopilot ? autopilot.update(...) : sanitise(c)
 7  vTarget from control, v += (vTarget - v) * (1 - exp(-DT / SHIP_VEL_TAU)), x += v * DT, clamp, zero v at a wall
D. Rules
 8  mode timers and idle
 9  overdrive drain, BOOST_ON / BOOST_OFF edges
10  sweep rows c-2 .. c+1
11  if zone changed: GRADE when eligible, then SECTOR, reset sector progress
```

`scale` is `REDUCED_MOTION_SCALE` when on, else 1; `floor = speedFloor * scale`. Check: `45 * 0.6`, `80 * 0.6` and `150 * 0.6` are exactly 27, 48 and 90 in doubles [O]. The tightest ordinary case is `80 * 0.65 = 52 > 45` and `48 * 0.65 = 31.2 > 27` [arithmetic], so the floor line is a backstop, and a hit never reaches it.

**`resolveBoost`:** DEMO: `tick % PERIOD >= PERIOD - BOOST_TICKS`. Human PLAY: start when `c.boost && overdrive >= BOOST_MIN_START`; stop when `!c.boost || overdrive <= 0`. Everything else: false.

**Beat lock.** §5.8 states this (DI-21): "gates arrive on the beat" holds only until the first speed change, because `beat` comes from `tick` and cannot shift. So when `scale === 1`, not boosting, `hitFactor === 1` and `|speedBase - cruise| < BEAT_LOCK_BASE_EPS`:

```
p = travelMod(travel, BAR_U) + SHIP_FORWARD
e = (p % BEAT_U) - ((tick - 1) % BEAT_TICKS) * (SPEED_CRUISE / SIM_HZ);  e -= BEAT_U * Math.round(e / BEAT_U)    // [-24, 24]
trim = clamp(-e * BEAT_LOCK_GAIN, -BEAT_LOCK_MAX, BEAT_LOCK_MAX)
```

As built, `tick - 1`, not `tick`: stage A runs before `advance`, so `travel` still belongs to the previous tick. The plain `tick` form reads `e = -0.667` at the start state, against the next paragraph (Decision log).

The start position has `e = 0` [arithmetic: chunk 3, `34 + 14 = 48`], so the first gate crosses after 216 ticks, exactly 3 beats. After any disturbance the worst `e` of 24 u closes in about 6 s [arithmetic]. Off under reduced motion, where a bar is not 192 u.

`warpTo` per §8.1 using `canWarp`: sets travel, refills 8 rows, sets `sectorIndex` from `zoneAt` with no event, resets progress, `gradeEligible = false`, `warpSerial += 1`. Bad arguments change nothing, bit for bit. `stepDist` is initialised to `SPEED_CRUISE / SIM_HZ`, so it is `> 0` before the first step.

`setReducedMotion(on)` sets `scale`. **Before the first step** (`tick === 0`, which only `step` changes and nothing resets) it also sets `speedBase`, `speed` and `stepDist` to `SPEED_CRUISE * scale` and that over `SIM_HZ`, so reduced motion set at load applies from step 1, at 48 u/s with no ease, and the start state already reads it (DI-75, T10's D-001). Turned off again before the first step, it restores exactly the unset start. **After the first step** it changes only `scale`, so speed eases at `SPEED_DECEL` or `SPEED_ACCEL` as before and a mid-run toggle does not jolt.

**Past `CHUNK_LIMIT`:** nothing happens in `step`. Reaching it takes 3.8 million years (§4.2), only a warp gets near it, and 1024 chunks of headroom exist. R1 forbids stopping, so no clamp is added.

**Result:** flies, steers, warps. **Proof:** A2, A3.

### M2. Item window, swept collision, rules

**Goal:** every item fires at most once, at the ship plane, with no tunnelling. **Work:**

Window: 8 `ItemRow`s in a ring indexed by `((chunk % 8) + 8) % 8`, holding rows `c-2` to `c+5`. A crossing refills only `c+5`, which overwrites old `c-3`. A negative chunk gets `count = 0` and no world call. The sweep only needs `c-2` to `c+1`: with traffic offset under `TRAFFIC_TRAVEL_MAX`, a row `<= c-3` ends below `c * 64`, and a row `>= c+2` starts above the plane [arithmetic]. The planner reads all 8.

Crossing, for each record, with `rowRel = between(rowOrigin, travel) - SHIP_FORWARD`, `rowPrev = between(rowOrigin, before) - SHIP_FORWARD`, `before` the travel kept at stage A step 1, and a scratch `rowOrigin`:

```
rel = rowRel + zLocal; relPrev = rowPrev + zLocal       // as built; NOT rel + stepDist (Decision log, section 10)
TRAFFIC: f = fract(b * phase7(tick) + seed); fp = same at tick - 1
         if f or fp is inside the fade band: skip
         rel += a * f; relPrev += a * fp
crossed = relPrev > 0 && rel <= 0
```

Both distances come from one expression over the two travels, so this step's `rel` is bit-identical to the next step's `relPrev`, and rounding can neither double-count nor lose an item. The first form, `relPrev = rel + stepDist`, fired items twice when they met the plane within rounding of 0 on the side below it. Written this way a NaN never crosses, and a car's wrap, being inside the fade band, cannot fake a crossing. Phases use alpha 0 from the tick: `phaseN(tick)` is `phaseOf(tick, 0, N)`. `DRONE: x += droneOffset(a, b, seed, phase3(tick))`.

Shapes, with ship `(sx, sy)` and `d` the distance in `(x, y)`:

| Kind | Outcome |
|---|---|
| SHARD | Collected if `d <= radius + SHIP_PICKUP_RADIUS` |
| GATE, `a !== 1` | Threaded if `d <= radius`, otherwise missed |
| GATE, `a === 1` | Checkpoint: emits `GATE` with `value 0`, nothing else, in every mode except CRUISE |
| SPIKE, DRONE, TRAFFIC | With `hitR = radius + SHIP_HIT_RADIUS`: hit if `d <= hitR`, graze if `d <= GRAZE_RADIUS_FACTOR * hitR` |
| FENCE | At any y. With `span = abs(sx - x) <= radius` and `edge = (b - SHIP_HIT_RADIUS) - abs(sx - a)`: hit if `span && edge < 0`, graze if `span && edge <= FENCE_GRAZE_MARGIN` |

Unknown `kind` is ignored.

Rules when live, per §7.1, with `m = boostActive ? BOOST_SCORE_MULT : 1`:

- SHARD: `score += 100 * sync * m`, overdrive `+0.08`, clamped. A shard crossing uncollected feeds the CHAIN rule in M3, and nothing else.
- GATE: `score += 500 * sync * m`, SYNC +1 capped. Miss: SYNC -1, floor 1, `GATE_MISS` event.
- Graze: `score += 50 * sync * m`, overdrive `+0.05`. Not while `ghost > 0`.
- Hit, only when `ghost === 0`: shields -1, `sync = max(1, floor(sync / 2))`, last-hit tick, ghost `GHOST_S`, `HIT` event. At 0 shields: mode `SIGNAL_LOST`, SYNC 1, `autopilot = true`, boost off, `SIGNAL_LOST` event.

Rules off: DEMO, idle PLAY and `SIGNAL_LOST` emit the cosmetic `SHARD`, `GATE`, `GRAZE` with `value = 0` and change nothing. CRUISE emits none of them. No `HIT` and no `GATE_MISS` ever fire while rules are off.

**Result:** the game's core rules. **Proof:** A4, A5.

### M3. Objectives and grades

**Goal:** sectors have a goal and a grade. **Work:** `objectives.ts`, per T01's units:

- **GATES:** normal gates threaded.
- **CHAIN:** longest run of collected shards. T01's double-rail pattern puts two shards on one row 10 u apart, so a single missed shard cannot break a chain. It breaks when a shard crosses uncollected and the last collected one is more than `CHAIN_BREAK_U` behind, or at `SIGNAL_LOST`. Progress holds the best run in this sector.
- **GRAZES:** count.
- **NO_HIT:** accumulates `stepDist` while rules are live, restarts its run on a hit, progress holds the best run.
- **BOOST:** accumulates `stepDist` while boosting and live.

At a zone index change, in this order: if `gradeEligible` and mode is human PLAY or a `SIGNAL_LOST` that came from live play (DI-94, as built: `lossLive`), compute `ratio = target <= 0 ? 1 : progress / target` (as built; the first form, `target > 0 ? progress / target : 1`, graded a NaN target S, see the Decision log); grade S, A, B or C by the three thresholds, with a NaN ratio landing on C; add `GRADE_BONUS[g]`, unmultiplied, and emit `GRADE`. Then emit `SECTOR`, reset, take the new objective, and set `gradeEligible` to true only if the mode at that moment is human PLAY or a `SIGNAL_LOST` that came from live play.

`launch` makes its sector eligible (DI-97, which replaces DI-92). The launch sector is graded against the zone's full target, the number the HUD shows, with progress counted from the launch, so a late launch tends to earn a lower grade. A grade only ever adds a bonus, so a low one costs the player nothing. `launch` must set eligibility, not merely stop clearing it, because DEMO's own boundaries leave it false. A sector that started in CRUISE and one after a warp are still not graded: `warpTo` keeps `gradeEligible = false`.

Worlds with no checkpoint gate, such as the fake, grade identically, since grading never reads the record.

**Result:** sectors grade. **Proof:** A6, A7.

### M4. Autopilot

**Goal:** a screensaver worth watching, through the same physics. **Work:** `autopilot.ts`. `update` writes a private `ControlFrame` with `absolute: true` and normalised target; stage C converts it exactly as for a human. It is a function of state, the window and `tick` only.

Every `AP_REPLAN_TICKS`, build a digest of the window into flat typed arrays:

```
for rows c-2 .. c+5, up to AP_MAX_DIGEST records, unknown kinds skipped:
  rel = rowRel + zLocal; closing = speed
  TRAFFIC: closing = max(speed - a * b / 256, 1); f0 = fract(b * phase7(tick) + seed)
           est = (rel + a * f0) / closing; fut = tick + floor(max(est, 0) * SIM_HZ)
           f1 = fract(b * phase7(fut) + seed); skip if inside the fade band; rel += a * f1
  GATE with a === 1: skip, its opening spans the window
  skip unless rel > 0; tt = rel / closing; skip unless tt <= AP_HORIZON_S
  DRONE: x += droneOffset(a, b, seed, phase3(tick + floor(tt * SIM_HZ)))
  skip if x, y or radius is NaN
  store kind, tt, x, y, radius, a, b, reachX = RATE_X * max(0, tt - LAG), reachY = RATE_Y * max(0, tt - LAG)
  track the nearest gate as gi
```

Candidates, into two preallocated `Float64Array`s, each then scored by `score(candidateIndex)`:

- **Committed** (`gi` found and its `tt < AP_COMMIT_S`): 15 points inside the aperture, `a = radius * AP_APERTURE`, `x = gateX + ix * a / 2` for `ix` in -2..2, `y = gateY + iy * a` for `iy` in -1..1, clamped to the window. Hazards can then only choose among points that still thread the gate.
- **Free:** the `AP_GRID_NX` by `AP_GRID_NY` grid across the window, plus the current target's `x` at each y row, plus the gate centre if `gi` exists.

Score of candidate `(cx, cy)`, lowest wins, ties keep the first. Below, `W_*` means `AP_W_*`, `RATE_*` means `SHIP_RATE_*` and `SHIP_R` means `SHIP_HIT_RADIUS`:

```
cost = W_SWITCH * |cx - wantX| + AP_W_SWITCH_Y * W_SWITCH * |cy - wantY|
tcx = |cx - x| / RATE_X; tcy = |cy - y| / RATE_Y
for each digest item:
  px = x + clamp(cx - x, -reachX, reachX); py likewise
  GATE:   needX = max(0, |gx - cx| - r * AP_GATE_INNER); shortX = needX - max(0, tt - tcx) * RATE_X * AP_FEAS   // two-segment feasibility
          y likewise;  shortX > 0: cost += W_GATE * (1 + shortX / AP_GATE_SHORT_X_U);  shortY > 0: cost += W_GATE * (1 + shortY / AP_GATE_SHORT_Y_U)
  SHARD:  cost -= (W_SHARD / (AP_SHARD_URGENCY_S + tt)) * exp(-(dx*dx + dy*dy) / AP_SHARD_SIGMA2)
  FENCE:  if |px - x| <= r + SHIP_R:
            off = |px - a| - (b - SHIP_R - AP_FENCE_CLEAR_U);  off > 0: cost += (W_HAZARD / (AP_URGENCY_S + tt)) * (AP_FENCE_BASE + off / AP_FENCE_OFF_U)
  other:  hitR = r + SHIP_R; m = hitR * AP_HAZARD_MARGIN; dd = distance(px, py, x, y)
          dd < m: cost += (W_HAZARD / (AP_URGENCY_S + tt)) * (1 - dd / m + AP_HAZARD_BASE)
```

The winner becomes `(wantX, wantY)`. Every step, with bar phase `b = phase1(tick)`:

```
scale = committed ? min(1, AP_COMMIT_WEAVE_R * radius / AP_WEAVE_X) : 1
targetX += (wantX + scale * AP_WEAVE_X * sin(TAU * b) - targetX) * (1 - exp(-DT / AP_TARGET_TAU))
targetY += (wantY + scale * AP_WEAVE_Y * sin(TAU * 2 * b) - targetY) * ...
```

The weave is integer harmonics of the bar phase, so the ship sways with the music, and it scales down while threading a gate. When autopilot activates, `wantX, targetX = x`, likewise y, and the next replan is immediate on the next multiple of `AP_REPLAN_TICKS`.

**Hot-path rule, measured.** On V8 a non-inlined function that returns a double, or takes one as an argument, allocates a HeapNumber per call. So the planner passes integer indices and writes results to typed arrays: scoring with `score(i)` and `Float64Array` candidates took the rehearsal from 191 to 41 to 0.38 bytes per step [O: rehearsal]. No closures, no `Math.hypot`, no `.map`.

`AP_ENABLED: false` flies `wantX = 0, wantY = 8` with no weave. It exists only as the negative control for A8.

`tests/unit/sim/fixtures/worlds.ts` provides `gauntletWorld({ seed, density, gateRadius = 7 })`, the rehearsal world, kept exact so its numbers mean something. With `h(A, i) = hash01(seed, chunk, A, i)`, `g = floor(chunk / 3)`, `m = chunk % 3`, `gx(g) = 28 * (2 * hash01(seed, g, 901, 0) - 1)`, `gy(g) = 6 + 4 * hash01(seed, g, 902, 0)`:

| Kind | Rule |
|---|---|
| GATE | If `m === 0`: `gx(g)`, `gy(g)`, `zLocal` 0, radius `gateRadius` |
| SHARD | z on the world 12 u lattice, `first = (12 - (m * 64) % 12) % 12`. Keep `i` if `h(2, i) < 0.45`. `u = (m * 64 + z) / 192`, `w = u*u*(3 - 2*u)`, `x = gx + (gx' - gx) * w + 6 * sin(TAU * 2 * u)`, `y = gy + (gy' - gy) * w`, radius 2.5, `gx' = gx(g + 1)` |
| SPIKE | `floor(density * 4 * h(6, 0) + 0.3)` of: `x = 38 * (2 * h(7, i) - 1)`, `y = 2 + 12 * h(8, i)`, `z = 4 + 56 * h(9, i)`, radius 2.2 |
| FENCE | If `m === 1 && h(11, 0) < density * 0.8`: `x` 0, `y` 8, `z` 32, radius 40, `a = 30 * (2 * h(12, 0) - 1)`, `b = 7 + 4 * h(13, 0)` |
| DRONE | `floor(density * 3 * h(15, 0) + 0.2)` of: `x = 28 * (2 * h(16, i) - 1)`, `y = 3 + 10 * h(17, i)`, `z = 4 + 56 * h(18, i)`, radius 2.5, `a = 5 + 7 * h(19, i)`, `b` 1 |
| TRAFFIC | `floor(density * 4 * h(21, 0) + 0.2)` of: `x` from `[-16, -6, 6, 16]` by `h(22, i)`, `y` 3, `z = 4 + 56 * h(23, i)`, radius 3.5, `a` 128, `b = 30 + floor(20 * h(24, i))`, so 15 to 24.5 u/s |

All `seed` fields are `h(10 + kind, i)`. The rehearsal used shard radius 1.5 with pickup 2.5; the sum, the only thing that matters, is unchanged. Other fixtures: `emptyWorld()`, `scriptedWorld(rows, zones)`, `carpetWorld()` (32 hazards per chunk across the window, so shields always run out), `poisonWorld()` (NaN, Infinity, negative radius, zero radius and kind 99 in records, `objectiveTarget` 0, `zone.index` changing every chunk), `frozenWorld(inner)` (precomputed rows copied with `set`, so the world side allocates nothing), `countingWorld(inner)`, `throwingWorld(inner, chunk)`, and `noBendWorld(inner)` whose `bendAt` and `height` throw. `zoneAt` in fixtures is a small pure function with `ZONE_CHUNKS` boundaries and scripted objectives.

`metrics.ts` exports `measureAutopilot(world, seconds, tuning?)`, returning: `threadPct`, `hitPct`, `grazes`, `shardPct`, `maxStillS` (longest time with both `|vx|` and `|vy|` under 0.5 u/s), `flipsPerS` (sign changes of `vx` beyond ±2 u/s), `minStd10s` (smallest x standard deviation in any 10 s window), `rmsAccel`. It computes outcomes by replaying each crossing against the same shape tests, in a sim in DEMO.

**Looking at it.** `autopilot.test.ts` also writes `test-results/T02/autopilot-trace.png` through `fixtures/png.ts`, a dependency-free `node:zlib` PNG writer (the rehearsal needed about 15 lines). Three stacked panels cover 30 s: forward distance across, lateral x down. Gates are cyan bars of their aperture, fences red with the gap open, spikes red squares, drones dark red strokes over their amplitude, cars orange, shards yellow, ship path white. A second strip below each panel shows y. The executor **opens the file with the Read tool and writes what it saw in Progress**. Look for: every cyan bar crossed by the white line; passes through fence gaps; no sawtooth; no long straight runs; turns that begin early enough to read as intent. The rehearsal path met all of those, though it tends to make its lateral move early and then hold a near-straight line to the gate. If that looks mechanical at T10, widen `AP_WEAVE_X` or shorten `AP_COMMIT_S`.

**Result:** the demo flies well. **Proof:** A8, A9.

### M5. Fuzz, determinism, allocation, cost

**Goal:** the invariants of §7.1 and §11.2 are mechanically enforced and able to fail. **Work:**

`fixtures/invariants.ts`: `checkStep(prev, cur, ctx): string | null`, pure, so it can be tested alone. It fails, with a message naming the field, on any of:

- `tick` not +1. `beat !== tick / 72`.
- `speed` below the floor for the current reduced-motion setting, not finite, or above `SPEED_MAX`.
- `stepDist !== speed / SIM_HZ`, or `stepDist <= 0`. This identity is what "`dt` is never scaled" means observably.
- Without a warp: `between(cur.travel, prev.travel) <= 0`, or further than 1e-9 from `stepDist`.
- `local` outside `[0, 64)`, or `chunk` not an integer.
- `x`, `y` outside the window or not finite. `prevX`, `prevY` not equal to the previous `x`, `y`.
- `sync` not an integer in 1..16. `shields` not an integer in 0..3. `overdrive` outside `[0, 1]`. `ghost < 0`. `score` not an integer, or falling other than at `launch`. `objectiveProgress` not finite, or negative.
- `mode` not in 0..3. `autopilot` false in DEMO, CRUISE or `SIGNAL_LOST`. `warpSerial` falling. `events.count > EVENT_CAPACITY`.

`fixtures/drive.ts`: `runFuzz({ world, base, target, stepsInMode, seed, tuning })`, using a local mulberry32. It groups steps into frames of 0 to 30, then clears events, as §3.3 does. Control frames: 70% plausible, 20% extreme, 10% poison (NaN, ±Infinity, ±1e308), with random `absolute`, `boost`, `human`. It runs until the counter for `target` reaches `stepsInMode`:

| Target | How it stays there |
|---|---|
| DEMO | Never launches. Spurious `pause` and `resume` no-ops |
| PLAY | Launches, `human` always true, spurious `launch`. `carpetWorld` would leave PLAY, so this uses `gauntletWorld` density 1, and counts only PLAY steps |
| CRUISE | Launch then pause. Spurious `pause` |
| `SIGNAL_LOST` | `carpetWorld`, launched, `human` true. Reached only by the real hit rule, about 45% of steps [I] |
| Chaos | Random commands, `setReducedMotion` toggles, valid warps (0, 2^40, `CHUNK_LIMIT - 1`, random), invalid warps that must change nothing, `human` false long enough to go idle, `poisonWorld` |

`fuzz.test.ts`: `FUZZ_STEPS` is 1e6, or `T02_FUZZ_STEPS` for quick local runs. Four targets at base 0 and 2^40, then Chaos at both, then each of the four at 1e5 with reduced motion on, plus 1e4 steps from `CHUNK_LIMIT - 1`, plus `runIdleFuzz` (DI-94): launched, `human` false on every frame, harness `forceSignalLost` at 0.02 per frame, `FUZZ_STEPS` each on the gauntlet at 0 and 2^40 and on `poisonWorld`, which changes sector every chunk. After the first step that ends in idle PLAY, the score must never rise and rules must never be live again. A violation throws with seed, tick and mode. Per-test timeout 300,000 ms, as the third argument of `test` [O: accepted by Vitest 5.1.0]. It prints `FUZZ <target> base=<b> steps=<n> ok`. Estimated total under 2 minutes [I: rehearsal planner mean 2.3 to 5 us per step, plus the checker; unmeasured on the real thing].

Negative controls, all in `fuzz.test.ts` and all required to fail in the expected way:

- `checkStep` given 8 hand-broken transitions returns the matching message: speed 44, equal travel, `stepDist` halved, NaN x, `sync` 17, `tick + 2`, `local` 64, `beat` off by a tick.
- `runFuzz` with `{ speedFloor: 0, HIT_SPEED_FACTOR: 0.01 }` throws "speed floor".
- `runFuzz` with `{ speedFloor: 0, HIT_SPEED_FACTOR: 0 }` throws "travel" or "stepDist". A sim that stops is caught through the real pipeline.

`determinism.test.ts`: a fixed PRNG script on `gauntletWorld`. Two sims interleaved step by step match bit for bit at every step, so no module-level scratch exists. An FNV-1a hash over the state fields every 120 steps for 1e5 steps is pinned as `GOLDEN` (per engine, §5.1), with the first run's value pasted in. Changing one control frame at step 1000 must change the hash. Any retune updates `GOLDEN` with a Decision log entry.

`alloc.test.ts`, by median heap delta over short windows, since a slope over long windows was useless (section 10):

```
warm: 300,000 steps.  repeat 300 times: heapUsed, 2000 steps, heapUsed.  result = median delta / 2000
```

On `frozenWorld(gauntletWorld(...))`, in DEMO and in PLAY, at most 4 bytes per step [A: rehearsal 0.38 to 0.46, an empty loop 0 to 0.08, and a retained `{ i }` per step added 32]. The negative control runs the same measurement with `{ i }` retained per step and requires it over the limit. If `trafficOffset` or `droneOffset` from core turn out to allocate under this test, inline the same expression and keep a test that the inline value equals the core function.

`bench.test.ts`: warm 300,000 steps, then 60,000 groups of 3 steps on `gauntletWorld` density 1, printing `SIM_BENCH p50 p99 p999`. Gate: p99 at or below 0.5 ms, §9.2's budget [O: rehearsal 0.005, 0.05, 0.06 ms]. The real code is slower than the rehearsal: p99 read 0.17 to 0.24 ms on this desktop [O: executor and V1 verifier, all runs contaminated by a parallel batch], so the margin is 2 to 3 times, not tenfold. A device 5 times slower would breach 0.5 ms (0.17 * 5 = 0.85). §14 risk 13 is therefore a live risk, and HC2 stays open. No inference about phones is made here.

`structure.test.ts`, text gates over `src/sim/*.ts`, with a tested helper fed a violating string as its negative control: `advance(` appears exactly once; `bendAt`, `.height(`, `timeScale`, `Math.random`, `Date.now`, `performance.`, `localStorage`, `document`, `window` appear nowhere. `noBendWorld` runs 1e6 DEMO steps. `throwingWorld` proves `travel` already rose in the step where the world threw, and the exception propagates to §3.3's catch rather than being swallowed.

**Result:** the gates exist and can fail. **Proof:** A10 to A15.

### M6. Feel

**Goal:** the game hits, the screen breathes, and nothing here can touch a rule. **Work:** `src/feel/tuning.ts`, then `feel.ts`:

| Group | Constants [A] |
|---|---|
| Trauma | `TRAUMA_HIT` 0.7, `TRAUMA_SIGNAL_LOST` 1, `TRAUMA_DECAY_PER_S` 1.6 |
| Shake | `SHAKE_YAW_MAX` 0.006, `SHAKE_PITCH_MAX` 0.012, `SHAKE_ROLL_MAX` 0.02 rad, harmonics of the 1 s phase: yaw 23 and 37, pitch 29 and 41, roll 19 and 31 |
| Bank | `BANK_ROLL_MAX` 0.05 rad, `BANK_REF_RATE` 60 u/s, `BANK_TAU` 0.25 s |
| FOV | `FOV_BOOST_DEG` 8, `FOV_GATE_PULSE_DEG` 2, `FOV_PULSE_TAU` 0.18 s, `FOV_TAU` 0.35 s |
| Flash | `FLASH_HIT` 0.6, `FLASH_GATE` 0.12, `FLASH_SHARD` 0.03, `FLASH_TAU` 0.12 s, `FLASH_CAP` 0.6 |
| Aberration | `ABERR_BOOST` 0.5, `ABERR_HIT` 1, `ABERR_GATE` 0.3, `ABERR_TAU` 0.2 s, `ABERR_CAP` 1 |
| Bloom | `BLOOM_GATE` 0.15, `BLOOM_BEAT` 0.03, `BLOOM_BEAT_K` 6, `BLOOM_TAU` 0.3 s, `BLOOM_GAIN_CAP` 1.25 |
| Lines | `SPEED_LINES_MIN` 70 u/s, `SPEED_LINES_TAU` 0.25 s |
| Holds | `HITSTOP_S` 0.07, `GLITCH_S` 0.2, `GLITCH_SIGNAL_LOST_HOLD` 0.35, `DUCK_S` 0.4 |

Formulas, with `k(tau) = exp(-dt / tau)`, `dt <= 0` treated as 0, `sat` clamping to `[0, 1]`, `boostBlend = sat((speed - CRUISE) / (MAX - CRUISE))`:

- Events are read once per update, by `Ev` kind only, ignoring `value`, so cosmetic events pulse too and the title screen breathes.
- **Order, as built (Decision log):** each update first decays everything held, then adds this frame's events and applies the caps, then writes the output. So `trauma = min(1, max(0, trauma - decay * dt) + hits)`, not the first form `sat(trauma + hits) - decay * dt`, and likewise for every pulse below. The event's frame then shows its full height at any `dt`, and every cap can be reached. `amp = trauma * trauma`. `n1(a, b) = 0.5 * (sin(TAU * a * p3) + sin(TAU * b * p3))`, with `p3 = (tick % 120) / 120`. `shakeX = YAW * amp * n(23, 37)`, and so on. No `Math.random`, only integer harmonics of a tick phase (§4.5).
- `bank` eases toward `-BANK_ROLL_MAX * clamp(vx / REF, -1, 1)`, with `vx = (s.x - s.prevX) * SIM_HZ`. `roll = bank + ROLL * amp * n(19, 31)`.
- `fovDeg = min(CAMERA_FOV_MAX, fovBase + fovPulse)`. `fovBase` eases toward `CAMERA_FOV + FOV_BOOST_DEG * boostBlend`. `fovPulse` gets `+FOV_GATE_PULSE_DEG` on `GATE`, capped at one pulse's height, and decays.
- **Easing, as built (Decision log):** `bank`, `fovBase` and `speedLines` ease toward the mean of this frame's goal and the last frame's, `v += ((goal + lastGoal) / 2 - v) * (1 - k(tau))`, not toward this frame's goal alone, which led a moving goal by half a frame and broke A16 at 1/30. On the first frame `lastGoal = goal`.
- `flash`, `aberrPulse`, `bloomPulse` decay exponentially, then add on events and cap, in the order above. `aberration = min(CAP, ABERR_BOOST * boostBlend + aberrPulse)`. `bloomGain = min(CAP, 1 + bloomPulse + BLOOM_BEAT * exp(-frac(beat) * K))`.
- `speedLines` eases toward `sat((speed - MIN) / (MAX - MIN))`, about 0.125 at cruise.
- Hit: `shipHold = HITSTOP_S`, `glitch = 1`, `duck = 1`, all linear to 0. `glitch = max(glitch, HOLD)` while `mode === SIGNAL_LOST`.
- **Reduced motion (§10.3):** `shakeX`, `shakeY`, `roll`, `flash`, `speedLines`, `aberration`, `glitch` are 0, `fovDeg` is `CAMERA_FOV`, `bloomGain` is 1, each exactly, with hidden state still advancing so that switching the toggle does not pop. `duck` and `shipHold` keep working: neither is motion. The FOV boost is off as well as its pulses; see the Decision log.

All state is per instance. `createFeel()` holds no module-level mutable. `out` starts equal to `createNeutralFeel()`.

`fixtures/frames.ts` builds a plain `SimState`, an `EventBuffer`, and `pushEv`, because lint stops `tests/unit/feel` from importing `src/sim`. `feel.test.ts` also writes `test-results/T02/feel-trace.png`: stacked time series over a 20 s scripted run with boost, gates, two hits and a `SIGNAL_LOST`, for `fovDeg`, `flash`, `aberration`, `bloomGain`, `speedLines`, `shakeY`, `roll`. **Open it and write what you saw in Progress:** sharp attacks, smooth decays, nothing stuck high, no ringing, caps visibly reached and not exceeded.

**Result:** feel works alone against scripted frames. **Proof:** A16 to A20.

### M7. Close-out

**Goal:** everything green together. **Work:** run the whole list, paste short evidence, write Outcomes, set `done`. **Proof:** A21 to A23.

## 6. Concrete steps

PowerShell 5.1, in `C:\highsierralabs\terrain`. No `&&`.

```powershell
# M0
npm run contracts:check
npm run check:task -- T02                                 # before any code: exit 1, VACUOUS

# M1 to M4, one file at a time while working
npx vitest run tests/unit/sim/motion.test.ts
npx vitest run tests/unit/sim/modes.test.ts
npx vitest run tests/unit/sim/collision.test.ts tests/unit/sim/rules.test.ts
npx vitest run tests/unit/sim/objectives.test.ts tests/unit/sim/beatlock.test.ts
npx vitest run tests/unit/sim/autopilot.test.ts --reporter=verbose
# Then open test-results\T02\autopilot-trace.png with the Read tool.

# M5
$env:T02_FUZZ_STEPS = '20000'; npx vitest run tests/unit/sim/fuzz.test.ts --reporter=verbose; Remove-Item Env:T02_FUZZ_STEPS
npx vitest run tests/unit/sim/fuzz.test.ts --reporter=verbose      # the real run, 1e6 per mode
npx vitest run tests/unit/sim/determinism.test.ts tests/unit/sim/structure.test.ts
npx vitest run tests/unit/sim/alloc.test.ts tests/unit/sim/bench.test.ts --reporter=verbose

# M6
npx vitest run tests/unit/feel --reporter=verbose
# Then open test-results\T02\feel-trace.png with the Read tool.

# M7
npm run check:task -- T02
Get-ChildItem src\sim, src\feel, tests\unit\sim, tests\unit\feel -Recurse -File | Measure-Object | Select-Object Count
# After the whole T01-T09 batch has finished, not before:
npm run check
```

Use `--reporter=verbose` to see `console.log` output. `--reporter=basic` no longer exists in Vitest 5.1.0 [O: `Failed to load url basic`].

## 7. Validation and acceptance

Paste short output into Progress as each passes. Thresholds marked [A] may change only with a Decision log entry and the reviewer's agreement (`Agents.md`).

| # | Command or action | Expected |
|---|---|---|
| A1 | `npm run contracts:check`, then `npm run check:task -- T02` before writing code | First exits 0. Second exits 1 with `VACUOUS`: the gate fails before work starts |
| A2 | `motion.test.ts` | Start state: chunk 3, local `48 - SHIP_FORWARD`, x 0, y 6, `stepDist > 0`, mode DEMO, `autopilot` true. PLAY at cruise: speed 80, `stepDist` 80/120. Reduced: 48, floor 27, boost 90. Boost eases to 150 and back. Hit: 52 at once, back to 80 by 1.5 s, and no stacking below 52 from a second hit. **NaN lands on the floor:** `BEAT_LOCK_GAIN: NaN` gives speed exactly 45 on every step with travel still rising, and under reduced motion `HIT_SPEED_FACTOR: NaN` gives exactly 27 for the 180 recovery steps, then 48 (repair, M2b caught). Rate and absolute steering reach their targets in the sign convention of section 4, and clamp at walls. NaN, ±Infinity and 1e308 in a control frame change nothing but the clamp. `state`, `events` and `travel` identities are stable. **Reduced motion before and after the first step (DI-75, D-001):** set before the first step, in DEMO and launched, `speed` and `stepDist` read exactly 48 and 0.4 in the start state and on each of 240 steps, and travel rises 96 u within 1e-9; on then off before the first step leaves speed and travel identical by `Object.is` to an unset sim over 600 steps; a toggle after the first step, including after exactly one, moves nothing until the next step, then eases 0.375 u/s per step to 48 in 86 steps and back up by 0.583 per step. **Control:** a toggle after one step replays the old at-load trace, 79.625, 68.75, 57.5, 48 at 1, 30, 60, 120, and fails the at-load check |
| A2w | Same file, warp | `warpTo(CHUNK_LIMIT, 0)`, `(2**48, 0)`, `(1.5, 0)`, `(5, 64)`, `(5, -1)`, `(NaN, 0)` return false and leave every state field identical by `Object.is`. `warpTo(CHUNK_LIMIT - 1, 0)` returns true, `warpSerial` +1, no event, and at most 8 `fillItems` calls by `countingWorld`. Steps then keep rising past `CHUNK_LIMIT` |
| A3 | `modes.test.ts` | Each row of the modes table, and each command from each mode, including the no-ops. `launch` resets as listed. 10 s without `human` sets `autopilot` and freezes rules; one `human` frame returns control. Going idle mid-boost emits `BOOST_OFF` with the same tick as the idle edge, 1210 after a last human frame at 10 (repair, M19 caught). A cosmetic gate in idle PLAY leaves score and SYNC unchanged. `SIGNAL_LOST` lasts exactly 360 ticks, keeps score, sets SYNC 1, and refills shields at its end. `pause` during it is a no-op. `forceSignalLost` works in PLAY, no-op elsewhere. **DI-94 (VI repair):** a loss forced from idle PLAY ends in idle PLAY, and the score stays frozen for 2400 more steps; a loss inside the idle window returns to live PLAY, and idle comes at tick 1210, 1200 after the last input at 10, not at 1960; a `human` frame at 1301 during `SIGNAL_LOST` makes the exit at 1360 live, and idle comes at 2501 |
| A4 | `collision.test.ts` | Using `scriptedWorld`. **No tunnelling:** over 10,000 start offsets and 48, 80, 150 u/s, each static item at `zLocal` 0 and 63.99 crosses exactly once. **On the beat grid (repair):** gates every 3 chunks from the start position, with the beat lock on, off, and at 48 u/s reduced, over 400 s, fire exactly 166, 166 and 100 gates [arithmetic] (V2 repair), once each, 3 chunks apart, and each was within 1e-9 u of the plane one step before it crossed (checked, not assumed). Gates reached from every step-boundary offset at 80 and 48 u/s each fire exactly once, and both sides of 0 are reached; this is the row that catches the plan's first crossing form (M1: "fired 2"). **Plane:** an item fires when `between` puts it at `SHIP_FORWARD` from the camera, not at 0. **Traffic:** a car from row `c-2` at `TRAFFIC_TRAVEL_MAX` and 40 u/s crosses at most once at normal speeds, 150 to 170 of 400 evenly spaced seeds cross while solid (arithmetic 40%), and at least one crossing comes from row `c-2`. This replaces the first text, "crosses once" (Decision log, V1 verifier agreed); wrapping past the plane inside the fade band does not cross; a car in the fade band cannot hit. **Drone:** the same ship position hits or misses according to phase, matching `droneOffset`. **Fence:** gap, span, edge graze, any y. **Checkpoint:** `a === 1` is never a miss, gives no points or SYNC, and is not counted by GATES. **Row identity:** for each item event, the record at `(chunk, index)` is of the matching kind. **Negative control:** a checker that counts firings per `(chunk, index)` fails on a hand-made double count |
| A5 | `rules.test.ts` | Each row of §7.1 with exact numbers, SYNC 1 and 16, with and without boost. SYNC never above 16 or below 1. Overdrive clamps. Boost stops at 0, and cannot restart under 0.05. Ghost blocks hit and graze for 144 ticks. **Overflow:** a 32-item carpet at 30 steps per frame, with the buffer never cleared, gives `count === 64` and final state identical to a run cleared every step. Every event kind's payload matches the table in section 4 |
| A6 | `objectives.test.ts` | Each of the 5 objectives progresses in its unit and is non-decreasing. CHAIN survives a missed shard on a double rail with its twin collected, and a hit; it breaks past `CHAIN_BREAK_U` and at `SIGNAL_LOST`. NO_HIT restarts on a hit and keeps its best. Thresholds at 1, 0.75, 0.5, with values just below each. Bonus table exact and unaffected by boost. `GRADE` then `SECTOR` in that order. **DI-97:** the launch sector is graded against the zone's full target. Launched at the start of a sector and completing its objective gives that sector's grade (12 of 12, S, +5000); launched late gives a lower grade, still with a bonus (at chunks 6, 9, 12, 14: 9, 6, 3, 1 of 12, so A +2500, B +1000, C +250, C +250). A warp after launch, inside the launch sector, and a CRUISE-started sector: no `GRADE`. `target` 0 grades S. NaN grades C. **DI-94 (VI repair):** a loss forced from idle PLAY across three or more boundaries grades nothing, and the sectors it starts are not eligible; a loss from live play still grades (the existing row) |
| A7 | `beatlock.test.ts` | Launched at tick 0, no boost, on a gates-only `scriptedWorld`: the first 20 gates cross within 1 tick of an integer `beat`. After a 5 s boost, and after a hit, a gate crossing within 1 tick of a beat occurs within 10 s and holds. Speed stays inside `80 ± 4.8` when locked. Off under reduced motion, where speed is 48 exactly. **Negative control:** `BEAT_LOCK_MAX: 0` after a boost misses the 1-tick band for the seeded case |
| A8a | `autopilot.test.ts`, `measureAutopilot(gauntletWorld({ seed, density: 0.6 }), 600)`, seeds 1985 and 7 | [A] `threadPct >= 95`, `hitPct <= 4`, `shardPct >= 30`, `maxStillS <= 1`, `minStd10s >= 2`, `flipsPerS` in `[0.3, 3]`, `rmsAccel <= 180` [O: rehearsal at constant cruise, 600 s: 100, 1.9 to 2.1, 43 to 44, 0.10, 3.3 to 4.0, 1.11 to 1.14, 113 to 118] |
| A8b | Same, `density: 1`; and `gateRadius: 3` at density 0.6 | [A] `threadPct >= 90`, `hitPct <= 5` [O: rehearsal density 1: 100, 2.0 to 2.4; radius 3: 100, 2.4 to 2.5] |
| A8c | Same, on `createFakeWorld()` | `threadPct >= 80`, per §11.2. If not, look at the fake's gate radius first (T00 seam) |
| A8n | `{ AP_ENABLED: false }` | **Must fail A8a on all of:** `threadPct < 50`, `hitPct > 4`, `minStd10s === 0`, `maxStillS > 100` [O: rehearsal 20, 8.84, 0, 599]. Proves the metrics can tell a bad pilot from a good one |
| A8r | Replay | Sim A in DEMO on `gauntletWorld`, demo boost off, records its private control per step. Sim B on `emptyWorld`, launched, is fed those frames as `human: true`. `x`, `y` traces are identical by `Object.is`. There is one physics path |
| A9 | Open `test-results/T02/autopilot-trace.png` | **Write what you saw.** Every gate crossed, gaps threaded, no sawtooth, no long straight run. If it looks mechanical, tune and re-shoot, and log it |
| A10 | `fuzz.test.ts` with no env var | 8 target lines, 2 Chaos lines, 4 reduced lines, 1 limit line, 3 `FUZZ IDLE` lines (DI-94, VI repair) with `live after idle 0` and an unchanged score, each `ok`, at 1e6 where stated. Paste them |
| A11 | Same file, negative controls | All listed controls fail as specified, and the suite passes because they do |
| A12 | `determinism.test.ts` | Two interleaved sims match. `GOLDEN` matches. One changed frame changes the hash |
| A13 | `alloc.test.ts` | DEMO and PLAY at most 4 bytes per step [A]; retained-object control is over the limit. Print all three numbers |
| A14 | `bench.test.ts` | `SIM_BENCH` line printed, p99 at or below 0.5 ms |
| A15 | `structure.test.ts` | Text gates pass, and each fails on its violating string. `noBendWorld`: 1e6 DEMO steps with no throw. `throwingWorld`: `travel` rose in the throwing step, and the exception reached the caller. **Test-only names (repair):** no `.ts` file under `src/` outside `src/sim/` names `createSimInternal` or `SimProbe`, or imports `sim/sim`; the control writes nested fixture files under `test-results/T02/structure-fixture/` and requires exactly the four violators to be reported and the `sim/` one skipped |
| A16 | `feel.test.ts` | Starts equal to `createNeutralFeel()`. Quiet cruise settles to neutral except `speedLines` near 0.125 and `bloomGain` within 0.03 of 1 on the beat. Hit raises shake, flash, glitch, duck, `shipHold 0.07`, and each returns to neutral in its stated time. Moving right gives negative roll. Boost takes FOV to 66, boost plus gate to 68. Same event stream at `dt` 1/30 and 1/240: values within 5% at matching times |
| A17 | `caps.test.ts`, 1e5 frames of random `dt` in `[0, 0.25]`, floods of 64 events, random speed | Every field in its section 4 range and finite, always. **Non-vacuous:** the run's maximum equals the cap for `fovDeg`, `flash`, `bloomGain`, `aberration`, `glitch`, `duck` |
| A18 | `reduced.test.ts` | Under the same flood with reduced motion on, the seven listed fields are exactly neutral on every frame. `duck` and `shipHold` still respond. **Negative control:** the same flood with it off makes each of the seven differ |
| A19 | `purity.test.ts` | `update` on an `Object.freeze`d state copy does not throw. Event arrays and `count` are byte-identical afterwards. Two instances fed different streams do not influence each other. Same input gives the same output by `Object.is`. **Negative control:** a deliberately writing function on the frozen state does throw, proving the test mode is strict |
| A20 | `alloc.test.ts` in `tests/unit/feel`; open `test-results/T02/feel-trace.png` | At most 4 bytes per update with its retained-object control over the limit. **Write what you saw** |
| A21 | `npm run check:task -- T02` | Exit 0, non-zero file counts, a sibling's broken file does not affect it |
| A22 | After the batch, `npm run check` | Exit 0 |
| A23 | List files under owned paths and scan for anything else written | Only section 3's files, plus `test-results/T02/`: the two traces and A15's `structure-fixture/` |

**Not verified by any of this, and reported as such:** whether it is fun (§14 risk 3); autopilot quality on T01's real world (T10 runs that); the look in motion on screen; phone step cost (§14 risk 13); browser engines other than Node's V8, since golden hashes are per engine (§5.1).

**Human checks.** They do not block `done` (`Agents.md`). T11's operator pack collects them.

- HC1: whether it is fun, by playing it (§14 risk 3).
- HC2: sim step cost on a real phone (§14 risk 13).

## 8. Idempotence and recovery

- Every command above can be re-run. Tests write only under `test-results/T02/`, and create the folder if needed.
- Clean state without git: `Remove-Item -Recurse -Force src\sim, src\feel, tests\unit\sim, tests\unit\feel, test-results\T02`. Nothing else depends on these until T10.
- Before a risky rewrite of `autopilot.ts` or `sim.ts`, copy the file outside the project.
- If A8a fails after a change, compare `autopilot-trace.png` with the last good one before touching a weight.
- `GOLDEN` is expected to change with any retune. It is the one test where an edited expected value is legitimate, and only with a Decision log entry naming the constants changed.

## 9. Progress

- [x] 2026-11-05T06:30Z Plan drafted and reconciled with the T01, T05, T06 and T08 drafts. A throwaway rehearsal of the step, planner and metrics ran in the scratchpad. No project file written apart from this plan.
- [x] 2026-11-05T14:45Z M0 T00's contracts read. Every name in section 4 exists in `src/contracts/index.ts`, `src/core/` and `src/testing/fakeWorld.ts`; tsc over T02's files later confirmed it. `createFakeWorld` gates are `y 8, radius 9`, its fence is `x 0, y 8, radius 42, b 12`, as S-07 says. A1: `npm run contracts:check` printed `contracts:check PASS, 7 files`; `npm run check:task -- T02` before any code printed `tsc: VACUOUS`, `eslint: VACUOUS`, `vitest: VACUOUS`, `check:task T02 FAIL`, exit 1.
- [x] 2026-11-05T15:19Z M1 Tuning, state, R1 core, steering, warp. `tests/unit/sim/motion.test.ts`: 28 passed (A2, A2w).
- [x] 2026-11-05T15:19Z M2 Ring, collision, rules. `modes` (A3), `collision` (A4), `rules` (A5) all pass. A4's no-tunnelling run covers 10,000 offsets at 48, 80 and 150 u/s plus a run at chunk 2^40.
- [x] 2026-11-05T15:19Z M3 Objectives and grades. `objectives` (A6) and `beatlock` (A7) pass, including the `BEAT_LOCK_MAX: 0` negative control.
- [x] 2026-11-05T15:19Z M4 Autopilot, trace viewed. Metrics in the block below (A8a to A8n), A8r passes, and A9 is described below.
- [x] 2026-11-05T15:19Z M6 Feel, trace viewed. `tests/unit/feel`: 27 passed (A16 to A20). Described below.
- [x] 2026-11-05T15:34Z M5 Fuzz, determinism, allocation, bench, structure. Evidence below, from the verbose run of every T02 test on the final code (A10 to A15).
- [x] 2026-11-05T15:35Z M7 Close-out. `npm run check:task -- T02` exit 0 (A21). A23 listed. A22 not run, by the batch's rule. Outcomes written.

```
AUTOPILOT A8a seed 1985: thread 100.0% of 281, hit 2.07% of 1984, grazes 193, shards 42.9% of 1989, still 0.07 s, flips 1.21/s, minStd10s 3.45, rmsAccel 118.2
AUTOPILOT A8a seed 7: thread 100.0% of 281, hit 2.76% of 1923, grazes 184, shards 43.7% of 1956, still 0.17 s, flips 1.25/s, minStd10s 4.33, rmsAccel 119.8
AUTOPILOT A8b density 1 seed 1985: thread 100.0% of 281, hit 2.68% of 3725, grazes 294, shards 33.3% of 1989, still 0.10 s, flips 1.25/s, minStd10s 4.28, rmsAccel 136.6
AUTOPILOT A8b density 1 seed 7: thread 100.0% of 281, hit 2.68% of 3656, grazes 323, shards 32.1% of 1956, still 0.13 s, flips 1.25/s, minStd10s 6.69, rmsAccel 132.9
AUTOPILOT A8b radius 3 seed 1985: thread 100.0% of 281, hit 2.57% of 1984, grazes 220, shards 44.0% of 1989, still 0.19 s, flips 1.16/s, minStd10s 3.62, rmsAccel 120.8
AUTOPILOT A8b radius 3 seed 7: thread 100.0% of 281, hit 3.38% of 1923, grazes 207, shards 46.2% of 1956, still 0.27 s, flips 1.21/s, minStd10s 4.31, rmsAccel 122.3
AUTOPILOT A8c fake: thread 100.0% of 281, hit 4.31% of 1067, grazes 106, shards 23.1% of 4504, still 0.08 s, flips 1.07/s, minStd10s 5.76, rmsAccel 125.5
AUTOPILOT A8n disabled: thread 20.6% of 281, hit 8.92% of 1984, grazes 115, shards 14.3% of 1989, still 599.38 s, flips 0.00/s, minStd10s 0.00, rmsAccel 0.0
```

These include the scheduled demo boost, which the rehearsal's constant-cruise numbers did not, so hits read up to about 0.7 points higher than the rehearsal, the direction section 10's boost note predicts.

**A9, what I saw in `test-results/T02/autopilot-trace.png`** (seed 1985, density 0.6, 30 s, three panels, each with a y strip below). All 13 cyan gate bars are crossed by the white path, and none is drawn in the miss colour. The path is smooth rounded curves with no sawtooth. Lateral moves begin well before the next gate, so they read as intent. Five fences appear. Four are passed cleanly through the open gap. The first, 0.55 s after the start, is the one hit in the picture: the ship is still swinging across and clips the edge of the narrowed gap, marked magenta, just inside the drawn gap. That is the start position being 44 u from a fence on this fixture, and rules are off in DEMO. **What looks less good:** the rehearsal's habit is still there. The ship makes its lateral move early, then holds a near-straight line with only the small weave to the gate, for example panel 1 from about 950 to 1300 px and panel 3 from about 1260 to 1640 px, roughly 2 s each. It is not a long straight run by the numbers (`minStd10s` at least 3.45), but in motion it may look mechanical. I did not retune for it, since it can only be judged moving, on T01's world, at T10. The plan's remedies stand: widen `AP_WEAVE_X` or shorten `AP_COMMIT_S`.

**A20, what I saw in `test-results/T02/feel-trace.png`** (20 s, boost 3 to 7 s, gates, hits at 6 and 10.5 s, `SIGNAL_LOST` at 14 s). `fovDeg` has sharp pulses at each gate, a smooth rise under boost that peaks just under 68 when a gate lands on top of it, and an ease back to 58. `flash` shows three heights, small shards, medium gates, and hits flat at the 0.6 cap, each with a clean decay. `aberration` ramps with boost to its 0.5 level, spikes to the cap at each hit, with a short flat top at 6 s where boost and hit add past 1, then returns to 0. `bloomGain` has the small beat sawtooth every 0.6 s, with gate pulses on top. `speedLines` rests near 0.125, rises to 1 under boost and falls back smoothly. `shakeY` and `roll` are quiet except for three short bursts, the third larger, each gone within about 0.5 s; `roll` otherwise follows the steering sine, with no ringing. Nothing stays high after its event. `shakeY` never gets near its cap in this run, peaking at 0.0067 of 0.012, because two sines rarely peak together; A17 covers the range.

**A10, A11, the final run, 2026-11-05T15:29Z to 15:34Z, `npx vitest run tests/unit/sim tests/unit/feel --reporter=verbose`, exit 0, 17 files, 235 tests:**

```
FUZZ DEMO base=0 steps=1000012 ok (of 1000012, 0 hits)
FUZZ DEMO base=1099511627776 steps=1000021 ok (of 1000021, 0 hits)
FUZZ PLAY base=0 steps=1000006 ok (of 1370086, 3085 hits)
FUZZ PLAY base=1099511627776 steps=1000008 ok (of 1369368, 3079 hits)
FUZZ CRUISE base=0 steps=1000004 ok (of 1000004, 0 hits)
FUZZ CRUISE base=1099511627776 steps=1000006 ok (of 1000006, 0 hits)
FUZZ SIGNAL_LOST base=0 steps=1000011 ok (of 2275277, 8334 hits)
FUZZ SIGNAL_LOST base=1099511627776 steps=1000007 ok (of 2275490, 8334 hits)
FUZZ CHAOS base=0 steps=1000001 ok (701 warps, 145 hits, modes 1537/474470/466531/57463, idle 5437, reduced 451998)
FUZZ CHAOS base=1099511627776 steps=1000024 ok (673 warps, 132 hits, modes 605/458151/481300/59968, idle 3995, reduced 447625)
FUZZ DEMO reduced steps=100003 ok (of 100003)
FUZZ PLAY reduced steps=100003 ok (of 128083)
FUZZ CRUISE reduced steps=100002 ok (of 100002)
FUZZ SIGNAL_LOST reduced steps=100013 ok (of 231425)
FUZZ PLAY base=CHUNK_LIMIT-1 steps=10010 ok
```

A11's controls passed in the same run: the 8 hand-broken transitions each return their own message; `{ speedFloor: 0, HIT_SPEED_FACTOR: 0.01 }` throws "speed floor"; `{ speedFloor: 0, HIT_SPEED_FACTOR: 0 }` throws "stepDist"; the same run with the floor in place passes. The whole fuzz file took 263 s alone beside the sibling executors.

**A12 to A15, A20, same run:**

```
GOLDEN 1399575935
ALLOC bytes per step: empty 0.072, DEMO 0.440, PLAY 0.472, retained control 32.416, limit 4
SIM_BENCH ms: p50 0.0243 p99 0.2390 p999 0.3735 max 4.8387
FEEL_ALLOC bytes per update: empty 0.072, update 0.000, retained control 32.000, limit 4
FEEL_RATE compared 3300 values, worst relative difference 1.79%
TRACE ...\test-results\T02\autopilot-trace.png: 1800x930, 13 gates, 0 missed, 1 hits
```

`SIM_BENCH` is contaminated: siblings shared the CPUs, and an earlier run in the same session read p50 0.0185, p99 0.1668. It passes the 0.5 ms gate either way, and it is about five times the rehearsal's quiet-machine p99 of 0.05. An uncontended number has not been measured. A15: `noBendWorld` ran 1e6 DEMO steps, and each text gate failed on its violating string.

**A21, A23:**

```
tsc: 34 owned files, 2 configs, 0 problems
eslint: 34 owned files, 0 errors, 0 warnings
vitest: 17 owned files, exit 0
glsl: 34 owned files scanned, 0 hits
playwright: not run by check:task
check:task T02 PASS
```

Exit 0, with 17 files and 235 tests, while siblings' files were being written in the same tree. Files under owned paths: exactly section 3's list, 10 in `src/sim` and `src/feel`, 24 in `tests/unit/sim` and `tests/unit/feel`, plus this plan and `test-results/T02/{autopilot-trace,feel-trace}.png`. Both images were re-opened after the final run and match the descriptions above.

Remaining: A22, `npm run check`, which runs only after the T01 to T09 batch has finished. Next action: none for T02 until then.

**V1 repair, 2026-11-05.** Verdict at `scratchpad/V1/T02.json`: passed, four low defects for T02, one for T10, 14 rulings.

- [x] 2026-11-05T20:03Z Status set to in-progress. All 34 owned src and test files and this plan copied to `scratchpad/T02/backup/`, and their sha256 recorded.
- [x] 2026-11-05T20:05Z Failing before: M1 (crossing restored to `rel + stepDist`) against the old beat-gate test gave exit 0, "1 passed | 22 skipped", so that test could not see the fault, as the verifier said. File restored, sha identical.
- [x] 2026-11-05T20:08Z Probe: from the start position every gate is within rounding of the plane one step before it crosses, at 80 u/s with the lock on or off and at 48 u/s reduced (section 10). So lock off alone would not catch M1. Step-boundary offsets reach the other side for a few `j`.
- [x] 2026-11-05T20:12Z Tests edited: `collision.test.ts` (beat-grid rows with a "within 1e-9" self-check, plus an offset sweep), `modes.test.ts` (idle `BOOST_OFF` tick), `motion.test.ts` (two NaN-to-floor tests), `structure.test.ts` (test-only gate and its control), and the `bench.test.ts` comment. `sim.ts` changed in a doc comment only. The four files on clean code: exit 0, 101 passed.
- [x] 2026-11-05T20:14Z Mutations, each through `scratchpad/T02/mutate.mjs`, restored in `finally`, sha identical after every one:

```
M1  crossing rel + stepDist     -> exit 1: "80 u/s: gates reached from offsets ... offset 1: fired 2, expected 1", same at 48 u/s; the 3 beat-grid rows pass (expected, section 10)
M19 no stopBoost on going idle  -> exit 1: "expected 1211 to be 1210"
M2b raw < floor ? floor : raw   -> exit 1: "expected NaN to be 45", "expected NaN to be 27"
M3  beat lock on the plain tick -> exit 1: lock-on beat-grid row "expected 0.11029035639114582 to be less than 1e-9"
MT  test warps 0.1 u off grid   -> exit 1: all 3 beat-grid rows, worst 0.667, 0.567, 0.300 (the self-check has teeth)
MR  matcher loses SimProbe, path-> exit 1: control "expected [ Array(1) ] to deeply equal [ ...(4) ]"; the real scan still passes
MW  walker not recursive        -> exit 1: "expected 0 to be greater than 10", "expected 1 to be 4"
MS  SIM_START_LOCAL + 0.1       -> exit 0: survived, since the rows warp to a fixed start; replaced by MT, not counted
```

- [x] 2026-11-05T20:15Z to 20:19:50Z `npm run check:task -- T02`, exit 0:

```
 Test Files  17 passed (17)
      Tests  243 passed (243)
   Duration  268.99s (tests 100%)
tsc: 34 owned files, 2 configs, 0 problems
eslint: 34 owned files, 0 errors, 0 warnings
vitest: 17 owned files, exit 0
glsl: 34 owned files scanned, 0 hits
playwright: not run by check:task
check:task T02 PASS
```

- [x] 2026-11-05T20:20Z Traces regenerated by that run: `autopilot-trace.png` sha256 a7acd63c, `feel-trace.png` 4a146e3a, the same bytes the verifier viewed. Opened both. Autopilot: three panels, every cyan gate crossed by the white path, the one magenta hit at the first fence near x 102 px in panel 1. Feel: seven rows, clean attacks and decays, three shake bursts. No repaired row draws an image.
- [x] 2026-11-05T20:20:30Z `bench.test.ts` alone: `SIM_BENCH ms: p50 0.0211 p99 0.1751 p999 0.2287 max 0.3356`, exit 0, CPU load 53% (contaminated by siblings). It matches the restated 2 to 3 times margin.
- [x] 2026-11-05T20:21Z A23: 10 files in `src/sim` and `src/feel`, 24 in the test folders, the same list as before the repair. Changed: `sim.ts` (comment), `bench`, `collision`, `modes`, `motion` and `structure` tests. `test-results/T02/` holds the two traces and `structure-fixture/` (6 files). `npm run plans:check`: "12 plans, 2648 pattern pairs, 0 problems".

Remaining after the repair: A22, the whole-repo run. Per DI-64, T02 counts as done for T10 only once the post-repair whole-repo run is green. That run is the T00 owner's.

**V2 repair, 2026-11-05.** Verdict at `scratchpad/V2/T02.json`: passed, one low T02 defect, the beat-grid count bound.

- [x] 2026-11-05T21:53Z Status set to in-progress. `collision.test.ts` (sha 94629b09) and this plan (d4749016) copied to `scratchpad/T02/backup-r2/`, all 34 owned files hashed. DI-70 read; it does not name T02.
- [x] 2026-11-05T21:53Z Failing before: mutant MTAIL (`sim.ts`: `if (state.tick < 47900) sweep();`, so each row loses its last gate) against the `> 90` rows: exit 0, "3 passed | 24 skipped". Restored, sha ee0ac7cb identical.
- [x] 2026-11-05T21:53Z `collision.test.ts`: the three beat-grid rows now assert 166, 166 and 100 (derivation in the test and the Decision log). Clean code, `-t "beat grid"`: exit 0, 3 passed. MTAIL again: exit 1, "expected 165 to be 166" on both 80 u/s rows, "expected 99 to be 100" on the 48 u/s row. Restored, sha ee0ac7cb identical.
- [x] 2026-11-05T21:53Z Whole `collision.test.ts`, verbose: exit 0, 27 passed, 5.62 s.
- [x] 2026-11-05T21:54Z `npm run plans:check`: exit 0, "12 plans, 2648 pattern pairs, 0 problems".
- [x] 2026-11-05T21:54Z to 21:58Z `npm run check:task -- T02`, exit 0: 17 files, 243 tests passed, 264.57 s; tsc 34 files 0 problems; eslint 0 errors, 0 warnings; glsl 0 hits; "check:task T02 PASS". Traces rewritten with the same bytes, sha a7acd63c and 4a146e3a. Owned-file hash diff against the backup: only `collision.test.ts` changed.

Remaining: A22, the T00 owner's whole-repo run (DI-64), as before.

**D-001 repair, 2026-11-06.** T10's defect register row D-001, ruled by the T00 owner as DI-75.

- [x] 2026-11-06T01:31Z Owned files hashed (35) and `sim.ts`, `rules.ts`, `motion.test.ts`, `collision.test.ts` and this plan copied to `scratchpad/T02/backup-d001/`. Status set to in-progress (section 14). DI-74 to DI-81 read.
- [x] 2026-11-06T01:31Z Failing before, T10's regression on unchanged code: `npx vitest run tests/unit/app/defects/D-001.test.ts`, exit 1: `D-001 speeds at steps 1, 30, 60, 120: 79.625, 68.75, 57.5, 48`, `expected 79.625 to be less than or equal to 48`.
- [x] 2026-11-06T01:31Z Bench baseline before the fix, alone through the GPU lock, CPU load 16% at start: `SIM_BENCH ms: p50 0.0211 p99 0.1757 p999 0.2278 max 0.7035`, exit 0.
- [x] 2026-11-06T01:33Z T02's own rows written first, in `motion.test.ts` (section 7, A2), and run on the unchanged sim, `-t "DI-75"`: exit 1, `2 failed | 4 passed`. Both at-load rows (DEMO, launched) fail on `expected 80 to be 48`; on then off, the two after-first-step ease rows and the control pass, since the old code already eases mid-run. A first draft of the toggle row failed on its own arithmetic (section 10) and was corrected before this run.
- [x] 2026-11-06T01:33Z Fix in `src/sim/sim.ts` `setReducedMotion`: at `tick === 0` it also sets `speedBase`, `speed` and `stepDist` to the scaled cruise (section 5, M1). Then `-t "DI-75"`: exit 0, 6 passed. T10's regression: exit 0, `D-001 speeds at steps 1, 30, 60, 120: 48, 48, 48, 48`.
- [x] 2026-11-06T01:34Z Mutations through `scratchpad/T02/mutate.mjs`, each over `motion.test.ts` plus T10's `D-001.test.ts`, restored in `finally`, sha `dabc5669` before and after every one:

```
MD1 fix removed (the old behaviour)   -> exit 1: both at-load rows "expected 80 to be 48"; D-001 "expected 79.625 to be less than or equal to 48"
MD2 every toggle snaps (tick >= 0)    -> exit 1: toggle row "expected 32 to be less than 0.000001", one-step row "expected 48 to be 79.625", control "expected [ 48, 48, 48, 48 ] to deeply equal [ 79.625, 68.75, 57.5, 48 ]"; D-001 passes
MD3 speedBase only, start state at 80 -> exit 1: both at-load rows "expected 80 to be 48"; D-001 passes (section 10)
```

- [x] 2026-11-06T01:35Z `collision.test.ts`: one comment corrected (it said reduced motion set before the first step eases), no logic change. Touched files, verbose, `motion`, `beatlock`, `collision`, `modes`, `determinism`: exit 0, 5 files, 100 passed; the 48 u/s rows pass, including the exact 100-gate count, and `GOLDEN 1399575935` is unchanged.
- [x] 2026-11-06T01:35Z `fuzz.test.ts -t "reduced"` at full size: exit 0, 5 passed:

```
FUZZ DEMO reduced steps=100003 ok (of 100003)
FUZZ PLAY reduced steps=100007 ok (of 127727)
FUZZ CRUISE reduced steps=100002 ok (of 100002)
FUZZ SIGNAL_LOST reduced steps=100013 ok (of 231194)
```

- [x] 2026-11-06T01:35Z T10's `npx vitest run tests/unit/app`, read-only: exit 0, `Test Files 12 passed (12)`, `Tests 93 passed (93)`.
- [x] 2026-11-06T01:36Z to 01:38:59Z T10's browser rows, read-only, through the GPU lock, `TERRAIN_PORT=5102`, `npx playwright test tests/e2e/touch.spec.ts tests/e2e/modes.spec.ts --project=gpu -g reduced --output=test-results/T02-D`: exit 0, 2 passed. `A21 reduced {"boot":{"speed":48,"reduced":"1"},"rolls":{"maxAbs":0,"n":432},"after":{...,"speed":48,...}}`, where T10 recorded 69.125. `A19 reduced: cruise 80.00000000000009 -> {"speed":48,"attr":"1"}, travel +24.4 in .5 s`. **Viewed** `test-results/T02-D/.../touch-reduced-play-390x844.png`: portrait PLAY under reduced motion, HUD legible (score 1600, SYNC x2, 0.1 km, S00 ULTRAVIOLET, gates 1/12, three shields, full overdrive), lilac banded disc on a level horizon, red fence and spike cluster ahead, no speed lines; the ship sits at the right edge with its wing cut, `x` 37.7, which is DI-81's framing note for T10. A still cannot show speed; the 48 is from the numbers.
- [x] 2026-11-06T01:39Z First `check:task` attempt through the lock never ran: `gpu-lock: busy, held by T04`, exit 75 after the 8-minute wait. Not a result.
- [x] 2026-11-06T01:47:49Z to 01:55:57Z `npm run check:task -- T02` through the lock, CPU load 21% at start, exit 0:

```
 Test Files  17 passed (17)
      Tests  249 passed (249)
   Duration  270.27s (tests 100%)
tsc: 34 owned files, 2 configs, 0 problems
eslint: 34 owned files, 0 errors, 0 warnings
vitest: 17 owned files, exit 0
glsl: 34 owned files scanned, 0 hits
playwright: not run by check:task
check:task T02 PASS
```

- [x] 2026-11-06T01:56Z Traces rewritten by that run with the same bytes, sha `a7acd63c` and `4a146e3a`. Opened both: autopilot, three panels, every cyan gate crossed by the white path, the one magenta hit at the first fence near x 102 px in panel 1; feel, seven rows, clean attacks and decays, three shake bursts, roll on the steering sine.
- [x] 2026-11-06T01:56:22Z to 02:00:20Z Bench after the fix, alone through the lock, CPU load 66% at start: `SIM_BENCH ms: p50 0.0227 p99 0.1849 p999 0.2483 max 0.3974`, exit 0. Delta against the 01:31Z baseline: p50 +0.0016, p99 +0.0092 (+5%), p999 +0.0205 ms, at 66% against 16% load. `bench.test.ts` never calls `setReducedMotion`, so the stepped code is unchanged and the delta is load [I]; the 0.5 ms gate holds either way.
- [x] 2026-11-06T02:00Z `npm run plans:check`: exit 0, `12 plans, 2648 pattern pairs, 0 problems`. A23: 35 owned files, the same list as before; changed are `src/sim/sim.ts` (ee0ac7cb to dabc5669), `tests/unit/sim/motion.test.ts` (2b1fa1b7 to 905ee3ff), `tests/unit/sim/collision.test.ts` (comment, 5becd5f9 to a683a00f) and this plan. `test-results/T02-D/` holds T10's A21 screenshot from the read-only run.

Remaining: A22, the T00 owner's whole-repo run (DI-64), as before. T10 re-runs its own D-001 rows and sets the register state; T02 does not edit T10's register.

**VI repair, 2026-11-06.** Integrated review VI-game, VI-r1 and VI-gates (`scratchpad/VI.json`: `r1.defects[4]`, `game.defects[1]`), ledger DI-94 and DI-92.

- [x] 2026-11-06T10:17:29Z 35 owned files hashed to `scratchpad/T02/vi/hash-before.txt`; `rules.ts`, `sim.ts`, `modes.test.ts`, `fuzz.test.ts`, `fixtures/drive.ts` and this plan copied to `scratchpad/T02/vi/backup/`. `objectives.test.ts` was not copied before its edit, which only adds one test block; its old sha is in the hash list (b064422f). Status set to in-progress (section 14). DI-90 to DI-96 read; only DI-92 and DI-94 name T02.
- [x] 2026-11-06T10:18Z **DI-92 precondition, not met: stopped.** `src/ui/hud.ts:82-87`, read-only, writes `formatObjective(z.objective, s.objectiveProgress, z.objectiveTarget)` with `z = v.zone`, and `src/app/loop.ts:127` fills `view.zone` from `world.zoneAt(view.cam, view.zone)`. The HUD's target is the world's full target at the camera. `SimState` has no target field (`src/contracts/index.ts:229-241`), and the HUD reads only `objectiveProgress` from the sim. A launch sector graded against a scaled target would read, say, `GATES 6/12` with no `OK` and then show `GRADE S`. That is the seam the task named, so DI-92 is not implemented, and no T02 file changed for it. CCR-T02-3 in section 12 records it. [O: code read; no run shows the mismatch, because nothing was built for it.]
- [x] 2026-11-06T10:19:19Z DI-94 failing before. The three new A3 rows on unchanged code, `npx vitest run tests/unit/sim/modes.test.ts -t "DI-94"`: exit 1, `3 failed | 25 skipped`: "expected false to be true" (autopilot after a loss forced from idle), "expected 1960 to be 1210", "expected 2560 to be 2501".
- [x] 2026-11-06T10:19:28Z to 10:19:30Z The new `runIdleFuzz` rows on unchanged code, `-t "nobody at the controls"`: exit 1, 3 failed:

```
gauntlet base 0:    score rose with nobody at the controls: 11100 -> 11350, 366 ticks after the first idle [seed 9408 tick 19508 mode 3]
gauntlet base 2^40: score rose with nobody at the controls: 700 -> 800, 1352 ticks after the first idle [seed 9448 tick 3708 mode 1 autopilot false]
poison base 0:      score rose with nobody at the controls: 230700 -> 235700, 579 ticks after the first idle [seed 9406 tick 4033 mode 3]
```

  The titles printed `chunk NaN` because `%d` took the world function; the argument order was fixed before the next run.
- [x] 2026-11-06T10:20:08Z to 10:20:13Z Exit fix in `src/sim/rules.ts` `updateModes`: a `human` frame during `SIGNAL_LOST` sets `lastHumanTick`; the exit sets `autopilot = tick - lastHumanTick >= idle` and no longer writes `lastHumanTick`. The A3 rows: 3 passed. The fuzz still failed, exit 1, now on a grade: `0 -> 250` at tick 134278 and `200 -> 450` at 50278, both mode 3 (`GRADE_BONUS` C), and `76900 -> 81900` on poison (S, target 0). First idle was tick 1200 in all three, so the cascade was gone and a second path remained (section 10).
- [x] 2026-11-06T10:20:51Z to 10:21:34Z Grade fix: `enterSignalLost` records `lossLive = mode === PLAY && !autopilot`, and `closeSector` in `src/sim/sim.ts` counts `SIGNAL_LOST` as graded only with `lossLive`. A new A6 row in `objectives.test.ts` covers it. `-t "DI-94|nobody at the controls|during SIGNAL_LOST is graded"` across modes, objectives and fuzz: exit 0, `8 passed | 82 skipped`, 40.74 s.
- [x] 2026-11-06T10:22:02Z to 10:23:37Z Mutations through `scratchpad/T02/mutate.mjs`, specs in `scratchpad/T02/vi/`, each over the same eight rows, restored in `finally`:

```
MX1 exit counts as input (old code)        -> exit 1, 7 failed: all 3 A3 rows, all 3 FUZZ IDLE ("11100 -> 11200 ... mode 1 autopilot false"), and the A6 row; rules.ts c9e0c77b IDENTICAL
MX2 input during SIGNAL_LOST not counted   -> exit 1, 1 failed: the 1301 row, "expected true to be false"; rules.ts c9e0c77b IDENTICAL
MX3 every SIGNAL_LOST graded (no lossLive) -> exit 1, 4 failed: the A6 row and all 3 FUZZ IDLE (+250, +250, +5000 in mode 3); sim.ts 6ccd14c9 IDENTICAL
MX4 lossLive always false                  -> exit 1, 1 failed: the existing "a sector ending during SIGNAL_LOST is graded" row; rules.ts c9e0c77b IDENTICAL
```

- [x] 2026-11-06T10:23:54Z to 10:28:58Z Section 7 rows the change can touch, verbose, `motion`, `modes`, `rules`, `objectives`, `collision`, `fuzz` and `determinism` (A2 to A6, A10 to A12): exit 0, `Test Files 7 passed (7)`, `Tests 187 passed (187)`, 302.46 s. `GOLDEN 1399575935`, unchanged. Every FUZZ line:

```
FUZZ DEMO base=0 steps=1000012 ok (of 1000012, 0 hits)
FUZZ DEMO base=1099511627776 steps=1000021 ok (of 1000021, 0 hits)
FUZZ PLAY base=0 steps=1000006 ok (of 1370086, 3085 hits)
FUZZ PLAY base=1099511627776 steps=1000008 ok (of 1369368, 3079 hits)
FUZZ CRUISE base=0 steps=1000004 ok (of 1000004, 0 hits)
FUZZ CRUISE base=1099511627776 steps=1000006 ok (of 1000006, 0 hits)
FUZZ SIGNAL_LOST base=0 steps=1000011 ok (of 2275277, 8334 hits)
FUZZ SIGNAL_LOST base=1099511627776 steps=1000007 ok (of 2275490, 8334 hits)
FUZZ CHAOS base=0 steps=1000001 ok (701 warps, 137 hits, modes 1537/474831/466531/57102, idle 10363, reduced 451998)
FUZZ CHAOS base=1099511627776 steps=1000024 ok (673 warps, 129 hits, modes 605/458151/481300/59968, idle 8923, reduced 447625)
FUZZ DEMO reduced steps=100003 ok (of 100003)
FUZZ PLAY reduced steps=100007 ok (of 127727)
FUZZ CRUISE reduced steps=100002 ok (of 100002)
FUZZ SIGNAL_LOST reduced steps=100013 ok (of 231194)
FUZZ IDLE gauntlet base=0 steps=1000009 ok (first idle tick 1200, 913 forced from idle, lost 327738, idle 671072, live after idle 0, hits after idle 0, sectors in lost 23, score 0 -> 0)
FUZZ IDLE gauntlet base=1099511627776 steps=1000014 ok (first idle tick 1200, 905 forced from idle, lost 324895, idle 673920, live after idle 0, hits after idle 0, sectors in lost 45, score 200 -> 200)
FUZZ IDLE poison base=0 steps=1000002 ok (first idle tick 1200, 908 forced from idle, lost 325840, idle 672963, live after idle 0, hits after idle 0, sectors in lost 3397, score 76900 -> 76900)
FUZZ PLAY base=CHUNK_LIMIT-1 steps=10010 ok
```

  Against the D-001 run, only the two CHAOS lines moved: base 0 idle steps 5437 to 10363, hits 145 to 137, SIGNAL_LOST steps 57463 to 57102. Chaos is the one old target with `human`-off windows and forced losses, so this is where the exit rule shows; the PLAY and SIGNAL_LOST targets send `human` true and are identical.
- [x] 2026-11-06T10:29:07Z to 10:29:11Z T10's `npx vitest run tests/unit/app`, read-only, real sim: exit 0, `Test Files 15 passed (15)`, `Tests 125 passed (125)`.
- [x] 2026-11-06T10:29:18Z to 10:34:14Z First `check:task` through the GPU lock, CPU load 82% at start: exit 1. vitest `17 passed`, `256 passed`, but `tsc: 1 problems`: `tests/unit/sim/fixtures/drive.ts(256,23): error TS2367: ... types '1' and '3' have no overlap` (section 10). Fixed by testing that the force emitted `SIGNAL_LOST` instead of re-reading the narrowed mode. Rerun of the three idle rows, 10:34:47Z to 10:35:26Z: exit 0, counts identical to the lines above.
- [x] 2026-11-06T10:35:36Z to 10:45:15Z `npm run check:task -- T02` through the lock (that span includes the lock wait), CPU load 17% at start, exit 0:

```
 Test Files  17 passed (17)
      Tests  256 passed (256)
   Duration  274.01s (tests 100%)
tsc: 34 owned files, 2 configs, 0 problems
eslint: 34 owned files, 0 errors, 0 warnings
vitest: 17 owned files, exit 0
glsl: 34 owned files scanned, 0 hits
playwright: not run by check:task
check:task T02 PASS
```

- [x] 2026-11-06T10:40Z Traces rewritten by that run with the same bytes, sha `a7acd63c` and `4a146e3a`. Opened both: autopilot, three panels, every cyan gate crossed by the white path, the one magenta hit at the first fence near x 102 px in panel 1; feel, seven rows, clean attacks and decays, three shake bursts, roll on the steering sine. Neither path runs the changed code (DEMO and scripted feel frames).
- [x] 2026-11-06T10:45:45Z `npm run plans:check`: exit 0, `12 plans, 2648 pattern pairs, 0 problems`. A23: 34 files under `src/sim`, `src/feel` and the test folders, plus this plan, the same list as before. Changed against `hash-before.txt`: `src/sim/rules.ts` (d9c6dd7c to c9e0c77b), `src/sim/sim.ts` (dabc5669 to 6ccd14c9), `tests/unit/sim/fixtures/drive.ts` (158575e8 to cb66bee0), `fuzz.test.ts` (b3668c5f to 48ddd298), `modes.test.ts` (dd414f7b to fccd3e04), `objectives.test.ts` (b064422f to a628cb7d), and this plan. `test-results/T02/` holds the two traces and `structure-fixture/`.
- [x] 2026-11-06T10:46:33Z to 10:46:46Z Throwaway probe for VI-r1's open question, whether the cascade starts with no harness: `tests/unit/sim/zz-probe-vi.test.ts`, deleted after the run (file count back to 34). No forced losses, no input after launch, gauntlet, 18 cases (section 10). The old exit ran through `mutate.mjs`, and `rules.ts` was restored IDENTICAL.

Remaining: CCR-T02-3 (DI-92's HUD target seam), which waits on the T00 owner, so status is `blocked`. A22, the whole-repo run, stays the T00 owner's (DI-64). Not run: T10's browser rows that cross `SIGNAL_LOST` (`tests/e2e/modes.spec.ts`, `motion.spec.ts`). Both launch with a real click and force the loss seconds later, so the exit is live under either rule [I], and both check only `data-mv-mode`, which reads `play` for live and idle PLAY alike.

**DI-97 repair, 2026-11-06.** Ledger DI-97: replaces DI-92, answers CCR-T02-3, ratifies `lossLive`.

- [x] 2026-11-06T12:08:34Z 35 owned files hashed to `scratchpad/T02/di97/hash-before.txt` and all copied to `scratchpad/T02/di97/backup/`. `rules.ts` c9e0c77b, `sim.ts` 6ccd14c9 and `objectives.test.ts` a628cb7d equal the VI repair's after-hashes, so disk and plan agree; `objectives.ts` is bddbfc7f, `rules.test.ts` is in the list. DI-90 to DI-99 read; DI-97 names T02.
- [x] 2026-11-06T12:09Z Status set to in-progress (section 14).
- [x] 2026-11-06T12:11:10Z to 12:11:13Z Rows written first, in `objectives.test.ts`: a DI-97 block (a start row, four late-launch rows, a warp guard row), and three existing A6 rows moved to the new rule (Decision log). On the unchanged sim, the old rule, `npx vitest run tests/unit/sim/objectives.test.ts --reporter=verbose`: exit 1, `15 failed | 22 passed (37)`:

```
launched at the start of a sector ... gives that sector's grade -> expected [] to deeply equal [ [ +0, 5000 ] ]
launched late, at chunk 6, 9, 12, 14                          -> expected [] to deeply equal [ [ 1, 2500 ] ], [ [ 2, 1000 ] ], [ [ 3, 250 ] ], [ [ 3, 250 ] ]
the 8 rank rows, at the launch boundary                         -> expected [] to deeply equal [ [ 3, 250 ] ]
GRADE comes just before SECTOR ...                              -> expected 12500 to be 12750
the launch sector is graded; a CRUISE-started ... are not       -> expected [] to deeply equal [ +0 ]
warpTo keeps the sector it lands in ungraded ...                -> passed: both rules leave it ungraded, so it is a guard row (MG3)
```

  Each DI-97 row checks progress before the grade, and those checks passed: the old code threads 12, 9, 6, 3 and 1 gates in them, so only the grade differs.
- [x] 2026-11-06T12:11:34Z to 12:11:37Z Fix. `src/sim/objectives.ts`: `clearProgress`, called only by `launch`, is now `launchSector` and sets `gradeEligible = true` where it set false. `src/sim/rules.ts`: imports and calls it. Same command: exit 0, `37 passed (37)`.
- [x] 2026-11-06T12:12:03Z to 12:12:16Z Mutations through `scratchpad/T02/mutate.mjs`, specs in `scratchpad/T02/di97/`, each over `objectives.test.ts`, restored in `finally`:

```
MG1 the old rule, launch sets false        -> exit 1, 15 failed, the messages above; objectives.ts 778306e6 IDENTICAL
MG2 the literal reading, launch leaves it  -> exit 1, 15 failed, the same messages; objectives.ts 778306e6 IDENTICAL
MG3 warpTo makes its sector eligible       -> exit 1, 2 failed: the warp guard row and the CRUISE and warp row, "expected true to be false"; sim.ts 6ccd14c9 IDENTICAL
MG4 launch target halved, a DI-92 stand-in -> exit 1, 3 failed: late launches at 6, 9 and 12, "expected [ [ +0, 5000 ] ] to deeply equal [ [ 1, 2500 ] ]", the same against [ [ 2, 1000 ] ], and "expected [ [ 2, 1000 ] ] to deeply equal [ [ 3, 250 ] ]"; the chunk 14 row survives, since 1 of 6 and 1 of 12 both grade C; objectives.ts 778306e6 IDENTICAL
```

- [x] 2026-11-06T12:12:50Z to 12:17:25Z Section 7 rows the change can touch, verbose, `motion`, `modes`, `rules`, `objectives`, `collision`, `fuzz` and `determinism` (A2 to A6, A10 to A12): exit 1, `1 failed | 192 passed (193)`, 273.39 s. The failure was A5's "SECTOR: value is the new index ...", `expected 8 to be 7`: on `emptyWorld` the launch sector's `GRADE` (8) now comes just before `SECTOR` (7) in the same step, which section 4's event table requires. `GOLDEN 1399575935`, unchanged. Every FUZZ line, with no `src` change after this run:

```
FUZZ DEMO base=0 steps=1000012 ok (of 1000012, 0 hits)
FUZZ DEMO base=1099511627776 steps=1000021 ok (of 1000021, 0 hits)
FUZZ PLAY base=0 steps=1000006 ok (of 1370086, 3085 hits)
FUZZ PLAY base=1099511627776 steps=1000008 ok (of 1369368, 3079 hits)
FUZZ CRUISE base=0 steps=1000004 ok (of 1000004, 0 hits)
FUZZ CRUISE base=1099511627776 steps=1000006 ok (of 1000006, 0 hits)
FUZZ SIGNAL_LOST base=0 steps=1000011 ok (of 2275277, 8334 hits)
FUZZ SIGNAL_LOST base=1099511627776 steps=1000007 ok (of 2275490, 8334 hits)
FUZZ CHAOS base=0 steps=1000001 ok (701 warps, 137 hits, modes 1537/474831/466531/57102, idle 10363, reduced 451998)
FUZZ CHAOS base=1099511627776 steps=1000024 ok (673 warps, 129 hits, modes 605/458151/481300/59968, idle 8923, reduced 447625)
FUZZ DEMO reduced steps=100003 ok (of 100003)
FUZZ PLAY reduced steps=100007 ok (of 127727)
FUZZ CRUISE reduced steps=100002 ok (of 100002)
FUZZ SIGNAL_LOST reduced steps=100013 ok (of 231194)
FUZZ IDLE gauntlet base=0 steps=1000009 ok (first idle tick 1200, 913 forced from idle, lost 327738, idle 671072, live after idle 0, hits after idle 0, sectors in lost 23, score 0 -> 0)
FUZZ IDLE gauntlet base=1099511627776 steps=1000014 ok (first idle tick 1200, 905 forced from idle, lost 324895, idle 673920, live after idle 0, hits after idle 0, sectors in lost 45, score 200 -> 200)
FUZZ IDLE poison base=0 steps=1000002 ok (first idle tick 1200, 908 forced from idle, lost 325840, idle 672963, live after idle 0, hits after idle 0, sectors in lost 3397, score 81900 -> 81900)
FUZZ PLAY base=CHUNK_LIMIT-1 steps=10010 ok
```

  Against the VI repair's lines, only FUZZ IDLE poison moved: `score 76900 -> 76900` is now `81900 -> 81900`. `poisonWorld` changes sector every chunk with target 0, so the launch sector now grades S (+5000) before the first idle at tick 1200, which DI-94's invariant allows; after the first idle the score still never rises. The gauntlet rows' launch sectors end after the first idle, in idle PLAY, so they are ungraded under both rules and unchanged.
- [x] 2026-11-06T12:18:05Z to 12:18:08Z A5's SECTOR row now expects `[GRADE, SECTOR]` at one tick, the `GRADE` as C, +250 at chunk 100 (`emptyWorld`, GATES 0 of 10), and the `SECTOR` payload exactly as before. `rules.test.ts`: exit 0, `30 passed (30)`.
- [x] 2026-11-06T12:18:24Z to 12:18:31Z MG1b and MG2b, the old rule and the literal reading, over `objectives.test.ts` and `rules.test.ts`: exit 1, 16 failed each, the A5 row reading `expected [ 7 ] to deeply equal [ 8, 7 ]`; `objectives.ts` 778306e6 IDENTICAL after both.
- [x] 2026-11-06T12:18:56Z to 12:18:58Z Why `GOLDEN` did not move: throwaway probe `tests/unit/sim/zz-probe-di97.test.ts`, replaying the golden script, exit 0, then deleted (no probe file left). Launch at step 500 in sector 0, chunk 8; `pause` at step 7000; sector 0 ends at step 9116 in CRUISE (`mode 2->2 autopilot true`), so nothing grades it under either rule. Sector 1 starts in CRUISE and ends ungraded at 18780; the first `GRADE` is at 28605 (B +1000), for a sector that began in human PLAY. Output in `scratchpad/T02/di97/probe-golden.log`.
- [x] 2026-11-06T12:19:14Z to 12:26:45Z `npm run check:task -- T02` through the GPU lock, `TERRAIN_PORT=5102`, CPU load 7% at 12:19:14Z. The lock was held by T08 from 12:19:19Z; T02 took it at 12:22:05Z. Exit 0:

```
 Test Files  17 passed (17)
      Tests  262 passed (262)
   Duration  274.32s (tests 100%)
tsc: 34 owned files, 2 configs, 0 problems
eslint: 34 owned files, 0 errors, 0 warnings
vitest: 17 owned files, exit 0
glsl: 34 owned files scanned, 0 hits
playwright: not run by check:task
check:task T02 PASS
```

  262 is the VI repair's 256 plus the six DI-97 rows. `check:task`'s reporter prints no test output, so it gave no `SIM_BENCH` line; A14's 0.5 ms gate passed inside it.
- [x] 2026-11-06T12:27Z Traces rewritten by that run (12:22Z) with the same bytes, sha `a7acd63c` and `4a146e3a`. Opened both: autopilot, three panels, every cyan gate crossed by the white path, the one magenta hit at the first fence near x 102 px in panel 1; feel, seven rows, clean attacks and decays, three shake bursts, roll on the steering sine. Neither path runs the changed code (DEMO and scripted feel frames).
- [x] 2026-11-06T12:27:06Z `npm run plans:check`: exit 0, `12 plans, 2648 pattern pairs, 0 problems`.
- [x] 2026-11-06T12:27:22Z to 12:27:26Z T10's `npx vitest run tests/unit/app`, read-only, real sim: exit 0, `Test Files 15 passed (15)`, `Tests 125 passed (125)`.
- [x] 2026-11-06T12:27Z A23: `scratchpad/T02/di97/hash-after.txt`, 34 files under `src/sim`, `src/feel` and the test folders, plus this plan, the same list as before. Changed against `hash-before.txt`: `src/sim/objectives.ts` (bddbfc7f to 778306e6), `src/sim/rules.ts` (c9e0c77b to 77fb3cc6), `tests/unit/sim/objectives.test.ts` (a628cb7d to 4edd937d), `tests/unit/sim/rules.test.ts` (67d6c7c0 to f1353c7a), and this plan. The probe file is gone. `test-results/T02/` holds the two traces and `structure-fixture/`; no Playwright run was made, so `test-results/T02-FC` was not created.

Remaining: A22, the whole-repo run, the T00 owner's (DI-64). Nothing waits on T02. Not run here: `test:browser` and `test:software`, which the T00 owner runs next.

**Boost lock (operator request, 2026-11-11).**

- [x] 2026-11-11T15:50Z Reopened for an operator feature request in session: a double tap locks boost on until overdrive runs out or a hit lands. Design proposed and ratified in session (decisions D1 to D5 in section 11). Backups of every touched file: session scratchpad `backup/`.
- [x] 2026-11-11T15:52Z Baseline before any edit: `npx vitest run tests/unit/sim/rules.test.ts tests/unit/sim/determinism.test.ts`, exit 0, `Tests 34 passed (34)`.
- [x] 2026-11-11T15:54Z Code. `src/sim/tuning.ts`: `BOOST_LOCK_TAP_S: 0.3`. `src/sim/rules.ts`: `DerivedTicks.boostLockTap` (36), `SimPrivate.boostLocked`, `boostHeldPrev`, `boostPressTick`; `resolveBoost` takes `ticks`, finds presses as rising edges of `ControlFrame.boost`, locks on a second press within 36 ticks press to press (overdrive at least `BOOST_MIN_START`), cancels on the next press, and drops the lock at overdrive 0; `applyHit` clears the lock; `stopBoost` clears it and the pending press. `src/sim/sim.ts`: passes `ticks`. No contract change: `ControlFrame.boost` still means held this frame.
- [x] 2026-11-11T15:54Z Tests: a `boost lock (double tap)` block of 10 rows in `tests/unit/sim/rules.test.ts`: 36 ticks locks and 37 does not; a negative control (`BOOST_LOCK_TAP_S: 0` never locks); a frame reused across steps is one press; runs out at overdrive 0 (56 to 58 ticks) and does not restart; a landed hit ends it on the next step; a hit with the button held keeps a plain hold until release; a hazard inside launch grace does not end it; the next press cancels; the cancelling press does not open a new double tap; pause ends it and resume does not restore it. Same command as the baseline: exit 0, `Tests 44 passed (44)`; `GOLDEN` stays 1399575935 (section 11).
- [x] 2026-11-11T15:56Z Mutation control: `p.boostLocked = true` replaced by `false` in `resolveBoost`. `rules.test.ts`: `Tests 7 failed | 33 passed (40)`, the 7 being every lock row that expects a lock; the negative control and the one-press row pass, as they assert no lock. Restored from the backup copy; `grep MUTANT` gives 0.
- [x] 2026-11-11T16:05Z Gates: `npm run check:task -- T02` `check:task T02 PASS` (vitest 17 owned files exit 0, glsl 34 files 0 hits); `npm run check:task -- T08` `check:task T08 PASS`; whole-repo `npm run check` exit 0, `Test Files 119 passed (119)`, `Tests 1990 passed | 2 skipped (1992)`, `glsl:check: 189 files scanned, 0 hits`; `npm run plans:check` `12 plans, 2648 pattern pairs, 0 problems`.
- [ ] Human check HC-BL1, open: whether a 0.3 s double-tap window feels right with Space, a mouse double-click and a second-finger double tap. Not run by any agent. Not run: `test:browser`, `test:software`, `test:smoke` (no test there presses boost twice within 0.3 s, by a grep of `tests/e2e`, `tests/visual`, `tests/forever`).

## 10. Surprises and discoveries

All from the 2026-11-05 rehearsal on the synthetic world. None has run against project code.

- **A single cost function gave a poor pilot.** The first planner threaded 85% of gates at density 0.3, 68% at 0.6 and 41% at 1, with hits near 1%: hazard penalties outvoted gates. Adding a commit window, where every candidate lies inside the aperture, gave 100% at all three, with hits near 2%.
- **The weave can spoil small gates.** With a fixed ±2.5 u weave, radius 5 threaded 95 to 98%, radius 4 85 to 87%, radius 3 55 to 80%. Scaling the weave to `0.2 * radius` while committed gave 100% at every radius from 3 to 7, with `x` up to ±38.
- **Doubles crossing function boundaries allocate.** Planner allocation went from 191 bytes per step with a double-returning `costOf`, to 41 once it wrote to a typed array, to 0.38 once candidates were passed as integer indices. Replacing `Math.hypot` alone changed 193 to 191. Rules alone were 0.46.
- **A digest cut the cost two to four times.** One pass over the window per replan, then flat arrays: mean 2.3 to 5 us per step, and 3-step p50 0.005, p99 0.05, p999 0.06 ms at density 1, where the first version had p50 0.012 and p99 0.19.
- **Long-window heap slope is useless here.** Over 100,000 steps the per-step deltas read -16, +26, -16 for the sim and +25, -18 with a leak added, because a scavenge lands in most windows. A median over 300 windows of 2000 steps gave 0 to 0.08 for an empty loop, and separated an added `{ i }` (+32), `[i, i, i, i]` (+80) and a closure (+96) cleanly.
- **A world written from T01's draft table was easier than the gauntlet.** At `d` 0, 0.5 and 1, seeds 1985 and 7, 600 s: 100% threaded, hits 0.16 to 0.95%, shards 54 to 62%, still at most 0.11 s, `minStd10s` 2.1 to 3.1. At boost 2.1% hits, under reduced motion `minStd10s` 1.86. A straight-line control there gave 32.5% threaded and 21% hits. That world is my reading of a draft, so T10's run on the real thing still decides.
- **Traffic needs closing speed in the planner.** T01's cars reach 40 u/s, half of cruise, so `rel / speed` underestimates their crossing time by up to half. The digest uses `speed - a * b / 256`.
- **`--reporter=basic` is gone** in Vitest 5.1.0: `Failed to load url basic`. Use `verbose`.
- **Boost is the autopilot's weak spot.** At a constant 150 u/s it hit 5 to 7% of hazards, against 1.4 to 2.5% at cruise, while still threading every gate. It is why demo boost is short and scheduled.
- **The phases lead the camera by one tick.** §3.3 step 5 interpolates the camera between ticks `T-1` and `T`, while step 6 interpolates phases between `T` and `T+1`. A drone with amp 12 and k 1 can therefore be drawn up to 0.63 u from its collision position [arithmetic]. Below the play's scale, so left alone, and noted for T05.

From the build, 2026-11-05, against project code:

- **The plan's crossing arithmetic double-counts a gate.** `relPrev = rel + stepDist` is not this step's `rel` from last step's arithmetic, because `advance` rounds. Where an item meets the plane within rounding of exactly 0, the next step can read `rel + stepDist` just above 0 and `rel` below it, so the item crosses twice. A gate on the beat is exactly that case. A throwaway probe, 200,000 items placed on a step boundary at each speed: 121,637 of 200,000 double-counted at 80 u/s, 132,890 at 48 u/s, 127,287 at 75.3 u/s, and 0 at 150 u/s, where the step is a power of two; the counts were the same at chunk 100 and chunk 2^40. Taking both distances from one expression over the two travels gave 0 double counts and 0 losses across all 1.6 million. `collision.test.ts` keeps a negative control that shows the first form failing on such offsets. See the Decision log.
- **A conditional that joins a double with an imported or captured constant allocates.** `v > LIMIT ? LIMIT : v`, with `LIMIT` read from an import or a closure, gave 25.0 B per step in DEMO and 9.6 in PLAY, against the 4 B limit. A context slot has no known number type, so TurboFan keeps that phi tagged and boxes `v` each time it passes through. An integer-valued `v` becomes a Smi and costs nothing, so a ship holding still reads almost clean, and only a moving one shows it. The sampling heap profiler (`HeapProfiler.startSampling` with collected objects included) attributed it to `plan` at 24.3 B per step and to `fly` at 16.0. Replacing those clamps with `Math.min` and `Math.max`, which are typed and inline, took DEMO to 0.44 and PLAY to 0.54, and the GOLDEN hash did not change. The other hypothesis failed first: creating every double field holding a non-integer changed nothing, 25.04 against 24.98, and was undone. The rehearsal never hit this because it wrote literal numbers. Literals are safe, so `x > 1 ? 1 : x` stays.
- **The beat-lock formula was one tick out as written.** Section 5 computes `e` with `tick` already incremented and `travel` not yet advanced, so a perfect start reads `e = -0.667`, which contradicts the plan's own "the start position has `e = 0`". It uses `tick - 1`. Speed at an undisturbed start is then within 1e-6 of 80, and the first gate crosses at tick 216 or within 1 of it.
- **`target > 0 ? progress / target : 1` cannot produce the NaN that A6 requires.** A NaN target falls to the `: 1` branch and grades S. It is written `target <= 0 ? 1 : progress / target`, so `target` 0 and below grades S, and NaN grades C, as A6 says.
- **Most fast cars never cross the plane.** At `TRAFFIC_TRAVEL_MAX` and 40 u/s at cruise, the plane passes the 102.4 u active band in 1.28 s while the car climbs 51.2 u, so it overtakes inside the band only for 51.2 / 128 = 40% of phases [arithmetic], and 159 of 400 seeds crossed [O]. The rest wrap in the fade band ahead of the ship and reappear behind it. Nothing is wrong here, and a wrap cannot fake a crossing (tested), but a car that looks catchable is only sometimes solid, which T05 and T11 may want to look at.
- **Linear holds and exponentials need the same order.** The plan's `trauma = sat(trauma + hits) - decay * dt` and any add-then-decay make the peak depend on `dt`, so a flood at a random `dt` never reaches a cap, and 1/30 against 1/240 would differ by about 15% in the shake amplitude [arithmetic]. Decay, then events, then output gives the full height on the frame an event arrives, reaches every cap, and two rates agree at any time both sample. See the Decision log.
- **A goal that moves between frames made easing lead by half a frame.** `bank` at 1/30 against 1/240 differed by 13% early in a turn. Easing toward the mean of the last two goals took the worst difference over 3300 compared values to 1.79%.
- **`amp * sin` can read -0** when trauma is 0, which fails `Object.is` against a neutral 0, so shake writes an exact 0 at no trauma. A decayed pulse also never lands on 0, so below 1e-5 it is set to 0: neutral is exact, and no denormal lingers.

From the V1 repair, 2026-11-05, against project code:

- **A gate on the beat does meet the plane within rounding, but always on the harmless side.** A scratch probe recorded every gate crossing from the start position over 400 s. Lock on: 166 of 166 were within 1e-9 u of the plane on the step before the crossing, worst 1.39e-13. Lock off: 166 of 166, worst 4.2e-11. 48 u/s reduced: 100 of 100, worst 4.7e-11. None was within rounding on the crossing step itself. Travel lags the exact position, so the plan's first form, `rel + stepDist`, still counts each of those gates once. That is why the old beat-gate test survived M1, and why `BEAT_LOCK_MAX: 0` alone would not have fixed it. The verifier's reading, that with the lock on the gate never lands within rounding, is not what the probe shows; its conclusion, that the test could not see M1, is right.
- **Step-boundary offsets reach the other side, but rarely.** Warping so the plane meets a gate after exactly `j` steps, for each `j`, put the gate within rounding on the crossing step for 2 of about 78 offsets at 80 u/s and 4 at 48 u/s; the rest landed on the step before. Those few are enough: under M1 the new sweep fails at `j = 1` with "fired 2" at both speeds.
- **The Bash tool collapsed doubled backslashes inside a quoted heredoc** when writing a mutation spec, so `JSON.parse` failed. Specs written with the Write tool parsed. Scratch tooling only.

From the D-001 repair, 2026-11-06, against project code:

- **Nothing in T02's suite covered reduced motion set at load.** Every reduced-motion row either stepped 240 or more times before reading speed (A2, A7) or warped after settling (A4), so the old 0.71 s ease from 80 was invisible to them. That is how the sim and T10's A21 could each follow their own text. T10's regression found it at 79.625 on step 1.
- **T10's regression checks steps, not the start state.** A mutant that sets `speedBase` but leaves `speed` at 80 before the first step (MD3) passes `D-001.test.ts` and fails T02's two at-load rows on `expected 80 to be 48`. The start-state assertion therefore adds cover that T10's row does not have.
- **A repeated sum is not a product in doubles.** The first draft of the toggle row expected `48 + 10 * UP` after ten ease-up steps and read `53.83333333333336` against `53.833333333333336`. The sim adds `UP` once a step, so the row now expects the same repeated sum. That was a test fault, not a sim fault.
- **The reduced fuzz rows change their paths, not their verdicts.** Starting at 48 instead of easing moves the in-mode totals, for example PLAY reduced 100,007 of 127,727 steps against 100,003 of 128,083 before, and SIGNAL_LOST reduced 231,194 against 231,425. All four still print `ok`.

From the VI repair, 2026-11-06, against project code:

- **Fixing the exit was not enough for DI-94's invariant.** With the exit fixed, the idle fuzz still failed on a grade: +250 (C) on the gauntlet and +5000 (S, target 0) on poison, in mode 3, with the first idle at tick 1200. `closeSector` treated every `SIGNAL_LOST` as the player's. So a boundary inside a loss forced from idle made the next sector eligible, and a boundary inside a later forced loss graded it, with nobody at the controls. Only the harness reaches this, because the hit rule runs only while live. MX3 restores the old predicate and fails the fuzz and the new A6 row.
- **The cascade starts with no harness, in the sim.** Throwaway probe, old exit against new, no forced losses, no input after launch, gauntlet seed 1985, 240,000-step cap. The first idle tick and the score at it were:

```
feed            density  old exit                      new exit
human-off fuzz  1        7467, 5 losses, 6150 (seed 1)  1356, 1 loss, 1400
human-off fuzz  1        8993, 6 losses, 7500 (seed 2)  1200, 1 loss, 250
rate 0          0.6, 1   2428, 1 loss, 1150 / 1700       1228, 1 loss, 250 / 350
absolute 0.3    1        9918, 7 losses, 6800            1362, 1 loss, 250
absolute 0.3    0.6      1200, 0 losses, 150             the same
```

  These are selected rows of the 18; all are in `scratchpad/T02/vi/probe-old.log` and `probe-new.log`. The first loss comes in the launch window, when rules are live, nobody steers and the ship holds a line. Each old exit then re-armed 10 s, and the later losses came inside those windows. A mouse that stops moving leaves `absolute: true` with a fixed target and `human` false, which is the 0.3 feed, so this plausibly happens in real play [I]. This is on T02's gauntlet, not T01's world, and not in a browser. VI-r1's caveat, that every cascade it saw began with a forced loss, does not hold in the sim.
- **TypeScript keeps a property narrowed across a method call.** `const fromIdle = s.mode === PLAY && s.autopilot; sim.forceSignalLost(); if (fromIdle && s.mode === SIGNAL_LOST)` gave TS2367 ("'1' and '3' have no overlap"): the aliased condition narrowed `s.mode`, and the call did not widen it. Vitest strips types, so the fuzz ran green, and only `check:task`'s `tsc` saw it. The test now checks for the `SIGNAL_LOST` event the force emits.
- **The HUD's objective target is the world's, not the sim's.** `hud.ts:86-87` takes `objectiveTarget` from `v.zone`, which `app/loop.ts:127` fills from `world.zoneAt(cam)`. DI-92 says "the HUD already shows the target from `SimState`". That holds for progress only, so a scaled launch target would never reach the screen. Recorded as CCR-T02-3.

From the DI-97 repair, 2026-11-06, against project code:

- **"Stop setting it false", the task's wording, is not enough.** Every sector boundary in DEMO calls `startSector` with `graded`, which is false in DEMO, and create and warp pass `false`, so the tracker is already false when `launch` runs. Removing the line (MG2) grades nothing, and fails the same 15 objectives rows and the A5 row as the old rule (MG1). `launch` sets it true.
- **A5's SECTOR payload row encoded the launch rule too.** It took the first event after launch on `emptyWorld` to be `SECTOR`; with the launch sector graded, `GRADE` comes first in that step, `expected 8 to be 7`. The suite's other `GRADE` readers outside `tests/unit/sim` (`tests/unit/ui`, `tests/unit/audio`, `tests/visual`) feed synthetic events and do not depend on the rule [O: grep].
- **The golden run cannot see DI-97.** Its launch sector ends in CRUISE, at step 9116, after the `pause` at 7000 (probe above). `GOLDEN` is unchanged for that reason, not because the change is inert.
- **The idle fuzz on `poisonWorld` now grades once before its first idle.** Its score at the first idle went from 76,900 to 81,900, an S on a target of 0 in the launch sector. The rule after the first idle is unchanged and still holds.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| Collision happens at a ship plane `SHIP_FORWARD = 14` u in front of the camera | Colliding at the camera would collect a shard after it has passed through and behind the ship. It puts the ship about 22% below centre at y 6 [arithmetic], which T05's draft also gets, as row 659 of 1080. T05 reached 14 u too and raised CCR-T05-2 | 2026-11-05 | T02 planner |
| `advance` is called once, in stage A, first, before anything that can throw or branch on mode | Makes "no mode can skip motion" structural inside `step`, as §3.3 does for the loop. `structure.test.ts` and `throwingWorld` hold it there | 2026-11-05 | T02 planner |
| R1 is layered: floor line written NaN-safe, invariant checker, 1e6-per-mode fuzz, Chaos fuzz, tuning-based mutation controls | A fuzz alone can pass vacuously. The mutation controls show it fails through the real pipeline when a floor is removed | 2026-11-05 | T02 planner |
| Tuning is one object, passed to `createSimInternal`; `createSim` passes the frozen default | One place to retune, and negative controls need no production switches | 2026-11-05 | T02 planner |
| Idle PLAY freezes all rules, not only SYNC | §7.2 states this (DI-23). Otherwise a parked player farms best score and loses shields with nobody at the controls | 2026-11-05 | T02 planner |
| Cosmetic events in DEMO, idle and `SIGNAL_LOST`; none in CRUISE | The screensaver must react to what it flies through (R4). A menu over a quiet world suits CRUISE | 2026-11-05 | T02 planner |
| `SIGNAL_LOST` refills shields at its end, not its start | The HUD should read 0 while the state lasts | 2026-11-05 | T02 planner |
| Item window 8 rows, `c-2` to `c+5` | §5.8's 4 rows are exactly the sweep's need, as T01's draft also found. §7.1's "current and next chunk" misses a car from behind. The planner needs at least one whole gate spacing ahead at boost. (closed by S-11) | 2026-11-05 | T02 planner |
| Use T01's `TRAFFIC_TRAVEL_MAX`, `TRAFFIC_FADE` and no collision in the band | Same numbers reached independently. A car's wrap jumps it backwards and would fake a crossing, and a faded car should not be able to hit you | 2026-11-05 | T02 planner |
| Fence hits at any y, as T01's draft says, and the gap narrows by the ship's radius | A y band would need a new contract constant and a change to T01's solvable-road proof. The cost lands on T05, which must draw a barrier that reads as full height | 2026-11-05 | T02 planner |
| Beat lock by speed trim of up to 6% | §5.8 states this (DI-21). `beat` comes from `tick` and cannot move. Without this, gates lose the beat permanently at the first boost, and §1's "thread gates on the beat" is true only until then | 2026-11-05 | T02 planner |
| Start at chunk 3, local `48 - SHIP_FORWARD` | Gates land on the beat from tick 0, and no row or camera position is ever negative in normal play | 2026-11-05 | T02 planner |
| Grade when `zone.index` changes, not when the ship crosses the arch | T01's arch sits on that boundary, so the camera passes under it in that step. Same-step `GRADE` then `SECTOR` lets T08 attach the grade to the new sector's banner, and worlds with no arch still grade | 2026-11-05 | T02 planner |
| CHAIN counts shards, as T01's draft says, with a distance-based break | §7.1 only says "chain length", and §7.6 ties chain to pickups. A one-miss break would make T01's double rails unwinnable | 2026-11-05 | T02 planner |
| Event `x, y` are always the ship's, other `value`s 0, no `Grade` constant, no T02 event comment | Matches CCR-T08-3 exactly, so there is one wording. T05 gets the item from `(chunk, index)`, and state already holds the rest | 2026-11-05 | T02 planner |
| Withdraw T02's own requests for the ship plane, traffic limits, grade constant and objective comment | CCR-T05-2, CCR-T01-2, CCR-T08-3 and CCR-T01-4 say the same with equal values. Two names for one number is the drift §8 exists to stop | 2026-11-05 | T02 planner |
| `pause` from PLAY only | T08's `togglePause` never sends it elsewhere, and it removes a remembered mode and a timer interaction | 2026-11-05 | T02 planner |
| First partial sector, CRUISE-started and warped sectors are ungraded | A C for flying 30% of a sector is a bad first impression | 2026-11-05 | T02 planner |
| Autopilot: candidate-grid planner with gate commit | It handles gates, hazards and shards in one rule, predicts moving items exactly, and costs little. Rehearsed against a straight-line control | 2026-11-05 | T02 planner |
| Autopilot uses perfect knowledge and is not made fallible | Demo should look expert, and rules are off, so nothing is unfair | 2026-11-05 | T02 planner |
| Weave uses integer harmonics of the bar phase | The ship sways with the music, and the §4.5 rule holds | 2026-11-05 | T02 planner |
| Under reduced motion, FOV stays 58 even when boosting | §10.3 lists FOV pulses, and a sustained FOV change is a stronger vestibular cue than a pulse [I]. Speed itself still changes | 2026-11-05 | T02 planner |
| `duck` and `shipHold` keep working under reduced motion | Neither moves the picture | 2026-11-05 | T02 planner |
| Shake noise is integer harmonics of the 1 s tick phase | Pure and deterministic. The 1 s repeat cannot show, since trauma has decayed by then | 2026-11-05 | T02 planner |
| Rules never read the event buffer | §8.1's "overflow drops events, never rules" is then true by construction, and A5 proves it | 2026-11-05 | T02 planner |
| A world that throws is not caught inside `step` | A swallowed world bug would hide a defect. §3.3's catch routes to the fatal page, and travel has already risen | 2026-11-05 | T02 planner |
| T10 runs the real-world autopilot check and the sim-plus-feel trace | Lint forbids `tests/unit/sim` importing `src/world` or `src/feel`. Only `tests/unit/app` may | 2026-11-05 | T02 planner |
| Both crossing distances come from one expression over the previous and current travel, so `before` is kept in stage A, not `relPrev = rel + stepDist` | Section 5's form double-counted 61% of items on a step boundary at cruise (section 10). A gate on the beat is such an item. A NaN still never crosses | 2026-11-05 | T02 executor |
| Hit recovery counts from the first slowed step: `since = tick - lastHitTick - 1`, so that step reads exactly `HIT_SPEED_FACTOR` and speed is back 180 steps later | "52 at once" is then exact, and A11's `HIT_SPEED_FACTOR: 0` control really stops the ship. With the plain tick difference it would read 0.44 u/s and be caught as a floor breach, not as "travel" or "stepDist". Recovery still spans 1.5 s, measured from the drop | 2026-11-05 | T02 executor |
| Beat lock compares `travel` with `tick - 1` | Stage A runs before `advance`, so that is the tick `travel` belongs to. As written, the plan's own start state read a one-tick error (section 10) | 2026-11-05 | T02 executor |
| Grade ratio is `target <= 0 ? 1 : progress / target` | Section 5's form cannot satisfy A6's "NaN grades C" | 2026-11-05 | T02 executor |
| A would-be hit with rules off emits nothing, not a cosmetic `GRAZE` | The plan names cosmetic `SHARD`, `GATE`, `GRAZE` and bans `HIT`. A pass through a hazard is not a graze, and nothing reads it as one | 2026-11-05 | T02 executor |
| `stopBoost` emits `BOOST_OFF` at once on `pause`, loss, idle and launch, ahead of any `SIGNAL_LOST` event | One edge per boost, in the same step as its cause, so T07 and T08 never see a mode change while boost still reads on | 2026-11-05 | T02 executor |
| `createSimInternal` takes an optional `SimProbe` with `onCrossing` and `onControl` | Metrics replay the same shape tests, and A8r reads the planner's own frames, without a second copy of the sweep. It is one undefined check per step or crossing. `createSim` passes none, and `index.ts` exports neither | 2026-11-05 | T02 executor |
| Feel runs decay, then events, then output, including trauma | The plan's trauma formula adds then decays. Decaying first gives the full height on the event's frame, reaches the caps under any `dt`, and makes two rates agree at common sample times (section 10) | 2026-11-05 | T02 executor |
| `bank`, `fovBase` and `speedLines` ease toward the mean of their last two goals | Plain easing leads a moving goal by half a frame, which broke A16 at 1/30. The first frame is a step | 2026-11-05 | T02 executor |
| A16's 5% is taken against `max(abs(a), abs(b), 2% of the field's range)` | A ratio has no meaning as a signal passes through 0, and `roll` and the shake do. The 5% itself is unchanged, and the worst seen is 1.79% | 2026-11-05 | T02 executor |
| Fixture `carpetWorld` uses radius 8 spikes on eight x columns, and `poisonWorld` has one record per poison | The plan names their purpose, not their records | 2026-11-05 | T02 executor |
| `GOLDEN` is 1399575935, from gauntlet seed 1985, density 0.8, with the script in `determinism.test.ts`. Node 24.14.1's V8 | First value, as the plan says. Clamp and field-name changes after it left it unchanged | 2026-11-05 | T02 executor |
| Fuzz per-test timeout 600,000 ms, not 300,000 | A longer limit cannot make an invariant pass, and eight sibling executors share these CPUs. It only stops machine load turning the gate red | 2026-11-05 | T02 executor |
| A9: no retune for the near-straight holds before gates | Only motion can judge them, and T01's world differs. The plan already names the two remedies for T10 | 2026-11-05 | T02 executor |
| **Ruling 1.** Crossing from the previous and current travel through one expression stands, and section 5 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. Restoring `rel + stepDist` (M1) failed the no-tunnelling test at 48 and 80 u/s, "fired 2, expected 1" | 2026-11-05 | T02 executor, repair |
| **Ruling 2.** Beat lock against `tick - 1` stands, and section 5 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. The plain tick (M3) trims 0.667 u/s at an undisturbed start. Relock came 6.4 s after a boost's release and 7.9 s after a hit, inside A7's 10 s | 2026-11-05 | T02 executor, repair |
| **Ruling 3.** Grade ratio `target <= 0 ? 1 : progress / target` stands, and section 5 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. The first form (M4) grades a NaN target S, against A6 | 2026-11-05 | T02 executor, repair |
| **Ruling 4.** Hit recovery from the first slowed step stands, and section 5 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. Speed reads exactly 52, then 80 after 180 steps, and A11's `HIT_SPEED_FACTOR: 0` control depends on it (M5 gave 52.156) | 2026-11-05 | T02 executor, repair |
| **Ruling 5.** Feel order of decay, events, output stands, and section 5 M6 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. A17 reaches each cap exactly; M9 failed it at 0.87 | 2026-11-05 | T02 executor, repair |
| **Ruling 6.** Easing toward the mean of the last two goals stands, and section 5 M6 now prints it | Reviewer: the V1-T02 verifier agreed, accepted. Worst 1/30 against 1/240 difference is 0.05% of any field's range | 2026-11-05 | T02 executor, repair |
| **Ruling 7.** Fuzz per-test timeout 600 s, not section 5's 300 s (an acceptance change) | Reviewer: the V1-T02 verifier agreed, accepted. A timeout can only fail a test; the fuzz file ran in 256 to 260 s under load | 2026-11-05 | T02 executor, repair |
| **Ruling 8.** `SimProbe` on `createSimInternal` stays, on the verifier's condition: production code, T10's app included, constructs through `createSim` only, and `createSimInternal` and `SimProbe` stay test-only | Reviewer: the V1-T02 verifier agreed, accepted with that condition. Met by section 4's "Not provided" line, the doc comment on `SimProbe`, and a new `structure.test.ts` gate over `src/` outside `src/sim/`, whose negative control and two mutations (matcher, walker) fail | 2026-11-05 | T02 executor, repair |
| **Ruling 9.** A16's 5% taken against `max(abs(a), abs(b), 2% of range)` (an acceptance change) | Reviewer: the V1-T02 verifier agreed, accepted. It is an absolute floor of 0.1% of range, needed only at zero crossings, and hides nothing measured | 2026-11-05 | T02 executor, repair |
| **Ruling 10.** A rules-off hit emits nothing | Reviewer: the V1-T02 verifier agreed, accepted. Not a graze, and no consumer reads it as one | 2026-11-05 | T02 executor, repair |
| **Ruling 11.** `stopBoost` emits `BOOST_OFF` at once on pause, loss, idle and launch | Reviewer: the V1-T02 verifier agreed, accepted, noting that idle's same-step claim was untested (M19 survived). Now tested: A3's idle row asserts the tick, and M19 fails it with "expected 1211 to be 1210" | 2026-11-05 | T02 executor, repair |
| **Ruling 12.** A4's traffic row reads "crosses at most once; 150 to 170 of 400 seeds cross while solid; at least one from row `c-2`", replacing "crosses once" (an expected-output change) | Reviewer: the V1-T02 verifier agreed, accepted with the condition that this entry exists and section 4's "every car is caught" is corrected (both done). 51.2 / 128 = 40% [arithmetic] and 159 of 400 measured agree. The lower bound of 150 keeps the row guarding the `c-2` window: sweeping from `c-1` (M12) gave 101 | 2026-11-05 | T02 executor, repair |
| **Ruling 13.** A7's relock is measured from 2 s (240 steps) after the boost's release, not from the release (an acceptance reading) | Reviewer: the V1-T02 verifier agreed, accepted. Measured from the release, the first locked gate came at 6.4 s, inside 10 s, so the offset loosens nothing | 2026-11-05 | T02 executor, repair |
| **Ruling 14.** Fixture records for `carpetWorld` and `poisonWorld`, and `GOLDEN` 1399575935 | Reviewer: the V1-T02 verifier agreed, accepted. GOLDEN reproduced on Node 24.14.1, and one changed frame changes it | 2026-11-05 | T02 executor, repair |
| The beat-gate test is replaced by two: beat-grid rows (lock on, lock off, 48 u/s reduced) that check the "within rounding" claim, and a step-boundary offset sweep at 80 and 48 u/s that reaches both sides of 0 | The verifier's fix was "run it with `BEAT_LOCK_MAX: 0`, or drop its claim". A repair probe showed lock off is not enough: from the start position every gate rounds to just above 0, lock on or off, and the plan's first form counts those once, so M1 still survived. The offset sweep fails under M1 ("offset 1: fired 2"); the beat-grid rows fail under M3 and under a 0.1 u start offset | 2026-11-05 | T02 executor, repair |
| Section 5's bench margin is restated as 2 to 3 times, and the phone inference is dropped | The real code's p99 reads 0.17 to 0.24 ms against the rehearsal's 0.05. The 0.5 ms gate itself is unchanged | 2026-11-05 | T02 executor, repair |
| DI-58 to DI-66 were read. None names T02 in its decision or change list | DI-64 applies to A22: T02 counts as done for T10 only after the post-repair whole-repo run is green. DI-66's T10 item is the verifier's demo fence-clip note, owned by T10 | 2026-11-05 | T02 executor, repair |
| A4's beat-grid rows assert the exact gate count, 166, 166 and 100, in place of `> 90` (an acceptance change, tightening). Records the V1 repair's unlogged changes too: the run went from 300 to 400 s and the bound from `> 100` to `> 90` | V2-T02 verifier accepted the old change on condition of this entry, and offered the exact count as the fix. 400 s gives 1 + floor(47783 / 288) = 166 gates at 80 u/s and 1 + floor(47639 / 480) = 100 at 48 [arithmetic], and clean code meets both. `> 90` let a run drop up to 75 of 166 gates at 80 u/s, or 9 of 100 at 48, at its tail, which the 3-chunk spacing check cannot see. A mutant that stops sweeping after tick 47,900, losing each row's last gate, passed `> 90` and fails the exact count | 2026-11-05 | T02 executor, V2 repair |
| Reduced motion set before the sim's first step applies from that step: `setReducedMotion` at `tick === 0` sets `speedBase`, `speed` and `stepDist` to the scaled cruise; after the first step it sets `scale` only, and speed eases as before (a design and acceptance change) | The T00 owner's ruling DI-75 on T10's D-001, adopting T10's proposal. T08 calls `setReducedMotion` at mount, before the loop's first step, and §10.3 states no ramp, while the sim started every run at 80 and eased: 79.625 at step 1, 48 only after 120 (T10's `node-repro.txt`), 69.125 at `MV_READY` in the browser. `tick === 0` is the exact test for "before the first step", since only `step` changes `tick` and nothing resets it, warp included. Setting `speed` and `stepDist` as well as `speedBase` goes one step beyond DI-75's "start speed": it keeps `stepDist === speed / SIM_HZ` true in the start state and means no reader sees 80 before step 1; with `scale` 1 the three values equal the unset start bit for bit. A2 gains six rows, including a control. No threshold moved, and `GOLDEN` is unchanged because its script never sets reduced motion | 2026-11-06 | T02 executor, D-001 repair |
| DI-94: the `SIGNAL_LOST` exit keeps the last real input's tick and goes to idle autopilot when that input is at least `IDLE_TIMEOUT_S` old. A `human` frame sent during `SIGNAL_LOST` counts as real input, though it steers nothing. An idle exit leaves the planner running, with no `activate()` | The T00 owner's ruling DI-94 on VI-r1's defect 5. A frame with `human` true is a person by §8.1's `ControlFrame` comment, whatever the mode, so a player pressing keys through the 3 s is still present at the exit. The planner already steered through `SIGNAL_LOST`, so re-activating it would only snap its target. No threshold or expected output moved. `GOLDEN` is unchanged, because its script sends `human` true 97% of the time and never goes idle | 2026-11-06 | T02 executor, VI repair |
| DI-94, beyond its text: `SIGNAL_LOST` grades its sector boundaries only when it came from live play (`lossLive`, set in `enterSignalLost`), where the old rule graded every `SIGNAL_LOST` | DI-94 requires the invariant "with `human` false throughout, score never rises after the first idle, including after forced `SIGNAL_LOST`s". The exit fix alone failed it on a `GRADE` bonus (section 10). The hit rule runs only while live, so every loss a player can cause still grades exactly as before (the existing A6 row, and MX4 shows that row can fail). The only change is to a harness loss forced from idle PLAY. Flagged here for the T00 owner as a design change made by the executor | 2026-11-06 | T02 executor, VI repair |
| DI-92 is not implemented | The task's condition was to stop and report if the HUD does not show the scaled target through existing `SimState` fields. It does not: the target comes from `v.zone` (section 10). Grading against a target the HUD does not display would grade S over a reading of `GATES 6/12` with no `OK`. CCR-T02-3 is filed, and status is `blocked` until the T00 owner rules | 2026-11-06 | T02 executor, VI repair |
| **DI-97 adopted (replaces DI-92, closes CCR-T02-3).** `launch` makes its sector eligible, and the sector is graded against the zone's full target, `o.target` as `startSector` took it from `zone.objectiveTarget`, with progress counted from the launch. `warpTo` keeps `gradeEligible = false`. In code, `clearProgress` (called only by `launch`) becomes `launchSector`, which sets `gradeEligible = true` where it set false (a design and acceptance change) | The T00 owner's ruling DI-97. The HUD reads its target from `v.zone`, so this is the one target that needs no contract field and no T08 change, and a grade only pays a bonus, so a late launch's lower grade costs nothing. This repair's task text, "stop setting `gradeEligible = false` at launch", read literally, would not grade anything, while DI-97 itself says the launch sector is graded: every DEMO boundary passes `graded`, false in DEMO, to `startSector`, so launch has to set it true. MG2, the literal reading, fails the same 16 rows as MG1, the old rule. No threshold moved | 2026-11-06 | T02 executor, DI-97 repair |
| **DI-97 ratifies `lossLive`.** A `SIGNAL_LOST` grades a sector boundary only when it came from live play, so a loss forced from idle cannot earn a `GRADE` bonus with nobody playing | The T00 owner's ruling DI-97 on the VI repair's executor decision above ("DI-94, beyond its text"), which flagged it for that owner. Ratified with no change to code or tests: MX3 and MX4 from the VI repair still describe it | 2026-11-06 | T02 executor, DI-97 repair |
| Four existing rows change their expected output, because each encoded the launch rule DI-97 replaced. A6: the eight rank rows now expect the launch sector's own grade at chunk 12 (`[[3, 250]]`: no gates in it, so C) where they expected no `GRADE`; "GRADE comes just before SECTOR" expects 250 more score, the launch sector's C; "the launch sector, a CRUISE-started sector and a warp are not graded" becomes "the launch sector is graded; a CRUISE-started sector and a warp are not", expecting an S (target 0) for the launch sector. A5: "SECTOR: value is the new index..." expects `[GRADE, SECTOR]` in one step where it expected `SECTOR` first (an expected-output change) | No threshold moved, and no assertion was dropped. Each row keeps every old check that still holds, and adds an exact one for the new grade (rank, bonus, chunk or score). Under MG1, the old rule, all four fail with "expected [] to deeply equal [ [ 3, 250 ] ]", "expected 12500 to be 12750", "expected [] to deeply equal [ +0 ]" and "expected [ 7 ] to deeply equal [ 8, 7 ]" | 2026-11-06 | T02 executor, DI-97 repair |
| `GOLDEN` stays 1399575935 | It did not change. A throwaway probe replayed the golden script: launch at step 500 in sector 0, `pause` at step 7000, and sector 0 ends at step 9116 in CRUISE (mode 2), where `closeSector` grades nothing under either rule. Every later grade is in a sector that started in human PLAY, which both rules grade alike. So the golden run cannot see DI-97, and the new A6 rows carry it | 2026-11-06 | T02 executor, DI-97 repair |
| **Boost lock (operator, 2026-11-11, a design change).** Two boost presses within `BOOST_LOCK_TAP_S` 0.3 s, press to press, in live PLAY lock boost on with nothing held. The lock ends at overdrive 0, on a hit that lands (D1: a button still held then boosts as a plain hold; D2: a hazard blocked by ghost or grace is no hit and keeps it), or on the next press (D3: a tap cancels, and the cancelling press does not open a new double tap). It also ends wherever `stopBoost` already ran: pause, `SIGNAL_LOST`, idle autopilot, launch. Detection lives in the sim, not `src/input` | Input cannot see overdrive or hits, and a latch there would restart boost after overdrive refilled. Every boost source (Space, left button, second finger, on-screen button) already reaches the sim as `ControlFrame.boost`, so one rule covers all, with no contract change. Presses are rising edges against the previous step, so one frame reused across steps is one press. Operator ratified D1 to D5 in session; architecture §7.1's Boost row updated to match | 2026-11-11 | Operator; Claude Code session |
| `GOLDEN` stays 1399575935 after the boost lock | The golden script changes `boost` only every 60 steps, so two presses are at least 120 steps apart against a 36-tick window, and the lock can never engage. Confirmed by running: the determinism file passed unchanged | 2026-11-11 | Claude Code session |

## 12. Contract change requests

All decided in `plans/RECONCILIATION.md`. The text below is a record: §8 carries the outcome, and §8's wording wins. No fallback applies.

T02 also depends on requests other plans raised, and supported them as filed:

- **CCR-T05-2:** `SHIP_FORWARD`. T02 needs the same plane and reached the same 14 u independently. State: approved, C-09; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **CCR-T01-2:** `TRAFFIC_TRAVEL_MAX`, `TRAFFIC_FADE`, `ITEM_WINDOW_BEHIND`, and the `ItemField` wording with GATE `a = 1`. State: amended, C-08 and C-01; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **CCR-T08-1:** `ControlFrame` meaning. State: approved, C-15; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **CCR-T08-2:** `SHIELD_MAX`, `SYNC_MAX`, which T02 imports. State: approved, C-16; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **CCR-T08-3:** event meanings. State: amended, C-17 and C-12; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **CCR-T01-4:** the objective-unit comment. CCR-T08-3 has one too, and T01's is the exact one: CHAIN is consecutive shards. State: amended, C-12; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.
- **T00's CCR-1, CCR-2, CCR-4:** `ItemField`, `src/core/alloc.ts`, `phaseOf`. State: amended, C-01; approved, C-02; approved, C-04; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins.

**CCR-T02-1. Meaning of `FeelState`, as a comment only.** State: amended, C-13; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. As filed: T05, T06, T07, T08 and T10 read it and the type says nothing about units. Directly above `export interface FeelState`:

```ts
/**
 * shakeX, shakeY, roll: radians; roll is three's rotation.z, negative banks right. fovDeg: [58, 68]. aberration: [0, 1], maps across §6.6's range.
 * flash: [0, 0.6]. speedLines: [0, 1]. bloomGain: multiplier in [1, 1.25]. glitch, duck: [0, 1]. shipHold: seconds, > 0 means hold ship and HUD animation.
 */
```

**CCR-T02-2. A way into `SIGNAL_LOST`.** State: approved, C-14; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. `createSim`'s result implements it, and `HarnessApi` exposes it (C-27). As filed: §11.5 requires the motion test to cross `SIGNAL_LOST`, and no command reaches it. Changing the `SimCommand` line would not be additive, so in `Sim`, after `setReducedMotion`:

```ts
  /** Harness only. In PLAY, acts as if shields just reached 0; no-op in any other mode. */
  forceSignalLost(): void;
```

`createFakeHost`'s fake `Sim` must implement it too. T09 or T10 decide how `HarnessApi` exposes it.

**CCR-T02-3. Where the HUD gets the objective target (DI-92, seam T02, T08 and T10).** State: closed, answered by the T00 owner's DI-97 on 2026-11-06, which replaces DI-92. No contract change: the launch sector is graded against the zone's full target, which the HUD already shows, so none of the three options below was taken and T08 changes nothing. Implemented in the DI-97 repair (section 9). Filed 2026-11-06 in the VI repair; the text below is the record as filed. DI-92 says "the HUD already shows the target from `SimState`, so no contract changes". It does not. `src/ui/hud.ts:86-87` shows `z.objectiveTarget` with `z = v.zone`, `src/app/loop.ts:127` fills `v.zone` from `world.zoneAt(view.cam)`, and `SimState` has no target field. If T02 grades the launch sector against a scaled target, the HUD keeps showing the full one, and `OK` appears only at the full count. T02 has made no change for DI-92. Ways to close it; the choice is the T00 owner's:

1. Additive contract field, which T02 fills and T08 reads in place of `z.objectiveTarget` while in PLAY. In `SimState`, after `objectiveProgress`:

   ```ts
     /** What this sector is graded against, in objectiveProgress's unit: zone.objectiveTarget, except in the sector a run is launched in, where it is scaled to the part still ahead (DI-92). */
     objectiveTarget: number;
   ```

   T08 must then decide which of `s.objectiveTarget` and `z.objectiveTarget` to show in the one frame where `sectorIndex` leads `v.zone`, as `hud.ts` pairs `z.objective` with the target. `createFakeHost`'s fake `SimState` gains the field.
2. No contract change: T08 computes the scaled target itself from the travel it already latches at launch. That puts T02's grading rule in two places, and the two can drift.
3. Revisit DI-92, for example VI-game's option (b), which marks an ungraded sector's objective in the HUD. That also needs a read-only flag through T00.

## 13. Outcomes and retrospective

**Result against Purpose.**

1. **R1 cannot be broken from inside the sim.** 1e6 steps in each of four modes at chunk 0 and 2^40, Chaos at both, reduced motion and past the limit all passed `checkStep`: `speed` never below the floor, `travel` rising on every step, `stepDist === speed / 120`. Removing the floor fails the same gate through the real pipeline. `advance` is called once, in stage A, and a text gate holds that.
2. **The page is alive with no input, on the fixture worlds.** 100% of gates threaded at density 0.6 and 1, at radius 3, and on the fake. Hits 2.07 to 4.31%, longest still 0.27 s, and the `AP_ENABLED: false` control fails every count it must. A8r shows one physics path. The picture was opened: every gate crossed, smooth turns, one fence clipped 0.55 s after the start.
3. **It is a game, as logic.** Section 7.1's rules are tested with exact numbers. Every sim number is one property of `TUNING` and every feel number one of `FEEL_TUNING`. The one structural constant left outside is the planner's 15 committed points, a 5 by 3 grid.
4. **The sim does not know about the bend.** 1e6 DEMO steps on `noBendWorld`, and a text gate.
5. **Feel is cosmetic.** `createFeel` takes nothing, runs on a frozen state, stays in range and reaches its caps under floods, and the seven fields are exactly neutral under reduced motion.
6. **Events can be trusted.** One payload per kind, tested. Each item fires at most once, at the plane, and that test can fail: its control shows the plan's first arithmetic failing. A flooded buffer changes no rule.

**Gaps and what was not verified.**

- A22, `npm run check`: not yet run, because the batch's rule forbids it until T01 to T09 finish. T02 is not finished in the sense of `Agents.md` until the whole repo is green together.
- Autopilot quality on T01's real world. T10 runs it with `measureAutopilot`. All numbers here are on synthetic worlds. The near-straight holds before gates, described under A9, can only be judged in motion, and the remedies are in section 5.
- The look in motion on screen: nothing here draws a frame.
- Whether a fast car that is only sometimes solid reads fairly (section 10): 60% of phases at 40 u/s wrap out of reach. A playtest or T11 decides.
- `SIM_BENCH` was measured beside sibling executors, so it is an upper bound on this machine, not a clean number. Its p99 of 0.17 to 0.24 ms leaves a margin of only 2 to 3 times against §9.2's 0.5 ms, so a device 5 times slower would breach it. Phone cost is unmeasured, and §14 risk 13 (HC2) is a live risk, not one that would fit anyway.
- The allocation gates ran under Vitest's module transform on Node 24.14.1's V8. Only T09's run on the real build establishes section 9.2's budget, so this is narrower, as `Agents.md` requires saying.
- `GOLDEN` holds for this engine only (section 5.1). No other browser engine was run.
- A15's test-only gate reads other tasks' files under `src/`. A future file that imports `createSimInternal`, `SimProbe` or `sim/sim` fails T02's `check:task`, by design: that is the V1 verifier's condition. Nothing under `src/` does today [O]. It reads text only, so it cannot see a name built at run time.
- HC1 (fun, section 14 risk 3) and HC2 (phone step cost, section 14 risk 13) are open human checks, for T11's pack.

**V1 repair, 2026-11-05.** The verifier passed T02 with no blocking defect and four low ones assigned to T02, all fixed. A4's traffic reading and the `SimProbe` condition each have a Decision log entry, and section 4 no longer says every car is caught. Section 5 prints the built crossing, beat lock, hit recovery, grade ratio and feel order and easing. Three tests that did not show what they named now do: the beat-gate test (M1 caught), the idle `BOOST_OFF` tick (M19 caught) and a NaN through tuning landing on the floor (M2b caught). The bench margin is restated. All 14 rulings are logged with the verifier named. A new structure gate holds `createSimInternal` and `SimProbe` test-only. The fifth defect, the demo's silent fence clip, is T10's and is listed in DI-66.

**V2 repair, 2026-11-05.** V2's one low defect is fixed: A4's beat-grid rows assert the exact gate count per row, so a run that loses its tail now fails, and the count change has a Decision log entry. No production code changed. A22 is still open, as above.

**D-001 repair, 2026-11-06.** Reduced motion set before the sim's first step now applies from that step, as DI-75 rules: a sim created with it on reads 48 u/s with `stepDist` 0.4 in its start state and on every step, where it read 79.625 at step 1 and reached 48 only after 120. A toggle after the first step still eases. T10's regression `tests/unit/app/defects/D-001.test.ts` went from exit 1 to exit 0, and its browser row A21 read boot speed 48 where it read 69.125. T02's six new A2 rows failed before the fix where they should, two at-load rows on `expected 80 to be 48`, and pass after it. Their control, and the mutations MD1 to MD3, show the rows can see an ease at load, a snap mid-run, and a start state left at 80. `check:task T02` passed with 249 tests. `GOLDEN` did not change. One line of production logic changed, in `setReducedMotion`, which is not on the per-step path.

**VI repair, 2026-11-06.** DI-94 is fixed. Leaving `SIGNAL_LOST` is no longer player input. The exit keeps the last real input's tick, which counts a `human` frame sent during the loss. With no input for `IDLE_TIMEOUT_S`, the exit goes to idle autopilot with rules frozen. Before the fix, a run with nobody at the controls cascaded: in the sim, with no harness, one input-free feed lost all shields 7 times and first went idle at tick 9918 with a score of 6800. It now goes idle at 1362 with 250. DI-94's invariant needed a second change, because a loss forced from idle could still earn a `GRADE` bonus. `SIGNAL_LOST` now grades only when it came from live play, which leaves every loss a player can cause unchanged. That change goes beyond DI-94's text and is logged for the T00 owner. Four new rows (three in A3, one in A6) and three 1e6-step idle fuzz rows failed on the old code and pass now. Mutations MX1 to MX4 show each part can be seen, and `check:task T02` passed with 256 tests. `GOLDEN` did not change. **DI-92 is not done.** The HUD takes the objective target from `v.zone`, not from `SimState`, so a scaled launch-sector target would never reach the screen. That is the stop condition this repair was given. CCR-T02-3 lays out the options, and the plan is `blocked` until the T00 owner rules.

Not verified by the VI repair: the whole-repo `npm run check` (A22, the T00 owner's); T10's browser rows that cross `SIGNAL_LOST` (not run; argued unaffected in Progress); whether the cascade happens on T01's real world or in a browser, since the probe ran on T02's gauntlet; and the bench under quiet load, since only `check:task`'s pass of A14 ran (CPU 17% at its start).

Not verified by this repair: the whole-repo `npm run check` (A22, the T00 owner's, DI-64); T10's full `test:browser`, of which only A19's and A21's reduced rows were run; how reduced motion at load looks in motion on a screen, beyond one still; and the bench under quiet conditions, since both bench runs shared the machine with siblings (16% and 66% load at start).

**DI-97 repair, 2026-11-06.** DI-97 replaces DI-92 and answers CCR-T02-3, which is closed. The sector a run is launched in is now graded, against the zone's full target, the same number the HUD shows, with progress counted from the launch. A player who launches at the start of a sector and completes its objective gets that sector's grade (12 of 12, S, +5000). A late launch gets a lower grade, still with a bonus: A, B, C and C at 9, 6, 3 and 1 of 12. `warpTo` still leaves its sector ungraded, and so does CRUISE. The `lossLive` rule from the VI repair is ratified by DI-97, unchanged. One function changed, `launchSector` (was `clearProgress`), which sets eligibility true; leaving it unset, the literal reading, grades nothing (MG2). Six new A6 rows; four existing rows moved to the new rule with their old checks kept (Decision log). All of them failed on the old rule except the warp guard row, which both rules pass and MG3 fails; all pass now, and MG1 to MG4 show each part can fail. `check:task T02` passed with 262 tests. `GOLDEN` is unchanged because its launch sector ends in CRUISE (probe), and the only FUZZ line to move is the poison idle row's score at the first idle, +5000.

Not verified by the DI-97 repair: the whole-repo `npm run check`, `test:browser` and `test:software` (A22, the T00 owner's, run next); how a launch-sector grade banner looks in the browser, since no browser row was run (T08's banner renders any `GRADE` event, `src/ui/overlays.ts:73`, so nothing launch-specific is expected [I]); autopilot and FUZZ behaviour on T01's real world; and a clean bench number, since `check:task` printed none.

**Lessons.**

- A test's name is a claim, and a self-check inside the test (here, "within 1e-9 u of the plane") turns the claim into an assertion. Without one, the beat-gate test passed for a reason other than the one it named.
- A rehearsal's numbers carried over closely, but its arithmetic did not all survive. Two faults only appeared with real project code: the crossing double count, which the rehearsal's own world could not show, and the context-slot boxing, which its literal numbers avoided.
- Attribute allocation before theorising. The first hypothesis was wrong, and the sampling heap profiler plus one experiment found the cause in minutes.
- Any test that asserts a rate, like the 40% of cars, is worth deriving by arithmetic first: the wrong threshold I first wrote there was my guess, and the code was right.

## 14. Revision notes

- 2026-11-05T06:19Z Initial draft.
- 2026-11-05T06:30Z Reconciled by the author, before approval, with the T01, T05, T06 and T08 drafts that appeared meanwhile: fence rule, CHAIN meaning, checkpoint gate, event `x, y` and `value`, `pause` scope, traffic speed, `SHIP_FORWARD` naming. Four of T02's own requests withdrawn in favour of theirs.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: C-01, C-02, C-04, C-08, C-09, C-12, C-13, C-14, C-15, C-16, C-17, C-27, S-07, S-11, S-14, S-15, DI-21, DI-23, DI-26, DI-28.
- 2026-11-05T15:30Z Executor amendments, each with a Decision log entry: crossing distances from one expression over two travels; beat lock against `tick - 1`; grade ratio form; hit recovery counted from the first slowed step; feel's update order and easing toward the mean of two goals; A16's scale floor. No threshold changed. [Corrected by the V1 repair, 2026-11-05T20:30Z: that last sentence was wrong. Two expected outputs did change, A4's traffic row from "crosses once" to "at most once, 150 to 170 of 400", and A16's comparison scale. The fuzz timeout and A7's relock start also moved. Each now has a Decision log entry with the V1 verifier's agreement.]
- 2026-11-05T15:35Z Executor close-out: Progress, Outcomes, status done. A22 stays open until the batch ends.
- 2026-11-05T19:35Z Independent verifier V1-T02 review. Verdict: passed, no blocking defect. `check:task T02` exit 0 with 235 tests, all 15 fuzz lines and A8 to A20 reproduced, and 25 of 28 single mutations caught, each restored and hash-checked; low findings are in the verifier's report. Rulings: the crossing from previous and current travel is accepted, because the plan's `rel + stepDist` fired items twice at 48 and 80 u/s under mutation. The beat lock against `tick - 1` is accepted, because the `tick` form trims 0.667 u/s at an undisturbed start. The grade ratio `target <= 0 ? 1 : progress / target` is accepted, because the plan's form grades a NaN target S. Hit recovery from the first slowed step is accepted, because the exact 52 and A11's stop control depend on it. The feel order of decay, events, output is accepted: the event frame shows full height at any `dt`, and every cap is reached. Easing toward the mean of the last two goals is accepted: the worst 1/30 against 1/240 difference is 0.05% of any field's range. The fuzz timeout of 600 s is accepted, since a limit can only fail a test. The optional `SimProbe` is accepted on condition that production code uses only `createSim`. A16's 2% floor is accepted: it is an absolute tolerance of 0.1% of range, needed only at zero crossings. A rules-off hit that emits nothing is accepted. A4's traffic row, read as "at most once, with 150 to 170 of 400 crossing", is accepted on condition that a Decision log entry is added and section 4's "every car is caught" is corrected.
- 2026-11-05T20:22Z V1 repair by the T02 executor, to fix the verifier's four low T02 defects and meet its two conditions. Section 4: the traffic seam row is corrected, and `SimProbe` is test-only, with production code limited to `createSim`. Section 5: M1's hit recovery and beat lock, M2's crossing, M3's grade ratio and M6's order and easing now print the built forms, and M5's bench margin is restated as 2 to 3 times with the phone inference dropped. Section 7: A2, A3, A4, A15 and A23 name the new checks, and A4's traffic expected output is "at most once". Sections 9 to 11 and 13 updated, with 14 ruling rows that name the V1 verifier and 3 repair decisions. The revision note at 15:30Z, "No threshold changed", is marked wrong. The tests changed are named in Progress. No threshold was loosened, and no production logic changed. DI-58 to DI-66 were read, and none names T02.
- 2026-11-05T21:22Z Second independent verifier V2-T02 review of the V1 repair. Verdict: passed, no blocking defect, one low defect for T02. `check:task T02` exit 0 with 243 tests; the full verbose run reproduced all 15 FUZZ lines, A8 to A20 and GOLDEN 1399575935 exactly; 9 single mutations were run, each restored and hash-checked; both traces were re-rendered (same bytes) and viewed. Rulings: the beat-gate test replaced by beat-grid rows and an offset sweep is accepted, because M1 fails the sweep at offset 1 at 80 and 48 u/s, M3 fails the lock-on row, a 0.1 u test-side offset fails all three rows, and a lost-item mutant (`rel < 0`) fails the sweep with "fired 0". The repairer's claim that `BEAT_LOCK_MAX: 0` would not have caught M1 is confirmed: the old test with it, with and without demo boost and autopilot, passed under M1 with 0 duplicates in 141 and 125 firings. The beat-grid count bound lowered from more than 100 to more than 90, with the run lengthened from 300 to 400 s, is accepted on condition that a Decision log entry records it: the 48 u/s row has exactly 100 gates [arithmetic], so the old bound could not pass, and the 3-chunk spacing check still catches any gate lost inside the run. A2's two NaN-to-floor rows are accepted, because M2b fails both. A3's idle `BOOST_OFF` tick is accepted, because M19 fails it with "expected 1211 to be 1210". A15's test-only gate is accepted, because MR and MW fail it; its fixture `.ts` files under `test-results/` lie outside the eslint, tsc, vitest and glsl scopes. A23's extension to `structure-fixture/` is accepted. The bench restatement is accepted, since the 0.5 ms gate is unchanged. DI-67 to DI-69 were also read, and none names T02. V1's rulings stand, since the repair broke none of their conditions.
- 2026-11-05T21:55Z V2 repair by the T02 executor, for V2's one low defect. A4's beat-grid rows assert exact counts, 166, 166 and 100, in place of `> 90`; section 7's A4 row says so, and a Decision log entry records this and the V1 repair's unlogged 300 to 400 s and `> 100` to `> 90` changes. A tail-loss mutant passed the old bound and fails the new one. Only `collision.test.ts` and this plan changed. DI-70 read; it does not name T02.
- 2026-11-06T01:32Z Reopened for T10's defect D-001 (register in `plans/T10-integrate.md` section 10, evidence `test-results/T10-defects/D-001/`), under the T00 owner's ruling DI-75 in `plans/RECONCILIATION.md`: reduced motion set before the sim's first step applies from that step, start speed `SPEED_CRUISE * REDUCED_MOTION_SCALE` with no ease; a toggle after the first step keeps the ease. Status set to in-progress. DI-74 and DI-76 to DI-81 read; only DI-80 names T02, as a seam party, and its change is T10's (`app/loop.ts`).
- 2026-11-06T02:01Z D-001 repair by the T02 executor, per DI-75. Section 4: the T10 loop seam row states the at-load rule. Section 5 M1: `setReducedMotion` before and after the first step. Section 7: A2 names six new rows and their control. Sections 9, 10, 11 and 13 updated, with one Decision log entry (a design and acceptance change, from DI-75). Changed: `src/sim/sim.ts` (`setReducedMotion`), `tests/unit/sim/motion.test.ts` (new rows), `tests/unit/sim/collision.test.ts` (one comment). No threshold moved, and no T10 or sibling file was edited. Status set to done; A22 stays the T00 owner's.
- 2026-11-06T10:18Z Reopened by the integrated review (VI-game, VI-r1, VI-gates; verdicts in `scratchpad/VI.json`, ledger DI-90 to DI-96 in `plans/RECONCILIATION.md`) for two items in T02's paths: DI-94 (VI-r1 defect 5: the `SIGNAL_LOST` exit at `src/sim/rules.ts:200-206` sets `lastHumanTick` to the current tick, re-arming 10 s of rules-on PLAY with nobody at the controls) and DI-92 (VI-game defect 2: grade the launch sector against a target scaled by the fraction still ahead, provided the HUD shows that target through existing `SimState` fields). Status set to in-progress.
- 2026-11-06T10:49Z VI repair by the T02 executor. DI-94: `src/sim/rules.ts` (`updateModes` exit rule, `lossLive` in `SimPrivate` and `enterSignalLost`) and `src/sim/sim.ts` (`closeSector` grades a `SIGNAL_LOST` only with `lossLive`). Tests: `runIdleFuzz` in `fixtures/drive.ts`, three idle fuzz rows in `fuzz.test.ts`, three A3 rows in `modes.test.ts`, one A6 row in `objectives.test.ts`. Plan: section 4's commands paragraph, section 5's M3 grading and M5 fuzz text, and section 7's A3, A6 and A10, which are additions with no threshold moved; sections 9 to 13 updated, with three Decision log entries and CCR-T02-3. DI-92 was stopped at its precondition, since the HUD's target is `v.zone`'s, and no T02 code changed for it. No sibling file was edited. Status set to `blocked` on CCR-T02-3, not `done`: DI-94 is complete, and DI-92 waits on the T00 owner (Agents.md, Deviations).
- 2026-11-06T12:09Z Unblocked by the T00 owner's ruling DI-97 in `plans/RECONCILIATION.md`, which replaces DI-92: the launch sector is graded against the zone's full target, the one the HUD shows, with no contract change, and T02's `lossLive` rule is ratified. That answers CCR-T02-3. Status set to in-progress. DI-90 to DI-99 read; DI-97 names T02, and DI-92 and DI-94 are the entries it settles.
- 2026-11-06T12:28Z DI-97 repair by the T02 executor. Code: `src/sim/objectives.ts` (`clearProgress` renamed `launchSector`, `gradeEligible = true`) and `src/sim/rules.ts` (its import and call at `launch`). Tests: a DI-97 block of six rows in `objectives.test.ts`; three existing A6 rows there and A5's SECTOR payload row in `rules.test.ts` moved to the new rule, an expected-output change recorded in the Decision log, with no threshold moved. Plan: section 4's commands paragraph and T08 HUD seam row, section 5 M3's launch paragraph, section 7's A6, CCR-T02-3 closed in section 12, sections 9, 10, 11 and 13 updated, with four Decision log entries (DI-97 adopted, `lossLive` ratified, the four moved rows, `GOLDEN` unchanged and why). No sibling file was edited. Status set to done; A22 stays the T00 owner's.
- 2026-11-11T16:00Z Reopened and closed in one operator session for the boost lock (double tap locks boost; overdrive 0, a landed hit or the next press unlock). Code: `src/sim/tuning.ts`, `src/sim/rules.ts`, `src/sim/sim.ts`. Tests: ten rows in `rules.test.ts`. Plan: section 9 Progress, two section 11 entries. No existing test changed its expected output, and no threshold moved. architecture §7.1's Boost row was updated by the operator's ratification; `plans/RECONCILIATION.md` was not edited and has no DI entry for this change.
