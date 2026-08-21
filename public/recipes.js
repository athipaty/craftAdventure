// Shared recipe definitions — used by both the browser (public/game.js) and the
// server (server/routes/player.js) so crafting is validated with the same rules
// on both sides.
const RECIPES = {
  axe: {
    label: 'Axe',
    upgradeKey: 'axeLevel',
    maxLevel: 2,
    costs: {
      1: { wood: 5, stone: 3 },
      2: { wood: 12, ore: 6 },
    },
    description: 'Increases wood gathered per chop.',
  },
  pickaxe: {
    label: 'Pickaxe',
    upgradeKey: 'pickaxeLevel',
    maxLevel: 2,
    costs: {
      1: { wood: 4, stone: 5 },
      2: { stone: 10, ore: 8 },
    },
    description: 'Increases stone and ore gathered per mine.',
  },
  boots: {
    label: 'Boots',
    upgradeKey: 'bootsLevel',
    maxLevel: 2,
    costs: {
      1: { wood: 3, stone: 3 },
      2: { wood: 8, ore: 5 },
    },
    description: 'Increases movement speed.',
  },
  bag: {
    label: 'Bag',
    upgradeKey: 'bagLevel',
    maxLevel: 2,
    costs: {
      1: { wood: 6, stone: 6 },
      2: { stone: 10, ore: 10 },
    },
    description: 'Increases how much you can carry.',
  },
  knight: {
    label: 'Knight',
    upgradeKey: 'knightLevel',
    maxLevel: 2,
    costs: {
      1: { wood: 6, ore: 6 },
      2: { ore: 12, stone: 8 },
    },
    description: 'Lets you fight off enemies, and hits harder.',
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RECIPES;
}
