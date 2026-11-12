# Plan index

One plan per task in [architecture.md](../architecture.md) §12, written and approved before that task's first line of code. The format, lifecycle and deviation rules are in [Agents.md](../Agents.md) under "Plan files".

T00 owns this file. Plans are not moved or renamed, because moving them breaks links. New work gets the next T number from the T00 owner before its plan is written.

[`RECONCILIATION.md`](RECONCILIATION.md) is the T00 owner's ledger of decisions. It is not a plan.

**Status is not recorded here.** It lives only in each plan's own frontmatter, so this index cannot go stale. To see all of them, from `Midnight_Vector/` (formerly `terrain/`):

```powershell
Select-String -Path plans\T*.md -Pattern '^status:' | ForEach-Object { "$($_.Filename)  $($_.Line)" }
```

| Id | Scope | Plan file | Depends on |
|---|---|---|---|
| T00 | Scaffold, contracts, core, fakes, browser discovery, boundary gate, GLSL grep gate, plan overlap check | [plans/T00-foundation.md](T00-foundation.md) | none |
| T01 | World: noise, height, zones, palettes, biomes, scatter, keep-out, grounding, items | [plans/T01-world.md](T01-world.md) | T00 |
| T02 | Sim rules, collision, autopilot, objectives, feel | [plans/T02-sim-feel.md](T02-sim-feel.md) | T00 |
| T03 | Terrain: clipmap, atlas, floor and mountain shading, pulses, sun column | [plans/T03-terrain.md](T03-terrain.md) | T00 |
| T04 | Sky: gradient, disc modes, stars, nebula, events | [plans/T04-sky.md](T04-sky.md) | T00 |
| T05 | Props: builders, neon material, rings, mirror, 20 archetypes, 6 items, ship | [plans/T05-props.md](T05-props.md) | T00 |
| T06 | Post and quality: composer, variants, Crt, speed lines, tier table, governor | [plans/T06-post-quality.md](T06-post-quality.md) | T00 |
| T07 | Audio: graph, pure composer, scheduler, ducking | [plans/T07-audio.md](T07-audio.md) | T00 |
| T08 | UI and input: HUD, title, cruise menu, overlays, fatal text, controls, bests, the reduced-motion setting | [plans/T08-ui-input.md](T08-ui-input.md) | T00 |
| T09 | Forever and perf harness: `window.__mv`, test modes, metric helpers, gate suites | [plans/T09-harness.md](T09-harness.md) | T00 |
| T10 | Integration: composition root, loop, lifecycle, boot, fallback page, e2e | [plans/T10-integrate.md](T10-integrate.md) | T01 to T09 |
| T11 | Art pass: tune across modules, all gates green, operator review | [plans/T11-art-pass.md](T11-art-pass.md) | T10 |
| T12 | Public release: README, licence, notices, contributing guide, screenshots, GitHub Pages workflow | [plans/T12-release.md](T12-release.md) | T10 |

## Order

```
T00 (serial, first)
 |-> T01 T02 T03 T04 T05 T06 T07 T08 T09   (fully parallel, against fakes)
      |-> T10 (serial)
           |-> T11 (serial; nothing else writes while it runs)
           |-> T12 (release files and deploy only; no path in T11's window)
```

## Before spawning executors

1. Every plan is written and `status: approved` by a reviewer who did not author it.
2. Contract change requests are reconciled in [`plans/RECONCILIATION.md`](RECONCILIATION.md) and already in §8.
3. Once T00 has landed, `npm run plans:check` exits 0. It checks that each plan's `owns` equals its §12 row, that the template headings are in order, and that no path matches two plans, apart from the two legal overlaps (`src/contracts/glsl/hero.glsl` after hand-off to T04, and T11's serial window).

While a batch runs, each executor uses `npm run check:task -- T##`, its own port `51NN` and its own `--output=test-results/T##`. The whole-repo `npm run check` happens after the batch.

## Changing a contract

File the request in section 12 of your own plan, with the exact additive diff, and set your plan to `blocked`. The T00 owner applies it by amending T00's plan and §8, and records it in the ledger. Only T11's numeric retune may be non-additive (§8). Never widen a type locally.
