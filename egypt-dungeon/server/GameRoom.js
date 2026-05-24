const Player = require('./entities/Player');
const MapSystem = require('./systems/MapSystem');
const CombatSystem = require('./systems/CombatSystem');
const WaveSystem = require('./systems/WaveSystem');
const LootSystem = require('./systems/LootSystem');
const GameLoop = require('./GameLoop');
const STORY = require('./data/storyData');
const Utils = require('../shared/utils');
const C = require('../shared/constants');

class GameRoom {
  constructor(socket1, socket2, io) {
    this.id = Utils.generateId();
    this.io = io;
    this.sockets = socket2 ? [socket1, socket2] : [socket1];

    // Players: socket1 = warrior (Cinar), socket2 = archer (Ecem, optional)
    this.players = [new Player(socket1.id, 'warrior', 0)];
    if (socket2) this.players.push(new Player(socket2.id, 'archer', 1));

    this.currentLevel = 0;
    this.phase = 'lobby'; // lobby, playing, dialogue, escape, gameover, victory
    this.mapSystem = null;
    this.combatSystem = null;
    this.waveSystem = null;
    this.lootSystem = null;
    this.loop = new GameLoop(this);

    this.dialogueQueue = null;
    this.dialogueLine = 0;
    this.dialogueReady = new Set();

    this.escapeTimer = 0;
    this.escapeActive = false;
    this.pressurePlatesActive = new Set();

    this._socketHandlers = []; // {socket, event, fn} for cleanup
    this._dialogueAutoTimer = null;

    this._bindSockets();
  }

  _bindSockets() {
    for (const socket of this.sockets) {
      const onInput = (input) => {
        const player = this.players.find(p => p.id === socket.id);
        if (player) player.applyInput(input);
      };
      const onEquip = ({ itemId, slot }) => {
        const player = this.players.find(p => p.id === socket.id);
        if (player && this.lootSystem) {
          this.lootSystem.equipItem(player, itemId, slot);
        }
      };
      const onReady = () => {
        this.dialogueReady.add(socket.id);
        if (this.dialogueReady.size >= 1) {
          this._advanceDialogue();
        }
      };
      const onDisconnect = () => this._handleDisconnect(socket.id);

      socket.on('player:input', onInput);
      socket.on('player:equip', onEquip);
      socket.on('player:ready', onReady);
      socket.on('disconnect', onDisconnect);

      this._socketHandlers.push(
        { socket, event: 'player:input', fn: onInput },
        { socket, event: 'player:equip', fn: onEquip },
        { socket, event: 'player:ready', fn: onReady },
        { socket, event: 'disconnect', fn: onDisconnect }
      );
    }
  }

  _unbindSockets() {
    for (const h of this._socketHandlers) {
      try { h.socket.off(h.event, h.fn); } catch (_) {}
    }
    this._socketHandlers = [];
  }

  start() {
    this._startLevel(0);
  }

  _startLevel(levelIndex) {
    this.currentLevel = levelIndex;
    this.mapSystem = new MapSystem(levelIndex);
    this.combatSystem = new CombatSystem(this);
    this.waveSystem = new WaveSystem(levelIndex, this.mapSystem);
    this.lootSystem = new LootSystem();
    this.pressurePlatesActive.clear();

    // Spawn room
    this.waveSystem.spawnRoom(0);

    // Position players at spawn points
    const spawnPositions = this.mapSystem.getPlayerSpawnPositions();
    for (let i = 0; i < this.players.length; i++) {
      const sp = spawnPositions[i] || spawnPositions[0];
      this.players[i].x = sp.x;
      this.players[i].y = sp.y;
      this.players[i].hp = this.players[i].maxHp;
      this.players[i].dead = false;
      this.players[i].state = 'idle';
    }

    this.phase = 'playing';
    if (!this.loop.isRunning()) this.loop.start();

    this._emitAll('level:start', {
      level: levelIndex,
      levelName: C.LEVELS[levelIndex],
      mapData: this.mapSystem.serialize()
    });
  }

  update(dt) {
    if (this.phase !== 'playing' && this.phase !== 'escape') return;

    // Update map (traps)
    this.mapSystem.update(dt);

    // Check which rooms need enemy spawns (player enters new room)
    for (const player of this.players) {
      if (player.dead) continue;
      const room = this.mapSystem.getRoomAtWorld(player.x, player.y);
      if (room && this.waveSystem._roomEnemyCounts[room.index] === undefined) {
        this.waveSystem.spawnRoom(room.index);
        this._emitAll('room_entered', { roomIndex: room.index });
      }
    }

    // Pressure plates
    this._checkPressurePlates();

    // Update players
    for (const player of this.players) {
      player.update(dt, this.mapSystem);
      // Respawn
      if (player.dead && player.respawnTimer <= 0) {
        const sp = this.mapSystem.getPlayerSpawnPositions();
        player.respawn(sp[player.index]?.x || 200, sp[player.index]?.y || 200);
        this._emitAll('player:respawned', { playerId: player.id });
      }
    }

    // Combat
    const enemies = this.waveSystem.enemies;
    for (const player of this.players) {
      this.combatSystem.processPlayerAttack(player, enemies);
    }
    this.combatSystem.updateProjectiles(dt, enemies, this.players, this.mapSystem);
    this.combatSystem.processEnemyAttacks(enemies, this.players);
    this.combatSystem.processTrapDamage(this.players, this.mapSystem);

    // Pharaoh curse zones
    const boss = enemies.find(e => e.type === 'pharaoh');
    if (boss) {
      this.combatSystem.processCurseZones(this.players, boss);
      this.combatSystem.processAnubisChase(this.players, boss);
    }

    // Wave system
    this.waveSystem.update(dt, this.players);

    // Loot pickup
    for (const player of this.players) {
      this.lootSystem.tryPickup(player);
    }

    // Collect and emit events
    const combatEvents = this.combatSystem.getAndClearEvents();
    const waveEvents = this.waveSystem.getAndClearEvents();
    const lootEvents = this.lootSystem.getAndClearEvents();

    // Process loot drops from kills
    for (const evt of combatEvents) {
      if (evt.type === 'kill' && evt.loot) {
        const killedEnemy = enemies.find(e => e.id === evt.enemyId);
        const dropX = killedEnemy ? killedEnemy.x : 0;
        const dropY = killedEnemy ? killedEnemy.y : 0;
        this.lootSystem.dropLoot(evt.loot, dropX, dropY);
      }
      // Ankh wisp charge
      if (evt.type === 'kill' && boss) {
        this.waveSystem.onWispKilled(evt.enemyId, boss);
      }
    }

    // Emit game events
    const allEvents = [...combatEvents, ...waveEvents, ...lootEvents];
    if (allEvents.length > 0) {
      this._emitAll('game:events', allEvents);
    }

    // Wave/story events
    for (const evt of waveEvents) {
      if (evt.type === 'room_cleared') {
        this._handleRoomCleared(evt.roomIndex);
      }
      if (evt.type === 'level_complete') {
        this._handleLevelComplete();
      }
      if (evt.type === 'boss_phase2') {
        this._startDialogue(this.currentLevel === 2 ? 'boss_phase2' : null);
      }
      if (evt.type === 'boss_phase3') {
        this._startDialogue(this.currentLevel === 2 ? 'boss_phase3' : null);
      }
    }

    // Map state changes (traps, doors)
    this._emitAll('map:update', {
      traps: this.mapSystem.trapTiles.map(t => ({ tx: t.tx, ty: t.ty, active: t.active })),
      doors: this.mapSystem.doors
    });

    // Escape timer
    if (this.phase === 'escape') {
      this.escapeTimer -= dt;
      this._emitAll('escape:tick', { timeLeft: Math.max(0, this.escapeTimer) });
      if (this.escapeTimer <= 0) {
        this._gameOver(false);
      }
      // Check if both players reached exit (top of map)
      const allEscaped = this.players.every(p => p.y < C.TILE_SIZE * 4);
      if (allEscaped) {
        this._victory();
      }
    }

    // Check game over (both dead)
    if (this.players.every(p => p.dead && p.respawnTimer <= 0)) {
      this._gameOver(false);
    }
  }

  _checkPressurePlates() {
    for (const plate of this.mapSystem.pressurePlates) {
      let occupied = false;
      for (const player of this.players) {
        if (player.dead) continue;
        if (Math.abs(player.x - (plate.tx + 0.5) * C.TILE_SIZE) < 20 &&
            Math.abs(player.y - (plate.ty + 0.5) * C.TILE_SIZE) < 20) {
          occupied = true;
          break;
        }
      }
      plate.active = occupied;
    }
    // If all plates active, open inner doors
    if (this.mapSystem.pressurePlates.length > 0 && this.mapSystem.pressurePlates.every(p => p.active)) {
      const id = 'plates_triggered';
      if (!this.pressurePlatesActive.has(id)) {
        this.pressurePlatesActive.add(id);
        // Open all puzzle doors
        for (const door of this.mapSystem.doors) {
          door.open = true;
          door.locked = false;
        }
        this._startDialogue('level2_puzzle');
        this._emitAll('puzzle:solved');
      }
    }
  }

  _handleRoomCleared(roomIndex) {
    const room = this.mapSystem.rooms[roomIndex];
    if (!room) return;
    // Mid-level story beats
    if (this.currentLevel === 0 && roomIndex === 2) {
      this._startDialogue('level1_mid');
    }
    if (roomIndex === this.mapSystem.rooms.length - 2) { // pre-boss room
      const storyKey = this.currentLevel === 0 ? 'level1_boss_entry' :
                       this.currentLevel === 1 ? 'level2_boss_entry' : 'level3_boss_entry';
      this._startDialogue(storyKey);
    }
    this._emitAll('room:cleared', { roomIndex });
  }

  _handleLevelComplete() {
    if (this.currentLevel < 2) {
      // Level complete dialogue then advance
      const storyKey = this.currentLevel === 0 ? 'level1_complete' : 'level2_complete';
      this.phase = 'dialogue';
      this.loop.stop();
      this._startDialogue(storyKey, () => {
        // Level up players
        for (const p of this.players) p.levelUp();
        this._startLevel(this.currentLevel + 1);
      });
      this._emitAll('level:complete', { level: this.currentLevel });
    } else {
      // Final level complete → victory story
      this.phase = 'dialogue';
      this.loop.stop();
      this._startDialogue('victory', () => {
        this.phase = 'escape';
        this.escapeTimer = 60;
        this.loop.start();
        this._emitAll('escape:start', { timeLimit: 60 });
      });
    }
  }

  _startDialogue(key, callback) {
    if (!key) { if (callback) callback(); return; }
    let script = STORY[key];
    if (!script) { if (callback) callback(); return; }

    // Replace name placeholders
    script = script.map(line => ({
      ...line,
      speaker: line.speaker?.replace('CINAR', 'Cinar').replace('ECEM', 'Ecem'),
      text: line.text
    }));

    this.dialogueQueue = { script, callback };
    this.dialogueLine = 0;
    this.dialogueReady.clear();
    this._emitAll('dialogue:start', { key, script, line: 0 });

    // Clear any previous auto-timer before starting a new one
    if (this._dialogueAutoTimer) {
      clearInterval(this._dialogueAutoTimer);
      this._dialogueAutoTimer = null;
    }
    // Auto-advance each line after 6 seconds if no player input
    this._dialogueAutoTimer = setInterval(() => {
      if (this.dialogueQueue) {
        this.dialogueReady.clear();
        this._advanceDialogue();
      } else if (this._dialogueAutoTimer) {
        clearInterval(this._dialogueAutoTimer);
        this._dialogueAutoTimer = null;
      }
    }, 6000);
  }

  _advanceDialogue() {
    if (!this.dialogueQueue) return;
    this.dialogueLine++;
    this.dialogueReady.clear();
    if (this.dialogueLine >= this.dialogueQueue.script.length) {
      if (this._dialogueAutoTimer) {
        clearInterval(this._dialogueAutoTimer);
        this._dialogueAutoTimer = null;
      }
      const cb = this.dialogueQueue.callback;
      this.dialogueQueue = null;
      if (cb) cb();
      this._emitAll('dialogue:end');
    } else {
      this._emitAll('dialogue:line', { line: this.dialogueLine });
    }
  }

  broadcast() {
    const state = {
      tick: this.loop.tickCount,
      players: this.players.map(p => p.serialize()),
      enemies: this.waveSystem ? this.waveSystem.serializeEnemies() : [],
      projectiles: [
        ...(this.combatSystem ? this.combatSystem.serializeProjectiles() : []),
        ...(this.waveSystem ? this.waveSystem.serializeWispProjectiles() : [])
      ],
      loot: this.lootSystem ? this.lootSystem.serialize() : [],
      phase: this.phase,
      escapeTimer: this.escapeTimer
    };
    this._emitAll('game:state', state);
  }

  _emitAll(event, data) {
    for (const socket of this.sockets) {
      socket.emit(event, data);
    }
  }

  _handleDisconnect(socketId) {
    console.log(`Player ${socketId} disconnected from room ${this.id}`);
    this._teardown();
    this._emitAll('player:disconnected', { socketId });
  }

  hasPlayer(socketId) {
    return this.sockets.some(s => s.id === socketId);
  }

  _gameOver(won) {
    if (this.phase === 'gameover' || this.phase === 'victory') return;
    this.phase = 'gameover';
    this.loop.stop();
    if (this._dialogueAutoTimer) {
      clearInterval(this._dialogueAutoTimer);
      this._dialogueAutoTimer = null;
    }
    const stats = this.players.map(p => ({ name: p.name, kills: p.kills, level: p.level }));
    this._emitAll('game:over', { victory: won, stats });
  }

  _victory() {
    if (this.phase === 'victory') return;
    this.phase = 'victory';
    this.loop.stop();
    this._startDialogue('escape_complete');
    const stats = this.players.map(p => ({ name: p.name, kills: p.kills, level: p.level }));
    this._emitAll('game:victory', { stats });
  }

  _teardown() {
    this.loop.stop();
    if (this._dialogueAutoTimer) {
      clearInterval(this._dialogueAutoTimer);
      this._dialogueAutoTimer = null;
    }
    this._unbindSockets();
  }
}

module.exports = GameRoom;
