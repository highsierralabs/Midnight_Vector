// Section 5.4's biome table, as sets over the fake world, for the road sheet. Spawn weights are T01's; this only says which types appear.
import { Archetype, ItemKind } from '../../../contracts/index';

export interface BiomeSet { name: string; archetypes: readonly number[]; items: readonly number[] }

const COMMON_ITEMS = [ItemKind.SHARD, ItemKind.GATE, ItemKind.SPIKE, ItemKind.FENCE, ItemKind.DRONE];

export const BIOME_SETS: readonly BiomeSet[] = [
  {
    name: 'Boulevard',
    archetypes: [Archetype.PALM, Archetype.REFLECTOR, Archetype.CHEVRON, Archetype.BILLBOARD, Archetype.RING],
    items: [...COMMON_ITEMS, ItemKind.TRAFFIC],
  },
  {
    name: 'Neon City',
    archetypes: [Archetype.ARCOLOGY, Archetype.BILLBOARD, Archetype.SEARCHLIGHT, Archetype.OBELISK, Archetype.PYLON, Archetype.RING],
    items: COMMON_ITEMS,
  },
  {
    name: 'Crystal Desert',
    archetypes: [Archetype.PYRAMID, Archetype.CRYSTAL, Archetype.CACTUS, Archetype.OBELISK, Archetype.RING],
    items: COMMON_ITEMS,
  },
  {
    name: 'Cyber Canyon',
    archetypes: [Archetype.PYLON, Archetype.TURBINE, Archetype.DISH, Archetype.CASSETTE, Archetype.RING],
    items: COMMON_ITEMS,
  },
  {
    name: 'Orbital Night',
    archetypes: [Archetype.SAUCER, Archetype.DISH, Archetype.DOME, Archetype.ORB, Archetype.RING],
    items: COMMON_ITEMS,
  },
  {
    name: 'Olympus',
    archetypes: [Archetype.COLONNADE, Archetype.ORB, Archetype.TOTEM, Archetype.RING],
    items: COMMON_ITEMS,
  },
];
