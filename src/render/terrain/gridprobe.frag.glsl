// src/render/terrain/gridprobe.frag.glsl -- appended to COMMON_FRAG and grid.glsl. Raw grid coverage at line width .04, for the row
// statistics of section 6.4. The default runs the floor's own gridLines, so a change to it moves these rows; the defines are the
// known-bad variants, the negative controls.
in vec3 vL; in float vF;
#if defined(PROBE_AFTER_FRACT)
// The bug Agents.md names: pristineLines given fract(uv), so its derivatives jump at every wrap. This is what gridLines would draw if it
// took derivatives after fract, and it must fail the pristine gate.
float probe(vec2 uv) { vec2 l = pristineLines(fract(uv), vec2(.04)); return mix(l.x, 1., l.y); }
#elif defined(PROBE_UNFADED)
// A width from derivatives taken after fract, with none of pristineLines' fade to mean coverage, so far rows read far too bright.
float probe(vec2 uv) {
  vec2 lw = vec2(.04);
  vec2 w = fwidth(fract(uv)) + 1e-6;
  vec2 g = 1. - abs(fract(uv) * 2. - 1.);
  vec2 l = 1. - smoothstep(lw - w, lw + w, g);
  return mix(l.x, 1., l.y);
}
#elif defined(PROBE_HARD_STEP)
// A hard threshold: no filtering at all, so distant rows alias.
float probe(vec2 uv) {
  vec2 g = 1. - abs(fract(uv) * 2. - 1.);
  vec2 l = step(g, vec2(.04));
  return mix(l.x, 1., l.y);
}
#else
// The floor's line function, combined as the contract's pristineGrid combines pristineLines.
float probe(vec2 uv) { vec2 l = gridLines(uv, vec2(.04)); return mix(l.x, 1., l.y); }
#endif
void main() {
  float v = probe(vec2(vL.x, vF + uTravel.x) / 8.);
  gl_FragColor = vec4(v, v, v, 1.);
}
