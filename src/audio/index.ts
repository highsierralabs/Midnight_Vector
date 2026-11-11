// The module's only export (§8.1). Everything dev-only stays out of this import graph: purity.test.ts proves it.
import type { CreateAudio } from '../contracts/index';
import { createEngine } from './engine';

export const createAudio: CreateAudio = () => createEngine();
