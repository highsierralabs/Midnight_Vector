// A6: what each file of this module may reach. index.ts exports exactly the three factories, the pure files stay
// pure, and nothing under dev/ can enter a production bundle. Read from source text, so it needs no browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as fx from '../../../src/render/fx/index';

const PURE = ['governor', 'quality', 'postParams', 'speedLineParams', 'asyncGuard', 'dev/metrics'];
const NO_DEV = ['index', 'post', 'crt', 'speedLines'];

const read = (name: string): string => readFileSync(`src/render/fx/${name}.ts`, 'utf8');

/** Comments are text, not imports or calls. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of code(source).matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

const importsThreeOrPost = (source: string): boolean => specifiers(source).some((s) => /^(three|postprocessing)(\/|$)/.test(s));
const readsClock = (source: string): boolean => /\b(?:Date\.now|performance\.now|Math\.random)\b/.test(code(source));
const importsDev = (source: string): boolean => specifiers(source).some((s) => /(^|\/)dev(\/|$)/.test(s));

describe('public surface', () => {
  it('index.ts exports exactly the three factories', () => {
    expect(Object.keys(fx).sort()).toEqual(['createFxLayer', 'createGovernor', 'createPost']);
  });
});

describe('pure files', () => {
  for (const name of PURE) {
    it(`${name} has no three, postprocessing or clock`, () => {
      const source = read(name);
      expect(importsThreeOrPost(source)).toBe(false);
      expect(readsClock(source)).toBe(false);
    });
  }
});

describe('the dev folder', () => {
  for (const name of NO_DEV) {
    it(`${name} imports nothing under dev/`, () => {
      expect(importsDev(read(name))).toBe(false);
    });
  }
});

describe('the checker', () => {
  it('flags a sample of each forbidden thing', () => {
    expect(importsThreeOrPost("import { Mesh } from 'three';")).toBe(true);
    expect(importsThreeOrPost("import type { Effect } from 'postprocessing';")).toBe(true);
    expect(importsThreeOrPost("const a = await import('three/addons/x.js');")).toBe(true);
    expect(readsClock('const t = Date.now();')).toBe(true);
    expect(readsClock('const t = performance.now();')).toBe(true);
    expect(readsClock('const r = Math.random();')).toBe(true);
    expect(importsDev("import { washout } from './dev/metrics';")).toBe(true);
    expect(importsDev("import x from '../fx/dev/testCard';")).toBe(true);
  });

  it('does not flag a comment or a clean file', () => {
    expect(readsClock('// Date.now is not used here\nconst a = 1;')).toBe(false);
    expect(importsDev("import { TIERS } from './quality';")).toBe(false);
    expect(importsThreeOrPost("import { hash01 } from '../../core/hash';")).toBe(false);
  });
});
