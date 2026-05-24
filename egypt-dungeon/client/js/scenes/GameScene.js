class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create() {
    const socket = window.gameSocket;
    if (!socket) { this.scene.start('MenuScene'); return; }
    this.socket = socket;

    // State
    this.mapData = null;
    this.gameState = null;
    this.localPlayer = null;
    this.localPlayerIndex = window.myPlayerIndex || 0;

    // Display objects
    this.tileSprites = [];
    this.playerSprites = {}; // id -> {sprite, nameText, hpBg, hpBar, cat}
    this.enemySprites = {}; // id -> {sprite, hpBg, hpBar, phaseText}
    this.projectileSprites = {}; // id -> sprite
    this.lootSprites = {}; // id -> {sprite, text}
    this.curseZoneSprites = [];
    this.anubisSprite = null;
    this.torchSprites = []; // for flicker

    // Systems
    this.particles = new ParticleSystem(this);
    this.inputSystem = null;
    this.dialogueBox = null;
    this.inventoryUI = null;
    this.lootPopup = new LootPopup(this);
    this.minimap = new Minimap(this);

    // UI elements
    this.hpBars = [];
    this.levelNameText = null;
    this.escapeTimerText = null;
    this.bossHpBar = null;
    this.bossHpBg = null;
    this.bossNameText = null;

    // Dialogue state
    this.dialogueActive = false;
    this.currentDialogueScript = null;
    this.currentDialogueLine = 0;

    // Phase tracking
    this.escapeModeActive = false;
    this.anubisChaseTarget = null;

    this._setupSockets();

    // Use any pre-received data
    if (window.currentLevelData) {
      this._onLevelStart(window.currentLevelData);
    }
    if (window.currentDialogue) {
      this._onDialogueStart(window.currentDialogue);
      window.currentDialogue = null;
    }
  }

  _setupSockets() {
    const s = this.socket;

    s.off('level:start');
    s.off('game:state');
    s.off('game:events');
    s.off('dialogue:start');
    s.off('dialogue:line');
    s.off('dialogue:end');
    s.off('map:update');
    s.off('room:cleared');
    s.off('room_entered');
    s.off('escape:start');
    s.off('escape:tick');
    s.off('game:over');
    s.off('game:victory');
    s.off('puzzle:solved');
    s.off('player:disconnected');

    s.on('level:start', (data) => this._onLevelStart(data));
    s.on('game:state', (state) => this._onGameState(state));
    s.on('game:events', (events) => this._onGameEvents(events));
    s.on('dialogue:start', (data) => this._onDialogueStart(data));
    s.on('dialogue:line', (data) => this._advanceDialogueTo(data.line));
    s.on('dialogue:end', () => this._onDialogueEnd());
    s.on('map:update', (data) => this._onMapUpdate(data));
    s.on('room:cleared', (data) => this._onRoomCleared(data));
    s.on('escape:start', (data) => this._onEscapeStart(data));
    s.on('escape:tick', (data) => this._onEscapeTick(data));
    s.on('game:over', (data) => this._onGameOver(data));
    s.on('game:victory', (data) => this._onVictory(data));
    s.on('puzzle:solved', () => { if (this.particles) this.particles.aoeRing(400, 300, 100, PALETTE.GOLD); });
    s.on('player:disconnected', () => { this._showNotice('Partner disconnected! Reload to restart.'); });
  }

  _onLevelStart(data) {
    this.mapData = data.mapData;
    this._clearLevel();
    this._buildTilemap(data.mapData);
    this.minimap.setMap(data.mapData);

    // Level name banner
    if (this.levelNameText) this.levelNameText.destroy();
    const W = this.scale.width;
    this.levelNameText = this.add.text(W/2, 30, data.levelName || '', {
      fontSize: '22px', fontFamily: 'monospace', color: PALETTE.TEXT_GOLD,
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(90);
    this.tweens.add({ targets: this.levelNameText, alpha: { from: 1, to: 0 }, delay: 3000, duration: 1000 });

    // Start music
    const theme = data.level === 0 ? 'level1' : data.level === 1 ? 'level2' : 'level3';
    Sound.startBGM(theme);

    // Create input system (lazy, after map)
    if (!this.inputSystem) {
      this.inputSystem = new InputSystem(this, this.socket);
    }

    // Create dialogue box and inventory
    if (this.dialogueBox) this.dialogueBox.destroy();
    this.dialogueBox = new DialogueBox(this);
    if (this.inventoryUI) this.inventoryUI.destroy();
    this.inventoryUI = new InventoryUI(this, this.socket, null);

    // Re-show dialogue if it was already active when level data arrived
    if (this.dialogueActive && this.currentDialogueScript) {
      this.dialogueBox.show(this.currentDialogueScript[this.currentDialogueLine]);
    }

    // HUD
    this._buildHUD();
  }

  _buildTilemap(mapData) {
    if (!mapData || !mapData.rooms) return;
    const TS = 32;

    for (const room of mapData.rooms) {
      const palette = mapData.palette;
      for (let ry = 0; ry < room.h; ry++) {
        for (let rx = 0; rx < room.w; rx++) {
          const tile = room.tiles[ry][rx];
          const wx = (room.tileOffX + rx) * TS;
          const wy = (room.tileOffY + ry) * TS;
          let key = this._tileKey(tile, palette);
          if (!key) continue;
          const img = this.add.image(wx + TS/2, wy + TS/2, key).setDepth(0);
          this.tileSprites.push(img);

          if (tile === 4) { // torch
            this.torchSprites.push({ img, x: wx + TS/2, y: wy + TS/2, timer: Math.random() * 0.4 });
          }
        }
      }
    }

    // Start world bounds. The dungeon is taller than wide, so if the world
    // is narrower than the screen we pad the bounds equally on both sides
    // so the camera can scroll to center the play area instead of pinning
    // everything to the left edge.
    if (mapData.worldWidth && mapData.worldHeight) {
      const screenW = this.scale.width;
      const screenH = this.scale.height;
      const padX = Math.max(0, Math.ceil((screenW - mapData.worldWidth) / 2));
      const padY = Math.max(0, Math.ceil((screenH - mapData.worldHeight) / 2));
      this.cameras.main.setBounds(
        -padX,
        -padY,
        mapData.worldWidth + 2 * padX,
        mapData.worldHeight + 2 * padY
      );
    }
  }

  _tileKey(tile, palette) {
    const isDesert = palette === 'desert';
    const isTomb = palette === 'tomb';
    const isCursed = palette === 'cursed';
    switch (tile) {
      case 0: return isCursed ? 'tile_curse_floor' : 'tile_sand';
      case 1: return isCursed ? 'tile_wall_curse' : isTomb ? 'tile_wall_dark' : 'tile_wall';
      case 2: return 'tile_door_open'; // doors start open-looking (server controls)
      case 3: return 'tile_trap_off';
      case 4: return 'tile_torch';
      case 5: return 'tile_deco';
      case 6: return 'tile_plate_off';
      case 7: return 'tile_water';
      default: return null;
    }
  }

  _buildHUD() {
    const W = this.scale.width;
    const playerCount = this.gameState?.players?.length ?? (window.partnerJoined ? 2 : 1);

    // Player 1 (Cinar/Warrior) HUD — bottom left
    this.p1Hp = new HealthBar(this, 14, this.scale.height - 50, 120, 10).setScrollFactor(0).setDepth(90).addStaminaBar();
    this.p1Name = this.add.text(14, this.scale.height - 65, '♥ Cinar', {
      fontSize: '13px', fontFamily: 'monospace', color: PALETTE.TEXT_GOLD,
      stroke: '#000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(90);
    this.p1LvlText = this.add.text(90, this.scale.height - 65, '', {
      fontSize: '10px', fontFamily: 'monospace', color: PALETTE.TEXT_SAND
    }).setScrollFactor(0).setDepth(90);

    // Player 2 (Ecem/Archer) HUD — bottom right. Only when a partner is present.
    if (playerCount >= 2) {
      this.p2Hp = new HealthBar(this, W - 136, this.scale.height - 50, 120, 10).setScrollFactor(0).setDepth(90).addStaminaBar();
      this.p2Name = this.add.text(W - 136, this.scale.height - 65, '♥ Ecem', {
        fontSize: '13px', fontFamily: 'monospace', color: PALETTE.ARCHER_TEAL,
        stroke: '#000', strokeThickness: 2
      }).setScrollFactor(0).setDepth(90);
    } else {
      this.p2Hp = null;
      this.p2Name = null;
    }

    // Combo counter (warrior)
    this.comboText = this.add.text(14, this.scale.height - 90, '', {
      fontSize: '14px', fontFamily: 'monospace', color: PALETTE.CRIT_ORANGE,
      stroke: '#000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(90);

    // Boss HP bar (hidden initially)
    this._buildBossHUD();

    // Escape timer
    this.escapeTimerText = this.add.text(W/2, 60, '', {
      fontSize: '20px', fontFamily: 'monospace', color: PALETTE.HP_RED,
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(95).setVisible(false);
  }

  _buildBossHUD() {
    const W = this.scale.width;
    if (this.bossHpBg) this.bossHpBg.destroy();
    if (this.bossHpBar) this.bossHpBar.destroy();
    if (this.bossNameText) this.bossNameText.destroy();

    this.bossHpBg = this.add.graphics();
    this.bossHpBg.fillStyle(0x000000, 0.7);
    this.bossHpBg.fillRect(W/2 - 150, 12, 300, 16);
    this.bossHpBg.lineStyle(1, PALETTE.UI_BORDER);
    this.bossHpBg.strokeRect(W/2 - 150, 12, 300, 16);
    this.bossHpBg.setScrollFactor(0).setDepth(90).setVisible(false);

    this.bossHpBar = this.add.graphics();
    this.bossHpBar.setScrollFactor(0).setDepth(91).setVisible(false);

    this.bossNameText = this.add.text(W/2, 8, '', {
      fontSize: '11px', fontFamily: 'monospace', color: PALETTE.TEXT_GOLD
    }).setOrigin(0.5).setScrollFactor(0).setDepth(92).setVisible(false);
  }

  _onGameState(state) {
    this.gameState = state;

    // Update local player ref
    const myId = window.myPlayerId;
    const myData = state.players?.find(p => p.id === myId);
    if (myData) {
      this.localPlayer = myData;
    }

    // Camera follow midpoint of alive players
    this._updateCamera(state.players);

    // Sync player sprites
    this._syncPlayers(state.players);

    // Sync enemies
    this._syncEnemies(state.enemies);

    // Sync projectiles
    this._syncProjectiles(state.projectiles);

    // Sync loot
    this._syncLoot(state.loot);

    // Update HUD
    this._updateHUD(state);

    // Minimap (players + enemies)
    if (state.players) this.minimap.update(state.players, state.enemies);
  }

  _updateCamera(players) {
    if (!players || players.length === 0) return;
    const alive = players.filter(p => !p.dead);
    if (alive.length === 0) return;

    let cx = 0, cy = 0;
    for (const p of alive) { cx += p.x; cy += p.y; }
    cx /= alive.length; cy /= alive.length;

    // Store target; smoothing happens each frame in update()
    this._cameraTargetX = cx - this.scale.width / 2;
    this._cameraTargetY = cy - this.scale.height / 2;

    // Zoom out if players are far apart
    if (alive.length >= 2) {
      const dist = Math.sqrt(Math.pow(alive[0].x - alive[1].x, 2) + Math.pow(alive[0].y - alive[1].y, 2));
      const zoom = dist > 500 ? Math.max(0.5, 1 - (dist - 500) / 1000) : 1;
      this._cameraTargetZoom = zoom;
    } else {
      this._cameraTargetZoom = 1;
    }
  }

  _syncPlayers(players) {
    if (!players) return;
    for (const pData of players) {
      if (!this.playerSprites[pData.id]) {
        this._createPlayerSprite(pData);
      }
      this._updatePlayerSprite(pData);
    }
  }

  _createPlayerSprite(pData) {
    const cls = pData.class;
    const key = `${cls}_idle`;
    const sprite = this.add.image(pData.x, pData.y, key).setDepth(10).setScale(1.5);
    const nameText = this.add.text(pData.x, pData.y - 26, `♥ ${pData.name}`, {
      fontSize: '11px', fontFamily: 'monospace', color: cls === 'warrior' ? PALETTE.TEXT_GOLD : '#0D9488',
      stroke: '#000', strokeThickness: 2
    }).setOrigin(0.5).setDepth(11);

    const hpBg = this.add.graphics().setDepth(11);
    const hpBar = this.add.graphics().setDepth(12);

    let cat = null;
    if (cls === 'archer') {
      cat = this.add.image(pData.x - 20, pData.y + 8, 'cat_0').setDepth(9).setScale(1.2);
      this._catFrame = 0;
      this._catTimer = 0;
      this._catTargetX = pData.x;
      this._catTargetY = pData.y;
    }

    this.playerSprites[pData.id] = {
      sprite, nameText, hpBg, hpBar, cat,
      targetX: pData.x, targetY: pData.y,
      prevX: pData.x, prevY: pData.y
    };
  }

  _updatePlayerSprite(pData) {
    const s = this.playerSprites[pData.id];
    if (!s) return;

    // Store target position; actual lerp happens in update() each frame.
    // First-snap if the gap is huge (teleport / respawn / level start).
    const dxSnap = pData.x - s.sprite.x;
    const dySnap = pData.y - s.sprite.y;
    if (Math.abs(dxSnap) > 200 || Math.abs(dySnap) > 200) {
      s.sprite.x = pData.x;
      s.sprite.y = pData.y;
    }
    s.targetX = pData.x;
    s.targetY = pData.y;
    s.nameText.x = s.sprite.x;
    s.nameText.y = s.sprite.y - 28;

    // Sprite texture based on state
    const cls = pData.class;
    let frameKey = `${cls}_idle`;
    if (pData.state === 'running') {
      const frame = Math.floor(Date.now() / 120) % 4;
      frameKey = `${cls}_run${frame}`;
    } else if (pData.state === 'attacking') {
      const frame = Math.floor(Date.now() / 80) % 3;
      frameKey = `${cls}_attack${frame}`;
    } else if (pData.state === 'hurt') {
      frameKey = `${cls}_hurt`;
    } else if (pData.state === 'dead') {
      frameKey = `${cls}_dead`;
    }
    if (this.textures.exists(frameKey)) s.sprite.setTexture(frameKey);

    // Flip based on facing
    s.sprite.setFlipX(Math.cos(pData.facing) < 0);

    // Rage aura
    if (pData.rageActive) {
      s.sprite.setTint(0xFF8800);
    } else {
      s.sprite.clearTint();
    }

    // Dead alpha
    s.sprite.alpha = pData.dead ? 0.3 : 1;
    s.nameText.alpha = pData.dead ? 0.3 : 1;

    // HP bar above player — anchor to sprite position (interpolation-friendly)
    s.hpBg.clear();
    s.hpBar.clear();
    if (!pData.dead) {
      const bw = 30, bh = 3;
      const bx = s.sprite.x - 15, by = s.sprite.y - 20;
      s.hpBg.fillStyle(0x000000, 0.6);
      s.hpBg.fillRect(bx, by, bw, bh);
      const pct = Math.max(0, pData.hp / pData.maxHp);
      const col = pct > 0.5 ? PALETTE.HP_GREEN : pct > 0.25 ? 0xFFAA00 : PALETTE.HP_RED;
      s.hpBar.fillStyle(col);
      s.hpBar.fillRect(bx, by, Math.round(bw * pct), bh);
      s._hpMeta = { bw, bh, pct, col };
    } else {
      s._hpMeta = null;
    }

    // Cat companion (Ecem's archer)
    if (s.cat) {
      const refX = s.sprite.x, refY = s.sprite.y;
      const targetX = pData.dead ? refX : refX - (Math.cos(pData.facing) > 0 ? 20 : -20);
      const targetY = refY + 8;
      s.cat.x += (targetX - s.cat.x) * 0.12;
      s.cat.y += (targetY - s.cat.y) * 0.12;
      // Cat animation
      const catFrame = pData.state === 'running' ? Math.floor(Date.now() / 200) % 2 : Math.floor(Date.now() / 500) % 2;
      const catKey = `cat_${catFrame}`;
      if (this.textures.exists(catKey)) s.cat.setTexture(catKey);
      s.cat.setFlipX(Math.cos(pData.facing) < 0);
      s.cat.alpha = pData.dead ? 0.3 : 1;
    }

    s.prevX = pData.x;
    s.prevY = pData.y;
  }

  _syncEnemies(enemies) {
    if (!enemies) return;
    const activeIds = new Set(enemies.map(e => e.id));

    // Remove dead/absent
    for (const id of Object.keys(this.enemySprites)) {
      if (!activeIds.has(id)) {
        const s = this.enemySprites[id];
        s.sprite.destroy();
        if (s.hpBg) s.hpBg.destroy();
        if (s.hpBar) s.hpBar.destroy();
        if (s.phaseText) s.phaseText.destroy();
        delete this.enemySprites[id];
      }
    }

    for (const eData of enemies) {
      if (!this.enemySprites[eData.id]) {
        this._createEnemySprite(eData);
      }
      this._updateEnemySprite(eData);
    }
  }

  _createEnemySprite(eData) {
    const key = this._getEnemyTextureKey(eData);
    const scl = eData.isBoss ? 1.5 : 1;
    const sprite = this.add.image(eData.x, eData.y, key).setDepth(8).setScale(scl);
    const hpBg = this.add.graphics().setDepth(9);
    const hpBar = this.add.graphics().setDepth(10);
    let phaseText = null;
    if (eData.isBoss) {
      phaseText = this.add.text(eData.x, eData.y - 40, '', {
        fontSize: '11px', fontFamily: 'monospace', color: PALETTE.TEXT_PURPLE,
        stroke: '#000', strokeThickness: 2
      }).setOrigin(0.5).setDepth(11);
      // Boss music
      Sound.startBGM('boss');
      // Show boss HP bar
      this._showBossHpBar(eData);
    }
    this.enemySprites[eData.id] = { sprite, hpBg, hpBar, phaseText, targetX: eData.x, targetY: eData.y };
  }

  _getEnemyTextureKey(eData) {
    const keys = {
      mummy: 'mummy_idle',
      scarab: 'scarab_idle',
      anubis: 'anubis_idle',
      wisp: 'wisp_0',
      statue: 'statue_idle',
      gatekeeper: 'gatekeeper_idle',
      shade: 'shade_idle',
      pharaoh: `pharaoh_p${eData.phase || 1}`
    };
    return keys[eData.type] || 'mummy_idle';
  }

  _updateEnemySprite(eData) {
    const s = this.enemySprites[eData.id];
    if (!s) return;

    // Lerp target — actual interpolation in update()
    const dxSnap = eData.x - s.sprite.x;
    const dySnap = eData.y - s.sprite.y;
    if (Math.abs(dxSnap) > 200 || Math.abs(dySnap) > 200) {
      s.sprite.x = eData.x;
      s.sprite.y = eData.y;
    }
    s.targetX = eData.x;
    s.targetY = eData.y;

    // Animate based on state & type
    const t = Date.now();
    if (eData.type === 'wisp') {
      s.sprite.setTexture(`wisp_${Math.floor(t / 150) % 3}`);
      s.sprite.y += Math.sin(t / 400) * 2; // float
    } else if (eData.type === 'shade') {
      s.sprite.alpha = 0.7 + Math.sin(t / 300) * 0.3;
    } else if (eData.state === 'hurt') {
      s.sprite.setTint(PALETTE.HIT_FLASH);
    } else {
      s.sprite.clearTint();
      if (eData.state === 'chasing' || eData.state === 'patrol') {
        const walkKey = `${eData.type}_walk`;
        if (this.textures.exists(walkKey)) s.sprite.setTexture(walkKey);
      } else if (eData.state === 'attacking' || eData.state === 'attackWindup') {
        const atkKey = `${eData.type}_attack`;
        if (this.textures.exists(atkKey)) s.sprite.setTexture(atkKey);
      } else {
        const idleKey = this._getEnemyTextureKey(eData);
        if (this.textures.exists(idleKey)) s.sprite.setTexture(idleKey);
      }
    }

    // Flip
    s.sprite.setFlipX(Math.cos(eData.facing) < 0);

    // Phase indicator for pharaoh
    if (eData.type === 'pharaoh') {
      const pKey = `pharaoh_p${eData.phase || 1}`;
      if (this.textures.exists(pKey)) s.sprite.setTexture(pKey);
      if (eData.immune) {
        s.sprite.setTint(PALETTE.CURSE_PURPLE);
      } else {
        s.sprite.clearTint();
      }
    }

    // HP bar above enemy — follow rendered sprite position, not raw server pos,
    // so it stays attached during interpolation.
    s.hpBg.clear();
    s.hpBar.clear();
    const bw = eData.isBoss ? 60 : 28;
    const bh = eData.isBoss ? 6 : 3;
    const bx = s.sprite.x - bw / 2, by = s.sprite.y - (eData.isBoss ? 50 : 22);
    s.hpBg.fillStyle(0x000000, 0.7);
    s.hpBg.fillRect(bx, by, bw, bh);
    const pct = Math.max(0, eData.hp / eData.maxHp);
    const col = eData.isBoss ? PALETTE.CURSE_PURPLE : PALETTE.HP_RED;
    s.hpBar.fillStyle(col);
    s.hpBar.fillRect(bx, by, Math.round(bw * pct), bh);
    // Cache for re-anchoring after lerp
    s._hpMeta = { bw, bh, pct, col, isBoss: eData.isBoss };

    // Boss phase text
    if (s.phaseText) {
      s.phaseText.x = s.sprite.x;
      s.phaseText.y = s.sprite.y - 55;
      if (eData.isBoss) {
        const phText = eData.immune ? '— IMMUNE —' : `Phase ${eData.phase}`;
        s.phaseText.setText(phText);
        s.phaseText.setColor(eData.immune ? PALETTE.TEXT_PURPLE : PALETTE.TEXT_GOLD);
      }
    }

    // Boss HUD bar
    if (eData.isBoss) {
      this._updateBossHpBar(eData);
    }

    // Curse zones for pharaoh phase 3
    if (eData.type === 'pharaoh' && eData.curseZones && eData.phase === 3) {
      // Recreate curse zone sprites if needed
      if (this.curseZoneSprites.length === 0 && eData.curseZones.length > 0) {
        for (const zone of eData.curseZones) {
          if (this.textures.exists('curse_zone')) {
            const cz = this.add.image(zone.x, zone.y, 'curse_zone').setDepth(1).setAlpha(0.6);
            cz.setScale(zone.r / 32);
            this.curseZoneSprites.push(cz);
          }
        }
      }
    }
  }

  _showBossHpBar(eData) {
    if (this.bossHpBg) this.bossHpBg.setVisible(true);
    if (this.bossHpBar) this.bossHpBar.setVisible(true);
    if (this.bossNameText) {
      const names = { gatekeeper: 'The Gatekeeper', shade: "Nephthys's Shade", pharaoh: 'Pharaoh Khamun' };
      this.bossNameText.setText(names[eData.type] || 'Boss').setVisible(true);
    }
  }

  _updateBossHpBar(eData) {
    if (!this.bossHpBar || !this.bossHpBg) return;
    const W = this.scale.width;
    const pct = Math.max(0, eData.hp / eData.maxHp);
    const color = eData.immune ? PALETTE.CURSE_PURPLE : PALETTE.HP_RED;
    this.bossHpBar.clear();
    this.bossHpBar.fillStyle(color);
    this.bossHpBar.fillRect(W/2 - 150, 13, Math.round(298 * pct), 14);
    // Ankh charges for pharaoh phase 2
    if (eData.type === 'pharaoh' && eData.ankhCharges !== undefined && eData.immune) {
      const chargesText = `Ankh: ${eData.ankhCharges}/${eData.ankhChargesNeeded} wisps`;
      if (this.bossNameText) this.bossNameText.setText(chargesText);
    }
  }

  _syncProjectiles(projectiles) {
    if (!projectiles) return;
    const activeIds = new Set(projectiles.map(p => p.id));

    for (const id of Object.keys(this.projectileSprites)) {
      if (!activeIds.has(id)) {
        this.projectileSprites[id].destroy();
        delete this.projectileSprites[id];
      }
    }

    for (const proj of projectiles) {
      if (!this.projectileSprites[proj.id]) {
        const key = proj.type === 'wisp' ? 'wisp_bolt' : 'arrow';
        const spr = this.add.image(proj.x, proj.y, key).setDepth(7);
        if (proj.type === 'arrow') spr.setRotation(proj.angle);
        this.projectileSprites[proj.id] = spr;
      } else {
        this.projectileSprites[proj.id].x = proj.x;
        this.projectileSprites[proj.id].y = proj.y;
        if (proj.type === 'arrow') this.projectileSprites[proj.id].setRotation(proj.angle);
      }
    }
  }

  _syncLoot(loot) {
    if (!loot) return;
    const activeIds = new Set(loot.map(l => l.id));

    for (const id of Object.keys(this.lootSprites)) {
      if (!activeIds.has(id)) {
        const ls = this.lootSprites[id];
        ls.sprite.destroy();
        if (ls.text) ls.text.destroy();
        delete this.lootSprites[id];
      }
    }

    for (const lootItem of loot) {
      if (!this.lootSprites[lootItem.id]) {
        const glow = this.add.image(lootItem.x, lootItem.y, 'loot_glow').setDepth(5).setAlpha(0.85);
        const isPotion = lootItem.itemType === 'potion';
        const rarColor = { common: 0xFFFFFF, uncommon: PALETTE.UNCOMMON, rare: PALETTE.RARE, legendary: PALETTE.LEGENDARY };
        // Potions get a red glow so players read them as healing instantly.
        glow.setTint(isPotion ? 0xFF4D6D : (rarColor[lootItem.rarity] || 0xFFFFFF));
        if (isPotion) glow.setScale(1.15);
        const text = this.add.text(lootItem.x, lootItem.y - 16, lootItem.name || '', {
          fontSize: '9px', fontFamily: 'monospace',
          color: isPotion ? '#FF8FA3' : (PALETTE.RARITY_COLOR?.[lootItem.rarity] || '#FFFFFF'),
          stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5).setDepth(6);
        // Bounce animation
        this.tweens.add({ targets: glow, y: lootItem.y - 4, duration: 600, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
        this.lootSprites[lootItem.id] = { sprite: glow, text };
      }
    }
  }

  _onGameEvents(events) {
    if (!events) return;
    for (const evt of events) {
      switch (evt.type) {
        case 'hit':
          this.particles.hitSparks(evt.x, evt.y, evt.crit ? PALETTE.CRIT_ORANGE : PALETTE.HIT_FLASH);
          if (evt.damage > 0) this.particles.damageNumber(evt.x, evt.y, evt.damage, evt.crit);
          Sound.playHit(evt.crit);
          break;
        case 'playerHit':
          Sound.playPlayerHurt();
          this.cameras.main.shake(80, 0.008);
          break;
        case 'playerDied':
          Sound.playDeath();
          break;
        case 'kill':
          this.particles.hitSparks(evt.x || 0, evt.y || 0, PALETTE.TORCH_ORANGE, 10);
          break;
        case 'loot_collected':
          Sound.playLootPickup();
          if (evt.item) this.lootPopup.show(evt.item);
          break;
        case 'potion_used':
          Sound.playLootPickup();
          if (evt.heal > 0) this.particles.healNumber(evt.x ?? 0, evt.y ?? 0, evt.heal);
          break;
        case 'heavy':
          this.particles.aoeRing(evt.x, evt.y, evt.radius, PALETTE.TORCH_ORANGE);
          this.particles.sandPuff(evt.x, evt.y);
          Sound.playHeavyAttack();
          this.cameras.main.shake(100, 0.01);
          break;
        case 'attack':
          if (evt.class === 'warrior') Sound.playSwordSwing();
          break;
        case 'shoot':
          Sound.playArrowFire();
          break;
        case 'spread':
          Sound.playArrowFire();
          break;
        case 'ultimate':
          Sound.playUltimate();
          break;
        case 'trapHit':
          this.particles.hitSparks(evt.x, evt.y, 0xCCCCCC);
          break;
        case 'boss_phase2':
        case 'boss_phase3':
          this.cameras.main.shake(300, 0.02);
          break;
        case 'anubis_call':
          if (this.textures.exists('anubis_shadow')) {
            if (this.anubisSprite) this.anubisSprite.destroy();
            const target = this.gameState?.players?.find(p => p.id === evt.targetId);
            if (target) {
              this.anubisSprite = this.add.image(target.x, target.y, 'anubis_shadow').setDepth(15).setAlpha(0.8);
              this.anubisChaseTarget = evt.targetId;
            }
          }
          break;
        case 'anubis_dispelled':
          if (this.anubisSprite) { this.anubisSprite.destroy(); this.anubisSprite = null; }
          this.anubisChaseTarget = null;
          this.particles.aoeRing(0, 0, 60, PALETTE.GOLD);
          break;
        case 'boss_charge':
          this.cameras.main.shake(150, 0.015);
          break;
        case 'room_cleared':
          Sound.playRoomClear();
          break;
        case 'inventory_full':
          this._showNotice('Inventory full!');
          break;
      }
    }
  }

  _onMapUpdate(data) {
    // Update trap tile visuals
    if (data.traps) {
      // We'll update trap tile textures based on active state
      // (simple: find trap tiles in tilemap and swap texture)
      // This is approximated — we track trap tiles by world position
      this._updateTrapVisuals(data.traps);
    }
  }

  _updateTrapVisuals(traps) {
    // Minimal: scan tileSprites is expensive; instead create overlay graphics
    if (!this._trapOverlays) this._trapOverlays = {};
    for (const trap of traps) {
      const key = `${trap.tx},${trap.ty}`;
      if (!this._trapOverlays[key]) {
        const g = this.add.graphics().setDepth(2);
        this._trapOverlays[key] = { g, tx: trap.tx, ty: trap.ty };
      }
      const ov = this._trapOverlays[key];
      ov.g.clear();
      if (trap.active) {
        ov.g.fillStyle(0xCCCCCC, 0.8);
        const wx = trap.tx * 32, wy = trap.ty * 32;
        for (let i = 0; i < 4; i++) {
          const sx = wx + 4 + i * 7;
          ov.g.fillTriangle(sx + 3, wy + 2, sx, wy + 30, sx + 6, wy + 30);
        }
      }
    }
  }

  _onRoomCleared(data) {
    Sound.playRoomClear();
    this.particles.aoeRing(
      this.localPlayer?.x || 400,
      this.localPlayer?.y || 300,
      80, PALETTE.GOLD
    );
  }

  _onDialogueStart(data) {
    this.dialogueActive = true;
    this.currentDialogueScript = data.script;
    this.currentDialogueLine = data.line || 0;
    if (this.dialogueBox) {
      this.dialogueBox.show(data.script[this.currentDialogueLine]);
    }
  }

  _advanceDialogueTo(lineIndex) {
    this.currentDialogueLine = lineIndex;
    if (this.dialogueBox && this.currentDialogueScript) {
      this.dialogueBox.show(this.currentDialogueScript[lineIndex]);
    }
  }

  _onDialogueEnd() {
    this.dialogueActive = false;
    if (this.dialogueBox) this.dialogueBox.hide();
  }

  _onEscapeStart(data) {
    this.escapeModeActive = true;
    this.escapeTimerText?.setVisible(true);
    Sound.startBGM('boss'); // tense music
    this._showNotice('THE PYRAMID IS COLLAPSING — ESCAPE!', 3000);
    this.cameras.main.shake(400, 0.03);
  }

  _onEscapeTick(data) {
    if (this.escapeTimerText) {
      const t = Math.ceil(data.timeLeft);
      this.escapeTimerText.setText(`ESCAPE: ${t}s`);
      if (t <= 10) this.escapeTimerText.setColor('#FF0000');
    }
  }

  _onGameOver(data) {
    this.scene.start('GameOverScene', { victory: false, stats: data.stats });
  }

  _onVictory(data) {
    this.scene.start('GameOverScene', { victory: true, stats: data.stats });
  }

  _updateHUD(state) {
    const players = state.players || [];
    const p1 = players[0];
    const p2 = players[1];

    if (p1 && this.p1Hp) {
      this.p1Hp.update(p1.hp, p1.maxHp, p1.stamina, p1.maxStamina);
      if (this.p1LvlText) this.p1LvlText.setText(`Lv.${p1.level}`);
    }
    if (p2 && this.p2Hp) {
      this.p2Hp.update(p2.hp, p2.maxHp, p2.stamina, p2.maxStamina);
    }

    // Combo text (warrior)
    const warrior = players.find(p => p.class === 'warrior');
    if (warrior && this.comboText) {
      if (warrior.comboCount >= 2) {
        this.comboText.setText(`COMBO x${warrior.comboCount}!`);
        this.comboText.alpha = Math.min(1, warrior.comboCount * 0.4);
      } else {
        this.comboText.setText('');
      }
    }
  }

  _showNotice(msg, duration = 2000) {
    const W = this.scale.width;
    const t = this.add.text(W/2, this.scale.height / 2 - 60, msg, {
      fontSize: '18px', fontFamily: 'monospace', color: PALETTE.TEXT_GOLD,
      stroke: '#000', strokeThickness: 3,
      backgroundColor: '#00000088',
      padding: { x: 12, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.time.delayedCall(duration, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 500, onComplete: () => t.destroy() });
    });
  }

  _clearLevel() {
    for (const spr of this.tileSprites) spr.destroy();
    this.tileSprites = [];
    for (const id of Object.keys(this.playerSprites)) {
      const s = this.playerSprites[id];
      s.sprite.destroy(); s.nameText.destroy(); s.hpBg.destroy(); s.hpBar.destroy();
      if (s.cat) s.cat.destroy();
    }
    this.playerSprites = {};
    for (const id of Object.keys(this.enemySprites)) {
      const s = this.enemySprites[id];
      s.sprite.destroy(); if (s.hpBg) s.hpBg.destroy(); if (s.hpBar) s.hpBar.destroy();
      if (s.phaseText) s.phaseText.destroy();
    }
    this.enemySprites = {};
    for (const id of Object.keys(this.projectileSprites)) this.projectileSprites[id].destroy();
    this.projectileSprites = {};
    for (const id of Object.keys(this.lootSprites)) {
      this.lootSprites[id].sprite.destroy();
      if (this.lootSprites[id].text) this.lootSprites[id].text.destroy();
    }
    this.lootSprites = {};
    for (const cz of this.curseZoneSprites) cz.destroy();
    this.curseZoneSprites = [];
    if (this.anubisSprite) { this.anubisSprite.destroy(); this.anubisSprite = null; }
    if (this._trapOverlays) {
      for (const ov of Object.values(this._trapOverlays)) ov.g.destroy();
      this._trapOverlays = {};
    }
    if (this.bossHpBg) this.bossHpBg.setVisible(false);
    if (this.bossHpBar) this.bossHpBar.setVisible(false);
    if (this.bossNameText) this.bossNameText.setVisible(false);
    this.torchSprites = [];
  }

  _lerpSprites(map, alpha) {
    for (const id in map) {
      const s = map[id];
      if (!s || !s.sprite || s.targetX === undefined) continue;
      s.sprite.x += (s.targetX - s.sprite.x) * alpha;
      s.sprite.y += (s.targetY - s.sprite.y) * alpha;
      // Re-anchor name text + HP bar to interpolated position
      if (s.nameText) {
        s.nameText.x = s.sprite.x;
        s.nameText.y = s.sprite.y - 28;
      }
      if (s._hpMeta && s.hpBg && s.hpBar) {
        const m = s._hpMeta;
        const bx = s.sprite.x - m.bw / 2;
        const by = s.sprite.y - (m.isBoss ? 50 : (m.bw === 30 ? 20 : 22));
        s.hpBg.clear();
        s.hpBg.fillStyle(0x000000, m.isBoss ? 0.7 : 0.6);
        s.hpBg.fillRect(bx, by, m.bw, m.bh);
        s.hpBar.clear();
        s.hpBar.fillStyle(m.col);
        s.hpBar.fillRect(bx, by, Math.round(m.bw * m.pct), m.bh);
      }
      if (s.phaseText) {
        s.phaseText.x = s.sprite.x;
        s.phaseText.y = s.sprite.y - 55;
      }
    }
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Interpolate sprites toward latest server position.
    // Server broadcasts at ~20 Hz (50 ms); render at 60 Hz.
    // Exponential smoothing — frame-rate independent.
    // alpha = 1 - exp(-k * dt). k ≈ 18 gives ~90% catch-up over 100 ms.
    const k = 18;
    const lerp = 1 - Math.exp(-k * dt);
    this._lerpSprites(this.playerSprites, lerp);
    this._lerpSprites(this.enemySprites, lerp);

    // Smooth camera follow + zoom
    const cam = this.cameras.main;
    if (this._cameraTargetX !== undefined) {
      const camLerp = 1 - Math.exp(-10 * dt);
      cam.scrollX += (this._cameraTargetX - cam.scrollX) * camLerp;
      cam.scrollY += (this._cameraTargetY - cam.scrollY) * camLerp;
    }
    if (this._cameraTargetZoom !== undefined) {
      const zoomLerp = 1 - Math.exp(-4 * dt);
      cam.setZoom(cam.zoom + (this._cameraTargetZoom - cam.zoom) * zoomLerp);
    }

    // Input
    if (this.inputSystem) {
      const inputResult = this.inputSystem.update();
      if (inputResult.tabJustDown && this.inventoryUI) {
        this.inventoryUI.toggle(this.localPlayer);
      }
    }

    // Dialogue input
    if (this.dialogueActive && this.dialogueBox) {
      this.dialogueBox.update(dt);
      const enter = this.inputSystem?.keys?.enter;
      const space = this.inputSystem?.keys?.space;
      if (enter && Phaser.Input.Keyboard.JustDown(enter) || space && Phaser.Input.Keyboard.JustDown(space)) {
        if (this.dialogueBox.isComplete()) {
          this.socket.emit('player:ready');
        } else {
          this.dialogueBox.skipToEnd();
        }
      }
    }

    // Particles
    this.particles.update(dt);
    this.lootPopup.update(dt);

    // Torch flicker
    for (const torch of this.torchSprites) {
      torch.timer -= dt;
      if (torch.timer <= 0) {
        torch.timer = 0.15 + Math.random() * 0.25;
        torch.img.setTexture(Math.random() > 0.3 ? 'tile_torch' : 'tile_torch_dim');
      }
    }

    // Anubis shadow chase
    if (this.anubisSprite && this.anubisChaseTarget && this.gameState) {
      const target = this.gameState.players?.find(p => p.id === this.anubisChaseTarget);
      if (target && !target.dead) {
        this.anubisSprite.x += (target.x - this.anubisSprite.x) * 0.06;
        this.anubisSprite.y += (target.y - this.anubisSprite.y) * 0.06;
        this.anubisSprite.alpha = 0.7 + Math.sin(Date.now() / 200) * 0.3;
      }
    }

    // Inventory refresh
    if (this.inventoryUI?.open && this.localPlayer) {
      this.inventoryUI.refresh(this.localPlayer);
    }
  }
}
