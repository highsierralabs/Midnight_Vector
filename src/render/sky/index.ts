import type { CreateLayer } from '../../contracts/index';
import { createSkyCore } from './skyLayer';

export const createSkyLayer: CreateLayer = () => createSkyCore();
