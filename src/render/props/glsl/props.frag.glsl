// One program, selected by uniforms (uLook, uBodyL, uEdgeL, uEdgeW) and a part id. After COMMON_FRAG, neon.glsl and the
// generated constants. All emission goes through emit. Derivatives come first and outside any branch; a uniform branch is
// constant across a primitive, and the only derivatives inside one are sunDisc's and pristineGrid's, in the ORB look.
in vec4 vEdge; in vec2 vUv; in vec3 vRel; in vec3 vLocal; in float vParam;
flat in vec4 vI; flat in vec4 vJ; flat in float vPart;
#ifdef MIRROR_PROBE
in float vMirY;
#endif
uniform int uLook;
uniform float uBodyL, uEdgeL, uEdgeW, uGhost, uHazard, uReduced, uOrbFade;
uniform ivec3 uTint;
uniform vec3 uFlat;

const vec3 HAZARD_RED = vec3(1., .02, .05);

float isPart(float p) { return step(abs(vPart - p), .5); }

vec3 orbColour(vec3 rd, vec3 n, float d) {
  vec3 R = reflect(rd, n);
  vec3 P = vRel + vec3(cameraPosition.xy, 0.);
#ifdef MIRROR
  P.y = -P.y;
#endif
  // T04's rule: never mix, always c * (1 - a) + rgb.
  vec4 sun = sunDisc(vec3(R.xy, -abs(R.z)), 1.);
  vec3 up = skyGrad(max(R.y, 0.)) * (1. - sun.a) + sun.rgb;
  // Below the horizon: hit y = 0, with the grid's own period.
  float t = max(P.y, .01) / max(-R.y, .004);
  vec2 hit = vec2(P.x + R.x * t, -(P.z + R.z * t));
  float g = pristineGrid(vec2(hit.x / 8., (hit.y + uTravel.x) / 8.), vec2(.05));
  // The reflected grid is the part that crawls at range, so it goes first, well before the flat average.
  g *= 1. - uOrbFade * smoothstep(70., 280., d);
  vec3 floorC = uPal[0] * .5 + emit(uPal[5], 1.1) * g;
  floorC = mix(floorC, skyGrad(0.), fogK(t * 4.));
  // D-002: the reflected horizon and the Fresnel rim are steps narrower than a pixel near the silhouette and on small orbs, so each
  // widens with its own footprint, and where the reflected direction turns faster than about .15 rad a pixel the reflection fades
  // toward the flat average it fades to past 300 u. Uniform branch, so these derivatives are defined (see the header).
  float hz = .012;
  float cosv = max(dot(-rd, n), 0.);
  float cosMin = 0.;
  float rk = 0.;
#ifndef NAIVE_EDGES
  hz = max(.012, fwidth(R.y));
  cosMin = .5 * fwidth(cosv);
  rk = smoothstep(.15, .6, length(fwidth(R)));
#endif
  vec3 c = mix(floorC, up, smoothstep(-hz, hz, R.y));
  float F = pow(1. - max(cosv, cosMin), 3.);
  vec3 flatC = mix(skyGrad(.12), uPal[0] * .5, .3);
  c = mix(c, flatC, rk * uOrbFade);
  c += emit(uPal[6], .55) * F;
  // Past 300 u the reflection is noise, so it fades to a flat average (section 6.5).
  return mix(c, flatC, smoothstep(300., 400., d) * uOrbFade);
}

void main() {
  // Derivatives first, before any branch.
  float d = length(vRel);
  vec3 rd = vRel / max(d, 1e-3);
  vec3 dpx = dFdx(vRel), dpy = dFdy(vRel);
  // Not normalize: a vanishing cross product would give NaN, and one NaN pixel floods the bloom chain.
  vec3 fn = cross(dpx, dpy);
  fn /= max(length(fn), 1e-12);
  float fp = max(max(length(dpx), length(dpy)), 1e-5);   // u per pixel
  vec2 fwUv = fwidth(vUv);
  float fwY = fwidth(vLocal.y);
  float lines = edgeLines(vEdge, uEdgeW);
  float seed = vI.x, variant = vI.y, instScale = vI.z, worldMod = vI.w;

  vec3 tint = uPal[uTint[int(min(seed * 3., 2.))]];
  vec3 tint2 = uPal[uTint[1]];
  float edgeL = uEdgeL * (1. - .7 * fogK(d * 1.4));
  vec3 c = uPal[0] * uBodyL;
  vec3 edgeTint = tint;
  float edgeMul = 1.;
  float slow = uReduced;
  float cutHole = 0.;                                     // CUTOUT: 1 inside a reel hole; the discard is main's last statement

#ifdef SHIP_GLOW
  float f = 1. - vParam;
  c = emit(mix(uPal[6], vec3(.9, .95, 1.), isPart(1.) * .6), (.7 + 2.0 * vJ.x) * f * f * vJ.y) * vJ.z;
#else

  if (uLook == L_FLAT) {
    c = uFlat; lines = 0.;
  } else if (uLook == L_PALM) {
    edgeTint = isPart(1.) > .5 ? tint : tint2;
  } else if (uLook == L_CACTUS) {
    edgeTint = tint;
  } else if (uLook == L_REFLECTOR) {
    float ph = slow > .5 ? phaseAt(2) : phaseAt(0);
    float wave = fract(worldMod / 256. - ph);
    float blink = .15 + .85 * smoothstep(0., .08, wave) * (1. - smoothstep(.22, .5, wave));
    // A part narrower than a pixel is drawn wider by props.vert.glsl, and vJ.z is the share of it the part really covers: the fog step
    // below shows the background's proxy over the rest (D-002).
    if (vPart > .5) c = emit(tint, 2.4 * blink * cover(.34, fp));
    else c = emit(tint2, .7 * cover(.14, fp));
    lines = 0.;
  } else if (uLook == L_CHEVRON) {
    if (vPart > .5) {
      float i = vPart - 1.;
      // Amendment CV: a mirrored sign (vJ.z -1) lists its arrows the other way across the world, so the sign flips with it and the
      // lights still run the way the road bends, on both sides.
      float sgn = (uBend.x >= 0. ? 1. : -1.) * (vJ.z < 0. ? -1. : 1.);
      float ph = fract((slow > .5 ? phaseAt(1) : phaseAt(0) * 2.) - sgn * i / 3.);
      float lit = smoothstep(0., .18, ph) * (1. - smoothstep(.4, .75, ph));
      float k = smoothstep(0., 4e-5, abs(uBend.x));
      c += emit(tint, mix(.55, 2.3, lit * (.35 + .65 * k)));
    }
  } else if (uLook == L_BILLBOARD) {
    if (isPart(1.) > .5) {
      vec2 cell = vec2(.95, 1.35);
      vec2 g = (vUv - vec2(.55, .5)) / cell;
      vec2 id = floor(g);
      vec2 fc = fract(g) - .5;
      vec2 fw = fwUv / cell;
      float change = floor(phaseAt(5) * 8.);   // an integer harmonic of phase 5, stepped
      float h = hash21(id + vec2(seed * 91., mod(id.y, 2.) * change * 3.));
      float on = step(.46, h);
      float block = on * band(fc.x, .36, fw.x) * band(fc.y, .32, fw.y);
      float inside = band(vUv.x - 7.4, 6.7, fw.x * cell.x) * band(vUv.y - 3.45, 2.95, fw.y * cell.y);
      float k = toMean(max(fw.x, fw.y));
      float lum = mix(block, .54 * .72 * .64, k) * inside;
      c += emit(tint2, 1.45) * lum;
    } else if (isPart(2.) > .5) {
      edgeTint = tint2;
    }
  } else if (uLook == L_TOTEM) {
    vec3 ptint = uPal[uTint[int(clamp(vPart - 1., 0., 2.))]];
    float u = isPart(1.) > .5 ? vUv.x : vUv.x * (isPart(2.) > .5 ? 7. : 11.);
    float fwu = isPart(1.) > .5 ? fwUv.x : fwUv.x * (isPart(2.) > .5 ? 7. : 11.);
    float z = abs(fract(u / 2.2) * 2. - 1.);
    float f = fract(vUv.y / 1.5 + z * .7);
    float fw = max(fwu / 2.2 * 1.4, fwUv.y / 1.5);
    float s = band(f - .5, .2, fw);
    s = mix(s, .4, toMean(fw));
    c = emit(ptint, .06 + .14 * s);
    edgeTint = ptint;
  } else if (uLook == L_ARCOLOGY) {
    if (vPart > 3.5) {
      // Beacon, and the mast below it.
      float blink = step(.5, fract(phaseAt(3) + seed));
      if (vPart < 4.5) c = emit(HAZARD_RED, (.5 + 1.9 * blink) * cover(.7, fp));
      else c = emit(tint, .9 * cover(.3, fp));
      lines = 0.;
    } else if (abs(fn.y) < .6) {
      // Hashed windows on a 3 u world cell, corrected for the instance's scale.
      vec2 g = vUv * instScale / 3.;
      vec2 id = floor(g);
      vec2 fc = fract(g) - .5;
      float fw = max(fwUv.x, fwUv.y) * instScale / 3.;
      float h = hash21(id + seed * 57.);
      float lit = step(.62, h);
      float toggler = step(.92, fract(h * 7.3));
      lit = mix(lit, step(.5, fract(phaseAt(6) * 8. + h)), toggler);
      float win = lit * band(fc.x, .29, fw) * band(fc.y, .24, fw);
      win = mix(win, .38 * .58 * .48, toMean(fw));
      c += emit(tint2, .88) * win;
    }
  } else if (uLook == L_PYRAMID) {
    if (vPart > .5 && vPart < 1.5) {
      c = emit(uPal[3], 2.4 * cover(2.2, fp));
      lines = 0.;
    } else if (vPart < .5) {
      float f = fract(vLocal.y / 38.6 - (slow > .5 ? phaseAt(2) : phaseAt(1)));
      c += emit(tint, 1.15) * band(f - .5, .012, fwY / 38.6);
    }
  } else if (uLook == L_OBELISK) {
    float f = fract(vLocal.y / 40. - (slow > .5 ? phaseAt(2) : phaseAt(1)));
    edgeMul = 1. + 1.2 * band(f - .5, .05, fwY / 40.);
    if (isPart(1.) > .5) { c += emit(tint2, .5); edgeTint = tint2; edgeMul = 1.25; }
  } else if (uLook == L_PYLON) {
    if (vPart < .5) c = emit(tint, 1.05 * cover(.34, fp));
    else if (vPart < 1.5) c = emit(HAZARD_RED, (.35 + 2.0 * step(.5, fract(phaseAt(3) + seed))) * cover(.6, fp));
    else c = emit(tint, 1. * cover(.2, fp));
    lines = 0.;
  } else if (uLook == L_COLONNADE) {
    if (vPart < .5) {
      float period = .5236;
      float fw = fwUv.x / period;
      float fl = band(fract(vUv.x / period) - .5, .22, fw);
      fl = mix(fl, .44, toMean(fw));
      c = emit(tint, .07) * (1. - .8 * fl);
      float y = vUv.y;
      float rings = max(band(y - .4, .16, fwUv.y), band(y - 9.65, .16, fwUv.y) * step(9., y));
      c += emit(tint, 1.7) * rings * (1. - .7 * fogK(d * 1.4));
    } else if (isPart(1.) > .5) {
      edgeTint = uPal[6];
    } else {
      c = emit(tint, .045);
    }
  } else if (uLook == L_TURBINE) {
    if (vPart > .5) {
      float tip = smoothstep(.82, .93, vParam);
      c = emit(tint, .95 * cover(.5, fp)) + emit(tint2, 2.2 * tip * cover(.4, fp));
      lines = 0.;
    }
  } else if (uLook == L_ORB) {
    vec3 n = normalize(vLocal);
#ifdef MIRROR
    n.y = -n.y;
#endif
    c = orbColour(rd, n, d);
    lines = 0.;
  } else if (uLook == L_CRYSTAL) {
    float F = pow(1. - abs(dot(fn, rd)), 2.);
    c += emit(tint, .1 + .75 * F);
  } else if (uLook == L_SAUCER) {
    // Part 1 is the upper rim band and part 3 the lower, seen from below, which is how a saucer is mostly seen. Each carries the ring of dots.
    if (isPart(1.) > .5 || isPart(3.) > .5) {
      float u = vUv.x * 12.;
      float id = floor(u);
      float fc = fract(u) - .5;
      vec2 q = vec2(fc * 6.2, vUv.y - (isPart(1.) > .5 ? 1.5 : 8.2));
      float on = step(.3, hash21(vec2(id, seed * 41.)));
      float chase = fract((slow > .5 ? phaseAt(1) : phaseAt(0)) - id / 12.);
      float lit = .2 + .8 * smoothstep(.72, 1., chase);
      float aa = max(fp, 1e-4);
      float dotL = 1. - smoothstep(.62 - aa, .62 + aa, length(q));
      c += emit(tint2, 2.3) * dotL * on * lit * cover(1.2, fp);
    } else if (isPart(2.) > .5) {
      c += emit(tint, .22);
    }
  } else if (uLook == L_BEAM) {
    float a = pow(abs(dot(normalize(vLocal), rd)), 1.5);
    float f = 1. - vParam;
    // A beam never washes over the disc: it fades out in the disc's gnomonic neighbourhood, wherever it stands.
    vec2 g = rd.xy / max(-rd.z, 1e-3) - HERO_C;
    float clear = smoothstep(HERO_R, HERO_R + .12, length(g));
    c = emit(tint, uEdgeL * a * f * f * clear);
    lines = 0.;
  } else if (uLook == L_DISH) {
    if (isPart(2.) > .5) { c = emit(tint, 1.8 * cover(.42, fp)); lines = 0.; }
    else if (isPart(3.) > .5) { c = emit(HAZARD_RED, (.4 + 2.0 * step(.5, fract(phaseAt(3) + seed))) * cover(.5, fp)); lines = 0.; }
    else if (isPart(0.) > .5 && vPart < .5) { edgeTint = tint2; }
  } else if (uLook == L_DOME) {
    c += emit(tint, 1.5) * band(vLocal.y - .35, .18, fwY) * (1. - .7 * fogK(d * 1.4));
  } else if (uLook == L_CASSETTE) {
    if (isPart(1.) > .5) {
      vec2 fw = max(fwUv, vec2(1e-5));
      float label = band(vUv.y - 11.9, 2.1, fw.y) * band(vUv.x, 11.2, fw.x);
      float window = band(vUv.y - 6.9, .85, fw.y) * band(vUv.x, 2.0, fw.x);
      c += emit(tint2, .16) * label + emit(tint, 1.) * window;
      float lab = max(band(abs(vUv.y - 11.9) - 2.1, .07, fw.y) * band(vUv.x, 11.2, fw.x),
                      band(abs(vUv.x) - 11.2, .07, fw.x) * band(vUv.y - 11.9, 2.1, fw.y));
      c += emit(tint, 1.5) * lab;
      vec2 ca = vUv - vec2(-5.0, 6.9), cb = vUv - vec2(5.0, 6.9);
      float ra = length(ca), rb = length(cb);
      float rim = max(band(ra - 2.25, .1, fp), band(rb - 2.25, .1, fp));
      c += emit(tint, 1.8) * rim;
#ifdef CUTOUT
      vec2 q = ra < rb ? ca : cb;
      float r = min(ra, rb);
      float ang = atan(q.y, q.x) / TAU + fract(phaseAt(4) * 2.);
      float spoke = abs(fract(ang * 3.) - .5);
      float spokeOn = step(spoke * r * TAU / 3., .3);
      c = mix(c, emit(tint, 1.5), spokeOn * step(r, 2.25));
      // Holes only while they span a pixel or two. A value here, a selection; the discard itself waits for the end of main, so no
      // derivative-dependent code ever follows it (Agents.md, Custom GLSL).
      cutHole = r < 2.15 && spokeOn < .5 && fp < 1.4 ? 1. : 0.;
#endif
    } else if (isPart(2.) > .5) {
      edgeTint = tint2;
    }
  } else if (uLook == L_RING) {
    float period = 609.46 / 6.;
    float f = fract(vUv.x / period - (slow > .5 ? phaseAt(2) : phaseAt(1)));
    // A soft glow along the tube, facing the viewer, so the ring reads at range when its rails are subpixel.
    float facing = abs(dot(fn, rd));
    c += emit(tint, .42 * (.35 + .65 * facing));
    c += emit(tint2, 1.9) * band(f - .5, .035, fwUv.x / period);
  } else if (uLook == L_SHARD) {
    // T11 r01: faceted, not flat. One fixed key light, from above and left of the camera, sets the faces apart as the shard spins, and
    // the edges carry the shape at full L, so the body averages lower and the centre haze falls (W3; "large shards read flat").
    vec3 nf = dot(fn, rd) > 0. ? -fn : fn;
    float key = clamp(dot(nf, vec3(-.4, .72, .57)), 0., 1.);
    c = emit(tint, 2.4 * (.22 + .7 * key * key) * cover(1.6, fp));
    edgeMul = cover(1.6, fp);
  } else if (uLook == L_GATE) {
    // Disc top alone is near white on three palettes, so it takes some of the grid's hue. A checkpoint is the accent.
    vec3 gt = vJ.y > .5 ? uPal[6] : mix(uPal[3], uPal[5], .4);
    // On the pale-disc palettes even that mix is close to white, and the legs and edges then read white (reject criterion 4;
    // section 8.1's near-white rose .394 points on Arctic Laser). Most of the shared white component goes, and emit restores the
    // luminance, so only chroma rises. Below a min/max of .2 (Sunset Drive .145, Ember .036) nothing changes.
    float gLo = min(min(gt.r, gt.g), gt.b);
    gt -= gLo * .75 * smoothstep(.2, .4, gLo / max(max(max(gt.r, gt.g), gt.b), 1e-4));
    edgeTint = gt;
    float pulse = .62 + .38 * cos(TAU * (slow > .5 ? phaseAt(1) : phaseAt(0)));
    float flash = 1. + 1.7 * vJ.x;
    if (vPart < .5) {
      float f = fract(vUv.y * 1.6 + abs(vUv.x) * 1.4 + (slow > .5 ? phaseAt(1) : phaseAt(0)));
      float fw = (fwUv.x * 1.4 + fwUv.y * 1.6);
      float s = band(f - .5, .2, fw);
      s = mix(s, .4, toMean(fw));
      c += emit(gt, 1.3 * pulse * flash) * s + emit(gt, .1 + .9 * vJ.x);
    } else if (vPart < 1.5) {
      c += emit(gt, .8 * pulse * flash);
    } else {
      c += emit(gt, .9 * cover(.4, fp));
    }
    edgeMul = flash;
  } else if (uLook == L_SPIKE) {
    edgeTint = HAZARD_RED;
    float pulse = .72 + .28 * cos(TAU * (slow > .5 ? phaseAt(1) : phaseAt(0)));
    c = emit(HAZARD_RED, (.15 + .95 * smoothstep(-.5, 1., vLocal.y)) * pulse);
  } else if (uLook == L_FENCE) {
    edgeTint = HAZARD_RED;
    c = emit(HAZARD_RED, .16);
  } else if (uLook == L_FENCE_BEAM) {
    float fw = max(fwUv.y, 1e-4) / 1.3;
    float s = band(fract(vUv.y / 1.3) - .5, .09, fw);
    s = mix(s, .18, toMean(fw));
    float gap = band(vUv.x, .28, max(fwUv.x, 1e-4));
    float gapWide = cover(1.2, fp);
    // A faint wall behind the lines, so the barrier reads as a surface, and bright verticals at the gap edges.
    // Up close the wall fades, because at the camera it would flood the frame: the gap's bright verticals are what you steer by.
    float nearFade = smoothstep(6., 70., d);
    // Over a pale disc a red line adds to a near-white sky and reads white: on Arctic Laser and Toxic Arcade those crossings were
    // every pixel section 8.1's near-white gained from props. So the wall's lines dim to .4 inside the disc's gnomonic neighbourhood,
    // the same test the beams use. The gap's verticals stay full, since they are what you steer by.
    vec2 dg = rd.xy / max(-rd.z, 1e-3) - HERO_C;
    float overDisc = 1. - smoothstep(HERO_R, HERO_R + .06, length(dg));
    // T11 r10: the verticals guide the ship only until it has threaded the gap. As the fence plane passes the ship's tail
    // (SHIP_FORWARD 14 less SHIP_HALF_LENGTH 2.2 = 11.8; -vRel.z is the plane's depth) they fade, gone by 10 u, so a fence
    // between the camera and the ship is no longer a full-height bar through sky and floor.
    float threaded = smoothstep(10., 12.5, -vRel.z);
    c = emit(HAZARD_RED, (uEdgeL * s * (1. - .6 * overDisc) + .05) * nearFade) + emit(HAZARD_RED, 1.5) * gap * gapWide * threaded;
    lines = 0.;
  } else if (uLook == L_DRONE) {
    if (vPart > .5 && vPart < 1.5) { c = emit(HAZARD_RED, 1.5 * cover(.5, fp)); lines = 0.; }
    else if (vPart > 1.5) { edgeTint = tint2; }
  } else if (uLook == L_TRAFFIC) {
    // Red saturates to pink under tone mapping past about L 1.2, so a wide light stays there. Coverage dims it at range, not hue.
    if (isPart(1.) > .5) { c = emit(HAZARD_RED, 1.15 * cover(.3, fp)); lines = 0.; }
    else if (isPart(2.) > .5) { edgeTint = tint2; c += emit(tint2, .15); }
  } else if (uLook == L_SHIP) {
    if (vPart > .5 && vPart < 1.5) {
      float F = pow(1. - abs(dot(fn, rd)), 2.);
      c += emit(uPal[6], .18 + .4 * F);
    } else if (vPart > 1.5 && vPart < 2.5) {
      c = emit(uPal[6], (.6 + 1.6 * vJ.x) * vJ.y);
    }
    // T11 r07 (DI-96): a white-hot outline, the one colour no prop or item edge uses, so the player reads apart from shards.
    edgeTint = mix(uPal[6], vec3(1.), .6);
    c += emit(uPal[6], .03);
    c *= vJ.z;
    edgeMul = vJ.z;
  }

  // CRUISE dims hazards: edges times .35, body to near-black (section 7.2).
  float ghost = uGhost * uHazard;
  c *= mix(1., .08, ghost);
  c += emit(edgeTint, edgeL * edgeMul * mix(1., .35, ghost)) * lines;
#endif

#ifdef MIRROR
  c *= .42;
#endif
#ifdef SILHOUETTE
  gl_FragColor = vec4(0., 0., 0., 1.);
#else
  float fogAmount = fogK(d);
#ifdef ADDITIVE
  c *= 1. - fogAmount;
#else
  // A part widened to a pixel covers only vJ.z of what it draws (D-002). The rest shows skyGrad, the colour far props fade to and the
  // proxy for what is behind one, so its light is conserved and the widening does not lay a dark body over a bright horizon.
  if (uLook == L_REFLECTOR) fogAmount = 1. - (1. - fogAmount) * vJ.z;
  if (uLook != L_FLAT) c = mix(c, skyGrad(rd.y), fogAmount);
#endif
  // RING has nothing below y = 0 to shade: props.vert.glsl cuts it at the floor.
  gl_FragColor = vec4(c, 1.);
#ifdef MIRROR_PROBE
  gl_FragColor = vMirY > 1e-3 ? vec4(1., 0., 0., 1.) : vec4(0., .25, 0., 1.);
#endif
#endif
#ifdef CUTOUT
  // The last statement of main: nothing derivative-dependent may follow a non-uniform discard. purity.test.ts checks this.
  if (cutHole > .5) discard;
#endif
}
