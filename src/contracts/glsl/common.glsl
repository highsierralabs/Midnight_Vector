// src/contracts/glsl/common.glsl -- both stages
uniform vec2  uTravel;     // x: camera distance mod 64, y: camera distance mod 4096
uniform float uCamRow;     // camera chunk mod 65536
uniform vec4  uPhases[2];  // 8 phases in [0, 1), PHASE_PERIOD_TICKS order
uniform vec3  uBend;       // a, c, vMax
uniform vec3  uPal[7];     // linear: top, mid, horizon, discTop, discBottom, grid, accent
uniform vec2  uFog;        // start, end (radial, post-bend)
uniform vec3  uHero;       // modeA, modeB, mix

const vec3  W709 = vec3(.2126, .7152, .0722);
const float TAU  = 6.28318530718;

// All emission goes through this: equal L gives equal bloom response on any hue.
vec3 emit(vec3 c, float L) { return c * (L / max(dot(c, W709), 1e-3)); }

// Applied to render-space positions (camera at z = 0) in every scene vertex shader.
vec3 bendV(vec3 p) {
  float v = max(-p.z, 0.), b = min(v, uBend.z), q = b * b + 2. * uBend.z * (v - b);
  p.x += uBend.x * q; p.y += uBend.y * q; return p;
}

float fogK(float d) { return smoothstep(uFog.x, uFog.y, d); }

// Sky gradient; terrain and props fade into exactly this, so far geometry appears invisibly.
// y is rd.y of the normalized view direction, in world axes, after the bend. Not gnomonic. The sky passes the same quantity.
vec3 skyGrad(float y) {
  float h = max(y, 0.);
  vec3 c = mix(uPal[2] * .62, uPal[1], smoothstep(0., .17, h));
  c = mix(c, uPal[0], smoothstep(.09, .55, h));
  return c + uPal[2] * exp(-h * 30.) * .34;
}

// Exact modular row distance for FIFO rings; row is chunk mod 65536 stored as float.
float rowDelta(float row) { return mod(row - uCamRow + 32768., 65536.) - 32768.; }

// Use only integer harmonics: fract(phaseAt(i) * k + seed) with integer k, or the wrap pops.
float phaseAt(int i) { return uPhases[i / 4][i % 4]; }

// Twins of src/core/motion.ts. Same expressions, so sim collision and the drawn position agree.
float trafficOffset(float travel, float k, float seed, float phase) { return travel * fract(k * phase + seed); }
float droneOffset(float amp, float k, float seed, float phase) { return amp * sin(TAU * (k * phase + seed)); }
