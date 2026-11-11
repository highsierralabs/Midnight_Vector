import type { CreateSim } from '../contracts/index';
import { createSimInternal } from './sim';
import { TUNING } from './tuning';

export const createSim: CreateSim = (w) => createSimInternal(w, TUNING);
