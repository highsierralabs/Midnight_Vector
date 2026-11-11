import type { CreateFeel } from '../contracts/index';
import { createFeelInternal } from './feel';

export const createFeel: CreateFeel = createFeelInternal;
