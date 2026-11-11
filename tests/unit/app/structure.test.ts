// A7's structural half: R1 cannot be skipped by a mode, because the only sim.step sits in one function with no
// condition, and the frame body has no allocation syntax.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOOP = readFileSync(resolve('src/app/loop.ts'), 'utf8');

function functionBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `function ${name} exists`).toBeGreaterThanOrEqual(0);
  let i = src.indexOf('{', at);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

/** The source with line and block comments removed, so a comment cannot hide or fake a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('loop.ts structure', () => {
  it('has exactly one .step( call, inside advanceSim, which has no if', () => {
    const all = code(LOOP);
    expect(all.match(/\.step\(/g)?.length).toBe(1);
    const adv = code(functionBody(LOOP, 'advanceSim'));
    expect(adv).toContain('.step(');
    expect(adv).not.toMatch(/\bif\b/);
    expect(adv).not.toMatch(/\?/);
  });

  it('advanceSim is called unconditionally by onFrame and runFrame, and never by renderState', () => {
    for (const name of ['onFrame', 'runFrame']) {
      const body = code(functionBody(LOOP, name));
      const line = body.split('\n').find((l) => l.includes('advanceSim('));
      expect(line, `${name} calls advanceSim`).toBeDefined();
      expect(line!.trim()).toBe('advanceSim();');
    }
    expect(code(functionBody(LOOP, 'renderState'))).not.toContain('advanceSim(');
  });

  it('has no new, map, slice, subarray, template string or arrow function between BODY START and BODY END', () => {
    const a = LOOP.indexOf('// BODY START');
    const b = LOOP.indexOf('// BODY END');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const body = code(LOOP.slice(a, b));
    for (const banned of ['new ', '.map(', '.slice(', '.subarray(', '`', '=>', '...']) {
      expect(body.includes(banned), `found ${banned} in the frame body`).toBe(false);
    }
  });

  it('every entry point is in the body: onFrame, runFrame, renderState, advanceSim', () => {
    const a = LOOP.indexOf('// BODY START');
    const b = LOOP.indexOf('// BODY END');
    const body = LOOP.slice(a, b);
    for (const name of ['onFrame', 'runFrame', 'renderState', 'advanceSim', 'drawStep', 'tailStep', 'cameraStep', 'zoneStep']) {
      expect(body).toContain(`function ${name}(`);
    }
  });

  it('never reads THREE.Clock or a wall clock', () => {
    const all = code(LOOP);
    expect(all).not.toMatch(/\bClock\b|performance\.now|Date\.now/);
  });
});
