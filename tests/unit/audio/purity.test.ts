// A6: the pure files read no clock and no browser, and the module's bundle stays clear of its dev-only files.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'src/audio';
const PURE = ['theory', 'composer', 'clock', 'sequencer', 'sfx', 'impulse', 'analysis', 'wav', 'mix'];
const TOKENS = ['Math.random', 'Date.now', 'performance.now', 'AudioContext', 'window', 'document'];
const DEV_ONLY = ['offline', 'analysis', 'wav', 'devPage'];

/** Removes comments, leaving string contents alone: a token inside a string is still code that can run. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < src.length) {
    const c = src[i]!;
    if (quote) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function scan(src: string): string[] {
  const code = stripComments(src);
  return TOKENS.filter((t) => new RegExp(`(?<![\\w$.])${t.replace('.', '\\.')}(?![\\w$])`).test(code));
}

function importsOf(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

function read(name: string): string {
  return readFileSync(`${DIR}/${name}.ts`, 'utf8');
}

describe('A6 purity', () => {
  for (const name of PURE) {
    it(`${name}.ts uses no clock and no browser global`, () => {
      expect(scan(read(name))).toEqual([]);
    });
  }

  it('the transitive imports of index.ts exclude the dev-only files', () => {
    const seen = new Set<string>();
    const walk = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      for (const spec of importsOf(read(name))) {
        if (spec.startsWith('./')) walk(spec.slice(2));
      }
    };
    walk('index');
    console.log(`A6 bundle: ${[...seen].sort().join(', ')}`);
    expect(seen.has('engine')).toBe(true);
    expect(seen.has('composer')).toBe(true);
    for (const dev of DEV_ONLY) expect(seen.has(dev), dev).toBe(false);
  });

  it('no file in src/audio imports three', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      const specs = importsOf(readFileSync(`${DIR}/${f}`, 'utf8'));
      expect(specs.filter((s) => /^(three|postprocessing)(\/|$)/.test(s)), f).toEqual([]);
    }
  });
});

describe('A6 negative controls', () => {
  it('the scanner flags a fixture containing each token', () => {
    for (const t of TOKENS) expect(scan(`const a = ${t};`), t).toEqual([t]);
  });
  it('it matches whole words, so windowS and a comment about a Hann window are legal', () => {
    expect(scan('const windowS = 0.12; function document2() {}')).toEqual([]);
    expect(scan('// a Hann window over document Date.now\nconst a = 1;')).toEqual([]);
    expect(scan('/* window */ const a = 1;')).toEqual([]);
    expect(scan('const a = new OfflineAudioContext(1, 1, 1);')).toEqual([]);
  });
  it('a comment marker inside a string does not hide what follows the string', () => {
    expect(scan("const u = 'http://x'; const a = window;")).toEqual(['window']);
  });
  it('the import parser sees static, dynamic and side-effect imports', () => {
    const src = "import a from './a';\nimport { b } from \"./b\";\nimport './c';\nconst d = import('./d');\n// import './e';";
    expect(importsOf(src)).toEqual(['./a', './b', './c', './d']);
  });
});
