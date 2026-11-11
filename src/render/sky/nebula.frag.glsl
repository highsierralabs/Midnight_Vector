// Domain-warped fbm into a half-float target. It stores densities, not colour, so a palette crossfade needs no re-render.
// The domain is |g.x| <= 1.8 and g.y from -.05 to .95, which holds every visible direction up to the section 6.4 cap.
// d1 and d2 move only by integer harmonics of the 256 s phase, so the wrap cannot pop.
in vec2 vUv;
void main() {
  vec2 g = vec2((vUv.x - .5) * 3.6, vUv.y - .05);
  vec3 rd = normalize(vec3(g, -1.));
  vec2 q = rd.xz / (rd.y + .35);
  float ph = TAU * phaseAt(7);
  vec2 d1 = .10 * vec2(cos(ph), sin(ph)), d2 = .06 * vec2(cos(2. * ph + 1.), -sin(2. * ph + 1.));
  float w = skyFbm(q * 1.3 + d1);
  float ne = skyFbm(q * 2.1 + w * 1.6 + d2);
  float fil = skyFbm(q * 5.3 - w * 2.2 - d1 * 2.);
  gl_FragColor = vec4(ne, fil, w, 1.);
}
