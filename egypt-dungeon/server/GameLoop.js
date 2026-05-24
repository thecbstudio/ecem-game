const C = require('../shared/constants');

class GameLoop {
  constructor(room) {
    this.room = room;
    this.tickCount = 0;
    this.lastTick = Date.now();
    this._interval = null;
  }

  start() {
    if (this._interval) return;
    this.lastTick = Date.now();
    this._interval = setInterval(() => this._tick(), C.TICK_MS);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  isRunning() {
    return this._interval !== null;
  }

  _tick() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.05); // cap at 50ms
    this.lastTick = now;
    this.tickCount++;

    try {
      this.room.update(dt);
    } catch (e) {
      console.error('Game loop error:', e);
    }

    // Broadcast at ~20 Hz (every 3rd tick)
    if (this.tickCount % 3 === 0) {
      try {
        this.room.broadcast();
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }
  }
}

module.exports = GameLoop;
