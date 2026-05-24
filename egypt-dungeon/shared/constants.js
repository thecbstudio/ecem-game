// Shared constants between server and client
const CONSTANTS = {
  // Tile system
  TILE_SIZE: 32,

  // Player stats
  WARRIOR: {
    HP: 120,
    STAMINA: 100,
    SPEED: 160,
    BASE_DAMAGE: 18,
    ARMOR_BONUS: 0.15,
    CLASS: 'warrior',
    NAME: 'Cinar'
  },
  ARCHER: {
    HP: 90,
    STAMINA: 120,
    SPEED: 185,
    BASE_DAMAGE: 14,
    CLASS: 'archer',
    NAME: 'Ecem'
  },

  // Combat
  MELEE_RANGE: 60,
  MELEE_ANGLE: Math.PI * 0.65,
  MELEE_ACTIVE_MS: 150,
  MELEE_COOLDOWN_MS: 300,
  ARROW_SPEED: 400,
  ARROW_COOLDOWN_MS: 600,
  ARROW_MAX_FLIGHT: 3,
  HEAVY_CHARGE_MS: 800,
  HEAVY_RANGE: 80,
  HEAVY_COOLDOWN_MS: 8000,
  SPREAD_COOLDOWN_MS: 10000,
  ABILITY_STAMINA_COST: 30,
  STAMINA_REGEN: 20,
  KNOCKBACK_DECAY: 0.85,

  // Enemy base
  ENEMY_ALERT_RANGE: {
    MUMMY: 200,
    SCARAB: 240,
    ANUBIS: 220,
    WISP: 280,
    STATUE: 150,
    BOSS: 9999
  },
  ENEMY_ATTACK_RANGE: {
    MUMMY: 45,
    SCARAB: 25,
    ANUBIS: 90,
    WISP: 250,
    STATUE: 55,
    BOSS_KHAMUN: 80
  },

  // Loot
  RARITY: {
    COMMON: 'common',
    UNCOMMON: 'uncommon',
    RARE: 'rare',
    LEGENDARY: 'legendary'
  },
  LOOT_PICKUP_RANGE: 56,
  INVENTORY_SLOTS: 20,
  EQUIP_SLOTS: ['weapon', 'offhand', 'helmet', 'chest', 'amulet', 'ring'],

  // Game loop
  SERVER_TICK_HZ: 60,
  BROADCAST_HZ: 20,
  TICK_MS: 1000 / 60,

  // Map
  ROOM_DOOR_WIDTH: 2,

  // Level progression
  HP_SCALE_PER_LEVEL: 15,
  DAMAGE_SCALE_PER_LEVEL: 3,
  SPEED_SCALE_PER_LEVEL: 5,

  // Network
  PORT: 3000,

  // Levels
  LEVELS: ['Ecenin Gobus', 'Cinar Gobus', 'Gobuscukler']
};

if (typeof module !== 'undefined') module.exports = CONSTANTS;
