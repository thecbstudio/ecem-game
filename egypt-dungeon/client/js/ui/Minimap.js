// Top-corner minimap
class Minimap {
  constructor(scene) {
    this.scene = scene;
    this.mapData = null;
    // Separate layers: base (rarely redrawn) + dots (every frame)
    this.baseG = scene.add.graphics().setScrollFactor(0).setDepth(120);
    this.dotsG = scene.add.graphics().setScrollFactor(0).setDepth(121);
    this.playerDots = [];
    this.scale = 0.04; // world pixels to minimap pixels
    this.ox = scene.scale.width - 110; // top right corner
    this.oy = 10;
    this.mW = 100;
    this.mH = 80;
    this._baseDirty = true;
    this._lastClearedSig = '';
  }

  setMap(mapData) {
    this.mapData = mapData;
    this._baseDirty = true;
    this._drawBase();
  }

  markDirty() {
    this._baseDirty = true;
  }

  _drawBase() {
    if (!this.mapData) return;
    this.baseG.clear();

    // Background
    this.baseG.fillStyle(PALETTE.UI_BG, 0.8);
    this.baseG.fillRect(this.ox - 2, this.oy - 2, this.mW + 4, this.mH + 4);
    this.baseG.lineStyle(1, PALETTE.UI_BORDER);
    this.baseG.strokeRect(this.ox - 2, this.oy - 2, this.mW + 4, this.mH + 4);

    // Draw rooms
    for (const room of this.mapData.rooms) {
      const rx = this.ox + room.tileOffX * 32 * this.scale;
      const ry = this.oy + room.tileOffY * 32 * this.scale;
      const rw = room.w * 32 * this.scale;
      const rh = room.h * 32 * this.scale;

      const fillColor = room.cleared ? PALETTE.SAND_MID : PALETTE.STONE_DARK;
      this.baseG.fillStyle(fillColor, room.cleared ? 0.8 : 0.4);
      this.baseG.fillRect(rx, ry, rw, rh);
      this.baseG.lineStyle(0.5, PALETTE.UI_BORDER, 0.5);
      this.baseG.strokeRect(rx, ry, rw, rh);
    }
    this._baseDirty = false;
  }

  update(players, enemies) {
    if (!this.mapData) return;
    // Only redraw base when something structural changed (room cleared, etc.)
    const sig = this.mapData.rooms.map(r => r.cleared ? '1' : '0').join('');
    if (sig !== this._lastClearedSig) {
      this._lastClearedSig = sig;
      this._baseDirty = true;
    }
    if (this._baseDirty) this._drawBase();

    // Dots layer redraws every frame (cheap)
    this.dotsG.clear();

    // Enemies first (so player dots draw on top)
    if (enemies) {
      for (const e of enemies) {
        if (e.dead) continue;
        const ex = this.ox + e.x * this.scale;
        const ey = this.oy + e.y * this.scale;
        const isBoss = !!e.isBoss;
        this.dotsG.fillStyle(isBoss ? PALETTE.CURSE_PURPLE : PALETTE.HP_RED);
        this.dotsG.fillCircle(ex, ey, isBoss ? 3 : 1.5);
      }
    }

    for (const player of players) {
      if (player.dead) continue;
      const px = this.ox + player.x * this.scale;
      const py = this.oy + player.y * this.scale;
      const color = player.class === 'warrior' ? PALETTE.WARRIOR_GOLD : PALETTE.ARCHER_TEAL;
      this.dotsG.fillStyle(color);
      this.dotsG.fillCircle(px, py, 3);
      this.dotsG.lineStyle(1, 0xFFFFFF);
      this.dotsG.strokeCircle(px, py, 3);
    }
  }

  destroy() {
    this.baseG.destroy();
    this.dotsG.destroy();
  }
}
