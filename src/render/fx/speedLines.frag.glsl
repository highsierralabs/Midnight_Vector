uniform float uLineK;
in float vEdge; in float vAlong; in float vFade; in float vRank; in vec3 vRel;
void main() {
  float on = smoothstep(vRank, vRank + .06, uLineK * 1.06);          // T02: fraction of lines shown
  float e = 1. - smoothstep(.2, 1., abs(vEdge));
  float t = vAlong * (1. - vAlong) * 4.;
  float sun = smoothstep(1.15, 1.6, length(vRel.xy / max(-vRel.z, 1.) - HERO_C) / HERO_R);   // never over the disc
  vec3 c = emit(step(.5, fract(vRank * 7.)) > .5 ? uPal[6] : uPal[5], 1.4);
  gl_FragColor = vec4(c * on * e * t * vFade * sun, 1.);
}
