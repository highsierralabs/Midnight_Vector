// The instance path of every ring. After COMMON_VERT and the generated L_ and M_ constants. Section 6.5.
// Motion runs on the mesh-space position, then yaw, then scale. Nothing here holds an absolute coordinate: zf is a small
// difference, and phases are in [0, 1). One sine and cosine pair serves every motion, and small tilts use small-angle forms:
// SwiftShader runs every branch under a mask, so each trig call here is paid by every vertex in tier 0.
in vec4 aEdge; in vec2 aUv; in vec2 aTag;       // per vertex: edge distances (u), panel uv (u), part id and param
const float THIN_PX = 1.25;                              // the narrowest a thin part is drawn, in pixels (D-002)
// One instance attribute per ring (D-006): 12 floats as four 3-float columns of a mat4, so each column's w is GL's default 1 and
// unused. aInstA, aInstB and aInstC are those 12 floats in order, by swizzle only, assigned first thing in main.
in mat4 aInst;
vec4 aInstA, aInstB, aInstC;
uniform float uMaxDist, uDensity, uDensityWindow, uTrafficFade, uUseYaw, uGrounded, uReduced, uUnitScale, uRingCut, uViewH, uGateOpen;
uniform int uMotion, uSpinPhase, uLook;
uniform float uSpinK;
uniform vec3 uPivot;
uniform vec2 uGateFlash;
out vec4 vEdge; out vec2 vUv; out vec3 vRel; out vec3 vLocal; out float vParam;
flat out vec4 vI; flat out vec4 vJ; flat out float vPart;
#ifdef MIRROR_PROBE
out float vMirY;                                          // A15: the reflected world y, after the flip and before the bend
#endif

void main() {
  aInstA = vec4(aInst[0].xyz, aInst[1].x);
  aInstB = vec4(aInst[1].yz, aInst[2].xy);
  aInstC = vec4(aInst[2].z, aInst[3].xyz);
  vEdge = vec4(1000.); vUv = vec2(0.); vRel = vec3(0.); vLocal = vec3(0.); vParam = 0.; vI = vec4(0.); vJ = vec4(0.); vPart = 0.;
#ifdef MIRROR_PROBE
  vMirY = 0.;
#endif
  float fwd = 0., sMul = 1.;
  if (uMotion == M_TRAFFIC) {
    float f = fract(aInstC.z * phaseAt(7) + aInstB.w);
    fwd = trafficOffset(aInstC.y, aInstC.z, aInstB.w, phaseAt(7));
    sMul = min(1., min(f, 1. - f) / uTrafficFade);
  }
  float zf = rowDelta(aInstA.w) * 64. + aInstA.z + fwd - uTravel.x;
  float md = min(uMaxDist, uFog.y);                       // nothing draws fully fogged, see the plan's decision log
  if (zf < -30. || zf > md || aInstB.z >= uDensity) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float shrink = sMul * (1. - smoothstep(md * .92, md, zf));
  shrink *= min((uDensity - aInstB.z) / uDensityWindow, 1.);   // shrink as the density ramp passes, instead of a pop
  // Past the ship plane a pickup or a drone has done its work, and at the camera it would fill the frame.
  if (uMotion == M_SHARD || uMotion == M_DRONE) shrink *= smoothstep(2., 11., zf);
  // A placeholder item stays a unit box whatever its radius, so a fence's 42 u does not cover the frame.
  float s = (uUnitScale > .5 ? 1. : aInstB.y) * shrink;

  vec3 l = position;
  float part = aTag.x, param = aTag.y, seed = aInstB.w, variant = aInstC.x;
  vec3 origin = vec3(aInstA.x, aInstA.y, -zf);
  float pin = 0.;                                         // 1: this vertex is pinned to the floor
  float edgeScale = s;
  float thin = 1.;                                        // emission divisor for a part widened to a pixel, to the fragment

  // D-002: a part narrower than a pixel rasterizes as a sliver that MSAA 2 covers on some frames and not others. Such parts are
  // drawn at least THIN_PX wide and their emission divided by the widening, so the mean light stays what it was (cover() is
  // unchanged) and only the flicker goes. pxU is a pixel's size in u at this instance's depth.
  float pxU = max(zf, 1.) * 2. / (projectionMatrix[1][1] * uViewH);
#ifndef NAIVE_EDGES
  if (uLook == L_REFLECTOR) {
    // Stick 0.09 u wide, head 0.34 u wide and 0.28 u tall about y = .86, all centred on the mesh's y axis.
    float sc = max(aInstB.y, 1e-3);
    float k = max(1., THIN_PX * pxU / ((part > .5 ? .34 : .09) * sc));
    l.xz *= k;
    thin = 1. / k;
    if (part > .5) {
      float kv = max(1., THIN_PX * pxU / (.28 * sc));
      l.y = .86 + (l.y - .86) * kv;
      thin /= kv;
    }
  }
#endif

  // The one angle: an integer harmonic of the ring's phase, so the wrap cannot pop. A searchlight's seed is its yaw (S-05).
  float spinSeed = uMotion == M_SEARCHLIGHT ? aInstB.x / TAU : seed;
  float spin = TAU * fract(phaseAt(uSpinPhase) * (uReduced > .5 ? 1. : uSpinK) + spinSeed);
  float cs = cos(spin), sn = sin(spin);

  if (uMotion == M_PALM) {
    if (part > .5) {
      float w = param * param;
      l.x += .34 * w * sn;
      l.z += .34 * w * cs;
      l.y += .2 * w * sn * cs * 2.;
    }
  } else if (uMotion == M_CRYSTAL) {
    l.xz = vec2(cs * l.x - sn * l.z, sn * l.x + cs * l.z);
    l.y += .3 * sn;
  } else if (uMotion == M_SHARD) {
    l.xz = vec2(cs * l.x - sn * l.z, sn * l.x + cs * l.z);
  } else if (uMotion == M_SAUCER) {
    // A slight wobble, by small angles.
    float tx = .035 * sn, tz = .035 * cs;
    l = vec3(l.x - tx * l.y, l.y + tx * l.x + tz * l.z, l.z - tz * l.y);
  } else if (uMotion == M_SAUCER_BEAM) {
    if (variant >= .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  } else if (uMotion == M_SEARCHLIGHT) {
    // Always leaning away from x = 0. searchlightLean in archetypes.ts is .34 + .2 * sn, in [.14, .54], where the series below is good to .2%.
    float lean = .34 + .2 * sn;
    float dir = aInstA.x < 0. ? -1. : 1.;
    float cl = 1. - lean * lean * .5, sl = dir * lean * (1. - lean * lean / 6.);
    vec3 n = vec3(position.x, 0., position.z);
    float tilt = .1 * cs;
    l = vec3(cl * l.x + sl * l.y, cl * l.y - sl * l.x, l.z);
    l = vec3(l.x, l.y - tilt * l.z, l.z + tilt * l.y);
    n = vec3(cl * n.x, -sl * n.x - tilt * n.z, n.z);
    vLocal = n;
  } else if (uMotion == M_TURBINE) {
    if (part > .5 && part < 1.5) {
      vec2 r = l.xy - uPivot.xy;
      l.xy = vec2(cs * r.x - sn * r.y, sn * r.x + cs * r.y) + uPivot.xy;
    }
  } else if (uMotion == M_PYLON) {
    if (part > 1.5 && floor(variant * 2.) < .5) {
      // No next pylon: collapse the wires onto their crossarm tips.
      l.y += param;
      l.z = 0.;
    }
  } else if (uMotion == M_ARCOLOGY) {
    if (part > 2.5 && variant < .4) l.y = min(l.y, param);
  } else if (uMotion == M_GATE || uMotion == M_SPIKE) {
    pin = param;
  } else if (uMotion == M_DRONE) {
    origin.x += droneOffset(aInstC.y, aInstC.z, aInstB.w, phaseAt(3));
  } else if (uMotion == M_FENCE) {
    // FENCE is laid out from its record: x span centre, radius half-width, gap centre a, gap half-width b. y absolute.
    float R = aInstC.w, gc = aInstC.y - aInstA.x, gh = aInstC.z;
    origin.y = 0.;
    if (part < .5) l.x = -R + l.x;
    else if (part < 1.5) l.x = R + l.x;
    else if (part < 2.5) {
      float x0 = -R, x1 = max(gc - gh, x0);
      l.x = mix(x0, x1, position.x);
      vUv = vec2(x1 - l.x, l.y);
    } else {
      float x0 = min(gc + gh, R), x1 = R;
      l.x = mix(x1, x0, position.x);
      vUv = vec2(l.x - x0, l.y);
    }
    s = shrink;
    edgeScale = shrink;
  }

  if (uMotion != M_FENCE || part < 1.5) vUv = aUv;
  if (uMotion == M_SAUCER_BEAM) vLocal = vec3(position.x, 0., position.z);
  else if (uMotion != M_SEARCHLIGHT) vLocal = l;

  // DI-113, replacing DI-110's rule. Once the ship's tail has passed a gate's front face (uGateOpen: the ship's depth ahead of the
  // camera less SHIP_HALF_LENGTH, 11.8 u by default), the ring opens out about the camera's line of travel by gateK, 1 to 7. Each
  // member is first thinned across its band by 1 / gateK, so it leaves the frame at the width it had and is never magnified: DI-110
  // scaled whole members, and one the camera passed close to became a wall over 40 to 90% of the frame (T11 final3, frame 2190).
  // DI-115: each step is written to be exactly the identity while gateK is 1 (gateU 0), so a gate the ship has not reached takes
  // the same arithmetic as before DI-110. On this GPU the stills still differ from final2's by up to 9.4e-5 (W3), cause not
  // traced (DI-116), so this holds for the arithmetic, not for every pixel.
  float gateK = 1.;
  vec4 edgeK = vec4(1.);
  if (uMotion == M_GATE) {
    gateK = 1. + 6. * (1. - smoothstep(uGateOpen - 5.8, uGateOpen, zf));
    float gateU = 1. - 1. / gateK;                        // how far each member is thinned: 0 at gateK 1, 6/7 at gateK 7
    if (part < 1.5) {
      // Ring vertices lie on the octagon's corner directions, at the inner radius 1 / cos(pi / 8) or the outer 1.14 times it.
      // Each moves along its own direction toward the band's mid-line, which keeps the panels planar and the corners joined.
      float r = length(l.xy);
      const float GATE_MID = 1.1581597;                  // 1.07 / cos(pi / 8): the mean of the two radii
      l.xy *= 1. - (1. - GATE_MID / r) * gateU;
      // Front panel edges: x and z are the seams, along the member, so they open with the ring; y and w are the outer and inner
      // edges, across the band, which the thinning cancels. The inner band's edges run in z, which nothing here scales.
      if (part < .5) edgeK = vec4(gateK, 1., gateK, 1.);
    }
    // DI-118: the gate has no legs (the operator's fix at T11's review), so DI-115's leg branch is gone with them.
  }

  if (uUseYaw > .5) {
    float cy = cos(aInstB.x), sy = sin(aInstB.x);
    l = vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
  }
  l *= s;

  vec3 p = origin + l;
  if (pin > .5) p.y = 0.;
  // DI-113: the opening itself, about the line through the camera parallel to z. Every point moves away from that line, so a member
  // that does not already cover it never crosses it, and the thinning above holds each member's width as it goes.
  if (uMotion == M_GATE) p.xy += (p.xy - cameraPosition.xy) * (gateK - 1.);
  // RING is cut at the floor. A vertex below y = 0 moves onto the line where the tube's centre plane meets the floor, so a triangle
  // wholly below has zero area and one across the floor ends on that line. Nothing is left under the floor to block the sky behind
  // its alpha, where a dark lower arc used to show (plan section 10). Off only in a sheet tile with no floor (uRingCut).
  if (uLook == L_RING && uRingCut > .5 && p.y < 0.) { p.y = 0.; p.z = origin.z; }
#ifdef CLIP_ROOTS
  if (uGrounded > .5) p.y = max(p.y, origin.y);
#endif
#ifdef MIRROR
  if (abs(aInstA.x) > 125.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  // Clamp first: a buried root must not flip above the floor. A flattened root sits a hair under the floor plane, by an amount
  // that differs per instance, so two flattened roots never tie in depth.
  p.y = p.y < 0. ? -(.004 + .03 * seed) : -p.y;
#ifdef MIRROR_PROBE
  vMirY = p.y;
#endif
#endif
  p = bendV(p);                                           // flip before bend, so the reflection plane bends with the floor
  vRel = p - vec3(cameraPosition.xy, 0.);
  vEdge = aEdge * edgeScale * edgeK;
  vParam = param;
  vPart = part;
  vI = vec4(seed, variant, aInstB.y, mod(aInstA.w, 64.) * 64. + aInstA.z);
  vJ = aInstC;
  if (uLook == L_REFLECTOR) vJ.z = thin;                  // a prop's aInstC.z is 0 and unused
  if (uMotion == M_GATE) {
    vJ.x = abs(aInstA.w - uGateFlash.x) < .5 ? uGateFlash.y : 0.;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
