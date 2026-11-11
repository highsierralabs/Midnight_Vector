// src/render/terrain/edgepaint.frag.glsl -- appended to COMMON_FRAG. Paints level 5's whole boundary cell, which is stricter than
// the edge line: green where fogK is exactly 1, red where it is not, DebugPaint.EDGE_INTERIOR elsewhere.
in vec3 vP; in vec2 vGrid; uniform int uLevel;
void main() {
  bool edge = uLevel == 5 && (vGrid.x < 1. || vGrid.x > 127. || vGrid.y > 95.);
  float f = fogK(length(vP - cameraPosition));
  gl_FragColor = !edge ? vec4(.1, .1, .1, 1.) : f >= 1. ? vec4(0., 1., 0., 1.) : vec4(1., 0., 0., 1.);
}
