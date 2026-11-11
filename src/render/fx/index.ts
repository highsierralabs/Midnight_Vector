// src/render/fx has three factories, the only public names of this module (section 8.1).
import type { CreateGovernor, CreateLayer, CreatePost } from '../../contracts/index';
import { createGovernorImpl } from './governor';
import { createPostStack } from './post';
import { createSpeedLinesLayer } from './speedLines';

export const createPost: CreatePost = () => createPostStack();
export const createGovernor: CreateGovernor = (o) => createGovernorImpl(o);
export const createFxLayer: CreateLayer = () => createSpeedLinesLayer();
