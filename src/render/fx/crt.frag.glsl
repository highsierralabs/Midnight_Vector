uniform float uScan;        // darkening of a dark row; 0 is off
uniform float uScanPeriod;  // integer >= 2, drawing-buffer pixels
uniform float uGrain;       // 0 is off
uniform float uGrainFrame;  // integer below 1536
uniform float uFlash;       // 0 to .6
uniform vec3  uFlashColor;  // the palette grid colour (T11 r09) at luma .2, linear
uniform float uGlitch;      // 0 to 1
uniform float uCrt;         // T14: the CRT screen, 0 off or .7 on
uniform float uCrtPitch;    // T14: integer >= 3, drawing-buffer pixels per scanline and per grille triad
#define CRT_SCAN 0.6
#define CRT_MASK 0.3
#define CRT_CORNER 0.35
uint crtHash(uint x, uint y, uint z) {
  uint v = x * 1597334677u ^ y * 3812015801u ^ z * 2798796415u;
  v = (v ^ (v >> 16u)) * 2246822519u; v = (v ^ (v >> 13u)) * 3266489917u; return v ^ (v >> 16u);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  uint px = uint(gl_FragCoord.x), py = uint(gl_FragCoord.y), fr = uint(uGrainFrame);
  // A band swaps whole or not at all, and glitch sets how many bands do. A partial mix of c and c.brg moves colours toward grey.
  if (uGlitch > 0.) { float f = float(crtHash(py / 12u, fr, 7u) >> 8u) / 16777216.; if (f > 1. - .28 * uGlitch) c = c.brg; }
  // Dark surfaces give up their own colour as the flash arrives. A complementary accent added on top of them sums to grey.
  if (uFlash > 0.) { float d = 1. - smoothstep(0., .3, dot(c, vec3(.2126, .7152, .0722))); c = c * (1. - uFlash * d) + uFlashColor * uFlash; }
  if (uCrt > 0.) {
    // T14: Synthwave City's CRT screen, in place of the plain scan, so two line patterns never beat. Scanlines and an
    // aperture grille, uCrtPitch pixels per line and per RGB triad, about 3 CSS px at any pixel ratio.
    vec2 fc = floor(gl_FragCoord.xy) + .5;
    float k = 6.2831853 / uCrtPitch;
    float lum = clamp(dot(c, vec3(.2126, .7152, .0722)), 0., 1.);
    float line = .5 + .5 * cos(fc.y * k);
    // A bright beam spreads into the gap, so the lines show most in the mids and darks.
    float scan = 1. - uCrt * CRT_SCAN * (1. - .45 * lum) * (1. - line);
    float phase = fc.x * k;
    vec3 grille = .5 + .5 * cos(vec3(phase, phase - 2.0943951, phase + 2.0943951));
    vec3 mask = mix(vec3(1.), grille, uCrt * CRT_MASK);
    // Give back most of the average light the lines and the grille take away.
    float kept = (1. - .5 * uCrt * CRT_SCAN) * (1. - .5 * uCrt * CRT_MASK);
    c *= scan * mask * mix(1., 1. / kept, .8);
    // The corners of a curved tube fall off faster.
    vec2 q = uv - .5;
    c *= 1. - uCrt * CRT_CORNER * smoothstep(.18, .5, dot(q, q));
  } else if (uScan > 0.) { float s = mod(floor(gl_FragCoord.y), uScanPeriod); float dark = floor(uScanPeriod / 3. + .5); c *= 1. - uScan * step(uScanPeriod - dark - .5, s); }
  if (uGrain > 0.) { float g = float(crtHash(px, py, fr) >> 8u) / 16777216. - .5; c += c * g * uGrain + g * uGrain * .05; }
  outputColor = vec4(max(c, vec3(0.)), 1.);
}
