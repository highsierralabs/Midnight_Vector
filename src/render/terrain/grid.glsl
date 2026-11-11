// src/render/terrain/grid.glsl -- the floor's grid line function, after COMMON_FRAG and before terrain.frag.glsl. The far-grid
// probe (gridprobe.frag.glsl) includes this same text, so A12's coverage rows measure the lines the floor draws (shaders.ts).
#ifdef NAIVE_GRID
// The shimmer negative control only: the plain fract / fwidth idiom that section 6.4 measures as worse under the horizon.
vec2 gridLines(vec2 uv, vec2 lw) { return 1. - min(abs(fract(uv - .5) - .5) / fwidth(uv), vec2(1.)); }
#else
vec2 gridLines(vec2 uv, vec2 lw) { return pristineLines(uv, lw); }
#endif
