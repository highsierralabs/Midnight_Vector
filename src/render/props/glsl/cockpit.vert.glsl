// The cockpit's vertex path (T13). After the generated COCKPIT_ constants and COMMON_VERT. The mesh is flat and already in
// cockpit units of the stage (src/core/cockpit.ts): x from the centre, y from the bottom edge. Nothing here is a world
// position, so there is no bend, no travel and no view matrix: the cockpit is fixed to the eye, and the world moves behind it.
in vec4 aEdge; in vec2 aTag;     // edge distances in cockpit units; part id and rig (1 moves with the wheel, 0 stays)
uniform vec4 uCockpit;           // x, y: one cockpit unit in clip units (2u / W, 2u / H); z: cockpitIn in [0, 1]; w: blink
uniform vec2 uYoke;              // turn and pull, each in [-1, 1]: + is right, + is toward the pilot
out vec4 vEdge;
flat out float vPart;

void main() {
  vec2 q = position.xy;
  float rig = aTag.y;
  // The wheel turns about its hub, clockwise for right, and a pull brings it toward the eye: a scale about the eye line,
  // which is what moving a wheel that faces the pilot along the view does in perspective.
  float a = -uYoke.x * COCKPIT_TURN;
  float c = cos(a), s = sin(a);
  vec2 r = q - COCKPIT_HUB;
  vec2 t = COCKPIT_HUB + vec2(c * r.x - s * r.y, s * r.x + c * r.y);
  float k = 1. + COCKPIT_PULL * uYoke.y;
  t = COCKPIT_EYE + (t - COCKPIT_EYE) * k;
  q = mix(q, t, rig);
  // Arriving, the cockpit closes in from outside the frame, about the eye line, as it does when the camera flies into the
  // canopy from behind. At cockpitIn 1 this is exactly 1.
  float kIn = 1. + COCKPIT_ZOOM * (1. - uCockpit.z);
  q = COCKPIT_EYE + (q - COCKPIT_EYE) * kIn;
  vEdge = aEdge * (kIn * mix(1., k, rig));
  vPart = aTag.x;
  gl_Position = vec4(q.x * uCockpit.x, q.y * uCockpit.y - 1., 0., 1.);
}
