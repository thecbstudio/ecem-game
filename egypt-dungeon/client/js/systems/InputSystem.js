// Handles input capture and sends to server
class InputSystem {
  constructor(scene, socket) {
    this.scene = scene;
    this.socket = socket;
    this.keys = {};
    this.mouseAngle = 0;
    this.sequence = 0;
    this._lastInput = null;

    this._setupKeys();
    this._setupMouse();
  }

  _setupKeys() {
    const kb = this.scene.input.keyboard;
    this.keys = {
      up:      kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      shift:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      ability: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      ultimate:kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      tab:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
      enter:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      space:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };
    // Capture so the browser doesn't scroll on SPACE, lose focus on TAB,
    // or trigger button clicks on ENTER.
    kb.addCapture('W,A,S,D,E,R,SHIFT,TAB,SPACE,ENTER,UP,DOWN,LEFT,RIGHT');
    // Also block right-click context menu in the game canvas (saves a click)
    if (this.scene.input?.mouse?.disableContextMenu) {
      this.scene.input.mouse.disableContextMenu();
    }
  }

  _setupMouse() {
    this.scene.input.on('pointermove', (pointer) => {
      // Calculate angle from camera-adjusted player position
      if (this.scene.localPlayer) {
        const cam = this.scene.cameras.main;
        const worldX = pointer.x + cam.scrollX;
        const worldY = pointer.y + cam.scrollY;
        this.mouseAngle = Math.atan2(
          worldY - this.scene.localPlayer.y,
          worldX - this.scene.localPlayer.x
        );
      }
    });
  }

  update() {
    const dx = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const dy = (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    const attacking = this.scene.input.activePointer.leftButtonDown() || this.keys.space.isDown;
    const abilityKey = this.keys.ability.isDown;
    const shift = this.keys.shift.isDown;
    const ultimate = Phaser.Input.Keyboard.JustDown(this.keys.ultimate);

    this.sequence++;
    const input = { dx, dy, attacking, abilityKey, mouseAngle: this.mouseAngle, shift, ultimate, sequence: this.sequence };

    // Only send if changed (mouseAngle rounded to keep idle aim from spamming)
    const str = JSON.stringify({ dx, dy, attacking, abilityKey, shift, ultimate, mouseAngle: Math.round(this.mouseAngle * 100) });
    if (str !== this._lastInput || ultimate) {
      this._lastInput = str;
      this.socket.emit('player:input', input);
    }

    return { ...input, tabJustDown: Phaser.Input.Keyboard.JustDown(this.keys.tab) };
  }

  destroy() {
    // Cleanup
  }
}
