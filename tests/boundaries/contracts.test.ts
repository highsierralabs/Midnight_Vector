import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_SIGNATURE, NUMERIC_ALLOW, checkAdditive, checkHero, parseFences, runCheck } from '../../scripts/contracts-check.ts';

const arch = readFileSync('architecture.md', 'utf8');
const fences = parseFences(arch);
const indexFence = fences.find((f) => f.path === 'src/contracts/index.ts')!;
const heroFence = fences.find((f) => f.path === 'src/contracts/glsl/hero.glsl')!;

function additive(file: string): ReturnType<typeof checkAdditive> {
  return checkAdditive(indexFence.body, file, NUMERIC_ALLOW);
}

describe('real contract files', () => {
  it('finds exactly the seven path fences, and not the signature fence', () => {
    expect(fences.map((f) => f.path).sort()).toEqual([
      'src/contracts/glsl.ts',
      'src/contracts/glsl/common.frag.glsl',
      'src/contracts/glsl/common.glsl',
      'src/contracts/glsl/hero.glsl',
      'src/contracts/index.ts',
      'src/core/coords.ts',
      'tests/support/browser.ts',
    ]);
  });

  it('match architecture.md section 8 and section 11.1 on disk', () => {
    const r = runCheck(process.cwd());
    expect(r.lines.join('\n')).not.toContain('MISSING');
    expect(r.fences).toBe(7);
    expect(r.ok).toBe(true);
  });
});

describe('checkAdditive, negative controls', () => {
  it('passes the unchanged fence, with added 0', () => {
    const r = additive(indexFence.body);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
    expect(r.present).toBeGreaterThan(400);
  });

  it('a deleted line fails', () => {
    const r = additive(indexFence.body.replace('export const CHUNK_LEN = 64;\n', ''));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain('CHUNK_LEN');
  });

  it('reordered lines fail', () => {
    const a = 'export const CHUNK_LEN = 64;\n';
    const b = 'export const CHUNK_LIMIT = 2 ** 48 - 1024;   // warp refuses chunk >= this; the headroom keeps rows ahead of the camera below 2^53\n';
    expect(indexFence.body).toContain(a);
    expect(indexFence.body).toContain(b);
    const swapped = indexFence.body.replace(a, '@@A@@').replace(b, a).replace('@@A@@', b);
    expect(additive(swapped).ok).toBe(false);
  });

  it('a changed type fails', () => {
    const line = 'export interface Travel { chunk: number; local: number }';
    expect(indexFence.body).toContain(line);
    expect(additive(indexFence.body.replace(line, 'export interface Travel { chunk: bigint; local: number }')).ok).toBe(false);
  });

  it('an added line passes and is counted', () => {
    const r = additive(indexFence.body.replace('export const CHUNK_LEN = 64;\n', 'export const CHUNK_LEN = 64;\nexport const NEW_THING = 1;\n'));
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1);
  });

  it('a changed FOG_END passes, T11 numeric exception', () => {
    expect(additive(indexFence.body.replace('export const FOG_END = 4300;', 'export const FOG_END = 4100;')).ok).toBe(true);
  });

  it('a changed FOG_START passes, T11 numeric exception', () => {
    expect(additive(indexFence.body.replace('export const FOG_START = 1500;', 'export const FOG_START = 1400;')).ok).toBe(true);
  });

  it('a changed DEFAULT_SEED passes, T11 numeric exception', () => {
    const r = additive(indexFence.body.replace('export const DEFAULT_SEED = 155;', 'export const DEFAULT_SEED = 2084;'));
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
  });

  it('a changed CHUNK_LEN fails', () => {
    expect(additive(indexFence.body.replace('export const CHUNK_LEN = 64;', 'export const CHUNK_LEN = 128;')).ok).toBe(false);
  });

  it('an allowlisted name changed to a non-number fails', () => {
    expect(additive(indexFence.body.replace('export const FOG_END = 4300;', "export const FOG_END = 'far';")).ok).toBe(false);
  });
});

describe('hero.glsl hand-off', () => {
  it('passes the unchanged text', () => {
    expect(checkHero(heroFence.body).ok).toBe(true);
  });

  it('an altered sunDisc signature fails', () => {
    const r = checkHero(heroFence.body.replace('vec4 sunDisc(vec3 rd, float yScale) {', 'vec4 sunDisc(vec3 rd) {'));
    expect(r.ok).toBe(false);
  });

  it('an altered sunDisc body passes', () => {
    const r = checkHero(heroFence.body.replace('float e = max(d - 1., 0.);', 'float e = max(d - 1.2, 0.);'));
    expect(r.ok).toBe(true);
  });

  it.each(HERO_SIGNATURE)('removing the line %s fails', (line) => {
    expect(heroFence.body).toContain(line);
    expect(checkHero(heroFence.body.replace(line, '')).ok).toBe(false);
  });
});
