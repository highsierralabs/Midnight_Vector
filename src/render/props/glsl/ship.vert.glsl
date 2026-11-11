// The ship's vertex path. After COMMON_VERT. Position and rotation are uniforms written in frame(). Drawn at render-space z = -SHIP_FORWARD.
in vec4 aEdge; in vec2 aUv; in vec2 aTag;
uniform vec3 uShipPos;      // x, y, z in render space
uniform vec2 uShipRot;      // bank about z, pitch about x
uniform vec2 uShipEngine;   // engine length in [0, 1], flicker
uniform float uShipBlink;
out vec4 vEdge; out vec2 vUv; out vec3 vRel; out vec3 vLocal; out float vParam;
flat out vec4 vI; flat out vec4 vJ; flat out float vPart;

void main() {
  vec3 l = position;
  float part = aTag.x, param = aTag.y;
#ifdef SHIP_GLOW
  // The cones stretch backward with engine length.
  float stretch = (.5 + 2.4 * uShipEngine.x) * uShipEngine.y;
  l.z = 2.18 + (l.z - 2.18) * stretch;
#endif
  vLocal = l;
  float cb = cos(uShipRot.x), sb = sin(uShipRot.x);
  l.xy = vec2(cb * l.x - sb * l.y, sb * l.x + cb * l.y);
  float cp = cos(uShipRot.y), sp = sin(uShipRot.y);
  l.yz = vec2(cp * l.y + sp * l.z, -sp * l.y + cp * l.z);
  vec3 p = bendV(uShipPos + l);
  vRel = p - vec3(cameraPosition.xy, 0.);
  vEdge = aEdge;
  vUv = aUv;
  vParam = param;
  vPart = part;
  vI = vec4(0., 0., 1., 0.);
  vJ = vec4(uShipEngine, uShipBlink, 0.);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
