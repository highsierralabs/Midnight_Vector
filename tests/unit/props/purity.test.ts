// A21's purity half: no stock geometry anywhere under src/render/props, no import of dev/ outside dev/, no Math.random or
// Date.now, and no three in the pure modules. Reads the source text, because the rule is about the source text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/render/props';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p.replaceAll('\\', '/'));
  }
  return out;
}

const FILES = walk(ROOT);
const STOCK = /\b(?:Box|Sphere|Cone|Cylinder|Plane|Torus|TorusKnot|Circle|Ring|Lathe|Tube|Capsule|Dodecahedron|Icosahedron|Octahedron|Tetrahedron|Polyhedron|Extrude|Shape|Wireframe|Edges)Geometry\b/;
const PURE = ['plan', 'ring', 'feeder', 'density', 'builders', 'shapes', 'archetypes', 'items', 'ship'];

function stripped(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Agents.md bans an early exit under a non-uniform condition above derivative-dependent code. Here a discard is allowed only as the
 * last statement of main, the file's last function: after each one, only preprocessor lines and the closing brace may follow.
 */
function discardsAreLast(glsl: string): boolean {
  const text = stripped(glsl);
  const re = /\bdiscard\s*;/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const rest = text.slice(m.index + m[0].length).replace(/^\s*#.*$/gm, '').replace(/\s+/g, '');
    if (rest !== '}') return false;
  }
  return true;
}

describe('purity', () => {
  it('finds source files to check', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('uses no stock geometry anywhere', () => {
    for (const f of FILES) expect(stripped(readFileSync(f, 'utf8')), f).not.toMatch(STOCK);
  });

  it('negative control: the pattern matches a stock name on a string', () => {
    expect('new ConeGeometry(1, 2, 3)').toMatch(STOCK);
    expect('new THREE.TorusGeometry(1, 2)').toMatch(STOCK);
    expect('InstancedBufferGeometry').not.toMatch(STOCK);
  });

  it('imports dev/ only from dev/', () => {
    for (const f of FILES) {
      if (f.includes('/dev/')) continue;
      expect(stripped(readFileSync(f, 'utf8')), f).not.toMatch(/from\s+['"][^'"]*\/dev\//);
    }
  });

  it('calls no Math.random or Date.now', () => {
    for (const f of FILES) {
      const text = stripped(readFileSync(f, 'utf8'));
      expect(text, f).not.toMatch(/Math\.random/);
      expect(text, f).not.toMatch(/Date\.now/);
    }
  });

  it('keeps three out of the pure modules', () => {
    for (const name of PURE) {
      const text = readFileSync(join(ROOT, `${name}.ts`), 'utf8');
      expect(text, name).not.toMatch(/from\s+['"]three/);
    }
  });

  it('puts a discard only as the last statement of main', () => {
    const frags = FILES.filter((f) => f.endsWith('.frag.glsl'));
    expect(frags.length).toBeGreaterThan(0);
    for (const f of frags) expect(discardsAreLast(readFileSync(f, 'utf8')), f).toBe(true);
    // The rule has something to check: CUTOUT's reel holes are the one discard.
    expect(stripped(readFileSync(join(ROOT, 'glsl/props.frag.glsl'), 'utf8'))).toMatch(/\bdiscard\s*;/);
  });

  it('negative control: an early discard fails the last-statement check', () => {
    const src = readFileSync(join(ROOT, 'glsl/props.frag.glsl'), 'utf8');
    // The old form: the discard straight after the hole test, above the edge lines that use fwidth.
    const early = src.replace(/(cutHole = [^;]*;)/, '$1\n      if (cutHole > .5) discard;');
    expect(early).not.toBe(src);
    expect(discardsAreLast(early)).toBe(false);
    expect(discardsAreLast('void main() {\n  if (a) discard;\n  gl_FragColor = vec4(fwidth(x));\n}\n')).toBe(false);
    expect(discardsAreLast('void main() {\n  gl_FragColor = vec4(1.);\n#ifdef CUTOUT\n  if (a) discard;\n#endif\n}\n')).toBe(true);
  });

  it('exports exactly createPropsLayer from the index', () => {
    const lines = readFileSync(join(ROOT, 'index.ts'), 'utf8').split(/\r?\n/).filter((l) => /\bexport\b/.test(l));
    expect(lines).toEqual(["export { createPropsLayer } from './layer';"]);
  });
});
