const Utils = require('../../shared/utils');
const C = require('../../shared/constants');

class Enemy {
  constructor(type, x, y, floor = 0) {
    this.id = Utils.generateId();
    this.type = type;
    this.x = x;
    this.y = y;
    this.floor = floor;
    this.facing = 0;

    // Override in subclasses
    this.maxHp = 40;
    this.hp = 40;
    this.speed = 80;
    this.damage = 8;
    this.attackRange = 45;
    this.alertRange = 200;
    this.attackCooldown = 1.5;
    this.xp = 10;
    this.knockbackForce = 120;
    this.lootType = 'mummy';

    // State machine
    this.state = 'idle'; // idle, patrol, alert, chasing, attackWindup, attacking, recovering, hurt, dead
    this.stateTimer = 0;
    this.target = null; // reference to player object
    this.targetId = null;

    // Patrol
    this.patrolPoints = [];
    this.patrolIndex = 0;
    this.patrolTimer = 0;

    // Alert broadcast
    this.alerted = false;

    // Knockback
    this.vx = 0;
    this.vy = 0;

    // Invincible frames after hit
    this.invincibleTimer = 0;
    this.dead = false;

    // Attack tracking
    this._attackCooldownLeft = 0;

    // Phase (for bosses)
    this.phase = 1;
  }

  update(dt, players, mapSystem) {
    if (this.dead) return;

    if (this._attackCooldownLeft > 0) this._attackCooldownLeft -= dt;
    if (this.stateTimer > 0) this.stateTimer -= dt;
    if (this.invincibleTimer > 0) { this.invincibleTimer -= dt; }

    // Knockback decay
    this.vx *= Math.pow(C.KNOCKBACK_DECAY, dt * 60);
    this.vy *= Math.pow(C.KNOCKBACK_DECAY, dt * 60);
    if (Math.abs(this.vx) < 0.5) this.vx = 0;
    if (Math.abs(this.vy) < 0.5) this.vy = 0;

    // Find nearest alive player
    const nearestPlayer = this._findNearestPlayer(players);

    switch (this.state) {
      case 'idle':
        this._handleIdle(dt, nearestPlayer, mapSystem);
        break;
      case 'patrol':
        this._handlePatrol(dt, nearestPlayer, mapSystem);
        break;
      case 'alert':
        this.stateTimer -= 0;
        if (this.stateTimer <= 0) this.state = 'chasing';
        break;
      case 'chasing':
        this._handleChasing(dt, nearestPlayer, mapSystem);
        break;
      case 'attackWindup':
        if (this.stateTimer <= 0) {
          this.state = 'attacking';
          this.stateTimer = 0.2;
          this._performAttack(nearestPlayer);
        }
        break;
      case 'attacking':
        if (this.stateTimer <= 0) {
          this.state = 'recovering';
          this.stateTimer = 0.4;
        }
        break;
      case 'recovering':
        if (this.stateTimer <= 0) this.state = 'chasing';
        break;
      case 'hurt':
        if (this.stateTimer <= 0) this.state = 'chasing';
        break;
    }

    // Apply knockback movement
    if ((this.vx !== 0 || this.vy !== 0) && mapSystem) {
      const nx = this.x + this.vx * dt;
      const ny = this.y + this.vy * dt;
      if (!mapSystem.isSolid(nx, this.y)) this.x = nx;
      if (!mapSystem.isSolid(this.x, ny)) this.y = ny;
    }
  }

  _findNearestPlayer(players) {
    let nearest = null;
    let minDist = Infinity;
    for (const p of players) {
      if (p.dead) continue;
      const d = Utils.distanceSq(this.x, this.y, p.x, p.y);
      if (d < minDist) { minDist = d; nearest = p; }
    }
    return nearest;
  }

  _handleIdle(dt, nearestPlayer, mapSystem) {
    if (!nearestPlayer) return;
    const dist = Utils.distance(this.x, this.y, nearestPlayer.x, nearestPlayer.y);
    if (dist < this.alertRange) {
      const los = mapSystem ? Utils.hasLineOfSight(this.x, this.y, nearestPlayer.x, nearestPlayer.y, mapSystem.solidGrid, C.TILE_SIZE) : true;
      if (los) {
        this.state = 'alert';
        this.stateTimer = 0.3;
        this.target = nearestPlayer;
        this.targetId = nearestPlayer.id;
        this.alerted = true;
      }
    }
    // Start patrol after idle
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0) {
      this.patrolTimer = Utils.randFloat(2, 5);
      if (this.patrolPoints.length > 0) this.state = 'patrol';
    }
  }

  _handlePatrol(dt, nearestPlayer, mapSystem) {
    if (nearestPlayer) {
      const dist = Utils.distance(this.x, this.y, nearestPlayer.x, nearestPlayer.y);
      if (dist < this.alertRange) {
        this.state = 'alert'; this.stateTimer = 0.2; this.target = nearestPlayer; return;
      }
    }
    if (this.patrolPoints.length === 0) { this.state = 'idle'; return; }
    const pt = this.patrolPoints[this.patrolIndex];
    const dist = Utils.distance(this.x, this.y, pt.x, pt.y);
    if (dist < 8) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
    } else {
      this._moveToward(pt.x, pt.y, this.speed * 0.6, dt, mapSystem);
    }
  }

  _handleChasing(dt, nearestPlayer, mapSystem) {
    if (!nearestPlayer) { this.state = 'idle'; return; }
    this.target = nearestPlayer;
    this.targetId = nearestPlayer.id;
    const dist = Utils.distance(this.x, this.y, nearestPlayer.x, nearestPlayer.y);
    if (dist <= this.attackRange && this._attackCooldownLeft <= 0) {
      this.state = 'attackWindup';
      this.stateTimer = this._getWindupTime();
      this._attackCooldownLeft = this.attackCooldown;
    } else {
      this._moveToward(nearestPlayer.x, nearestPlayer.y, this.speed, dt, mapSystem);
    }
  }

  _getWindupTime() { return 0.6; }

  _performAttack(nearestPlayer) {
    // Returns hit info; actual damage dealt by CombatSystem
    if (!nearestPlayer) return null;
    const dist = Utils.distance(this.x, this.y, nearestPlayer.x, nearestPlayer.y);
    if (dist <= this.attackRange + 10) {
      return { targetId: nearestPlayer.id, damage: this.damage, type: 'melee' };
    }
    return null;
  }

  _moveToward(tx, ty, speed, dt, mapSystem) {
    const dir = Utils.normalize(tx - this.x, ty - this.y);
    this.facing = Math.atan2(dir.y, dir.x);
    const step = speed * dt;
    const nx = this.x + dir.x * step;
    const ny = this.y + dir.y * step;
    if (mapSystem) {
      const hw = 10;
      if (!mapSystem.isSolid(nx - hw, this.y) && !mapSystem.isSolid(nx + hw, this.y)) this.x = nx;
      if (!mapSystem.isSolid(this.x, ny - hw) && !mapSystem.isSolid(this.x, ny + hw)) this.y = ny;
    } else {
      this.x = nx; this.y = ny;
    }
  }

  takeDamage(amount, knockbackX = 0, knockbackY = 0) {
    if (this.dead || this.invincibleTimer > 0) return null;
    this.hp -= amount;
    this.vx = knockbackX;
    this.vy = knockbackY;
    this.invincibleTimer = 0.1;
    if (this.state !== 'attacking' && this.state !== 'attackWindup') {
      this.state = 'hurt';
      this.stateTimer = 0.2;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.state = 'dead';
      return { died: true, damage: amount };
    }
    return { damage: amount };
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      state: this.state,
      facing: this.facing,
      phase: this.phase,
      dead: this.dead
    };
  }
}

module.exports = Enemy;
