// Sky events. All parameters come from events.ts, a pure function of tick and zone. No state lives here.
uniform vec2 uAuP;
uniform float uAurora, uBoltK, uBoltX[9];

vec3 skyAurora(vec2 g) {
  float x = g.x;
  float w = sin(x * 2.1 + TAU * uAuP.x) * .11 + sin(x * 5.3 - TAU * 2. * uAuP.x + 1.3) * .045;
  float h = g.y - (.40 + w);
  float body = smoothstep(0., .06, h) * exp(-max(h, 0.) * 4.2);
  float rays = .55 + .45 * sin(x * 43. + sin(x * 17. + TAU * uAuP.y) * 2.2 + TAU * 2. * uAuP.y);
  rays *= .7 + .3 * sin(x * 97. + TAU * 3. * uAuP.y + sin(x * 31.) * 1.5);
  // Toward the dim mid sky colour, which emit() lifts to the same luminance, so the hue turns while saturation holds. The horizon or disc colours cross grey on several palettes.
  return emit(mix(uPal[6], uPal[1], clamp(h * 2.6, 0., .7)), .30) * body * rays * uAurora;
}

vec3 skyMeteor(vec2 g, vec4 m, float k, float pxw) {           // m.xy head, m.zw tail
  vec2 a = m.zw, ba = m.xy - a;
  float t = clamp(dot(g - a, ba) / max(dot(ba, ba), 1e-6), 0., 1.), d = length(g - a - ba * t);
  float w = mix(.35, 1.15, t) * pxw;
  return emit(mix(uPal[6], vec3(1.), .45), 1.9) * (1. - smoothstep(w, w + 1.4 * pxw, d)) * t * t * k;
}

vec3 skyBolt(vec2 g, float pxw) {
  // B is under the crest, so the horizon rule and the floor end the bolt rather than a cut in the air. Branch-free.
  const float T = .74, B = -.04;
  float t = (T - g.y) / (T - B), ends = smoothstep(0., .03, t) * (1. - smoothstep(.97, 1., t));
  float fi = clamp(t, 0., 1.) * 8.; int i = int(min(floor(fi), 7.));
  float xb = mix(uBoltX[i], uBoltX[i + 1], fi - float(i));
  // Fine jitter over the nine points, or they read as a rendered polyline at 1080p. The first point seeds it, so each strike differs.
  float xj = xb + (skyVn(vec2(t * 46., uBoltX[0] * 37.)) - .5) * .026 + (skyVn(vec2(t * 131., uBoltX[0] * 53.)) - .5) * .009;
  float d = abs(g.x - xj), w = mix(.6, 1.5, clamp(t, 0., 1.)) * pxw;   // thickens toward the ground
  float l = 1. - smoothstep(w, w + 1.6 * pxw, d);
  // The glow follows the unjittered path, or each row's offset shows as a horizontal streak.
  return (emit(mix(uPal[6], vec3(1.), .55), 2.2) * l + emit(uPal[6], .5) * exp(-abs(g.x - xb) * 34.) * .20) * uBoltK * ends;
}
