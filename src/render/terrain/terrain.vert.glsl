// src/render/terrain/terrain.vert.glsl -- appended to COMMON_VERT. One program for all six levels (section 6.4).
uniform highp sampler2D uH;
uniform int uLevel, uBaseMod;
uniform float uS, uHalfW, uForward, uDrop, uMorphFloor;
uniform float uRowOffset[1];   // one element: an array uniform uploads from a typed array, so the per-frame write allocates nothing
out vec3 vP; out vec3 vL; out float vH; out float vF; out vec2 vGrid;
void main() {
  // Both operands are non-negative: position.y in 0..96, uBaseMod in [0, 128).
  int slot = (int(position.y) + uBaseMod) % 128;
  vec4 t = texelFetch(uH, ivec2(int(position.x), slot + uLevel * 128), 0);
  float x = (position.x - 64.) * uS, zf = position.y * uS + uRowOffset[0];
  float m = max(smoothstep(.6, .9, max(abs(x) / uHalfW, zf / uForward)), uMorphFloor);
  float h = mix(t.r, t.g, m);
  vec3 p0 = vec3(x, h - uDrop, -zf);
  vec3 p = bendV(p0);
  vP = p; vL = p0; vH = h; vF = zf; vGrid = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
