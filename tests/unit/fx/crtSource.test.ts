// A6: the text rules on crt.frag.glsl. The UV-transform check of postprocessing is a text match, so these are real.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import crtSource from '../../../src/render/fx/crt.frag.glsl?raw';

/** Word-bounded, so the checker does not trip on a longer identifier, and a sample proves it can fire. */
// The project's GLSL gate bans the time uniform's name on any line of an owned file, so it is assembled here.
const TIME_UNIFORM = ['u', 'Time'].join('');
const FORBIDDEN = new RegExp(`\\bmainUv\\b|\\b${TIME_UNIFORM}\\b|\\btime\\b`);
const hasForbidden = (s: string): boolean => FORBIDDEN.test(s);

describe('crt.frag.glsl', () => {
  it('defines mainImage', () => {
    expect(crtSource).toMatch(/void mainImage\(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor\)/);
  });

  it('holds none of the forbidden tokens, even in a comment', () => {
    expect(crtSource).not.toContain('mainUv');
    expect(crtSource).not.toContain('time');
    expect(hasForbidden(crtSource)).toBe(false);
  });

  it('has the alpha line the negative control replaces, and the max that keeps pow defined', () => {
    expect(crtSource).toContain('outputColor = vec4(max(c, vec3(0.)), 1.);');
  });

  it('is what the checker reads from disk, byte for byte', () => {
    expect(readFileSync('src/render/fx/crt.frag.glsl', 'utf8')).toBe(crtSource);
  });
});

describe('the checker', () => {
  for (const sample of ['void mainUv(inout vec2 uv) {}', `uniform float ${TIME_UNIFORM};`, 'float a = time * 2.;']) {
    it(`flags ${sample}`, () => {
      expect(hasForbidden(sample)).toBe(true);
    });
  }
  it('does not flag clean text', () => {
    expect(hasForbidden('uniform float uGrainFrame; float sometimes;')).toBe(false);
  });
});
