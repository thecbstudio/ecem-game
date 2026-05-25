// Procedural audio using Web Audio API
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this._bgmOscillators = [];
    this._bgmInterval = null;
    this._currentTheme = null;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not available');
      this.enabled = false;
    }
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Short noise burst (sword swing, hit)
  playNoise(duration = 0.05, freq = 800, type = 'sawtooth') {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, this.ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playSwordSwing() {
    this.playNoise(0.08, 300, 'sawtooth');
  }

  playArrowFire() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playHit(isCrit = false) {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const freq = isCrit ? 150 : 220;
    this.playNoise(0.06, freq, 'square');
  }

  playPlayerHurt() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(200, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playDeath() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    // Descending arpeggio
    const notes = [440, 370, 311, 261];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  playLootPickup() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const notes = [523, 659, 784];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  playRoomClear() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const notes = [392, 523, 659, 784];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  playHeavyAttack() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(40, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playUltimate() {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const notes = [196, 247, 294, 370, 440];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.06;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  // Background music — melody + bass drone + percussion
  startBGM(theme = 'level1') {
    if (!this.enabled || !this.ctx) return;
    if (this._currentTheme === theme) return;
    this.stopBGM();
    this._currentTheme = theme;
    this._resume();

    const scales = {
      level1: [220, 247, 277, 330, 370, 415, 440],
      level2: [196, 220, 247, 294, 330, 370, 392],
      level3: [174, 196, 220, 261, 293, 329, 349],
      boss:   [165, 185, 196, 220, 247, 261, 293]
    };
    const scale = scales[theme] || scales.level1;
    let noteIdx = 0;
    const noteLen = theme === 'boss' ? 0.3 : 0.4;
    let beatIdx = 0;

    // Bass drone — low continuous hum
    const drone = this.ctx.createOscillator();
    const droneGain = this.ctx.createGain();
    drone.type = 'sine';
    drone.frequency.value = scale[0] / 2; // one octave below root
    droneGain.gain.value = 0.04;
    drone.connect(droneGain);
    droneGain.connect(this.masterGain);
    drone.start();
    this._bgmOscillators.push(drone);

    const playNote = () => {
      if (!this.enabled) return;
      // Melody
      const freq = scale[noteIdx % scale.length];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + noteLen * 0.9);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + noteLen);

      // Percussion on every other beat (filtered noise burst)
      if (beatIdx % 2 === 0) {
        const perc = this.ctx.createOscillator();
        const pg = this.ctx.createGain();
        perc.type = 'square';
        perc.frequency.value = 60;
        pg.gain.setValueAtTime(0.08, this.ctx.currentTime);
        pg.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
        perc.connect(pg);
        pg.connect(this.masterGain);
        perc.start();
        perc.stop(this.ctx.currentTime + 0.05);
      }

      noteIdx++;
      beatIdx++;
    };

    this._bgmInterval = setInterval(playNote, noteLen * 1000);
    playNote();
  }

  stopBGM() {
    if (this._bgmInterval) {
      clearInterval(this._bgmInterval);
      this._bgmInterval = null;
    }
    for (const osc of this._bgmOscillators) {
      try { osc.stop(); } catch (_) {}
    }
    this._bgmOscillators = [];
    this._currentTheme = null;
  }

  setVolume(vol) {
    if (this.masterGain) this.masterGain.gain.value = vol;
  }
}

const Sound = new SoundSystem();
