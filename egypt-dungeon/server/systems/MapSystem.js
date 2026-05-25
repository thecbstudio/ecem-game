const { ROOM_TEMPLATES, LEVEL_LAYOUTS, TILE } = require('../data/mapTemplates');
const C = require('../../shared/constants');

class MapSystem {
  constructor(levelIndex) {
    this.levelIndex = levelIndex;
    this.layout = LEVEL_LAYOUTS[levelIndex];
    this.rooms = [];       // placed rooms with world coords
    this.solidGrid = [];   // [row][col] = boolean
    this.trapTiles = [];   // {tx, ty, active, timer}
    this.torches = [];     // {tx, ty}
    this.decorations = []; // {tx, ty}
    this.pressurePlates = []; // {tx, ty, active}
    this.doors = [];       // {id, tx, ty, open, locked}
    this.worldWidth = 0;
    this.worldHeight = 0;
    this._buildLevel();
  }

  _buildLevel() {
    const roomKeys = this.layout.rooms;
    // Find the widest room to center everything
    const maxW = Math.max(...roomKeys.map(k => ROOM_TEMPLATES[k]?.w || 0));
    const BASE_MARGIN = 4; // tiles of wall padding on each side

    // Stack rooms vertically, centered horizontally
    let currentY = 0;
    const MARGIN = 0; // rooms placed directly adjacent

    for (let i = 0; i < roomKeys.length; i++) {
      const tmpl = ROOM_TEMPLATES[roomKeys[i]];
      if (!tmpl) continue;
      // Center this room: offset so the room's center aligns with the widest room's center
      const tileOffX = BASE_MARGIN + Math.floor((maxW - tmpl.w) / 2);
      const room = {
        key: roomKeys[i],
        tmpl,
        worldX: tileOffX * C.TILE_SIZE,
        worldY: currentY * C.TILE_SIZE,
        tileOffX,
        tileOffY: currentY,
        w: tmpl.w,
        h: tmpl.h,
        index: i,
        cleared: i === 0, // spawn room always cleared
        doorIds: []
      };
      this.rooms.push(room);
      currentY += tmpl.h + MARGIN;
    }

    this.worldHeight = currentY * C.TILE_SIZE;
    this.worldWidth = (maxW + BASE_MARGIN * 2) * C.TILE_SIZE;

    // Build solid grid — anything NOT inside a placed room is solid.
    // Without this, players walk through the gap on either side of the
    // rooms (rooms start at tileOffX=4 so cols 0..3 and the right margin
    // would be passable). Then room tiles overwrite as needed.
    const totalRows = currentY;
    const totalCols = Math.ceil(this.worldWidth / C.TILE_SIZE);
    for (let r = 0; r < totalRows; r++) {
      this.solidGrid[r] = [];
      for (let c = 0; c < totalCols; c++) {
        this.solidGrid[r][c] = true; // default: solid (out of bounds)
      }
    }
    // Carve room interiors as passable
    for (const room of this.rooms) {
      for (let ry = 0; ry < room.h; ry++) {
        for (let rx = 0; rx < room.w; rx++) {
          const wr = room.tileOffY + ry;
          const wc = room.tileOffX + rx;
          if (this.solidGrid[wr]) this.solidGrid[wr][wc] = false;
        }
      }
    }

    let doorIdCounter = 0;
    for (const room of this.rooms) {
      for (let ry = 0; ry < room.h; ry++) {
        for (let rx = 0; rx < room.w; rx++) {
          const tile = room.tmpl.tiles[ry][rx];
          const worldRow = room.tileOffY + ry;
          const worldCol = room.tileOffX + rx;
          if (worldRow < 0 || worldCol < 0) continue;
          if (!this.solidGrid[worldRow]) this.solidGrid[worldRow] = [];

          if (tile === TILE.WALL) {
            this.solidGrid[worldRow][worldCol] = true;
          } else if (tile === TILE.FLOOR || tile === TILE.TRAP || tile === TILE.PLATE) {
            this.solidGrid[worldRow][worldCol] = false;
          } else if (tile === TILE.DOOR) {
            this.solidGrid[worldRow][worldCol] = false; // navigable
            const doorId = `door_${doorIdCounter++}`;
            room.doorIds.push(doorId);
            this.doors.push({
              id: doorId,
              tx: worldCol, ty: worldRow,
              open: room.index === 0, // spawn room doors open
              locked: room.index !== 0
            });
          } else if (tile === TILE.TORCH) {
            this.solidGrid[worldRow][worldCol] = false;
            this.torches.push({ tx: worldCol, ty: worldRow });
          } else if (tile === TILE.DECO) {
            this.solidGrid[worldRow][worldCol] = true; // decorations are solid
            this.decorations.push({ tx: worldCol, ty: worldRow });
          } else if (tile === TILE.WATER) {
            this.solidGrid[worldRow][worldCol] = false; // can walk on water (damages)
          }

          // Traps
          if (tile === TILE.TRAP) {
            this.trapTiles.push({ tx: worldCol, ty: worldRow, active: false, timer: Math.random() * 3 });
          }
          // Pressure plates
          if (tile === TILE.PLATE) {
            this.pressurePlates.push({ tx: worldCol, ty: worldRow, active: false });
          }
        }
      }
    }

    // Auto-connect doorways between vertically adjacent rooms.
    // When rooms have different widths, we build a visual + collision
    // connector passage so there's no gap between them.
    this.connectors = []; // {tx, ty} floor tiles to fill gaps between rooms
    for (let i = 0; i < this.rooms.length - 1; i++) {
      const prev = this.rooms[i];
      const next = this.rooms[i + 1];
      const prevBottomRow = prev.tileOffY + prev.h - 1;
      const nextTopRow    = next.tileOffY;

      // Collect all door columns (world coords) from both sides
      const prevDoorCols = [];
      const nextDoorCols = [];
      const prevBottomTiles = prev.tmpl.tiles[prev.h - 1] || [];
      for (let c = 0; c < prev.w; c++) {
        if (prevBottomTiles[c] === TILE.DOOR) prevDoorCols.push(prev.tileOffX + c);
      }
      const nextTopTiles = next.tmpl.tiles[0] || [];
      for (let c = 0; c < next.w; c++) {
        if (nextTopTiles[c] === TILE.DOOR) nextDoorCols.push(next.tileOffX + c);
      }

      const allDoorCols = [...prevDoorCols, ...nextDoorCols];
      if (allDoorCols.length === 0) continue;
      const minCol = Math.min(...allDoorCols);
      const maxCol = Math.max(...allDoorCols);

      // Carve collision for the door passage
      for (let wc = minCol; wc <= maxCol; wc++) {
        if (this.solidGrid[prevBottomRow]) this.solidGrid[prevBottomRow][wc] = false;
        if (this.solidGrid[nextTopRow])    this.solidGrid[nextTopRow][wc] = false;
      }

      // Build wall + floor connector tiles for the visual gap.
      // For each column in the wider room's range at the seam:
      // - If column is in the door passage range → floor
      // - Otherwise → wall (so it looks enclosed)
      const wideLeft  = Math.min(prev.tileOffX, next.tileOffX);
      const wideRight = Math.max(prev.tileOffX + prev.w, next.tileOffX + next.w) - 1;

      for (const row of [prevBottomRow, nextTopRow]) {
        for (let wc = wideLeft; wc <= wideRight; wc++) {
          // Skip if this tile is already inside one of the rooms
          const inPrev = wc >= prev.tileOffX && wc < prev.tileOffX + prev.w && row >= prev.tileOffY && row < prev.tileOffY + prev.h;
          const inNext = wc >= next.tileOffX && wc < next.tileOffX + next.w && row >= next.tileOffY && row < next.tileOffY + next.h;
          if (inPrev || inNext) continue;

          // This tile is in the gap between rooms
          if (wc >= minCol && wc <= maxCol) {
            // Floor connector
            this.connectors.push({ tx: wc, ty: row, tile: TILE.FLOOR });
            if (this.solidGrid[row]) this.solidGrid[row][wc] = false;
          } else {
            // Wall connector
            this.connectors.push({ tx: wc, ty: row, tile: TILE.WALL });
            if (this.solidGrid[row]) this.solidGrid[row][wc] = true;
          }
        }
      }
    }
  }

  update(dt) {
    // Cycle trap tiles
    for (const trap of this.trapTiles) {
      trap.timer -= dt;
      if (trap.timer <= 0) {
        trap.active = !trap.active;
        trap.timer = trap.active ? 1.5 : 2.0;
      }
    }
  }

  isSolid(worldX, worldY) {
    const col = Math.floor(worldX / C.TILE_SIZE);
    const row = Math.floor(worldY / C.TILE_SIZE);
    if (row < 0 || col < 0) return true;
    const gridRow = this.solidGrid[row];
    if (!gridRow) return true;
    return gridRow[col] === true;
  }

  isTrap(worldX, worldY) {
    const col = Math.floor(worldX / C.TILE_SIZE);
    const row = Math.floor(worldY / C.TILE_SIZE);
    return this.trapTiles.find(t => t.tx === col && t.ty === row && t.active) || null;
  }

  isWater(worldX, worldY) {
    const col = Math.floor(worldX / C.TILE_SIZE);
    const row = Math.floor(worldY / C.TILE_SIZE);
    for (const room of this.rooms) {
      const rx = col - room.tileOffX;
      const ry = row - room.tileOffY;
      if (rx < 0 || ry < 0 || rx >= room.w || ry >= room.h) continue;
      if (room.tmpl.tiles[ry] && room.tmpl.tiles[ry][rx] === TILE.WATER) return true;
    }
    return false;
  }

  getRoomAtWorld(worldX, worldY) {
    const col = Math.floor(worldX / C.TILE_SIZE);
    const row = Math.floor(worldY / C.TILE_SIZE);
    for (const room of this.rooms) {
      if (col >= room.tileOffX && col < room.tileOffX + room.w &&
          row >= room.tileOffY && row < room.tileOffY + room.h) {
        return room;
      }
    }
    return null;
  }

  openRoomDoors(roomIndex) {
    const room = this.rooms[roomIndex];
    if (!room) return;
    for (const doorId of room.doorIds) {
      const door = this.doors.find(d => d.id === doorId);
      if (door) { door.open = true; door.locked = false; }
    }
    // Also open entry doors of next room
    if (this.rooms[roomIndex + 1]) {
      const nextRoom = this.rooms[roomIndex + 1];
      for (const doorId of nextRoom.doorIds) {
        const door = this.doors.find(d => d.id === doorId);
        if (door) { door.open = true; door.locked = false; }
      }
    }
  }

  getPlayerSpawnPositions() {
    const spawnRoom = this.rooms[0];
    if (!spawnRoom || !spawnRoom.tmpl.spawnPoints) {
      // Spawn near the door (left side of room, close to bottom exit)
      return [
        { x: (spawnRoom.tileOffX + 2) * C.TILE_SIZE + 16, y: (spawnRoom.tileOffY + 4) * C.TILE_SIZE + 16 },
        { x: (spawnRoom.tileOffX + 3) * C.TILE_SIZE + 16, y: (spawnRoom.tileOffY + 4) * C.TILE_SIZE + 16 }
      ];
    }
    return spawnRoom.tmpl.spawnPoints.map(sp => ({
      x: (spawnRoom.tileOffX + sp.x) * C.TILE_SIZE + 16,
      y: (spawnRoom.tileOffY + sp.y) * C.TILE_SIZE + 16
    }));
  }

  getBossSpawnPosition(roomIndex) {
    const room = this.rooms[roomIndex];
    if (!room || !room.tmpl.bossSpawn) {
      return { x: room ? (room.tileOffX + Math.floor(room.w/2)) * C.TILE_SIZE : 400, y: room ? (room.tileOffY + Math.floor(room.h/2)) * C.TILE_SIZE : 400 };
    }
    return {
      x: (room.tileOffX + room.tmpl.bossSpawn.x) * C.TILE_SIZE,
      y: (room.tileOffY + room.tmpl.bossSpawn.y) * C.TILE_SIZE
    };
  }

  getEnemySpawnPositionsForRoom(roomIndex, count) {
    const room = this.rooms[roomIndex];
    if (!room) return [];
    const positions = [];
    // Scatter randomly in room interior
    for (let i = 0; i < count * 3 && positions.length < count; i++) {
      const tx = room.tileOffX + 2 + Math.floor(Math.random() * (room.w - 4));
      const ty = room.tileOffY + 2 + Math.floor(Math.random() * (room.h - 4));
      if (!this.solidGrid[ty] || this.solidGrid[ty][tx]) continue;
      positions.push({
        x: tx * C.TILE_SIZE + 16,
        y: ty * C.TILE_SIZE + 16
      });
    }
    return positions;
  }

  serialize() {
    return {
      rooms: this.rooms.map(r => ({
        key: r.key,
        worldX: r.worldX,
        worldY: r.worldY,
        tileOffX: r.tileOffX,
        tileOffY: r.tileOffY,
        w: r.w,
        h: r.h,
        tiles: r.tmpl.tiles,
        cleared: r.cleared
      })),
      doors: this.doors,
      traps: this.trapTiles,
      torches: this.torches,
      decorations: this.decorations,
      pressurePlates: this.pressurePlates,
      connectors: this.connectors || [],
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      palette: this.layout.palette
    };
  }
}

module.exports = MapSystem;
