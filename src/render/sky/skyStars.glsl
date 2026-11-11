// Fine round stars, sized in pixels through the exact inverse Jacobian of the cell coordinates.
// Branch-free on purpose: on D3D11 a hash early-out above the derivative maths drew hollow outlines around lit cells,
// and moving the derivatives above it did not help (Agents.md). Per-axis fwidth stretches stars into dashes near the horizon.
// Peak luminance is at most .85 x .87, under the bloom threshold, so a star cannot bloom-flicker.
uniform float uStarGain, uStarPx, uTwPhase;

vec3 skyStars(vec3 rd) {
  vec2 st = rd.xz / (max(rd.y, 0.) + .35) * 62.;       // max(): rd.y + .35 reaches 0 on screen below the horizon
#ifdef SKY_NAIVE_STARS
  // Negative control: a fixed cell-space radius and a hard step, the torn dashes of section 6.3.
  vec2 ci = floor(st); ivec2 c = ivec2(ci); vec2 f = st - ci;
  float r = skyHash(c, 2U), rs = skyHash(c, 3U);
  float k = step(length(f - .5), .09);
  return step(.93, r) * vec3(.9, .85, 1.) * k * mix(.2, .85, rs) * smoothstep(.015, .25, rd.y) * uStarGain;
#else
  vec2 dx = dFdx(st), dy = dFdy(st);
  float det = dx.x * dy.y - dy.x * dx.y; det += det < 0. ? -1e-9 : 1e-9;
  float cellPx = 1. / sqrt(abs(det));
  vec2 ci = floor(st); ivec2 c = ivec2(ci); vec2 f = st - ci;
  float r = skyHash(c, 2U), rs = skyHash(c, 3U);
  float rpx = min(mix(.8, 1.9, rs) * uStarPx, .45 * cellPx);
  float mar = rpx / cellPx;
  vec2 o = f - .5 - (vec2(skyHash(c, 4U), skyHash(c, 5U)) - .5) * max(1. - 2. * mar, 0.);
  vec2 pp = vec2(dy.y * o.x - dy.x * o.y, dx.x * o.y - dx.y * o.x) / det;   // cell offset to pixels, exact inverse Jacobian
  float k = 1. - smoothstep(rpx * .45, rpx, length(pp));
  float k3 = 1. + floor(skyHash(c, 6U) * 3.);
  float tw = mix(1., .82 + .18 * sin(TAU * (k3 * uTwPhase + skyHash(c, 7U))), step(.979, r));
  return step(.93, r) * vec3(.9, .85, 1.) * k * mix(.14, .85, rs * rs) * tw * smoothstep(.015, .25, rd.y) * uStarGain;
#endif
}
