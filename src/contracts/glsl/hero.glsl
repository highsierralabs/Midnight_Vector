// Hero disc: four modes behind one frozen signature. rgb is premultiplied emission including the halo; a is disc coverage. Composite c * (1. - s.a) + s.rgb, never mix(c, s.rgb, s.a).
// Fragment stage only. rd is any finite vector; yScale in (0, 1]. Reads only uPhases, uPal and uHero. Every symbol except sunDisc is prefixed hero. sunDisc takes fwidth(d) and fwidth(v) before the mode branch; heroPlanet's fwidth and heroMoon's pristineLines run inside it, which is legal because the branch is on a uniform (DI-63).
const vec2  HERO_C = vec2(0., .125);
const float HERO_R = .215;

vec3 heroHaloColor() { return mix(uPal[4], uPal[2], .5); }

vec4 heroSun(float d, float a, float v, float b) {
  float f = fract(v * 9. + uPhases[1].x);
  float w = clamp((.42 - v) / 1.42, 0., 1.); w = .04 + .8 * w * w;
  float band = v > .42 ? 1. : smoothstep(w - b, w + b, abs(f - .5) * 2.);
  float m = (1. - smoothstep(1. - a, 1. + a, d)) * band;
  vec3 s = emit(mix(uPal[4], uPal[3], smoothstep(-.9, .75, v)), 1.05) * m;
  float e = max(d - 1., 0.);
  float halo = exp(-e * 2.4) * .30 + exp(-e * .7) * .10;
  return vec4(s + heroHaloColor() * halo * (1. - m), m);
}

vec4 heroEclipse(vec3 rd, vec2 p, float d, float a) {
  float m = 1. - smoothstep(1. - a, 1. + a, d);
  float e = max(d - 1., 0.);
  float th = atan(p.y, p.x + 1e-7);            // no derivative of th anywhere: its seam would show
  float ph = phaseAt(6);
  float s1 = sin(th * 5. + TAU * ph) * .45 + sin(th * 11. - TAU * 2. * ph + 1.7) * .33 + sin(th * 23. + TAU * 3. * ph + .6) * .22;
  float st = .5 + .5 * s1;
  float corona = exp(-e * (6.5 - 4.3 * st));
  float ring = exp(-abs(d - 1.) / (.022 + a));
  // A large painted glow, so sky plus corona stays under the bloom threshold. Over it, on a bright horizon (Toxic Arcade, Arctic Laser), a wide area bloomed and showed a contour.
  float skyL = dot(skyGrad(rd.y / max(length(rd), 1e-6)), W709);
  vec3 cor = emit(mix(uPal[2], uPal[4], clamp(e * .9, 0., 1.)), .54 * (1. - smoothstep(.15, .6, skyL)) + .08);
  vec3 rgb = emit(mix(uPal[3], uPal[2], .2), 1.5) * ring + cor * corona * (1. - m) + uPal[0] * .35 * m;
  rgb += heroHaloColor() * exp(-e * .7) * .10 * (1. - m);
  return vec4(rgb, m);
}

vec4 heroPlanet(vec2 p, float d, float a) {
  const float RB = .66;
  const float C = .9553, S = -.2955;           // tilt -0.3 rad
  vec2 q = vec2(C * p.x - S * p.y, S * p.x + C * p.y);
  float r = length(vec2(q.x, q.y / .25));
  float ar = fwidth(r) + 1e-4;
  float s1 = smoothstep(.98 - ar, .98 + ar, r) * (1. - smoothstep(1.2 - ar, 1.2 + ar, r));
  float s2 = smoothstep(1.26 - ar, 1.26 + ar, r) * (1. - smoothstep(1.52 - ar, 1.52 + ar, r));
  float s3 = smoothstep(1.58 - ar, 1.58 + ar, r) * (1. - smoothstep(1.68 - ar, 1.68 + ar, r));
  float strip = s1 + s2 * .75 + s3 * .5;       // brightness falls outward
  float edge = exp(-abs(r - 1.68) / (.012 + ar)) + exp(-abs(r - .98) / (.012 + ar));
  float mb = 1. - smoothstep(RB - a, RB + a, d);
  float front = 1. - smoothstep(-ar, ar, q.y);
  float ringVis = 1. - mb * (1. - front);
  float nz = sqrt(max(1. - d * d / (RB * RB), 0.));
  float lat = q.y / RB;
  float bands = .5 + .5 * sin(lat * 15. + sin(q.x * 3.1 + TAU * phaseAt(7)) * .55);
  vec3 bodyC = mix(uPal[4], uPal[3], clamp(lat * .55 + .5 + (bands - .5) * .5, 0., 1.));
  vec3 body = emit(bodyC, 1.05) * (.42 + .58 * nz);
  vec3 ringC = emit(uPal[6], .34) * strip + emit(uPal[6], 1.5) * edge;
  float ringA = clamp((s1 + s2 + s3) * .96, 0., 1.);   // coverage does not: a complementary sky bleeding through a thin band reads as grey
  float cov = max(mb * (1. - front * ringA), ringA * ringVis);
  vec3 rgb = body * mb * (1. - front * ringA) + ringC * ringVis;
  float e0 = max(d / RB - 1., 0.), e = max(d - 1., 0.);
  rgb += heroHaloColor() * (exp(-e0 * 2.4) * .22 + exp(-e * .7) * .10) * (1. - cov);
  return vec4(rgb, cov);
}

vec4 heroMoon(vec2 p, float d, float a) {
  float m = 1. - smoothstep(1. - a, 1. + a, d);
  float e = max(d - 1., 0.);
  float z = sqrt(max(1. - d * d, 0.));
  const float CT = .9394, ST = .3429;          // forward tilt .35 rad
  const float CR = .9689, SR = -.2474;         // roll -.25 rad
  vec3 n = vec3(CR * p.x - SR * p.y, SR * p.x + CR * p.y, z);
  n = vec3(n.x, CT * n.y - ST * n.z, ST * n.y + CT * n.z);
  vec2 uv = vec2(atan(n.x, n.z + 1e-7) / TAU * 18. + 18. * phaseAt(7), asin(clamp(n.y, -1., 1.)) / 3.14159265 * 12.);
  vec2 l = pristineLines(uv, vec2(.045));
  float wire = max(l.x, l.y) * smoothstep(0., .25, z);
  float rim = exp(-abs(d - 1.) / (.014 + a));
  vec3 rgb = emit(uPal[5], 1.45) * wire * m + emit(mix(uPal[5], uPal[3], .4), 1.6) * rim + uPal[0] * .55 * m;
  rgb += heroHaloColor() * (exp(-e * 3.2) * .20 + exp(-e * .7) * .10) * (1. - m);
  return vec4(rgb, m);
}

vec4 heroEval(int mode, vec3 rd, vec2 p, float d, float a, float v, float b) {
  vec4 r;
  if (mode == 1) r = heroEclipse(rd, p, d, a);
  else if (mode == 2) r = heroPlanet(p, d, a);
  else if (mode == 3) r = heroMoon(p, d, a);
  else r = heroSun(d, a, v, b);
  return r;
}

vec4 sunDisc(vec3 rd, float yScale) {
  vec2 g = rd.xy / max(-rd.z, 1e-3); g.y *= yScale;
  vec2 p = (g - HERO_C) / HERO_R;
  float d = length(p), a = fwidth(d) + 1e-4, v = p.y;
  float b = fwidth(v) * 9. + 1e-4;
#ifdef HERO_SUN_ONLY
  // A material that defines this gets mode 0's sun in every mode, with no wipe. SwiftShader runs every mode under the
  // uniform branch, so tier 0 on software compiles the others out (section 9.2, D-007). Mode 0's output is unchanged.
  return heroSun(d, a, v, b);
#else
  int ma = int(uHero.x + .5), mb = int(uHero.y + .5);
  vec4 A = heroEval(ma, rd, p, d, a, v, b);
  if (uHero.z <= 0. || ma == mb) return A;
  vec4 B = heroEval(mb, rd, p, d, a, v, b);
  if (uHero.z >= 1.) return B;
  // A soft wipe rising through the disc. Every mode's opaque part lies within |v| < 2, but sky is visible up to v = 2.91 at FOV 68 (DI-44).
  float th = mix(-2.2, 3.4, uHero.z);
  float k = 1. - smoothstep(th - .6, th + .6, v);
  // Directions the wipe never reaches, such as a chrome orb's reflection of the zenith, would change in one frame at either end. They fade over the first and last tenth instead. No visible sky is that low or that high by then.
  k = max(min(k, smoothstep(0., .1, uHero.z)), smoothstep(.9, 1., uHero.z));
  return mix(A, B, k);
#endif
}
