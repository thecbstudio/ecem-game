const Utils = require('../../shared/utils');
const C = require('../../shared/constants');

class LootSystem {
  constructor() {
    this.groundLoot = []; // {id, x, y, item}
    this.events = [];
  }

  dropLoot(item, x, y) {
    if (!item) return;
    const lootId = Utils.generateId();
    this.groundLoot.push({ id: lootId, x, y, item });
    this.events.push({ type: 'loot_dropped', id: lootId, x, y, item });
  }

  tryPickup(player) {
    if (player.dead) return;
    for (let i = this.groundLoot.length - 1; i >= 0; i--) {
      const loot = this.groundLoot[i];
      if (Utils.distance(player.x, player.y, loot.x, loot.y) > C.LOOT_PICKUP_RANGE) continue;

      // Potions: instant heal, no inventory slot needed
      if (loot.item.type === 'potion') {
        const cap = player.maxHp + (player.stats.hpBonus || 0);
        if (player.hp >= cap) continue; // skip if already full
        const healed = Math.min(loot.item.heal, cap - player.hp);
        player.hp += healed;
        this.groundLoot.splice(i, 1);
        this.events.push({ type: 'potion_used', id: loot.id, playerId: player.id, heal: healed, x: loot.x, y: loot.y });
        continue;
      }

      if (player.inventory.length < 14) {
        player.inventory.push(loot.item);
        this.groundLoot.splice(i, 1);
        this.events.push({ type: 'loot_collected', id: loot.id, playerId: player.id, item: loot.item });

        // Auto-equip logic:
        //  - Empty slot → equip it.
        //  - Occupied slot → equip if the new item is clearly better.
        //    (higher rarity wins, then higher primary stat, then more specials)
        const slot = loot.item.type === 'weapon' ? 'weapon' : loot.item.type;
        if (C.EQUIP_SLOTS.includes(slot)) {
          if (loot.item.forClass && loot.item.forClass !== player.class) continue;
          const current = player.equipped[slot];
          if (!current || this._isBetter(loot.item, current)) {
            const old = player.equipItem(loot.item);
            player.inventory = player.inventory.filter(it => it.id !== loot.item.id);
            if (old) player.inventory.push(old);
            this.events.push({ type: 'item_auto_equipped', playerId: player.id, item: loot.item });
          }
        }
      } else {
        this.events.push({ type: 'inventory_full', playerId: player.id });
      }
    }
  }

  _isBetter(neu, old) {
    if (!old) return true;
    const rarityRank = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
    const rN = rarityRank[neu.rarity] ?? 0;
    const rO = rarityRank[old.rarity] ?? 0;
    if (rN !== rO) return rN > rO;
    // Same rarity — compare main stat (damage for weapons, armor otherwise)
    const statN = (neu.damage || 0) + (neu.armor || 0) + (neu.hpBonus || 0);
    const statO = (old.damage || 0) + (old.armor || 0) + (old.hpBonus || 0);
    if (statN !== statO) return statN > statO;
    return (neu.specials?.length || 0) > (old.specials?.length || 0);
  }

  equipItem(player, itemId, slot) {
    const item = player.inventory.find(i => i.id === itemId);
    if (!item) return false;
    // Validate slot
    const validSlot = item.type === 'weapon' ? 'weapon' : item.type;
    if (validSlot !== slot && slot !== 'offhand') return false;
    // Class restriction
    if (item.forClass && item.forClass !== player.class) return false;
    const old = player.equipItem(item);
    player.inventory = player.inventory.filter(i => i.id !== itemId);
    if (old) player.inventory.push(old);
    this.events.push({ type: 'item_equipped', playerId: player.id, item, slot });
    return true;
  }

  getAndClearEvents() {
    const evts = this.events;
    this.events = [];
    return evts;
  }

  serialize() {
    return this.groundLoot.map(l => ({
      id: l.id,
      x: l.x,
      y: l.y,
      itemType: l.item.type,
      rarity: l.item.rarity,
      name: l.item.name
    }));
  }
}

module.exports = LootSystem;
