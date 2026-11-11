export const meta = {
  name: 'terrain-design-docs',
  description: 'Research, propose competing architectures, then write and adversarially verify architecture.md and Agents.md',
  phases: [
    { title: 'Research', detail: 'Best practices for the stack and for plan files' },
    { title: 'Propose', detail: 'Three independent architectures from different angles' },
    { title: 'Write', detail: 'Synthesize architecture.md, then Agents.md' },
    { title: 'Verify', detail: 'Adversarially check both docs against real library source' },
  ],
}

const ROOT = 'C:/highsierralabs/Midnight_Vector'
const PROBE = 'C:/Users/kgran/AppData/Local/Temp/claude/802ff760ce0bdd56/d050f826-f2f3-4f5f-ab68-28447d8d5879/scratchpad/probe'

const BRIEF = `
THE USER'S REQUEST (verbatim):
"Make me a 3D website that's a kind of video game, with an infinite procedural retro 80's futuristic synthwave terrain and a camera that keeps moving forward through it forever. The terrain should be full of stuff and objects, look beautiful with shaders and all, be stylish and scroll on forever.
First, write an architecture.md that outlines the planned app design, the tech stack you will use, the programming language, listing the most important libraries and frameworks. Then write an Agents.md with proven best-practices for the tech you will use.
Add a section about the use of plan files in Agents.md, according to common best practices.
Split the prompt up into different, largely independent tasks. Create plans for each individual task before implementing them."

PROJECT: ${ROOT} (currently empty, not a git repo; do not run git init and do not commit).

FACTS VERIFIED BY RUNNING THEM THIS SESSION (2026-11-04). Treat as observed; do not contradict them from memory:
- Windows 10, Node 24.14.1, npm 11.11.0, NVIDIA RTX 4070 SUPER, Ryzen 9 3900X (24 threads).
- npm latest: three 0.187.0, @types/three 0.187.0, vite 8.3.5, postprocessing 6.39.6, vitest 5.1.0, simplex-noise 4.0.3, playwright 1.64.1, eslint 10.14.0, typescript-eslint 8.72.1, stats-gl 4.2.3.
- TypeScript latest is 7.0.2, BUT typescript-eslint 8.72.1 has peer range typescript >=4.8.4 <6.1.0 and npm fails with ERESOLVE. The stack that resolves is typescript 6.0.3.
- postprocessing 6.39.6 has peer three >=0.168.0 <0.188.0, so three must stay below 0.188 while postprocessing is used.
- A probe file compiled clean under tsc 6.0.3 (strict, noUncheckedIndexedAccess) using: WebGLRenderer; postprocessing EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect, VignetteEffect, NoiseEffect, ToneMappingEffect, ScanlineEffect, SMAAEffect; InstancedMesh; ShaderMaterial with GLSL3; createNoise2D. That proves the types only, not runtime behaviour.
- npm audit: moderate minimatch advisory, reached only via eslint/typescript-eslint (dev-only, never shipped). "audit fix --force" would downgrade eslint to 9.39.5.
- Playwright 1.64.1 wants chromium revision 1248, which is NOT cached. Cached in %LOCALAPPDATA%/ms-playwright: chromium-1234 and chromium_headless_shell-1234.
- Launching headless with executablePath %LOCALAPPDATA%/ms-playwright/chromium-1234/chrome-win64/chrome.exe gives WebGL2 on "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER ... Direct3D11)", EXT_color_buffer_float true, rAF ~125-130 Hz on an empty canvas. So real-GPU screenshots and frame timing are possible from an agent.
- The headless shell with --use-angle=swiftshader --enable-unsafe-swiftshader gives software SwiftShader WebGL2: a usable low-end stand-in.
- The Claude-in-Chrome extension is NOT connected, so Playwright is the visual verification route.
- Installed reference copies of every library above (real source and .d.ts files) are at ${PROBE}/node_modules. READ THESE instead of relying on memory for any API claim. Do not modify that folder.

HARD REQUIREMENTS:
R1 FOREVER. The camera never stops moving forward; nothing in the game (no game-over, no menu state) halts world motion while running. It must stay correct after hours of travel: no jitter, seams, shimmer, precision loss or memory growth. Absolute world coordinates must never reach 32-bit GLSL floats. It must be testable by warping to a huge distance (at least 1e9 world units).
R2 BEAUTIFUL. Unmistakably 80s retro-futuristic synthwave, driven by custom GLSL shaders and a post-processing stack. Avoid known failure modes: bloom wash-out, far-grid moire and aliasing, gradient banding, shimmering.
R3 FULL OF STUFF. Many visibly distinct object types, dense and varied, deterministic per chunk. Scenery should evolve over distance so it stays fresh over a long run.
R4 A KIND OF VIDEO GAME. This is deliberately open: the user did not specify rules. It must feel like a game (player input, goals, score, HUD, title screen, game feel), yet remain beautiful and moving with zero input.
R5 A WEBSITE. Static build deployable anywhere; responsive; touch support; clear fallback when WebGL2 is missing; handles context loss, prefers-reduced-motion and hidden tabs; audio only after a user gesture; no runtime network or CDN dependency; all art procedural.
R6 PERFORMANCE. 60 fps at 1080p on a mid-range GPU, adaptive quality for weaker devices, no per-frame allocations in hot paths, stable memory.
R7 INDEPENDENT TASKS. The architecture must let the work split into largely independent tasks that separate engineers can implement in parallel with disjoint file ownership against frozen contracts.
`

const EVIDENCE = `
EVIDENCE DISCIPLINE: keep claims within the evidence. Distinguish observed (you read it in source or a tool result) from inferred, assumed, and from-memory. Never report a check you did not run. A rejected idea is more useful stated plainly than hedged.
`

phase('Research')
const research = await parallel([
  () => agent(`${BRIEF}${EVIDENCE}
You are researching proven engineering practices that will go into a project's Agents.md. Do not write any project files; return your findings as text.

Load WebSearch via ToolSearch ("select:WebSearch") and search for current sources, and read the real library source under ${PROBE}/node_modules to confirm API-level claims.

Cover, as specific actionable rules with the reason for each:
1. three.js WebGLRenderer performance: instancing and BatchedMesh, draw-call budgets, renderer.info, disposal of geometries/materials/textures, avoiding per-frame allocation, frustum culling of InstancedMesh (bounding spheres), pixel-ratio clamping, colour management and output colour space with custom ShaderMaterial and with post-processing.
2. Custom GLSL in three.js: ShaderMaterial vs RawShaderMaterial, GLSL3 usage, antialiased procedural grid lines with derivatives (fwidth, and well-known work such as Ben Golus "the best darn grid shader" if you can source it), dithering to prevent gradient banding, precision limits of 32-bit floats and of mediump on mobile.
3. Infinite worlds: floating origin / origin rebasing, chunk streaming and pooling, LOD seams (skirts etc), noise domain handling at huge coordinates, workers with Transferable buffers.
4. The pmndrs postprocessing library specifically: EffectComposer setup, merging effects in one EffectPass, which effects cannot be merged (convolution rule; confirm in source), mipmapBlur bloom, HalfFloatType buffers, renderer antialias/stencil/depth settings, tone mapping placement. Confirm by reading its source in node_modules.
5. Vite 8 + TypeScript: shader imports via ?raw, worker imports, base path for static hosting, tsconfig settings.
6. Vitest for pure logic, and Playwright for WebGL smoke tests and screenshots.
7. Web Audio: lookahead scheduling ("A Tale of Two Clocks"), autoplay policy, avoiding node leaks.
8. WebGL robustness: webglcontextlost / restored handling, and three.js behaviour around it.

For each rule give: the rule, why, source URL or the node_modules file you read, and status (verified-in-source / sourced-from-web / from-memory). Be concrete and compact: no filler. Flag anything where sources conflict or where a commonly repeated tip is outdated for three 0.187.`, { label: 'research:stack', phase: 'Research' }),

  () => agent(`${BRIEF}${EVIDENCE}
You are researching common best practices for PLAN FILES used by coding agents and developers, plus the AGENTS.md convention itself. Do not write any project files; return findings as text.

Load WebSearch via ToolSearch ("select:WebSearch") and find current sources. Look at, among others: the agents.md open-format site; OpenAI's Codex guidance on execution plans (ExecPlans / PLANS.md); Anthropic's Claude Code best-practices material on planning before coding and CLAUDE.md length discipline; Cursor and Aider or similar tools' plan and architect modes; and any widely-used plan-file conventions on GitHub. If you need to read a specific page and have no fetch tool, use the Agent tool with subagent_type "web-fetch".

Return:
1. Where the sources agree: when to write a plan, where plan files live, naming, required sections, how plans are kept alive during execution (progress logs, decision logs, surprises), acceptance criteria that are observable, status lifecycle, how to handle deviations, what to do on completion.
2. Where they disagree, and which you would pick for a project with several parallel independent tasks and why.
3. A recommended plan-file template (concrete section list) and a recommended plans/ directory convention, including how parallel plans avoid colliding.
4. AGENTS.md conventions: file location, length discipline, what belongs in it versus elsewhere, and note the casing convention (the user wrote "Agents.md"; the common convention is AGENTS.md; report whether tools treat the case as significant).

Cite a source URL for each substantive claim and mark status (sourced / from-memory). Be compact.`, { label: 'research:plan-files', phase: 'Research' }),
])
const researchStack = research[0] || '(stack research failed; rely on node_modules source and mark claims as from-memory)'
const researchPlans = research[1] || '(plan-file research failed; mark claims as from-memory)'

phase('Propose')
const ANGLES = [
  { key: 'art', title: 'ART DIRECTION AND SHADERS FIRST', body: `Your angle is what makes this look stunning instead of generic. Specify: palette with actual hex values; composition (sun at the vanishing point, the road/canyon corridor, mountain framing); sky shader techniques (banded sun, stars, nebula, horizon glow, dither); terrain shader techniques (antialiased glowing grid that holds up to the horizon without moire, height tinting, fake reflections of the sun on the ground, travelling pulses); the object roster (at least 14 distinct types, each with a silhouette description and how it gets its neon look cheaply, using instancing); the post stack with order and parameter ranges and how to avoid bloom wash-out; how the scenery evolves over distance (zones/biomes, palette drift, time-of-day) so a long run stays fresh. Give concrete GLSL approaches, not adjectives.` },
  { key: 'infinite', title: 'INFINITY AND PERFORMANCE FIRST', body: `Your angle is making "forever" actually true at 60 fps. Specify with numbers: chunk size, resolution and view distance; LOD and seam strategy; CPU height function as single source of truth versus GPU displacement and how objects sit on the ground; Web Worker vs time-sliced main thread with reasoning; floating-origin design and the arithmetic of the precision budget (what stays in doubles, what stays in floats, how noise is sampled at distance 1e9+, how shader time and pattern phases wrap without visible pops); pooling and memory ceilings; instancing per chunk versus global pools; draw-call and triangle budgets; adaptive quality tiers and how they switch without hitching; and how to test "forever" with a warp harness that proves no seams, jitter or growth.` },
  { key: 'game', title: 'GAME DESIGN AND MODULE BOUNDARIES FIRST', body: `Your angle is what the game is and how the code splits. Specify: the game concept in concrete rules, consistent with R1 (forward motion never stops, no game-over halting the world) and with zero-input autopilot; input across keyboard, mouse and touch; scoring, collectibles, hazards with non-lethal consequences; game feel (speed lines, camera shake and FOV punch, hit-stop that does not stop the world, audio ducking); title, HUD and pause UX; a procedural synthwave soundtrack with Web Audio; fixed-step vs variable-step simulation; and above all the module map: directory layout, which module owns which files, the dependency direction, and the exact frozen TypeScript contracts between modules such that at least 6 engineers can build in parallel without touching each other's files. List the proposed independent tasks with dependencies, and the test strategy for each.` },
]
const proposals = await parallel(ANGLES.map(a => () => agent(`${BRIEF}${EVIDENCE}
You are one of three architects working independently, each from a different angle. The others will not see your work; a judge will compare all three. Propose your best design. Do not write any project files; return your proposal as text (at most about 1800 words).

YOUR ANGLE: ${a.title}
${a.body}

You must still respect all hard requirements, and where your angle forces a trade-off against another concern, state the trade-off plainly. Check API claims against ${PROBE}/node_modules. End with the 3 ideas you consider most important and the 3 risks you are least sure about.`, { label: 'propose:' + a.key, phase: 'Propose' })))
const proposalText = ANGLES.map((a, i) => `=== PROPOSAL (${a.title}) ===\n${proposals[i] || '(this proposal failed to return)'}`).join('\n\n')
log('Proposals returned: ' + proposals.filter(Boolean).length + '/3')

phase('Write')
const archResult = await agent(`${BRIEF}${EVIDENCE}
You are the chief architect and judge. Three architects proposed designs independently, and a researcher gathered practices. Compare them, pick the best decisions, graft the best ideas from each, resolve their conflicts, and WRITE the file ${ROOT}/architecture.md (exact filename, lowercase).

${proposalText}

=== STACK RESEARCH ===
${researchStack}

architecture.md must contain, in a clear order:
1. Overview: what the product is, the game concept, and the experience, in a few sentences.
2. Tech stack table: language, every important library and framework, exact pinned version, why it was chosen, and rejected alternatives (for example WebGPU/TSL, React Three Fiber, TypeScript 7). Include the compatibility constraints above.
3. System design: module map with directory layout; dependency direction; the frame loop in exact order; data flow.
4. Coordinate systems and the precision strategy: what lives in doubles vs floats, floating origin, noise at huge distance, phase wrapping, with the arithmetic shown.
5. World generation: determinism model, height function, road/corridor, zones, scatter.
6. Rendering design: terrain and sky shaders, object roster (at least 14 types), post stack, palette with hex values, quality tiers.
7. Game design: rules, input, scoring, feel, UI states, audio.
8. Frozen contracts: the exact TypeScript interfaces between modules, in a code block, complete enough that engineers can implement in parallel. They must type-check.
9. Performance budgets with numbers, and memory ceilings.
10. Robustness: WebGL2 fallback, context loss, reduced motion, hidden tabs, mobile.
11. Test strategy: unit, warp harness, Playwright smoke and screenshot, frame timing, including how to find the cached browser (env override plus discovery, never a hard-coded user path).
12. Task decomposition: largely independent tasks, each with id, one-line scope, exact file ownership (disjoint across tasks), and dependencies, with what can run in parallel. Plans will be written per task in plans/ afterwards, so name the planned plan file for each.
13. Decision log: key decisions and the rejected alternatives with reasons, including what you took or rejected from each proposal.
14. Open risks, each tagged with what would resolve it.

Be concrete: numbers, names and code, no filler. Where a value is an estimate that only testing can confirm, say so rather than presenting it as measured. Do not create any file other than architecture.md. Do not scaffold code.

Return a summary of at most 150 words: the key decisions, and the file path you wrote.`, { label: 'write:architecture', phase: 'Write' })

const agentsResult = await agent(`${BRIEF}${EVIDENCE}
Read ${ROOT}/architecture.md first; it is the authority on design. Then WRITE ${ROOT}/Agents.md (exact filename, casing as the user wrote it: capital A, rest lowercase).

Agents.md holds proven best practices for the technology this project actually uses, for any agent or developer working here. Base it on this research; keep what is verified or well-sourced, drop or clearly mark what is not, and do not repeat design content from architecture.md (link to its sections instead).

=== STACK RESEARCH ===
${researchStack}

=== PLAN-FILE RESEARCH ===
${researchPlans}

Requirements for Agents.md:
- Start with the essentials: what this project is in 2 lines, exact commands (install, dev, build, test, lint, typecheck, smoke), the source-of-truth order, and Windows notes that matter here (PowerShell 5.1 has no &&).
- Then best-practice sections by technology: TypeScript 6, Vite 8, three.js 0.187 with WebGL2, custom GLSL, pmndrs postprocessing, infinite-world and precision rules, Web Workers if used by the architecture, Web Audio, Vitest, Playwright for WebGL, and browser robustness. Each rule is actionable, with a short why. Prefer rules that a reader would otherwise get wrong; skip generic advice.
- A dedicated section titled "Plan files" per the research: when a plan is required, location and naming, the template with required sections, status lifecycle, how plans stay alive during execution (progress, decisions, surprises), how to handle deviations, how parallel tasks avoid collisions, and what happens on completion. In this project every task from architecture.md gets its own plan file written BEFORE implementation starts.
- A definition of done that requires actually running the checks, and viewing screenshots for any visual change; never claim a check that was not run.
- A short "git" note: no commits unless the operator asks, and never add AI attribution such as Co-Authored-By trailers to commits or PR bodies.
- Length discipline: the file is loaded into agents' context, so aim for under about 350 lines; be dense, not padded.

Create no file other than Agents.md. Return a summary of at most 100 words.`, { label: 'write:agents-md', phase: 'Write' })

phase('Verify')
const verdict = await agent(`${BRIEF}${EVIDENCE}
You are an adversarial reviewer. Assume ${ROOT}/architecture.md and ${ROOT}/Agents.md contain errors, and find them. Then FIX what you confirm, in place, using Edit. Do not rewrite for style.

Attack these specifically:
1. API truth: every three.js, postprocessing, vite, vitest, playwright, simplex-noise claim, class name, option and method. Check each against real source in ${PROBE}/node_modules. Do not modify that folder.
2. Contracts: extract the TypeScript contracts from architecture.md into a new temporary directory under ${PROBE}/.. (a sibling of probe, not inside the project), and actually type-check them with the probe's tsc 6.0.3 in strict mode with noUncheckedIndexedAccess. Report the real result.
3. Arithmetic: re-derive the float-precision and budget numbers. Would the precision design genuinely survive distance 1e9 and beyond? Consider noise domains, doubles, hours-long shader time, and any place a large value can leak into a 32-bit float or a mediump.
4. Requirement coverage: go through the verbatim user request and R1 to R7 one by one, and name where each is satisfied. Could the design allow the camera to stop? Is the file ownership truly disjoint? Are task dependencies acyclic, and is there a shared-file bottleneck that breaks parallel work?
5. Internal consistency between the two documents, and with the verified facts above (for example TypeScript version, three version ceiling, browser discovery).
6. Plan-file section: does it give enough to follow without guessing? Does it say every task gets a plan before implementation?

Return your findings through the schema. Be honest about what you could not verify. Do not claim a fix you did not make.`, {
  label: 'verify:docs', phase: 'Verify',
  schema: {
    type: 'object',
    properties: {
      contractsTypecheck: { type: 'string', description: 'What was actually run and the actual result' },
      findings: { type: 'array', items: { type: 'object', properties: {
        doc: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' }, howFixed: { type: 'string' },
      }, required: ['doc', 'problem', 'evidence', 'fixed'] } },
      requirementCoverage: { type: 'array', items: { type: 'object', properties: { req: { type: 'string' }, where: { type: 'string' }, satisfied: { type: 'boolean' } }, required: ['req', 'where', 'satisfied'] } },
      unverified: { type: 'array', items: { type: 'string' } },
    },
    required: ['contractsTypecheck', 'findings', 'requirementCoverage', 'unverified'],
  },
})

return { archResult, agentsResult, verdict }
