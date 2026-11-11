uniform float uScan;        // darkening of a dark row; 0 is off
uniform float uScanPeriod;  // integer >= 2, drawing-buffer pixels
uniform float uGrain;       // 0 is off
uniform float uGrainFrame;  // integer below 1536
uniform float uFlash;       // 0 to .6
uniform vec3  uFlashColor;  // the palette grid colour (T11 r09) at luma .2, linear
uniform float uGlitch;      // 0 to 1
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
  if (uScan > 0.) { float s = mod(floor(gl_FragCoord.y), uScanPeriod); float dark = floor(uScanPeriod / 3. + .5); c *= 1. - uScan * step(uScanPeriod - dark - .5, s); }
  if (uGrain > 0.) { float g = float(crtHash(px, py, fr) >> 8u) / 16777216. - .5; c += c * g * uGrain + g * uGrain * .05; }
  outputColor = vec4(max(c, vec3(0.)), 1.);
}
