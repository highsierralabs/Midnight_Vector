// The neon filter, shared by every prop fragment. Increasing smoothstep edges and min(max()), per Agents.md.
// e is already multiplied by instance scale, so lw is a world width. Lines stay per edge rather than taking min(e)
// first, because min has a derivative discontinuity along the diagonals.
float edgeLines(vec4 e, float lw) {
  vec4 fw = max(fwidth(e), vec4(1e-5));
#ifdef NAIVE_EDGES
  // The shimmer negative control: a hard step that loses subpixel lines.
  vec4 l = 1. - step(vec4(lw), e);
  return max(max(l.x, l.y), max(l.z, l.w));
#else
  vec4 draw = max(vec4(lw), fw), aa = fw * 1.5;
  vec4 l = (1. - smoothstep(draw - aa, draw + aa, e)) * clamp(vec4(lw) / draw, 0., 1.);
  return max(max(l.x, l.y), max(l.z, l.w));
#endif
}

// A band of half width w around x = 0, in a coordinate with footprint fw. Conserves coverage as fw grows past w, so a
// far pattern fades to its mean rather than sparkling.
float band(float x, float w, float fw) {
#ifdef NAIVE_EDGES
  return 1. - step(w, abs(x));
#endif
  float f = max(fw, 1e-5);
  float draw = max(w, f);
  return (1. - smoothstep(draw - f, draw + f, abs(x))) * min(w / draw, 1.);
}

// How far a pattern has faded to its mean, as its footprint nears its period. The negative control never fades.
float toMean(float fw) {
#ifdef NAIVE_EDGES
  return 0.;
#endif
  return smoothstep(.3, .85, fw);
}

// A part smaller than a pixel dims rather than sparkles.
float cover(float size, float fp) {
#ifdef NAIVE_EDGES
  return 1.;
#endif
  return min(size / fp, 1.);
}

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
