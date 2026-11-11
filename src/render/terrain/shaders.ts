// Concatenates contract GLSL and this module's files. All six levels use these exact strings, so three compiles one program.
import { COMMON_FRAG, COMMON_VERT } from '../../contracts/glsl';
import crackFrag from './crack.frag.glsl?raw';
import edgePaintFrag from './edgepaint.frag.glsl?raw';
import gridGlsl from './grid.glsl?raw';
import gridProbeFrag from './gridprobe.frag.glsl?raw';
import terrainFrag from './terrain.frag.glsl?raw';
import terrainVert from './terrain.vert.glsl?raw';

/** The floor's grid line function. The probe shares this exact text, so A12 measures what the floor draws. */
export const GRID_GLSL = gridGlsl;
export const TERRAIN_VERT = COMMON_VERT + terrainVert;
export const TERRAIN_FRAG = COMMON_FRAG + gridGlsl + terrainFrag;
export const CRACK_FRAG = crackFrag;
export const EDGE_PAINT_FRAG = COMMON_FRAG + edgePaintFrag;
export const GRID_PROBE_FRAG = COMMON_FRAG + gridGlsl + gridProbeFrag;
