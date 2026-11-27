/*
 * Stage presets: what a walker plausibly carries the moment they light beacon
 * N, so a tester can start a timed run there instead of playing the hours
 * before it. Each kit holds only what the recipes already received could have
 * made, plus the raw materials a player would have gathered on the way: no
 * iron tools before beacon 3, no diamond before beacon 4, and nothing that
 * comes from a beacon not yet lit.
 *
 * This file is data. The page applies a kit (the pack, the worn row, the
 * beacons, the walk to the monument) through `startAtBeacon`; see main.js.
 */

/** The highest stage a preset can start at: every beacon lit, the mission done. */
export const PRESET_STAGES = 5;

/* A base anyone past beacon 1 has built up: the stations, light, food, wood
   and stone. */
const BASE_KIT = [
  ['crafting_table', 1], ['furnace', 1], ['chest', 1], ['door', 1], ['bed', 1],
  ['torch', 32], ['cooked_meat', 8], ['log', 16], ['planks', 32], ['stick', 16],
  ['cobblestone', 64], ['coal', 12]
];

const tools = (tier) => ['sword', 'pickaxe', 'axe', 'shovel'].map((tool) => [tier + '_' + tool, 1]);
const armour = (tier) => ['helmet', 'chestplate', 'leggings', 'boots'].map((piece) => tier + '_' + piece);

/* Bows and buckets arrive with beacon 2, and the string for a bow is the
   spiders beacon 2 wakes, so a walker who has lit beacon 3 has had a night of
   spiders to make one. */
const KIT_AFTER_TWO = [['bow', 1], ['arrow', 32], ['bucket', 1], ['bread', 8], ['wheat_seeds', 8]];

const KITS = {
  // Lit within minutes of landing: the recipes have just arrived, and all the
  // walker has is what they punched out of a tree on the way.
  1: { pack: [['log', 6]], armour: [] },
  2: { pack: [...tools('wood'), ...BASE_KIT], armour: [] },
  3: { pack: [...tools('stone'), ...KIT_AFTER_TWO, ...BASE_KIT, ['iron_ingot', 8]], armour: armour('leather') },
  4: { pack: [...tools('iron'), ...KIT_AFTER_TWO, ...BASE_KIT, ['iron_ingot', 8], ['diamond', 3]], armour: armour('iron') },
  5: { pack: [...tools('diamond'), ...KIT_AFTER_TWO, ...BASE_KIT, ['iron_ingot', 8]], armour: armour('diamond') }
};

/** The kit for a walker who has just lit beacon `stage` (1 to 5), or null. */
export function stageKit(stage) {
  const kit = KITS[Math.trunc(Number(stage))];
  return kit ? { pack: kit.pack.map(([id, count]) => [id, count]), armour: [...kit.armour] } : null;
}
