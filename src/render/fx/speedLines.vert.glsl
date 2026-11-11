#define LINE_PERIOD 256.
uniform float uLineLen; uniform vec2 uLineCam;
in vec4 aSeed;           // angle, radius, forward, rank; each in [0, 1)
out float vEdge; out float vAlong; out float vFade; out float vRank; out vec3 vRel;
void main() {
  float fwd = mod(aSeed.z * LINE_PERIOD - uTravel.y, LINE_PERIOD);   // approaches as travel rises; no accumulator
  float ang = TAU * aSeed.x, rad = 14. + 76. * aSeed.y;
  vec2 off = vec2(cos(ang), .55 * sin(ang) + .25) * rad;
  float y = max(.5, uLineCam.y + off.y);
  vec3 pa = bendV(vec3(uLineCam.x + off.x, y, -fwd));
  vec3 pb = bendV(vec3(uLineCam.x + off.x, y, -(fwd + uLineLen)));
  vec3 va = (viewMatrix * vec4(pa, 1.)).xyz, vb = (viewMatrix * vec4(pb, 1.)).xyz;
  vec3 v = mix(va, vb, position.y);
  v += normalize(cross(vb - va, v)) * position.x * (.02 + .0016 * -v.z);
  vRel = mix(pa, pb, position.y) - vec3(uLineCam, 0.);
  vEdge = position.x; vAlong = position.y; vRank = aSeed.w;
  vFade = smoothstep(2., 14., fwd) * (1. - smoothstep(170., 256., fwd));
  gl_Position = projectionMatrix * vec4(v, 1.);
}
