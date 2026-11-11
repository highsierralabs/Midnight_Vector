// src/contracts/glsl/common.frag.glsl -- fragment stage only
// Pristine-grid lines (Ben Golus), per axis. Derivatives BEFORE fract. lw < 0.5.
// Written with increasing smoothstep edges: reversed or equal edges are undefined in GLSL.
// min(max()) rather than clamp(): clamp is undefined when its minimum exceeds its maximum,
// and deriv passes .5 across the whole far field.
vec2 pristineLines(vec2 uv, vec2 lw) {
  vec4 dd = vec4(dFdx(uv), dFdy(uv));
  vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
  vec2 draw = min(max(lw, deriv), vec2(.5));
  vec2 aa = deriv * 1.5;
  vec2 g = 1. - abs(fract(uv) * 2. - 1.);
  vec2 l = 1. - smoothstep(draw - aa, draw + aa, g);
  l *= clamp(lw / draw, 0., 1.);
  return mix(l, lw, clamp(deriv * 2. - 1., 0., 1.));
}
float pristineGrid(vec2 uv, vec2 lw) { vec2 l = pristineLines(uv, lw); return mix(l.x, 1., l.y); }
