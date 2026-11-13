// The cockpit's fragment path (T13). After COMMON_FRAG and neon.glsl. Dark bodies with neon edges, in the sector's own
// palette, like the ship. All emission goes through emit. The derivative work (edgeLines) comes first; vPart is flat, so
// the selection below is constant across a primitive and every branch rejoins.
in vec4 vEdge;
flat in float vPart;
uniform vec4 uCockpit;           // w: blink, 1 or the ship's ghost blink
uniform float uEdgeW;            // line half-width, in cockpit units

void main() {
  float lines = edgeLines(vEdge, uEdgeW);
  vec3 grid = uPal[5], accent = uPal[6];
  // part: 0 dashboard, 1 panel glass, 2 trim, 3 wheel, 4 glove, 5 sleeve, 6 pillar, 7 roof, which is lit as the
  // dashboard is. Body and edge luminance per part.
  float bodyL = .010, edgeL = .85;
  vec3 edgeTint = grid;
  if (vPart > .5 && vPart < 1.5) { bodyL = .003; edgeL = 1.; edgeTint = accent; }
  else if (vPart > 1.5 && vPart < 2.5) { bodyL = .018; edgeL = .5; }
  else if (vPart > 2.5 && vPart < 3.5) { bodyL = .03; edgeL = 1.3; edgeTint = mix(accent, vec3(1.), .6); }
  else if (vPart > 3.5 && vPart < 4.5) { bodyL = .045; edgeL = .8; edgeTint = accent; }
  else if (vPart > 4.5 && vPart < 5.5) { bodyL = .022; edgeL = .45; }
  else if (vPart > 5.5 && vPart < 6.5) { bodyL = .008; edgeL = .6; }
  vec3 c = emit(uPal[0], bodyL) + emit(edgeTint, edgeL * uCockpit.w) * lines;
  gl_FragColor = vec4(c, 1.);
}
