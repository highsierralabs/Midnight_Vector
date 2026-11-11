// Sky composition, in the order light stacks up. HDR linear, no dither (section 6.3): the post chain owns both.
// The SKY_* defines are compile-time, so the shipped program has no debug branch. A dev iso view only drops lines.
in vec3 vRd;
uniform sampler2D uNeb;
uniform float uNebGain, uFlash;
uniform vec4 uMet[2];
uniform vec2 uMetK;

void main() {
  vec3 rd = normalize(vRd);
  vec2 g = rd.xy / max(-rd.z, 1e-3);
  float pxw = fwidth(g.y) + 1e-6;                          // before any branch: meteors and the bolt size themselves in pixels
  vec3 c = vec3(0.);
#ifdef SKY_GRADIENT
  c = skyGrad(rd.y);
#endif
#ifdef SKY_NEBULA
  vec3 tx = texture(uNeb, vec2(g.x / 3.6 + .5, g.y + .05)).rgb;
  // The fade keeps the nebula off the horizon glow, where fog must match skyGrad exactly (T03's seam).
  float neK = smoothstep(.46, .78, tx.r) * (.5 + tx.g) * smoothstep(.04, .34, rd.y);
#ifdef SKY_ISO_NEBULA
  neK *= 4.;                                               // dev view only, to judge upsampling
#endif
  // Accent clouds only high up, and dimmer. Added to a mid sky of the opposite hue at equal luminance they read as grey smudges
  // on Toxic Arcade, Arctic Laser and Sunset Drive, and dim amber reads as brown on Ember. Lower clouds take the disc's bottom colour, near the glow.
  float neA = smoothstep(.2, .5, rd.y) * (1. - smoothstep(.35, .7, tx.b));
  c += emit(mix(uPal[4], uPal[6], neA), mix(.04, .025, neA)) * neK * uNebGain;
#endif
#ifdef SKY_STARS
  c += skyStars(rd);
#endif
#ifdef SKY_EVENTS
  if (uAurora > 0.) c += skyAurora(g);                     // uniform condition, no derivative inside
  c += skyMeteor(g, uMet[0], uMetK.x, pxw) + skyMeteor(g, uMet[1], uMetK.y, pxw);
  if (uBoltK > 0.) c += skyBolt(g, pxw);
  // The sky lights up in its own hue. An accent-coloured wash goes brown on Ember and grey on Sunset Drive. It fades out under the horizon, so the far floor does not flash.
  c += emit(uPal[2], uFlash) * smoothstep(-.05, .2, rd.y);
#endif
#ifdef SKY_HERO
  vec4 s = sunDisc(rd, 1.);
  c = c * (1. - s.a) + s.rgb;                              // premultiplied: mix(c, s.rgb, s.a) would lose the halo
#endif
#ifdef SKY_LEGACY_BELOW
  if (rd.y < 0.) c = uPal[0] * .25;                        // negative control: the old rule, a black stripe under bend
#else
  // Terrain's top edge is a crest under the true horizon. Full sky down to just under it, because a black stripe would
  // show above the crest. Then dark fast, because the floor is translucent and a wider band would leak through it (section 6.3).
  float cy = max(cameraPosition.y, 1.), cc = max(-uBend.y, 0.), vm = uBend.z;
  float gb = (sqrt(cy / max(cc, 1e-12)) <= vm ? -2. * sqrt(cy * cc) : -(cy + cc * (vm * vm + 2. * vm * (6016. - vm))) / 6016.) - .004;
  c = mix(uPal[0] * .25, c, smoothstep(gb - .016, gb, g.y));
#endif
#ifdef SKY_NAN_TEST
  // Negative control for the float probe. The operand must not be constant: a literal sqrt(-1.) folds to 0 with no warning.
  if (abs(gl_FragCoord.y - 540.5) < .5) c += vec3(sqrt(-1. - uPal[0].r));
#endif
  gl_FragColor = vec4(c, 1.);
}
