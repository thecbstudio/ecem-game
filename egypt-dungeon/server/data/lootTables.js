const C = require('../../shared/constants');
const Utils = require('../../shared/utils');

const ITEM_TYPES = ['weapon', 'helmet', 'chest', 'amulet', 'ring', 'offhand'];

const WEAPON_NAMES = {
  warrior: ['Bronze Khopesh', 'Iron Khopesh', 'Gold-Edged Khopesh', 'Cursed Khopesh', 'Blade of Ra', 'Pharaoh\'s Sword'],
  archer:  ['Reed Bow', 'Sinew Bow', 'Obsidian Bow', 'Cursed Bow', 'Eye of Horus Bow', 'Bow of Neith']
};
const ARMOR_NAMES = {
  helmet:  ['Linen Wrap', 'Bronze Cap', 'Iron Helm', 'Gold Crown', 'Pharaoh\'s Crown'],
  chest:   ['Linen Robe', 'Bronze Plate', 'Iron Cuirass', 'Gold Chest', 'Armor of the Gods'],
  amulet:  ['Scarab Amulet', 'Eye Amulet', 'Ankh Amulet', 'Gold Ankh', 'Blessing of Ra'],
  ring:    ['Sand Ring', 'Bronze Ring', 'Gold Ring', 'Ring of Horus', 'Pharaoh\'s Seal'],
  offhand: ['Wooden Shield', 'Bronze Shield', 'Iron Shield', 'Gold Shield', 'Shield of Osiris']
};

const SPECIAL_PROPERTIES = [
  { name: 'Lifesteal', desc: '5% lifesteal on hit', effect: 'lifesteal', value: 0.05 },
  { name: 'Knockback', desc: '+20% knockback', effect: 'knockback', value: 0.2 },
  { name: 'Swift', desc: '+15% movement speed', effect: 'speed', value: 0.15 },
  { name: 'Regen', desc: 'Slowly regenerates HP', effect: 'regen', value: 2 },
  { name: 'Scarab Curse', desc: 'Slows attacker on hit', effect: 'curseSlow', value: 0.3 },
  { name: 'Ankh Blessing', desc: '10% chance to revive once', effect: 'ankh', value: 0.1 },
  { name: 'Iron Skin', desc: '+8 armor value', effect: 'armor', value: 8 },
  { name: 'Ra\'s Fury', desc: '+25% critical chance', effect: 'crit', value: 0.25 },
];

function rollRarity(floor) {
  const roll = Math.random();
  // Floor increases legendary/rare chances
  const legendary = 0.02 + floor * 0.03;
  const rare      = 0.10 + floor * 0.05;
  const uncommon  = 0.30;
  if (roll < legendary) return C.RARITY.LEGENDARY;
  if (roll < legendary + rare) return C.RARITY.RARE;
  if (roll < legendary + rare + uncommon) return C.RARITY.UNCOMMON;
  return C.RARITY.COMMON;
}

function rarityMultiplier(rarity) {
  switch (rarity) {
    case C.RARITY.LEGENDARY: return 1.8;
    case C.RARITY.RARE:      return 1.4;
    case C.RARITY.UNCOMMON:  return 1.2;
    default:                 return 1.0;
  }
}

function generateItem(itemType, rarity, floor, classHint) {
  const mult = rarityMultiplier(rarity);
  const floorScale = 1 + floor * 0.5;
  const id = Utils.generateId();
  let item = { id, type: itemType, rarity, specials: [] };

  if (itemType === 'potion') {
    item.name = rarity === C.RARITY.LEGENDARY ? 'Greater Healing Potion'
              : rarity === C.RARITY.RARE      ? 'Healing Potion'
              :                                 'Minor Healing Potion';
    item.heal = Math.round((30 + floor * 15) * mult);
    item.consumable = true;
    return item;
  }

  if (itemType === 'weapon') {
    const cls = classHint || (Math.random() < 0.5 ? 'warrior' : 'archer');
    const names = WEAPON_NAMES[cls];
    item.name = names[Math.min(Math.floor(floor * 1.5), names.length - 1)];
    item.damage = Math.round((8 + floor * 6) * mult * floorScale);
    item.forClass = cls;
  } else {
    const names = ARMOR_NAMES[itemType] || ARMOR_NAMES.chest;
    item.name = names[Math.min(Math.floor(floor * 1.2), names.length - 1)];
    item.armor = Math.round((4 + floor * 3) * mult);
    if (itemType === 'amulet' || itemType === 'ring') {
      item.hpBonus = Math.round((5 + floor * 4) * mult);
    }
  }

  // Add specials based on rarity
  if (rarity === C.RARITY.RARE || rarity === C.RARITY.LEGENDARY) {
    item.specials.push(SPECIAL_PROPERTIES[Utils.randInt(0, SPECIAL_PROPERTIES.length)]);
  }
  if (rarity === C.RARITY.LEGENDARY) {
    let s;
    do { s = SPECIAL_PROPERTIES[Utils.randInt(0, SPECIAL_PROPERTIES.length)]; }
    while (s.effect === item.specials[0]?.effect);
    item.specials.push(s);
    item.name = 'Ancient ' + item.name;
  }

  return item;
}

const LOOT_TABLES = {
  mummy:     { dropChance: 0.55, itemTypes: ['weapon','helmet','chest','amulet','potion','potion'] },
  scarab:    { dropChance: 0.35, itemTypes: ['ring','amulet','potion'] },
  anubis:    { dropChance: 0.75, itemTypes: ['weapon','offhand','helmet','chest','potion'] },
  wisp:      { dropChance: 0.60, itemTypes: ['amulet','ring','chest','potion'] },
  statue:    { dropChance: 0.70, itemTypes: ['offhand','helmet','chest'] },
  boss:      { dropChance: 1.0,  itemTypes: ['weapon','weapon','chest','helmet','potion'] }
};

function rollLoot(enemyType, floor, classHint) {
  const table = LOOT_TABLES[enemyType] || LOOT_TABLES.mummy;
  if (Math.random() > table.dropChance) return null;
  const rarity = rollRarity(floor);
  const itemType = table.itemTypes[Utils.randInt(0, table.itemTypes.length)];
  return generateItem(itemType, rarity, floor, classHint);
}

module.exports = { rollLoot, generateItem, rollRarity };
