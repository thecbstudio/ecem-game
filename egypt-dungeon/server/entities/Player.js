const C = require('../../shared/constants');
const Utils = require('../../shared/utils');

class Player {
  constructor(socketId, classType, playerIndex) {
    this.id = socketId;
    this.class = classType; // 'warrior' or 'archer'
    this.index = playerIndex;
    this.name = classType === 'warrior' ? C.WARRIOR.NAME : C.ARCHER.NAME;

    const base = classType === 'warrior' ? C.WARRIOR : C.ARCHER;
    this.maxHp = base.HP;
    this.hp = base.HP;
    this.maxStamina = base.STAMINA;
    this.stamina = base.STAMINA;
    this.baseSpeed = base.SPEED;
    this.speed = base.SPEED;
    this.baseDamage = base.BASE_DAMAGE;

    this.x = 100;
    this.y = 100;
    this.facing = 0;
    this.vx = 0; // knockback velocity
    this.vy = 0;

    // State machine
    this.state = 'idle'; // idle, running, attacking, hurt, dead
    this.stateTimer = 0;

    // Combat
    this.attackCooldown = 0;
    this.heavyCooldown = 0;
    this.spreadCooldown = 0;
    this.abilityCooldown = 0;
    this.isCharging = false;
    this.chargeTimer = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.invincible = false;
    this.invincibleTimer = 0;
    this.lastHitTime = 0;

    // Debuffs
    this.slowTimer = 0;
    this.slowAmount = 0;
    this.cursedTimer = 0;

    // Inventory
    this.inventory = []; // array of items (max 14 storage + 6 equip)
    this.equipped = { weapon: null, offhand: null, helmet: null, chest: null, amulet: null, ring: null };
    this.stats = { damage: 0, armor: 0, hpBonus: 0, speedBonus: 0, crit: 0, lifesteal: 0, regen: 0 };

    // Input state (last received)
    this.input = { dx: 0, dy: 0, attacking: false, abilityKey: false, mouseAngle: 0, shift: false };
    this.inputSequence = 0;

    // Progression
    this.level = 1;
    this.kills = 0;

    // Respawn
    this.dead = false;
    this.respawnTimer = 0;
    this.ankh = false; // ankh blessing effect flag

    // Arrows in flight (tracked by id)
    this.arrowCount = 0;

    // Rage ultimate
    this.rageActive = false;
    this.rageTimer = 0;
    this.ultimateCooldown = 0;
  }

  applyInput(input) {
    this.input = input;
    this.inputSequence = input.sequence || 0;
  }

  update(dt, mapSystem) {
    if (this.dead) {
      this.respawnTimer -= dt;
      return;
    }

    // Timers
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.heavyCooldown > 0) this.heavyCooldown -= dt;
    if (this.spreadCooldown > 0) this.spreadCooldown -= dt;
    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    if (this.stateTimer > 0) this.stateTimer -= dt;
    if (this.invincibleTimer > 0) { this.invincibleTimer -= dt; if (this.invincibleTimer <= 0) this.invincible = false; }
    if (this.slowTimer > 0) this.slowTimer -= dt;
    if (this.cursedTimer > 0) this.cursedTimer -= dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.comboCount = 0; }
    if (this.rageTimer > 0) { this.rageTimer -= dt; if (this.rageTimer <= 0) { this.rageActive = false; } }

    // Stamina regen
    if (!this.input.shift) {
      this.stamina = Math.min(this.maxStamina, this.stamina + C.STAMINA_REGEN * dt);
    }

    // HP regen from items (always)
    if (this.stats.regen > 0) {
      this.hp = Math.min(this.maxHp + this.stats.hpBonus, this.hp + this.stats.regen * dt);
    }
    // Passive out-of-combat regen — kicks in 4s after last hit.
    // Slow but steady: ~3% max HP per second once safe.
    if (this.hp < this.maxHp + this.stats.hpBonus) {
      const sinceHit = (Date.now() - this.lastHitTime) / 1000;
      if (sinceHit > 4) {
        const rate = (this.maxHp + this.stats.hpBonus) * 0.03;
        this.hp = Math.min(this.maxHp + this.stats.hpBonus, this.hp + rate * dt);
      }
    }

    // Knockback decay
    this.vx *= Math.pow(C.KNOCKBACK_DECAY, dt * 60);
    this.vy *= Math.pow(C.KNOCKBACK_DECAY, dt * 60);
    if (Math.abs(this.vx) < 0.5) this.vx = 0;
    if (Math.abs(this.vy) < 0.5) this.vy = 0;

    // Update hurt state
    if (this.state === 'hurt' && this.stateTimer <= 0) {
      this.state = 'idle';
    }

    // Move
    const { dx, dy } = this.input;
    let speed = this.speed;
    if (this.slowTimer > 0) speed *= (1 - this.slowAmount);
    if (this.rageActive) speed *= 1.2;

    let moveX = 0, moveY = 0;
    if (dx !== 0 || dy !== 0) {
      const norm = Utils.normalize(dx, dy);
      moveX = norm.x * speed * dt;
      moveY = norm.y * speed * dt;
      if (this.state !== 'attacking' && this.state !== 'hurt') {
        this.state = 'running';
        this.facing = Math.atan2(norm.y, norm.x);
      }
    } else {
      if (this.state === 'running') this.state = 'idle';
    }

    // Add knockback
    moveX += this.vx * dt;
    moveY += this.vy * dt;

    // Collision
    if (mapSystem) {
      const newX = this.x + moveX;
      const newY = this.y + moveY;
      const hw = 10, hh = 10;

      const canMoveX = !mapSystem.isSolid(newX - hw, this.y - hh) &&
                       !mapSystem.isSolid(newX + hw, this.y - hh) &&
                       !mapSystem.isSolid(newX - hw, this.y + hh) &&
                       !mapSystem.isSolid(newX + hw, this.y + hh);
      const canMoveY = !mapSystem.isSolid(this.x - hw, newY - hh) &&
                       !mapSystem.isSolid(this.x + hw, newY - hh) &&
                       !mapSystem.isSolid(this.x - hw, newY + hh) &&
                       !mapSystem.isSolid(this.x + hw, newY + hh);

      if (canMoveX) this.x = newX;
      if (canMoveY) this.y = newY;
    } else {
      this.x += moveX;
      this.y += moveY;
    }

    // Update facing from mouse angle if not moving
    if (dx === 0 && dy === 0) {
      this.facing = this.input.mouseAngle;
    }

    // Dodge/shield (shift)
    if (this.input.shift && this.stamina >= C.ABILITY_STAMINA_COST && !this.invincible) {
      this.stamina -= C.ABILITY_STAMINA_COST;
      this.invincible = true;
      this.invincibleTimer = 0.4;
    }

    // Clamp to world bounds
    if (mapSystem) {
      this.x = Utils.clamp(this.x, 16, mapSystem.worldWidth - 16);
      this.y = Utils.clamp(this.y, 16, mapSystem.worldHeight - 16);
    }
  }

  takeDamage(amount, knockbackX = 0, knockbackY = 0) {
    if (this.invincible || this.dead) return false;

    // Armor reduction
    const armorValue = this.stats.armor + (this.equipped.chest?.armor || 0) + (this.equipped.helmet?.armor || 0) + (this.equipped.offhand?.armor || 0);
    const reduction = armorValue / (armorValue + 50);
    const finalDamage = Math.round(amount * (1 - reduction));

    this.hp -= finalDamage;
    this.vx = knockbackX;
    this.vy = knockbackY;
    this.state = 'hurt';
    this.stateTimer = 0.25;
    this.lastHitTime = Date.now();

    // Brief invincibility after hit
    this.invincible = true;
    this.invincibleTimer = 0.3;

    if (this.hp <= 0) {
      if (this.ankh && !this._ankh_used) {
        this._ankh_used = true;
        this.hp = Math.round(this.maxHp * 0.2);
        return { damage: finalDamage, revived: true };
      }
      this.hp = 0;
      this.dead = true;
      this.state = 'dead';
      this.respawnTimer = 8;
      return { damage: finalDamage, died: true };
    }
    return { damage: finalDamage };
  }

  respawn(x, y) {
    this.dead = false;
    this.state = 'idle';
    this.hp = Math.round(this.maxHp * 0.5);
    this.x = x;
    this.y = y;
    this._ankh_used = false;
  }

  getDamage() {
    const weaponDmg = this.equipped.weapon?.damage || 0;
    let dmg = this.baseDamage + weaponDmg + this.stats.damage;
    if (this.rageActive) dmg *= 2;
    // Critical hit
    const critChance = 0.1 + (this.stats.crit || 0);
    const crit = Math.random() < critChance;
    return { damage: Math.round(dmg * (crit ? 1.5 : 1)), crit };
  }

  levelUp() {
    this.level++;
    const base = this.class === 'warrior' ? C.WARRIOR : C.ARCHER;
    this.maxHp += C.HP_SCALE_PER_LEVEL;
    this.hp = this.maxHp;
    this.baseDamage += C.DAMAGE_SCALE_PER_LEVEL;
    this.baseSpeed += C.SPEED_SCALE_PER_LEVEL;
    this.speed = this.baseSpeed;
  }

  equipItem(item) {
    const slot = item.type === 'weapon' ? 'weapon' : item.type;
    const old = this.equipped[slot];
    this.equipped[slot] = item;
    this._recalcStats();
    return old; // return unequipped item
  }

  _recalcStats() {
    this.stats = { damage: 0, armor: 0, hpBonus: 0, speedBonus: 0, crit: 0, lifesteal: 0, regen: 0 };
    for (const [, item] of Object.entries(this.equipped)) {
      if (!item) continue;
      if (item.specials) {
        for (const s of item.specials) {
          if (s.effect === 'speed') this.stats.speedBonus += s.value;
          if (s.effect === 'armor') this.stats.armor += s.value;
          if (s.effect === 'crit') this.stats.crit += s.value;
          if (s.effect === 'lifesteal') this.stats.lifesteal += s.value;
          if (s.effect === 'regen') this.stats.regen += s.value;
          if (s.effect === 'ankh') this.ankh = true;
          if (s.effect === 'hpBonus') this.stats.hpBonus += s.value;
        }
      }
    }
    this.maxHp = (this.class === 'warrior' ? C.WARRIOR.HP : C.ARCHER.HP) + this.level * C.HP_SCALE_PER_LEVEL + this.stats.hpBonus;
    this.speed = (this.class === 'warrior' ? C.WARRIOR.SPEED : C.ARCHER.SPEED) + this.level * C.SPEED_SCALE_PER_LEVEL + this.stats.speedBonus * this.baseSpeed;
  }

  serialize() {
    return {
      id: this.id,
      class: this.class,
      name: this.name,
      index: this.index,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      stamina: Math.round(this.stamina),
      maxStamina: this.maxStamina,
      facing: this.facing,
      state: this.state,
      attackCooldown: this.attackCooldown,
      comboCount: this.comboCount,
      rageActive: this.rageActive,
      dead: this.dead,
      respawnTimer: this.respawnTimer,
      equipped: {
        weapon: this.equipped.weapon ? { name: this.equipped.weapon.name, damage: this.equipped.weapon.damage } : null,
        chest: this.equipped.chest ? { name: this.equipped.chest.name, armor: this.equipped.chest.armor } : null,
        helmet: this.equipped.helmet ? { name: this.equipped.helmet.name } : null,
        amulet: this.equipped.amulet ? { name: this.equipped.amulet.name } : null,
        ring: this.equipped.ring ? { name: this.equipped.ring.name } : null,
        offhand: this.equipped.offhand ? { name: this.equipped.offhand.name } : null
      },
      inventory: this.inventory,
      level: this.level,
      kills: this.kills,
      inputSequence: this.inputSequence
    };
  }
}

module.exports = Player;
