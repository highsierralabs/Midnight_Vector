// The module's one public surface. dev/devTools.ts is not imported from here, so it never reaches a production bundle.
export { createTerrainLayer, type TerrainOptions } from './layer';
