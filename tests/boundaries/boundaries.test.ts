// Lints virtual paths through the real eslint.config.js, so no forbidden file ever exists on disk and no other
// task's directory is created. 'pass' means no messages at all. A rule name means that rule must fire.
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const IMPORTS = '@typescript-eslint/no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const PROPS = 'no-restricted-properties';
const ANY = '@typescript-eslint/no-explicit-any';

const imp = (from: string): string => `import { x } from '${from}'; export const a = x;`;
const typeImp = (from: string): string => `import type { X } from '${from}'; export type A = X;`;
const dyn = (from: string): string => `export const a = await import('${from}');`;
const typeQuery = (from: string): string => `export type T = typeof import('${from}');`;
const importType = (from: string): string => `export type T = import('${from}').X;`;
const SCENE = "import { Scene } from 'three'; export const s = new Scene();";
const CLOCK = "import { Clock } from 'three'; export const c = new Clock();";
const POST = "import { BloomEffect } from 'postprocessing'; export const b = new BloomEffect();";
const THREE_TYPE = "import type { Scene } from 'three'; export type S = Scene;";
const ENUM = 'export enum E { A }';

type Case = readonly [file: string, code: string, want: string];

const CASES: readonly Case[] = [
  // The required spellings of one forbidden import, from world to sim.
  ['src/world/height.ts', imp('../sim/rules'), IMPORTS],
  ['src/world/height.ts', imp('../sim'), IMPORTS],
  ['src/world/height.ts', imp('../sim/index.ts'), IMPORTS],
  ['src/world/height.ts', imp('../../src/sim/rules'), IMPORTS],
  ['src/world/height.ts', imp('/src/sim/rules.ts'), IMPORTS],
  ['src/world/height.ts', "export { x } from '../sim/rules';", IMPORTS],
  ['src/world/height.ts', "export * from '../sim/rules';", IMPORTS],
  ['src/world/height.ts', dyn('../sim/rules'), SYNTAX],
  ['src/world/deep/height.ts', imp('../../sim/rules'), IMPORTS],
  ['src/world/deep/height.ts', dyn('../../sim/rules'), SYNTAX],

  // Spellings that resolve but were not the canonical one, so the module regexes could not read them.
  ['src/world/h.ts', imp('./../sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('../world/../sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('../../src/world/../sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('.././sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('..//sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('..\\\\sim\\\\rules'), IMPORTS],
  ['src/world/h.ts', imp('../../../terrain/src/sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('../Sim/rules'), IMPORTS],
  ['src/world/h.ts', imp('../../node_modules/three/build/three.module.js'), IMPORTS],
  ['src/world/h.ts', dyn('./../sim/rules'), SYNTAX],
  ['src/world/h.ts', dyn('../world/../sim/rules'), SYNTAX],
  ['src/world/h.ts', dyn('../../src/world/../sim/rules'), SYNTAX],
  ['src/world/h.ts', dyn('../../../terrain/src/sim/rules'), SYNTAX],
  ['src/world/h.ts', dyn('../Sim/rules'), SYNTAX],
  ['src/world/h.ts', dyn('../../node_modules/three/build/three.module.js'), SYNTAX],

  // Dynamic imports the regexes cannot read at all.
  ['src/world/h.ts', 'export const a = await import(`../sim/rules`);', SYNTAX],
  ['src/world/h.ts', "const p = '../sim/rules'; export const a = await import(p);", SYNTAX],
  ['src/world/h.ts', "export const a = import.meta.glob('../sim/*.ts');", SYNTAX],
  ['src/app/x.ts', 'export const m = await import(`../harness/index`);', SYNTAX],

  // Type position, where no-restricted-imports does not look.
  ['src/world/h.ts', typeQuery('../sim/rules'), SYNTAX],
  ['src/world/h.ts', importType('../sim/rules'), SYNTAX],
  ['src/world/h.ts', typeQuery('../world/../sim/rules'), SYNTAX],
  ['src/world/h.ts', typeQuery('../Sim/rules'), SYNTAX],
  ['src/world/h.ts', typeQuery('three'), SYNTAX],
  ['src/world/h.ts', importType('three'), SYNTAX],
  ['src/world/h.ts', typeQuery('postprocessing'), SYNTAX],
  ['src/contracts/index.ts', typeQuery('three'), 'pass'],
  ['src/contracts/index.ts', importType('three'), 'pass'],
  ['src/contracts/index.ts', typeQuery('postprocessing'), SYNTAX],
  ['src/contracts/index.ts', typeQuery('../core/coords'), SYNTAX],
  ['src/render/terrain/index.ts', typeQuery('../props/rings'), SYNTAX],
  ['src/render/terrain/index.ts', typeQuery('three'), 'pass'],
  ['src/render/terrain/index.ts', typeQuery('postprocessing'), 'pass'],
  ['src/harness/api.ts', typeQuery('./metrics'), 'pass'],
  ['src/harness/api.ts', typeQuery('three'), 'pass'],
  ['src/harness/api.ts', typeQuery('postprocessing'), SYNTAX],
  ['src/harness/api.ts', typeQuery('../sim/rules'), SYNTAX],
  ['src/testing/devShell.ts', typeQuery('three'), 'pass'],
  ['src/testing/fakeWorld.ts', typeQuery('three'), SYNTAX],
  ['src/app/x.ts', typeQuery('../sim/rules'), 'pass'],
  ['src/app/x.ts', typeQuery('../harness/index'), SYNTAX],
  ['src/app/x.ts', typeQuery('../testing/fakeHost'), SYNTAX],
  ['src/main.ts', typeQuery('./harness/index'), SYNTAX],
  ['src/main.ts', typeQuery('./testing/index'), SYNTAX],
  ['src/main.ts', typeQuery('./app/index'), 'pass'],
  ['tests/unit/world/noise.test.ts', typeQuery('../../../src/sim/rules'), SYNTAX],
  ['tests/unit/world/noise.test.ts', imp('../../../src/world/../sim/rules'), IMPORTS],
  ['tests/unit/core/x.test.ts', typeQuery('../../../src/sim/rules'), 'pass'],

  // Normal forms that must stay legal beside those rules.
  ['src/world/h.ts', imp('./a/b'), 'pass'],
  ['src/world/h.ts', dyn('./sim'), 'pass'],
  ['src/world/h.ts', typeQuery('./sim'), 'pass'],
  ['src/world/h.ts', typeQuery('../contracts/index'), 'pass'],
  ['src/render/terrain/index.ts', "import a from './floor.glsl?raw'; export const b = a;", 'pass'],

  // Pure modules cannot reach a banned global through the global object. A local alias, const M = Math, is out of reach of lint.
  ['src/core/x.ts', 'export const v = globalThis.Math.random();', PROPS],
  ['src/core/x.ts', 'export const v = globalThis.Date.now();', PROPS],
  ['src/core/x.ts', 'export const v = globalThis.performance.now();', PROPS],
  ['src/world/x.ts', 'export const v = window.Math.random();', PROPS],
  ['src/sim/x.ts', 'export const v = self.performance.now();', PROPS],
  ['src/ui/hud.ts', 'export const v = globalThis.Date.now();', 'pass'],

  // Pure modules: world, sim, feel.
  ['src/world/height.ts', typeImp('three'), IMPORTS],
  ['src/world/height.ts', SCENE, IMPORTS],
  ['src/world/height.ts', dyn('three'), SYNTAX],
  ['src/world/height.ts', POST, IMPORTS],
  ['src/world/height.ts', dyn('postprocessing'), SYNTAX],
  ['src/world/height.ts', imp('./sim'), 'pass'],
  ['src/world/height.ts', imp('../contracts/index'), 'pass'],
  ['src/world/height.ts', imp('../core/coords'), 'pass'],
  ['src/world/height.ts', 'export const v = Math.random();', PROPS],
  ['src/world/height.ts', 'export const v = Date.now();', PROPS],
  ['src/world/height.ts', 'export const v = performance.now();', PROPS],
  ['src/sim/rules.ts', imp('../world/height'), IMPORTS],
  ['src/sim/rules.ts', imp('../feel/index'), IMPORTS],
  ['src/sim/rules.ts', imp('../core/hash'), 'pass'],
  ['src/sim/rules.ts', SCENE, IMPORTS],
  ['src/sim/rules.ts', 'export const v = Math.random();', PROPS],
  ['src/feel/index.ts', imp('../sim/rules'), IMPORTS],
  ['src/feel/index.ts', imp('../contracts/index'), 'pass'],
  ['src/feel/index.ts', 'export const v = Date.now();', PROPS],

  // Contracts: three for types only, and nothing else in the project, not even core.
  ['src/contracts/index.ts', THREE_TYPE, 'pass'],
  ['src/contracts/index.ts', SCENE, IMPORTS],
  ['src/contracts/index.ts', dyn('three'), SYNTAX],
  ['src/contracts/index.ts', imp('../core/coords'), IMPORTS],
  ['src/contracts/index.ts', imp('../sim/rules'), IMPORTS],
  ['src/contracts/index.ts', POST, IMPORTS],
  ['src/contracts/glsl.ts', "import a from './glsl/common.glsl?raw'; export const b = a;", 'pass'],

  // Core.
  ['src/core/coords.ts', imp('../contracts/index'), 'pass'],
  ['src/core/coords.ts', imp('./hash'), 'pass'],
  ['src/core/coords.ts', imp('../world/height'), IMPORTS],
  ['src/core/coords.ts', imp('../testing/index'), IMPORTS],
  ['src/core/coords.ts', SCENE, IMPORTS],
  ['src/core/coords.ts', POST, IMPORTS],
  ['src/core/coords.ts', 'export const v = performance.now();', PROPS],

  // Audio, UI, input: not pure, but three-free.
  ['src/ui/hud.ts', imp('./input'), 'pass'],
  ['src/ui/hud.ts', imp('../input/keys'), IMPORTS],
  ['src/ui/hud.ts', SCENE, IMPORTS],
  ['src/ui/hud.ts', 'export const v = Date.now();', 'pass'],
  ['src/input/keys.ts', imp('../ui/hud'), IMPORTS],
  ['src/input/keys.ts', imp('../contracts/index'), 'pass'],
  ['src/input/keys.ts', POST, IMPORTS],
  ['src/audio/graph.ts', imp('../ui/hud'), IMPORTS],
  ['src/audio/graph.ts', imp('../core/hash'), 'pass'],
  ['src/audio/graph.ts', 'export const v = Math.random();', 'pass'],
  ['src/audio/graph.ts', SCENE, IMPORTS],

  // Harness: three yes, postprocessing no.
  ['src/harness/api.ts', SCENE, 'pass'],
  ['src/harness/api.ts', CLOCK, IMPORTS],
  ['src/harness/api.ts', POST, IMPORTS],
  ['src/harness/api.ts', imp('../sim/rules'), IMPORTS],
  ['src/harness/api.ts', imp('../contracts/index'), 'pass'],

  // Render directories, which see each other under both spellings.
  ['src/render/terrain/index.ts', imp('../sky/sky.glsl?raw'), IMPORTS],
  ['src/render/terrain/index.ts', imp('../props/rings'), IMPORTS],
  ['src/render/terrain/index.ts', imp('../../render/props/rings'), IMPORTS],
  ['src/render/terrain/index.ts', imp('/src/render/props/rings.ts'), IMPORTS],
  ['src/render/terrain/index.ts', dyn('../props/rings'), SYNTAX],
  ['src/render/terrain/index.ts', imp('../../sim/rules'), IMPORTS],
  ['src/render/terrain/index.ts', imp('../../testing/index'), IMPORTS],
  ['src/render/terrain/index.ts', imp('../../contracts/index'), 'pass'],
  ['src/render/terrain/index.ts', imp('../../core/coords'), 'pass'],
  ['src/render/terrain/index.ts', imp('./atlas'), 'pass'],
  ['src/render/terrain/index.ts', SCENE, 'pass'],
  ['src/render/terrain/index.ts', POST, 'pass'],
  ['src/render/sky/index.ts', CLOCK, IMPORTS],
  ['src/render/sky/index.ts', SCENE, 'pass'],
  ['src/render/props/index.ts', imp('../terrain/atlas'), IMPORTS],
  ['src/render/fx/index.ts', imp('../sky/index'), IMPORTS],
  ['src/render/fx/index.ts', POST, 'pass'],

  // Testing: three and postprocessing allowed, except fakeWorld and scriptedFrame, which stay pure.
  ['src/testing/devShell.ts', imp('../contracts/index'), 'pass'],
  ['src/testing/devShell.ts', imp('../core/uniforms'), 'pass'],
  ['src/testing/devShell.ts', imp('../sim/rules'), IMPORTS],
  ['src/testing/devShell.ts', imp('../render/terrain/index'), IMPORTS],
  ['src/testing/devShell.ts', SCENE, 'pass'],
  ['src/testing/devShell.ts', POST, 'pass'],
  ['src/testing/devShell.ts', CLOCK, IMPORTS],
  ['src/testing/fakeWorld.ts', imp('../core/hash'), 'pass'],
  ['src/testing/fakeWorld.ts', imp('../sim/rules'), IMPORTS],
  ['src/testing/fakeWorld.ts', SCENE, IMPORTS],
  ['src/testing/fakeWorld.ts', POST, IMPORTS],
  ['src/testing/fakeWorld.ts', 'export const v = Math.random();', PROPS],
  ['src/testing/scriptedFrame.ts', imp('./fakeWorld'), 'pass'],
  ['src/testing/scriptedFrame.ts', SCENE, IMPORTS],
  ['src/testing/scriptedFrame.ts', 'export const v = Date.now();', PROPS],

  // App: everything except testing, and the harness only through a dynamic import (C-30).
  ['src/app/loop.ts', imp('../sim/rules'), 'pass'],
  ['src/app/x.ts', imp('../render/terrain/index'), 'pass'],
  ['src/app/x.ts', SCENE, 'pass'],
  ['src/app/x.ts', POST, 'pass'],
  ['src/app/x.ts', CLOCK, IMPORTS],
  ['src/app/x.ts', imp('../testing/fakeHost'), IMPORTS],
  ['src/app/x.ts', dyn('../testing/fakeHost'), SYNTAX],
  ['src/app/x.ts', "import { createHarness } from '../harness/index'; export const a = createHarness;", IMPORTS],
  ['src/app/x.ts', "export * from '../harness/index';", IMPORTS],
  ['src/app/x.ts', "export const m = await import('../harness/index');", 'pass'],
  ['src/app/boot.ts', imp('../../testing/fakeHost'), IMPORTS],
  ['src/main.ts', imp('./testing/index'), IMPORTS],
  ['src/main.ts', imp('./harness/index'), IMPORTS],
  ['src/main.ts', dyn('./testing/index'), SYNTAX],
  ['src/main.ts', dyn('./harness/index'), 'pass'],
  ['src/main.ts', dyn('./app/index'), 'pass'],

  // Unit tests: another module's implementation is out; testing, contracts and core are in.
  ['tests/unit/world/noise.test.ts', imp('../../../src/world/noise'), 'pass'],
  ['tests/unit/world/noise.test.ts', imp('../../../src/sim/rules'), IMPORTS],
  ['tests/unit/world/noise.test.ts', dyn('../../../src/sim/rules'), SYNTAX],
  ['tests/unit/world/noise.test.ts', imp('../../../src/testing/index'), 'pass'],
  ['tests/unit/world/noise.test.ts', imp('../../../src/contracts/index'), 'pass'],
  ['tests/unit/world/noise.test.ts', imp('../../../src/core/hash'), 'pass'],
  ['tests/unit/world/noise.test.ts', SCENE, 'pass'],
  ['tests/unit/world/noise.test.ts', POST, 'pass'],
  ['tests/unit/sim/rules.test.ts', imp('../../../src/world/height'), IMPORTS],
  ['tests/unit/sim/rules.test.ts', imp('../../../src/sim/rules'), 'pass'],
  ['tests/unit/feel/feel.test.ts', imp('../../../src/sim/rules'), IMPORTS],
  ['tests/unit/audio/graph.test.ts', imp('../../../src/ui/hud'), IMPORTS],
  ['tests/unit/ui/hud.test.ts', imp('../../../src/input/keys'), IMPORTS],
  ['tests/unit/input/keys.test.ts', imp('../../../src/input/keys'), 'pass'],
  ['tests/unit/harness/api.test.ts', imp('../../../src/sim/rules'), IMPORTS],
  ['tests/unit/harness/api.test.ts', imp('../../../src/testing/fakeHost'), 'pass'],
  ['tests/unit/terrain/atlas.test.ts', imp('../../../src/render/terrain/atlas'), 'pass'],
  ['tests/unit/terrain/atlas.test.ts', imp('../../../src/render/props/rings'), IMPORTS],
  ['tests/unit/terrain/atlas.test.ts', imp('../../../src/sim/rules'), IMPORTS],
  ['tests/unit/sky/sky.test.ts', imp('../../../src/render/sky/stars'), 'pass'],
  ['tests/unit/props/rings.test.ts', imp('../../../src/render/fx/index'), IMPORTS],
  ['tests/unit/fx/gov.test.ts', imp('../../../src/render/fx/governor'), 'pass'],
  ['tests/unit/core/x.test.ts', imp('../../../src/sim/rules'), 'pass'],
  ['tests/unit/app/x.test.ts', imp('../../../src/sim/rules'), 'pass'],
  ['tests/unit/app/x.test.ts', imp('../../../src/render/fx/index'), 'pass'],

  // Language rules, repeated in several rows, because a later block replaces no-restricted-syntax.
  ['src/core/x.ts', 'export const f = (a: number[]): number => a[0]!;', 'pass'],
  ['src/world/x.ts', 'export const f = (a: Float32Array): number => a[0]!;', 'pass'],
  ['src/core/x.ts', 'export const v: any = 1;', ANY],
  ['src/render/terrain/x.ts', 'export const v: any = 1;', ANY],
  ['src/core/x.ts', ENUM, SYNTAX],
  ['src/world/x.ts', ENUM, SYNTAX],
  ['src/render/terrain/x.ts', ENUM, SYNTAX],
  ['src/testing/x.ts', ENUM, SYNTAX],
  ['src/app/x.ts', ENUM, SYNTAX],
  ['src/contracts/x.ts', ENUM, SYNTAX],
  ['tests/unit/world/x.test.ts', ENUM, SYNTAX],
  ['tests/visual/terrain.spec.ts', ENUM, SYNTAX],
  ['tests/visual/terrain.spec.ts', CLOCK, IMPORTS],
  ['tests/visual/terrain.spec.ts', SCENE, 'pass'],
  ['scripts/x.ts', ENUM, SYNTAX],
];

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

describe('module boundaries', () => {
  it('has at least the required 45 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(45);
  });

  it.each(CASES)('%s: %s -> %s', async (file, code, want) => {
    const [result] = await eslint.lintText(code, { filePath: file });
    const rules = result!.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
    if (want === 'pass') {
      expect(rules).toEqual([]);
    } else {
      expect(rules).toContain(want);
    }
  });
});
