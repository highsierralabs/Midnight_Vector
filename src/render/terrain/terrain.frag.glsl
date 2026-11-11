// src/render/terrain/terrain.frag.glsl -- appended to COMMON_FRAG and grid.glsl, which defines gridLines. Section 6.4 resolved against
// the art prototype. Constants marked [A] are T11's to tune. No early exit sits above a derivative here (Agents.md, Custom GLSL).
in vec3 vP; in vec3 vL; in float vH; in float vF;
uniform float uMirror;
uniform float uPulsePhase[1], uBeatPhase[1];   // one element each, as uRowOffset in the vertex shader
void main() {
  vec3 rel = vP - cameraPosition; float dist = length(rel); vec3 rd = rel / dist;
#ifdef NO_SLOPE_NORMAL
  // Tier 0 only (D-007), set by layer.ts before the first compile: the flat normal, so no derivative of vL. The slope term below
  // becomes its flat-face value, sl^3 * .32 = .0046 of the colour, so sun-facing facets lose their lift: visible on the flank
  // mountains at 640x360 (plan section 10), for 0.3 to 1.4 ms of SwiftShader time. Reversed by removing it from TIER0_DEFINES.
  vec3 N = vec3(0., 1., 0.);
#else
  vec3 n = cross(dFdx(vL), dFdy(vL)); float nl = length(n);
  vec3 N = nl > 1e-12 ? n / nl : vec3(0., 1., 0.); N *= N.y < 0. ? -1. : 1.;   // NaN guard, then face up
#endif
  float rise = smoothstep(0., 3., vH), hk = clamp(vH / 230., 0., 1.);
  vec2 uv = vec2(vL.x, vF + uTravel.x);
  vec2 g8 = gridLines(uv / 8., vec2(.03)), g64 = gridLines(uv / 64., vec2(.0075));
  float gl8 = mix(g8.x, 1., g8.y), gl64 = mix(g64.x, 1., g64.y);
  float v = vF + uTravel.y;
  // The two FAULT_ defines are A26's negative controls on the dev page only (?fault=wrap-64, ?fault=wrap-4096); app/ sets neither.
#ifdef FAULT_WRAP_64
  v = vF + uTravel.x;   // VI-gates' B11: pulse and ripple wrap every 64 u, which 512 and 4096 / k do not divide
#endif
#ifdef FAULT_WRAP_4096
  float pulse = exp(-fract(v / 500. - uPulsePhase[0]) * 14.);   // a pulse period that does not divide 4096
#else
  float pulse = exp(-fract(v / 512. - uPulsePhase[0]) * 14.);
#endif
  float aU = abs(vL.x), road = 1. - smoothstep(21., 22., aU);
  // road: edges at +-22, centre dashes every 16 u, 40% duty [A]
  float edgeL = pristineLines(vec2((vL.x + 22.) / 44., 0.), vec2(.0114, 0.)).x * (1. - smoothstep(23., 24., aU)) * (1. - rise);
  vec2 da = pristineLines(vec2(vL.x / 44., (vF + uTravel.x) / 16.), vec2(.0074, .4));
  float dash = da.x * da.y * (1. - smoothstep(1., 2., aU));
  float L = 1.45 * (1. - .72 * fogK(dist * 1.4)) * (1. + .15 * exp(-uBeatPhase[0] * 6.));   // beat term [A], section 7.4
  vec3 c = mix(uPal[0] * .16, uPal[1] * .20, hk) + uPal[4] * .05 * hk * hk;
  float sl = clamp(dot(N, normalize(vec3(0., .25, -1.))), 0., 1.);
  c += mix(uPal[1], uPal[2], hk) * sl * sl * sl * .32 * rise + uPal[2] * smoothstep(.55, 1., hk) * .05;
  c += emit(uPal[5], L) * (gl8 * .55 + gl64 * .75) * (1. - .75 * road);
  c += emit(uPal[6], 2.4) * g8.x * pulse * (1. - road) * (1. - rise) * .8;        // pulses along long lines
  c += emit(uPal[6], 1.4) * edgeL + emit(uPal[3], 1.2) * dash * .8;               // [A]
  float F = .05 + .95 * pow(1. - max(-rd.y, 0.), 5.);
  float rip = .0035 * (sin(TAU * v / 4096. * 53.) + sin(TAU * v / 4096. * 19.));  // periods 4096/k [A]
  vec3 rr = normalize(vec3(rd.x + rip, -rd.y, rd.z));
  vec3 refl = skyGrad(rr.y);
#ifndef NO_SUN_COLUMN
  // The sun column. Tier 0 drops it (D-007, the seam row's named response): sunDisc was the largest part of terrain's software cost.
  vec4 s = sunDisc(rr, .55);
  // T11 r03: the column tapers. Below the shimmer band (rows 615 to 650, rd.y above about -.06) its sides soften from .45 of the
  // disc's radius out, and it is gone by rd.y -.22 instead of lingering to -.34, where the disc's top colour, dimmed, read
  // brown-olive (look note: RGB 33,16,0) and covered a phone's road. In the band itself it is unchanged: a taper there raised T09's
  // floor shimmer from 7.42 to 7.60 against its 7.58 baseline line.
  vec2 gr = rr.xy / max(-rr.z, 1e-3);
  float below = 1. - smoothstep(-.12, -.06, rd.y);
  float colK = mix(1., 1. - smoothstep(.45, 1., abs(gr.x) / HERO_R), below) * smoothstep(-.22, -.07, rd.y);
  refl = mix(refl, vec3(0.), s.a * colK) + s.rgb * colK;
#endif
  c += refl * F * (1. - rise) * .85 * smoothstep(-.34, -.05, rd.y);
  float a = mix(mix(.72, .94, 1. - F), 1., rise), fk = fogK(dist);
  c = mix(c, skyGrad(rd.y), fk); a = mix(mix(a, 1., fk), 1., 1. - uMirror);
  gl_FragColor = vec4(c, a);
}
