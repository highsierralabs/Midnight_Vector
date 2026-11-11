// src/contracts/glsl/hero.glsl -- created by T00 with mode 0; ownership passes to T04. Signature frozen.
// Fragment stage only. rd is any finite vector; yScale in (0, 1]. rgb is premultiplied emission including the halo; a is opaque disc coverage. Composite c * (1. - s.a) + s.rgb, never mix(c, s.rgb, s.a).
// Reads only uPhases, uPal and uHero. Everything else this file declares is prefixed hero.
const vec2  HERO_C = vec2(0., .125);
const float HERO_R = .215;
vec4 sunDisc(vec3 rd, float yScale) {
  vec2 g = rd.xy / max(-rd.z, 1e-3); g.y *= yScale;
  vec2 p = (g - HERO_C) / HERO_R;
  float d = length(p), a = fwidth(d) + 1e-4, v = p.y;
  float f = fract(v * 9. + uPhases[1].x), b = fwidth(v) * 9. + 1e-4;
  float w = clamp((.42 - v) / 1.42, 0., 1.); w = .04 + .8 * w * w;
  float band = v > .42 ? 1. : smoothstep(w - b, w + b, abs(f - .5) * 2.);
  float m = (1. - smoothstep(1. - a, 1. + a, d)) * band;
  vec3 s = emit(mix(uPal[4], uPal[3], smoothstep(-.9, .75, v)), 1.05) * m;
  float e = max(d - 1., 0.);
  float halo = exp(-e * 2.4) * .30 + exp(-e * .7) * .10;
  return vec4(s + mix(uPal[4], uPal[2], .5) * halo * (1. - m), m);
}
