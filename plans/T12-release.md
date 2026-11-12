---
id: T12-release
title: Public release - README, MIT licence, notices, GitHub Pages
status: in-progress
owner: T12 executor, for the operator
depends_on: [T10]
owns: [README.md, LICENSE, THIRD-PARTY-NOTICES.md, CONTRIBUTING.md, docs/screenshots/**, .github/**, plans/T12-release.md]
reads: [architecture.md, Agents.md, plans/**, package.json, vite.config.ts, src/ui/copy.ts, src/input/keys.ts, src/sim/rules.ts]
updated: 2026-11-12T18:20Z
---

## 1. Purpose

The operator decided on 2026-11-12 to open-source Midnight Vector under the MIT licence and to publish the game on GitHub Pages from this repository. After T12:

1. Anyone can open `https://highsierralabs.github.io/Midnight_Vector/` and play the game, with no server of the operator's running.
2. `https://github.com/highsierralabs/Midnight_Vector` is public. Its front page shows a README with the play link, four screenshots, how to play, the prompt the build started from, and how to run it locally.
3. The repository states its licence (MIT, copyright 2026 Kris E. Granholm) and carries the licence texts of the two libraries the built game contains.
4. Every push to `main` rebuilds and redeploys the game. Nothing automated ever commits.
5. The tracked files no longer contain the operator's Windows user name or tailnet address.
6. `main` cannot be force-pushed or deleted on GitHub, and secret scanning and dependency alerts are on.

## 2. Context and orientation

The working directory for every command is the repository root, `Midnight_Vector/`. `§n` means a section of `architecture.md`.

**State before T12** [O: read on 2026-11-12, `main` at `6afd289`]:

- The repository is private, on GitHub's free plan. GitHub refused a branch-protection read with "Upgrade to GitHub Pro or make this repository public", and on that plan Pages serves only public repositories.
- History is 5 commits, all by the repo-local identity (the operator's GitHub noreply address). There is one branch, `main`, the same commit locally and on `origin`; no tags, stashes or extra worktrees. No path was ever committed and later removed.
- A fresh clone of `6afd289` passes `npm ci`, `npm run build`, `npm run check` (119 files, 1990 passed, 2 skipped) and `npm run plans:check` (12 plans, 0 problems). `npm audit --omit=dev` reports 0 vulnerabilities; the full audit reports the 9 moderate dev-only advisories §2 already names.
- No secret was found in the tracked files or in any commit's diff (patterns: GitHub, OpenAI and AWS key shapes, private-key headers, `key|secret|token|password` assignments).
- `vite.config.ts` sets `base: './'`, and `dist/index.html` references `./assets/...`, so the build runs from any subpath. T00's build proof already ran a bundle from a nested path.
- The lockfile has exactly two packages that are not dev-only: `three` 0.187.0 (MIT) and `postprocessing` 6.39.6 (Zlib). The built bundle carries no licence banner for either.
- There is no `README.md`, `LICENSE` or `.github/`. `package.json` has no `license` field.
- T11 is `blocked`, waiting for the operator's verdict, as §12 says it must. T12 changes no game code, shader, test or tuning value, so it does not write inside T11's window.

**What would become public with the repository** [O]. The operator reviewed this list on 2026-11-12 and chose to replace items 1 and 2 in the current files and leave history alone:

1. The operator's Windows user name, in session scratch paths: 10 lines in `.claude/workflows/terrain-design-docs.js`, `plans/T01-world.md`, `plans/T08-ui-input.md` and `plans/T11-art-pass.md`.
2. The operator's tailnet address: 6 lines in `plans/RECONCILIATION.md`, `plans/T08-ui-input.md` and `plans/T11-art-pass.md`. It is reachable only from inside the operator's tailnet.
3. Device and hardware names (two handheld devices, the GPU and CPU), and the operator's review comments quoted verbatim.
4. `.claude/workflows/terrain-design-docs.js`, which holds the prompt the build started from.

Items 3 and 4 stay as they are. All four also stay in the 5 existing commits (section 13, residuals).

**Reference.** The operator named their git-governance procedure for another, private repository as the reference for this release. It does not bind this repository. What T12 takes from it is listed in section 11 (R-1).

Terms:

- **Pages:** GitHub Pages, static hosting at `https://<user>.github.io/<repo>/`.
- **Gate:** a point where the executor stops and the operator decides. T12 has three (section 5).
- **Residual:** something a step does not undo, stated so nobody assumes it was.

## 3. Scope

**Owned** (new files): `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `CONTRIBUTING.md`, `docs/screenshots/**`, `.github/**`, `plans/T12-release.md`.

**Changes outside `owns`, each through its owner:**

| Path | Owner | Change |
|---|---|---|
| `architecture.md` | none; the T00 owner as the operator's delegate, recorded in the ledger | §12 gains the T12 row and one line in the graph |
| `Agents.md` | the same | Git section: drop "(private)", and say that a push to `main` deploys to Pages |
| `plans/README.md` | T00 | Index row and order line for T12 |
| `package.json`, `package-lock.json` | T00, by amendment PR | `description`, `license`, `homepage`, `repository`; the lockfile's root entry gains `"license": "MIT"`. `"private": true` stays: it only stops an accidental `npm publish`. No dependency changes |
| `tests/boundaries/gates.test.ts` | T00, by amendment PR | Four lines: the pinned number of tasks, 12 to 13 (added after ratification, with the operator's agreement; section 14) |
| `plans/T01-world.md`, `plans/T08-ui-input.md`, `plans/T11-art-pass.md` | each plan's owner, for the operator | The user name becomes `<user>` and the tailnet address `<tailnet-ip>`; a revision note; `updated` bumped |
| `plans/RECONCILIATION.md` | T00 owner | The tailnet address becomes `<tailnet-ip>`; one ledger entry for everything in this table |
| `.claude/workflows/terrain-design-docs.js` | none; ledger | The user name becomes `<user>` in one string constant. The workflow is a record of a finished run and is not run again |

**Outside the repository:** GitHub settings (visibility, Pages, description, topics, branch protection, security features), and afterwards the workspace notes that still call the repository private.

**Non-goals:**

- No change to game code, shaders, contracts or tuning, and none to tests beyond the four lines of `tests/boundaries/gates.test.ts` named above.
- No history rewrite and no force-push. The 5 existing commits stay as they are.
- No test job in GitHub Actions. The unit tests have only run on Windows, and the browser suites need a GPU and per-machine references. A CI job is a later plan.
- No `CITATION.cff`, `SECURITY.md`, code of conduct, issue templates, release tags or custom domain.
- No statement in the README about how the game was built (operator, 2026-11-12).
- The tailnet server on the operator's PC is untouched. It stays tailnet-only.

## 4. Interfaces

Consumed: `npm run build` (T00's script, T10's `index.html`), which writes `dist/`. `base: './'` in `vite.config.ts`.

Provided: the files below. The operator approved the README text in session on 2026-11-12.

### 4.1 `README.md`

````markdown
# Midnight Vector

An endless 80s synthwave arcade game that runs in your browser. You fly a low hover-delta down a neon valley toward a banded sun that never moves on screen, while mountains, palms, arcologies, chrome orbs and saucers stream past. The road never stops: there is no game over, and no pause that freezes the world.

**Play it:** https://highsierralabs.github.io/Midnight_Vector/

![The Midnight Vector title screen](docs/screenshots/title.png)

| Crystal Desert | Cyber Canyon | Olympus |
|---|---|---|
| ![A run through the Crystal Desert biome](docs/screenshots/crystal-desert.png) | ![A run through the Cyber Canyon biome](docs/screenshots/cyber-canyon.png) | ![A run through the Olympus biome](docs/screenshots/olympus.png) |

## How to play

Leave it alone and an autopilot flies under the title screen, so the page works as a screensaver. Press LAUNCH, or any key, to start a run and turn the sound on. LAUNCH - NO HUD starts the same run with the display hidden.

- Collect shards and thread gates on the beat to raise the SYNC multiplier.
- Graze hazards for bonus score, and spend overdrive on boost.
- A hit costs a shield, half your SYNC and some speed. It never ends the run. At zero shields the signal drops for three seconds, the shields refill, and you keep your score.
- Each new sector changes the palette, the biome, the objective and the music key.

| Device | Controls |
|---|---|
| Keyboard | WASD or arrow keys steer, Space boosts, Esc or P opens the cruise menu, M mutes |
| Mouse | The ship follows the pointer, and the left button boosts |
| Touch | Drag with one finger to steer. A second finger or the on-screen button boosts, and the II button opens the cruise menu |

Hold to boost, or press boost twice quickly to lock it on.

The cruise menu has the music and effects volumes, mute, quality, fullscreen, hide HUD and reduced motion. It is not a pause: the rules freeze and the hazards turn to ghosts, but the world keeps moving behind it.

Your best score and furthest distance are kept in your browser's local storage. Nothing is sent anywhere.

## The prompt

The build started from this prompt:

> Make me a 3D website that's a kind of video game, with an infinite procedural retro 80's futuristic synthwave terrain and a camera that keeps moving forward through it forever. The terrain should be full of stuff and objects, look beautiful with shaders and all, be stylish and scroll on forever.
>
> First, write an architecture.md that outlines the planned app design, the tech stack you will use, the programming language, listing the most important libraries and frameworks. Then write an Agents.md with proven best-practices for the tech you will use.
>
> Add a section about the use of plan files in Agents.md, according to common best practices.
>
> Split the prompt up into different, largely independent tasks. Create plans for each individual task before implementing them.

## Requirements

A browser with JavaScript and WebGL2 with floating-point render targets. Where those are missing, the page shows a still poster and says so. Picture quality adapts to the device, and you can set it yourself in the cruise menu.

## What is in it

- TypeScript, [three.js](https://threejs.org) and [postprocessing](https://github.com/pmndrs/postprocessing), built with [Vite](https://vite.dev). Those two libraries are the only runtime dependencies.
- No asset files. The terrain, sky, props, ship and screen effects are custom GLSL, and the music and sound effects are synthesized with Web Audio.
- The world is generated from a seed. No absolute world coordinate ever reaches a GLSL float, so the picture stays correct however far you travel.

The design is described in [architecture.md](architecture.md).

## Run it locally

You need Node `>=24.14.1 <25`.

```sh
npm ci
npm run dev       # development server
npm run build     # static site in dist/
npm run preview   # serve dist/
npm run check     # typecheck, lint, unit tests and the GLSL gate
```

The browser test suites (`npm run test:smoke` and the other `test:*` scripts) use Playwright with a locally cached Chromium. Their reference images are made per machine and are not in the repository, so a fresh clone has no visual baselines.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE), copyright (c) 2026 Kris E. Granholm. The built game bundles three.js (MIT) and postprocessing (Zlib); see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
````

Where each claim comes from [O: read in the source on 2026-11-12]: the keys in `src/input/keys.ts` and `src/ui/index.ts`; LAUNCH, LAUNCH - NO HUD, the legends and the cruise menu rows in `src/ui/copy.ts` and `src/ui/dom.ts`; launch by any key in `src/ui/index.ts`; the boost lock in `src/sim/rules.ts`; three seconds of signal loss in `src/sim/tuning.ts`; local storage in `src/ui/index.ts`; no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` anywhere under `src/`. The prompt is copied from `.claude/workflows/terrain-design-docs.js`, which records it as the operator's request, verbatim. The remaining sentences restate §1, §2 and §7 and were not tested for this plan.

### 4.2 `docs/screenshots/`

Four PNG files, 1600 x 900, 2.1 to 2.5 MB each: `title.png`, `crystal-desert.png`, `cyber-canyon.png`, `olympus.png`. All were captured on 2026-11-12 from a production build of `6afd289` served by `vite preview`, in the cached headless Chromium with the `gpu` project's flags, on the operator's GPU [O].

- `title.png`: the plain page, no query, six seconds after boot, DEMO mode.
- The other three: `/?harness&period=0&tier=4`, launched by a real mouse click on `[data-mv="launch"]`, then `warp` to the first zone of the biome (`findBiomeChunk`), then real frames through `stepFrames` with the mouse moved between batches. Each was in PLAY mode with the HUD on when taken. The quality is HIGH (tier 4), forced.

The capture script was a scratch file and is not part of the repository.

### 4.3 `LICENSE`

The MIT License text as published by the Open Source Initiative, with the line `Copyright (c) 2026 Kris E. Granholm` (operator, 2026-11-12).

### 4.4 `THIRD-PARTY-NOTICES.md`

A short heading per library, its version and homepage, then the library's own licence file copied byte for byte from `node_modules/three/LICENSE` and `node_modules/postprocessing/LICENSE.md` (the file names are to be confirmed on disk at M2).

### 4.5 `CONTRIBUTING.md`

```markdown
# Contributing

Thanks for your interest in Midnight Vector.

## Bugs and ideas

Open an issue. For a bug, say what you did, what you saw, and your browser, device and operating system. If the game showed a message, quote it. A screenshot helps.

## Code changes

Please open an issue before you write code. Every change in this repository goes through a plan: each path belongs to one task's plan in `plans/`, and a change is recorded there with its checks. `Agents.md` describes the rules. A pull request that was not discussed first may be closed without review.

If a change is agreed:

- Run `npm run check` and make sure it exits 0.
- Keep the runtime dependencies at the two the game has. Do not add packages or change pinned versions.
- Do not edit `src/contracts/**`. Ask for a contract change in the issue.

## License

By contributing you agree that your contribution is licensed under the MIT License, the same as the project.
```

### 4.6 `.github/workflows/pages.yml`

```yaml
name: Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24.14.1
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: cp LICENSE THIRD-PARTY-NOTICES.md dist/
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: dist

  deploy:
    needs: build
    if: ${{ !github.event.repository.private }}
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

The four tags and their commits are each action's latest release, read from the GitHub API on 2026-11-12 [O]. The input names (`node-version`, `cache`, `path`) are from memory of earlier major versions [M]; M2 reads each action's `action.yml` at the pinned commit before the file is written. The workflow builds and uploads; it has `contents: read` and cannot commit.

## 5. Plan of work

Three gates. **Gate 0** is this plan's approval. **Gate 1** is the operator's word to commit and push; the repository is still private. **Gate 2** is the operator's word to make it public. Publication cannot be taken back in practice: a public repository can be cloned and cached within minutes.

**M0. Register T12.** The §12 row and graph line, the `plans/README.md` row, T00's amendment PR and the ledger entry. Proof: `npm run plans:check` reports 13 plans and 0 problems.

**M1. Screenshots.** Copy the four PNGs into `docs/screenshots/`. Proof: four files, each viewed, each 1600 x 900.

**M2. Release files.** Write `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `CONTRIBUTING.md` and `.github/workflows/pages.yml` from section 4; amend `package.json` and the lockfile's root entry; edit the Git section of `Agents.md`. Proof: A1 to A5.

**M3. Replace the two identifiers.** In the seven files of section 3, with a revision note in each plan touched. Proof: A6 finds 0 lines, and `git diff --stat` shows only those files with equal insertions and deletions apart from the notes.

**M4. Stop at Gate 1.** Report what changed and what ran. On the operator's word, commit (three commits, section 6) and push. Then, still private: A7 (a fresh clone from `origin`) and A8 (the Actions build job passes on Linux and the deploy job is skipped).

**M5. Stop at Gate 2.** Present: every ref on `origin`; the A7 and A8 results; the scan results; the residuals of section 13; and the exact commands of M6. Nothing in M6 runs before the operator's word.

**M6. Publish.** Make the repository public. Enable Pages with the workflow as its source. Run the workflow. Set the description, homepage and topics. Protect `main`. Turn on secret scanning, push protection, dependency alerts and private vulnerability reporting. Proof: A9 to A12.

**M7. Close.** Paste the evidence here, write Outcomes with the human checks, set `done`. Tell the operator which notes outside the repository still call it private. The closing edit to this plan is one more commit, made when the operator asks.

## 6. Concrete steps

PowerShell 5.1, from the repository root. T12's port is 5112.

M0 to M3 are file edits, then:

```powershell
npm run plans:check
npm run check
git status --short
git diff --stat
```

The identifier scan (A6). The patterns are split with a character class so that this plan does not match itself:

```powershell
git grep -I -n -E 'Users[\\/]+kg[r]an|100\.102\.246\.12[7]' -- .
```

Gate 1, on the operator's word. The messages are plain ASCII, with no attribution lines:

```powershell
git add plans/T12-release.md architecture.md plans/README.md plans/T00-foundation.md plans/RECONCILIATION.md tests/boundaries/gates.test.ts
git commit -m "T12 plan: public release, registered in section 12"
git add README.md LICENSE THIRD-PARTY-NOTICES.md CONTRIBUTING.md docs/screenshots .github package.json package-lock.json Agents.md
git commit -m "Public release files: README, MIT licence, notices, Pages workflow (T12)"
git add plans/T01-world.md plans/T08-ui-input.md plans/T11-art-pass.md .claude/workflows/terrain-design-docs.js
git commit -m "Replace a local user name and a tailnet address in plan records (T12)"
git push origin main
```

`plans/RECONCILIATION.md` is touched by both M0 and M3; its two changes go in the first commit together. The same holds for this plan's Progress.

After the push, still private:

```powershell
gh run list -R highsierralabs/Midnight_Vector --workflow pages.yml --limit 1
gh run watch -R highsierralabs/Midnight_Vector <run-id> --exit-status
git clone https://github.com/highsierralabs/Midnight_Vector.git <scratch>\origin-clone
# in the clone: npm ci; npm run build; npm run check; npm run plans:check; the A6 scan
git ls-remote origin
```

Gate 2, on the operator's word:

```powershell
gh repo edit highsierralabs/Midnight_Vector --visibility public --accept-visibility-change-consequences
gh api -X POST repos/highsierralabs/Midnight_Vector/pages -f build_type=workflow
gh workflow run pages.yml -R highsierralabs/Midnight_Vector --ref main
gh repo edit highsierralabs/Midnight_Vector --description "An endless 80s synthwave arcade game that runs in your browser." --homepage "https://highsierralabs.github.io/Midnight_Vector/" --add-topic game --add-topic webgl --add-topic threejs --add-topic glsl --add-topic synthwave --add-topic typescript --add-topic procedural-generation
gh api -X PUT repos/highsierralabs/Midnight_Vector/vulnerability-alerts
gh api -X PUT repos/highsierralabs/Midnight_Vector/private-vulnerability-reporting
```

Branch protection and the two secret-scanning switches go through `gh api` with a JSON body (`PUT .../branches/main/protection` with force pushes and deletions disallowed and no review or status-check requirement, so the operator can still push to `main`; `PATCH` on the repository with `security_and_analysis`). The exact bodies are written at M6 against the API's current schema [M] and pasted into Progress with what the API returned.

## 7. Validation and acceptance

| # | Command or action | Expected |
|---|---|---|
| A1 | `npm run plans:check` | 13 plans, 0 problems |
| A2 | `npm run check` | Exit 0, with the test counts unchanged from 119 files, 1990 passed, 2 skipped |
| A3 | Every relative link and image in `README.md` and `CONTRIBUTING.md` | Each target exists in the tree |
| A4 | `LICENSE` and the two notices | `LICENSE` holds the MIT text and the copyright line; each notice is byte-identical to the file in `node_modules/` |
| A5 | `npm run build`, then `git status --short` | Exit 0; no tracked file changed by the build |
| A6 | The identifier scan of section 6 | 0 lines. Before M3: 16 lines (fail-before) |
| A7 | A fresh clone from `origin`: `npm ci`, `npm run build`, `npm run check`, `npm run plans:check`, the A6 scan, `git ls-remote origin` | All exit 0; 0 lines; one ref, `main`, at the pushed commit |
| A8 | The Actions run for the push, while private | The `build` job passes on `ubuntu-latest`; the `deploy` job is skipped. This is the first build on Linux |
| A9 | After Gate 2: `gh api repos/highsierralabs/Midnight_Vector --jq .visibility`, the Pages API, the workflow run | `public`; `build_type` `workflow`; both jobs pass |
| A10 | `curl` on the Pages URL: `/`, both asset chunks named in its `index.html`, `/LICENSE`, `/THIRD-PARTY-NOTICES.md` | 200 for each |
| A11 | Playwright, `gpu` flags, on the live URL: wait for `data-mv-boot="running"`, click LAUNCH, screenshot | Mode goes from `demo` to `play`, 0 console errors, and the screenshot was viewed |
| A12 | Read the settings back through the API | The description, homepage and topics as set; force pushes and deletions disallowed on `main`; secret scanning, push protection, dependency alerts and private vulnerability reporting enabled; `license.spdx_id` is `MIT` |

`npm run check:task -- T12` is not an acceptance row. T12 owns no TypeScript, so that script reports its type and lint gates as vacuous and fails by design. The whole-repo `npm run check` is the gate (section 11, R-6).

Branch protection is verified by reading it back only. The direct test would be a force-push, which this repository never does.

**Human checks.**

- **HC1.** On the operator's phone, at the Pages URL: the game starts, the sound plays after LAUNCH, touch steers, and FULLSCREEN works.
- **HC2.** On a desktop browser, at the Pages URL: the same, with keyboard and mouse.
- **HC3.** The repository's front page on github.com: the README reads correctly and the four screenshots show.

## 8. Idempotence and recovery

- M0 to M3 change only the working tree. Until Gate 1, `git checkout -- <path>` restores a tracked file and deleting a new file removes it. The screenshots have copies in the session scratch folder.
- The identifier replacement is exact-string. Running it twice changes nothing the second time.
- After Gate 1 and before Gate 2, a mistake is fixed by a new commit. Nothing is amended after it is pushed, and nothing is force-pushed.
- If the push is refused because the stored git credential may not write workflow files, stop and tell the operator. Do not change the credential store.
- If A8's build fails on Linux, fix it in the owner's path by a new commit and run it again. Gate 2 waits.
- Gate 2 is the one step that cannot be undone. Making the repository private again afterwards would stop Pages and hide the source, but would not recall copies already taken.
- Each step of M6 after the visibility change is a setting that can be read back and set again.

## 9. Progress

- [x] 2026-11-12T17:55Z Audit of `6afd289` (section 2), the fresh-clone run, the four screenshots and the README text, all before this plan was written. The operator approved the README text and chose the screenshots' subjects in session. No tracked file was changed.
- [x] 2026-11-12T18:04Z Gate 0, before this stamp: the operator, verbatim, "Plan is ratified as written. Go." Status `approved`, then `in-progress`.
- [x] 2026-11-12T18:04Z M0 Register T12. `architecture.md` §12: the T12 row and one graph line. `plans/README.md`: the same row and line. T00's amendment PR and ledger entry DI-120 written. `npm run plans:check`: `13 plans, 3187 pattern pairs, 0 problems` (A1 passes).
- [x] 2026-11-12T18:04Z M1 Screenshots. Four files in `docs/screenshots/`, each 1600 x 900 by its PNG header: `title.png` 2,146,452 bytes, `crystal-desert.png` 2,222,990, `cyber-canyon.png` 2,453,814, `olympus.png` 2,346,279. Each was viewed when it was captured: the title with the wordmark, both LAUNCH buttons and the legend; the three runs in PLAY with the HUD, in the purple, green and blue palettes.
- [x] 2026-11-12T18:04Z M2 Release files. `README.md`, `CONTRIBUTING.md` and `.github/workflows/pages.yml` were cut from section 4 of this plan by script, so they equal the approved text. `LICENSE` and `THIRD-PARTY-NOTICES.md` written. `package.json`, the lockfile's root entry and the Git section of `Agents.md` edited. Before the workflow was written, each action's `action.yml` was read at its pinned commit: `setup-node` has `node-version` and `cache`, `upload-pages-artifact` has `path`, `deploy-pages` has the output `page_url`; the [M] in section 4.6 is now [O].
  - A3: 8 relative links and images in `README.md` and 1 in `THIRD-PARTY-NOTICES.md`, every target present. `CONTRIBUTING.md` has none.
  - A4: `LICENSE` starts `MIT License` with the copyright line, and its body from "Permission is hereby granted" equals three.js's MIT body, whitespace aside. Both library licence files (1081 and 858 bytes, LF) are contained whole in the notices.
  - A5, changed (R-13): `vite build --outDir <scratch>/t12-dist` exit 0, `git status --short` identical before and after, and the four chunk names equal those in `dist/` (`app-CHcO9ut3.js`, `index-DWbLPmpn.js`, `harness-BSIgpiTj.js`, `testHook-DMG-gi9O.js`), so the bundle did not change. `dist/` was not touched.
  - The workflow file parses as YAML with jobs `build` and `deploy`. It has not run.
- [x] 2026-11-12T18:04Z M3 Replace the two identifiers. 16 lines in 7 files: 10 user-name paths and 6 addresses. A6: 16 lines before, **0 after**, and the bare user name appears in no tracked file. A script compared the diff of the four documents: all 15 changed lines there equal the old line with only the tokens replaced; the other additions are DI-120, three revision notes and three `updated` lines. The sixteenth line is the string constant in `.claude/workflows/terrain-design-docs.js`.
- [x] 2026-11-12T18:11Z **A2 failed, and the plan was `blocked` on the operator** (resolved below). `npm run check`: typecheck and lint pass; vitest `1 failed | 118 passed (119)` files, `3 failed | 1987 passed | 2 skipped`; the GLSL gate did not run because the chain stops at the first failure. The three failures are in T00's `tests/boundaries/gates.test.ts`, which reads the real `architecture.md` and pins the number of tasks at 12: line 71 expects the row list `T00` to `T11`, and lines 134 and 201 expect `12 plans` in `plans:check`'s output. Received: 13 rows and `plans:check: 13 plans, 3187 pattern pairs, 0 problems`. Nothing else failed. The fix is four lines of that file (the test's title and the three expected values, 12 to 13 with `T12` added), through T00's amendment PR. It is an edit to an expected value, which `Agents.md` allows only with the reviewer's agreement, and section 3 of this plan said no test would change. Not made.
- [x] 2026-11-12T18:11Z `npm run check:task -- T12`, for the record: `tsc: VACUOUS, 0 owned files type-checked`, `eslint: VACUOUS, 0 owned files linted`, `vitest: not applicable`, `glsl: 0 owned files scanned, 0 hits`, `check:task T12 FAIL`, as R-6 expected.
- [x] 2026-11-12T18:14Z The operator, verbatim: "Proceed with the fix for the 4 lines." `tests/boundaries/gates.test.ts`: the title, the row list with `'T12'`, and the two `12 plans` strings now `13 plans`, through T00's PR-3. That file alone: `40 passed (40)`.
- [x] 2026-11-12T18:20Z **A2 passes.** `npm run check` exit 0: `Test Files 119 passed (119)`, `Tests 1990 passed | 2 skipped (1992)`, `glsl:check: 189 files scanned, 0 hits`. The counts equal the fresh clone's before T12. A1 again: `13 plans, 3187 pattern pairs, 0 problems`. A6 again: 0 lines.
- [ ] M4 **Stopped at Gate 1.** Nothing is staged or committed. Waiting for the operator's word to commit and push.
- Remaining: Gate 1 (three commits, the push, A7 and A8), Gate 2, M6 and M7.
- [ ] M5 Gate 2 presentation.
- [ ] M6 Publish, A9 to A12.
- [ ] M7 Close.

## 10. Surprises and discoveries

- **The plan is written before its §12 row exists.** Until M0, `npm run plans:check` reports one problem, `T12: no row in architecture.md section 12`. The row is a change to `architecture.md`, so it waits for this plan's approval with everything else.
- **The production build ships the harness.** `dist/assets/` holds a `harness` and a `testHook` chunk, loaded only under `?harness` (`src/app/boot.ts`). On a public page any visitor can open `?harness` and warp. It reads and writes nothing outside the page, so T12 leaves it [O: the chunks are in `dist/`; I: no effect beyond the page].
- **A T00 test pinned the task count (fixed, PR-3).** `tests/boundaries/gates.test.ts` asserts 12 task rows in the real `architecture.md` §12 and `12 plans` from a plan set generated from it [O: three failures, Progress]. Any new task breaks it; the audit before this plan did not look for it.
- **`<user>` is not always inside code.** Of the 16 replaced lines, 13 are in a code span or a fenced block, one is a JavaScript string, one (`plans/T11-art-pass.md`, the reviewer's JSON) is indented as code, and one (`plans/T11-art-pass.md`, the DI-113 reviewer's `overall`) is plain prose. There GitHub's renderer will drop the unknown tag and show `C:/Users//AppData/...`; the file itself is correct [I: from GitHub's HTML sanitising, not viewed].
- **A5 as written would have rebuilt `dist/`,** which the operator's logon server serves on port 5173. The build went to a scratch folder instead (R-13).
- **The built bundle has no licence banners** for three.js or postprocessing [O: no `@license` or `Copyright` string in `dist/assets/*.js`], which is why the workflow copies the notices into `dist/`.

## 11. Decision log

| Decision | Reason | Date | By |
|---|---|---|---|
| **R-1: what T12 takes from the operator's git-governance procedure** | Used as a reference, not as binding rules. Taken: commit messages in plain ASCII; no automated commit, so the workflow gets `contents: read`; pushed history is never rewritten, and a fix is a new commit; the tracking boundary (`.gitignore`, `.gitattributes`) is not changed here; the root scaffolding set of README, LICENSE and CONTRIBUTING; and, for the one irreversible act, its two-gate shape with every ref listed, a fresh clone checked as a stranger would see it, and a residual record. Not taken: its document identifiers and cards, its commit-message prefix, its branch-and-worktree cycle | 2026-11-12 | T12 executor, for the operator |
| **R-2: publish from this repository, made public** | The operator's choice over a second repository holding only `dist/`, and over a paid plan | 2026-11-12 | Operator |
| **R-3: MIT, "Copyright (c) 2026 Kris E. Granholm"** | The operator's choice | 2026-11-12 | Operator |
| **R-4: replace the user name and the tailnet address in the current files; leave history alone** | The operator's choice. GitHub's code search indexes only the current files. Removing them from the 5 commits would need a force-push, which this repository never does | 2026-11-12 | Operator |
| **R-5: the README says nothing about how the game was built, and carries the prompt and four screenshots** | The operator's choices, in session | 2026-11-12 | Operator |
| **R-6: `check:task -- T12` is not a gate** | It is vacuous for a task with no TypeScript and fails by design. `npm run check` on the whole repository covers the two files of T00's that T12's work changes | 2026-11-12 | T12 executor |
| **R-7: the workflow builds and deploys, and runs no tests** | The unit tests have only run on Windows, and a red test job would block deploys for a reason unrelated to the game. `npm run check` stays a local gate before a push | 2026-11-12 | T12 executor |
| **R-8: the deploy job is skipped while the repository is private** | So the first Linux build is proven by a real run before publication, instead of being found broken after it | 2026-11-12 | T12 executor |
| **R-9: every push to `main` deploys** | A push here is already a deliberate act by the operator. `Agents.md` will say that a push publishes the game | 2026-11-12 | T12 executor |
| **R-10: pull requests by arrangement** | A change goes through a plan, and an undiscussed pull request has none | 2026-11-12 | T12 executor; the operator saw this default on 2026-11-12 and did not change it |
| **R-11: actions pinned by commit, not by tag** | A tag can be moved to different code; a commit cannot | 2026-11-12 | T12 executor |
| **R-12: `"private": true` stays in `package.json`** | It concerns the npm registry, not the repository's visibility | 2026-11-12 | T12 executor |
| **R-13: A5's build writes to a scratch folder, not `dist/`** | `dist/` is what the operator's own server serves. `vite build --outDir` proves the same thing, that the build still works after the `package.json` change and alters no tracked file, without replacing those files under a running server | 2026-11-12 | T12 executor |

## 12. Contract change requests

None. T12 touches nothing under `src/contracts/**`.

## 13. Outcomes and retrospective

Not written yet. Known in advance, and to be confirmed or corrected at M7:

**Residuals the operator accepted on 2026-11-12:**

- Commits `e732a82` to `6afd289` keep the user name, the tailnet address, the device names and the quoted comments, and anyone can read them once the repository is public.
- The current files keep the device and hardware names, the quoted comments and the original prompt.

**Not verified by this plan:**

- Whether another game or a trademark uses the name "Midnight Vector". Nobody searched.
- The game on a github.io address, until A10, A11 and the human checks run.
- The build and the unit tests on Linux, until A8 (build only; R-7).
- The README sentences that restate `architecture.md`.

## 14. Revision notes

- 2026-11-12T18:11Z Ratified by the operator and executed through M3. Section 4.6's input names are confirmed against each action's `action.yml`. A5 builds to a scratch folder (R-13). Status `blocked`: A2 fails on three assertions in T00's `tests/boundaries/gates.test.ts` that pin 12 tasks, and changing them needs the operator's agreement and contradicts section 3's "no test changes". Sections 9, 10 and 11 updated. Nothing is committed.
- 2026-11-12T18:20Z Scope widened by four lines, with the operator's agreement ("Proceed with the fix for the 4 lines."): `tests/boundaries/gates.test.ts` now pins 13 tasks, through T00's PR-3. Section 3's table and non-goal say so, and section 6 puts that file in the first commit, with the §12 row it counts. A2 passes. Status `in-progress`, stopped at Gate 1. Nothing is committed.
