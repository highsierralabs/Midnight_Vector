import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function fileUrl(path: string): URL {
  return new URL(`../../../${path}`, import.meta.url);
}

function source(path: string): string {
  return readFileSync(fileUrl(path), 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Names of functions declared at brace depth 0, whatever the indentation. */
function topLevelFunctions(glsl: string): string[] {
  const text = stripComments(glsl);
  const names: string[] = [];
  let depth = 0;
  let statement = '';
  for (const ch of text) {
    if (ch === '{') {
      if (depth === 0) {
        const m = /(\w+)\s*\([^()]*\)\s*$/.exec(statement);
        if (m) names.push(m[1]!);
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      statement = '';
    } else if (ch === ';') {
      if (depth === 0) statement = '';
    } else if (depth === 0) {
      statement += ch;
    }
  }
  return names;
}

const EARLY_RETURN = /\bif\s*\([^;{}]*\)\s*(?:\{\s*)?return\b/;

describe('the parsers in this file can fail', () => {
  it('finds a rogue top-level function', () => {
    const text = 'float heroA(float x) { return x; }\nconst float K = 1.;\n  vec3 rogue(vec3 a,\n float b)\n{ return a; }';
    expect(topLevelFunctions(text)).toEqual(['heroA', 'rogue']);
  });
  it('finds an early return, with or without a brace', () => {
    expect(EARLY_RETURN.test('if (r < .93) return vec3(0.);')).toBe(true);
    expect(EARLY_RETURN.test('if (r < .93) { return vec3(0.); }')).toBe(true);
    expect(EARLY_RETURN.test('if (uAurora > 0.) c += a;\nreturn c;')).toBe(false);
  });
});

// M3 step 2 runs these on the working copy before it can be published. The working copy is deleted at M8.
const HERO_FILES = ['src/contracts/glsl/hero.glsl', 'src/render/sky/dev/hero.candidate.glsl'].filter((f) => existsSync(fileUrl(f)));

describe.each(HERO_FILES)('%s', (file) => {
  const hero = source(file);

  it('holds the three frozen lines verbatim', () => {
    const lines = hero.split('\n');
    for (const frozen of ['const vec2  HERO_C = vec2(0., .125);', 'const float HERO_R = .215;', 'vec4 sunDisc(vec3 rd, float yScale) {']) {
      expect(lines).toContain(frozen);
    }
  });

  it('declares no uniform, since one only the sky supplies would read 0 in terrain', () => {
    expect(/^\s*uniform\b/m.test(stripComments(hero))).toBe(false);
  });

  it('declares only sunDisc and hero* functions', () => {
    const names = topLevelFunctions(hero);
    expect(names).toContain('sunDisc');
    for (const n of names) expect(n === 'sunDisc' || n.startsWith('hero')).toBe(true);
  });

  it('declares only hero* or HERO_* constants at the top level', () => {
    const consts = [...stripComments(hero).matchAll(/^const\s+\w+\s+(\w+)/gm)].map((m) => m[1]!);
    for (const c of consts) expect(c.startsWith('HERO_') || c.startsWith('hero')).toBe(true);
  });

  it('has LF endings and no BOM, because siblings compile these exact bytes', () => {
    expect(hero.includes('\r')).toBe(false);
    expect(hero.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('the hero files in this test', () => {
  it('always include the published one', () => {
    expect(HERO_FILES).toContain('src/contracts/glsl/hero.glsl');
  });
});

describe('sky shaders', () => {
  it('have no early return under a condition in the star or event code', () => {
    for (const f of ['skyStars.glsl', 'skyEvents.glsl']) {
      expect(EARLY_RETURN.test(stripComments(source(`src/render/sky/${f}`))), f).toBe(false);
    }
  });

  it('declare only sky* functions and main', () => {
    for (const f of ['skyNoise.glsl', 'skyStars.glsl', 'skyEvents.glsl', 'sky.frag.glsl', 'sky.vert.glsl', 'nebula.vert.glsl', 'nebula.frag.glsl']) {
      for (const n of topLevelFunctions(source(`src/render/sky/${f}`))) expect(n === 'main' || n.startsWith('sky'), `${f}: ${n}`).toBe(true);
    }
  });
});

describe('shipped sky code', () => {
  it('imports nothing from dev', () => {
    for (const f of ['index.ts', 'skyLayer.ts', 'skyMaterial.ts', 'events.ts', 'skyParams.ts']) {
      expect(/from\s+['"][^'"]*\/dev\//.test(source(`src/render/sky/${f}`)), f).toBe(false);
    }
  });

  it('keeps the schedule and the metrics free of three and the DOM', () => {
    for (const f of ['events.ts', 'skyParams.ts', 'dev/metrics.ts']) {
      const text = stripComments(source(`src/render/sky/${f}`));
      expect(/from\s+['"]three['"]/.test(text), f).toBe(false);
      expect(/\b(?:document|window)\./.test(text), f).toBe(false);
    }
  });
});
